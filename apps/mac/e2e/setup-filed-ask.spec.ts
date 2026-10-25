// The setup window's Filed and Ask steps: the first filing's stamp, proof and Undo, and a question about the new page.
// Every test launches as a first run (firstRun) whose stand-in Claude Code files (filingClaude).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, Vault } from "../../../packages/engine/src/index.ts";
import {
  call,
  filesUnder,
  filingClaude,
  firstRun,
  gitOut,
  launch,
  openedWith,
  recentlyFiled,
  snap,
  stubOpening,
  throughFound,
  typeFirstThought,
  windowFor,
} from "./helpers.ts";
import { callsTo, closeSetup, FILED, filedFirstThought, inbox, setupSnap, sideways, tabs, zel } from "./setup-helpers.ts";

// The first filing's end: the FILED stamp on its card, its pages on the shelves' tabs and in the receipt, and Undo (or
// ⌘Z), which puts everything back as it was. Each test types its thought, which the stand-in Claude Code files as an
// idea.

/**
 * The step's proof, under the receipt: the words are kept in raw/, and, while the filing can be taken back, one more
 * sentence says a snapshot is saved and how to put everything back. That is the only place the step says how to undo.
 */
const KEPT = "Kept your exact words in raw/.";
const SAVED = "Saved a snapshot. Press ⌘Z or Undo to put everything back.";

/** The commits that undid a filing, in `library`'s history. */
const undoCommits = (library: string) => gitOut(library, "log", "--format=%s").split("\n").filter((subject) => subject.startsWith("avanzel: undo "));

test("a filed thought shows its stamp, its page and how to undo it, and Undo puts everything back", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  const [page = ""] = filesUnder(library, "ideas");
  // The card is stamped FILED, with the day, and the page went in behind the Ideas tab.
  await expect(setup.getByRole("img", { name: /^Filed, / })).toBeVisible();
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas1", "Problems", "Memories", "People", "Topics"]);
  // The step, in order: the heading, Zel's praise, what the filing wrote, the receipt, the proof (which says how to undo it,
  // once) and its buttons.
  await expect(setup.getByText("Your first thought has a home.", { exact: true })).toBeVisible();
  await expect(setup.getByText("1 new page, all plain Markdown in ~/Avanzel.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("listitem")).toHaveText(["Plant tulips in OctoberIdeas"]);
  await expect(setup.getByText(KEPT, { exact: true })).toBeVisible(); // the agent left the words be: the line is there all the same
  await expect(setup.getByText(SAVED, { exact: true })).toBeVisible();
  // The whole step reads: the receipt's row, the proof's two lines, Undo, then Open the page. No ⌘Z line comes before the receipt.
  await expect(setup.getByRole("main")).toHaveText(
    /^All filed\. .+Your first thought has a home\.1 new page, all plain Markdown in ~\/Avanzel\.Plant tulips in OctoberIdeasKept your exact words in raw\/\.Saved a snapshot\. Press ⌘Z or Undo to put everything back\.UndoOpen the page$/,
  );
  // Continue is the one primary, and there is no Back.
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(await recentlyFiled(app)).toEqual(["Plant tulips in October"]);
  // Open the page opens the new page.
  await stubOpening(app);
  await setup.getByRole("button", { name: "Open the page" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", page)));
  // Undo puts everything back: the words in the inbox, no page, and nothing in the menu's Recently filed.
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Everything is back as it was, and your words are in the inbox.", { exact: true })).toBeVisible();
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await recentlyFiled(app)).toEqual([]);
  await expect(setup.getByRole("img", { name: /^Filed, / })).toHaveCount(0);
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas", "Problems", "Memories", "People", "Topics"]);
  // File it again is the moment's one primary (Ruling P24), and has the focus Undo had; Continue steps back.
  const again = setup.getByRole("button", { name: "File it again" });
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["File it again"]);
  await expect(again).toBeFocused();
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await again.click();
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  await app.close();
});

test("⌘Z undoes it too", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // Pressed twice in a row, it undoes once: the second press comes while the first is under way.
  await setup.keyboard.press("Meta+z");
  await setup.keyboard.press("Meta+z");
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await call(app, "idleForTests");
  expect((await setupSnap(app)).filing?.kind).toBe("undone");
  expect(undoCommits(library)).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  // On a keyboard without Latin letters, ⌘ and the key in Z's place is ⌘Z too, as macOS reads it.
  await setup.getByRole("button", { name: "File it again" }).click();
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await setup.evaluate(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "я", code: "KeyZ", metaKey: true, bubbles: true, cancelable: true })),
  );
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  expect(undoCommits(library)).toHaveLength(2);
  await app.close();
});

test("the first filing ends with its proof", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  // The words are kept in raw/, and setup's library has git, so the filing is its own commit and can be taken back.
  await expect(setup.getByText(KEPT, { exact: true })).toBeVisible();
  await expect(setup.getByText(SAVED, { exact: true })).toBeVisible();
  // The snapshot's line is the one place that says how to undo it: no other line has a word of it.
  await expect(setup.getByText(/put everything back/)).toHaveCount(1);
  await expect(setup.getByText(/⌘Z/)).toHaveCount(1);
  await app.close();
});

test("a filing that changed the words says they are kept", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, FAKE_AGENT_MODE: "tamper" });
  await expect(setup.getByText(KEPT, { exact: true })).toBeVisible();
  await app.close();
});

test("a filing that wrote no page says its agent noted it in the log, and Continue goes to the end", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, FAKE_AGENT_MODE: "logonly" });
  await expect(setup.getByText("Claude Code noted it in the log.", { exact: true })).toBeVisible();
  // No line claims a page, no tab counts one, and nothing offers to open one (Review Focus 5).
  await expect(setup.getByText("Your first thought has a home.")).toHaveCount(0);
  await expect(setup.getByText(/plain Markdown|in other folders/)).toHaveCount(0);
  await expect(setup.getByRole("listitem")).toHaveCount(0);
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas", "Problems", "Memories", "People", "Topics"]);
  await expect(setup.getByRole("button", { name: /^Open / })).toHaveCount(0);
  // It is filed all the same, as its own commit: the stamp, the proof, and Undo.
  await expect(setup.getByRole("img", { name: /^Filed, / })).toBeVisible();
  await expect(setup.getByText(KEPT, { exact: true })).toBeVisible();
  await expect(setup.getByText(SAVED, { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("an Undo that git refuses says so, and Undo goes away", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // Meanwhile the new page is edited by hand, and the edit committed: undoing the filing would take the edit with it.
  const [page = ""] = filesUnder(library, "ideas");
  const file = path.join(library, "ideas", page);
  writeFileSync(file, "# Tulips, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("This one can't be undone automatically.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Usually a later change touched the same lines. The library's history keeps both versions.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button")).toHaveCount(0); // nothing to fix: Continue is the way on
  // Nothing offers to undo it any more, and the filing stays as it is, the edit by hand included.
  await expect(setup.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await expect(setup.getByText(/⌘Z|put everything back/)).toHaveCount(0);
  await expect(setup.getByText(/Saved a snapshot/)).toHaveCount(0); // no snapshot can be undone now, but the words are still kept
  await expect(setup.getByText(KEPT, { exact: true })).toBeVisible();
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible();
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  expect(readFileSync(file, "utf8")).toBe("# Tulips, by hand\n");
  expect(inbox(library)).toEqual([]);
  expect(undoCommits(library)).toEqual([]);
  await app.close();
});

test("Continue goes to Ask after a filing, and to the end after an undo", async () => {
  // Those steps draw nothing yet (Tasks 9 and 10): the step the session is on says where Continue went.
  const filed = await filedFirstThought(firstRun({ claude: filingClaude() }).env);
  await filed.setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(filed.app, "setupStepForTests")).toBe("ask");
  await filed.app.close();
  const second = firstRun({ claude: filingClaude() });
  const undone = await filedFirstThought(second.env);
  // While the undo waits for the library (another run has it: this test holds its lock), Undo is busy and Continue
  // waits, since the pages it would go on with are on their way out.
  let letGo = () => {};
  const held = new Vault(path.join(second.home, "Avanzel")).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await undone.setup.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(undone.setup.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-busy", "true");
    await expect(undone.setup.getByRole("button", { name: "Continue" })).toBeDisabled();
  } finally {
    letGo();
    await held;
  }
  await expect(undone.setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await undone.setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(undone.app, "setupStepForTests")).toBe("done");
  await undone.app.close();
});

test("in a library Obsidian has opened as a vault, the new page opens in Obsidian", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Obsidian is installed (a stand-in answers for its links), and has opened the library: it has an .obsidian folder.
  await app.evaluate((electron) => {
    electron.app.getApplicationNameForProtocol = () => "Obsidian";
  });
  mkdirSync(path.join(library, ".obsidian"));
  await stubOpening(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("button", { name: "Open the page" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Open in Obsidian" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  const [url = ""] = await openedWith(app);
  const [page = ""] = filesUnder(library, "ideas");
  expect(url).toMatch(/^obsidian:\/\/open\?path=/);
  expect(realpathSync(decodeURIComponent(url.slice("obsidian://open?path=".length)))).toBe(realpathSync(path.join(library, "ideas", page)));
  await app.close();
});

// Ask me about it: a question about the new pages, answered from the library only, with the pages the answer used. The
// stand-in Claude Code runs the engine's fake agent, which answers "Q: <the question>" and then lists the library's
// pages; a [[link]] in the question comes back in its answer, as an agent cites a page.

/** The question setup suggests once "Plant tulips in October" is filed as an idea. */
const SUGGESTED = "What did I say about “Plant tulips in October”?";

/** A first run launched with `env`, where "Plant tulips in October" is typed and filed, then Continue pressed: on Ask. */
async function onAsk(env: Record<string, string>): Promise<{ app: ElectronApplication; setup: Page }> {
  const { app, setup } = await filedFirstThought(env);
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  return { app, setup };
}

/** A `claude` that files as filingClaude's does, but fails every question: it prints `line` on stderr and exits 1. */
const failingAnswers = (line: string) => `case "$2" in "Avanzel task: ask"*) echo '${line}' >&2; exit 1;; esac\n${filingClaude()}`;

/** How many questions the stand-in Claude Code has been asked. */
const questionsAsked = async (app: ElectronApplication) => (await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p Avanzel task: ask")).length;

/** The button that asks the suggested `question`, which the card shows: Ask this, in a group named for its question. */
const askThis = (setup: Page, question = SUGGESTED) => setup.getByRole("group", { name: question }).getByRole("button", { name: "Ask this" });

test("Ask suggests a question about the new page and answers it", async () => {
  const { app, setup } = await filedFirstThought(firstRun({ claude: filingClaude() }).env);
  // Only the Ask step asks: a question sent while Filing shows asks nothing.
  await call(app, "askInSetup", SUGGESTED);
  expect((await setupSnap(app)).answer).toBeNull();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  await expect(setup.getByText("I answer from your library only, and show you the pages I used.", { exact: true })).toBeVisible();
  // The suggestion is on the stage's card, and in words beside the secondary Ask this, which asks it, its title quoted.
  // Before an answer, Skip is the quiet way on, nothing is primary, and there is no Back. Zel looks up at the card.
  await expect(setup.getByRole("article")).toContainText(SUGGESTED);
  const suggestion = askThis(setup);
  await expect(suggestion).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("group", { name: SUGGESTED }).getByText(SUGGESTED, { exact: true })).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-look", "up");
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveAttribute("data-variant", "quiet");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await field.fill("And the bulbs");
  await suggestion.click();
  // The suggestion goes while it is answered, and the focus it had goes to Ask your library, not to nowhere. What the
  // person was typing there stays.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("And the bulbs");
  await expect(setup.getByText(`Q: ${SUGGESTED}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  // Answered: the question over its answer, Zel at rest, and Continue the one primary, where Skip was.
  await expect(setup.getByRole("main").getByText(SUGGESTED, { exact: true })).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("an answer's links become the pages it used", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk(env);
  const library = path.join(home, "Avanzel");
  const name = (filesUnder(library, "ideas")[0] ?? "").replace(/\.md$/, "");
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await expect(field).toHaveAttribute("placeholder", "Ask your library…");
  await field.fill(`What is in [[${name}]]?`);
  await field.press("Enter");
  await expect(field).toHaveValue(""); // asked: the box is ready for the next one
  await expect(setup.getByText("Pages I used:", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Ideas", { exact: true })).toBeVisible(); // the page's shelf
  const source = setup.getByRole("button", { name: "Plant tulips in October", exact: true });
  await expect(source).toHaveAttribute("data-variant", "link");
  // In the answer the link reads as the words it gives; its page's title opens it.
  await expect(setup.getByText(`Q: What is in ${name}?`, { exact: true })).toBeVisible();
  await stubOpening(app);
  await source.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", `${name}.md`)));
  await app.close();
});

test("a slow answer shows the time and can be skipped", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk({ ...env, FAKE_AGENT_DELAY_MS: "20000", FAKE_AGENT_DELAY_TASK: "ask" });
  // Another run has the library at first (this test holds its lock): the question says it waits, then looks.
  let letGo = () => {};
  let released = 0;
  const held = new Vault(path.join(home, "Avanzel")).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await askThis(setup).click();
    await expect(setup.getByText("Waiting for the filing in progress to finish…", { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    released = Date.now();
    letGo();
    await held;
  }
  await expect(setup.getByText(/^Looking through your library: \d+ s$/)).toBeVisible({ timeout: 30_000 });
  // Its seconds count from when the agent starts to look, not from the wait.
  const asking = (await setupSnap(app)).answer;
  expect(asking?.kind === "asking" && !asking.waiting && asking.startedAt >= released).toBe(true);
  await expect(setup.getByText(/^Looking through your library: [1-9]\d* s$/)).toBeVisible({ timeout: 10_000 }); // it counts
  await expect(setup.getByRole("article")).toContainText(SUGGESTED); // the question asked, on the card
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  // Its agent stops, so nothing is left running, and what the stopped run said is dropped.
  await expect.poll(() => call(app, "busy"), { timeout: 10_000 }).toBe(false);
  expect((await setupSnap(app)).answer).toBeNull();
  await app.close();
});

test("an answer that fails says why, and the suggestion asks again", async () => {
  const { app, setup } = await onAsk(firstRun({ claude: failingAnswers("Error: boom") }).env);
  await askThis(setup).click();
  const notice = setup.getByRole("alert");
  // What happened, that the library hasn't changed, and what the agent said last, as a sentence.
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Your library hasn't changed. Boom.", { exact: true })).toBeVisible();
  // There is no answer: Skip stays the way on, and Continue doesn't show. Zel is worried beside the failure.
  await expect(setup.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  expect(await questionsAsked(app)).toBe(1);
  await askThis(setup).click();
  await expect.poll(() => questionsAsked(app), { timeout: 30_000 }).toBe(2);
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // A question of the person's own that fails is the one on the card: Ask this, which would ask another, isn't offered.
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await field.fill("Where are the bulbs?");
  await field.press("Enter");
  await expect.poll(() => questionsAsked(app), { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await setupSnap(app)).answer, { timeout: 30_000 }).toMatchObject({ kind: "failed", question: "Where are the bulbs?" });
  await expect(setup.getByRole("article")).toContainText("Where are the bulbs?");
  await expect(setup.getByRole("button", { name: "Ask this" })).toHaveCount(0);
  await app.close();
});

test("an answer that hits a usage limit says so, and that the library hasn't changed", async () => {
  const { app, setup } = await onAsk(firstRun({ claude: failingAnswers("Error: usage limit reached") }).env);
  await askThis(setup).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code has hit its usage limit.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // The agent named no reset, so none is said.
  await expect(notice.getByText("Your library hasn't changed.", { exact: true })).toBeVisible();
  // The Notice offers the Ask window's one fix, Ask again, the moment's primary; the step keeps its own: the suggestion asks
  // again too, and Skip is the way on.
  await expect(notice.getByRole("button")).toHaveText(["Ask again"]);
  await expect(notice.getByRole("button", { name: "Ask again", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Ask again"]);
  await expect(askThis(setup)).toBeVisible();
  await expect(setup.getByRole("button", { name: "Skip" })).toBeVisible();
  expect((await setupSnap(app)).answer).toMatchObject({ kind: "failed", changedFiles: 0, failure: { kind: "limit", agent: "Claude Code", resetsAt: null } });
  await app.close();
});

test("an answer that fails for a sign-in names what to run, as code", async () => {
  const { app, setup } = await onAsk(firstRun({ claude: failingAnswers("Error: not logged in") }).env);
  await askThis(setup).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText("Your library hasn't changed. Run claude once in Terminal and sign in, then ask again.");
  await expect(notice.locator("code")).toHaveText("claude");
  // Open Terminal is the fix, so it is the moment's one primary and comes last; Ask again, which would only fail again until the
  // person has signed in, is secondary.
  await expect(notice.getByRole("button")).toHaveText(["Ask again", "Open Terminal"]);
  await expect(notice.getByRole("button", { name: "Open Terminal", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(notice.getByRole("button", { name: "Ask again", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Open Terminal"]);
  await snap(setup, "setup-ask-failed-signin");
  expect(await call(app, "openedForTests")).toEqual([]);
  await notice.getByRole("button", { name: "Open Terminal", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]); // Terminal itself stays shut under test
  await app.close();
});

test("Ask again asks the question that failed once more, whoever wrote it, and leaves what is typed be", async () => {
  const { app, setup } = await onAsk(firstRun({ claude: failingAnswers("Error: boom") }).env);
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  // A question of the person's own: Return asks it and empties the box, so only the Notice's button can ask it again.
  await field.fill("Where are the bulbs?");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByRole("button")).toHaveText(["Ask again"]);
  await expect(notice.getByRole("button", { name: "Ask again", exact: true })).toHaveAttribute("data-variant", "primary");
  expect(await questionsAsked(app)).toBe(1);
  // What the person types meanwhile stays in the box, and the focus goes there as the question is asked again.
  await field.fill("And the pots");
  await notice.getByRole("button", { name: "Ask again", exact: true }).click();
  await expect.poll(() => questionsAsked(app), { timeout: 30_000 }).toBe(2);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("And the pots");
  await expect.poll(async () => (await setupSnap(app)).answer, { timeout: 30_000 }).toMatchObject({ kind: "failed", question: "Where are the bulbs?" });
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("article")).toContainText("Where are the bulbs?");
  await app.close();
});

test("when the library's agent has gone, a failed question offers Open Settings, the moment's primary, and not Ask again", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk(env);
  rmSync(path.join(env.PATH!.split(":")[0]!, "claude")); // Claude Code, the library's agent, is uninstalled after the filing
  await askThis(setup).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't installed on this Mac any more.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    notice.getByText("Your library hasn't changed. Settings → Agents can choose another agent, or has its install command.", { exact: true }),
  ).toBeVisible();
  // Asking again would only fail again until another agent is chosen: the fix is Settings → Agents.
  await expect(notice.getByRole("button")).toHaveText(["Open Settings"]);
  await expect(notice.getByRole("button", { name: "Open Settings", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Open Settings"]);
  await notice.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Agents", exact: true })).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("an Undo that lands once Ask shows takes the suggestion with it, and says so", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // The undo waits for the library at first (this test holds its lock), so Ask shows while it runs.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    // Undo, then Continue before the window hears the undo has begun: both clicks in one turn of the page's event loop.
    await setup.evaluate(() => {
      const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name);
      button("Undo")?.click();
      button("Continue")?.click();
    });
    await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
    await expect.poll(() => call(app, "setupStepForTests")).toBe("ask");
    // While the undo runs, the page is on its way out: nothing suggests a question about it.
    await expect.poll(async () => (await setupSnap(app)).filing).toMatchObject({ kind: "filed", undoing: true });
    await expect(setup.getByRole("button", { name: "Ask this" })).toHaveCount(0);
  } finally {
    letGo();
    await held;
  }
  await expect.poll(async () => (await setupSnap(app)).filing?.kind, { timeout: 30_000 }).toBe("undone");
  // The page has gone, so nothing asks about it, on the card or as a button; the step says what happened instead.
  await expect(setup.getByText("Everything is back as it was, and your words are in the inbox.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Ask this" })).toHaveCount(0);
  await expect(setup.getByRole("article")).not.toContainText(SUGGESTED);
  expect((await setupSnap(app)).suggestion).toBeNull();
  expect(inbox(library)).toHaveLength(1);
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("closing setup while a question is answered stops its agent", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk({ ...env, FAKE_AGENT_DELAY_MS: "20000", FAKE_AGENT_DELAY_TASK: "ask" });
  await askThis(setup).click();
  await expect(setup.getByText(/^Looking through your library: \d+ s$/)).toBeVisible({ timeout: 30_000 });
  await closeSetup(app);
  await expect.poll(() => call(app, "busy"), { timeout: 10_000 }).toBe(false);
  await app.close();
});

test("a long title fits Ask: the card holds the question, and a long source title is shortened", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // A thought of 64 characters, which the stand-in files as an idea of that title.
  const words = "Launch plan for the spring campaign with Mark and the whole team";
  await typeFirstThought(setup, words);
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  // The card holds the whole suggested question, Ask this asks it, and nothing runs past the step's edge.
  const question = `What did I say about “${words}”?`;
  await expect(setup.getByRole("article")).toContainText(question);
  await expect(askThis(setup, question)).toBeVisible();
  expect(await sideways(setup)).toBe(0);
  // An answer that links the page: its link shows the title's first 39 characters and "…", and opens the page.
  const name = (filesUnder(library, "ideas")[0] ?? "").replace(/\.md$/, "");
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await field.fill(`What is in [[${name}]]?`);
  await field.press("Enter");
  const source = setup.getByRole("button", { name: "Launch plan for the spring campaign wit…", exact: true });
  await expect(source).toBeVisible({ timeout: 30_000 });
  expect(await sideways(setup)).toBe(0);
  // Its shelf keeps its whole name: the link goes under it rather than squeezing it to "Id…".
  expect(await setup.getByText("Ideas", { exact: true }).evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await stubOpening(app);
  await source.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", `${name}.md`)));
  await app.close();
});
