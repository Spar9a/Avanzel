// Filing with the agent: Edit while it runs, quitting while it runs, and runs that fail.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { call, capsuleKind, exists, filesUnder, gitOut, launch, makeLibrary, onceMarker, read, snap, speechWav, windowFor } from "./helpers.ts";

const inbox = (root: string) => filesUnder(root, "inbox");
const archived = (root: string) => filesUnder(root, "raw").filter((rel) => rel.endsWith(".md")).map((rel) => path.join(root, "raw", rel));
/** Markdown files in the library (git's own folder aside) that contain `words`. */
const mentioning = (root: string, words: string) =>
  filesUnder(root, ".").filter((rel) => rel.endsWith(".md") && read(root, rel).includes(words));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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

test("quitting mid-filing stops the agent, commits what it left, and keeps the note in the inbox", async () => {
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const { library, app } = await dictateToStallingAgent("Call the plumber about the leak", { FAKE_AGENT_RECORD: record });
  const { pid } = JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number };
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await closed;
  expect(alive(pid)).toBe(false);
  expect(inbox(library)).toEqual([expect.stringMatching(/-call-the-plumber-about-the\.md$/)]);
  expect(gitOut(library, "log", "-1", "--format=%s")).toMatch(/^avanzel: leftovers of failed filing /);
  expect(gitOut(library, "status", "--porcelain")).toBe("");
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
