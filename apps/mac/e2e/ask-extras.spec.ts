// What the Ask window adds to a question: before the first one, up to three questions about the pages filed last, each in words
// beside Ask this, which asks it; and on the newest answer, Save as a page. The fake agent answers an ask with "Q: " and the
// question, as app.spec.ts's Ask tests read it, and when it is asked to save the answer it writes topics/answer.md.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import { agentMode, dictate, filedFromTheCapsule, filedInto, launchOn, onDay, receiptItem, undoItem, undone } from "./capsule-helpers.ts";
import { alive, call, capsuleKind, exists, gitOut, launch, makeLibrary, openedWith, read, recentlyFiled, snap, stubOpening, windowFor } from "./helpers.ts";

/** The line under the field before the first question, and the one a library with no pages gets instead. */
const USUAL = "Answers come from your library only, with links to the pages they use.";
const EMPTY = "Your shelves are empty. Say something first, then ask about it.";

/** The names of the groups `ask` shows, in order: each group is named by the words its aria-labelledby points at. */
const groupNames = (ask: Page) =>
  ask.getByRole("group").evaluateAll((groups) => groups.map((group) => document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""));

test("Ask suggests a question about each page filed last, newest first, and Ask this asks it", async () => {
  const library = await makeLibrary();
  // Three filings a day apart, in this order. An answer saved as a page has an Ask line in the log, which is no filing:
  // it comes last in the log and is never suggested.
  filedInto(library, "goals", "run-a-marathon", "Run a marathon", onDay(-2));
  filedInto(library, "people", "maya", "Maya", onDay(-1));
  filedInto(library, "ideas", "tulips", "Plant tulips in October", onDay(0));
  writeFileSync(path.join(library, "topics", "answer.md"), "# Answer\n");
  new Vault(library).appendLog("ask", "Summarize my ideas → [[answer]]");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  // The usual line shows, and over three groups, one about each page, the newest first: a person's page asks what they are doing with them.
  const usual = ask.getByText(USUAL, { exact: true });
  const groups = ask.getByRole("group");
  await expect(groups).toHaveCount(3);
  await expect(usual).toBeVisible();
  const [lineBox, firstBox] = [await usual.boundingBox(), await groups.first().boundingBox()];
  expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(firstBox!.y);
  expect(await groupNames(ask)).toEqual([
    "What did I say about “Plant tulips in October”?",
    "What am I doing with Maya?",
    "What did I say about “Run a marathon”?",
  ]);
  // Each group has the one button that asks its question: Ask this, secondary and small.
  for (const group of await groups.all()) {
    const buttons = group.getByRole("button");
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveText("Ask this");
    await expect(buttons).toHaveAttribute("data-variant", "secondary");
    await expect(buttons).toHaveAttribute("data-size", "small");
  }
  // Ask this asks its question as a new turn. The suggestions go with the first question, and what is typed stays in the field, which has the focus.
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("draft");
  await snap(ask, "9-ask-suggested");
  await ask.getByRole("group", { name: "What am I doing with Maya?", exact: true }).getByRole("button", { name: "Ask this", exact: true }).click();
  await expect(ask.getByRole("heading", { name: "What am I doing with Maya?", exact: true })).toBeVisible();
  await expect(ask.getByText("Q: What am I doing with Maya?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByRole("group")).toHaveCount(0);
  await expect(field).toHaveValue("draft");
  await expect(field).toBeFocused();
  await app.close();
});

test("with nothing filed, Ask suggests nothing, and its line is as it was", async () => {
  // A page on a shelf and no filing in the log: the usual line, and no question under it.
  const shelved = await makeLibrary();
  writeFileSync(path.join(shelved, "goals", "run.md"), "# Run a marathon\n");
  const first = await launch({ AVANZEL_LIBRARY: shelved });
  expect(await call(first, "askSuggestions")).toEqual([]);
  await call(first, "openAsk");
  const withPage = await windowFor(first, "ask");
  await expect(withPage.getByText(USUAL, { exact: true })).toBeVisible();
  await expect(withPage.getByRole("group")).toHaveCount(0);
  await first.close();
  // No page at all: the line that invites a first thought, which the window draws with the same read that finds no question.
  const bare = await makeLibrary();
  const second = await launch({ AVANZEL_LIBRARY: bare });
  expect(await call(second, "askSuggestions")).toEqual([]);
  await call(second, "openAsk");
  const withNone = await windowFor(second, "ask");
  await expect(withNone.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(withNone.getByRole("group")).toHaveCount(0);
  await second.close();
});

test("a filing outside the six shelves suggests nothing while they are empty", async () => {
  const library = await makeLibrary();
  filedInto(library, "projects", "launch-plan", "Launch plan", onDay(0));
  const app = await launch({ AVANZEL_LIBRARY: library });
  // The menu lists the page, so the app does hold it as filed last; the six shelves hold no page, so Ask invites a first thought,
  // and a question under that line would contradict it.
  expect(await recentlyFiled(app)).toEqual(["Launch plan"]);
  expect(await call(app, "askSuggestions")).toEqual([]);
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(ask.getByRole("group")).toHaveCount(0);
  await app.close();
});

test("a thought filed while Ask is open is suggested once Ask has the focus again", async () => {
  const { app } = await launchOn(await makeLibrary());
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(ask.getByRole("group")).toHaveCount(0);
  await filedFromTheCapsule(app);
  // The window reads the library again whenever it has the focus (as app.spec.ts's empty-shelves test does).
  await ask.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(ask.getByRole("group", { name: "What did I say about “Plant tulips in October”?", exact: true })).toBeVisible();
  await app.close();
});

test("a long title wraps in the question, never in its button", async () => {
  const library = await makeLibrary();
  // 120 characters: more than a line of the window, so the question wraps, and its button, which never wraps its words, stays whole.
  const title = "A very long title for a page of notes that goes on and on about the garden, the bulbs, the soil, the sun and the frosts.";
  expect(title).toHaveLength(120);
  filedInto(library, "ideas", "long-title", title, onDay(0));
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const group = ask.getByRole("group", { name: `What did I say about “${title}”?`, exact: true });
  const button = group.getByRole("button", { name: "Ask this", exact: true });
  await expect(button).toBeVisible();
  // The button lies inside the window, the turns don't scroll sideways, and the words are taller than the button: they run over lines.
  const inside = await ask.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(inside.width);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(inside.height);
  expect(await ask.locator(".ask-turns").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const questionBox = (await group.getByText(`What did I say about “${title}”?`, { exact: true }).boundingBox())!;
  expect(questionBox.height).toBeGreaterThan(buttonBox.height);
  await app.close();
});

// ---------------------------------------------------------------- Save as a page

/** A new file for the fake agent's record (FAKE_AGENT_RECORD): one line for each run it makes. */
const newRecord = () => path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");

/** The runs the fake agent has made so far, oldest first: the prompt each was given, and its process. */
const runsIn = (record: string): { prompt: string; pid: number }[] =>
  existsSync(record)
    ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { prompt: string; pid: number })
    : [];

/** Opens the Ask window of `app` and asks `question` in it, without waiting for the answer: the window. */
async function askedIn(app: ElectronApplication, question: string): Promise<Page> {
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill(question);
  await field.press("Enter");
  return ask;
}

/** Asks `question` and waits for the fake agent's answer to it, which repeats it. Ask each question once: the answer is found by its words. */
async function answeredIn(app: ElectronApplication, question: string): Promise<Page> {
  const ask = await askedIn(app, question);
  await expect(ask.getByText(`Q: ${question}`)).toBeVisible({ timeout: 60_000 });
  return ask;
}

/** The newest turn's save: the status region that holds what the save says (the turn's second one, after its reply's). */
const saveRegion = (ask: Page) => ask.locator("article").first().getByRole("status").nth(1);

/** The newest turn's Save as a page. */
const saveOffer = (ask: Page) => ask.locator("article").first().getByRole("button", { name: "Save as a page", exact: true });

/** What the turn says once the fake agent has saved: it writes topics/answer.md, which has the title "Answer". */
const SAVED = "Saved as “Answer” in Topics.";

/** What a stopped save says when it left edits as their own commit, and the subject of that commit. */
const STOPPED = "Stopped. fake's partial edits are kept as their own commit in the library's history.";
const LEFTOVERS = "avanzel: leftovers of an answer that was not saved";

/** The subject of the last commit in `library`. */
const lastCommit = (library: string) => gitOut(library, "log", "-1", "--format=%s").trim();

test("Save as a page saves the answer the person saw, says where, and opens it", async () => {
  const library = await makeLibrary({ git: true });
  const record = newRecord();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  await stubOpening(app);
  const ask = await answeredIn(app, "Summarize my ideas");
  // The newest turn offers it, once, in the secondary face and small.
  const offer = saveOffer(ask);
  await expect(offer).toHaveCount(1);
  await expect(offer).toHaveAttribute("data-variant", "secondary");
  await expect(offer).toHaveAttribute("data-size", "small");
  await snap(ask, "9-ask-save-offered");
  // The fake's save takes well under a second: the save's run waits 1.5 s, so its line is there to read. The variable is set as
  // agentMode sets its own, and only the run that follows is held up.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_DELAY_MS = "1500";
  });
  await offer.click();
  await expect(saveRegion(ask)).toHaveText("Saving the answer as a page…");
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  await app.evaluate(() => {
    delete process.env.FAKE_AGENT_DELAY_MS;
  });
  // The save was given the answer the person saw, kept inside its fence, and was told to keep its words.
  const runs = runsIn(record);
  expect(runs).toHaveLength(2);
  expect(runs[1]!.prompt).toContain("<shown-answer>\nQ: Summarize my ideas\nPages: ");
  expect(runs[1]!.prompt).toContain("</shown-answer>");
  expect(runs[1]!.prompt).toContain("save the answer the owner was shown");
  // The page is there, the log says how it came, and the save is its own commit.
  expect(exists(library, "topics/answer.md")).toBe(true);
  expect(read(library, "log.md")).toContain("| ask | Summarize my ideas → [[answer]]");
  expect(lastCommit(library)).toBe("avanzel: save answer to “Summarize my ideas”");
  // Nothing more to offer for this answer. Open opens the page.
  await expect(offer).toHaveCount(0);
  await snap(ask, "9-ask-saved");
  await ask.locator("article").first().getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "topics", "answer.md")));
  await app.close();
});

test("one run at a time: no question while a save runs, and Stop gives the save up, keeping what it left as its own commit", async () => {
  const library = await makeLibrary({ git: true });
  const record = newRecord();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  const ask = await answeredIn(app, "Summarize my ideas");
  // "slow-messy" writes a page and never finishes, so the save runs until it is stopped.
  await agentMode(app, "slow-messy");
  await saveOffer(ask).click();
  // A question typed meanwhile is not asked: no turn comes, and the words stay in the field. No second save is offered.
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("What are my goals?");
  await field.press("Enter");
  await expect(ask.getByRole("heading")).toHaveCount(1);
  await expect(field).toHaveValue("What are my goals?");
  await expect(ask.getByRole("button", { name: "Save as a page" })).toHaveCount(0);
  // Once the agent has started its page, Stop gives the save up: the agent is gone, what it wrote is kept as its own commit, and
  // the offer is back.
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  const pid = runsIn(record)[1]!.pid;
  await ask.locator("article").first().getByRole("button", { name: "Stop", exact: true }).click();
  await expect(saveRegion(ask)).toHaveText(STOPPED, { timeout: 30_000 });
  expect(lastCommit(library)).toBe(LEFTOVERS);
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  await expect(saveOffer(ask)).toBeVisible();
  await expect(ask.getByRole("alert")).toHaveCount(0);
  await app.close();
});

test("a save that saved no page, or failed, says so with one fix, Save again", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const ask = await answeredIn(app, "Summarize my ideas");
  const alert = ask.getByRole("alert");
  const turn = ask.locator("article").first();
  // An agent that answers in words and writes nothing ended well and saved no page: the Notice says so, and that the library is as it
  // was. Its one fix, the moment's primary, saves again.
  await agentMode(app, "noop");
  await saveOffer(ask).click();
  await expect(alert.getByText("fake didn't save a page.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(alert.getByText("Your library hasn't changed.", { exact: true })).toBeVisible();
  await expect(alert.getByRole("button")).toHaveText(["Save again"]);
  await expect(alert.getByRole("button", { name: "Save again", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(saveOffer(ask)).toHaveCount(0);
  await snap(ask, "9-ask-save-failed");
  // An agent that isn't signed in: its title, what is safe, and to save again; Terminal is the primary, and Save again beside it.
  await agentMode(app, "fail");
  await alert.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(alert.getByText("fake isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(alert.getByText("Your library hasn't changed. Sign in to fake in Terminal, then save again.", { exact: true })).toBeVisible();
  await expect(alert.getByRole("button")).toHaveText(["Save again", "Open Terminal"]);
  await expect(alert.getByRole("button", { name: "Open Terminal", exact: true })).toHaveAttribute("data-variant", "primary");
  // The agent works now: the third try saves, and the Notice goes.
  await agentMode(app, "ok");
  await alert.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(turn.getByRole("status").nth(1)).toHaveText(SAVED, { timeout: 60_000 });
  await expect(alert).toHaveCount(0);
  await app.close();
});

test("an older turn's unsaved Notice keeps its words, with no buttons", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const ask = await answeredIn(app, "Summarize my ideas");
  await agentMode(app, "noop");
  await saveOffer(ask).click();
  await expect(ask.getByRole("alert").getByText("fake didn't save a page.", { exact: true })).toBeVisible({ timeout: 60_000 });
  // A later question comes after the failed save: only the newest turn offers a fix, as a failed question's Notice does.
  await agentMode(app, "ok");
  await answeredIn(app, "What are my goals?");
  const [newest, older] = await ask.locator("article").all();
  await expect(older!.getByRole("alert").getByText("fake didn't save a page.", { exact: true })).toBeVisible();
  await expect(older!.getByRole("alert").getByText("Your library hasn't changed.", { exact: true })).toBeVisible();
  await expect(older!.getByRole("button")).toHaveCount(0);
  await expect(newest!.getByRole("button", { name: "Save as a page", exact: true })).toBeVisible();
  await app.close();
});

test("Save as a page is offered on the newest answered turn only", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await answeredIn(app, "Summarize my ideas");
  const ask = await answeredIn(app, "What are my goals?");
  const offers = ask.getByRole("button", { name: "Save as a page", exact: true });
  await expect(offers).toHaveCount(1);
  await expect(ask.locator("article").first().getByRole("button", { name: "Save as a page", exact: true })).toHaveCount(1);
  // The newest turn failed: there is no answer to keep, and the one before it is not the newest any more.
  await agentMode(app, "fail");
  await askedIn(app, "What about my people?");
  await expect(ask.getByRole("alert").getByText("fake isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(offers).toHaveCount(0);
  await app.close();
});

test("a save clears the menu's Undo the last filing, as it starts and after a filing that ended while it waited", async () => {
  // As it starts: the filing's Undo is on the menu until the save is pressed, and not after it, nor once the page is saved. Only the
  // Undo goes: the filing's receipt stays on the menu.
  const first = await launchOn(await makeLibrary({ git: true }));
  await filedFromTheCapsule(first.app);
  await expect.poll(() => undoItem(first.app), { timeout: 20_000 }).toBeDefined();
  const ask = await answeredIn(first.app, "Summarize my ideas");
  expect(await undoItem(first.app)).toBeDefined();
  await saveOffer(ask).click();
  await expect.poll(() => undoItem(first.app)).toBeUndefined();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  expect(await undoItem(first.app)).toBeUndefined();
  await expect.poll(() => receiptItem(first.app)).toBeDefined();
  await first.app.close();
  // After a filing that ended while it waited: the save, pressed while a filing still runs, waits for the library. The filing ends, and
  // the save commits after it, so the filing's Undo is not on the menu once the save is saved either.
  const second = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file" });
  const waiting = await answeredIn(second.app, "Summarize my ideas"); // an ask is not held up
  await dictate(second.app);
  await expect.poll(() => capsuleKind(second.app), { timeout: 30_000 }).toBe("filing");
  await saveOffer(waiting).click();
  await expect(saveRegion(waiting)).toHaveText("Waiting for Avanzel to finish with your library…");
  await expect.poll(() => capsuleKind(second.app), { timeout: 60_000 }).toBe("filed");
  await expect(saveRegion(waiting)).toHaveText(SAVED, { timeout: 60_000 });
  expect(await undoItem(second.app)).toBeUndefined();
  await second.app.close();
});

test("a save that saved no page doesn't bring back the Undo it took off the menu as it began", async () => {
  const { app } = await launchOn(await makeLibrary({ git: true }));
  await filedFromTheCapsule(app);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toBeDefined();
  const ask = await answeredIn(app, "Summarize my ideas");
  await agentMode(app, "noop");
  await saveOffer(ask).click();
  await expect(ask.getByRole("alert").getByText("fake didn't save a page.", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await undoItem(app)).toBeUndefined();
  await app.close();
});

test("while a save waits for the library and runs, no filing is offered for Undo, and Stop keeps it so", async () => {
  const record = newRecord();
  const { app, library } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file" });
  const ask = await answeredIn(app, "Summarize my ideas");
  await dictate(app);
  // The fake reads its mode before it writes its record line: once the filing's line is there, it has read "ok". The save that follows
  // is made to hang; switching modes on the capsule's "filing" alone could make the filing itself hang.
  await expect.poll(() => runsIn(record).some((run) => run.prompt.startsWith("Avanzel task: file")), { timeout: 30_000 }).toBe(true);
  await agentMode(app, "slow-messy");
  await saveOffer(ask).click();
  // The filing ends well, and the save is next in line for the library. The filing is not offered for Undo while the save is about to
  // commit after it: not by the menu, not by ⌥⇧Z, whose press does nothing (no bar that says there is no filing, nothing taken back).
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(await undoItem(app)).toBeUndefined();
  expect(await call(app, "pressShortcutForTests", "undo")).toBe(true);
  expect(await capsuleKind(app)).not.toBe("nothing-to-undo");
  expect(undone(library)).toEqual([]);
  // The save has the library now and hangs.
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  expect(await undoItem(app)).toBeUndefined();
  // Stop: the save's leftovers are a commit after the filing, so the filing stays out of the menu once the save has ended.
  await ask.locator("article").first().getByRole("button", { name: "Stop", exact: true }).click();
  await expect(saveRegion(ask)).toHaveText(STOPPED, { timeout: 30_000 });
  expect(lastCommit(library)).toBe(LEFTOVERS);
  expect(await undoItem(app)).toBeUndefined();
  await call(app, "idleForTests");
  expect(undone(library)).toEqual([]);
  await app.close();
});

test("a save pressed after another library opened runs nothing and says so, and saves once that library is back", async () => {
  const library = await makeLibrary({ git: true });
  const record = newRecord();
  // The libraries that open are remembered in the config folder, which is this test's own.
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")), FAKE_AGENT_RECORD: record });
  const ask = await answeredIn(app, "Summarize my ideas");
  // Another library opens; the window stays, with an answer from the first. Saving it would file it, with its links, in the other.
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other);
  await saveOffer(ask).click();
  const alert = ask.getByRole("alert");
  await expect(alert.getByText("Avanzel couldn't save the answer.", { exact: true })).toBeVisible();
  await expect(
    alert.getByText("Your library hasn't changed. This answer came from another library. Change back to it in Settings → General, then save again.", { exact: true }),
  ).toBeVisible();
  await expect(alert.getByRole("button")).toHaveText(["Save again"]);
  expect(runsIn(record)).toHaveLength(1); // the question's run alone
  expect(exists(library, "topics/answer.md")).toBe(false);
  expect(exists(other, "topics/answer.md")).toBe(false);
  // The first library is back: the same answer is saved in it, and in no other.
  await call(app, "useLibrary", library);
  await alert.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  expect(exists(library, "topics/answer.md")).toBe(true);
  expect(exists(other, "topics/answer.md")).toBe(false);
  await app.close();
});

test("closing the Ask window gives a running save up, and keeps what it left as its own commit", async () => {
  const library = await makeLibrary({ git: true });
  const record = newRecord();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  const ask = await answeredIn(app, "Summarize my ideas");
  await agentMode(app, "slow-messy");
  await saveOffer(ask).click();
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  const pid = runsIn(record)[1]!.pid;
  await call(app, "closeAsk");
  await expect.poll(() => lastCommit(library), { timeout: 30_000 }).toBe(LEFTOVERS);
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  await app.close();
});

test("only the Ask window's page can save", async () => {
  const library = await makeLibrary({ git: true });
  const record = newRecord();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  // Every window has the same bridge, so Settings' page can send ask:save: main refuses it, and runs nothing.
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  const refusal = await settings.evaluate(() =>
    window.avanzel.ask.save("Summarize my ideas", "An answer.", null).then(
      () => null,
      (error: unknown) => String(error),
    ),
  );
  expect(refusal).toContain("Only the Ask window saves an answer.");
  expect(runsIn(record)).toEqual([]);
  expect(exists(library, "topics/answer.md")).toBe(false);
  await app.close();
});
