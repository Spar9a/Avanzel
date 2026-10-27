// The five quiet sounds (spec §4.6): what main tells the capsule's page to play and when (`capsule:sound`), what the page plays, and the
// rules that keep them quiet: off by default, one sound for each moment, and none over a recording. Each test wraps the capsule's
// `webContents.send`, as `watchCapsule` does, to read what main sent in order; what the page played it reads from the page's own record
// (`__avanzelSounds`). Every window is muted first, so the suite makes no noise on the Mac it runs on: the page plays all the same.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import { dictate, launchOn, sleep } from "./capsule-helpers.ts";
import {
  audioContexts,
  call,
  capsuleKind,
  expectPreviewPlayed,
  filingClaude,
  firstRun,
  launch,
  makeLibrary,
  muteWindows,
  played,
  speechWav,
  toDone,
  watchAudioContexts,
  windowFor,
} from "./helpers.ts";
import { setupSnap, settingsSnap } from "./setup-helpers.ts";

/** One message to the capsule's page, as main sent it: a state (its kind), a sound (its name), a command, or the setting's state ("on" or "off"). */
type Sent = [channel: string, value: string];

/** A notification as the controller kept it for the tests: `silent` only on one that was posted without macOS's sound. */
type Note = { title: string; body: string; silent?: true };

/** The windows are muted, and the capsule's page listens: a sound is not held for a page that doesn't, as a command is. */
async function quiet(app: ElectronApplication): Promise<void> {
  await call(app, "capsuleStateForTests"); // the controller is there
  await muteWindows(app);
  await expect.poll(() => capsuleListens(app), { timeout: 20_000 }).toBe(true);
}

/** Whether the capsule's page has said it listens (`capsule:ready`) since it last loaded. */
const capsuleListens = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __avanzel: { capsuleListening: boolean } }).__avanzel.capsuleListening);

/** Sounds on, as the person switches them on. */
async function soundsOn(app: ElectronApplication): Promise<void> {
  await quiet(app);
  await call(app, "setApp", { sounds: true });
}

/** From now on, notes in order what main sends the capsule's page: the kind of each state, each sound and each command. */
async function watchSends(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const sent: Sent[] = [];
    (globalThis as { sentToPage?: Sent[] }).sentToPage = sent;
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:state") sent.push([channel, (args[0] as { kind: string }).kind]);
      else if (channel === "capsule:sound" || channel === "capsule:command") sent.push([channel, String(args[0])]);
      else if (channel === "capsule:sounds-setting") sent.push([channel, args[0] === true ? "on" : "off"]);
      send(channel, ...args);
    };
  });
}

const sentToPage = (app: ElectronApplication) => app.evaluate(() => (globalThis as { sentToPage?: Sent[] }).sentToPage ?? []);

/** What main sent, as "sound tick": the sounds and commands, and only the states named (the filing's many are left out). The setting's state is `settingSent`'s. */
async function story(app: ElectronApplication, states: string[] = ["listening", "filed", "hidden"]): Promise<string[]> {
  return (await sentToPage(app))
    .filter(([channel, value]) => channel !== "capsule:sounds-setting" && (channel !== "capsule:state" || states.includes(value)))
    .map(([channel, value]) => `${channel.slice("capsule:".length)} ${value}`);
}

/** The setting's state main told the page, in order: "on" when sounds were switched on (or the page loaded with them on), "off" when they were switched off. */
const settingSent = async (app: ElectronApplication) => (await sentToPage(app)).filter(([channel]) => channel === "capsule:sounds-setting").map(([, state]) => state);

/** The sounds main sent, in order. */
const soundsSent = async (app: ElectronApplication) => (await sentToPage(app)).filter(([channel]) => channel === "capsule:sound").map(([, name]) => name);

const notes = async (app: ElectronApplication) => (await call(app, "notificationsForTests")) as Note[];

const reviewNotes = async (app: ElectronApplication) => (await notes(app)).filter((note) => note.title.startsWith("Evening review"));

/** An app on a new library with one note waiting in its inbox, for an evening review to file. `env` steers it. */
async function withNote(env: Record<string, string> = {}) {
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  return launchOn(library, env);
}

/** A filed card as main sends it, with one page. `over` changes some of it. */
const filedCard = (over: Record<string, unknown> = {}) => ({
  kind: "filed",
  text: "Plant tulips in October",
  agent: "Claude Code",
  seconds: 23,
  pages: [{ title: "Tulips for October", shelf: "ideas", path: "ideas/tulips.md", created: true }],
  canUndo: false,
  noted: false,
  ...over,
});

// ---- Off by default ----

test("no sound is sent while sounds are off", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await quiet(app);
  await watchSends(app);
  // A dictation and its filing, the card put away, and another dictation given up.
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "dismiss");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  const sent = await sentToPage(app);
  expect(sent.filter(([channel]) => channel === "capsule:sound")).toEqual([]);
  // The recorder was told all the same, so the nothing above is the setting's, not a recording that never ran.
  expect(sent.filter(([channel]) => channel === "capsule:command").map(([, command]) => command)).toEqual(["start", "stop", "start", "cancel"]);
  expect(await played(capsule)).toEqual([]);
  await app.close();
});

// ---- Each moment sends its sound ----

test("with sounds on, each moment sends its sound, in order", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
  await call(app, "toggleDictate"); // Record a thought
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate"); // and stop
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => played(capsule)).toContain("stamp"); // it lands a moment after the card is drawn
  await call(app, "dismiss"); // Hide
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock", "stamp", "drawer"]);
  // The Tick comes before the recorder is told to start and the Tock before it is told to stop; the Stamp comes with the filed card and
  // the Drawer as it goes.
  expect(await story(app)).toEqual([
    "state listening",
    "sound tick",
    "command start",
    "sound tock",
    "command stop",
    "state filed",
    "sound stamp",
    "state hidden",
    "sound drawer",
  ]);
  await app.close();
});

test("Esc while listening sends a Tock before the cancel, and so does the cross", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording"); // what the Esc key runs
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "dismiss"); // the cross on the listening card
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(await story(app)).toEqual([
    "state listening",
    "sound tick",
    "command start",
    "sound tock",
    "command cancel",
    "state hidden",
    "state listening",
    "sound tick",
    "command start",
    "sound tock",
    "command cancel",
    "state hidden",
  ]); // no Drawer: a recording given up is no card put away
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock", "tick", "tock"]);
  await app.close();
});

test("a saved card goes in the drawer when it puts itself away, and a card that another card replaces does not", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await call(app, "setApp", { fileMode: "evening" }); // the thought is saved for the evening review
  await watchSends(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("saved");
  expect(await call(app, "capsuleStateForTests")).not.toHaveProperty("undone");
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden"); // after 4 s, by itself
  expect((await story(app, ["saved", "hidden"])).slice(-2)).toEqual(["state hidden", "sound drawer"]);

  // A filed card that a new recording replaces is not put away: it goes to the recording, and the recording has only its own sounds.
  await call(app, "setApp", { fileMode: "now" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => played(capsule)).toContain("stamp");
  const before = await soundsSent(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  expect((await soundsSent(app)).slice(before.length)).toEqual(["tick", "tock"]);
  await app.close();
});

test("the Undone card isn't put in the drawer", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await soundsOn(app);
  await watchSends(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => played(capsule)).toContain("stamp");
  // Undo as the card's button sends it. A real click would leave the pointer on the card, and a card under the pointer is held open.
  await capsule.evaluate(() => window.avanzel.capsule.undo());
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "saved", undone: true });
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden"); // the Undone card puts itself away after 3.5 s
  await sleep(300);
  expect(await soundsSent(app)).toEqual(["tick", "tock", "stamp"]); // no Drawer: the card was never filed or saved
  expect(await story(app, ["filed", "saved", "hidden"])).toEqual([
    "sound tick",
    "command start",
    "sound tock",
    "command stop",
    "state filed",
    "sound stamp",
    "state saved",
    "state hidden",
  ]);
  expect(await played(capsule)).toEqual(["tick", "tock", "stamp"]);
  await app.close();
});

test("a recording that is cancelled as it stops is heard to stop once", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // The stop and the cancel in one turn of main, as when the audio is on its way: the Tock went with the stop, and the cancel adds none.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void>; cancelRecording(): void } }).__avanzel;
    void controller.toggleDictate();
    controller.cancelRecording();
  });
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(await story(app)).toEqual(["state listening", "sound tick", "command start", "sound tock", "command stop", "command cancel", "state hidden"]);
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock"]);
  await app.close();
});

test("a sound is lost, not held, while the capsule's page is loading, though its commands are held", async () => {
  const { app } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
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
  // The commands waited for the page, and the Tick and the Tock, sent to a page that was not there to hear them, were not sent at all.
  expect((await story(app)).filter((line) => line.startsWith("command"))).toEqual(["command start", "command stop"]);
  expect(await soundsSent(app)).toEqual(["stamp"]);
  await app.close();
});

// ---- The evening review ----

test("a review's Letter comes with a silent notification", async () => {
  const { app, capsule } = await withNote();
  await soundsOn(app);
  await watchSends(app);

  // Sounds on, and a note to file: the Letter is sent, and the notification makes no sound of its own, since the Letter is its sound.
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => (await reviewNotes(app)).length, { timeout: 60_000 }).toBe(1);
  expect((await reviewNotes(app))[0]).toMatchObject({ title: "Evening review: 1 thing filed", silent: true });
  await call(app, "idleForTests");
  expect(await soundsSent(app)).toEqual(["letter"]);
  await expect.poll(() => played(capsule)).toEqual(["letter"]);

  // Sounds on and nothing to file: the review still ends, and says so in the same way.
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => (await reviewNotes(app)).length, { timeout: 60_000 }).toBe(2);
  expect((await reviewNotes(app))[1]).toEqual({ title: "Evening review", body: "Inbox was empty.", silent: true });
  await call(app, "idleForTests");
  expect(await soundsSent(app)).toEqual(["letter", "letter"]);

  // Sounds off: no Letter, and the notification keeps macOS's sound.
  await call(app, "setApp", { sounds: false });
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => (await reviewNotes(app)).length, { timeout: 60_000 }).toBe(3);
  const [, , off] = await reviewNotes(app);
  expect(off).toEqual({ title: "Evening review", body: "Inbox was empty." });
  expect(off).not.toHaveProperty("silent");
  await call(app, "idleForTests");
  expect(await soundsSent(app)).toEqual(["letter", "letter"]);
  await app.close();
});

test("no app sound plays over a recording: a review that ends while a thought is said sends no Letter, and its notification keeps macOS's sound", async () => {
  const { app, capsule } = await withNote({ FAKE_AGENT_DELAY_MS: "1500" });
  await soundsOn(app);
  await watchSends(app);
  await call(app, "runTask", "evening-review");
  await call(app, "toggleDictate"); // a thought is being said when the review ends
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(async () => (await reviewNotes(app)).length, { timeout: 60_000 }).toBe(1);
  expect(await capsuleKind(app)).toBe("listening");
  const review = (await reviewNotes(app))[0]!;
  expect(review.title).toBe("Evening review: 1 thing filed");
  expect(review).not.toHaveProperty("silent"); // nothing played in its place
  expect(await soundsSent(app)).toEqual(["tick"]); // the recording's own Tick, and no Letter
  // Once the recording is over the sounds are back: its Tock, and the Stamp of its filing.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock", "stamp"]);
  expect(await soundsSent(app)).toEqual(["tick", "tock", "stamp"]);
  await app.close();
});

test("a filing that ends in a notification plays nothing of its own, and none plays over the next thought", async () => {
  const { app, capsule } = await launchOn(await makeLibrary(), { FAKE_AGENT_DELAY_MS: "1500", FAKE_AGENT_DELAY_TASK: "file" });
  await soundsOn(app);
  await watchSends(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "toggleDictate"); // the next thought is being said when the first is filed
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(async () => (await notes(app)).filter((note) => note.title.startsWith("Filed by")).length, { timeout: 60_000 }).toBe(1);
  const filed = (await notes(app)).find((note) => note.title.startsWith("Filed by"))!;
  expect(filed).not.toHaveProperty("silent"); // macOS's sound stands
  expect(await capsuleKind(app)).toBe("listening");
  expect(await soundsSent(app)).toEqual(["tick", "tock", "tick"]); // no Stamp, no Drawer: the notification is the filing's whole voice
  await call(app, "cancelRecording");
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock", "tick", "tock"]);
  await app.close();
});

// ---- The page ----

/**
 * How long after the filed card was drawn the page played the Stamp. The card is `card`, put up by main (`setCapsule`), which sends the
 * Stamp with it, as a filing that ends well does. A Tick is played first, to be sure that the page's AudioContext is made: the page
 * makes it when it is told sounds are on (`soundsOn`), or else at its first sound, which takes a moment of its own (about a tenth of a
 * second) that this is not about.
 */
async function stampLag(app: ElectronApplication, capsule: Page, card: Record<string, unknown>): Promise<number> {
  await call(app, "sound", "tick");
  await expect.poll(() => played(capsule)).toEqual(["tick"]);
  await capsule.evaluate(() => {
    const seen = globalThis as { cardDrawnAt?: number };
    delete seen.cardDrawnAt;
    new MutationObserver((_changes, observer) => {
      if (!document.querySelector("article")) return;
      seen.cardDrawnAt = performance.now();
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await call(app, "setCapsule", card);
  await expect.poll(() => played(capsule), { timeout: 5_000 }).toContain("stamp");
  return capsule.evaluate(() => {
    const seen = globalThis as { cardDrawnAt?: number; __avanzelSounds?: { name: string; at: number }[] };
    const stamp = seen.__avanzelSounds!.find((sound) => sound.name === "stamp")!;
    return stamp.at - seen.cardDrawnAt!;
  });
}

test("the Stamp is heard where the stamp lands on the card, 228 ms after the card is drawn", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  const lag = await stampLag(app, capsule, filedCard());
  // The stamp lands at 60% of the card's 380 ms. The page's timer starts as the sound message arrives, a frame or so after the card is in
  // the page, so the Stamp is heard a little over 228 ms after it (248 ms measured).
  expect(lag).toBeGreaterThanOrEqual(200);
  expect(lag).toBeLessThan(450);
  await app.close();
});

test("the Stamp is heard at once under Reduce Motion, where the stamp is drawn landed", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await capsule.emulateMedia({ reducedMotion: "reduce" });
  expect(await stampLag(app, capsule, filedCard())).toBeLessThan(100);
  await app.close();
});

test("the Stamp is heard at once on a noted card, whose stamp does not animate", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  expect(await stampLag(app, capsule, filedCard({ noted: true, pages: [] }))).toBeLessThan(100);
  await app.close();
});

test("a Stamp that would land on a card that has gone is not heard", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
  // The card is shown and put away in one turn of main, so the page has it gone before the stamp could land.
  await app.evaluate(
    (_electron, card) => {
      const controller = (globalThis as unknown as { __avanzel: { setCapsule(state: unknown): void } }).__avanzel;
      controller.setCapsule(card);
      controller.setCapsule({ kind: "hidden" });
    },
    filedCard(),
  );
  await expect.poll(() => played(capsule)).toEqual(["drawer"]);
  await sleep(600); // past the moment the stamp would have landed
  expect(await played(capsule)).toEqual(["drawer"]);
  expect(await soundsSent(app)).toEqual(["stamp", "drawer"]); // main sent both: the page decides what is still true
  await app.close();
});

test("the Tock is played once the microphone is let go, and before the audio is sent", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app);
  // The audio takes its time to be taken in, so a Tock that waited for the audio to be sent would be heard well after it was.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { onAudio(samples: Float32Array): Promise<void> } }).__avanzel;
    const onAudio = controller.onAudio.bind(controller);
    controller.onAudio = async (samples) => {
      (globalThis as { audioArrivedAt?: number }).audioArrivedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 700));
      return onAudio(samples);
    };
  });
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const arrived = await app.evaluate(() => (globalThis as { audioArrivedAt?: number }).audioArrivedAt!);
  const tock = await capsule.evaluate(() => {
    const sound = (globalThis as { __avanzelSounds?: { name: string; at: number }[] }).__avanzelSounds!.find((entry) => entry.name === "tock")!;
    return performance.timeOrigin + sound.at; // the page's clock, as the time of day main's Date.now() tells
  });
  expect(tock).toBeLessThan(arrived + 100);
  expect(tock).toBeGreaterThan(arrived - 5_000);
  await app.close();
});

test("the capsule's page can play while its window is hidden, which is when the Drawer and the Letter play", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await call(app, "capsuleStateForTests");
  expect(await capsuleKind(app)).toBe("hidden");
  // A context with nothing in it makes no sound, so this is heard by no one. It runs, or it does not: that is the question.
  const runs = (page: Page) =>
    page.evaluate(async () => {
      const context = new AudioContext();
      await context.resume();
      const from = context.currentTime;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const advanced = context.currentTime - from;
      await context.close();
      return advanced > 0.15;
    });
  const hidden = await runs(capsule);
  await call(app, "setCapsule", filedCard()); // the window shows
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes("/renderer/capsule/") && w.isVisible()))).toBe(true);
  const shown = await runs(capsule);
  await app.close();
  test.skip(!shown, "this Mac gives the page no audio output to run on, hidden or not");
  expect(hidden, "hiding the capsule's window must not stop its page's audio").toBe(true);
});

test("the Tock is played after the microphone has been let go", async () => {
  const library = await makeLibrary();
  // The real recorder, fed by Chromium's fake capture device (as microphone.spec.ts does): getUserMedia, the 16 kHz context, the worklet.
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_TRANSCRIPT: "Call Mark about the podcast microphones." }, [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ]);
  const capsule = await windowFor(app, "capsule");
  await soundsOn(app);
  // The page notes when the microphone opens, and when each of its tracks is stopped: a track that is stopped has let go of the microphone.
  await capsule.evaluate(() => {
    const seen = globalThis as { micOpenedAt?: number; trackStops?: number[] };
    seen.trackStops = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getUserMedia(...args);
      seen.micOpenedAt = performance.now();
      return stream;
    };
    const stop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function (this: MediaStreamTrack) {
      seen.trackStops!.push(performance.now());
      return stop.call(this);
    };
  });
  await call(app, "toggleDictate");
  await expect.poll(() => capsule.evaluate(() => (globalThis as { micOpenedAt?: number }).micOpenedAt !== undefined), { timeout: 20_000 }).toBe(true);
  await sleep(1000); // a recording shorter than 0.3 s has no words to make
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const { stops, tock } = await capsule.evaluate(() => {
    const seen = globalThis as { trackStops?: number[]; __avanzelSounds?: { name: string; at: number }[] };
    return { stops: seen.trackStops!, tock: seen.__avanzelSounds!.find((sound) => sound.name === "tock")!.at };
  });
  expect(stops.length, "the microphone's track was stopped").toBeGreaterThan(0);
  expect(tock).toBeGreaterThanOrEqual(Math.max(...stops)); // the Tock comes after the last track let go, not with the stop's arrival
  await app.close();
});

// ---- The setting reaches the capsule's page ----
//
// Opening the audio device takes the page about a tenth of a second. If the page made its AudioContext at its first sound, that would be
// the Tick's, on the page's thread ahead of the recorder's start. So main tells the page when sounds go on (`capsule:sounds-setting`), and
// when it loads with them on, and the page makes its context then; it closes it when they go off, or the device would stay open until Avanzel
// quits. A sound that waits when they go off (the Tock for the microphone, the Stamp for the stamp to land) is dropped, not played on a new context.

/** The capsule's page loads again, as it does at a launch: it says it listens (`capsule:ready`) and main tells it what it needs. */
const reloadCapsule = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!.webContents.reload();
  });

/** Main sent the capsule a state since `watchSends`: the page has loaded again and said it listens, and what main tells it then has been sent. */
const toldAgain = async (app: ElectronApplication) => (await sentToPage(app)).some(([channel]) => channel === "capsule:state");

test("switching sounds on makes the capsule page's AudioContext before any sound plays, and switching them off closes it", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await quiet(app);
  await capsule.evaluate(watchAudioContexts); // this page as it is: sounds are off, so it has made none
  await watchSends(app);
  expect(await audioContexts(capsule)).toEqual([]);
  // On: the page makes its context then, off the dictation's path, and plays nothing.
  await call(app, "setApp", { sounds: true });
  await expect.poll(() => audioContexts(capsule)).toHaveLength(1);
  expect(await played(capsule)).toEqual([]);
  expect(await settingSent(app)).toEqual(["on"]);
  // The Tick of the next dictation is played on it: no second context is made for it.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(() => played(capsule)).toEqual(["tick"]);
  expect(await audioContexts(capsule)).toHaveLength(1);
  await call(app, "cancelRecording");
  await expect.poll(() => played(capsule)).toEqual(["tick", "tock"]);
  // Another setting, and the sounds' own state said again, tell the page nothing.
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "setApp", { sounds: true });
  expect(await settingSent(app)).toEqual(["on"]);
  // Off: the page closes its context, which lets go of the audio device. No sound is played to say so.
  await call(app, "setApp", { sounds: false });
  await expect.poll(() => audioContexts(capsule)).toEqual(["closed"]);
  expect(await settingSent(app)).toEqual(["on", "off"]);
  expect(await soundsSent(app)).toEqual(["tick", "tock"]);
  // On again: a new one is made, so the next Tick is on time as well.
  await call(app, "setApp", { sounds: true });
  await expect.poll(() => audioContexts(capsule)).toHaveLength(2);
  expect((await audioContexts(capsule))![1]).not.toBe("closed");
  expect(await settingSent(app)).toEqual(["on", "off", "on"]);
  await app.close();
});

test("a page that loads with sounds on makes its AudioContext as it loads, and the first Tick is played on it", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await soundsOn(app); // saved as on, as a launch with sounds already on finds it
  await app.context().addInitScript(watchAudioContexts); // every page that loads from now on is watched from its first line
  await watchSends(app);
  await reloadCapsule(app);
  // A page that has not loaded, or is not watched, reads null: the poll waits for the new page, which made its context with no sound to play.
  await expect.poll(() => audioContexts(capsule), { timeout: 15_000 }).toHaveLength(1);
  await expect.poll(() => toldAgain(app)).toBe(true);
  expect(await settingSent(app)).toEqual(["on"]);
  expect(await played(capsule)).toEqual([]);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(() => played(capsule)).toEqual(["tick"]);
  expect(await audioContexts(capsule)).toHaveLength(1); // the Tick found the context made, and made none
  await call(app, "cancelRecording");
  await app.close();
});

test("a page that loads with sounds off is told nothing about sounds, and makes no AudioContext", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await quiet(app);
  await app.context().addInitScript(watchAudioContexts);
  await watchSends(app);
  await reloadCapsule(app);
  await expect.poll(() => audioContexts(capsule), { timeout: 15_000 }).toEqual([]); // loaded, watched, and nothing made
  await expect.poll(() => toldAgain(app)).toBe(true); // it said it listens, and main answered with the state
  expect(await settingSent(app)).toEqual([]);
  // And a dictation makes no sound and no context.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  expect(await played(capsule)).toEqual([]);
  expect(await audioContexts(capsule)).toEqual([]);
  expect(await soundsSent(app)).toEqual([]);
  await app.close();
});

test("a page that loads with sounds on is told after the commands held for it, so a held start doesn't wait for its context", async () => {
  const { app } = await launchOn(await makeLibrary());
  await soundsOn(app);
  await watchSends(app);
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void> } }).__avanzel;
    const page = win.webContents.getURL();
    await win.webContents.loadURL("about:blank"); // nothing listens until the capsule page is back
    await controller.toggleDictate(); // Record a thought: its start waits for the page
    void win.webContents.loadURL(page);
  });
  await expect.poll(async () => (await settingSent(app)).length, { timeout: 30_000 }).toBe(1);
  const sent = await sentToPage(app);
  const started = sent.findIndex(([channel, value]) => channel === "capsule:command" && value === "start");
  const told = sent.findIndex(([channel]) => channel === "capsule:sounds-setting");
  expect(started, "the start was sent").toBeGreaterThanOrEqual(0);
  expect(told, "the page is told after the start, which would otherwise wait for the page to make its context").toBeGreaterThan(started);
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await app.close();
});

/** Sends the capsule's page these messages, as main would, one after the other in the same turn. */
const sendToCapsule = (app: ElectronApplication, messages: [channel: string, value: unknown][]) =>
  app.evaluate(({ BrowserWindow }, sends) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    for (const [channel, value] of sends) win.webContents.send(channel, value);
  }, messages);

test("a Tock that waits for the microphone is dropped when sounds go off, and the audio device is not opened again for it", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await quiet(app);
  await capsule.evaluate(watchAudioContexts);
  await call(app, "setApp", { sounds: true });
  await expect.poll(() => audioContexts(capsule)).toHaveLength(1);
  // The Tock is held until the stop or the cancel after it has let go of the microphone. Sounds go off before it does: the held Tock goes
  // with them, as the context does.
  await sendToCapsule(app, [
    ["capsule:sound", "tock"],
    ["capsule:sounds-setting", false],
    ["capsule:command", "cancel"],
  ]);
  // And on again, with a Tock after it that is played: this is how the test knows the first cancel has been dealt with by now.
  await sendToCapsule(app, [
    ["capsule:sounds-setting", true],
    ["capsule:sound", "tock"],
    ["capsule:command", "cancel"],
  ]);
  await expect.poll(() => played(capsule)).toEqual(["tock"]); // the second one only
  const made = (await audioContexts(capsule))!;
  expect(made, "no third context was made for the dropped Tock").toHaveLength(2);
  expect(made[0]).toBe("closed");
  await app.close();
});

test("a Stamp that would land after sounds went off is not heard, and the audio device is not opened again for it", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await quiet(app);
  await capsule.evaluate(watchAudioContexts);
  await call(app, "setApp", { sounds: true });
  await expect.poll(() => audioContexts(capsule)).toHaveLength(1);
  // A filed card is put up, which sends the Stamp to land 228 ms after the card is drawn, and sounds are switched off in the same turn of main.
  await app.evaluate(async (_electron, card) => {
    const controller = (globalThis as unknown as { __avanzel: { setCapsule(state: unknown): void; setApp(patch: unknown): Promise<unknown> } }).__avanzel;
    controller.setCapsule(card);
    await controller.setApp({ sounds: false });
  }, filedCard());
  await expect.poll(() => capsuleKind(app)).toBe("filed");
  await sleep(900); // well past the 228 ms: a Stamp that was going to be played has been by now
  expect(await played(capsule)).toEqual([]);
  expect(await audioContexts(capsule), "the one context was closed, and the Stamp made no other").toEqual(["closed"]);
  await app.close();
});

// ---- Setup ----

test("setup offers sounds, off, with Preview sounds", async () => {
  const app = await launch(firstRun({ claude: filingClaude() }).env);
  const setup = await toDone(app);
  await muteWindows(app);
  await setup.evaluate(watchAudioContexts);
  // The three switches are rows of one Group, in this order: opening at login (the first, which the step has turned on), Play sounds, off,
  // and the library's evening review.
  const switches = setup.getByRole("switch");
  await expect(switches).toHaveCount(3);
  const [login, sounds, review] = [switches.nth(0), switches.nth(1), switches.nth(2)];
  await expect(login).toHaveAccessibleName("Open Avanzel when I log in");
  await expect(login).toHaveAttribute("aria-checked", "true");
  await expect(sounds).toHaveAccessibleName("Play sounds");
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  await expect(review).toHaveAccessibleName("Review my inbox every day at 21:00");
  expect((await setupSnap(app)).sounds).toBe(false);
  expect((await settingsSnap(app)).app.sounds).toBe(false);
  // They stand one above the other with their switches in a column: a row that held Preview sounds would push its switch aside.
  const boxes = await Promise.all([login, sounds, review].map(async (control) => (await control.boundingBox())!));
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y);
  for (const box of boxes) expect(Math.abs(box.x - boxes[0]!.x), "the switches are in one column").toBeLessThan(0.5);
  // Preview sounds is a small secondary button below the Group, and Start using Avanzel is still the one primary.
  const preview = setup.getByRole("button", { name: "Preview sounds" });
  await expect(preview).toHaveAttribute("data-variant", "secondary");
  await expect(preview).toHaveAttribute("data-size", "small");
  expect((await preview.boundingBox())!.y).toBeGreaterThan(boxes[2]!.y + boxes[2]!.height);
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Start using Avanzel"]);
  // It plays the Tick, the Stamp, the Drawer and the Letter, whatever the setting: sounds are off here, and stay off.
  await preview.click();
  await expectPreviewPlayed(setup);
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  expect((await settingsSnap(app)).app.sounds).toBe(false);
  expect(await audioContexts(setup)).toHaveLength(1);
  // Switching sounds on plays the Stamp, on the page's one context, and is saved.
  await sounds.click();
  await expect(sounds).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await settingsSnap(app)).app.sounds).toBe(true);
  expect((await setupSnap(app)).sounds).toBe(true);
  await expect.poll(() => played(setup)).toEqual(["tick", "stamp", "drawer", "letter", "stamp"]);
  expect(await audioContexts(setup)).toHaveLength(1);
  // Switching them off is saved and plays nothing, and the page lets go of its audio device.
  await sounds.click();
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await settingsSnap(app)).app.sounds).toBe(false);
  expect(await played(setup)).toEqual(["tick", "stamp", "drawer", "letter", "stamp"]);
  await expect.poll(() => audioContexts(setup)).toEqual(["closed"]);
  await app.close();
});

test("setup's Preview sounds and Play sounds stay quiet while a recording runs, and play once it is over", async () => {
  // A speech model that is ready (the stand-in) and a microphone that is a recording: ⌥Space on the last step starts a real recording.
  const { env } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_FAKE_AUDIO: speechWav("hello") });
  const setup = await toDone(app);
  await muteWindows(app);
  const sounds = setup.getByRole("switch", { name: "Play sounds" });
  const preview = setup.getByRole("button", { name: "Preview sounds" });
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await preview.click();
  await sounds.click();
  await expect.poll(async () => (await settingsSnap(app)).app.sounds).toBe(true); // switched on and saved all the same
  await sleep(1_500); // longer than the Preview takes: a sound that was not held back has been played by now
  expect(await played(setup), "no sound of the window's own is played over a recording").toEqual([]);
  // The recording is given up. Now the window's sounds are heard, the Stamp for switching on among them.
  await call(app, "cancelRecording");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await preview.click();
  await expectPreviewPlayed(setup);
  await sounds.click(); // off
  await expect.poll(async () => (await settingsSnap(app)).app.sounds).toBe(false);
  await sounds.click(); // and on again
  await expect.poll(() => played(setup)).toEqual(["tick", "stamp", "drawer", "letter", "stamp"]);
  await app.close();
});

test("a Play sounds that can't be saved in setup leaves the switch where it was, plays no Stamp and leaves no unhandled rejection", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_USER_DATA: userData });
  const setup = await toDone(app);
  await muteWindows(app);
  // A refusal that nothing catches is an unhandled rejection in the page, which is how a change that failed used to go unheard.
  const unheard: string[] = [];
  setup.on("pageerror", (error) => unheard.push(error.message));
  // The app can't write its settings when a folder stands where the temporary file it writes first would go.
  mkdirSync(path.join(userData, "settings.json.tmp"));
  const sounds = setup.getByRole("switch", { name: "Play sounds" });
  await sounds.click();
  await sleep(700); // the refusal has come back by now, and nothing came of it
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  expect((await settingsSnap(app)).app.sounds).toBe(false);
  expect(await played(setup), "the Stamp is the sign that sounds are on, and they are not").toEqual([]);
  expect(unheard).toEqual([]);
  // Once the settings can be written, the switch works.
  rmSync(path.join(userData, "settings.json.tmp"), { recursive: true });
  await sounds.click();
  await expect.poll(async () => (await settingsSnap(app)).app.sounds).toBe(true);
  await expect.poll(() => played(setup)).toEqual(["stamp"]);
  expect(unheard).toEqual([]);
  await app.close();
});
