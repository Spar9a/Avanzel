// Filing with the agent: Edit while it runs, quitting while it runs, and runs that fail.
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
  resetReported,
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
