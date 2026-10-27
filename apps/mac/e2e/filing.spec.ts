// Filing with the agent: Edit or Stop while it runs, quitting while it runs, and a run that leaves edits behind. The cards a failed filing
// ends in are capsule-problems.spec.ts's, and the result cards are capsule-results.spec.ts's.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, git, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import {
  agentStubs,
  alive,
  answerAs,
  call,
  capsuleKind,
  capturesKept,
  exists,
  filesUnder,
  filingClaude,
  gitOut,
  launch,
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  read,
  recentlyFiled,
  shown,
  snap,
  speechWav,
  stubPicker,
  windowFor,
} from "./helpers.ts";
import {
  archived,
  cardNote,
  claudeLibrary,
  dictate,
  expectProblem,
  expectStoppedFiling,
  filingSends,
  inbox,
  launchOn,
  type Left,
  namesOf,
  notified,
  reachedUndo,
  sleep,
  undoCalls,
  undone,
  watchFilingStates,
  watchUndos,
  type Wrappable,
} from "./capsule-helpers.ts";
import { zel } from "./setup-helpers.ts";

/** What each capture waiting in the inbox says. */
const inboxWords = (root: string) => inbox(root).map((name) => read(root, `inbox/${name}`));
/** Markdown files in the library (git's own folder aside) that contain `words`. */
const mentioning = (root: string, words: string) =>
  filesUnder(root, ".").filter((rel) => rel.endsWith(".md") && read(root, rel).includes(words));

/** Dictation filed by a fake agent whose first run gets halfway (goals/half.md) and then hangs. `prepare` sets the library up first. */
async function dictateToStallingAgent(transcript: string, extra: Record<string, string> = {}, prepare: (library: string) => void = () => {}) {
  const library = await makeLibrary({ git: true });
  prepare(library);
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: transcript,
    FAKE_AGENT_MODE: "slow-once",
    FAKE_AGENT_ONCE: onceMarker(),
    ...extra,
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true); // the agent is mid-run
  return { library, app, capsule };
}

/** Edit, then type `words`: the editor sends them on their own message, so wait until the app has them. */
async function editTo(app: ElectronApplication, capsule: Page, words: string): Promise<void> {
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  await capsule.getByRole("textbox").fill(words);
  await expect.poll(() => call(app, "draftForTests")).toBe(words);
}

/** Quits the app and waits until it has gone. `during` acts once the quit has begun, while it waits. */
async function quit(app: ElectronApplication, during?: () => Promise<void>): Promise<void> {
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  closed.catch(() => undefined); // reported by the await below; a `during` that fails first must not leave it unheard
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await during?.();
  await closed;
}

/** How long the app's quit wait is (controller.ts, QUIT_WAIT_MS) unless a test shortens it with AVANZEL_QUIT_WAIT_MS. */
const REAL_QUIT_WAIT_MS = 10_000;
/** For a test that needs the quit wait only to run out, not to take 10 s doing it. */
const SHORT_QUIT_WAIT = { AVANZEL_QUIT_WAIT_MS: "2000" };

/**
 * Dictates "misheard words" while another process holds the library (this test, standing in for a
 * second Avanzel): the filing waits for it, and so does all that queues behind it, past the end of
 * quitting's wait. `meanwhile` acts in the capsule, then Avanzel quits. The library is let go only
 * after the app has gone, so the app can leave only once the quit wait has run out, and the quit must
 * have taken all of it: REAL_QUIT_WAIT_MS, or the AVANZEL_QUIT_WAIT_MS in `env` (more variables for
 * the app to launch with). `during` acts once the quit is waiting, as a person can: a second quit, say. Returns what the
 * inbox holds.
 */
async function quitWhileHeld(
  meanwhile: (app: ElectronApplication, capsule: Page) => Promise<void>,
  env: Record<string, string> = {},
  during?: (app: ElectronApplication) => Promise<void>,
): Promise<string[]> {
  const library = await makeLibrary();
  const waitMs = Number(env.AVANZEL_QUIT_WAIT_MS ?? REAL_QUIT_WAIT_MS);
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "misheard words", ...env });
    const capsule = await windowFor(app, "capsule");
    await call(app, "toggleDictate");
    await call(app, "toggleDictate");
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
    await meanwhile(app, capsule);
    const quitting = Date.now();
    await quit(app, during && (() => during(app)));
    // The library is still held, so only the end of the wait let the app go; 100 ms is slack for a timer's rounding.
    expect(Date.now() - quitting, "the app left before its quit wait ran out").toBeGreaterThanOrEqual(waitMs - 100);
  } finally {
    letGo();
    await held;
  }
  return inboxWords(library);
}

/** Edit, type `words` and File: the refiled note waits behind the held library. */
async function fileEdit(app: ElectronApplication, capsule: Page, words: string): Promise<void> {
  await editTo(app, capsule, words);
  await capsule.getByRole("button", { name: "File" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("filing");
}

test("Edit stops the agent mid-run, takes back what it did, and files the corrected words", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { library, app, capsule } = await dictateToStallingAgent("Remember to email Mark the hygienic plan", { AVANZEL_USER_DATA: userData });
  expect(capturesKept(userData)).toBe(1); // the dictation
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  const box = capsule.getByRole("textbox");
  await box.fill("Remember to email Mark the agentic plan");
  await snap(capsule, "4-editing");
  await box.press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // The corrected words are filed, under the same id (no "-2": the misheard capture went first) ...
  const [capture, ...others] = archived(library);
  expect(others).toEqual([]);
  expect(path.basename(capture!)).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-remember-to-email-mark-the\.md$/);
  const text = readFileSync(capture!, "utf8");
  expect(text).toContain("Remember to email Mark the agentic plan");
  expect(text).toMatch(/\naudio: raw\/audio\/.+\.wav\n/);
  expect(text).toContain("\ntranscriber: fake\n");
  // ... the misheard ones are not, and nothing the stopped run wrote remains.
  expect(mentioning(library, "hygienic")).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(read(library, "index.md")).not.toContain("left by a stalled run");
  expect(inbox(library)).toEqual([]);
  // The corrected words are the dictation written again, not a second recording: the count is what it was before Edit.
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("cancelling an Edit takes back what the stopped run did and files the words as they were", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  await capsule.getByRole("textbox").press("Escape");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [capture, ...others] = archived(library);
  expect(others).toEqual([]);
  expect(path.basename(capture!)).toMatch(/-plant-tulips-in-october\.md$/);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(read(library, "index.md")).not.toContain("left by a stalled run");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("the editor is a card of paper with the words in a text area, and Cancel and File under it", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  await snap(capsule, "4-editing-card");
  // The words are edited on the card, whose label says what the card is for; the box is named for VoiceOver though no label shows.
  const card = capsule.getByRole("article");
  await expect(card.getByText("Edit before filing", { exact: true })).toBeVisible();
  const words = card.getByRole("textbox", { name: "Your words" });
  await expect(words).toHaveValue("Plant tulips in October");
  await expect(words).toBeFocused();
  // The field is where the words are written, so the card has no ruling under it: its lines would show through the field and drift
  // across the words, which don't stand on them.
  await expect(card).not.toHaveAttribute("data-ruled");
  // Cancel is quiet and File is the moment's one primary. There is no bar, so no live region and no Hide.
  await expect(card.getByRole("button")).toHaveText(["Cancel", "File"]);
  await expect(card.getByRole("button", { name: "Cancel", exact: true })).toHaveAttribute("data-variant", "quiet");
  await expect(card.getByRole("button", { name: "File", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(capsule.getByRole("status")).toHaveCount(0);
  await expect(capsule.getByRole("button", { name: "Hide", exact: true })).toHaveCount(0);
  // Cancel does what Esc does: the stopped run is taken back and the words are filed as they were.
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [capture, ...others] = archived(library);
  expect(others).toEqual([]);
  expect(path.basename(capture!)).toMatch(/-plant-tulips-in-october\.md$/);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

/**
 * "misheard words", dictated to a stalling agent and Edited, whose stopped run left a commit that git then can't take back: the page
 * it started was changed by hand and committed since. Then "corrected words" are filed. Returns the library, the app and its capsule,
 * and the state of the card that shows. The library's evening review is on unless `eveningReview` is false.
 */
async function editWhoseFirstTryStays(eveningReview: boolean) {
  // The library's tasks are set before the agent runs: the run's guard puts back any change to them made while it works.
  const { library, app, capsule } = await dictateToStallingAgent("misheard words", {}, (root) => {
    if (eveningReview) return;
    const file = path.join(root, "tasks", "evening-review.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("enabled: true", "enabled: false"));
  });
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  // The stopped run's leftovers are committed once it is over. A change by hand to the page it started is committed after them:
  // taking the leftovers back would take that change with it.
  await expect.poll(() => gitOut(library, "log", "--format=%s"), { timeout: 30_000 }).toContain("avanzel: leftovers of");
  writeFileSync(path.join(library, "goals", "half.md"), "# Half done, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await capsule.getByRole("textbox").fill("corrected words");
  await capsule.getByRole("button", { name: "File" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  return { library, app, capsule, state: await call(app, "capsuleStateForTests") };
}

const FIRST_TRY = "The agent's first try can't be taken back automatically.";
const BOTH_VERSIONS = "Usually a later change touched the same lines. The library's history keeps both versions.";

test("an Edit whose first try git won't take back says so, and that the note waits for the evening review", async () => {
  const { library, app, capsule, state } = await editWhoseFirstTryStays(true);
  expect(state).toEqual({ kind: "error", message: FIRST_TRY, detail: `${BOTH_VERSIONS} The note waits in your inbox for the evening review.` });
  await expectProblem(capsule, { title: FIRST_TRY, lines: [`${BOTH_VERSIONS} The note waits in your inbox for the evening review.`] }); // nothing to fix: Hide alone
  // The corrected words wait in the inbox, and the change by hand stays.
  expect(inboxWords(library)).toEqual([expect.stringContaining("corrected words")]);
  expect(read(library, "goals/half.md")).toBe("# Half done, by hand\n");
  await app.close();
});

test("an Edit whose first try git won't take back promises no evening review while it is off", async () => {
  const { app, state } = await editWhoseFirstTryStays(false);
  expect(state).toEqual({ kind: "error", message: FIRST_TRY, detail: `${BOTH_VERSIONS} Your note is safe in the inbox.` });
  await app.close();
});

test("an evening review during an edit files only the corrected words", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "misheard words",
    FAKE_AGENT_DELAY_MS: "3000",
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000, intervals: [50] }).toBe("filing");
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(inboxWords(library)).toEqual([expect.stringContaining("misheard words")]); // the review left it alone
  // ... and says so, rather than that the inbox was empty.
  expect(await call(app, "notificationsForTests")).toEqual([
    { title: "Evening review", body: "Nothing to file right now: your note is still being filed or edited." },
  ]);
  await capsule.getByRole("textbox").fill("corrected words");
  await capsule.getByRole("button", { name: "File" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "idleForTests");
  const filed = archived(library).map((file) => readFileSync(file, "utf8"));
  expect(filed.filter((text) => text.includes("misheard"))).toEqual([]);
  expect(filed.filter((text) => text.includes("corrected words"))).toHaveLength(1);
  await app.close();
});

test("a dictation made while an evening review runs is filed once, by its own filing", async () => {
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Said while the review ran",
    FAKE_AGENT_DELAY_MS: "4000", // the review's run on the earlier thought outlasts the dictation
  });
  await windowFor(app, "capsule");
  await call(app, "runTask", "evening-review");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing"); // waiting behind the review
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed"); // then filed by its own filing
  await call(app, "idleForTests");
  const filed = archived(library).map((file) => readFileSync(file, "utf8"));
  expect(filed.filter((text) => text.includes("Said while the review ran"))).toHaveLength(1);
  const [digest] = filesUnder(library, "reviews");
  expect(read(library, `reviews/${digest}`)).toContain("Filed 1 of 1 capture."); // the review left it alone
  await app.close();
});

test("quitting mid-filing stops the agent, commits what it left, and keeps the note in the inbox", async () => {
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const { library, app } = await dictateToStallingAgent("Call the plumber about the leak", { FAKE_AGENT_RECORD: record });
  const { pid } = JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number };
  await quit(app);
  expect(alive(pid)).toBe(false);
  expect(inbox(library)).toEqual([expect.stringMatching(/-call-the-plumber-about-the\.md$/)]);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: leftovers of failed filing /);
  expect(gitOut(library, "status", "--porcelain")).toBe("");
});

test("quitting with the editor open keeps the edit in the inbox", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("misheard words");
  await editTo(app, capsule, "corrected words");
  await quit(app);
  expect(inboxWords(library)).toEqual([expect.stringContaining("corrected words")]);
  expect(mentioning(library, "misheard")).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false); // what the stopped run did is taken back
});

test("quitting with the editor open still saves the edit when the wait runs out", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const words = await quitWhileHeld((app, capsule) => editTo(app, capsule, "corrected words"), { ...SHORT_QUIT_WAIT, AVANZEL_USER_DATA: userData });
  // The corrected words are written anyway, with the recording and transcriber of the misheard ones, which stay too.
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  const [corrected] = words.filter((text) => text.includes("corrected words"));
  expect(corrected).toContain("\ntranscriber: fake\n");
  expect(corrected).toMatch(/\naudio: raw\/audio\/.+\.wav\n/);
  // Two notes in the inbox, one recording: the corrected words are the dictation written again.
  expect(capturesKept(userData)).toBe(1);
});

test("words filed after an edit are saved when the quit wait runs out before their turn", async () => {
  const words = await quitWhileHeld((app, capsule) => fileEdit(app, capsule, "first fix"), SHORT_QUIT_WAIT);
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  expect(words.filter((text) => text.includes("first fix"))).toHaveLength(1);
});

/** Whether the app is still there to answer: a quit that went ahead has taken it. */
const stillRunning = (app: ElectronApplication) => call(app, "busy").then(() => true, () => false);

test("a second quit while the first waits for the filing to stop waits for it too", async () => {
  // The menu's Quit, ⌘Q and Quit and reopen are all app.quit(). A second one is no reason to stop waiting: the filing's
  // bookkeeping isn't done, and quitWhileHeld checks that the app stayed until the whole wait had run out.
  await quitWhileHeld(async () => {}, SHORT_QUIT_WAIT, async (app) => {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await stillRunning(app), "the second quit let the app go before its filing was stopped").toBe(true);
  });
});

test("Quit and reopen asked while a quit waits for the filing to stop relaunches nothing: the first quit's choice wins", async () => {
  // Privacy's Quit and reopen. AVANZEL_TEST=1 relaunches nothing, and relaunchedForTests counts the relaunches that would begin.
  await quitWhileHeld(async () => {}, SHORT_QUIT_WAIT, async (app) => {
    expect(await call(app, "relaunchedForTests")).toBe(0);
    await call(app, "relaunch");
    expect(await call(app, "relaunchedForTests")).toBe(0);
    expect(await stillRunning(app), "Quit and reopen let the app go before its filing was stopped").toBe(true);
  });
});

test("corrected words that can't be saved yet are saved when Avanzel quits, and the card says so", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("misheard words");
  await editTo(app, capsule, "corrected words");
  const inboxDir = path.join(library, "inbox");
  chmodSync(inboxDir, 0o555); // the corrected words can't be written for now
  try {
    await capsule.getByRole("button", { name: "File" }).click();
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    // Not an agent's failure: its own title, the error's line and what keeps the words, and Hide only, so that nothing
    // files the misheard capture again.
    expect(await cardNote(app)).toBeNull(); // no note for the card to file again
    expect(await call(app, "capsuleStateForTests")).toEqual({
      kind: "error",
      message: "Your corrected words weren't saved yet.",
      detail: expect.stringMatching(/^EACCES: permission denied.*\nYour corrected words are saved to your inbox when you quit; the original note is still there\.$/),
    });
    // The error names two long paths: its line is cut short, so the card shows all of it, what keeps the words last, on a line of its own.
    const { detail } = (await call(app, "capsuleStateForTests")) as { detail: string };
    const [reason] = detail.split("\n");
    expect(Array.from(reason!).length).toBeLessThanOrEqual(100);
    expect(reason!.endsWith("…")).toBe(true);
    expect((reason!.match(/'/g) ?? []).length % 2).toBe(0); // no path is cut: each quote it opens, it closes
    await expectProblem(capsule, {
      title: "Your corrected words weren't saved yet.",
      lines: [reason!, "Your corrected words are saved to your inbox when you quit; the original note is still there."],
    });
    await call(app, "idleForTests"); // nothing left to do: the words are only in memory
  } finally {
    chmodSync(inboxDir, 0o755);
  }
  await quit(app);
  const words = inboxWords(library);
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  const [corrected] = words.filter((text) => text.includes("corrected words"));
  expect(corrected).toContain("\ntranscriber: fake\n");
});

test("File with the words unchanged is a Cancel: quitting before its turn writes no second copy", async () => {
  const words = await quitWhileHeld(async (app, capsule) => {
    await capsule.getByRole("button", { name: "Edit" }).click();
    await expect.poll(() => capsuleKind(app)).toBe("editing");
    await capsule.getByRole("button", { name: "File" }).click(); // nothing typed
    await expect.poll(() => capsuleKind(app)).toBe("filing");
  }, SHORT_QUIT_WAIT);
  expect(words).toEqual([expect.stringContaining("misheard words")]);
});

// The one quit-wait test that keeps the app's real wait: it covers that wait, and quitWhileHeld checks the quit took all 10 s.
test("a second Edit on a refiled note keeps its words when the quit wait runs out", async () => {
  const words = await quitWhileHeld(async (app, capsule) => {
    await fileEdit(app, capsule, "first fix");
    await capsule.getByRole("button", { name: "Edit" }).click(); // opened again, nothing typed
    await expect.poll(() => capsuleKind(app)).toBe("editing");
  });
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  expect(words.filter((text) => text.includes("first fix"))).toHaveLength(1);
});

test("starting a new dictation with the editor open keeps the edit", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { library, app, capsule } = await dictateToStallingAgent("misheard words", { AVANZEL_USER_DATA: userData });
  await editTo(app, capsule, "corrected words");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await call(app, "idleForTests");
  expect(inboxWords(library)).toEqual([expect.stringContaining("corrected words")]);
  expect(mentioning(library, "misheard")).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false);
  // The kept edit is the first dictation written again, and the one given up with Esc kept nothing: one recording in all.
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("an edit that can't be saved when another recording takes the card is told in a notification, in the corrected words' own", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("misheard words");
  await editTo(app, capsule, "corrected words");
  const inboxDir = path.join(library, "inbox");
  chmodSync(inboxDir, 0o555); // the corrected words can't be written for now
  try {
    await call(app, "toggleDictate"); // the next recording takes the card, so the edit is kept: it can't be written
    await expect.poll(() => capsuleKind(app)).toBe("listening");
    await call(app, "cancelRecording");
    await call(app, "idleForTests");
    // The card that shows the same problem when File can't write the words has these words: the title, and the error's line cut short
    // above what keeps the words.
    expect(await call(app, "notificationsForTests")).toEqual([
      {
        title: "Your corrected words weren't saved yet.",
        body: expect.stringMatching(/^EACCES: permission denied.*\nYour corrected words are saved to your inbox when you quit; the original note is still there\.$/),
      },
    ]);
    const [note] = (await call(app, "notificationsForTests")) as { body: string }[];
    expect(Array.from(note!.body.split("\n")[0]!).length).toBeLessThanOrEqual(100);
  } finally {
    chmodSync(inboxDir, 0o755);
  }
  // The edit is kept in memory, as the notification says, and quitting saves it beside the note it corrects.
  await quit(app);
  const words = inboxWords(library);
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("corrected words"))).toHaveLength(1);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
});

test("a failed filing says its partial edits are kept as their own commit", async () => {
  const library = await makeLibrary({ git: true });
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "An unfileable thought",
    FAKE_AGENT_MODE: "messy", // fails this capture after adding a line to index.md
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // Any other failure keeps the agent's own line, as a sentence, then what is safe and what the agent left behind. Its one
  // fix files the note again with the same agent.
  const detail =
    "Agent crashed: cannot file this one. Your note is safe in the inbox; the evening review will try again. " +
    "fake's partial edits are kept as their own commit in the library's history.";
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "fake couldn't file this note.",
    detail,
    action: "refile:fake",
    actionLabel: "Try again",
  });
  await expectProblem(capsule, { title: "fake couldn't file this note.", lines: [detail], fix: "Try again" });
  await snap(capsule, "5-error-partial-edits");
  expect(inbox(library)).toHaveLength(1);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: leftovers of failed filing /);
  await app.close();
});

test("the filing guard's hook runs with Avanzel's own binary as Node", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  expect(await call(app, "guardForTests", library, path.join(library, "raw", "2026", "x.md"))).toContain('"permissionDecision":"deny"');
  expect(await call(app, "guardForTests", library, path.join(library, "ideas", "a.md"))).toBe("");
  await app.close();
});

test("when a symlinked inbox keeps the agent's rewrite, the capsule says where the owner's words are", async () => {
  const library = await makeLibrary();
  const elsewhere = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-inbox-")), "inbox");
  renameSync(path.join(library, "inbox"), elsewhere);
  symlinkSync(elsewhere, path.join(library, "inbox"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "My exact words",
    FAKE_AGENT_MODE: "tamper", // files, then rewrites the capture
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  const [kept] = filesUnder(library, ".avanzel/logs");
  expect(kept).toMatch(/-my-exact-words\.original\.md$/);
  expect(read(library, `.avanzel/logs/${kept}`)).toContain("My exact words");
  await expect(capsule.getByText(`Your words are kept in .avanzel/logs/${kept}`, { exact: false })).toBeVisible();
  await expect(capsule.getByText("safe in the inbox", { exact: false })).toHaveCount(0);
  await snap(capsule, "5-error-words-aside");
  // Why it was blocked first, then where the words are instead of "safe in the inbox", then what the run left in the
  // library. This library has no git, so those edits have no history to be undone from. Avanzel's own line says why before
  // anything else, and fits in what the card keeps of a line (100 characters): it is whole, with no "…".
  const state = (await call(app, "capsuleStateForTests")) as { detail: string };
  expect(state).toMatchObject({ kind: "error", message: "fake couldn't file this note." });
  const detail =
    "A symlink in inbox/ kept Avanzel from putting back the words the agent changed. " +
    `Your words are kept in .avanzel/logs/${kept}, and the inbox holds the agent's version; the evening review will try again. ` +
    "Its partial edits stay in the library, outside its history, so they can't be undone.";
  expect(state.detail).toBe(detail);
  await expectProblem(capsule, { title: "fake couldn't file this note.", lines: [detail], fix: "Try again" });
  await app.close();
});

// ---- Where the words are made ----
//
// The capsule says its words are made on this Mac only when the library's speech does run here. The command in a library's
// [voice] settings can run anywhere, so for it the capsule says only that the words are made.

/** A library whose speech-to-text is the command in its settings (`true`, which hears nothing), and not the engine's model on this Mac. */
async function libraryWithSpeechCommand(): Promise<string> {
  const library = await makeLibrary();
  const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600 };
  saveSettings(library, { ...loadSettings(library), voice });
  return library;
}

for (const [name, onThisMac] of [["the engine's model", true], ["a command", false]] as const) {
  test(`while the words are made by ${name}, the capsule says ${onThisMac ? "that it is on this Mac" : "nothing of where"}`, async () => {
    const library = onThisMac ? await makeLibrary() : await libraryWithSpeechCommand();
    const app = await launch({
      AVANZEL_LIBRARY: library,
      AVANZEL_FAKE_AUDIO: speechWav("hello"),
      AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
      AVANZEL_AUDIO_TIMEOUT_MS: "60000",
    });
    const capsule = await windowFor(app, "capsule");
    // The recording's audio is held on its way to main, so the capsule stays on "transcribing" as long as the test reads it.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("capsule:audio");
      ipcMain.handle("capsule:audio", () => undefined);
    });
    await call(app, "toggleDictate");
    await call(app, "toggleDictate");
    await expect.poll(() => capsuleKind(app)).toBe("transcribing");
    await expect(capsule.getByText(onThisMac ? "Transcribing on this Mac…" : "Transcribing…", { exact: true })).toBeVisible();
    expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac });
    // The line is the bar's: Zel thinks, the line is in the live region, and nothing is there to press until the words take long.
    await snap(capsule, "2-transcribing");
    await expect(zel(capsule)).toHaveAttribute("data-mood", "thinking");
    await expect(capsule.getByRole("status")).toContainText(onThisMac ? "Transcribing on this Mac…" : "Transcribing…");
    await expect(capsule.getByRole("button")).toHaveCount(0);
    await expect(capsule.getByRole("article")).toHaveCount(0);
    await app.close();
  });

  test(`once the words are made by ${name}, the filing card says how long they took${onThisMac ? ", on this Mac" : " and not where"}`, async () => {
    const library = onThisMac ? await makeLibrary() : await libraryWithSpeechCommand();
    const app = await launch({
      AVANZEL_LIBRARY: library,
      AVANZEL_FAKE_AUDIO: speechWav("hello"),
      AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
      FAKE_AGENT_DELAY_MS: "20000", // the filing stays on view while the test reads it
      FAKE_AGENT_DELAY_TASK: "file",
    });
    const capsule = await windowFor(app, "capsule");
    await dictate(app);
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
    await expect(capsule.getByText(onThisMac ? /^Transcribed on this Mac in \d+\.\d s$/ : /^Transcribed in \d+\.\d s$/)).toBeVisible();
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filing", onThisMac });
    await app.close();
  });
}

test("a typed note says it was typed, whoever would have made its words", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await libraryWithSpeechCommand(), FAKE_AGENT_DELAY_MS: "20000", FAKE_AGENT_DELAY_TASK: "file" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "submitQuick", "Plant tulips in October");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await expect(capsule.getByText("Typed note", { exact: true })).toBeVisible();
  await app.close();
});

// ---- A capsule filing: its steps, its time and its receipt ----
//
// The card of a filing is told what the agent does as it does it (`rows`), when its run began and about how long that takes
// (`startedAt`, `estimate`), and when it last took a step (`stepAt`). Once the filing is done, the state says which of its pages
// are new and which are updated, and that a filing which wrote no page only noted its capture in the log (`noted`).

/** What the capsule's state carries of a filing, as `capsuleStateForTests` tells it. */
type Facts = {
  kind: string;
  text?: string;
  waiting?: boolean;
  rows?: { kind: string; path: string | null; title: string; shelf: string }[];
  startedAt?: number;
  estimate?: number;
  stepAt?: number;
  seconds?: number;
  cancelling?: boolean;
  canEdit?: boolean;
};
const factsOf = async (app: ElectronApplication) => (await call(app, "capsuleStateForTests")) as Facts;
/** The kinds of the rows the capsule's state holds, oldest first: none while it shows anything but a filing. */
const rowKindsOf = async (app: ElectronApplication) => ((await factsOf(app)).rows ?? []).map((row) => row.kind);

/**
 * A library that Claude Code's stand-in files, which reports its tool calls as Claude Code does (FAKE_AGENT_STREAM) and takes
 * `stepMs` over each, so that the steps come while the run goes on. `env` adds variables for the app, and for the stand-in.
 */
function steppedClaude(stepMs: number, env: Record<string, string> = {}) {
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_STREAM: "claude" }) });
  return claudeLibrary(bin, { env: { FAKE_AGENT_STEP_MS: String(stepMs), ...env } });
}

/** The filing durations the app keeps for `library` in `userData` (run-state.json): the last ten seconds of each agent, by harness. */
function durationsKept(userData: string, library: string): Record<string, number[]> {
  const file = path.join(userData, "run-state.json");
  if (!existsSync(file)) return {};
  const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, { durations?: Record<string, number[]> }>;
  return state[path.resolve(library)]?.durations ?? {};
}

test("a capsule filing shows the agent's steps", async () => {
  const { app } = await steppedClaude(1000);
  await watchFilingStates(app);
  const asked = Date.now();
  await dictate(app);
  // The rows come as the agent takes its steps: it reads the library's index, then writes the idea's page. (Its read of the
  // capture itself is no row.)
  await expect.poll(() => rowKindsOf(app), { timeout: 30_000, intervals: [100] }).toEqual(expect.arrayContaining(["read", "new"]));
  const state = await factsOf(app);
  expect(state).toMatchObject({ kind: "filing", text: "Plant tulips in October", estimate: 15 }); // 15 until it has done three filings
  expect(state.rows?.slice(0, 2)).toMatchObject([
    { kind: "read", path: "index.md", shelf: "" },
    { kind: "new", path: expect.stringMatching(/^ideas\/idea-.+\.md$/), title: "Plant tulips in October", shelf: "ideas" },
  ]);
  // Its seconds count from the start of its run, and its last step came after that.
  expect(state.startedAt).toBeGreaterThanOrEqual(asked);
  expect(state.startedAt).toBeLessThanOrEqual(Date.now());
  expect(state.stepAt).toBeGreaterThan(state.startedAt ?? Infinity);

  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  // The steps reached the card one by one while the run went on, not together at its end, and none of them rebuilt the menu.
  const sent = await filingSends(app);
  const counts = sent.map((one) => one.rows);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
  // tick() (every minute, and on waking or unlocking) and broadcast() rebuild the menu too, and one of them may land in these
  // seconds, so one rebuild is allowed. A rebuild at each of the steps would be four or more.
  const menus = sent.slice(1).map((one) => one.menus);
  expect(Math.max(...menus) - Math.min(...menus)).toBeLessThanOrEqual(1);
  // The idea's page is new; the index and the log the agent also edited are no pages.
  expect(await factsOf(app)).toMatchObject({ kind: "filed", noted: false, pages: [{ shelf: "ideas", created: true }] });
  await app.close();
});

test("a hundred quick steps reach the capsule as a few updates", async () => {
  // The stand-in reads a hundred pages back to back, after the index and before it writes.
  const { app } = await steppedClaude(500, { FAKE_AGENT_READS: "100" });
  await watchFilingStates(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const sent = await filingSends(app);
  expect(sent.length).toBeLessThanOrEqual(20); // not one for each of the hundred
  expect(Math.max(...sent.map((one) => one.rows))).toBe(50); // they did arrive: a send held the fifty newest rows, which is all main keeps
  await app.close();
});

test("a card that was hidden stays hidden while its filing goes on, and the filing ends in a notification", async () => {
  const { app, capsule } = await steppedClaude(1000);
  await watchFilingStates(app);
  await dictate(app);
  await expect.poll(() => rowKindsOf(app), { timeout: 30_000, intervals: [100] }).toContain("read");
  // Hide, the bar's first button, puts the card away and leaves the filing to go on.
  await capsule.getByRole("status").getByRole("button", { name: "Hide", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const before = (await filingSends(app)).length;
  // The steps that follow bring nothing back: the card stays hidden, and is sent nothing, until the filing ends in its notification.
  const seen = new Set<string>();
  await expect
    .poll(async () => (seen.add(await capsuleKind(app)), (await notified(app, "Filed by Claude Code")).length), { timeout: 30_000, intervals: [100] })
    .toBe(1);
  expect([...seen]).toEqual(["hidden"]);
  expect(await shown(app, "capsule")).toBe(false);
  expect((await filingSends(app)).length).toBe(before);
  await app.close();
});

test("a card that replaced a filing's keeps its own steps, and the filing it replaced ends in a notification", async () => {
  const { app } = await steppedClaude(1000);
  await dictate(app);
  await expect.poll(() => rowKindsOf(app), { timeout: 30_000, intervals: [100] }).toContain("read");
  // A second thought, typed, takes the capsule at once. The agent files it after the first (one run at a time) ...
  await call(app, "submitQuick", "Call the plumber on Monday");
  // ... so until the first filing ends, the card is the second's, and shows none of the first's steps, which keep coming.
  const wrong: Facts[] = [];
  await expect
    .poll(
      async () => {
        const state = await factsOf(app);
        const notes = await notified(app, "Filed by Claude Code");
        if (!notes.length && (state.kind !== "filing" || state.text !== "Call the plumber on Monday" || (state.rows ?? []).length > 0)) wrong.push(state);
        return notes.length;
      },
      { timeout: 30_000, intervals: [100] },
    )
    .toBe(1);
  expect(wrong).toEqual([]);
  // The first filing ended in its notification, with its page, and its receipt is not on the second's card.
  expect(await notified(app, "Filed by Claude Code")).toEqual([{ title: "Filed by Claude Code", body: "Plant tulips in October (ideas)" }]);
  expect(await factsOf(app)).toMatchObject({ kind: "filing", text: "Call the plumber on Monday" });
  // The second card is sent its own steps, once its run starts, and then its own receipt.
  await expect.poll(async () => ((await factsOf(app)).rows ?? []).map((row) => row.title), { timeout: 30_000, intervals: [100] }).toContain("Call the plumber on Monday");
  expect(((await factsOf(app)).rows ?? []).map((row) => row.title)).not.toContain("Plant tulips in October");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  expect(await factsOf(app)).toMatchObject({ kind: "filed", pages: [{ title: "Call the plumber on Monday", shelf: "ideas", created: true }] });
  await app.close();
});

test("a filing's pages say new or updated", async () => {
  // A stand-in Claude Code that files as the real one does: it writes a new idea page, adds to a page the library had, and logs
  // it. The engine's own fake agent edits only the index and the log, which are no pages.
  const filer = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-filer-")), "filer.mjs");
  writeFileSync(
    filer,
    String.raw`import { appendFileSync, writeFileSync } from "node:fs";
const prompt = process.argv[2] ?? "";
const id = /capture id: ([^)]+)\)/.exec(prompt)[1];
const stamp = /- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \| file \|/.exec(prompt)[1];
writeFileSync("ideas/tulips.md", "# Tulips for October\n");
appendFileSync("goals/run.md", "\n- Ran again today.\n");
appendFileSync("log.md", "- " + stamp + " | file | [[" + id + "]] → [[tulips]], [[run]]\n");
console.log("Filed into [[tulips]] and [[run]].");
`,
  );
  const bin = agentStubs();
  answerAs(bin, "claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else exec '${process.execPath}' '${filer}' "$2"; fi`);
  const { library, app } = await claudeLibrary(bin);
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n\nStatus: active.\n");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // The new page comes first, as the engine lists them, and the one that was changed after it; the log isn't a page.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filed",
    noted: false,
    pages: [
      { title: "Tulips for October", shelf: "ideas", path: "ideas/tulips.md", created: true },
      { title: "Run a marathon", shelf: "goals", path: "goals/run.md", created: false },
    ],
  });
  await app.close();
});

test("a log-only filing is noted", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Nothing in this is worth a page",
    FAKE_AGENT_MODE: "logonly", // decides the capture needs no page, and says so in the log
    ...onlyAgentsIn(agentStubs()),
  });
  const capsule = await windowFor(app, "capsule");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Nothing in this is worth a page", noted: true, pages: [] });
  // The card says nothing new was filed: stamped Noted, with the agent's word that it only logged the capture. Without git there is
  // no commit to take back, so the bar offers Hide alone.
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await expect(bar.getByText("Nothing new to file", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText("Nothing in this is worth a page", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: /^Noted, / })).toBeVisible();
  await expect(card.getByText("fake noted it in the log.", { exact: true })).toBeVisible();
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(read(library, "log.md")).toContain("nothing to file (a test)");
  await app.close();
});

test("each filing's seconds are kept with the agent that filed it", async () => {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_DELAY_MS: "1500", // the run takes at least this long
    FAKE_AGENT_DELAY_TASK: "file",
    ...onlyAgentsIn(agentStubs()),
  });
  expect(durationsKept(userData, library)).toEqual({});
  await dictate(app);
  await expect.poll(() => durationsKept(userData, library).fake?.length, { timeout: 60_000 }).toBe(1);
  await dictate(app);
  await expect.poll(() => durationsKept(userData, library).fake?.length, { timeout: 60_000 }).toBe(2);
  // Two durations under the agent that ran, in seconds: its pause is in them, and so is nothing like a minute. (The key is the
  // harness's name, never "auto".)
  const kept = durationsKept(userData, library);
  expect(Object.keys(kept)).toEqual(["fake"]);
  for (const seconds of kept.fake ?? []) {
    expect(seconds).toBeGreaterThanOrEqual(1.4);
    expect(seconds).toBeLessThan(30);
  }
  await app.close();
});

test("a filing's estimate is the median of what its agent's last filings took", async () => {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  // The library's fake agent has done four filings, 4, 6, 9 and 30 s; another agent's are kept apart.
  writeFileSync(
    path.join(userData, "run-state.json"),
    JSON.stringify({ [library]: { checked: {}, ran: {}, waiting: [], durations: { fake: [4, 6, 9, 30], codex: [100, 200, 300] } } }),
  );
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_DELAY_MS: "3000", // the filing stays on view while the test reads it
    FAKE_AGENT_DELAY_TASK: "file",
    ...onlyAgentsIn(agentStubs()),
  });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // The middle two are 6 and 9; their mean, 7.5, is about 8 s.
  expect(await factsOf(app)).toMatchObject({ kind: "filing", estimate: 8 });
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // The filing is kept after them, and the other agent's are as they were.
  const kept = durationsKept(userData, library);
  expect(kept.fake?.slice(0, 4)).toEqual([4, 6, 9, 30]);
  expect(kept.fake).toHaveLength(5);
  expect(kept.codex).toEqual([100, 200, 300]);
  await app.close();
});

test("the seconds a filing took leave out the time it waited for the library", async () => {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_DELAY_MS: "2000", // the run itself takes about this long
    FAKE_AGENT_DELAY_TASK: "file",
    ...onlyAgentsIn(agentStubs()),
  });
  // Another process has the library for a good while, so the filing waits for it ...
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  let released = 0;
  try {
    await dictate(app);
    await expect.poll(() => factsOf(app), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
    await sleep(5_000);
    released = Date.now();
  } finally {
    letGo();
    await held;
  }
  // ... and the card's seconds start when the run has it.
  let running: Facts | undefined;
  await expect
    .poll(
      async () => {
        const state = await factsOf(app);
        if (state.kind === "filing" && !state.waiting) running = state;
        return running !== undefined;
      },
      { timeout: 30_000, intervals: [100] },
    )
    .toBe(true);
  expect(running?.startedAt).toBeGreaterThanOrEqual(released);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // What it says it took, and what is kept of it, are the run's: its pause (2 s) and a little, not the wait (5 s) too, which would
  // make about 7.5. The limit sits between them, with a margin of about 2.5 s on each side for a Mac that is slow or busy.
  const [kept] = durationsKept(userData, library).fake ?? [];
  expect(kept).toBeGreaterThanOrEqual(1.9);
  expect(kept).toBeLessThan(5);
  expect((await factsOf(app)).seconds).toBeLessThan(5);
  await app.close();
});

test("the seconds a filing took leave out the time it waited behind another", async () => {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_DELAY_MS: "4000", // each run takes about this long
    FAKE_AGENT_DELAY_TASK: "file",
    ...onlyAgentsIn(agentStubs()),
  });
  const capsule = await windowFor(app, "capsule");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // A second thought, typed, is filed after the first: the app runs one agent at a time, so it waits its turn in the queue,
  // which the engine's wait for the library doesn't tell.
  await call(app, "submitQuick", "Call the plumber on Monday");
  // Its card says so at once, as it does for the library's wait: the same line, and no seconds to count, until its turn.
  await expect.poll(() => factsOf(app), { timeout: 10_000 }).toMatchObject({ kind: "filing", text: "Call the plumber on Monday", waiting: true });
  const card = capsule.getByRole("article");
  await expect(card.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible();
  await expect(capsule.getByText(/^\d+ s( of about \d+)?$/)).toHaveCount(0);
  // Its turn ends the wait and starts its seconds: its card is the one that counts, with its own run.
  await expect.poll(async () => (await factsOf(app)).waiting ?? false, { timeout: 30_000, intervals: [100] }).toBe(false);
  expect(await factsOf(app)).toMatchObject({ kind: "filing", text: "Call the plumber on Monday" });
  await expect(card.getByText(/^\d+ s of about \d+$/)).toBeVisible();
  await expect(card.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toHaveCount(0);
  await expect.poll(() => durationsKept(userData, library).fake?.length, { timeout: 60_000 }).toBe(2);
  // Each took about its own pause (4 s) and a little. Were the second's wait for the first in its seconds, it would have taken
  // about 8. The limit sits between them, with a margin of about 2 s on each side for a Mac that is slow or busy.
  for (const seconds of durationsKept(userData, library).fake ?? []) {
    expect(seconds).toBeGreaterThanOrEqual(3.9);
    expect(seconds).toBeLessThan(6.5);
  }
  await app.close();
});

test("a filing that failed keeps no duration, and the next one that files keeps its own", async () => {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "An unfileable thought",
    FAKE_AGENT_MODE: "picky", // fails a capture that says "unfileable", and files any other
    ...onlyAgentsIn(agentStubs()),
  });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  await call(app, "idleForTests");
  expect(durationsKept(userData, library)).toEqual({}); // a run that failed says nothing of how long a filing takes
  // A thought it can file is kept, so the failure left nothing out but its own seconds.
  await call(app, "submitQuick", "Plant tulips in October");
  await expect.poll(() => durationsKept(userData, library).fake?.length, { timeout: 60_000 }).toBe(1);
  await app.close();
});

test("a filing the Mac slept through keeps no duration, though its receipt says what the clock did", async () => {
  const library = await makeLibrary(); // its agent may run for 30 s
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_DELAY_MS: "2000", // the run is under way for a moment, while the clock jumps
    FAKE_AGENT_DELAY_TASK: "file",
    ...onlyAgentsIn(agentStubs()),
  });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // The Mac sleeps for an hour mid-run: the app's clock jumps ahead, and the agent's own timers do not.
  await app.evaluate(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 3_600_000;
  });
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect((await factsOf(app)).seconds).toBeGreaterThan(3_000); // the receipt says what the clock says
  await call(app, "idleForTests");
  expect(durationsKept(userData, library)).toEqual({}); // no run outlasts its 30 s: more than that was the sleep
  await app.close();
});

test("a filing's steps name their pages from the note's own library when another opens meanwhile", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const { app } = await steppedClaude(2000, { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  await dictate(app);
  await expect.poll(() => rowKindsOf(app), { timeout: 30_000, intervals: [100] }).toContain("read");
  // Another library opens while the agent works, and the first library's filing goes on.
  await stubPicker(app, await makeLibrary());
  await call(app, "chooseLibrary");
  expect(await capsuleKind(app)).toBe("filing");
  // The idea's page the agent writes next is in the first library alone, so its row has the page's title, which only that library
  // can tell: from the library that is open now, it would be named by its file name ("idea-2026-…").
  await expect
    .poll(async () => ((await factsOf(app)).rows ?? []).find((row) => row.kind === "new")?.title, { timeout: 30_000, intervals: [100] })
    .toBe("Plant tulips in October");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await app.close();
});

// ---- Stop: a capsule filing ends, and its words go back to the inbox ----
//
// What Stop does is told at the controller's `cancelFiling`. The card has no Stop button yet, so these press it as the button will:
// through the capsule page's bridge, `window.avanzel.capsule.cancelFiling()`, which `call()` can't do, since the channel answers
// only the page that sends it.

/** Stop, pressed on `page`, as the card's Stop will press it. */
const stop = (page: Page) => page.evaluate(() => window.avanzel.capsule.cancelFiling());

/** From now on, notes each state sent to the capsule's page (`statesSent`), oldest first. */
async function watchStates(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const sent: unknown[] = [];
    Object.assign(globalThis, { statesSent: sent });
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:state") sent.push(JSON.parse(JSON.stringify(args[0])));
      send(channel, ...args);
    };
  });
}

const statesSent = (app: ElectronApplication) => app.evaluate(() => (globalThis as { statesSent?: Facts[] }).statesSent ?? []);
/** The kinds of the states `watchStates` noted, oldest first. */
const kindsSent = async (app: ElectronApplication) => (await statesSent(app)).map((state) => state.kind);

const reachedTheEnd = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).atTheEnd === true);

/**
 * From now on, Stop is pressed the moment the engine hands a filing's result back: the agent has finished, and the app has not yet
 * looked at what it did. With `hold`, the result waits first (`atTheEnd` says that it does, `letItEnd` lets it go), so that the
 * test can change the library in between.
 */
async function stopAtTheEnd(app: ElectronApplication, { hold = false } = {}): Promise<void> {
  await app.evaluate(({ BrowserWindow }, holding) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window.");
    const controller = (globalThis as unknown as { __avanzel: Wrappable }).__avanzel;
    const librarian = controller.librarian.bind(controller);
    controller.librarian = async (harness) => {
      const made = await librarian(harness);
      const file = made.file.bind(made);
      made.file = async (...args) => {
        const outcomes = await file(...args);
        if (holding) {
          Object.assign(globalThis, { atTheEnd: true });
          await new Promise<void>((resolve) => Object.assign(globalThis, { letItEnd: resolve }));
        }
        controller.cancelFiling(capsule.webContents);
        return outcomes;
      };
      return made;
    };
  }, hold);
}

/** From now on, keeps the function the controller hands the engine to tell a filing's steps (`stepsOf`), for a test to tell one itself. */
async function keepSteps(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: Wrappable }).__avanzel;
    const librarian = controller.librarian.bind(controller);
    controller.librarian = async (harness) => {
      const made = await librarian(harness);
      const file = made.file.bind(made);
      made.file = (...args) => {
        Object.assign(globalThis, { stepsOf: (args[1] as { steps?: unknown } | undefined)?.steps });
        return file(...args);
      };
      return made;
    };
  });
}

test("Stop ends the filing and the note stays in the inbox", async () => {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October", { FAKE_AGENT_RECORD: runs, AVANZEL_USER_DATA: userData });
  const { pid } = JSON.parse(readFileSync(runs, "utf8").trim().split("\n")[0]!) as { pid: number };
  expect(alive(pid)).toBe(true);
  await watchStates(app);
  await stop(capsule);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  // The card says so: Stopped, over the person's words and what is safe: nothing of the run stayed, and the evening review files the note.
  await expectStoppedFiling(
    capsule,
    "Plant tulips in October",
    "Your words are back in the inbox, untouched, and nothing else changed. The evening review files your words at 21:00.",
  );
  // Stopped: its words, whose agent it was, that taking back the run's edits worked (nothing is `partial`, nothing is left over),
  // and when the evening review files the note, which for a new library is every day at 21:00.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "cancelled",
    text: "Plant tulips in October",
    agent: "fake",
    partial: false,
    leftovers: 0,
    review: "at 21:00",
  });
  // The agent is gone, the note waits in the inbox, and what the stopped run did is taken back.
  expect(alive(pid)).toBe(false);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  expect(archived(library)).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(read(library, "index.md")).not.toContain("left by a stalled run");
  expect(gitOut(library, "status", "--porcelain")).toBe("");
  // On the way the card said that it was stopping, and offered no Edit, and kept saying it until the stop was over; it never
  // showed a failure. A step state may have been on its way when Stop reached main (the folder watch settles for 150 ms, and steps
  // are sent at most every 250 ms), and it says nothing of a stop: so read from the first state that does.
  const sent = await statesSent(app);
  expect(sent.at(-1)?.kind).toBe("cancelled");
  const stopping = sent.slice(sent.findIndex((state) => state.cancelling), -1);
  expect(stopping.length).toBeGreaterThan(0);
  expect(stopping.map((state) => [state.kind, state.cancelling, state.canEdit])).toEqual(stopping.map(() => ["filing", true, false]));
  // A stopped filing says nothing of how long a filing takes; the next one that files keeps its own seconds, so the stop left
  // nothing out but its own.
  await call(app, "idleForTests");
  expect(durationsKept(userData, library)).toEqual({});
  await call(app, "submitQuick", "Call the plumber on Monday");
  await expect.poll(() => durationsKept(userData, library).fake?.length, { timeout: 60_000 }).toBe(1);
  await app.close();
});

test("Stop as the run ends doesn't take back a finished filing", async () => {
  // Stop arrives after the result: the card shows the filing as filed, and there is nothing to stop.
  const { app, capsule, library } = await launchOn(await makeLibrary({ git: true }));
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const filed = await call(app, "capsuleStateForTests");
  const history = gitOut(library, "log", "--format=%s");
  await watchStates(app);
  await stop(capsule);
  await call(app, "idleForTests");
  // The filed state stays, the card is told nothing, and no commit takes the filing back ...
  expect(await call(app, "capsuleStateForTests")).toEqual(filed);
  expect(await statesSent(app)).toEqual([]);
  expect(gitOut(library, "log", "--format=%s")).toBe(history);
  // ... so the page is where the agent wrote it, and the note is archived, not back in the inbox.
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a second Stop does nothing", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await watchUndos(app);
  // Two Stops one straight after the other (a page's messages reach main in the order they were sent) ...
  await capsule.evaluate(() => {
    window.avanzel.capsule.cancelFiling();
    window.avanzel.capsule.cancelFiling();
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  // ... and a third once the stop is over.
  await stop(capsule);
  await call(app, "idleForTests");
  // The run was taken back once, and cleanly: a second take-back would find its commit undone already, and git would refuse it.
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", partial: false, leftovers: 0 });
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  expect(exists(library, "goals/half.md")).toBe(false);
  await app.close();
});

test("Edit after Stop does nothing", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await watchStates(app);
  // Edit straight after Stop: the filing is stopping, and the editor does not open on it.
  await capsule.evaluate(() => {
    window.avanzel.capsule.cancelFiling();
    window.avanzel.capsule.edit();
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  await call(app, "idleForTests");
  expect(await kindsSent(app)).not.toContain("editing");
  expect(await call(app, "draftForTests")).toBeNull();
  expect(await call(app, "busy")).toBe(false); // no note is held for an edit that never opened
  // The stop went as it would have without the Edit.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", partial: false, leftovers: 0 });
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  expect(exists(library, "goals/half.md")).toBe(false);
  await app.close();
});

test("Stop after Edit does nothing: the note is still in the editor, and File files the corrected words", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("misheard words");
  await editTo(app, capsule, "corrected words");
  await watchStates(app);
  await stop(capsule);
  await call(app, "idleForTests");
  expect(await capsuleKind(app)).toBe("editing");
  expect(await call(app, "draftForTests")).toBe("corrected words");
  expect(await statesSent(app)).toEqual([]); // the card was sent nothing
  // File files the corrected words, as it does without the Stop.
  await capsule.getByRole("button", { name: "File" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [capture, ...others] = archived(library);
  expect(others).toEqual([]);
  expect(readFileSync(capture!, "utf8")).toContain("corrected words");
  expect(mentioning(library, "misheard")).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(inbox(library)).toEqual([]);
  expect(await kindsSent(app)).not.toContain("cancelled");
  await app.close();
});

test("Stop is heard from the capsule's page alone: another window's page stops no filing", async () => {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const { app, capsule } = await dictateToStallingAgent("Plant tulips in October", { FAKE_AGENT_RECORD: runs });
  const { pid } = JSON.parse(readFileSync(runs, "utf8").trim().split("\n")[0]!) as { pid: number };
  // Every window has the same bridge, so Settings' page can send capsule:cancel-filing. A page's messages reach main in the order
  // they were sent: the answer to the call after it comes once main has handled the Stop.
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.evaluate(async () => {
    window.avanzel.capsule.cancelFiling();
    await window.avanzel.settings.get();
  });
  // Had it been heard, the agent would be gone and the card stopping by now.
  await settings.waitForTimeout(1_500);
  expect(alive(pid)).toBe(true);
  expect(await factsOf(app)).toMatchObject({ kind: "filing" });
  expect((await factsOf(app)).cancelling).toBeUndefined();
  // The capsule's own Stop is heard.
  await stop(capsule);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  expect(alive(pid)).toBe(false);
  await app.close();
});

test("Stop while the filing waits for the library says it is stopping until the library is free, and a late step doesn't take that away", async () => {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_RECORD: runs });
  await keepSteps(app);
  await watchStates(app);
  // Another process has the library, so the filing waits for it, and the engine's wait for it can't be left.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => factsOf(app), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true, canEdit: true });
    await stop(capsule);
    // The card says at once that it is stopping, and offers no Edit, which main would ignore.
    await expect.poll(() => factsOf(app), { timeout: 10_000 }).toMatchObject({ kind: "filing", waiting: true, cancelling: true, canEdit: false });
    // A step is told meanwhile, as the agent's last might be (through the function the app handed the engine). The card is sent it
    // from the job, which knows that Stop was pressed, not from what the card showed before.
    await app.evaluate(() => (globalThis as Left).stepsOf?.({ kind: "read", path: "index.md" }));
    expect(await factsOf(app)).toMatchObject({ kind: "filing", cancelling: true, canEdit: false, rows: [{ kind: "read", path: "index.md" }] });
    // The stop is not over while the library is held.
    await sleep(1_500);
    expect(await factsOf(app)).toMatchObject({ kind: "filing", waiting: true, cancelling: true, canEdit: false });
  } finally {
    letGo();
    await held;
  }
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", text: "Plant tulips in October", partial: false, leftovers: 0 });
  // Every filing state the card was sent from Stop on said that it was stopping; and the agent never ran for the note.
  const sent = await statesSent(app);
  const fromStop = sent.slice(sent.findIndex((state) => state.cancelling)).filter((state) => state.kind === "filing");
  expect(fromStop.length).toBeGreaterThanOrEqual(2); // Stop's own, and the late step's
  expect(fromStop.every((state) => state.cancelling === true)).toBe(true);
  expect(exists(path.dirname(runs), "runs.jsonl")).toBe(false);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  await app.close();
});

test("a Stop that is still stopping when another thought takes the card leaves that card alone", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library);
  await watchStates(app);
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => factsOf(app), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
    await stop(capsule);
    await expect.poll(() => factsOf(app), { timeout: 10_000 }).toMatchObject({ kind: "filing", cancelling: true });
    // A second thought, typed, takes the card while the first is still stopping. It is the second's own filing, and nobody stopped it.
    await call(app, "submitQuick", "Call the plumber on Monday");
    const second = await factsOf(app);
    expect(second).toMatchObject({ kind: "filing", text: "Call the plumber on Monday" });
    expect(second.cancelling).toBeUndefined();
  } finally {
    letGo();
    await held;
  }
  // The first stop ends behind the scenes and puts nothing over the second's card, which files its note.
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "idleForTests");
  expect(await kindsSent(app)).not.toContain("cancelled");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", pages: [{ title: "Call the plumber on Monday" }] });
  // Nobody's words were lost: the stopped one waits in the inbox, and the other is filed.
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  expect(archived(library)).toHaveLength(1);
  await app.close();
});

test("Stop before the filing's turn: the agent never starts, and the note stays in the inbox", async () => {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file", FAKE_AGENT_RECORD: runs });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // The app runs one agent at a time: a second thought, typed, waits for the first to be filed, and Stop comes while it waits.
  await call(app, "submitQuick", "Call the plumber on Monday");
  await stop(capsule);
  await expect.poll(() => factsOf(app), { timeout: 10_000 }).toMatchObject({ kind: "filing", text: "Call the plumber on Monday", cancelling: true });
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("cancelled");
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "cancelled",
    text: "Call the plumber on Monday",
    agent: "fake",
    partial: false,
    leftovers: 0,
    review: "at 21:00",
  });
  // The agent ran for the first note alone; the first is filed, and the second waits in the inbox.
  expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
  expect(archived(library)).toHaveLength(1);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Call the plumber on Monday")]);
  await app.close();
});

test("Stop in a library without git leaves the stopped run's edits as they are, and says nothing recorded them", async () => {
  // No git, so the run's edits have no commit to be taken back from. "slow-messy" writes a page, then never finishes.
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_MODE: "slow-messy" });
  await dictate(app);
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await stop(capsule);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  const stopped = Date.now();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", partial: false, leftovers: 1 });
  // The card says that what the run wrote stays as it is, since nothing recorded it.
  await expectStoppedFiling(
    capsule,
    "Plant tulips in October",
    "Your words are back in the inbox. The agent's partial edits stay as they are, because nothing recorded them. The evening review files your words at 21:00.",
  );
  // What the run wrote stays, as the state says; the words are in the inbox.
  expect(exists(library, "goals/half.md")).toBe(true);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  // The card hides itself after 6 s, as a card that is filed does after 8.
  await expect.poll(() => capsuleKind(app), { timeout: 15_000, intervals: [100] }).toBe("hidden");
  expect(Date.now() - stopped).toBeGreaterThanOrEqual(5_000);
  await app.close();
});

test("Stop while Avanzel is quitting does nothing: the quit has stopped the run already", async () => {
  await quitWhileHeld(
    (app) => watchStates(app),
    SHORT_QUIT_WAIT,
    async (app) => {
      await stop(await windowFor(app, "capsule"));
      await sleep(500);
      expect(await statesSent(app)).toEqual([]); // the card is told nothing: it is not stopping, and nothing is taken back
    },
  );
});

test("Stop whose take-back git refuses says the stopped run's edits stay as their own commit", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await watchUndos(app, { hold: true });
  await stop(capsule);
  // The stopped run is over, and its leftovers are committed, when the take-back is at the door.
  await expect.poll(() => reachedUndo(app), { timeout: 30_000 }).toBe(true);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: leftovers of failed filing /);
  // A change by hand to the page the run started is committed after them: taking them back would take it with them, so git refuses.
  writeFileSync(path.join(library, "goals", "half.md"), "# Half done, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", partial: true, leftovers: 0 });
  // The card says that the stopped run's edits are kept as their own commit, and that the words are safe all the same.
  await expectStoppedFiling(
    capsule,
    "Plant tulips in October",
    "Your words are back in the inbox, untouched. fake's partial edits are kept as their own commit in the library's history. The evening review files your words at 21:00.",
  );
  expect(read(library, "goals/half.md")).toBe("# Half done, by hand\n");
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]); // the words are safe all the same
  await app.close();
});

// Stop can come between the agent's end and the result: the engine has handed the result back, and the app has not yet looked at
// it. These make it come then (`stopAtTheEnd`), which no press of a button can time.

test("Stop just as the run ends leaves a filing that no commit holds standing, and the card says filed", async () => {
  // No git, so the filing has no commit: nothing could take it back, and the note is archived and the page written.
  const library = await makeLibrary();
  const { app, userData } = await launchOn(library);
  await stopAtTheEnd(app);
  await watchStates(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "idleForTests");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: false, noted: false, pages: [{ shelf: "ideas", created: true }] });
  // Stop reached the card, which said it was stopping, and the filing stood: the card was never Stopped.
  const sent = await statesSent(app);
  expect(sent.some((state) => state.kind === "filing" && state.cancelling === true)).toBe(true);
  expect(sent.map((state) => state.kind)).not.toContain("cancelled");
  expect(sent.at(-1)?.kind).toBe("filed");
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  // It is a filing that ended well, so its seconds are kept.
  expect(durationsKept(userData, library).fake).toHaveLength(1);
  await app.close();
});

test("Stop just as the run ends takes back a filing that left a commit, and the note is back in the inbox", async () => {
  const library = await makeLibrary({ git: true });
  const { app, userData } = await launchOn(library);
  await stopAtTheEnd(app);
  await watchStates(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("cancelled");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "cancelled", text: "Plant tulips in October", partial: false, leftovers: 0 });
  // The filing was whole when Stop came; it is taken back, so its page is gone and the note is in the inbox, not archived.
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(archived(library)).toEqual([]);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: undo file /);
  expect(gitOut(library, "status", "--porcelain")).toBe("");
  expect(await kindsSent(app)).not.toContain("filed"); // never shown as filed
  await call(app, "idleForTests");
  expect(durationsKept(userData, library)).toEqual({}); // and a filing taken back says nothing of how long a filing takes
  await app.close();
});

test("Stop just as the run ends, when git won't take the finished filing back, says so and leaves it filed", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await stopAtTheEnd(app, { hold: true });
  await watchStates(app);
  await dictate(app);
  await expect.poll(() => reachedTheEnd(app), { timeout: 60_000 }).toBe(true);
  // The agent has filed, and the filing is committed. A change by hand to its page is committed after it, so git can't take it back.
  const [page] = filesUnder(library, "ideas");
  writeFileSync(path.join(library, "ideas", page!), "# Changed by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  // The card names Stop, which was pressed after the filing had finished, and says the filing stands: it never says the words are
  // back in the inbox. There is nothing to fix here (a way to show the history is not built), so Hide alone.
  const title = "Stop couldn't take back a filing that had finished.";
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: BOTH_VERSIONS });
  await expectProblem(capsule, { title, lines: [BOTH_VERSIONS] });
  expect(await kindsSent(app)).not.toContain("cancelled");
  expect(read(library, `ideas/${page}`)).toBe("# Changed by hand\n");
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

// ---- A Stop whose card has gone: hidden, or replaced by another recording's ----
//
// A card that is gone can't say how the stop ended, so a notification does, with the card's words, when there is something to tell: the
// filing stands because git won't take it back, or the stopped run's edits stay. A stop that left the library as it was has nothing to
// tell. These hold the result of the filing when the engine hands it back (`holdTheEnd`), so that the card can be taken away after
// Stop has been pressed and before the stop is over.

/**
 * From now on, a filing's result is held when the engine hands it back (`atTheEnd` says that it is, `letItEnd` lets it go): the agent
 * has ended, and the app has not yet looked at what it did. The test presses Stop, and takes the card away, in between.
 */
async function holdTheEnd(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: Wrappable }).__avanzel;
    const librarian = controller.librarian.bind(controller);
    controller.librarian = async (harness) => {
      const made = await librarian(harness);
      const file = made.file.bind(made);
      made.file = async (...args) => {
        const outcomes = await file(...args);
        Object.assign(globalThis, { atTheEnd: true });
        await new Promise<void>((resolve) => Object.assign(globalThis, { letItEnd: resolve }));
        return outcomes;
      };
      return made;
    };
  });
}

/** A finished filing in a library with git, Stop pressed after it, and a change by hand to its page committed since: git won't take it back. */
async function stoppedAfterItFiled(): Promise<{ app: ElectronApplication; capsule: Page; library: string; page: string }> {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await holdTheEnd(app);
  await dictate(app);
  await expect.poll(() => reachedTheEnd(app), { timeout: 60_000 }).toBe(true);
  await stop(capsule); // after the agent, before the result
  const [page] = filesUnder(library, "ideas");
  writeFileSync(path.join(library, "ideas", page!), "# Changed by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await watchStates(app); // what the capsule is sent from here on
  return { app, capsule, library, page: page! };
}

const FINISHED = "Stop couldn't take back a filing that had finished.";

test("a Stop that git won't take back, whose card was hidden, tells it in a notification, and the filing stands", async () => {
  const { app, library, page } = await stoppedAfterItFiled();
  await call(app, "dismiss"); // the person hides the card
  expect(await capsuleKind(app)).toBe("hidden");
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await call(app, "idleForTests");
  // The words are the card's. Nothing brings the hidden card back, and nothing else was sent to it.
  expect(await call(app, "notificationsForTests")).toEqual([{ title: FINISHED, body: BOTH_VERSIONS }]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await kindsSent(app)).toEqual(["hidden"]);
  expect(read(library, `ideas/${page}`)).toBe("# Changed by hand\n");
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a Stop that git won't take back, whose card another recording replaced, tells it in a notification and leaves that card alone", async () => {
  const { app } = await stoppedAfterItFiled();
  await call(app, "toggleDictate"); // the next thought takes the card
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([{ title: FINISHED, body: BOTH_VERSIONS }]);
  expect(await capsuleKind(app)).toBe("listening");
  expect(await kindsSent(app)).not.toContain("error");
  await call(app, "cancelRecording");
  await app.close();
});

test("a Stop whose card is up says it on the card, and notifies nothing", async () => {
  const { app, capsule } = await stoppedAfterItFiled();
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await expectProblem(capsule, { title: FINISHED, lines: [BOTH_VERSIONS] });
  expect(await call(app, "notificationsForTests")).toEqual([]);
  await app.close();
});

test("a Stop whose take-back git refuses, with its card hidden, notifies that the stopped run's edits stay as their own commit", async () => {
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October");
  await watchStates(app);
  await watchUndos(app, { hold: true });
  await stop(capsule);
  await expect.poll(() => reachedUndo(app), { timeout: 30_000 }).toBe(true);
  writeFileSync(path.join(library, "goals", "half.md"), "# Half done, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await call(app, "dismiss"); // the person hides the card while the stop is under way
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([
    {
      title: "Stopped, but some edits stay in your library.",
      body:
        "Your words are back in the inbox, untouched. fake's partial edits are kept as their own commit in the library's history. " +
        "The evening review files your words at 21:00.",
    },
  ]);
  expect(await kindsSent(app)).not.toContain("cancelled"); // the card stayed hidden
  expect(await capsuleKind(app)).toBe("hidden");
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  await app.close();
});

test("a Stop in a library without git, with its card hidden, notifies that the edits nothing recorded stay as they are", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_MODE: "slow-messy" });
  await holdTheEnd(app);
  await watchStates(app);
  await dictate(app);
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await stop(capsule); // the agent is stopped, and its result is held
  await expect.poll(() => reachedTheEnd(app), { timeout: 30_000 }).toBe(true);
  await call(app, "dismiss");
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([
    {
      title: "Stopped, but some edits stay in your library.",
      body:
        "Your words are back in the inbox. The agent's partial edits stay as they are, because nothing recorded them. " +
        "The evening review files your words at 21:00.",
    },
  ]);
  expect(await kindsSent(app)).not.toContain("cancelled");
  expect(exists(library, "goals/half.md")).toBe(true);
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  await app.close();
});

test("a Stop that leaves the library as it was, with its card hidden, says nothing", async () => {
  // In a library with git the stopped run's edits are committed and taken back whole: nothing is left to tell.
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_MODE: "slow-messy" });
  await holdTheEnd(app);
  await watchStates(app);
  await dictate(app);
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await stop(capsule);
  await expect.poll(() => reachedTheEnd(app), { timeout: 30_000 }).toBe(true);
  await call(app, "dismiss");
  await app.evaluate(() => (globalThis as Left).letItEnd?.());
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await kindsSent(app)).not.toContain("cancelled");
  expect(await capsuleKind(app)).toBe("hidden");
  expect(exists(library, "goals/half.md")).toBe(false); // taken back
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  await app.close();
});

// ---- A filing that ends after its library has been replaced or has closed ----

test("a filing's receipt names its pages from the note's own library when another opens meanwhile, and leaves the menu to the open one", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const { app } = await launchOn(await makeLibrary(), {
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")),
    FAKE_AGENT_DELAY_MS: "3000",
    FAKE_AGENT_DELAY_TASK: "file",
  });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await stubPicker(app, await makeLibrary());
  await call(app, "chooseLibrary");
  expect(await capsuleKind(app)).toBe("filing");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // The page is titled by the library the note was filed in, which only that library can tell: from the one that is open now, it
  // would be named by its file name ("idea-2026-…").
  expect(await factsOf(app)).toMatchObject({ kind: "filed", pages: [{ title: "Plant tulips in October", shelf: "ideas", created: true }] });
  // The menu lists the open library's recent pages, and this filing is not one of them.
  expect(await recentlyFiled(app)).toEqual([]);
  await app.close();
});

test("a filing that ends after its library has closed still shows its receipt", async () => {
  // A library chosen (or here, closed) is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const { app, library, userData } = await launchOn(await makeLibrary(), {
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")),
    FAKE_AGENT_DELAY_MS: "3000",
    FAKE_AGENT_DELAY_TASK: "file",
  });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // The library closes while the agent works (a folder that isn't a library is chosen, as when a disk goes away): none is open.
  await call(app, "useLibrary", path.join(tmpdir(), "avz-e2e-no-such-library"));
  expect(await capsuleKind(app)).toBe("filing");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(await factsOf(app)).toMatchObject({ kind: "filed", pages: [{ title: "Plant tulips in October", shelf: "ideas", created: true }] });
  expect(await recentlyFiled(app)).toEqual([]); // no library is open to list it
  // The filing ended well, so its seconds are kept, in the run state of the library it was filed in.
  expect(durationsKept(userData, library).fake).toHaveLength(1);
  await app.close();
});

// ---- The filing card: paper over a bar ----
//
// A filing is the person's words on a Card, with their seconds and the agent's newest step, over a bar that names the agent and
// holds Hide, Edit and Stop. The bar is a live region and its line stays the same for the whole filing; what counts or changes is
// on the paper, which is not one.

/**
 * A filing as main sends it, for the tests that read what the page draws from a state put on the capsule (`setCapsule`, as
 * contrast.spec.ts does). `over` changes some of it.
 */
const filingCard = (over: Record<string, unknown> = {}) => ({
  kind: "filing",
  text: "Plant tulips in October",
  agent: "Claude Code",
  transcribedIn: null,
  onThisMac: true,
  canEdit: true,
  rows: [],
  startedAt: Date.now(),
  estimate: 15,
  stepAt: Date.now(),
  ...over,
});

test("a filing's card is the words on paper over a bar with Hide, Edit and Stop, and the paper holds what counts and changes", async () => {
  const { app, capsule } = await steppedClaude(1000);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await snap(capsule, "2-filing-card");
  // The bar: Zel thinking, one line that names the agent, and three buttons, Hide first, quiet and icon-only.
  const bar = capsule.getByRole("status");
  await expect(zel(capsule)).toHaveAttribute("data-mood", "thinking");
  await expect(bar.getByText("Filing with Claude Code…", { exact: true })).toBeVisible();
  const hide = bar.getByRole("button", { name: "Hide", exact: true });
  await expect(hide).toHaveAttribute("data-variant", "quiet");
  await expect(hide).toHaveAttribute("data-size", "small");
  await expect(hide).toHaveAttribute("data-icon-only", "");
  for (const name of ["Edit", "Stop"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toHaveAttribute("data-variant", "secondary");
    await expect(bar.getByRole("button", { name, exact: true })).toHaveAttribute("data-size", "small");
  }
  await expect(bar.getByRole("button")).toHaveCount(3);
  // The card above it: the words, how they were made, and their seconds against the estimate (15 until the agent has done three).
  const card = capsule.getByRole("article");
  await expect(card.getByText("Thought", { exact: true })).toBeVisible();
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Transcribed on this Mac in \d+\.\d s$/)).toBeVisible();
  await expect(card).toHaveAttribute("data-ruled", ""); // the words are written on the card's ruling
  const seconds = card.getByText(/^\d+ s of about 15$/);
  await expect(seconds).toBeVisible();
  // None of it is in the bar's live region, so VoiceOver hears a filing start and end, and not each second or each step.
  expect(await seconds.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await expect(bar.getByText(/ s( of about \d+)?$/)).toHaveCount(0);
  // The agent's steps come as the card's newest line, one after another, outside the live region too.
  const step = card.getByText(/^(Reading your library index|New idea page: Plant tulips in October|Updated your library index|Added a line to the log)$/);
  await expect(step).toBeVisible({ timeout: 30_000 });
  expect(await step.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await expect(bar.getByText("Filing with Claude Code…", { exact: true })).toBeVisible(); // the bar's line stayed as it was
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await app.close();
});

test("a filing card counts its seconds on the paper, towards the estimate and past it, and counts again from its own start", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const card = capsule.getByRole("article");
  // Each count is read within a second of the state being put there, so it may already be one more than it was put at.
  // Towards the estimate: whole seconds, and about how many it is. The card goes on counting by itself.
  await call(app, "setCapsule", filingCard({ startedAt: Date.now() - 6_000 }));
  await expect(card.getByText(/^[67] s of about 15$/)).toBeVisible();
  // (Any later count will do: the poll that reads it comes once a second, and a Mac that is busy may read it a second late.)
  await expect(card.getByText(/^(8|9|1[0-4]) s of about 15$/)).toBeVisible({ timeout: 8_000 });
  // Past it, it just counts.
  await call(app, "setCapsule", filingCard({ startedAt: Date.now() - 18_000 }));
  await expect(card.getByText(/^(18|19) s$/)).toBeVisible();
  // An agent that files in about no time has an estimate of 0 or 1 (the tests' fake one does). "Of about 0" is no estimate, so the
  // seconds that have reached the estimate are only counted.
  await call(app, "setCapsule", filingCard({ estimate: 0 }));
  await expect(card.getByText(/^[01] s$/)).toBeVisible();
  await call(app, "setCapsule", filingCard({ estimate: 2, startedAt: Date.now() - 2_000 }));
  await expect(card.getByText(/^[23] s$/)).toBeVisible();
  // A filing queued behind another counts from its own turn: when its start moves forward, the count starts again.
  await call(app, "setCapsule", filingCard({ startedAt: Date.now() - 18_000 }));
  await expect(card.getByText(/^(18|19) s$/)).toBeVisible();
  await call(app, "setCapsule", filingCard({ startedAt: Date.now() }));
  await expect(card.getByText(/^[01] s of about 15$/)).toBeVisible();
  // While it waits for the library it has no seconds to count: the card says it waits.
  await call(app, "setCapsule", filingCard({ waiting: true, startedAt: Date.now() - 6_000 }));
  await expect(card.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible();
  await expect(capsule.getByText(/^\d+ s( of about \d+)?$/)).toHaveCount(0);
  await app.close();
});

test("a filing card's line is the agent's newest step, or says it is still working after eight quiet seconds, or that it waits", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const card = capsule.getByRole("article");
  const bar = capsule.getByRole("status");
  const rows = [
    { kind: "read", path: "index.md", title: "index", shelf: "" },
    { kind: "new", path: "ideas/podcast.md", title: "Indie game dev podcast", shelf: "ideas" },
  ];
  const newest = card.getByText("New idea page: Indie game dev podcast", { exact: true });
  const working = card.getByText("Claude Code is still working…", { exact: true });
  // Before the first step there is no line, only how the words were made.
  await call(app, "setCapsule", filingCard({ transcribedIn: 1.4 }));
  await expect(card.getByText("Transcribed on this Mac in 1.4 s", { exact: true })).toBeVisible();
  await expect(card.getByText(/Reading|New idea|Updated|Added|still working|Waiting/)).toHaveCount(0);
  // Then the newest step, and only it, over how the words were made.
  await call(app, "setCapsule", filingCard({ rows }));
  await expect(newest).toBeVisible();
  await expect(card.getByText("Reading your library index", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Typed note", { exact: true })).toBeVisible();
  // Eight quiet seconds: the line says the agent is at it, and the bar's line is what it was.
  await call(app, "setCapsule", filingCard({ rows, stepAt: Date.now() - 9_000 }));
  await expect(working).toBeVisible();
  await expect(newest).toHaveCount(0);
  await expect(bar).not.toContainText("still working");
  await expect(bar.getByText("Filing with Claude Code…", { exact: true })).toBeVisible();
  // A step ends the quiet, even one that adds no row: the newest step is the line again.
  await call(app, "setCapsule", filingCard({ rows, stepAt: Date.now() }));
  await expect(newest).toBeVisible();
  await expect(working).toHaveCount(0);
  // The clock moves it, not a new state: 5.5 quiet seconds is not yet eight, and 2.5 s later it is.
  await call(app, "setCapsule", filingCard({ rows, stepAt: Date.now() - 5_500 }));
  await expect(newest).toBeVisible();
  await expect(working).toBeVisible({ timeout: 6_000 });
  // Waiting for the library comes before both, however quiet it has been.
  await call(app, "setCapsule", filingCard({ rows, stepAt: Date.now() - 20_000, waiting: true }));
  await expect(card.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible();
  await expect(working).toHaveCount(0);
  await expect(newest).toHaveCount(0);
  await app.close();
});

test("a long thought is cut off after four lines and keeps its line breaks, and a long step is cut off after one, so the card fits the panel", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const long = "I want to launch my podcast about indie game development before the end of the year, and ask Mark to co-host. ".repeat(12).trim();
  const detail = "Only your words were kept: raw/audio/2026/10 isn't a plain folder. Remove the link or file on its path to keep recordings.";
  const title = "An idea page whose title goes on and on about indie game development and the podcast that Mark may co-host this year";
  // The worst card: the most words, every line of the footer, and a note of two lines.
  await call(
    app,
    "setCapsule",
    filingCard({ text: long, transcribedIn: 1.4, detail, rows: [{ kind: "new", path: "ideas/podcast.md", title, shelf: "ideas" }] }),
  );
  const card = capsule.getByRole("article");
  const words = card.getByText(long, { exact: true });
  await expect(words).toBeVisible();
  // All the words are in the page (to select and to read aloud), and four lines of the card's ruling show: the box is as tall as
  // four of the card's own lines (21 px each now), whatever its line pitch is.
  const cut = await words.evaluate((el) => ({ shown: el.clientHeight, whole: el.scrollHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(cut.shown).toBe(4 * cut.pitch);
  expect(cut.whole).toBeGreaterThan(cut.shown);
  // A step with a long title stays on one line: it is cut off, and the card is no wider than the bar.
  const step = card.getByText(`New idea page: ${title}`, { exact: true });
  await expect(step).toBeVisible();
  expect(await step.evaluate((el) => ({ lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)), cut: el.scrollWidth > el.clientWidth }))).toEqual({ lines: 1, cut: true });
  const cardBox = (await card.boundingBox())!;
  const barBox = (await capsule.getByRole("status").boundingBox())!;
  expect(cardBox.width).toBe(barBox.width);
  // And the panel holds it all, from the top of the card to the bottom of the bar, with a little room to spare.
  const panel = await capsule.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(cardBox.y).toBeGreaterThanOrEqual(8);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(panel.height);
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(panel.width);
  // The person's line breaks are kept: two lines of words stand on two lines of the ruling, as they were written.
  await call(app, "setCapsule", filingCard({ text: "First line of a corrected thought.\nSecond line." }));
  const broken = card.getByText("First line of a corrected thought. Second line.", { exact: true });
  await expect(broken).toBeVisible();
  expect(await broken.evaluate((el) => el.clientHeight)).toBe(42);
  await app.close();
});

test("a filing card says the agent is still working once eight seconds pass with no step", async () => {
  // The stand-in takes twelve seconds before it does anything (FAKE_AGENT_DELAY_MS), and then files at once, so the line shows for
  // about four seconds, from the eighth: long enough for a once-a-second poll on a busy Mac. Not FAKE_AGENT_STEP_MS: that pauses
  // before every step, which would pass the library's 30 s limit.
  const bin = agentStubs({ claude: filingClaude() });
  const { app, capsule } = await claudeLibrary(bin, { env: { FAKE_AGENT_DELAY_MS: "12000", FAKE_AGENT_DELAY_TASK: "file" } });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  const began = Date.now();
  const working = capsule.getByRole("article").getByText("Claude Code is still working…", { exact: true });
  await expect(working).not.toBeVisible();
  await expect(working).toBeVisible({ timeout: 20_000 });
  // Not before the quiet: the filing began a moment before the page was told of it.
  expect(Date.now() - began).toBeGreaterThan(6_000);
  expect(await working.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await app.close();
});

test("Stop on the filing card is busy while the stop waits for the library, and the card then offers no Edit", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library);
  // Another process has the library, so the filing waits for it, and the stop can't end until it lets go.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => factsOf(app), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true, canEdit: true });
    const bar = capsule.getByRole("status");
    const stopButton = bar.getByRole("button", { name: "Stop", exact: true });
    await expect(bar.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(stopButton).not.toHaveAttribute("aria-busy", "true");
    await stopButton.click();
    // The button keeps its name and is busy, Edit is gone (main would ignore it), and both lines say what they said.
    await expect(stopButton).toHaveAttribute("aria-busy", "true");
    await expect(bar.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(bar.getByText("Filing with fake…", { exact: true })).toBeVisible();
    await expect(capsule.getByRole("article").getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible();
    // The stop is under way until the library is free, however long: a press on a busy button does nothing more.
    await stopButton.click();
    await sleep(1_000);
    expect(await factsOf(app)).toMatchObject({ kind: "filing", waiting: true, cancelling: true, canEdit: false });
  } finally {
    letGo();
    await held;
  }
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  expect(inboxWords(library)).toEqual([expect.stringContaining("Plant tulips in October")]);
  await app.close();
});

test("a filing queued behind a long one says it waits, however long, and never that it is still working", async () => {
  // The first filing takes twelve seconds. The second waits for it in the app's queue, with no step and no run of its own, for
  // longer than the eight quiet seconds after which a card says its agent is still working: it is not working yet.
  const { app, capsule } = await launchOn(await makeLibrary(), { FAKE_AGENT_DELAY_MS: "12000", FAKE_AGENT_DELAY_TASK: "file" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "submitQuick", "Call the plumber on Monday");
  await expect.poll(() => factsOf(app), { timeout: 10_000 }).toMatchObject({ kind: "filing", text: "Call the plumber on Monday", waiting: true });
  const card = capsule.getByRole("article");
  const watched = Date.now();
  let looks = 0;
  while (Date.now() - watched < 8_600) {
    // Through the eighth second and a little past it: the card, as a person reads it, and the state it is drawn from.
    expect(await card.getByText(/is still working/).count()).toBe(0);
    expect(await card.getByText("Waiting for another Avanzel run to finish…", { exact: true }).count()).toBe(1);
    expect(await factsOf(app)).toMatchObject({ kind: "filing", text: "Call the plumber on Monday", waiting: true });
    looks++;
    await sleep(250);
  }
  expect(looks).toBeGreaterThan(10);
  // Its turn comes when the first is filed: the wait is over, and its own run has begun.
  await expect.poll(async () => (await factsOf(app)).waiting ?? false, { timeout: 30_000, intervals: [100] }).toBe(false);
  expect(await factsOf(app)).toMatchObject({ kind: "filing", text: "Call the plumber on Monday" });
  await stop(capsule); // the second filing is given up: there is no need to wait twelve seconds more for it
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  await app.close();
});
