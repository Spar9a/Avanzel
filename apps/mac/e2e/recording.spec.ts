// The recording state machine: tap to start, tap to stop, and what happens when taps or audio go astray.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  launch,
  makeLibrary,
  read,
  screenshotFixture,
  speechWav,
  stubPicker,
  throughFound,
  windowFor,
} from "./helpers.ts";
import { pressShortcut, sentToCapsule, watchCapsule } from "./setup-helpers.ts";

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
  await expect(capsule.getByText("The recording didn't arrive")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ action: "open-settings:voice" }); // its Open Settings opens Voice
  expect(await app.evaluate(() => (globalThis as unknown as { __commands: unknown[] }).__commands)).toEqual(["start", "stop", "cancel"]);
  await app.close();
});

// ---- Stop, on a transcription that has run long ----
//
// What Stop does is told at the controller's `stopTranscribing`. The card has no Stop button yet, so these press it as the button will:
// through the capsule page's bridge, `window.avanzel.capsule.stopTranscribing()`, which `call()` can't do, since the channel answers
// only the page that sends it. AVANZEL_TRANSCRIBE_STOP_MS makes a transcription slow after half a second (20 s outside tests), and
// AVANZEL_FAKE_TRANSCRIPT_DELAY_MS makes the stand-in for the speech model take as long as a test needs.

const SLOW_MS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop, pressed on `page` as the transcribing card's Stop will press it. A page's messages reach main in the order they were sent, so
 * the settings round trip after the press is answered once main has heard it: this returns when the press has taken effect.
 */
const stopTranscribing = (page: Page) =>
  page.evaluate(async () => {
    window.avanzel.capsule.stopTranscribing();
    await window.avanzel.settings.get();
  });

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

/** The controller's own `transcribe`, which these tests wrap in the main process. */
type Hearing = { transcribe(samples: unknown): Promise<unknown> };

/**
 * From now on, counts the transcriptions that have started and those that have ended, with their words or with a failure
 * (`transcriptions`): the controller's own `transcribe`, wrapped. With `failWith`, each fails with that message once the stand-in
 * for the speech model has given its words.
 */
async function noteTranscriptions(app: ElectronApplication, failWith?: string): Promise<void> {
  await app.evaluate((_electron, failure) => {
    const controller = (globalThis as unknown as { __avanzel: Hearing }).__avanzel;
    const transcribe = controller.transcribe.bind(controller);
    const counts = { started: 0, ended: 0 };
    Object.assign(globalThis, { transcriptions: counts });
    controller.transcribe = async (samples) => {
      counts.started++;
      try {
        const heard = await transcribe(samples);
        if (failure !== undefined) throw new Error(failure);
        return heard;
      } finally {
        counts.ended++;
      }
    };
  }, failWith);
}

const transcriptions = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { transcriptions?: { started: number; ended: number } }).transcriptions ?? { started: 0, ended: 0 });

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
  // The recording itself, as audio the engine's queue transcribes: one .wav in the inbox, none left in raw/audio/, no capture written.
  const [name, ...others] = filesUnder(library, "inbox");
  expect(others).toEqual([]);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.wav$/);
  expect(samplesOf(path.join(library, "inbox", name!))).toEqual(samplesOf(recording));
  expect(new Vault(library).pending()).toEqual([path.join(library, "inbox", name!)]);
  expect(filesUnder(library, "raw")).toEqual([]);
  // A recording the library keeps counts toward the first ten, as the others do.
  expect(capturesKept(userData)).toBe(1);
  // The card hides itself after 6 s, as the card of a stopped filing does.
  await expect.poll(() => capsuleKind(app), { timeout: 15_000, intervals: [100] }).toBe("hidden");
  expect(Date.now() - stopped).toBeGreaterThanOrEqual(5_000);
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
  await noteTranscriptions(app, "the speech model fell over");
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
  // Every window has the same bridge, so Settings' page can send capsule:stop-transcribing; it isn't heard.
  await call(app, "showSettings");
  await stopTranscribing(await windowFor(app, "settings"));
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

test("a recording that can't be moved to the inbox stays where it is, and the capsule says so", async () => {
  const { library, userData, app, capsule } = await launchSlowly(60_000);
  await dictate(app);
  await untilSlow(app);
  const inbox = path.join(library, "inbox");
  chmodSync(inbox, 0o555); // nothing can be put there
  try {
    await stopTranscribing(capsule);
    expect(await call(app, "capsuleStateForTests")).toMatchObject({
      kind: "error",
      message: "Avanzel couldn't move the recording to your inbox.",
      detail: expect.stringMatching(/^EACCES: permission denied.* The transcription goes on, and your recording stays where it is\.$/),
    });
    expect(filesUnder(library, "raw/audio")).toHaveLength(1);
    expect(capturesKept(userData)).toBe(0);
    expect(await sentToCapsule(app)).not.toContain("recorded");
  } finally {
    chmodSync(inbox, 0o755);
  }
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
  expect(filesUnder(library, "inbox")).toHaveLength(1);
  expect(filesUnder(library, "raw")).toEqual([]);
  expect(filesUnder(other, "inbox")).toEqual([]);
  expect(filesUnder(other, "raw")).toEqual([]);
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
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "transcribing", mode: "comment", onThisMac: true });
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(capturesKept(userData)).toBe(0);
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
