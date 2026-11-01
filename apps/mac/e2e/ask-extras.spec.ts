// What the Ask window adds to a question: before the first one, up to three questions about the pages filed last, each in words
// beside Ask this, which asks it; and on the newest answer, Save as a page, which the turn can take back with its own Undo. The fake
// agent answers an ask with "Q: " and the question, as app.spec.ts's Ask tests read it, and when it is asked to save the answer it
// writes topics/answer.md. Under the field a hint names Record a thought's shortcut, which, pressed with this window in front, says a
// question into the field and keeps nothing in the library (the last tests).
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, Vault, writeWav } from "../../../packages/engine/src/index.ts";
import {
  agentMode,
  archived,
  askIsKey,
  dictate,
  expectProblem,
  filedFromTheCapsule,
  filedInto,
  inbox,
  launchOn,
  noteTranscriptions,
  notified,
  onDay,
  reachedUndo,
  receiptItem,
  stopTranscribing,
  transcriptions,
  trayOffersUndo,
  undoCalls,
  undoItem,
  undone,
  watchUndos,
  type Left,
} from "./capsule-helpers.ts";
import {
  alive,
  call,
  capsuleKind,
  closeModelHubs,
  emptyHfCache,
  exists,
  fakeModelHub,
  filesUnder,
  gitOut,
  launch,
  makeLibrary,
  onlyAgentsIn,
  openedWith,
  read,
  recentlyFiled,
  snap,
  speechWav,
  stubOpening,
  windowFor,
} from "./helpers.ts";
import { pressShortcut, sentToCapsule, settingsSnap, watchCapsule } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

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
  // No suggestion is left, and no group is named by one: the only group is the answer's Save as a page, which nothing names yet.
  await expect(ask.getByRole("button", { name: "Ask this", exact: true })).toHaveCount(0);
  expect(await groupNames(ask)).toEqual([""]);
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
  // The usual line stands before the window has read anything, so it proves nothing. The hint is drawn by the same read as the suggestions
  // (the shelves, the questions and the shortcut come back together): once it shows, the absence of a group is what that read found.
  await expect(withPage.locator("kbd")).toBeVisible();
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
  // A short page beside it, whose question fits one line: its button is the one a long question's button must match.
  filedInto(library, "people", "maya", "Maya", onDay(-1));
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
  // Both buttons are one line: the long question's is as tall as the short one's, whatever its question does.
  const asks = ask.getByRole("button", { name: "Ask this", exact: true });
  await expect(asks).toHaveCount(2);
  const heights = await asks.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().height));
  expect(heights[0]).toBeCloseTo(heights[1]!, 0);
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

/** Asks `question`, saves its answer as a page, and waits until the newest turn says it is saved: the Ask window. */
async function savedIn(app: ElectronApplication, question = "Summarize my ideas"): Promise<Page> {
  const ask = await answeredIn(app, question);
  await saveOffer(ask).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  return ask;
}

/** What the turn says once that save is taken back, when the save made its page. */
const UNDONE = "Undone. “Answer” is no longer in your library.";

/** What it says when the save only changed a page the library had: Undo put the page back, and it is still there. */
const UNDONE_CHANGED = "Undone. “Answer” is back as it was.";

/** The turn `place` from the top: 0 is the newest. */
const turnAt = (ask: Page, place = 0) => ask.locator("article").nth(place);

/** A turn's Undo of its saved page. */
const undoOf = (turn: Locator) => turn.getByRole("button", { name: "Undo", exact: true });

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
  // It sits 8 pt under the answer's last line, as the turn's other pieces do: the save's status region, empty until the save says
  // something, takes no slot of its own.
  const [answered, offered] = [await turnAt(ask).getByText(/^fake answered in \d+ s$/).boundingBox(), await offer.boundingBox()];
  expect(offered!.y - (answered!.y + answered!.height)).toBeCloseTo(8, 0);
  // The offer is in a group from the start, which nothing names until there is a saved line to name it. The group keeps its role through
  // the whole save: a role that came in the commit that brings the region its first line could make VoiceOver count the region as new
  // and drop the line. So the group is held, and its role watched, from here on.
  const wrapper = ask.getByRole("group");
  await expect(wrapper).toHaveCount(1);
  await expect(wrapper).not.toHaveAttribute("aria-labelledby");
  const group = (await wrapper.elementHandle())!;
  await group.evaluate((el) => {
    const watched = window as unknown as { roleChanges: number };
    watched.roleChanges = 0;
    new MutationObserver((records) => (watched.roleChanges += records.length)).observe(el, { attributes: true, attributeFilter: ["role"] });
  });
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
  // Nothing more to offer for this answer. The saved line names the group of its buttons, so each Open says which page it opens.
  // Open opens the page.
  await expect(offer).toHaveCount(0);
  await expect(ask.getByRole("group")).toHaveCount(1);
  await expect(turnAt(ask).getByRole("group", { name: SAVED, exact: true }).getByRole("button")).toHaveText(["Undo", "Open"]);
  // It is the group the offer was in, still there, and its role never changed on the way.
  expect(await group.evaluate((el) => el.isConnected && el.getAttribute("role") === "group")).toBe(true);
  expect(await ask.evaluate(() => (window as unknown as { roleChanges: number }).roleChanges)).toBe(0);
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
  // Undo goes: the filing's receipt stays on the menu. Both the model and the menu the tray holds say it (`trayOffersUndo`).
  const first = await launchOn(await makeLibrary({ git: true }));
  await filedFromTheCapsule(first.app);
  await expect.poll(() => undoItem(first.app), { timeout: 20_000 }).toBeDefined();
  await expect.poll(() => trayOffersUndo(first.app)).toBe(true);
  const ask = await answeredIn(first.app, "Summarize my ideas");
  expect(await undoItem(first.app)).toBeDefined();
  await saveOffer(ask).click();
  await expect.poll(() => undoItem(first.app)).toBeUndefined();
  await expect.poll(() => trayOffersUndo(first.app)).toBe(false);
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  expect(await undoItem(first.app)).toBeUndefined();
  expect(await trayOffersUndo(first.app)).toBe(false);
  await expect.poll(() => receiptItem(first.app)).toBeDefined();
  await first.app.close();
  // After a filing that ended while it waited: the save, pressed while a filing runs, waits for the library. The filing's own line in the
  // fake's record shows it has the library (the capsule's "filing" comes before it takes the lock). The filing ends, and the save commits
  // after it, so the filing's Undo is not on the menu once the save is saved either.
  const record = newRecord();
  const second = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file" });
  const waiting = await answeredIn(second.app, "Summarize my ideas"); // an ask is not held up
  await dictate(second.app);
  await expect.poll(() => runsIn(record).some((run) => run.prompt.startsWith("Avanzel task: file")), { timeout: 30_000 }).toBe(true);
  await saveOffer(waiting).click();
  await expect(saveRegion(waiting)).toHaveText("Waiting for Avanzel to finish with your library…");
  await expect.poll(() => capsuleKind(second.app), { timeout: 60_000 }).toBe("filed");
  await expect(saveRegion(waiting)).toHaveText(SAVED, { timeout: 60_000 });
  expect(await undoItem(second.app)).toBeUndefined();
  expect(await trayOffersUndo(second.app)).toBe(false);
  await second.app.close();
});

test("a save that saved no page doesn't bring back the Undo it took off the menu as it began", async () => {
  const { app } = await launchOn(await makeLibrary({ git: true }));
  await filedFromTheCapsule(app);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toBeDefined();
  await expect.poll(() => trayOffersUndo(app)).toBe(true);
  const ask = await answeredIn(app, "Summarize my ideas");
  await agentMode(app, "noop");
  await saveOffer(ask).click();
  await expect(ask.getByRole("alert").getByText("fake didn't save a page.", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
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
  expect(await trayOffersUndo(app)).toBe(false);
  expect(await call(app, "pressShortcutForTests", "undo")).toBe(true);
  expect(await capsuleKind(app)).not.toBe("nothing-to-undo");
  expect(undone(library)).toEqual([]);
  // The save has the library now and hangs.
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // Stop: the save's leftovers are a commit after the filing, so the filing stays out of the menu once the save has ended.
  await ask.locator("article").first().getByRole("button", { name: "Stop", exact: true }).click();
  await expect(saveRegion(ask)).toHaveText(STOPPED, { timeout: 30_000 });
  expect(lastCommit(library)).toBe(LEFTOVERS);
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  await call(app, "idleForTests");
  expect(undone(library)).toEqual([]);
  await app.close();
});

test("Stop on a save that waits for the library is answered once the filing lets go, and the filing is offered for Undo again", async () => {
  const record = newRecord();
  const { app } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file" });
  const ask = await answeredIn(app, "Summarize my ideas");
  await dictate(app);
  // The filing's own line in the record shows it has the library; the save pressed now waits behind it.
  await expect.poll(() => runsIn(record).some((run) => run.prompt.startsWith("Avanzel task: file")), { timeout: 30_000 }).toBe(true);
  await saveOffer(ask).click();
  await expect(saveRegion(ask)).toHaveText("Waiting for Avanzel to finish with your library…");
  // The library's lock takes no signal, so Stop is answered only when the filing ends: its button says it waits, and the line stays.
  const stop = turnAt(ask).getByRole("button", { name: "Stop", exact: true });
  await stop.click();
  await expect(stop).toHaveAttribute("aria-busy", "true");
  await expect(saveRegion(ask)).toHaveText("Waiting for Avanzel to finish with your library…");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(saveRegion(ask)).toHaveText("Stopped. Your library hasn't changed.", { timeout: 60_000 });
  // The save committed nothing, so the filing is still the library's last commit: the menu offers its Undo again, as the tray holds it.
  expect(await undoItem(app)).toBeDefined();
  await expect.poll(() => trayOffersUndo(app)).toBe(true);
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

test("Undo takes the saved page back, once, and the turn says so", async () => {
  const { app, library } = await launchOn(await makeLibrary({ git: true })); // up before the wrappers go on
  await watchUndos(app);
  const ask = await savedIn(app);
  const turn = turnAt(ask);
  const commit = gitOut(library, "rev-parse", "HEAD").trim();
  // The saved line names its buttons' group: Undo before Open, both small and secondary.
  await expect(turn.getByRole("group", { name: SAVED, exact: true }).getByRole("button")).toHaveText(["Undo", "Open"]);
  await expect(undoOf(turn)).toHaveAttribute("data-variant", "secondary");
  await expect(undoOf(turn)).toHaveAttribute("data-size", "small");
  await undoOf(turn).click();
  // The field gets the focus, which the pressed button leaves, as it does after Save and Stop: what is typed next is a question.
  await expect(ask.getByRole("textbox", { name: "Ask your library" })).toBeFocused();
  await expect(saveRegion(ask)).toHaveText(UNDONE, { timeout: 30_000 });
  // The save's commit is taken back, once: the page and its log line are gone, and the history keeps the revert.
  expect(undone(library)).toEqual(["avanzel: undo save answer to “Summarize my ideas”"]);
  expect(exists(library, "topics/answer.md")).toBe(false);
  expect(read(library, "log.md")).not.toContain("| ask |");
  expect(await undoCalls(app)).toBe(1);
  // Undo and Open go, and the offer is back. The turn alone tells it: no notification, and no card on the capsule.
  await expect(undoOf(turn)).toHaveCount(0);
  await expect(turn.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await expect(saveOffer(ask)).toBeVisible();
  // The offer's group stays, and no saved line names it any more.
  await expect(ask.getByRole("group")).toHaveCount(1);
  await expect(ask.getByRole("group")).not.toHaveAttribute("aria-labelledby");
  await expect(ask.getByRole("alert")).toHaveCount(0);
  expect(await notified(app, "Undone")).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  await snap(ask, "9-ask-save-undone");
  // The commit had its one try: asked for again, main takes nothing back.
  expect(await ask.evaluate((saved) => window.avanzel.ask.undoSave(saved), commit)).toBe(false);
  expect(undone(library)).toHaveLength(1);
  expect(await undoCalls(app)).toBe(1);
  await app.close();
});

test("Undo of a save that only changed its page says the page is back as it was, and the page stays", async () => {
  const { app, library } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app);
  // The first save makes topics/answer.md. The fake agent writes it again for every save, so the second one changes the page the library
  // has (a page's `created` is false), as a real agent does when it updates a page instead of making a near-duplicate.
  await savedIn(app);
  const ask = await answeredIn(app, "What are my goals?");
  await saveOffer(ask).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  expect(read(library, "log.md").match(/\| ask \|/g)).toHaveLength(2);
  // Undoing the second save puts the page back as it was: it is still in the library, and the turn does not say it is gone.
  await undoOf(turnAt(ask)).click();
  await expect(saveRegion(ask)).toHaveText(UNDONE_CHANGED, { timeout: 30_000 });
  expect(undone(library)).toEqual(["avanzel: undo save answer to “What are my goals?”"]);
  expect(exists(library, "topics/answer.md")).toBe(true);
  expect(read(library, "log.md").match(/\| ask \|/g)).toHaveLength(1); // the first save's line stays
  expect(await undoCalls(app)).toBe(1);
  // The first save was not touched: its turn still offers its Undo and Open.
  await expect(turnAt(ask, 1).getByRole("button")).toHaveText(["Undo", "Open"]);
  await snap(ask, "9-ask-save-undone-changed");
  await app.close();
});

test("a filing after the save makes git refuse its Undo, and the turn says so once", async () => {
  const { app, library } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app);
  const ask = await savedIn(app);
  const turn = turnAt(ask);
  // A filing comes after the save, into the same lines of the log: git can't take the save back without it.
  await filedFromTheCapsule(app);
  await undoOf(turn).click();
  await expect(ask.getByRole("textbox", { name: "Ask your library" })).toBeFocused(); // a refused Undo leaves it there too
  const alert = ask.getByRole("alert");
  await expect(alert.getByText("This one can't be undone automatically.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(alert.getByText("Usually a later change touched the same lines. The library's history keeps both versions.", { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(1);
  await snap(ask, "9-ask-save-undo-refused");
  // The saved line and Open stay, with no second Undo to ask for. Nothing was taken back, and the turn alone says so.
  await expect(saveRegion(ask)).toHaveText(SAVED);
  await expect(turn.getByRole("button", { name: "Open", exact: true })).toBeVisible();
  await expect(undoOf(turn)).toHaveCount(0);
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toEqual([]);
  expect(exists(library, "topics/answer.md")).toBe(true);
  expect(await notified(app, "This one can't be undone automatically.")).toEqual([]);
  await app.close();
});

test("the Undo takes back in the library the save was made in, whichever is open", async () => {
  const library = await makeLibrary({ git: true });
  // The libraries that open are remembered in the config folder, which is this test's own.
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  const ask = await savedIn(app);
  // Another library opens; the window stays, with its saved turn.
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other);
  await undoOf(turnAt(ask)).click();
  await expect(saveRegion(ask)).toHaveText(UNDONE, { timeout: 30_000 });
  expect(exists(library, "topics/answer.md")).toBe(false);
  expect(undone(library)).toEqual(["avanzel: undo save answer to “Summarize my ideas”"]);
  expect(undone(other)).toEqual([]);
  await app.close();
});

test("in a library without git, the saved line offers Open and no Undo", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const ask = await savedIn(app);
  await expect(turnAt(ask).getByRole("group", { name: SAVED, exact: true }).getByRole("button")).toHaveText(["Open"]);
  await expect(undoOf(turnAt(ask))).toHaveCount(0);
  await app.close();
});

test("only the Ask window's page can undo a save", async () => {
  const { app, library } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app);
  const ask = await savedIn(app);
  const commit = gitOut(library, "rev-parse", "HEAD").trim();
  // Every window has the same bridge, so Settings' page can send ask:undo-save: main knows the commit, and refuses it all the same.
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  expect(await settings.evaluate((saved) => window.avanzel.ask.undoSave(saved), commit)).toBe(false);
  expect(undone(library)).toEqual([]);
  expect(await undoCalls(app)).toBe(0);
  // The turn's own Undo still works: the refusal took nothing from it.
  await undoOf(turnAt(ask)).click();
  await expect(saveRegion(ask)).toHaveText(UNDONE, { timeout: 30_000 });
  expect(undone(library)).toEqual(["avanzel: undo save answer to “Summarize my ideas”"]);
  expect(await undoCalls(app)).toBe(1);
  await app.close();
});

test("a saved turn keeps its Undo under newer questions, and an older turn that is undone says so with no offer", async () => {
  const library = await makeLibrary({ git: true });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const ask = await savedIn(app);
  // A newer question comes after the save: the saved turn is the second now, and keeps its line, Undo and Open.
  await answeredIn(app, "What are my goals?");
  const [newest, older] = [turnAt(ask, 0), turnAt(ask, 1)];
  await expect(older.getByRole("status").nth(1)).toHaveText(SAVED);
  await expect(older.getByRole("button")).toHaveText(["Undo", "Open"]);
  await undoOf(older).click();
  await expect(older.getByRole("status").nth(1)).toHaveText(UNDONE, { timeout: 30_000 });
  expect(exists(library, "topics/answer.md")).toBe(false);
  // The offer is the newest turn's alone: the older turn says it is undone, and has nothing to press.
  await expect(older.getByRole("button")).toHaveCount(0);
  await expect(ask.getByRole("button", { name: "Save as a page", exact: true })).toHaveCount(1);
  await expect(newest.getByRole("button", { name: "Save as a page", exact: true })).toBeVisible();
  await app.close();
});

test("an undone save can be saved again, and the second save has its own Undo", async () => {
  const library = await makeLibrary({ git: true });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const ask = await savedIn(app);
  const turn = turnAt(ask);
  await undoOf(turn).click();
  await expect(saveRegion(ask)).toHaveText(UNDONE, { timeout: 30_000 });
  // The offer is back, and pressing it saves the same answer again: a new commit, with its own Undo.
  await saveOffer(ask).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  expect(exists(library, "topics/answer.md")).toBe(true);
  await expect(turn.getByRole("group", { name: SAVED, exact: true }).getByRole("button")).toHaveText(["Undo", "Open"]);
  await undoOf(turn).click();
  await expect(saveRegion(ask)).toHaveText(UNDONE, { timeout: 30_000 });
  expect(undone(library)).toHaveLength(2);
  expect(exists(library, "topics/answer.md")).toBe(false);
  await app.close();
});

test("closing the Ask window ends its Undo, and the library's history keeps the save", async () => {
  const { app, library } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app);
  const ask = await savedIn(app);
  const commit = gitOut(library, "rev-parse", "HEAD").trim();
  await call(app, "closeAsk");
  await expect.poll(() => ask.isClosed()).toBe(true);
  // A window opened after it knows nothing of the save: main takes back no commit it didn't hand that window.
  await call(app, "openAsk");
  const again = await windowFor(app, "ask");
  expect(await again.evaluate((saved) => window.avanzel.ask.undoSave(saved), commit)).toBe(false);
  expect(undone(library)).toEqual([]);
  expect(await undoCalls(app)).toBe(0);
  expect(exists(library, "topics/answer.md")).toBe(true);
  await app.close();
});

test("Save as a page waits for an Undo that waits, and a question doesn't", async () => {
  // A save that commits before an Undo that waits can make git refuse that Undo, which has one try. So while an Undo waits (here it is
  // held at the library's door), the newest turn's offer is busy, and a press on it saves nothing. A question touches no commit: it goes on.
  const record = newRecord();
  const { app, library } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_RECORD: record });
  await watchUndos(app, { hold: true });
  await savedIn(app);
  const ask = await answeredIn(app, "What are my goals?");
  await expect(saveOffer(ask)).not.toHaveAttribute("aria-busy", "true");
  await undoOf(turnAt(ask, 1)).click();
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  // The offer says it waits, and a press on it begins no save: the turn shows no Stop and no line, and the agent is not run.
  await expect(saveOffer(ask)).toHaveAttribute("aria-busy", "true");
  await snap(ask, "9-ask-save-offer-waiting");
  await saveOffer(ask).click();
  await expect(turnAt(ask).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(saveRegion(ask)).toHaveText("");
  // A question is answered beside the Undo, and the offer on its turn waits as well.
  await answeredIn(app, "What about my people?");
  await expect(saveOffer(ask)).toHaveAttribute("aria-busy", "true");
  // The Undo lands: the first turn says so, and the offer is free to save.
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await expect(turnAt(ask, 2).getByRole("status").nth(1)).toHaveText(UNDONE, { timeout: 30_000 });
  await expect(saveOffer(ask)).not.toHaveAttribute("aria-busy", "true");
  await saveOffer(ask).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  // Two saves ran, the first and the last: the press on the waiting offer began none.
  expect(runsIn(record).filter((run) => run.prompt.includes("<shown-answer>"))).toHaveLength(2);
  expect(undone(library)).toEqual(["avanzel: undo save answer to “Summarize my ideas”"]);
  await app.close();
});

test("Save again waits for an Undo that waits, as the offer does", async () => {
  const { app } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app, { hold: true });
  await savedIn(app);
  // The next answer's save saves no page: its Notice offers Save again, on the newest turn.
  const ask = await answeredIn(app, "What are my goals?");
  await agentMode(app, "noop");
  await saveOffer(ask).click();
  const alert = ask.getByRole("alert");
  await expect(alert.getByText("fake didn't save a page.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await agentMode(app, "ok");
  const again = alert.getByRole("button", { name: "Save again", exact: true });
  await expect(again).not.toHaveAttribute("aria-busy", "true");
  await undoOf(turnAt(ask, 1)).click();
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  // It waits, and a press on it begins no save: the Notice stays, and no Stop shows.
  await expect(again).toHaveAttribute("aria-busy", "true");
  await again.click();
  await expect(turnAt(ask).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(alert).toHaveCount(1);
  // The Undo lands, and Save again saves.
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await expect(turnAt(ask, 1).getByRole("status").nth(1)).toHaveText(UNDONE, { timeout: 30_000 });
  await expect(again).not.toHaveAttribute("aria-busy", "true");
  await again.click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  await expect(alert).toHaveCount(0);
  await app.close();
});

test("a saved turn's Undo waits while another save runs, and does nothing when pressed", async () => {
  // The mirror of the offer waiting for an Undo: a newer save that commits first would make git refuse this Undo, which has one try. So
  // while any save runs (here the fake agent holds the newest turn's, 30 s), the older turn's Undo is busy, and a press on it takes nothing back.
  const { app } = await launchOn(await makeLibrary({ git: true }));
  await watchUndos(app);
  await savedIn(app);
  const ask = await answeredIn(app, "What are my goals?");
  const undo = undoOf(turnAt(ask, 1));
  await expect(undo).toBeVisible();
  await expect(undo).not.toHaveAttribute("aria-busy", "true");
  await app.evaluate(() => {
    process.env.FAKE_AGENT_DELAY_MS = "30000";
  });
  await saveOffer(ask).click();
  const stop = turnAt(ask).getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(undo).toHaveAttribute("aria-busy", "true");
  await snap(ask, "9-ask-undo-waiting");
  await undo.click();
  expect(await undoCalls(app)).toBe(0);
  await expect(turnAt(ask, 1).getByRole("status").nth(1)).toHaveText(SAVED);
  // Stop gives the save up. The Undo is free once the save has ended, and takes the first save back, once.
  await stop.click();
  await expect(saveRegion(ask)).toHaveText("Stopped. Your library hasn't changed.", { timeout: 30_000 });
  await app.evaluate(() => {
    delete process.env.FAKE_AGENT_DELAY_MS;
  });
  await expect(undo).not.toHaveAttribute("aria-busy", "true");
  await undo.click();
  await expect(turnAt(ask, 1).getByRole("status").nth(1)).toHaveText(UNDONE, { timeout: 30_000 });
  expect(await undoCalls(app)).toBe(1);
  await app.close();
});

/**
 * Starts a save of the answer to `question` from the Ask window's page, in the main process, as `saves[name]`, and doesn't wait for it. The
 * window can't send two saves at once, but one it gave up by closing goes on polling the library's lock as the next one begins: this is
 * that overlap.
 */
const startSave = (app: ElectronApplication, name: string, question: string, library: string) =>
  app.evaluate(
    ({ BrowserWindow }, [slot, asked, root]) => {
      type Saving = { saveAnswer(sender: unknown, question: string, answer: string, library: string): Promise<{ kind: string }> };
      const page = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/ask/"))!.webContents;
      const controller = (globalThis as unknown as { __avanzel: Saving }).__avanzel;
      const saves = ((globalThis as { saves?: Record<string, Promise<{ kind: string }>> }).saves ??= {});
      saves[slot] = controller.saveAnswer(page, asked, `Q: ${asked}`, root);
    },
    [name, question, library] as const,
  );

/** How the save `name` (`startSave`) ended: the kind of its result. */
const endOf = (app: ElectronApplication, name: string) =>
  app.evaluate(
    (_electron, slot) => (globalThis as unknown as { saves: Record<string, Promise<{ kind: string }>> }).saves[slot]!.then((result) => result.kind),
    name,
  );

test("a save that ends while another goes on leaves the other's mark, so ⌥⇧Z still does nothing meanwhile", async () => {
  const record = newRecord();
  const { app, library } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_RECORD: record });
  await call(app, "openAsk");
  await windowFor(app, "ask");
  // The first save takes 3 s and writes nothing. The fake reads its mode, writes its line in the record, and only then waits: once the
  // line is there, the first agent has the library, and the mode and the delay it began with are its own.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "noop";
    process.env.FAKE_AGENT_DELAY_MS = "3000";
  });
  await startSave(app, "first", "First?", library);
  await expect.poll(() => runsIn(record).some((run) => run.prompt.includes("First?")), { timeout: 30_000 }).toBe(true);
  // The second begins while the first goes on, waits behind it for the library, and hangs once it has it.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "slow-messy";
    delete process.env.FAKE_AGENT_DELAY_MS;
  });
  await startSave(app, "second", "Second?", library);
  expect(await endOf(app, "first")).toBe("unsaved");
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  // The first save has ended and the second goes on. The shortcut's press is not answered: a bar that says there is nothing to undo
  // would be wrong about a save that is about to commit.
  expect(await call(app, "pressShortcutForTests", "undo")).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  // Closing the window gives the second up.
  await call(app, "closeAsk");
  expect(await endOf(app, "second")).toBe("stopped");
  await app.close();
});

test("a save whose agent is gone or missing can be tried again, beside Open Settings", async () => {
  const library = await makeLibrary();
  // This Mac has no agent but the library's stand-in, which its settings name by path: the question is answered, and the save finds none.
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"))) });
  const ask = await answeredIn(app, "Summarize my ideas");
  const alert = ask.getByRole("alert");
  const useAgent = (harness: string) => saveSettings(library, { ...loadSettings(library), harness });
  // The library's agent is Claude Code, which is not installed here. The turn is the only place the answer can be saved, so Save again
  // stays, secondary, and the fix, Open Settings, is last and primary.
  useAgent("claude");
  await saveOffer(ask).click();
  await expect(alert.getByText("Claude Code isn't installed on this Mac any more.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(alert.getByText("Your library hasn't changed. Settings → Agents can choose another agent, or has its install command.", { exact: true })).toBeVisible();
  await expect(alert.getByRole("button")).toHaveText(["Save again", "Open Settings"]);
  await expect(alert.getByRole("button", { name: "Save again", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(alert.getByRole("button", { name: "Open Settings", exact: true })).toHaveAttribute("data-variant", "primary");
  await snap(ask, "9-ask-save-failed-gone");
  // The library chooses its agent by itself, and none is installed.
  useAgent("auto");
  await alert.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(alert.getByText("Avanzel needs an AI agent to save the answer.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(alert.getByRole("button")).toHaveText(["Save again", "Open Settings"]);
  await expect(alert.getByRole("button", { name: "Save again", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(alert.getByRole("button", { name: "Open Settings", exact: true })).toHaveAttribute("data-variant", "primary");
  // Mended in Settings: the library's agent is there again, and the same turn saves the answer.
  useAgent("fake");
  await alert.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(saveRegion(ask)).toHaveText(SAVED, { timeout: 60_000 });
  await expect(alert).toHaveCount(0);
  await app.close();
});

// It takes 10 s or more of real time: the save's line counts from SLOW_SECONDS, a constant of setup/copy.ts, so the test waits for it.
test("a save that takes 10 s counts its seconds beside Stop, in the flow of its turn", async () => {
  const library = await makeLibrary({ git: true });
  const app = await launch({ AVANZEL_LIBRARY: library });
  await answeredIn(app, "What are my goals?"); // an older turn, under the newest, which the counting line must not run over
  const ask = await answeredIn(app, "Summarize my ideas");
  // The save's agent waits 30 s. From 10 s on the line counts its seconds outside the status region, beside Stop.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_DELAY_MS = "30000";
  });
  await saveOffer(ask).click();
  const counting = turnAt(ask).getByText(/^Saving the answer as a page: \d+ s$/);
  await expect(counting).toBeVisible({ timeout: 20_000 });
  await expect(saveRegion(ask)).toHaveText("");
  await snap(ask, "9-ask-save-counting");
  const stop = turnAt(ask).getByRole("button", { name: "Stop", exact: true });
  const [line, stopped, older] = [await counting.boundingBox(), await stop.boundingBox(), await turnAt(ask, 1).boundingBox()];
  // The row takes its place in the turn: the older turn begins below the line and below Stop, which is beside the line.
  expect(older!.y).toBeGreaterThanOrEqual(line!.y + line!.height);
  expect(older!.y).toBeGreaterThanOrEqual(stopped!.y + stopped!.height);
  expect(stopped!.x).toBeGreaterThanOrEqual(line!.x + line!.width);
  await stop.click();
  await expect(saveRegion(ask)).toHaveText("Stopped. Your library hasn't changed.", { timeout: 30_000 });
  await app.close();
});

// ---------------------------------------------------------------- ⌥Space into Ask

// Record a thought's shortcut, pressed while the Ask window is the key window and the shelves hold a page, records a question: its words
// go to the field, after what is typed, and nowhere in the library. With no page there is nothing to ask about, and it records a thought,
// as the window's empty line invites. A test app is seldom the front app of a Mac in use, so the window answers whether it is the key
// window as the test says (`askIsKey`, capsule-helpers.ts); `pressShortcut` presses the shortcut as the keys do, and the menu's Record a
// thought is `toggleDictate`.

/** A library with one page on a shelf, which is what a question needs: with none, the shortcut records a thought, whoever is in front. */
async function libraryWithAPage(): Promise<string> {
  const library = await makeLibrary();
  filedInto(library, "ideas", "tulips", "Plant tulips in October", onDay(0));
  return library;
}

/**
 * From now on, notes the words main sends to the Ask window that is open now on `ask:heard` (`heardBy`): its `webContents.send`, wrapped as
 * `watchCapsule` wraps the capsule's. `send` is synchronous, so what a question's transcription sent is noted by the time it has ended.
 */
async function watchHeard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/ask/"));
    if (!win) throw new Error("There is no Ask window to watch.");
    const sent: string[] = [];
    (globalThis as { heardBy?: string[] }).heardBy = sent;
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "ask:heard") sent.push(String(args[0]));
      send(channel, ...args);
    };
  });
}

/** The words that `watchHeard`'s window was sent, oldest first. */
const heardBy = (app: ElectronApplication) => app.evaluate(() => (globalThis as { heardBy?: string[] }).heardBy ?? []);

/** The press that starts a recording doesn't wait for the microphone: the card listens a moment later, and a second press stops it. */
const untilListening = (app: ElectronApplication) => expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("listening");

/** A press of the shortcut, and the one that stops what it started: the recording's audio is then on its way to be heard. */
async function sayIt(app: ElectronApplication): Promise<void> {
  expect(await pressShortcut(app)).toBe(true);
  await untilListening(app);
  expect(await pressShortcut(app)).toBe(true);
}

/** Nothing of a question is kept: no capture, no recording, no count of kept recordings (`captures.json`), and nothing notified. */
async function expectNothingKept(app: ElectronApplication, library: string, userData: string): Promise<void> {
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(exists(userData, "captures.json")).toBe(false);
  expect(await call(app, "notificationsForTests")).toEqual([]);
}

test("⌥Space in the Ask window puts the spoken question in its field, after what is typed, and keeps nothing", async () => {
  const library = await libraryWithAPage();
  const { app, userData } = await launchOn(library, { AVANZEL_FAKE_TRANSCRIPT: "what about the tulips?" });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await askIsKey(app, true);
  await watchHeard(app);
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("Also,");
  // The person clicks elsewhere in the window: the field has lost the focus.
  await field.blur();
  // The first press records a question: the card listens, has no file mode to switch, and names the shortcut that finishes it.
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toMatchObject({ kind: "listening", mode: "dictate", fileMode: null, hint: "Alt+Space" });
  // The second stops it: the words go after what is typed, with one space, the card goes, and the field has the focus again.
  expect(await pressShortcut(app)).toBe(true);
  await expect(field).toHaveValue("Also, what about the tulips?", { timeout: 30_000 });
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect(field).toBeFocused();
  // The words were sent to this window, once: the watch sees words when they are sent, which the tests below rely on when it sees none.
  expect(await heardBy(app)).toEqual(["what about the tulips?"]);
  // Nothing was asked, and nothing is kept.
  await expect(ask.getByRole("heading")).toHaveCount(0);
  await expectNothingKept(app, library, userData);
  // Return asks it, as it asks what is typed.
  await field.press("Enter");
  await expect(ask.getByRole("heading", { name: "Also, what about the tulips?", exact: true })).toBeVisible();
  await expect(ask.getByText("Q: Also, what about the tulips?")).toBeVisible({ timeout: 60_000 });
  await app.close();
});

test("⌥Space records a thought while another app is in front of Ask, and the menu's Record a thought always does", async () => {
  const library = await libraryWithAPage(); // with a page, it is Ask being in front that makes the difference
  const { app } = await launchOn(library);
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  // Another app is in front: two presses file a thought, as they do with no Ask window, and the field is left alone.
  await askIsKey(app, false);
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toMatchObject({ kind: "listening", mode: "dictate", fileMode: "now" });
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => archived(library), { timeout: 30_000 }).toHaveLength(1);
  await expect(field).toHaveValue("");
  // Ask is in front: Record a thought in the menu still records a thought, whoever is in front.
  await askIsKey(app, true);
  await dictate(app);
  await expect.poll(() => archived(library), { timeout: 60_000 }).toHaveLength(2);
  await expect(field).toHaveValue("");
  // A thought that began so is stopped by the press, even with Ask in front, and filed: the press stops what is recording.
  await call(app, "toggleDictate");
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => archived(library), { timeout: 60_000 }).toHaveLength(3);
  await expect(field).toHaveValue("");
  await app.close();
});

test("a question that heard nothing, or whose words couldn't be made, says so, and keeps nothing", async () => {
  const library = await libraryWithAPage();
  const blip = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-audio-")), "blip.wav");
  writeWav(blip, new Float32Array(1600)); // 0.1 s: under 0.3 s there are no words
  const { app, userData, capsule } = await launchOn(library, { AVANZEL_FAKE_AUDIO: blip });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await askIsKey(app, true);
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  // Too short to hold speech: nothing was heard, as for a thought, and the card sends the person to Settings → Voice.
  await sayIt(app);
  await expectProblem(capsule, { title: "Nothing was heard.", lines: ["Is the right microphone selected? Nothing was saved."], fix: "Choose microphone" });
  await expect(field).toHaveValue("");
  await expectNothingKept(app, library, userData);
  // Speech the app hears, and a speech model that falls over once it has given its words: the card says the recording couldn't be turned
  // into words, that nothing was saved, and has no fix.
  await app.evaluate((_electron, file) => void (process.env.AVANZEL_FAKE_AUDIO = file), speechWav("hello"));
  await noteTranscriptions(app, { failWith: "The speech model fell over" });
  await sayIt(app);
  await expectProblem(capsule, { title: "The recording couldn't be turned into words.", lines: ["The speech model fell over. Nothing was saved."] });
  await expect(field).toHaveValue("");
  await expectNothingKept(app, library, userData);
  await app.close();
});

test("Stop on a question's slow transcription keeps nothing, and its words never come", async () => {
  const library = await libraryWithAPage();
  const { app, userData, capsule } = await launchOn(library, { AVANZEL_TRANSCRIBE_STOP_MS: "500", AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "4000" });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await askIsKey(app, true);
  await watchHeard(app);
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await noteTranscriptions(app);
  await sayIt(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "transcribing", slow: true });
  // Stop keeps nothing of a question: its card goes, with no Recorded card, and the recording is not moved into the inbox.
  await stopTranscribing(capsule);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  // The transcription itself can't be stopped, so it goes on and ends; what it made is dropped. Its words would be sent in the same
  // turn that ends it, so once it has ended, the window was sent none.
  await expect.poll(() => transcriptions(app), { timeout: 15_000 }).toMatchObject({ ended: 1 });
  expect(await heardBy(app)).toEqual([]);
  await expect(field).toHaveValue("");
  await expectNothingKept(app, library, userData);
  await app.close();
});

test("words that arrive after the Ask window closed are dropped quietly, even into a new one", async () => {
  const library = await libraryWithAPage();
  // Long enough that the new window is open and watched, as this test checks, while the words are still being made.
  const { app, userData } = await launchOn(library, { AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "5000" });
  await watchCapsule(app);
  await noteTranscriptions(app);
  await call(app, "openAsk");
  const first = await windowFor(app, "ask");
  await askIsKey(app, true);
  await sayIt(app);
  // The words are being made when the window they were said for is closed, and another opens: they are the first window's, which has gone.
  await call(app, "closeAsk");
  await expect.poll(() => first.isClosed()).toBe(true);
  await call(app, "openAsk");
  const second = await windowFor(app, "ask");
  expect(second).not.toBe(first);
  // The new window is watched while the words are still being made, which this checks: the words, if they were sent, would be sent to it.
  await watchHeard(app);
  expect(await transcriptions(app)).toMatchObject({ ended: 0 });
  await expect.poll(() => transcriptions(app), { timeout: 15_000 }).toMatchObject({ ended: 1 });
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden");
  // Nothing was sent to the new window (its transcription has ended, and would have sent them in the same turn), no card said anything
  // went wrong, its field is empty, and nothing is kept or notified.
  expect(await heardBy(app)).toEqual([]);
  expect(await sentToCapsule(app)).not.toContain("error");
  await expect(second.getByRole("textbox", { name: "Ask your library" })).toHaveValue("");
  await expectNothingKept(app, library, userData);
  await app.close();
});

test("Ask's hint names the dictate shortcut, follows a change, and is gone while the shortcut isn't registered", async () => {
  const { app } = await launchOn(await libraryWithAPage()); // with no page, the window shows no hint
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const hint = ask.getByText("Press ⌥Space to say your question.", { exact: true });
  await expect(hint).toBeVisible();
  await expect(hint.locator("kbd")).toHaveText("⌥Space");
  await snap(ask, "9-ask-hint");
  // The shortcut is changed in Settings: the window reads it again when it has the focus again.
  await call(app, "setApp", { shortcuts: { ...(await settingsSnap(app)).app.shortcuts, dictate: "Control+Alt+K" } });
  await ask.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(ask.getByText("Press ⌃⌥K to say your question.", { exact: true })).toBeVisible();
  await expect(ask.locator("kbd")).toHaveText("⌃⌥K");
  await app.close();
  // Another app holds ⌥Space: nothing is registered, so there is no key to name. The window shows no hint once it has read: its shelves
  // hold a page, so the question suggested about it, which the same read brings, is the signal that it has.
  const { app: taken } = await launchOn(await libraryWithAPage(), { AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  expect(await call(taken, "askShortcut")).toBeNull();
  await call(taken, "openAsk");
  const bare = await windowFor(taken, "ask");
  await expect(bare.getByRole("button", { name: "Ask this", exact: true })).toBeVisible();
  await expect(bare.locator("kbd")).toHaveCount(0);
  await taken.close();
});

test("an empty library shows no hint, and ⌥Space with Ask in front records a thought, as the empty line invites", async () => {
  // With no page on any shelf there is nothing to ask about: the line says to say something first, and the key it would name files
  // nothing. The press records a thought, as with another app in front.
  const library = await makeLibrary();
  const { app } = await launchOn(library);
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await askIsKey(app, true);
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  // The empty line is drawn by the same read that would bring the hint: once it shows, the hint's absence is what that read found.
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(ask.locator("kbd")).toHaveCount(0);
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toMatchObject({ kind: "listening", mode: "dictate", fileMode: "now" });
  expect(await pressShortcut(app)).toBe(true);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => archived(library), { timeout: 30_000 }).toHaveLength(1);
  await expect(field).toHaveValue("");
  await app.close();
});

/**
 * From now on, counts the times Quick is asked to open (`quickOpened`): the controller's own `openQuick`, wrapped. Quick hides itself
 * when it loses the key, so whether it is on screen later says nothing of whether it was opened.
 */
async function watchQuick(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { openQuick(): void } }).__avanzel;
    const open = controller.openQuick.bind(controller);
    const opened = { count: 0 };
    Object.assign(globalThis, { quickOpened: opened });
    controller.openQuick = () => {
      opened.count++;
      open();
    };
  });
}

const quickOpened = (app: ElectronApplication) => app.evaluate(() => (globalThis as { quickOpened?: { count: number } }).quickOpened?.count ?? 0);

/**
 * `library`, opened by an app whose speech model is still downloading (a stand-in hub holds it), with the Ask window open and the key
 * window, and Quick watched (`watchQuick`): a press of the shortcut then brings the card of the model, whose Type instead is the next press.
 */
async function askWhileTheModelDownloads(library: string) {
  const hub = await fakeModelHub("stall");
  // The card stays up while the test reads it; it hides by itself after 8 s otherwise.
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache(), AVANZEL_PREPARING_SHOW_MS: "120000" });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(async () => (await settingsSnap(app)).model.kind).toBe("downloading");
  const capsule = await windowFor(app, "capsule");
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await askIsKey(app, true);
  await watchQuick(app);
  return { app, ask, capsule };
}

test("Type instead, on the card a press brings while the speech model downloads, stays in Ask and opens no Quick", async () => {
  // The hint shows while the model is on its way, so a press in Ask reaches its card, whose Type instead would open Quick: in Ask the
  // field is already in front of the person, with what they typed in it.
  const { app, ask, capsule } = await askWhileTheModelDownloads(await libraryWithAPage());
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("Also,");
  await expect(ask.locator("kbd")).toHaveText("⌥Space"); // the window has read: it names the key the person presses
  expect(await pressShortcut(app)).toBe(true);
  await expect(capsule.getByText("The speech model is still downloading.", { exact: true })).toBeVisible();
  // Type instead: the card goes, and the press has reached main by the time the round trip sent behind it is answered.
  await capsule.getByRole("button", { name: "Type instead", exact: true }).click();
  await capsule.evaluate(() => window.avanzel.settings.get());
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await quickOpened(app)).toBe(0);
  await expect(field).toHaveValue("Also,");
  await app.close();
});

test("Type instead, on the card an empty library's press brings, opens Quick: that press was a thought's", async () => {
  // With no page the press records a thought, as the window's empty line invites, so the person who types instead is sent to Type a
  // thought, where it is filed. Ask's field only asks.
  const { app, ask, capsule } = await askWhileTheModelDownloads(await makeLibrary());
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  expect(await pressShortcut(app)).toBe(true);
  await expect(capsule.getByText("The speech model is still downloading.", { exact: true })).toBeVisible();
  await capsule.getByRole("button", { name: "Type instead", exact: true }).click();
  await expect.poll(() => quickOpened(app)).toBe(1);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("the fix of a thought that couldn't be saved opens Type a thought, though Ask is in front", async () => {
  // Only the model's card sends the person to Ask's field: the card of a thought that couldn't be saved holds words in Type a thought,
  // and its one fix opens them there, whichever window is in front.
  const library = await libraryWithAPage();
  const { app, capsule } = await launchOn(library);
  await call(app, "openAsk");
  await windowFor(app, "ask");
  await askIsKey(app, true);
  await watchQuick(app);
  await call(app, "setCapsule", { kind: "error", message: "That thought couldn't be saved.", detail: "Your words are still in “Type a thought”.", action: "type-a-thought", actionLabel: "Type a thought" });
  await capsule.getByRole("button", { name: "Type a thought", exact: true }).click();
  await expect.poll(() => quickOpened(app)).toBe(1);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});
