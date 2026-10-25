// Filing with the agent: Edit while it runs, quitting while it runs, and runs that fail.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
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
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  read,
  SIGNED_IN,
  snap,
  speechWav,
  stubPicker,
  windowFor,
} from "./helpers.ts";

const inbox = (root: string) => filesUnder(root, "inbox");
/** What each capture waiting in the inbox says. */
const inboxWords = (root: string) => inbox(root).map((name) => read(root, `inbox/${name}`));
const archived = (root: string) => filesUnder(root, "raw").filter((rel) => rel.endsWith(".md")).map((rel) => path.join(root, "raw", rel));
/** Markdown files in the library (git's own folder aside) that contain `words`. */
const mentioning = (root: string, words: string) =>
  filesUnder(root, ".").filter((rel) => rel.endsWith(".md") && read(root, rel).includes(words));

/** Dictation filed by a fake agent whose first run gets halfway (goals/half.md) and then hangs. */
async function dictateToStallingAgent(transcript: string, extra: Record<string, string> = {}) {
  const library = await makeLibrary({ git: true });
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

async function quit(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
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
 * the app to launch with). Returns what the inbox holds.
 */
async function quitWhileHeld(
  meanwhile: (app: ElectronApplication, capsule: Page) => Promise<void>,
  env: Record<string, string> = {},
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
    await quit(app);
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
  // The blocked line first, then where the words are instead of "safe in the inbox", then what the run left in the
  // library. This library has no git, so those edits have no history to be undone from.
  const captureId = kept!.replace(/\.original\.md$/, "");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "fake couldn't file this note.",
    detail:
      `The agent changed ${captureId}, and Avanzel does not write it back through a symlink in inbox/. ` +
      `Your words are kept in .avanzel/logs/${kept}, and the inbox holds the agent's version; the evening review will try again. ` +
      "Its partial edits stay in the library, outside its history, so they can't be undone.",
  });
  await app.close();
});

// ---- The card a failed filing ends in: what happened, what is safe, and the one fix ----
//
// Each of these files with Claude Code, whose stand-in `claude` acts as the test made it (filingClaude), on a Mac whose only
// agents are the stand-ins in the test's folder (onlyAgentsIn): which other agents are installed decides the card.

/** Tomorrow at 09:00 in this zone, in epoch seconds, as Claude Code's rate limit gives its reset. */
function tomorrowAtNine(): number {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(9, 0, 0, 0);
  return Math.floor(day.getTime() / 1000);
}

/** A `claude` that has hit its usage limit, which resets tomorrow at 09:00: it prints a stream, as Claude Code does. */
const limitedClaude = () =>
  filingClaude({ FAKE_AGENT_STREAM: "claude", FAKE_AGENT_MODE: "limit", FAKE_AGENT_RESETS_AT: String(tomorrowAtNine()) });

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
  // Claude Code is at its limit. The Codex stand-in takes a moment, so the filing can be seen before it ends.
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex({ FAKE_AGENT_DELAY_MS: "2000" }) });
  const { library, app, capsule } = await failedWithClaude(bin);
  const [note] = inbox(library);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1); // the run that hit the limit

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

test("a note filed meanwhile isn't filed twice", async () => {
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await failedWithClaude(bin);
  // The evening review, or another Avanzel, files the note while its card is up: it is in the archive now.
  const [note] = inbox(library);
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));

  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden"); // the card closes
  await call(app, "idleForTests"); // and nothing waits in the queue to run
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(0);
  expect(filingRuns(calls, "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  await app.close();
});

test("a card left up while another library opens files nothing in it", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) };
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await failedWithClaude(bin, { env });
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");

  // The card is still up, for a note that waits in the first library's inbox and isn't in the new library's.
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await call(app, "idleForTests");
  expect(filingRuns(await agentCalls(app), "codex")).toBe(0);
  expect(inbox(library)).toHaveLength(1);
  expect(archived(other)).toEqual([]);
  await app.close();
});
