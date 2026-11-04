// Dictating into any app: a tap of the chosen key starts a dictation, another ends it, and the words are pasted at the cursor of
// the app in front, or offered on the capsule's copy card when they can't go in. The Mac's side (the key, the app in front, the
// paste) is the fake cursor helper (AVANZEL_FAKE_CURSOR), whose pastes append the clipboard's text to a file.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Target } from "../src/main/cursor-helper.ts";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { call, capsuleKind, capturesKept, filesUnder, launch, makeLibrary, speechWav, windowFor } from "./helpers.ts";
import { expectProblem } from "./capsule-helpers.ts";

const WORDS = "hello Kowalczyk";

const slack = (pid = 501, title = "#general"): Target => ({
  app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid },
  window: { title },
  element: { role: "AXTextArea", secure: false, takesText: "yes" },
});

/** A fake helper's script: who is in front at each inspect, and when the key is tapped. Returns it with the file its pastes go to. */
function fakeCursor({ targets = [slack()], taps = [] as number[], gaveUpAt }: { targets?: Target[]; taps?: number[]; gaveUpAt?: number } = {}): {
  script: string;
  pasteOut: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-cursor-"));
  const pasteOut = path.join(dir, "pasted.txt");
  const script = path.join(dir, "cursor.json");
  writeFileSync(script, JSON.stringify({ targets, taps, pasteOut, ...(gaveUpAt !== undefined ? { gaveUpAt } : {}) }));
  return { script, pasteOut };
}

const chrome = (pid = 601): Target => ({
  app: { name: "Google Chrome", bundleId: "com.google.Chrome", pid },
  window: { title: "Inbox" },
  element: { role: "AXTextArea", secure: false, takesText: "yes" },
});

const pasted = (pasteOut: string): string => (existsSync(pasteOut) ? readFileSync(pasteOut, "utf8") : "");

async function launchWith(script: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; library: string }> {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_CURSOR: script,
    AVANZEL_FAKE_AUDIO: speechWav(WORDS),
    AVANZEL_FAKE_TRANSCRIPT: WORDS,
    ...env,
  });
  await windowFor(app, "capsule");
  return { app, library };
}

const clipboardText = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());
const setClipboard = (app: ElectronApplication, text: string) => app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
const userDataOf = (app: ElectronApplication) => app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));

/** The dictations kept in the app's own history (`<userData>/dictations.jsonl`), oldest first. */
async function history(app: ElectronApplication): Promise<{ text: string; app: string; inserted: boolean }[]> {
  const file = path.join(await userDataOf(app), "dictations.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cursorIdle = (app: ElectronApplication) => call(app, "cursorIdleForTests") as Promise<boolean>;

// These tests use the Mac's real clipboard (the fake helper's paste reads it): its text is put back when they are done.
let ownersClipboard = "";
test.beforeAll(() => {
  ownersClipboard = execFileSync("pbpaste", { encoding: "utf8" });
});
test.afterAll(() => {
  execFileSync("pbcopy", { input: ownersClipboard });
});

test("two taps paste the words at the cursor, give the clipboard back, and keep nothing in the library", async () => {
  const { script, pasteOut } = fakeCursor({ taps: [500, 1500] });
  const { app, library } = await launchWith(script);
  await setClipboard(app, "what was on the clipboard");
  await call(app, "setCursorDictation", { enabled: true });
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  // The helper pastes the words through its own pasteboard and gives it back (the fake's paste only writes them to its file): the app
  // never puts them on the clipboard, so the person's clipboard is as it was throughout.
  expect(await clipboardText(app)).toBe("what was on the clipboard");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect.poll(() => history(app)).toEqual([expect.objectContaining({ text: WORDS, app: "Slack", inserted: true })]);
  // A dictation is no thought: nothing in the inbox, no recording kept, nothing counted.
  await call(app, "idleForTests");
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(capturesKept(await userDataOf(app))).toBe(0);
  await app.close();
});

test("when focus moved to another window, nothing is pasted and the copy card names the app; Copy puts the words on the clipboard", async () => {
  const { script, pasteOut } = fakeCursor({ targets: [slack(501), { ...slack(777, "Notes"), app: { name: "Notes", bundleId: "com.apple.Notes", pid: 777 } }], taps: [500, 1500] });
  const { app } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  const capsule = await windowFor(app, "capsule");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await expectProblem(capsule, {
    title: "You moved to another window.",
    lines: [`The words were meant for Slack. “${WORDS}” They are on your clipboard.`],
    fix: "Copy",
  });
  expect(pasted(pasteOut)).toBe("");
  await setClipboard(app, "something else since");
  await capsule.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => clipboardText(app)).toBe(WORDS);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(pasted(pasteOut)).toBe("");
  await app.close();
});

test("the copy card goes by itself after five seconds", async () => {
  const { script } = fakeCursor({ targets: [slack(501), slack(777)], taps: [500, 1500] });
  const { app } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await wait(3_500);
  expect(await capsuleKind(app)).toBe("error");
  await expect.poll(() => capsuleKind(app), { timeout: 5_000 }).toBe("hidden");
  await app.close();
});

test("while a thought records, a tap is refused in one line, and the thought goes on", async () => {
  const { script, pasteOut } = fakeCursor({ taps: [1500] });
  const { app, library } = await launchWith(script);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "setCursorDictation", { enabled: true });
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("dictation-refused");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("Something else is recording. Try again when it stops.", { exact: true })).toBeVisible();
  // The thought's card comes back, and the thought is the one that stops and is kept.
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => filesUnder(library, "raw").filter((rel) => rel.endsWith(".md")).length + filesUnder(library, "inbox").length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(pasted(pasteOut)).toBe("");
  expect(await history(app)).toEqual([]);
  await app.close();
});

test("a thought's shortcut doesn't stop a dictation, and starting call notes doesn't take it over", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app, library } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await call(app, "toggleCapture");
  expect(await call(app, "startCallNotes", "everything")).toBe(false);
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await call(app, "idleForTests");
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("with dictating into any app off, taps do nothing; turning it off stops the helper's taps", async () => {
  const { script, pasteOut } = fakeCursor({ taps: [500, 1500] });
  const { app } = await launchWith(script);
  await wait(2_500); // off: the helper never starts, so its taps never come
  expect(await capsuleKind(app)).toBe("hidden");
  const off = fakeCursor({ taps: [1000, 2000] });
  await app.close();

  const again = await launchWith(off.script);
  await call(again.app, "setCursorDictation", { enabled: true });
  await call(again.app, "setCursorDictation", { enabled: false });
  await wait(3_000);
  expect(await capsuleKind(again.app)).toBe("hidden");
  expect(pasted(off.pasteOut)).toBe("");
  expect(pasted(pasteOut)).toBe("");
  await again.app.close();
});

test("Esc while listening drops the dictation and pastes nothing, and the next tap starts a new one at once", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true, key: "right-command" });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // The listening card says it is dictating into another app, and how it ends, with the key the setting chose.
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("Dictating into another app. Tap Right Command again to finish, or press Esc.", { exact: true })).toBeVisible();
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(true);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await wait(1_000);
  expect(pasted(pasteOut)).toBe("");
  expect(await history(app)).toEqual([]);
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});

test("a microphone that fails says so, and the next tap dictates", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "micError", "Requested device not found");
  const capsule = await windowFor(app, "capsule");
  await expectProblem(capsule, { title: "The microphone didn't start.", lines: ["Requested device not found. Nothing was recorded. Check the microphone in Settings → Voice."], fix: "Open Settings" });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});

test("words that can't be made say so, paste nothing, and the next tap dictates", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app, library } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  const config = path.join(library, ".avanzel", "config.toml");
  const good = readFileSync(config, "utf8");
  writeFileSync(config, "[voice\nthis is not toml"); // the words are made through the library's settings, which now can't be read
  await call(app, "pressCursorDictation");
  const capsule = await windowFor(app, "capsule");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await expect(capsule.getByText("The recording couldn't be turned into words.", { exact: true })).toBeVisible();
  expect(pasted(pasteOut)).toBe("");
  writeFileSync(config, good);
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});

test("a dictation dropped while its words are made never pastes them, and a tap right after starts a new one", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app } = await launchWith(script, { AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "3000" });
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  // Turning the setting off drops the dictation, words still to come; on again, a tap starts a new one at once, not ten seconds on.
  await call(app, "setCursorDictation", { enabled: false });
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await wait(4_000); // the dropped dictation's words are made by now, and thrown away
  expect(pasted(pasteOut)).toBe("");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await wait(1_000);
  expect(pasted(pasteOut)).toBe(WORDS); // once
  await app.close();
});

test("the time limit ends a dictation without pasting: its words are offered on the copy card and kept in the history only", async () => {
  const { script, pasteOut } = fakeCursor();
  const library = await makeLibrary();
  const settings = loadSettings(library);
  saveSettings(library, { ...settings, voice: { ...settings.voice, maxRecordSeconds: 2 } });
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_CURSOR: script, AVANZEL_FAKE_AUDIO: speechWav(WORDS), AVANZEL_FAKE_TRANSCRIPT: WORDS });
  const capsule = await windowFor(app, "capsule");
  await setClipboard(app, "what was on the clipboard");
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await expectProblem(capsule, { title: "The words didn't go in.", lines: [`“${WORDS}” They are on your clipboard.`], fix: "Copy" });
  expect(pasted(pasteOut)).toBe("");
  expect(await clipboardText(app)).toBe(WORDS);
  expect(await history(app)).toEqual([expect.objectContaining({ text: WORDS, app: "", inserted: false })]);
  expect(filesUnder(library, "raw")).toEqual([]);
  await app.close();
});

test("a dictation's card waits while a thought listens, and shows once the thought is done", async () => {
  const { script, pasteOut } = fakeCursor({ targets: [slack(501), slack(777)] });
  const { app } = await launchWith(script, { AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "3000" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  await wait(800); // the dictation's audio is in; its words are being made
  await call(app, "toggleDictate"); // a thought starts meanwhile
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // The dictation's words come (focus moved: they are offered, not pasted), and its card is held: the thought keeps its card.
  await expect.poll(() => cursorIdle(app), { timeout: 15_000 }).toBe(true);
  await wait(500);
  expect(await capsuleKind(app)).toBe("listening");
  expect(pasted(pasteOut)).toBe("");
  expect(await clipboardText(app)).toBe(WORDS);
  // The thought is given up: the capsule is free, and the dictation's card shows, its five seconds counted from then.
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(true);
  await expect.poll(() => capsuleKind(app)).toBe("error");
  await expectProblem(capsule, {
    title: "You moved to another window.",
    lines: [`The words were meant for Slack. “${WORDS}” They are on your clipboard.`],
    fix: "Copy",
  });
  await wait(3_500);
  expect(await capsuleKind(app)).toBe("error");
  await expect.poll(() => capsuleKind(app), { timeout: 5_000 }).toBe("hidden");
  await app.close();
});

test("a browser that can't be asked which page it shows is said once, with Open System Settings at Automation", async () => {
  const { script, pasteOut } = fakeCursor({ targets: [chrome()], taps: [500, 1500] });
  const { app } = await launchWith(script, { AVANZEL_FAKE_BROWSER: "unanswered" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCursorDictation", { enabled: true });
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await expect.poll(() => capsuleKind(app)).toBe("error");
  await expectProblem(capsule, {
    title: "Avanzel couldn't ask Google Chrome which page this is.",
    lines: ["Nothing was kept of that dictation. It was still typed in. Allow it under Automation in System Settings."],
    fix: "Open System Settings",
  });
  expect(await history(app)).toEqual([]);
  await capsule.getByRole("button", { name: "Open System Settings", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Automation"]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  // Said once per browser: the next dictation there goes in without the card.
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS + WORDS);
  await expect.poll(() => cursorIdle(app)).toBe(true);
  await wait(500);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("when the helper keeps stopping and is given up, one card says so and sends the person to Settings → Voice", async () => {
  const { script } = fakeCursor({ gaveUpAt: 500 });
  const { app } = await launchWith(script);
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCursorDictation", { enabled: true });
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("error");
  await expectProblem(capsule, { title: "Dictating into any app stopped working.", lines: ["Turn it off and on again in Settings."], fix: "Open Settings" });
  await app.close();
});
