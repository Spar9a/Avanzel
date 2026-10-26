// Filing with the agent: Edit or Stop while it runs, quitting while it runs, and runs that fail.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, git, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import {
  agentCalls,
  agentStubs,
  alive,
  answerAs,
  call,
  capsuleKind,
  exists,
  filesUnder,
  filingClaude,
  filingCodex,
  gitOut,
  launch,
  limitedClaude,
  limitedClaudeFor,
  limitedCodexFor,
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  read,
  recentlyFiled,
  resetReported,
  shown,
  SIGNED_IN,
  signedOutClaude,
  snap,
  speechWav,
  stubPicker,
  tomorrowAtNine,
  windowFor,
} from "./helpers.ts";
import { failingClaude } from "./setup-helpers.ts";

const inbox = (root: string) => filesUnder(root, "inbox");
/** What each capture waiting in the inbox says. */
const inboxWords = (root: string) => inbox(root).map((name) => read(root, `inbox/${name}`));
const archived = (root: string) => filesUnder(root, "raw").filter((rel) => rel.endsWith(".md")).map((rel) => path.join(root, "raw", rel));
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
  const { library, app, capsule } = await dictateToStallingAgent("Remember to email Mark the hygienic plan");
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
  await expect(capsule.getByRole("alert")).toContainText(FIRST_TRY);
  await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]); // nothing to fix
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
  const words = await quitWhileHeld((app, capsule) => editTo(app, capsule, "corrected words"), SHORT_QUIT_WAIT);
  // The corrected words are written anyway, with the recording and transcriber of the misheard ones, which stay too.
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  const [corrected] = words.filter((text) => text.includes("corrected words"));
  expect(corrected).toContain("\ntranscriber: fake\n");
  expect(corrected).toMatch(/\naudio: raw\/audio\/.+\.wav\n/);
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
    // Not an agent's failure: its own title, the error's line and what keeps the words, and OK only, so that nothing
    // files the misheard capture again.
    await expect(capsule.getByRole("alert")).toContainText("Your corrected words weren't saved yet.");
    await expect(
      capsule.getByText("Your corrected words are saved to your inbox when you quit; the original note is still there.", { exact: false }),
    ).toBeVisible();
    await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]);
    expect(await cardNote(app)).toBeNull(); // no note for the card to file again
    expect(await call(app, "capsuleStateForTests")).toEqual({
      kind: "error",
      message: "Your corrected words weren't saved yet.",
      detail: expect.stringMatching(/^EACCES: permission denied.*\nYour corrected words are saved to your inbox when you quit; the original note is still there\.$/),
    });
    // The error names two long paths: its line is cut short, so the card, which shows about four lines of its body, shows all of
    // it, what keeps the words last.
    const { detail } = (await call(app, "capsuleStateForTests")) as { detail: string };
    expect(Array.from(detail.split("\n")[0]!).length).toBeLessThanOrEqual(100);
    expect(detail.split("\n")[0]!.endsWith("…")).toBe(true);
    expect(await capsule.locator(".detail").evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
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
  const { library, app, capsule } = await dictateToStallingAgent("misheard words");
  await editTo(app, capsule, "corrected words");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await call(app, "idleForTests");
  expect(inboxWords(library)).toEqual([expect.stringContaining("corrected words")]);
  expect(mentioning(library, "misheard")).toEqual([]);
  expect(exists(library, "goals/half.md")).toBe(false);
  await app.close();
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
  await expect(capsule.getByText(/partial edits are kept as their own commit in the library's history/)).toBeVisible();
  // Any other failure keeps the agent's own line, as a sentence, then what is safe and what the agent left behind. Its one
  // fix files the note again with the same agent.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "fake couldn't file this note.",
    detail:
      "Agent crashed: cannot file this one. Your note is safe in the inbox; the evening review will try again. " +
      "fake's partial edits are kept as their own commit in the library's history.",
    action: "refile:fake",
    actionLabel: "Try again",
  });
  await expect(capsule.getByRole("button")).toHaveText(["×", "Try again", "OK"]);
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
  expect(state.detail).toBe(
    "A symlink in inbox/ kept Avanzel from putting back the words the agent changed. " +
      `Your words are kept in .avanzel/logs/${kept}, and the inbox holds the agent's version; the evening review will try again. ` +
      "Its partial edits stay in the library, outside its history, so they can't be undone.",
  );
  await app.close();
});

// ---- The card a failed filing ends in: what happened, what is safe, and the one fix ----
//
// Each of these files with Claude Code, whose stand-in `claude` acts as the test made it (filingClaude), on a Mac whose only
// agents are the stand-ins in the test's folder (onlyAgentsIn): which other agents are installed decides the card.

/** What `claudeLibrary` takes: the limit of its runs, whether its evening review is on, and more variables to launch with. */
type ClaudeLibraryOptions = { timeoutSeconds?: number; eveningReview?: boolean; env?: Record<string, string> };

/**
 * A library that Claude Code files, opened on a Mac whose only agents are the stand-ins in `bin`. `timeoutSeconds` is the
 * limit of its runs, `eveningReview` whether the library's evening review is on, and `env` more variables for the app.
 */
async function claudeLibrary(bin: string, { timeoutSeconds = 30, eveningReview = true, env = {} }: ClaudeLibraryOptions = {}) {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude", timeoutSeconds });
  if (!eveningReview) {
    const file = path.join(library, "tasks", "evening-review.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("enabled: true", "enabled: false"));
  }
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    ...onlyAgentsIn(bin),
    ...env,
  });
  return { library, app, capsule: await windowFor(app, "capsule") };
}

/** Records "Plant tulips in October" and files it. */
async function dictate(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
}

/** `claudeLibrary`, dictated to, and waited for until the capsule shows the card the filing failed with. */
async function failedWithClaude(bin: string, options?: ClaudeLibraryOptions) {
  const opened = await claudeLibrary(bin, options);
  await dictate(opened.app);
  await expect.poll(() => capsuleKind(opened.app), { timeout: 60_000 }).toBe("error");
  return opened;
}

/** The file name of the note the capsule's failure card is about, which its button files again; null while it shows no such card. */
async function cardNote(app: ElectronApplication): Promise<string | null> {
  const capture = (await call(app, "cardCaptureForTests")) as string | null;
  return capture === null ? null : path.basename(capture);
}

/** A usage-limit wait, as the app keeps it with its library: the note, the agent that was stopped, and the epoch ms it files at. */
type Wait = { capture: string; agent: string; until: number };

/** The usage-limit waits the app keeps for `library`, read from its run state (run-state.json in its user data folder). */
async function waitsOf(app: ElectronApplication, library: string): Promise<Wait[]> {
  const file = path.join(await app.evaluate(() => process.env.AVANZEL_USER_DATA ?? ""), "run-state.json");
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, { waiting?: Wait[] }>;
  return state[path.resolve(library)]?.waiting ?? [];
}

test("a usage limit names its reset and offers another agent", async () => {
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: limitedClaude() }));
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.";
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  // The one fix is the best other agent, here Codex's stand-in: the card's button names it. OK stays beside it.
  await expect(capsule.getByRole("button")).toHaveText(["×", "File it with Codex now", "OK"]);
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: body,
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await snap(capsule, "5-error-limit");
  // The note stays in the inbox, the card remembers which note it is about, and offering Codex ran nothing of Codex's.
  const [note] = inbox(library);
  expect(note).toBeDefined();
  expect(await cardNote(app)).toBe(note);
  expect((await agentCalls(app)).filter((line) => line.startsWith("codex"))).toEqual([]);
  // The card shown again, as its page reloads, is the same card: the note stays with it. It goes when the card does.
  await capsule.reload();
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  expect(await cardNote(app)).toBe(note);
  await call(app, "dismiss");
  expect(await cardNote(app)).toBeNull();
  await app.close();
});

test("a usage limit with no other agent offers no fix", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  answerAs(bin, "claude", limitedClaude()); // the only agent on this Mac
  const { library, app, capsule } = await failedWithClaude(bin);
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.";
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: "Claude Code has hit its usage limit.", detail: body });
  expect(inbox(library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]); // a card with no button still remembers its note
  await app.close();
});

test("a sign-in failure opens Terminal", async () => {
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) })); // "not logged in"
  const body = "Run claude once in Terminal and sign in, and your note will be filed straight away.";
  await expect(capsule.getByRole("alert")).toContainText("Claude Code isn't signed in on this Mac.");
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["×", "Open Terminal", "OK"]);
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code isn't signed in on this Mac.",
    detail: body,
    action: "open-terminal",
    actionLabel: "Open Terminal",
  });
  await snap(capsule, "5-error-signin");
  expect(await call(app, "openedForTests")).toEqual([]);
  await capsule.getByRole("button", { name: "Open Terminal", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]); // Terminal itself stays shut under test
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a timeout says how long it had", async () => {
  // The stand-in echoes a long prompt and then never finishes, so the run is stopped at the library's limit.
  const { app, capsule } = await failedWithClaude(agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "slow-noisy" }) }), { timeoutSeconds: 2 });
  const body = "Your note is safe in the inbox; the evening review will try again.";
  await expect(capsule.getByRole("alert")).toContainText("Claude Code took longer than 2 s and was stopped.");
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["×", "Try again", "OK"]);
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code took longer than 2 s and was stopped.",
    detail: body,
    action: "refile:claude",
    actionLabel: "Try again",
  });
  await app.close();
});

/** An agent's line of 280 characters that is none of a limit, a sign-in or a timeout: the engine allows 300. */
const LONG_LINE = `Error: ${"the agent went on about what it could not do and why it could not do it, ".repeat(4)}and then it stopped`.slice(0, 280);
const SAFE_LATER = "Your note is safe in the inbox; the evening review will try again.";

test("a long line of the agent's is shortened on the card, so the sentence that says what is safe is in view", async () => {
  // The legacy card shows about four lines of its body: left whole, this line would push the safe sentence out of sight.
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: failingClaude(LONG_LINE) }));
  const state = (await call(app, "capsuleStateForTests")) as { kind: string; message: string; detail: string };
  expect(state.message).toBe("Claude Code couldn't file this note.");
  expect(state.detail.endsWith(SAFE_LATER)).toBe(true);
  const line = state.detail.slice(0, state.detail.length - SAFE_LATER.length).trimEnd();
  expect(Array.from(line).length).toBeLessThanOrEqual(100);
  expect(line.endsWith("…")).toBe(true);
  expect(line.startsWith("The agent went on about what it could not do")).toBe(true);
  // The card shows all of its body, the safe sentence last: nothing is cut off by its height.
  const detail = capsule.locator(".detail");
  await expect(detail).toHaveText(`${line} ${SAFE_LATER}`);
  expect(await detail.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a long line of the agent's is shortened in the notification too, when the card is gone", async () => {
  // The stand-in takes a moment, so the person can close the card before the run fails.
  const slowlyFailing = `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else sleep 2; echo '${LONG_LINE}' >&2; exit 1; fi`;
  const { library, app } = await claudeLibrary(agentStubs({ claude: slowlyFailing }));
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "dismiss");
  await expect.poll(() => call(app, "notificationsForTests"), { timeout: 30_000 }).toHaveLength(1);
  const [note] = (await call(app, "notificationsForTests")) as { title: string; body: string }[];
  expect(note!.title).toBe("Claude Code couldn't file this note.");
  expect(note!.body.endsWith(SAFE_LATER)).toBe(true);
  const line = note!.body.slice(0, note!.body.length - SAFE_LATER.length).trimEnd();
  expect(Array.from(line).length).toBeLessThanOrEqual(100);
  expect(line.endsWith("…")).toBe(true);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a library whose evening review is off promises no review", async () => {
  // A plain-text agent's limit names no reset, so the card has no moment to promise. With the evening review off it has no
  // one to promise either: it says only that the note is safe.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "limit" }) });
  const { app, capsule } = await failedWithClaude(bin, { eveningReview: false });
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  await expect(capsule.getByText("Your note is safe in the inbox.", { exact: true })).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "Your note is safe in the inbox.",
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await app.close();
});

test("a library whose own agent is gone says so", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  answerAs(bin, "codex", SIGNED_IN.codex!); // this Mac has Codex, but the library's agent is Claude Code
  const { library, app, capsule } = await failedWithClaude(bin);
  const body = "Your note is safe in the inbox. Settings → Agents can choose another agent, or has its install command.";
  await expect(capsule.getByRole("alert")).toContainText("Claude Code isn't installed on this Mac any more.");
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["×", "Open Settings", "OK"]);
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code isn't installed on this Mac any more.",
    detail: body,
    action: "open-settings:agents",
    actionLabel: "Open Settings",
  });
  expect(inbox(library)).toHaveLength(1);
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Agents", exact: true })).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("a library whose settings can't be read says so, and not that no agent is installed", async () => {
  // Claude Code is installed, and the library's own settings file is what is wrong: the card says that, in the file's words.
  const library = await makeLibrary();
  writeFileSync(path.join(library, ".avanzel", "config.toml"), 'harness = "claude"\ntimeout_seconds =\n');
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const capsule = await windowFor(app, "capsule");
  await call(app, "submitQuick", "Plant tulips in October"); // typed: recording reads the settings too
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // No agent can be named, so Avanzel couldn't file it; and no agent can be retried, and the file is mended by hand: OK alone.
  const state = (await call(app, "capsuleStateForTests")) as { message: string; detail: string };
  expect(state).toEqual({
    kind: "error",
    message: "Avanzel couldn't file this note.",
    detail: expect.stringMatching(/config\.toml: invalid TOML at line 2, column \d+: .+\. Your note is safe in the inbox; the evening review will try again\.$/),
  });
  await expect(capsule.getByText(/config\.toml: invalid TOML at line 2/)).toBeVisible();
  await expect(capsule.getByText("needs an AI agent")).toHaveCount(0);
  await snap(capsule, "5-error-settings");
  await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]);
  expect(inbox(library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  await app.close();
});

test("a failure whose card is gone notifies with the same words", async () => {
  // The stand-in takes a moment, so the person can close the card before the run fails.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail", FAKE_AGENT_DELAY_MS: "2000" }) });
  const { library, app } = await claudeLibrary(bin);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "dismiss");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 30_000 })
    .toEqual([
      {
        title: "Claude Code isn't signed in on this Mac.",
        body: "Run claude once in Terminal and sign in, and your note will be filed straight away.",
      },
    ]);
  expect(await capsuleKind(app)).toBe("hidden"); // the failure doesn't bring the closed card back
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

// ---- The card's one button files the note again ----
//
// File it with … now and Try again file the note the card is about at once, as any note is filed: the capsule shows the
// filing, and the agent is the one the button names.

/** How many filing runs `agent`'s stand-in was asked for in `calls` (agentCalls): Claude Code's are `claude -p …`, Codex's `codex exec …`. */
const filingRuns = (calls: readonly string[], agent: "claude" | "codex") =>
  calls.filter((line) => line.startsWith(agent === "claude" ? "claude -p " : "codex exec ")).length;

test("File it with Codex now files the note with Codex", async () => {
  // Claude Code is at its limit. The Codex stand-in takes a moment, so the filing can be seen before it ends, even when the
  // machine is busy.
  const resetsAt = tomorrowAtNine();
  const bin = agentStubs({ claude: limitedClaude(resetsAt), codex: filingCodex({ FAKE_AGENT_DELAY_MS: "4000" }) });
  const { library, app, capsule } = await failedWithClaude(bin);
  const [note] = inbox(library);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1); // the run that hit the limit
  // The limit's wait is kept for the note: a minute after the reset, unless the test shortens that.
  expect(await waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: resetsAt * 1000 + 60_000 }]);

  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  // The note is filed as any is: the capsule shows the filing, with Codex, the note's words and how it was captured.
  await expect.poll(() => capsuleKind(app)).toBe("filing");
  await expect(capsule.getByText("Filing with Codex…")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filing",
    agent: "Codex",
    text: "Plant tulips in October",
    transcribedIn: expect.any(Number), // a spoken note, as it was
  });
  // A second click on the button, which can reach main before the page has drawn that filing, files nothing more.
  await call(app, "openSettingsFor", "refile:codex");
  expect(await capsuleKind(app)).toBe("filing");

  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", agent: "Codex" });
  // The note left the inbox for the archive, and Codex wrote its page.
  expect(inbox(library)).toEqual([]);
  expect(archived(library).map((file) => path.basename(file))).toEqual([note]);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  // Codex was asked once, though the button was pressed twice, and Claude Code was not asked again.
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(1);
  expect(filingRuns(calls, "claude")).toBe(1);
  // The note is filed, so the wait for Claude Code's reset has nothing left to file: were the filing undone, it must not come back.
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("Try again files the note with the same agent", async () => {
  // Claude Code's first run hangs and is stopped at the library's 2 s; its next run files. Codex is installed too.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() }) });
  const { library, app, capsule } = await failedWithClaude(bin, { timeoutSeconds: 2 });
  await expect(capsule.getByRole("alert")).toContainText("Claude Code took longer than 2 s and was stopped.");
  const [note] = inbox(library);

  await capsule.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Claude Code")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "claude")).toBe(2); // the run that was stopped, and this one
  expect(filingRuns(calls, "codex")).toBe(0);
  await app.close();
});

/**
 * Presses a failure card's button, as its page does when clicked (`openSettingsFor`), and reads the capsule's state and whether
 * anything is queued in that same turn of main. What the button does at once is all this sees: a filing that is queued shows
 * its card (`filing`) and is queued by then, while a note that is found gone from the inbox closes the card and queues nothing.
 */
async function pressAtOnce(app: ElectronApplication, action: string): Promise<{ kind: string; busy: boolean }> {
  return app.evaluate((_electron, pressed) => {
    const controller = (globalThis as unknown as {
      __avanzel: { openSettingsFor(action: string): void; capsuleStateForTests(): { kind: string }; busy(): boolean };
    }).__avanzel;
    controller.openSettingsFor(pressed);
    return { kind: controller.capsuleStateForTests().kind, busy: controller.busy() };
  }, action);
}

test("a note filed meanwhile isn't filed twice", async () => {
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app } = await failedWithClaude(bin);
  // The evening review, or another Avanzel, files the note while its card is up: it is in the archive now.
  const [note] = inbox(library);
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));

  // The button finds the note gone and only closes the card: at once, with no filing queued to find that out later.
  expect(await pressAtOnce(app, "refile:codex")).toEqual({ kind: "hidden", busy: false });
  await call(app, "idleForTests");
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(0);
  expect(filingRuns(calls, "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  await app.close();
});

test("a limit card left up while another library opens stops promising the filing, and offers nothing that would file there", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) };
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await failedWithClaude(bin, { env });
  await expect(capsule.getByText("It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.", { exact: true })).toBeVisible();
  const [note] = inbox(library);
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");

  // The card is still up, for a note that waits in the first library's inbox and isn't in the new library's. Its wait is the
  // first library's, and files only while that library is open: the card says only what is so now, in the words of a limit
  // that nothing waits for. File it with Codex now would file a note of the open library, so it goes; OK closes the card.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.",
  });
  await expect(capsule.getByText("It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]);
  expect(await cardNote(app)).toBe(note);
  expect(await waitsOf(app, library)).toHaveLength(1); // kept with the first library, for when it opens again
  // A press of the old button that was already on its way closes the card at once and queues nothing: a filing queued for it
  // would try that note in the new library, and fail.
  expect(await pressAtOnce(app, "refile:codex")).toEqual({ kind: "hidden", busy: false });
  await call(app, "idleForTests");
  expect(inbox(library)).toHaveLength(1);
  expect(archived(other)).toEqual([]);
  await app.close();
});

test("a note whose library is switched while it is filed is promised nothing that waits, and offered nothing that would file there", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) };
  // Claude Code's filing waits until the test lets it go (`gate`), then hits its usage limit, until tomorrow.
  const gate = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-gate-")), "go");
  const held = `while [ "$1 $2" != "auth status" ] && [ ! -e '${gate}' ]; do /bin/sleep 0.1; done; ${limitedClaude()}`;
  const bin = agentStubs({ claude: held, codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin, { env });
  // The other library's evening review is off: the card speaks of the note's own library, whose review is on.
  const other = await makeLibrary();
  const review = path.join(other, "tasks", "evening-review.md");
  writeFileSync(review, readFileSync(review, "utf8").replace("enabled: true", "enabled: false"));
  await dictate(app);
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 30_000 }).toBe(1); // it runs
  await stubPicker(app, other);
  await call(app, "chooseLibrary");
  expect(await capsuleKind(app)).toBe("filing"); // the first library's filing goes on
  writeFileSync(gate, "");

  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // The app keeps no wait for a note of a library that isn't open, so the card names the reset and promises only the note's
  // own evening review. File it with Codex now, which files a note of the open library, isn't offered.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.",
  });
  await expect(capsule.getByRole("button")).toHaveText(["×", "OK"]);
  expect(await waitsOf(app, library)).toEqual([]);
  expect(await waitsOf(app, other)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a usage limit whose wait can't be kept names the reset, and promises only the evening review", async () => {
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin);
  // Started, its first look at the reviews written. From here on the app can't write its run state: each write goes through
  // run-state.json.tmp beside it, which is made read-only.
  await call(app, "capsuleStateForTests");
  const partial = path.join(await app.evaluate(() => process.env.AVANZEL_USER_DATA ?? ""), "run-state.json.tmp");
  writeFileSync(partial, "");
  chmodSync(partial, 0o444);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // No wait could be kept for the reset: the card names it, and promises only the evening review. The note is in the open
  // library, so File it with Codex now still files it.
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.";
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: body,
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await expect(capsule.getByText(body, { exact: true })).toBeVisible();
  expect(await waitsOf(app, library)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

// ---- A note stopped by a usage limit or a missing sign-in files itself once that's over ----
//
// The cards promise it ("will be filed then", "will be filed straight away"), so the app does it. A usage limit's reset is a
// wait, kept with the library so that a restart doesn't lose it; a missing sign-in is a watch of the agent's free sign-in
// check, kept in memory. Either one files the note in the background: no card of its own, and a notification says how it
// went. A card that still shows the note when a background filing ends is updated, not left promising what is not so. The
// tests shorten what takes minutes: the time after a reset before filing (AVANZEL_RESET_MARGIN_MS), and the sign-in watch's
// poll and length (AVANZEL_SIGNIN_POLL_MS, AVANZEL_SIGNIN_WATCH_MS). Each one launches on a Mac whose only agents are the
// stand-ins in its own folder (`claudeLibrary`), and a limit's reset is worked out by the stand-in when it first hits the
// limit (`limitedClaudeFor`), so that a slow launch or failure can't land after it. That stand-in hits the limit on its first
// run only, unless told more, and files on the runs after: a test that is slow under load can't miss the reset.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Waits until `epochMs` has passed. */
const sleepUntil = (epochMs: number) => sleep(Math.max(0, epochMs - Date.now()));

/** The launch variable that makes a wait file at the reset itself, not a minute after. */
const AT_THE_RESET = { AVANZEL_RESET_MARGIN_MS: "0" };

/** The agents whose sign-in the app is watching, and how many notes wait on each. */
const watches = (app: ElectronApplication) => call(app, "signInWatchesForTests") as Promise<{ agent: string; notes: number }[]>;

/** How many times the stand-in `claude` was asked for its sign-in, which is all the watch asks of it. */
const signInReads = (calls: readonly string[]) => calls.filter((line) => line === "claude auth status").length;

/**
 * `claudeLibrary` with a Claude Code that hits its usage limit, which resets `seconds` after its first run (`limitedClaudeFor`),
 * dictated to; it waits for the card of the failure. `limits` is how many of its runs hit the limit (the first only, unless
 * given; Infinity for all): it files on the runs after. `resetsAt` is the reset the stand-in gave, in epoch seconds.
 */
async function limitedFor(bin: string, seconds: number, { limits = 1, ...options }: ClaudeLibraryOptions & { limits?: number } = {}) {
  const opened = await claudeLibrary(bin, options);
  answerAs(bin, "claude", limitedClaudeFor(bin, seconds, "", limits));
  await dictate(opened.app);
  await expect.poll(() => capsuleKind(opened.app), { timeout: 60_000 }).toBe("error");
  return { ...opened, resetsAt: resetReported(bin, "claude") };
}

/** Dictates another note, and waits until the claude run it started (the `runs`th) has failed and its card shows. */
async function failAnother(app: ElectronApplication, runs: number): Promise<void> {
  await dictate(app);
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 30_000 }).toBe(runs);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
}

/** The notifications whose title is `title`, oldest first. */
async function notified(app: ElectronApplication, title: string): Promise<{ title: string; body: string }[]> {
  return ((await call(app, "notificationsForTests")) as { title: string; body: string }[]).filter((note) => note.title === title);
}

test("a note stopped by a usage limit is filed after the reset", async () => {
  const bin = agentStubs();
  const { library, app, capsule, resetsAt } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  await watchFilingStates(app);
  const [note] = inbox(library);
  // The card promises it, and the app keeps the promise: a wait for the reset, kept with the library, with the agent that was stopped.
  await expect(capsule.getByText(/^It resets (at|tomorrow at) \d\d:\d\d\. Your note is safe in the inbox and will be filed then\.$/)).toBeVisible();
  expect(await waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: resetsAt * 1000 }]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);

  // Claude Code works again by the reset (its stand-in limits only its first run): the note is filed then, in the background.
  const seen = new Set<string>();
  await expect
    .poll(async () => (seen.add(await capsuleKind(app)), inbox(library)), { timeout: 15_000, intervals: [100] })
    .toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000); // not before the reset
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(seen.has("filing")).toBe(false); // it showed no card of its own
  expect(await filingSends(app)).toEqual([]); // and none of its steps, or anything else of it, was sent to the capsule's page
  // The card of the failure, which promised the filing, goes now that the note is filed.
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  expect(archived(library).map((file) => path.basename(file))).toEqual([note]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("two notes waiting for one reset are each filed once", async () => {
  const bin = agentStubs();
  const { library, app } = await claudeLibrary(bin, { env: AT_THE_RESET });
  // The second note meets the reset the first one did; the runs after those two file.
  answerAs(bin, "claude", limitedClaudeFor(bin, 9, "", 2));
  await failAnother(app, 1);
  await failAnother(app, 2);
  const resetsAt = resetReported(bin, "claude");
  expect(inbox(library)).toHaveLength(2);
  // A wait for each note, both for that reset; in the order the notes failed in, which their names (the same second, a "-2") needn't follow.
  const waits = inbox(library).map((note) => ({ capture: path.join(library, "inbox", note), agent: "claude", until: resetsAt * 1000 }));
  const kept = await waitsOf(app, library);
  expect(kept).toHaveLength(2);
  expect(kept).toEqual(expect.arrayContaining(waits));

  await expect.poll(() => inbox(library), { timeout: 25_000 }).toEqual([]);
  await expect.poll(async () => (await notified(app, "Filed by Claude Code")).length).toBe(2);
  await call(app, "idleForTests");
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(archived(library)).toHaveLength(2);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(4); // the two that hit the limit, and one run each that filed
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a wait survives a restart", async () => {
  const bin = agentStubs();
  const first = await claudeLibrary(bin, { env: AT_THE_RESET });
  const userData = await first.app.evaluate(() => process.env.AVANZEL_USER_DATA ?? "");
  answerAs(bin, "claude", limitedClaudeFor(bin, 7));
  await dictate(first.app);
  await expect.poll(() => capsuleKind(first.app), { timeout: 60_000 }).toBe("error");
  const resetsAt = resetReported(bin, "claude");
  await first.app.close();
  expect(inbox(first.library)).toHaveLength(1);

  // Avanzel opens again with the same app data, and Claude Code works by now (its stand-in limits only its first run); the reset
  // has not come yet, or has just come.
  const app = await launch({ AVANZEL_LIBRARY: first.library, AVANZEL_USER_DATA: userData, ...onlyAgentsIn(bin), ...AT_THE_RESET });
  await expect.poll(() => inbox(first.library), { timeout: 30_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000); // it waited for the reset, whenever the app came back
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(await waitsOf(app, first.library)).toEqual([]);
  await app.close();
});

test("a wait that came due while Avanzel was closed is filed when it opens", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude" });
  const note = new Vault(library).newCapture("Plant tulips in October", { source: "text" }).path;
  // A wait for the note, and one for a note that is not in the inbox: that one has nothing to file.
  const gone = path.join(library, "inbox", "2026-10-25-100000-already-filed.md");
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const past = Date.now() - 60_000;
  writeFileSync(
    path.join(userData, "run-state.json"),
    JSON.stringify({ [library]: { checked: {}, ran: {}, waiting: [{ capture: gone, agent: "claude", until: past }, { capture: note, agent: "claude", until: past + 1 }] } }),
  );
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_USER_DATA: userData, ...onlyAgentsIn(bin) });
  await expect.poll(() => inbox(library), { timeout: 30_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note, ".md")}.md`]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a reset already past arms no wait", async () => {
  const bin = agentStubs();
  const { library, app, capsule } = await claudeLibrary(bin, { env: AT_THE_RESET });
  answerAs(bin, "claude", limitedClaude(Math.floor(Date.now() / 1000) - 60)); // the limit reset a minute ago
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // The card has no moment to promise, and the app keeps no wait.
  await expect(capsule.getByText("Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  expect(await waitsOf(app, library)).toEqual([]);
  // Claude Code files now. Were a wait armed, its time would be past, and it would file the note at once.
  answerAs(bin, "claude", filingClaude());
  await sleep(3_000);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);
  await app.close();
});

test("a limit still reported after its reset files the note once more, and no more", async () => {
  const bin = agentStubs({ codex: filingCodex() });
  // Claude Code stays at its limit and keeps saying that it reset at the same time.
  const { library, app, capsule } = await limitedFor(bin, 5, { env: AT_THE_RESET, limits: Infinity });
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the wait's run
  // That reset has passed, so there is nothing new to wait for. The card that promised the filing, which still shows the note,
  // says so in its place and offers the fix as any failure does: there is no notification besides.
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 20_000 }).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "Your note is safe in the inbox; the evening review will try again.",
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await sleep(2_500);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2); // and no more
  expect(inbox(library)).toHaveLength(1);
  // The card is a real one: its button files the note.
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a limit still reported after its reset tells a note whose card is gone by notification", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET, limits: Infinity }); // it stays at its limit
  await call(app, "dismiss"); // the person closes the card that promised the filing
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the wait's run
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 20_000 })
    .toEqual([{ title: "Claude Code has hit its usage limit.", body: "Your note is safe in the inbox; the evening review will try again." }]);
  expect(await capsuleKind(app)).toBe("hidden"); // nothing is put up for a note whose card was closed
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a note that meets the limit again waits for the next reset", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  answerAs(bin, "claude", limitedClaudeFor(bin, 5, "-next")); // by the first reset the limit has not lifted: it lifts 5 s after it is hit again
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the first wait's run
  const next = resetReported(bin, "claude", "-next");
  // That run hit the limit again, with a later reset: a wait of its own. The card that was up, which still shows the note,
  // says so (there is no notification besides).
  const [note] = inbox(library);
  await expect.poll(() => waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: next * 1000 }]);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: expect.stringMatching(/^It resets (at|tomorrow at) \d\d:\d\d\. Your note is safe in the inbox and will be filed then\.$/),
  });
  expect(await call(app, "notificationsForTests")).toEqual([]);

  // By the next reset it works again (that stand-in too limits only its first run).
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(next * 1000);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(3);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a wait files the note with the agent that was stopped, not the library's", async () => {
  // Claude Code, the library's agent, is at its limit until tomorrow. Codex is at its limit too, but only for a few seconds.
  const tomorrow = tomorrowAtNine();
  const bin = agentStubs({ claude: limitedClaude(tomorrow), codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin, { env: AT_THE_RESET });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  const [note] = inbox(library);
  answerAs(bin, "codex", limitedCodexFor(bin, 6));
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect(capsule.getByRole("alert")).toContainText("Codex has hit its usage limit.");
  const capture = path.join(library, "inbox", note!);
  const resetsAt = resetReported(bin, "codex");
  expect(await waitsOf(app, library)).toEqual([
    { capture, agent: "claude", until: tomorrow * 1000 },
    { capture, agent: "codex", until: resetsAt * 1000 },
  ]);

  // Codex works again by its reset (its stand-in limits only its first run); Claude Code still does not.
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000);
  await expect.poll(() => notified(app, "Filed by Codex")).toEqual([expect.objectContaining({ title: "Filed by Codex" })]);
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(2); // the run that hit the limit, and the wait's
  expect(filingRuns(calls, "claude")).toBe(1); // never asked again
  // The note is filed, so Claude Code's wait for it goes too: filed again from there, an undone filing would come back.
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a note the evening review files has no wait left, and its card goes", async () => {
  const bin = agentStubs();
  const { library, app } = await claudeLibrary(bin);
  answerAs(bin, "claude", limitedClaude()); // until tomorrow: the wait is a long one
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  expect(await waitsOf(app, library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  // The evening review files the note, with Claude Code working again. Were it put back in the inbox (Undo), the wait must not file it.
  // The card, which promised that the note would be filed, has nothing more to say.
  answerAs(bin, "claude", filingClaude());
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(inbox(library)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await cardNote(app)).toBeNull();
  await app.close();
});

test("a wait that comes due while the note's editor is open files nothing", async () => {
  // Claude Code is at its limit for a few seconds. The person files the note with Codex at once, and opens the editor on it.
  const bin = agentStubs({ codex: filingCodex({ FAKE_AGENT_DELAY_MS: "3000" }) });
  const { library, app, capsule, resetsAt } = await limitedFor(bin, 6, { env: AT_THE_RESET });
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");

  // The reset comes with the editor open, and Claude Code would work again (its stand-in limits only its first run): the words
  // are the person's to file, not the wait's.
  await sleepUntil(resetsAt * 1000 + 2_000);
  await call(app, "idleForTests");
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);
  expect(await capsuleKind(app)).toBe("editing");
  expect(await waitsOf(app, library)).toEqual([]); // the wait ended

  // The person's own edit still files the note, with Codex, as it would have.
  await capsule.getByRole("textbox").press("Escape");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a note filed meanwhile isn't filed again when its wait ends", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  // The evening review, or Try again, files the note before the reset: it is in the archive now. Claude Code would work by the
  // reset (its stand-in limits only its first run).
  const [note] = inbox(library);
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));

  await expect.poll(() => waitsOf(app, library), { timeout: 15_000 }).toEqual([]); // the wait ended, and had nothing to file
  await call(app, "idleForTests");
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await call(app, "notificationsForTests")).toEqual([]);
  await app.close();
});

test("a wait of another library waits until that library opens again", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")), ...AT_THE_RESET };
  const bin = agentStubs();
  const { library, app, resetsAt } = await limitedFor(bin, 5, { env });
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");

  // The reset comes while the other library is open: the note is in the first one's inbox, and nothing files it, though Claude
  // Code would work again (its stand-in limits only its first run).
  await sleepUntil(resetsAt * 1000 + 2_000);
  expect(inbox(library)).toHaveLength(1);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(archived(other)).toEqual([]);
  expect(await waitsOf(app, library)).toHaveLength(1); // still the first library's, for when it opens

  // It opens again, and its wait, which is due, files the note.
  await stubPicker(app, library);
  await call(app, "chooseLibrary");
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(archived(other)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a note stopped by a sign-in is filed once Claude Code is signed in", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app, capsule } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "500" } });
  await expect(capsule.getByRole("alert")).toContainText("Claude Code isn't signed in on this Mac.");
  expect(inbox(library)).toHaveLength(1);
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 1 }]);

  // The person signs in, in Terminal. The next look at the sign-in sees it, and the note is filed in the background.
  answerAs(bin, "claude", filingClaude());
  await expect.poll(() => inbox(library), { timeout: 10_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden"); // the card that promised it goes
  expect(await watches(app)).toEqual([]); // and the watch has ended
  // The watch only read the sign-in, which costs nothing: besides the run that failed and the one that filed, no question was asked.
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "claude")).toBe(2);
  expect(signInReads(calls)).toBeGreaterThan(0);
  expect(calls.filter((line) => /^claude (?!-p |auth status$)/.test(line))).toEqual([]);
  await app.close();
});

/** What the card of a note says once no watch will file it: the words for an agent whose sign-in is to be mended by hand, with Terminal still offered. */
const UNWATCHED_CARD = {
  kind: "error",
  message: "Claude Code isn't signed in on this Mac.",
  detail: "Sign in to Claude Code in Terminal. Your note is safe in the inbox; the evening review will try again.",
  action: "open-terminal",
  actionLabel: "Open Terminal",
};

test("the sign-in watch ends after its length, and its card stops promising the filing", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300", AVANZEL_SIGNIN_WATCH_MS: "1500" } });
  await expect.poll(() => watches(app), { timeout: 15_000 }).toEqual([]); // it gives up
  const reads = signInReads(await agentCalls(app));
  expect(reads).toBeGreaterThan(1); // it looked more than once
  // The card, which said the note would be filed straight away, still shows it: now it says only that it is safe, and keeps its button.
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  expect(await cardNote(app)).toBe(inbox(library)[0]);

  // Signed in at last, too late: it no longer looks, and the note waits for the evening review.
  answerAs(bin, "claude", filingClaude());
  await sleep(1_500);
  expect(signInReads(await agentCalls(app))).toBe(reads);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a sign-in the watch can't read ends the watch at its first look, and its card stops promising; the model is never asked", async () => {
  // This Claude Code's sign-in command says nothing a check understands: only a question put to the model could tell, and
  // that costs the person's usage. The watch doesn't ask it, so it can never see the agent signed in: it ends at once rather
  // than look for its whole length (a minute here), and the card that said "straight away" says only that the note is safe.
  const bin = agentStubs({ claude: signedOutClaude({}, { readable: false }) });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300", AVANZEL_SIGNIN_WATCH_MS: "60000" } });
  await expect.poll(() => watches(app), { timeout: 15_000 }).toEqual([]);
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  await sleep(1_500); // a watch still going would look again every 300 ms
  const calls = await agentCalls(app);
  expect(signInReads(calls)).toBe(1);
  expect(filingRuns(calls, "claude")).toBe(1); // the run that failed: no question, and no filing either
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("notes waiting on one agent's sign-in share one watch", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await claudeLibrary(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "500" } });
  await failAnother(app, 1);
  await failAnother(app, 2);
  expect(inbox(library)).toHaveLength(2);
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 2 }]);

  answerAs(bin, "claude", filingClaude());
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  await expect.poll(async () => (await notified(app, "Filed by Claude Code")).length).toBe(2);
  await call(app, "idleForTests");
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(4); // the two that failed, and one run each that filed
  expect(await watches(app)).toEqual([]);
  await app.close();
});

test("a note the watch refiled that can't sign in again starts no new watch, and its card says so", async () => {
  // Claude Code's sign-in command says it is signed in, but its runs say they aren't: the watch files the note once more,
  // finds the same thing, and leaves it to the evening review. The card that promised "straight away", which still shows the
  // note, says that in its place; there is no notification besides.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300" } });
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 15_000 }).toBe(2); // the watch's run
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toEqual(UNWATCHED_CARD);
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await watches(app)).toEqual([]);
  await sleep(1_500); // a new watch would look again in 300 ms, and file the note once more
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a note the watch refiled that can't sign in again tells a card that is gone by notification, and promises no review if it is off", async () => {
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) });
  // The library's evening review is off, so the words end at "safe in the inbox". The watch looks after 1.5 s; the card is closed before.
  const { library, app } = await failedWithClaude(bin, { eveningReview: false, env: { AVANZEL_SIGNIN_POLL_MS: "1500" } });
  await call(app, "dismiss");
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 15_000 }).toBe(2); // the watch's run
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 15_000 })
    .toEqual([{ title: "Claude Code isn't signed in on this Mac.", body: "Sign in to Claude Code in Terminal. Your note is safe in the inbox." }]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await watches(app)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("opening another library ends the sign-in watch, and its card stops promising the filing", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")), AVANZEL_SIGNIN_POLL_MS: "500" };
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await failedWithClaude(bin, { env });
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 1 }]);
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");
  expect(await watches(app)).toEqual([]); // its note is in a library that is closed now
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  // Signed in at last: nothing files that note from here.
  answerAs(bin, "claude", filingClaude());
  await sleep(1_500);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a sign-in failure of another agent starts no watch and no wait", async () => {
  // The library's own agent is the engine's fake one, which says it isn't signed in; only Claude Code and Codex are watched.
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", FAKE_AGENT_MODE: "fail" });
  const capsule = await windowFor(app, "capsule");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  await expect(capsule.getByText("Sign in to fake in Terminal. Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  expect(await watches(app)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

// ---- A note that left the inbox while its run waited for the library ----

test("a note another Avanzel filed while the run waited for the library isn't reported as a failure", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const { library, app } = await claudeLibrary(bin);
  // Another Avanzel has the library, so the filing waits for it ...
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
    // ... and files the note itself, then lets the library go.
    const [note] = inbox(library);
    renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));
  } finally {
    letGo();
    await held;
  }
  // The note is filed: the filing card just goes, with no "stopped without filing" card or notification in its place.
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const kind = await capsuleKind(app);
      seen.add(kind);
      return kind;
    }, { timeout: 30_000, intervals: [50] })
    .toBe("hidden");
  expect(seen.has("error")).toBe(false);
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(0);
  await app.close();
});

test("a wait whose note another Avanzel filed meanwhile files nothing and says nothing", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET }); // Claude Code works by the reset
  const [note] = inbox(library);
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    // At the reset the wait queues its filing, which waits for the library; then the other Avanzel files the note.
    await expect.poll(() => call(app, "busy"), { timeout: 15_000 }).toBe(true);
    renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));
  } finally {
    letGo();
    await held;
  }
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden"); // the card of the failure, which promised the filing, goes: the note is filed
  expect(await waitsOf(app, library)).toEqual([]);
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
    await expect(capsule.getByText(onThisMac ? /^Transcribed on this Mac in \d+\.\d seconds$/ : /^Transcribed in \d+\.\d seconds$/)).toBeVisible();
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

/** One filing state sent to the capsule's page: how many rows it carried, and how many times the menu had been rebuilt by then. */
type FilingSend = { rows: number; menus: number };

/** From now on, notes each filing state sent to the capsule's page (`filingSends`), and counts the menu's rebuilds. */
async function watchFilingStates(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const controller = (globalThis as unknown as { __avanzel: { refreshMenu(): void } }).__avanzel;
    let menus = 0;
    const refreshMenu = controller.refreshMenu.bind(controller);
    controller.refreshMenu = () => {
      menus += 1;
      refreshMenu();
    };
    const sent: FilingSend[] = [];
    Object.assign(globalThis, { filingSends: sent });
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      const state = args[0] as { kind?: string; rows?: unknown[] } | undefined;
      if (channel === "capsule:state" && state?.kind === "filing") sent.push({ rows: state.rows?.length ?? 0, menus });
      send(channel, ...args);
    };
  });
}

const filingSends = (app: ElectronApplication) => app.evaluate(() => (globalThis as { filingSends?: FilingSend[] }).filingSends ?? []);

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
  const { app } = await steppedClaude(1000);
  await watchFilingStates(app);
  await dictate(app);
  await expect.poll(() => rowKindsOf(app), { timeout: 30_000, intervals: [100] }).toContain("read");
  await call(app, "dismiss");
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
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", noted: true, pages: [] });
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
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // A second thought, typed, is filed after the first: the app runs one agent at a time, so it waits its turn in the queue,
  // which the engine's wait for the library doesn't tell.
  await call(app, "submitQuick", "Call the plumber on Monday");
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

/** The controller as the e2e tests reach it in the main process, with the parts these tests wrap: the librarian made for each run. */
type Wrappable = {
  librarian(harness?: string): Promise<{ file(...args: unknown[]): Promise<unknown>; undo(...args: unknown[]): Promise<unknown> }>;
  cancelFiling(sender: unknown): void;
};
/** What the wrappers leave in the main process for a test to read or call. */
type Left = {
  atTheEnd?: boolean;
  letItEnd?: () => void;
  atUndo?: boolean;
  letUndoIn?: () => void;
  undoCalls?: number;
  stepsOf?: (step: unknown) => void;
};
const reachedTheEnd = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).atTheEnd === true);
const reachedUndo = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).atUndo === true);
const undoCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).undoCalls ?? 0);

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

/**
 * From now on, counts the take-backs the app asks the library for (`undoCalls`). With `hold`, each waits at its door (`atUndo`)
 * until the test lets it in (`letUndoIn`).
 */
async function watchUndos(app: ElectronApplication, { hold = false } = {}): Promise<void> {
  await app.evaluate((_electron, holding) => {
    const controller = (globalThis as unknown as { __avanzel: Wrappable }).__avanzel;
    const librarian = controller.librarian.bind(controller);
    Object.assign(globalThis, { undoCalls: 0 });
    controller.librarian = async (harness) => {
      const made = await librarian(harness);
      const undo = made.undo.bind(made);
      made.undo = async (...args) => {
        const kept = globalThis as { undoCalls?: number };
        kept.undoCalls = (kept.undoCalls ?? 0) + 1;
        if (holding) {
          Object.assign(globalThis, { atUndo: true });
          await new Promise<void>((resolve) => Object.assign(globalThis, { letUndoIn: resolve }));
        }
        return undo(...args);
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

/** `library`, opened by an app that hears "Plant tulips in October" and files with the engine's fake agent; `env` steers them. */
async function launchOn(library: string, env: Record<string, string> = {}) {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    ...onlyAgentsIn(agentStubs()),
    ...env,
  });
  return { app, library, userData, capsule: await windowFor(app, "capsule") };
}

/** The commits that took a filing or its leftovers back, newest first. */
const undone = (library: string) => gitOut(library, "log", "--format=%s").split("\n").filter((subject) => subject.startsWith("avanzel: undo"));

test("Stop ends the filing and the note stays in the inbox", async () => {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { library, app, capsule } = await dictateToStallingAgent("Plant tulips in October", { FAKE_AGENT_RECORD: runs, AVANZEL_USER_DATA: userData });
  const { pid } = JSON.parse(readFileSync(runs, "utf8").trim().split("\n")[0]!) as { pid: number };
  expect(alive(pid)).toBe(true);
  await watchStates(app);
  await stop(capsule);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
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
  const { app } = await launchOn(library);
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
  // The card says it can't be undone, never that the words are back in the inbox: the filing stands.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "This one can't be undone automatically.",
    detail: "Usually a later change touched the same lines. The library's history keeps both versions.",
  });
  expect(await kindsSent(app)).not.toContain("cancelled");
  expect(read(library, `ideas/${page}`)).toBe("# Changed by hand\n");
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
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
