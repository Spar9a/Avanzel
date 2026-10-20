// Filing with the agent: Edit while it runs, quitting while it runs, and runs that fail.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, mkdtempSync, readFileSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import { alive, call, capsuleKind, exists, filesUnder, gitOut, launch, makeLibrary, onceMarker, read, snap, speechWav, windowFor } from "./helpers.ts";

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

/**
 * Dictates "misheard words" while another process holds the library (this test, standing in for a
 * second Avanzel): the filing waits for it, and so does all that queues behind it, past the end of
 * quitting's wait. `meanwhile` acts in the capsule, then Avanzel quits. Returns what the inbox holds.
 */
async function quitWhileHeld(meanwhile: (app: ElectronApplication, capsule: Page) => Promise<void>): Promise<string[]> {
  const library = await makeLibrary();
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "misheard words" });
    const capsule = await windowFor(app, "capsule");
    await call(app, "toggleDictate");
    await call(app, "toggleDictate");
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
    await meanwhile(app, capsule);
    await quit(app);
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
  const words = await quitWhileHeld((app, capsule) => editTo(app, capsule, "corrected words"));
  // The corrected words are written anyway, with the recording and transcriber of the misheard ones, which stay too.
  expect(words).toHaveLength(2);
  expect(words.filter((text) => text.includes("misheard words"))).toHaveLength(1);
  const [corrected] = words.filter((text) => text.includes("corrected words"));
  expect(corrected).toContain("\ntranscriber: fake\n");
  expect(corrected).toMatch(/\naudio: raw\/audio\/.+\.wav\n/);
});

test("words filed after an edit are saved when the quit wait runs out before their turn", async () => {
  const words = await quitWhileHeld((app, capsule) => fileEdit(app, capsule, "first fix"));
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
    await expect(capsule.getByText("Your corrected words are saved to your inbox when you quit", { exact: false })).toBeVisible();
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
  });
  expect(words).toEqual([expect.stringContaining("misheard words")]);
});

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
  await snap(capsule, "5-error-partial-edits");
  expect(inbox(library)).toHaveLength(1);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: leftovers of failed filing /);
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
  await expect(capsule.getByText("still in your inbox", { exact: false })).toHaveCount(0);
  await app.close();
});
