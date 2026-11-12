// The recording state machine: tap to start, tap to stop, and what happens when taps or audio go astray.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, readWav } from "../../../packages/engine/src/index.ts";
import {
  call,
  capsuleKind,
  capturesKept,
  filesUnder,
  filingClaude,
  firstRun,
  gitOut,
  launch,
  makeLibrary,
  read,
  screenshotFixture,
  snap,
  speechWav,
  stubPicker,
  throughFound,
  windowFor,
  toolbarItem,
} from "./helpers.ts";
import { capsuleAtRest, expectInPanel, expectProblem, expectStoppedRecording, letTranscriptionGo, noteTranscriptions, stopTranscribing, transcriptions } from "./capsule-helpers.ts";
import { pressShortcut, sentToCapsule, watchCapsule, zel } from "./setup-helpers.ts";

const WAIT_FOR_AUDIO_MS = 3000; // AVANZEL_AUDIO_TIMEOUT_MS: how long the app waits for audio after a stop (15 s outside tests)

test("a second stop while stopping is ignored, so it never cuts the next dictation short", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "a thought said twice over",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // A double tap on stop: both reach the controller before the audio does.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void> } }).__avanzel;
    void controller.toggleDictate();
    void controller.toggleDictate();
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toMatch(/^(filing|filed)$/); // its audio arrived
  await call(app, "toggleDictate"); // the next thought, right away
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_AUDIO_MS + 1000)); // nothing may fire meanwhile
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw").filter((rel) => rel.endsWith(".md"))).toHaveLength(2);
  await app.close();
});

test("start and stop sent before the capsule page listens still reach it (a shortcut right after launch)", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "said while the capsule was loading",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  await windowFor(app, "capsule");
  await call(app, "capsuleStateForTests");
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void> } }).__avanzel;
    const page = win.webContents.getURL();
    await win.webContents.loadURL("about:blank"); // nothing listens until the capsule page is back
    await controller.toggleDictate();
    await controller.toggleDictate();
    void win.webContents.loadURL(page);
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await app.close();
});

test("a recording whose audio never arrives is given up, and the capsule is told to let go of the microphone", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "lost on the way",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  const capsule = await windowFor(app, "capsule");
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined); // the audio is lost on its way to the controller
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    const commands: unknown[] = [];
    (globalThis as unknown as { __commands: unknown[] }).__commands = commands;
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:command") commands.push(args[0]);
      send(channel, ...args);
    };
  });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: WAIT_FOR_AUDIO_MS + 10_000 }).toBe("error");
  // What happened, what is safe, and the one fix: the microphone is chosen in Settings → Voice.
  await expectProblem(capsule, {
    title: "The recording didn't arrive.",
    lines: ["Nothing was saved. Is the right microphone selected?"],
    fix: "Choose microphone",
  });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "The recording didn't arrive.",
    detail: "Nothing was saved. Is the right microphone selected?",
    action: "open-settings:voice",
    actionLabel: "Choose microphone",
  });
  // The recorder was started, stopped and then told to let go. The page also hears whether the voice trigger listens (it is told as it
  // loads, and here it may have loaded while the first two waited for it), which in this library it never does: nothing else holds the
  // microphone once the recording is given up.
  const commands = await app.evaluate(() => (globalThis as unknown as { __commands: unknown[] }).__commands);
  const isTrigger = (command: unknown) => typeof command === "object" && command !== null && (command as { kind?: string }).kind === "trigger";
  expect(commands.filter((command) => !isTrigger(command))).toEqual(["start", "stop", "cancel"]);
  expect(commands.filter(isTrigger).every((command) => (command as { on: boolean }).on === false)).toBe(true);
  // Nothing was saved, as the card says.
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw")).toEqual([]);
  // Its button takes the person to the microphone, in Settings → Voice, and the card goes.
  await capsule.getByRole("button", { name: "Choose microphone", exact: true }).click();
  const settings = await windowFor(app, "panel");
  await expect(toolbarItem(settings, "Voice")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

// ---- Stop, on a transcription that has run long ----
//
// What Stop does is told at the controller's `stopTranscribing`. Most of these press it as the bar's Stop button does: through the
// capsule page's bridge, `window.avanzel.capsule.stopTranscribing()`, which `call()` can't do, since the channel answers only the page
// that sends it; the test of the bar clicks the button. AVANZEL_TRANSCRIBE_STOP_MS makes a transcription slow after half a second
// (20 s outside tests), and AVANZEL_FAKE_TRANSCRIPT_DELAY_MS makes the stand-in for the speech model take as long as a test needs.

const SLOW_MS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A launch that hears "Plant tulips in October" after `delayMs`, and whose transcription is slow after SLOW_MS, on `library` (a new
 * one unless given); `env` adds to it. Nothing records yet (`dictate`). The states sent to the capsule are noted from here on.
 */
async function launchSlowly(delayMs: number, { library, env = {} }: { library?: string; env?: Record<string, string> } = {}) {
  const root = library ?? (await makeLibrary());
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const recording = speechWav("hello");
  const app = await launch({
    AVANZEL_LIBRARY: root,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: recording,
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    AVANZEL_TRANSCRIBE_STOP_MS: String(SLOW_MS),
    AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: String(delayMs),
    ...env,
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "capsuleStateForTests"); // the controller is up
  await watchCapsule(app);
  return { library: root, userData, recording, app, capsule };
}

/** The person says something and stops: its audio is on its way to be heard. */
async function dictate(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
}

/** Waits until the transcription has run long: the card has turned slow, and offers Stop. */
const untilSlow = (app: ElectronApplication) =>
  expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "transcribing", slow: true });

/** The samples of a recording: what two files must share to be the same recording. */
const samplesOf = (file: string) => readWav(file).samples;

/** The kinds of state that would show what a dropped transcription made: its failure, or its words filed or saved. */
const SHOWING_WORDS = ["error", "filing", "filed", "saved"];

test("a long transcription offers Stop, and its recording waits in the inbox", async () => {
  const { library, userData, recording, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true, slow: true });
  await stopTranscribing(capsule);
  const stopped = Date.now();
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "recorded", review: "at 21:00" });
  // The card says so: Stopped, over an empty card, and that the recording is in the inbox, where the evening review turns it into words.
  await expectStoppedRecording(capsule, "It's in the inbox. The evening review turns it into words and files it at 21:00.");
  // The recording itself, as audio the engine's queue transcribes: one .wav in the inbox, none left in raw/audio/, no capture written.
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.wav$/);
  expect(samplesOf(path.join(library, "inbox", name!))).toEqual(samplesOf(recording));
  expect(new Vault(library).pending()).toEqual([path.join(library, "inbox", name!)]);
  expect(filesUnder(library, "raw")).toEqual([]);
  // A recording the library keeps counts toward the first ten, as the others do.
  expect(capturesKept(userData)).toBe(1);
  // The card hides itself after 6 s (a stopped filing's goes after 5, the time of Processing's ring for a thought that came to no note).
  await expect.poll(() => capsuleKind(app), { timeout: 15_000, intervals: [100] }).toBe("hidden");
  expect(Date.now() - stopped).toBeGreaterThanOrEqual(5_000);
  await app.close();
});

test("a long transcription's bar says it is still at it and offers Stop, whose press keeps the recording", async () => {
  const { library, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  await snap(capsule, "2-transcribing-slow");
  // The line changes once, and Stop is the bar's one button: secondary and small, with Zel still thinking.
  const bar = capsule.getByRole("status");
  await expect(bar.getByText("Still transcribing…", { exact: true })).toBeVisible();
  await expect(bar.getByText("Transcribing on this Mac…")).toHaveCount(0);
  const stopButton = bar.getByRole("button", { name: "Stop", exact: true });
  await expect(capsule.getByRole("button")).toHaveCount(1);
  await expect(stopButton).toHaveAttribute("data-variant", "secondary");
  await expect(stopButton).toHaveAttribute("data-size", "small");
  await expect(zel(capsule)).toHaveAttribute("data-mood", "thinking");
  await expect(capsule.getByRole("article")).toHaveCount(0);
  // Its press keeps the recording in the inbox for the evening review.
  await stopButton.click();
  await expect.poll(() => capsuleKind(app)).toBe("recorded");
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "recorded", review: "at 21:00" });
  await snap(capsule, "2-stopped-recording");
  await expectStoppedRecording(capsule, "It's in the inbox. The evening review turns it into words and files it at 21:00.");
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.wav$/);
  expect(filesUnder(library, "raw")).toEqual([]);
  await app.close();
});

test("a transcription that returns after Stop is dropped", async () => {
  const { library, userData, app, capsule } = await launchSlowly(3_000);
  await noteTranscriptions(app);
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  // The stand-in for the speech model is still at it. Once its words are back, nothing has come of them: no note, nothing removed,
  // and nothing on the capsule.
  await expect.poll(async () => (await transcriptions(app)).ended, { timeout: 30_000 }).toBe(1);
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(name).toMatch(/\.wav$/);
  expect(filesUnder(library, "raw")).toEqual([]);
  const kinds = await sentToCapsule(app);
  expect(kinds).toContain("recorded");
  for (const kind of SHOWING_WORDS) expect(kinds).not.toContain(kind);
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("a transcription that fails after Stop is dropped too", async () => {
  const { library, userData, app, capsule } = await launchSlowly(2_000);
  await noteTranscriptions(app, { failWith: "the speech model fell over" });
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule);
  await expect.poll(async () => (await transcriptions(app)).ended, { timeout: 30_000 }).toBe(1);
  // Its failure says nothing of a recording the person has seen kept: no card, and the recording stays in the inbox.
  expect(filesUnder(library, "inbox")).toHaveLength(1);
  expect(filesUnder(library, "raw")).toEqual([]);
  const kinds = await sentToCapsule(app);
  for (const kind of SHOWING_WORDS) expect(kinds).not.toContain(kind);
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("a stopped transcription that finds no words writes nothing, removes nothing and shows no error", async () => {
  // Whitespace only, so that the stand-in still counts as a speech model that is ready, and its words trim to none.
  const { library, userData, app, capsule } = await launchSlowly(3_000, { env: { AVANZEL_FAKE_TRANSCRIPT: "   " } });
  await noteTranscriptions(app);
  await dictate(app);
  await untilSlow(app);
  const kept = filesUnder(library, "raw/audio")[0]!;
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  // Another file takes the path the recording had (a new recording stamped in the same second claims it, say). A transcription that
  // finds no words removes the recording it kept at that path, so this one must not remove what it finds there.
  const taken = path.join(library, "raw", "audio", kept);
  writeFileSync(taken, "Someone else's recording, at the path this one had.");
  await expect.poll(async () => (await transcriptions(app)).ended, { timeout: 30_000 }).toBe(1);
  expect(readFileSync(taken, "utf8")).toBe("Someone else's recording, at the path this one had.");
  expect(filesUnder(library, "raw")).toEqual([`audio/${kept}`]);
  expect(filesUnder(library, "inbox")).toHaveLength(1); // the recording Stop kept, and no note
  const kinds = await sentToCapsule(app);
  expect(kinds).toContain("recorded");
  for (const kind of SHOWING_WORDS) expect(kinds).not.toContain(kind); // "Nothing was heard." is an error card
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("Stop before the transcription has run long does nothing, and the words are filed as ever", async () => {
  const { library, userData, app, capsule } = await launchSlowly(4_000, { env: { AVANZEL_TRANSCRIBE_STOP_MS: "60000" } });
  await noteTranscriptions(app);
  await dictate(app);
  await expect.poll(async () => (await transcriptions(app)).started, { timeout: 30_000 }).toBe(1); // its recording is in the library
  await stopTranscribing(capsule);
  // Nothing to stop yet: the card is the plain one, and the recording is where it was.
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true });
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  // The words arrive and are filed, with the recording kept beside them.
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(await sentToCapsule(app)).not.toContain("recorded");
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("a second Stop does nothing", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  // Two presses in one tick, and a third once the stop is over.
  await capsule.evaluate(async () => {
    window.avanzel.capsule.stopTranscribing();
    window.avanzel.capsule.stopTranscribing();
    await window.avanzel.settings.get();
  });
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  expect(filesUnder(library, "inbox")).toHaveLength(1);
  expect((await sentToCapsule(app)).filter((kind) => kind === "recorded")).toHaveLength(1);
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("Stop is heard from the capsule's page alone", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  // Every window has the same bridge, so Quick's page can send capsule:stop-transcribing; it isn't heard. (The panel's is: its
  // Processing tab offers the same Stop.)
  await call(app, "openQuick");
  await stopTranscribing(await windowFor(app, "quick"));
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "transcribing", slow: true });
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(capturesKept(userData)).toBe(0);
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  await app.close();
});

test("a name the inbox already has is not taken over: the recording is kept under the next free one", async () => {
  const { library, recording, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  // The inbox has files with the recording's own name, and the next one's: they are the person's, and stay as they are.
  const name = path.basename(filesUnder(library, "raw/audio")[0]!);
  const stem = name.replace(/\.wav$/, "");
  writeFileSync(path.join(library, "inbox", name), "Someone else's file, with the recording's name.");
  writeFileSync(path.join(library, "inbox", `${stem}-2.wav`), "Someone else's file, with the next name.");
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  expect(read(library, `inbox/${name}`)).toBe("Someone else's file, with the recording's name.");
  expect(read(library, `inbox/${stem}-2.wav`)).toBe("Someone else's file, with the next name.");
  expect(filesUnder(library, "inbox")).toEqual([name, `${stem}-2.wav`, `${stem}-3.wav`].sort());
  expect(samplesOf(path.join(library, "inbox", `${stem}-3.wav`))).toEqual(samplesOf(recording));
  expect(filesUnder(library, "raw")).toEqual([]);
  await app.close();
});

test("Stop makes the inbox again when it has been removed", async () => {
  const { library, userData, recording, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  rmSync(path.join(library, "inbox"), { recursive: true });
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(samplesOf(path.join(library, "inbox", name!))).toEqual(samplesOf(recording));
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

test("a recording the library keeps no copy of in raw/audio/ is written to the inbox as it was said", async () => {
  // A link on the way: the library keeps no recordings there, and says so when it saves words without theirs.
  const library = await makeLibrary();
  const outside = mkdtempSync(path.join(tmpdir(), "avz-e2e-outside-"));
  mkdirSync(path.join(library, "raw", "audio"));
  symlinkSync(outside, path.join(library, "raw", "audio", String(new Date().getFullYear())));
  const { userData, recording, app, capsule } = await launchSlowly(60_000, { library });
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "recorded", review: "at 21:00" });
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.wav$/);
  expect(samplesOf(path.join(library, "inbox", name!))).toEqual(samplesOf(recording));
  expect(readdirSync(outside)).toEqual([]); // nothing went through the link
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(capturesKept(userData)).toBe(1);
  await app.close();
});

/** A library in a deep folder, so that an error naming a path inside it is longer than a card keeps of a line. */
async function deepLibrary(): Promise<string> {
  const library = await makeLibrary();
  const deep = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-deep-")), "Documents", "Notes and thoughts", "Avanzel");
  mkdirSync(path.dirname(deep), { recursive: true });
  renameSync(library, deep);
  return deep;
}

/** Makes `library` keep no copy of this year's recordings: the folder for them is a link, which a library never saves through. Returns where the link leads. */
function linkRecordingsAway(library: string): string {
  const outside = mkdtempSync(path.join(tmpdir(), "avz-e2e-outside-"));
  mkdirSync(path.join(library, "raw", "audio"), { recursive: true });
  symlinkSync(outside, path.join(library, "raw", "audio", String(new Date().getFullYear())));
  return outside;
}

test("a recording that can't be moved to the inbox is where the card says, which doesn't promise it stays", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000, { library: await deepLibrary() });
  await dictate(app);
  await untilSlow(app);
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555); // nothing can be put there
  try {
    await stopTranscribing(capsule);
    // Why, then where the recording is. The reason names two long paths: it is cut before the first, not through it, and the recording's
    // own place follows whole. The card says nothing of the recording staying: a transcription that finds no words removes it.
    const [recording] = filesUnder(library, "raw/audio");
    const title = "Avanzel couldn't move the recording to the inbox.";
    const body = `EACCES: permission denied… The transcription goes on, and your recording is in raw/audio/${recording}.`;
    expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: body });
    await expectProblem(capsule, { title, lines: [body] });
    expect(filesUnder(library, "raw/audio")).toHaveLength(1);
    expect(filesUnder(library, "inbox")).toEqual([]);
    expect(capturesKept(userData)).toBe(0);
    expect(await sentToCapsule(app)).not.toContain("recorded");
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

test("a recording the library keeps no copy of, that can't be written to the inbox, is said to be saved nowhere", async () => {
  const library = await deepLibrary();
  const outside = linkRecordingsAway(library);
  const { userData, app, capsule } = await launchSlowly(60_000, { library });
  await dictate(app);
  await untilSlow(app);
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555);
  try {
    await stopTranscribing(capsule);
    const title = "Avanzel couldn't move the recording to the inbox.";
    const body = "EACCES: permission denied… The transcription goes on, but no copy of your recording is saved.";
    expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: body });
    await expectProblem(capsule, { title, lines: [body] });
    expect(filesUnder(library, "inbox")).toEqual([]);
    expect(readdirSync(outside)).toEqual([]);
    expect(capturesKept(userData)).toBe(0);
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

// ---- The problems a recording ends in ----
//
// Each of these says what happened, what is safe (where the recording is kept, or that nothing was saved) and, when there is one, the
// fix. A reason is the system's line (Node's or the speech engine's) cut before its paths, or Avanzel's own, told whole.

test("a transcription that fails says the recording couldn't be turned into words, and where the recording is kept", async () => {
  const { library, userData, app, capsule } = await launchSlowly(0, { library: await deepLibrary() });
  await noteTranscriptions(app, { failWith: "the speech model fell over" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  const [recording] = filesUnder(library, "raw/audio");
  const title = "The recording couldn't be turned into words.";
  const body = `The speech model fell over. Your recording is kept in raw/audio/${recording}.`;
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: body });
  await expectProblem(capsule, { title, lines: [body] }); // no fix: trying again is the next recording
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(capturesKept(userData)).toBe(0); // a recording that fails keeps no note, so it doesn't count
  await app.close();
});

test("a transcription that fails, in a library that keeps no copy of the recording, says nothing was saved", async () => {
  const library = await makeLibrary();
  linkRecordingsAway(library);
  const { app, capsule } = await launchSlowly(0, { library });
  await noteTranscriptions(app, { failWith: "the speech model fell over" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  const title = "The recording couldn't be turned into words.";
  await expectProblem(capsule, { title, lines: ["The speech model fell over. Nothing was saved."] });
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("words that can't be saved say so, and where the recording is kept", async () => {
  const { library, userData, app, capsule } = await launchSlowly(0, { library: await deepLibrary() });
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555); // the words can't be written
  try {
    await dictate(app);
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    const [recording] = filesUnder(library, "raw/audio");
    const title = "Your words couldn't be saved.";
    const body = `EACCES: permission denied… Your recording is kept in raw/audio/${recording}.`;
    expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: body });
    await expectProblem(capsule, { title, lines: [body] });
    expect(filesUnder(library, "inbox")).toEqual([]);
    expect(capturesKept(userData)).toBe(0);
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

test("words that can't be saved, in a library that keeps no copy of the recording, say nothing was saved", async () => {
  const library = await deepLibrary();
  linkRecordingsAway(library);
  const { app, capsule } = await launchSlowly(0, { library });
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555);
  try {
    await dictate(app);
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    await expectProblem(capsule, { title: "Your words couldn't be saved.", lines: ["EACCES: permission denied… Nothing was saved."] });
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

test("a screen comment that can't be saved says the screen capture couldn't be, and its screenshot goes with it", async () => {
  const { library, app, capsule } = await launchSlowly(0, {
    library: await deepLibrary(),
    env: { AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555);
  try {
    await call(app, "toggleCapture");
    await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
    await call(app, "toggleCapture");
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    const [recording] = filesUnder(library, "raw/audio");
    // The card says the screenshot is gone, as it is: no screenshot is left in the library with no note to hold it. The recording is
    // the person's voice, and stays where it was written.
    await expectProblem(capsule, {
      title: "The screen capture couldn't be saved.",
      lines: [`EACCES: permission denied… The screenshot is gone. Your recording is kept in raw/audio/${recording}.`],
    });
    expect(filesUnder(library, "raw/attachments")).toEqual([]);
    expect(filesUnder(library, "inbox")).toEqual([]);
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

test("a screen comment with no words that can't be saved is still the screen capture that couldn't be saved, and nothing was", async () => {
  // A comment with no words is a normal one: it is saved as "No comment". What fails here is its save, so the card does not say that
  // the recording couldn't be turned into words. The recording went with the words that weren't there, and the screenshot with the note.
  const { library, app, capsule } = await launchSlowly(0, {
    library: await deepLibrary(),
    env: { AVANZEL_FAKE_TRANSCRIPT: "   ", AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555);
  try {
    await call(app, "toggleCapture");
    await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
    await call(app, "toggleCapture");
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    await expectProblem(capsule, {
      title: "The screen capture couldn't be saved.",
      lines: ["EACCES: permission denied… The screenshot is gone, and nothing was saved."],
    });
    expect(filesUnder(library, "raw/attachments")).toEqual([]);
    expect(filesUnder(library, "raw/audio")).toEqual([]);
    expect(filesUnder(library, "inbox")).toEqual([]);
  } finally {
    chmodSync(inbox, 0o755);
  }
  await app.close();
});

test("a screenshot the library won't take says Avanzel couldn't capture the screen, in its own words, and that nothing was saved", async () => {
  const library = await makeLibrary();
  const outside = mkdtempSync(path.join(tmpdir(), "avz-e2e-outside-"));
  rmSync(path.join(library, "raw", "attachments"), { recursive: true, force: true });
  symlinkSync(outside, path.join(library, "raw", "attachments")); // a link on the way: the library saves nothing through it
  const { app, capsule } = await launchSlowly(0, {
    library,
    env: { AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("error");
  // The library's own sentence says what to do about it, so it is told whole.
  const why = /^Avanzel saves only into plain folders, and raw\/attachments\/\d{4}\/\d{2} isn't one: a link or a file is on its path\. Remove it, then try again\. Nothing was saved\.$/;
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Avanzel couldn't capture the screen.",
    detail: expect.stringMatching(why),
  });
  await expectProblem(capsule, { title: "Avanzel couldn't capture the screen.", lines: [why] });
  expect(readdirSync(outside)).toEqual([]); // nothing went through the link
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("a screenshot that was taken for a recording that can't start is removed, and the card says the screen comment couldn't start", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchSlowly(0, {
    library,
    env: { AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  // The library's settings break after Avanzel has read them: the screenshot is taken, and then the recording can't start. The screen
  // was captured, so the card does not say it couldn't be: it says what didn't happen, and what is safe.
  writeFileSync(path.join(library, ".avanzel", "config.toml"), 'harness = "claude"\ntimeout_seconds =\n');
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("error");
  await expectProblem(capsule, {
    title: "The screen comment couldn't start.",
    lines: [/config\.toml: invalid TOML at line 2, column \d+: .+\. Nothing was saved\.$/],
  });
  expect(filesUnder(library, "raw/attachments")).toEqual([]); // the card says nothing was saved: the screenshot is not left behind
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("Stop keeps the recording in the library it was made in, and names that library's evening review", async () => {
  // This library's evening review is off and the other one's is on, so the card shows whose review it names.
  const library = await makeLibrary();
  const review = path.join(library, "tasks", "evening-review.md");
  writeFileSync(review, readFileSync(review, "utf8").replace("enabled: true", "enabled: false"));
  // A library chosen is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const { app, capsule } = await launchSlowly(60_000, { library, env: { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) } });
  await dictate(app);
  await untilSlow(app);
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "transcribing", slow: true });
  await stopTranscribing(capsule);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "recorded", review: null });
  // This library's review is off, so the card says only where the recording is: it promises no review.
  await expectStoppedRecording(capsule, "It's in the inbox.");
  await expect(capsule.getByText(/evening review/)).toHaveCount(0);
  expect(filesUnder(library, "inbox")).toHaveLength(1);
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(filesUnder(other, "inbox")).toEqual([]);
  expect(filesUnder(other, "raw")).toEqual([]);
  await app.close();
});

test("a recording waiting in the inbox is never committed, though the filing after it commits everything else", async () => {
  // Recordings stay on this machine, and the library's git commits everything the inbox holds before a filing, and with it.
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchSlowly(60_000, { library });
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule);
  await expect.poll(() => capsuleKind(app)).toBe("recorded"); // git is asked first, in a library with git
  const [recording] = filesUnder(library, "inbox");
  // A thought typed after it is filed now: the owner's changes are committed before the filing, and the filing after them.
  await call(app, "submitQuick", "Plant tulips in October");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const subjects = gitOut(library, "log", "--all", "--format=%s").split("\n");
  expect(subjects.some((subject) => subject.startsWith("avanzel: owner's changes before file "))).toBe(true);
  expect(subjects.some((subject) => subject.startsWith("avanzel: file "))).toBe(true);
  const everWritten = gitOut(library, "log", "--all", "--name-only", "--format=").split("\n").filter(Boolean);
  expect(everWritten.filter((name) => /\.wav$/i.test(name))).toEqual([]);
  expect(gitOut(library, "ls-files").split("\n").filter((name) => /\.wav$/i.test(name))).toEqual([]);
  expect(gitOut(library, "status", "--porcelain")).toBe("");
  expect(filesUnder(library, "inbox")).toEqual([recording]); // still waiting there for the evening review
  await app.close();
});

test("an older transcription that runs long doesn't turn a newer recording's card slow, and Stop doesn't reach it", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000, { env: { AVANZEL_TRANSCRIBE_STOP_MS: "2000" } });
  await noteTranscriptions(app);
  await dictate(app);
  await expect.poll(async () => (await transcriptions(app)).started, { timeout: 30_000 }).toBe(1); // the first one's words are being made
  // The next recording's audio is held on its way to the controller, so that its card stays on "transcribing" for as long as the test
  // reads it: no transcription of its own has started.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined);
  });
  await dictate(app);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true });
  await sleep(3_000); // past the 2 s after which the first transcription turns slow
  await stopTranscribing(capsule);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true });
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1); // the first recording, where it was
  expect(capturesKept(userData)).toBe(0);
  await app.close();
});

test("an older transcription that ends while a newer one runs leaves the newer one its Stop", async () => {
  const { library, userData, app, capsule } = await launchSlowly(0);
  await noteTranscriptions(app, { hold: true }); // each one's words come when the test says
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule); // the first is kept in the inbox, and its transcription goes on
  expect(await capsuleKind(app)).toBe("recorded");
  await dictate(app);
  await expect.poll(async () => (await transcriptions(app)).started, { timeout: 30_000 }).toBe(2);
  await untilSlow(app);
  // The first one's words come now, and are dropped. The second is still what the capsule shows, and Stop is still its.
  await letTranscriptionGo(app, 1);
  await expect.poll(async () => (await transcriptions(app)).ended, { timeout: 30_000 }).toBe(1);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "transcribing", slow: true });
  await stopTranscribing(capsule);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "recorded", review: "at 21:00" });
  expect(filesUnder(library, "inbox")).toHaveLength(2);
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(capturesKept(userData)).toBe(2);
  await app.close();
});

test("a transcription that runs long while another card is up leaves that card alone", async () => {
  const { app } = await launchSlowly(60_000, { env: { AVANZEL_TRANSCRIBE_STOP_MS: "1000" } });
  await noteTranscriptions(app);
  await call(app, "setApp", { fileMode: "evening" }); // a thought typed meanwhile is saved: its card stays up for 4 s
  await dictate(app);
  await expect.poll(async () => (await transcriptions(app)).started, { timeout: 30_000 }).toBe(1);
  await call(app, "submitQuick", "A thought typed meanwhile");
  expect(await capsuleKind(app)).toBe("saved");
  await sleep(1_800); // past the 1 s after which the transcription turns slow, and before the saved card hides
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", text: "A thought typed meanwhile" });
  expect(await call(app, "capsuleStateForTests")).not.toHaveProperty("slow");
  await app.close();
});

test("a screen comment's transcription is never offered Stop: its words and screenshot are saved together", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000, {
    env: { AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  await sleep(3 * SLOW_MS); // long enough for a dictation's transcription to have turned slow
  await stopTranscribing(capsule);
  // Its state still carries the screenshot and what it is of, for the card above the bar; the press changed nothing of it.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "transcribing",
    mode: "comment",
    onThisMac: true,
    thumbnail: expect.stringMatching(/^data:image\/png;base64,/),
    context: { app: "Safari", title: "Growing basil", url: "https://example.com/basil" },
  });
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(capturesKept(userData)).toBe(0);
  await app.close();
});

test("a screen comment keeps its screenshot card while its words are made: the same card, as large, above the bar", async () => {
  const { app, capsule } = await launchSlowly(60_000, {
    env: { AVANZEL_FAKE_SCREEN: screenshotFixture(), AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil" },
  });
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  const card = capsule.getByRole("article");
  const picture = card.getByRole("img", { name: "Screenshot of Safari", exact: true });
  await expect(card.getByText("Safari", { exact: true })).toBeVisible(); // the card is labelled with the app
  await expect(picture).toBeVisible();
  await capsuleAtRest(capsule); // measured once the capsule has risen in: on its way up it is drawn smaller than its size
  const listening = (await picture.boundingBox())!;
  await card.evaluate((el) => Object.assign(el, { listeningCard: true })); // a card drawn again would not carry this
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  // The bar says the words are being made, and the card above it is still there: the same node, with the same picture at the same size,
  // so that it is not drawn away and again between listening and saved.
  await expect(capsule.getByRole("status").getByText("Transcribing on this Mac…", { exact: true })).toBeVisible();
  await expect(card).toHaveCount(1);
  expect(await card.evaluate((el) => (el as unknown as { listeningCard?: boolean }).listeningCard === true)).toBe(true);
  await expect(card.getByText("Safari", { exact: true })).toBeVisible();
  await expect(picture).toBeVisible();
  const transcribing = (await picture.boundingBox())!;
  expect(transcribing.width).toBe(listening.width);
  expect(transcribing.height).toBe(listening.height);
  expect(transcribing.x).toBe(listening.x);
  await expect(capsule.getByRole("button")).toHaveCount(0); // a comment's transcription is never offered Stop
  await expectInPanel(capsule);
  await app.close();
});

test("a dictation's transcription has a bar and no card above it", async () => {
  const { app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  await expect(capsule.getByRole("status").getByText("Transcribing on this Mac…", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("article")).toHaveCount(0);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true });
  await app.close();
});

test("setup's first spoken thought is never offered Stop: its window shows its own progress", async () => {
  const run = firstRun({ claude: filingClaude() });
  const app = await launch({
    ...run.env,
    AVANZEL_FAKE_AUDIO: speechWav("Plant tulips in October"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    AVANZEL_TRANSCRIBE_STOP_MS: String(SLOW_MS),
    AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "60000",
  });
  await throughFound(app);
  const library = path.join(run.home, "Avanzel");
  await pressShortcut(app);
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await pressShortcut(app);
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  await sleep(3 * SLOW_MS);
  await stopTranscribing(await windowFor(app, "capsule"));
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "dictate", onThisMac: true });
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("quitting while a stopped transcription is still running leaves its recording in the inbox, and nothing else", async () => {
  const { library, recording, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  await stopTranscribing(capsule);
  expect(await capsuleKind(app)).toBe("recorded");
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  closed.catch(() => undefined); // reported by the await below
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await closed;
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(samplesOf(path.join(library, "inbox", name!))).toEqual(samplesOf(recording));
  expect(filesUnder(library, "raw")).toEqual([]);
});

test("Esc gives a recording up through the shortcut stand-in, so no real Esc is taken from this Mac", async () => {
  const { app } = await launchSlowly(60_000);
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(false); // nothing is recording, so Esc is not registered
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await expect.poll(() => call(app, "pressShortcutForTests", "Escape")).toBe(true); // registered just after the card shows
  await expect.poll(() => capsuleKind(app)).not.toBe("listening");
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(false); // let go with the recording
  await app.close();
});
