// The menu bar icon: Zel's face and the title beside it show what Avanzel is doing (tray-state.ts), and the icon's tooltip says it in
// words. Every test reads what the controller last gave the menu bar (`trayForTests`), what macOS was given (`nativeTitle`) and the
// words of the face (`tooltip`), and the tests of a count read the times of the changes too (`watchTray`), so no poll has to catch a
// face in the moment it shows.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, localDate, saveSettings, Vault } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { FilingReceipt } from "../src/main/undo-records.ts";
import {
  dictate,
  filedFromTheCapsule,
  holdTheQueue,
  inbox,
  launchOn,
  letTheQueueGo,
  notified,
  reachedUndo,
  sleep,
  stampDay,
  undoCalls,
  undone,
  watchUndos,
  type Left,
} from "./capsule-helpers.ts";
import {
  agentCalls,
  agentStubs,
  answerAs,
  answerDialogs,
  call,
  capsuleKind,
  closeModelHubs,
  dialogsAsked,
  emptyHfCache,
  exists,
  fakeAgent,
  fakeModelHub,
  filesUnder,
  filingClaude,
  firstRun,
  gitOut,
  hfSnapshot,
  launch,
  letDialogsGo,
  limitedClaudeFor,
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  openedWith,
  openSettings,
  shown,
  speechWav,
  stopAtTheEnd,
  stubOpening,
  throughFound,
  toDone,
  typeFirstThought,
  windowFor,
} from "./helpers.ts";
import { reduceMotion, settingsSnap, setupSnap } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

/** What the menu bar shows (`face`, `title`) and the title macOS was given. */
type Bar = { face: string; title: string; nativeTitle: string };
/** A sample of the menu bar, with the words the icon's tooltip was given. */
type Sample = Bar & { tooltip: string };
/** A change of what the menu bar shows, and when it came. */
type Change = { face: string; title: string; at: number };

/**
 * The icon's tooltip for each face, written out here and not read from tray-state.ts: it is the only text VoiceOver or a hover can
 * get of the icon (Electron's Tray has no accessibility label), and the filing face reads like idle at 18 pt.
 */
const TOOLTIPS: Record<string, string> = {
  idle: "Avanzel",
  listening: "Avanzel is recording",
  filing: "Avanzel is working",
  filed: "Avanzel saved it",
  "needs-you": "Avanzel needs you",
  asleep: "The evening review is done",
};

/** Every sample of the menu bar a test took: at the end, each must have given macOS the title the menu bar shows, and its face's words. */
const sampled: Sample[] = [];
test.beforeEach(() => {
  sampled.length = 0;
});
test.afterEach(() => {
  expect(
    sampled.filter((bar) => bar.nativeTitle !== bar.title),
    "macOS was given the title the menu bar shows, at every sample",
  ).toEqual([]);
  expect(
    sampled.filter((bar) => bar.tooltip !== TOOLTIPS[bar.face]).map((bar) => `${bar.face}: ${bar.tooltip}`),
    "the icon's tooltip was its face's words, at every sample",
  ).toEqual([]);
});

/** The menu bar now, tooltip and all. */
async function sampleOf(app: ElectronApplication): Promise<Sample> {
  const sample = (await call(app, "trayForTests")) as Sample;
  sampled.push(sample);
  return sample;
}

/** The menu bar now: the face, the title and the title macOS holds. */
async function barOf(app: ElectronApplication): Promise<Bar> {
  const { tooltip: _words, ...bar } = await sampleOf(app);
  return bar;
}

/** Just the icon's tooltip now. */
const tooltipOf = async (app: ElectronApplication) => (await sampleOf(app)).tooltip;

/** Just the face now, as a poll reads it. */
const faceOf = async (app: ElectronApplication) => (await barOf(app)).face;

/** Just the title now. */
const titleOf = async (app: ElectronApplication) => (await barOf(app)).title;

/**
 * From now on, notes each change of what the controller gives the menu bar (`MenuBar.show`) with the time it came, for `changes`,
 * beginning with what it shows now, at time 0: it was showing that before the watch began, and no time a test takes after the watch
 * can reach back to it, as one taken in the same millisecond could. A view shown again as it was is no change.
 */
async function watchTray(app: ElectronApplication): Promise<void> {
  await call(app, "capsuleStateForTests"); // the controller is there once this answers
  await app.evaluate(() => {
    type Shown = { face: string; title: string };
    const controller = (globalThis as unknown as { __avanzel: { menuBar: { shown: Shown; show(view: Shown): void } } }).__avanzel;
    const changes: Change[] = [{ face: controller.menuBar.shown.face, title: controller.menuBar.shown.title, at: 0 }];
    Object.assign(globalThis, { trayChanges: changes });
    const show = controller.menuBar.show.bind(controller.menuBar);
    controller.menuBar.show = (view) => {
      const last = changes.at(-1);
      if (last?.face !== view.face || last.title !== view.title) changes.push({ face: view.face, title: view.title, at: Date.now() });
      show(view);
    };
  });
}

const changes = (app: ElectronApplication) => app.evaluate(() => (globalThis as { trayChanges?: Change[] }).trayChanges ?? []);

/** The faces in `list` from `since` (a time) on, oldest first, each once in a row. */
const facesFrom = (list: Change[], since: number) =>
  list.filter((change) => change.at >= since).map((change) => change.face).filter((face, i, all) => face !== all[i - 1]);

/**
 * From now on, counts the controller's calls to its method `name` (a wrapper on the instance, as `watchFilingStates` puts on
 * `refreshMenu`), for `calls`. `showTray` is what shows the menu bar again: once for the changes of a turn of the event loop, and
 * once for each tick of the timer.
 */
async function countCalls(app: ElectronApplication, name: "refreshMenu" | "showTray"): Promise<void> {
  await call(app, "capsuleStateForTests");
  await app.evaluate((_electron, method) => {
    const controller = (globalThis as unknown as { __avanzel: Record<string, () => void> }).__avanzel;
    const counts = ((globalThis as { callCounts?: Record<string, number> }).callCounts ??= {});
    counts[method] = 0;
    const original = controller[method]!.bind(controller);
    controller[method] = () => {
      counts[method] = (counts[method] ?? 0) + 1;
      original();
    };
  }, name);
}

const calls = (app: ElectronApplication, name: "refreshMenu" | "showTray") =>
  app.evaluate((_electron, method) => (globalThis as { callCounts?: Record<string, number> }).callCounts?.[method] ?? 0, name);

/** A Hugging Face cache that holds both speech models, so the speech model is ready whatever this Mac has. */
function readyModels(): string {
  const cache = emptyHfCache();
  hfSnapshot(cache, "nemo-parakeet-tdt-0.6b-v3");
  hfSnapshot(cache, "silero-vad");
  return cache;
}

/**
 * An app on `library` (a new one unless given), with its speech model ready, that hears "Plant tulips in October" and files with
 * the engine's fake agent, which `env` steers (FAKE_AGENT_DELAY_MS holds a run).
 */
async function hearing(env: Record<string, string> = {}, library?: string) {
  return launchOn(library ?? (await makeLibrary()), { HF_HUB_CACHE: readyModels(), ...env });
}

/** An app that thinks it is `hour` o'clock, on a library with one note waiting in its inbox, for an evening review to file. */
async function withNote(hour: string, env: Record<string, string> = {}) {
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  return hearing({ AVANZEL_FAKE_HOUR: hour, ...env }, library);
}

/** How the evening review said it ended: the first notification whose title begins "Evening review", once there is one. */
async function reviewSaid(app: ElectronApplication): Promise<{ title: string; body: string }> {
  let said: { title: string; body: string } | undefined;
  const find = async () => {
    said = ((await call(app, "notificationsForTests")) as { title: string; body: string }[]).find((note) => note.title.startsWith("Evening review"));
    return said;
  };
  await expect.poll(find, { timeout: 60_000 }).toBeDefined();
  return said!;
}

/** Runs the evening review, and returns once it has filed the note and said so. */
async function reviewed(app: ElectronApplication): Promise<void> {
  await call(app, "runTask", "evening-review");
  expect(await reviewSaid(app), "how the review ended").toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
}

/**
 * From now on, Zel's bubble stays up until `letTheBubbleGo`: a Mac that is busy, or that its owner is using, may take the focus
 * from it, and a window that loses the focus puts the bubble away, which is not what the test that reads the title beside it asks.
 * Each `closeUpHere` that would put a bubble away is swallowed and noted, with where it came from (`swallowedCloses`), so that a
 * test can say that none came: one that does is a focus lost, and shows as one, not as noise. (A call with no bubble up, such as
 * the one `openUpHere` makes before it opens one, closes nothing, and goes through.) Not now and Esc press `closeUpHere` all the
 * same, and wait here.
 */
async function holdTheBubble(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const setup = (globalThis as unknown as { __avanzel: { setup: { closeUpHere(): void } } }).__avanzel.setup;
    const closeUpHere = setup.closeUpHere.bind(setup);
    const swallowed: string[] = [];
    Object.assign(globalThis, { bubbleHeld: true, swallowedCloses: swallowed });
    const bubbleIsUp = () => BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.webContents.getURL().includes("/renderer/up-here/"));
    setup.closeUpHere = () => {
      if (!(globalThis as { bubbleHeld?: boolean }).bubbleHeld || !bubbleIsUp()) return closeUpHere();
      swallowed.push((new Error().stack ?? "").split("\n").slice(2, 6).join("\n"));
    };
  });
}

/** The `closeUpHere` calls that `holdTheBubble` has swallowed, each as the lines of the stack it came from. */
const swallowedCloses = (app: ElectronApplication) => app.evaluate(() => (globalThis as { swallowedCloses?: string[] }).swallowedCloses ?? []);

const letTheBubbleGo = (app: ElectronApplication) => app.evaluate(() => Object.assign(globalThis, { bubbleHeld: false })).then(() => undefined);

/** The seconds a count says: "1:05" is 65. */
const secondsOf = (title: string) => Number(title.split(":")[0]) * 60 + Number(title.split(":")[1]);

/** The menu bar icon in the setup test, as AVANZEL_FAKE_TRAY_BOUNDS gives it: "x,y,width,height". */
const ICON = "1000,0,24,24";

test("the face listens and the title counts while recording, then it files, stamps and rests", async () => {
  const { app, capsule } = await hearing({ FAKE_AGENT_DELAY_MS: "2000", FAKE_AGENT_DELAY_TASK: "file" }); // the filing can be seen
  await watchTray(app);
  const since = Date.now();
  await call(app, "toggleDictate");
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "listening", title: expect.stringMatching(/^0:0[0-9]$/) });
  // The face says it in words too, for VoiceOver and for a hover: they change with the face, and a tick of the count leaves them be.
  await expect.poll(() => sampleOf(app), { intervals: [50] }).toMatchObject({ face: "listening", tooltip: "Avanzel is recording" });
  // After two seconds the count has moved on.
  await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[2-9]$/);
  expect(await faceOf(app)).toBe("listening");
  // The capsule's bar writes the count as the menu bar does (shared/clock.ts), and the two are never more than a second apart.
  const inBar = await capsule.getByRole("status").getByText(/^\d:\d\d$/).innerText();
  expect(Math.abs(secondsOf(inBar) - secondsOf(await titleOf(app)))).toBeLessThanOrEqual(1);
  await call(app, "toggleDictate"); // stop
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "filing", title: "" });
  await expect.poll(() => sampleOf(app), { intervals: [50] }).toMatchObject({ face: "filing", tooltip: "Avanzel is working" }); // not idle's: it reads like it at 18 pt
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).toBe("filed");
  await expect.poll(() => sampleOf(app), { timeout: 30_000, intervals: [50] }).toMatchObject({ face: "filed", tooltip: "Avanzel saved it" });
  await expect.poll(() => barOf(app), { timeout: 10_000, intervals: [100] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  expect(await tooltipOf(app)).toBe("Avanzel");

  const list = await changes(app);
  // One face after another, none left out, and none put in between (a flash of idle as the transcription hands over to the filing).
  expect(facesFrom(list, since)).toEqual(["listening", "filing", "filed", "idle"]);
  // The count began at 0:00 and went up while the recording ran, to 0:02 at least (an event loop that stalled for a second may skip one,
  // so two titles may be all there is: 0:00 and 0:02).
  const counted = list.filter((change) => change.at >= since && change.face === "listening").map((change) => change.title);
  expect(counted[0]).toBe("0:00");
  expect(counted.length).toBeGreaterThanOrEqual(2);
  expect(secondsOf(counted.at(-1)!)).toBeGreaterThanOrEqual(2);
  expect(counted.map(secondsOf)).toEqual([...counted.map(secondsOf)].sort((a, b) => a - b));
  // The stamp lasted two seconds from the filing's end.
  const filed = list.find((change) => change.face === "filed")!;
  const rested = list.find((change) => change.face === "idle" && change.at > filed.at)!;
  expect(rested.at - filed.at).toBeGreaterThanOrEqual(1_900);
  expect(rested.at - filed.at).toBeLessThan(3_500);
  await app.close();
});

test("a hidden filing keeps the face thinking and counts in the title", async () => {
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "file" });
  await watchTray(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  // While its card shows, the card counts the seconds; the menu bar doesn't count them a second time.
  expect(await barOf(app)).toMatchObject({ face: "filing", title: "" });
  const since = Date.now();
  await call(app, "dismiss");
  expect(await capsuleKind(app)).toBe("hidden");
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "filing", title: expect.stringMatching(/^0:0[0-9]$/) });
  await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[2-9]$/); // counting up
  // At the end the title goes, and the face is stamped filed.
  await expect.poll(() => barOf(app), { timeout: 30_000, intervals: [50] }).toMatchObject({ face: "filed", title: "" });
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  expect(facesFrom(await changes(app), since)).toEqual(["filing", "filed", "idle"]);
  await app.close();
});

test("a hidden filing that waits shows no title until its run starts", async () => {
  // A weekly review holds the queue for as long as a run takes, and the filing behind it takes as long again.
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "3500" });
  await watchTray(app);
  const started = Date.now();
  await call(app, "runTask", "weekly-review");
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  await call(app, "dismiss");
  expect(await barOf(app)).toEqual({ face: "filing", title: "", nativeTitle: "" });
  await sleep(1_500);
  expect(await barOf(app)).toEqual({ face: "filing", title: "", nativeTitle: "" }); // the review still has the library
  // Its run starts when the review ends, and its seconds count from 0:00.
  await expect.poll(() => titleOf(app), { timeout: 30_000, intervals: [50] }).toMatch(/^0:0[0-9]$/);
  await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[1-9]$/);
  await expect.poll(() => barOf(app), { timeout: 30_000, intervals: [50] }).toMatchObject({ face: "filed", title: "" });
  const counting = (await changes(app)).filter((change) => change.at >= started && change.face === "filing" && change.title !== "");
  expect(counting[0]).toMatchObject({ face: "filing", title: "0:00" });
  expect(counting[0]!.at - started).toBeGreaterThanOrEqual(3_000); // nothing counted while the review held the queue
  await app.close();
});

test("a download shows its percent, and a download that fails shows a problem", async () => {
  const hub = await fakeModelHub("trickle");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  // Downloading doesn't make the face busy: only the title shows how far it is. The hub sends a few kilobytes of 673 MB.
  await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "idle", title: expect.stringMatching(/^\d{1,3}%$/) });
  expect(await titleOf(app)).toBe("0%");
  // It is shown again when the whole percent changes, not at each tick of the download's progress (about four a second).
  await countCalls(app, "showTray");
  await sleep(2_000);
  expect(await calls(app, "showTray")).toBeLessThanOrEqual(1);
  expect(await barOf(app)).toMatchObject({ face: "idle", title: "0%" });
  // The hub goes: the download fails (what it sent never was a model), so the title goes and the face has something for the person.
  closeModelHubs();
  await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "needs-you", title: "" });
  expect((await settingsSnap(app)).model).toMatchObject({ kind: "error", cause: "download" });
  await app.close();
});

test("there is no title while setup or its bubble shows", async () => {
  test.setTimeout(150_000); // a first run, walked to the end
  const hub = await fakeModelHub("trickle");
  const app = await launch({
    ...firstRun({ claude: filingClaude() }).env,
    AVANZEL_MODELS_URL: hub.url,
    AVANZEL_FAKE_TRAY_BOUNDS: ICON, // the bubble has an icon to point at
  });
  await watchTray(app);
  await reduceMotion(app);
  await holdTheBubble(app);
  const setup = await toDone(app);
  // The library was made on the way, and its speech model is on its way: the title would read its percent, if setup showed nothing.
  await expect.poll(async () => (await settingsSnap(app)).model.kind).toBe("downloading");
  expect(await barOf(app)).toMatchObject({ title: "", nativeTitle: "" });
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  const bubble = await windowFor(app, "up-here");
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  expect((await settingsSnap(app)).model.kind).toBe("downloading");
  // The bubble is centred on the icon's bounds, which a title would widen.
  expect(await barOf(app)).toMatchObject({ title: "", nativeTitle: "" });
  // Nothing asked to put the bubble away while it was held: had a lost focus done, this says so.
  expect(await swallowedCloses(app), "closeUpHere was called while the bubble was held").toEqual([]);
  const closing = Date.now();
  await letTheBubbleGo(app);
  await bubble.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  await expect.poll(() => barOf(app), { timeout: 10_000 }).toMatchObject({ title: expect.stringMatching(/^\d{1,3}%$/) });
  // Through the whole first run, from the Hello step to the bubble's closing, macOS was never given a title.
  const list = await changes(app);
  expect(list.filter((change) => change.at < closing && change.title !== "")).toEqual([]);
  expect(list.at(-1)).toMatchObject({ title: expect.stringMatching(/^\d{1,3}%$/) });
  expect(list.at(-1)!.at).toBeGreaterThanOrEqual(closing);
  await app.close();
});

test("a problem shows needs-you until its card is hidden", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    HF_HUB_CACHE: readyModels(),
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    FAKE_AGENT_MODE: "fail",
  });
  await windowFor(app, "capsule");
  expect(await barOf(app)).toMatchObject({ face: "idle", title: "" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error"); // the failed filing's card
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "needs-you", title: "" });
  await expect.poll(() => sampleOf(app), { intervals: [50] }).toMatchObject({ face: "needs-you", tooltip: "Avanzel needs you" });
  await call(app, "dismiss"); // Hide
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "idle", title: "" });
  expect(await tooltipOf(app)).toBe("Avanzel");
  await app.close();
});

test("a library that has gone shows needs-you, and a library that opens takes it away", async () => {
  const { env, home } = firstRun(); // its own HOME and config folder: the library that opens is remembered there, never in ~/.config
  const app = await launch({ ...env, HF_HUB_CACHE: readyModels(), AVANZEL_LIBRARY: path.join(home, "Brain") }); // remembered, and not there any more
  await windowFor(app, "settings"); // Settings opens on it, not setup
  expect(await barOf(app)).toMatchObject({ face: "needs-you", title: "" });
  await call(app, "createLibrary", path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel"));
  await expect.poll(() => barOf(app), { timeout: 20_000, intervals: [100] }).toMatchObject({ face: "idle", title: "" });
  await app.close();
});

test("after an evening review Zel sleeps until the next capture", async () => {
  const { app } = await withNote("21");
  await watchTray(app);
  const since = Date.now();
  await reviewed(app);
  await expect.poll(() => barOf(app), { intervals: [100] }).toMatchObject({ face: "asleep", title: "" });
  await expect.poll(() => sampleOf(app), { intervals: [100] }).toMatchObject({ face: "asleep", tooltip: "The evening review is done" });
  expect(facesFrom(await changes(app), since)).toEqual(["filing", "asleep"]); // the review thinks, then Zel sleeps
  // The next dictation wakes Zel, who listens; a recording given up leaves Zel awake.
  await call(app, "toggleDictate");
  await expect.poll(() => faceOf(app), { intervals: [50] }).toBe("listening");
  await call(app, "cancelRecording");
  await expect.poll(() => faceOf(app), { intervals: [50] }).toBe("idle");
  await app.close();
});

test("an evening review in the morning leaves Zel awake", async () => {
  const { app } = await withNote("9");
  await watchTray(app);
  const since = Date.now();
  await reviewed(app);
  await expect.poll(() => barOf(app), { intervals: [100] }).toMatchObject({ face: "idle", title: "" });
  await sleep(500);
  expect(await faceOf(app)).toBe("idle");
  expect(facesFrom(await changes(app), since)).toEqual(["filing", "idle"]); // the review thinks, then Zel is awake as before
  await app.close();
});

test("a typed thought and a library that opens wake Zel too", async () => {
  test.setTimeout(150_000);
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the new library is remembered here, not in ~/.config
  const { app } = await hearing({ AVANZEL_FAKE_HOUR: "23", XDG_CONFIG_HOME: config }, library);
  await call(app, "capsuleStateForTests");
  await reviewed(app);
  await expect.poll(() => faceOf(app), { intervals: [100] }).toBe("asleep");
  await call(app, "submitQuick", "Call the plumber on Monday");
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).not.toBe("asleep");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await call(app, "idleForTests");
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  // Another night, another review, and this time the person opens another library.
  new Vault(library).newCapture("Another thought", { source: "text" });
  await call(app, "runTask", "evening-review");
  await expect.poll(() => notified(app, "Evening review: 1 thought filed"), { timeout: 60_000 }).toHaveLength(2);
  await call(app, "idleForTests");
  await expect.poll(() => faceOf(app), { intervals: [100] }).toBe("asleep");
  await call(app, "createLibrary", path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel"));
  await expect.poll(() => faceOf(app), { timeout: 20_000, intervals: [100] }).toBe("idle");
  await app.close();
});

test("a hidden filing whose note another Avanzel filed meanwhile leaves neither a face nor a count behind", async () => {
  const library = await makeLibrary();
  const { app } = await hearing({}, library);
  await watchTray(app);
  const since = Date.now();
  // Another Avanzel has the library, so the filing waits for it, and its card is hidden ...
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
    await call(app, "dismiss");
    // ... and files the note itself, then lets the library go.
    const [note] = filesUnder(library, "inbox");
    renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));
    await sleep(1_300);
    expect(await barOf(app)).toEqual({ face: "filing", title: "", nativeTitle: "" }); // waiting counts no seconds
  } finally {
    letGo();
    await held;
  }
  // The run comes back with no outcome (there was no note to file), and nothing is left: no count, no stamp for a filing that wasn't one.
  await expect.poll(() => barOf(app), { timeout: 30_000, intervals: [50] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  await sleep(500);
  expect(await faceOf(app)).toBe("idle");
  expect(facesFrom(await changes(app), since)).not.toContain("filed");
  await app.close();
});

test("an Ask makes the face think while it is answered, and lets go when it is", async () => {
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "2500", FAKE_AGENT_DELAY_TASK: "ask" });
  await watchTray(app);
  const since = Date.now();
  const answering = call(app, "ask", "What is on my mind this week?");
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "filing", title: "" });
  await answering;
  await expect.poll(() => barOf(app), { timeout: 10_000, intervals: [50] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  expect(facesFrom(await changes(app), since)).toEqual(["filing", "idle"]); // an answer is no filing: nothing is stamped
  await app.close();
});

// ---- A filing that leaves the queue without running ----
//
// The face thinks while a filing waits for its turn (`queuedToFile`), and the queue takes it out of there with no run, and often no
// card, to show the icon again: a filing stopped before its turn, a note that was filed meanwhile, a note filed in the background.
// These hold the queue with a piece of work that runs no agent (`holdTheQueue`), so that nothing else shows the icon when the
// filing's turn comes.

test("a filing that was stopped before its turn leaves no face behind when its turn comes", async () => {
  const { app, capsule } = await hearing();
  await holdTheQueue(app);
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  expect(await faceOf(app)).toBe("filing"); // it waits for its turn, and Zel is thinking of it
  await capsule.evaluate(() => window.avanzel.capsule.cancelFiling()); // Stop: nothing has touched the note, so the card says Stopped at once
  await expect.poll(() => capsuleKind(app)).toBe("cancelled");
  await call(app, "dismiss");
  await letTheQueueGo(app); // its turn comes: it finds itself stopped, and does nothing
  await expect.poll(() => barOf(app), { timeout: 5_000, intervals: [50] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  await app.close();
});

test("a hidden filing whose note was filed while it waited for its turn leaves no face behind", async () => {
  const library = await makeLibrary();
  const { app } = await hearing({}, library);
  await holdTheQueue(app);
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  await call(app, "dismiss");
  const [note] = filesUnder(library, "inbox");
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!)); // another Avanzel filed it
  expect(await faceOf(app)).toBe("filing");
  await letTheQueueGo(app); // its turn comes: there is no note to file, and no card to say so
  await expect.poll(() => barOf(app), { timeout: 5_000, intervals: [50] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  await app.close();
});

test("a note filed in the background makes the face think while it waits, and leaves nothing when its turn finds it filed", async () => {
  const library = await makeLibrary();
  const note = new Vault(library).newCapture("A note that waits for a limit to reset", { source: "text" }).path;
  const { app } = await hearing({}, library);
  await holdTheQueue(app);
  await call(app, "fileInBackground", note, "fake", { by: "watch" }); // as the wait for a limit's reset, or a sign-in's watch, files a note
  await expect.poll(() => barOf(app), { timeout: 5_000, intervals: [50] }).toEqual({ face: "filing", title: "", nativeTitle: "" });
  renameSync(note, path.join(library, "raw", path.basename(note))); // filed meanwhile
  await letTheQueueGo(app);
  await expect.poll(() => barOf(app), { timeout: 5_000, intervals: [50] }).toEqual({ face: "idle", title: "", nativeTitle: "" });
  await app.close();
});

// ---- The filed stamp ----

test("words saved for the evening review stamp the face filed, and the Undone card of an Undo doesn't", async () => {
  const { app } = await hearing({}, await makeLibrary({ git: true })); // a library with git, for Undo to take a commit back
  await watchTray(app);
  // Saved for the evening review: no filing, and the card says so; the face wears the stamp for two seconds.
  await call(app, "setApp", { fileMode: "evening" });
  const first = Date.now();
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  const saved = await changes(app);
  expect(facesFrom(saved, first)).toEqual(["listening", "filing", "filed", "idle"]);
  const stamped = saved.find((change) => change.at >= first && change.face === "filed")!;
  const wornOff = saved.find((change) => change.face === "idle" && change.at > stamped.at)!;
  expect(wornOff.at - stamped.at).toBeGreaterThanOrEqual(1_900);
  // Filed now, and the stamp worn off; then Undo puts the words back in the inbox, and its card is `saved` too, with `undone`.
  await call(app, "setApp", { fileMode: "now" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  const undoing = Date.now();
  await call(app, "undo");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true });
  await sleep(800); // time for a stamp to show, if that card put one up
  expect((await changes(app)).filter((change) => change.at >= undoing)).toEqual([]);
  expect(await faceOf(app)).toBe("idle");
  await app.close();
});

test("a library that opens takes the filed stamp off before it wears off", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the new library is remembered here, not in ~/.config
  const { app } = await hearing({ XDG_CONFIG_HOME: config });
  await dictate(app);
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).toBe("filed");
  // The stamp is made to last a minute, so a face that is idle again below is the library's doing, and not a stamp that wore off: a
  // two-second stamp and a library that takes its time to open would race.
  await app.evaluate(() => {
    (globalThis as unknown as { __avanzel: { filedUntil: number | null } }).__avanzel.filedUntil = Date.now() + 60_000;
  });
  const library = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", library);
  expect((await settingsSnap(app)).library?.path).toBe(library);
  await expect.poll(() => faceOf(app), { timeout: 5_000, intervals: [50], message: "the stamp went with the library it was for" }).toBe("idle");
  await app.close();
});

// ---- A Filing card with no run behind it ----

test("the face keeps thinking under a Filing card while the stopped run's commit is taken back", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({ FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() }, library);
  await dictate(app);
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true); // the agent's first run is halfway
  await call(app, "edit"); // Edit stops it, and the editor opens
  expect(await capsuleKind(app)).toBe("editing");
  await expect.poll(() => gitOut(library, "log", "--format=%s"), { timeout: 30_000 }).toContain("avanzel: leftovers of"); // its edits, committed
  await call(app, "idleForTests"); // and its run is over
  await watchUndos(app, { hold: true });
  await call(app, "submitEdit", "corrected words"); // File: the card shows Filing again, and the leftovers come out first
  await expect.poll(() => reachedUndo(app), { timeout: 30_000 }).toBe(true);
  expect(await capsuleKind(app)).toBe("filing");
  // No run, and nothing waits in the queue by name: only the card says that the filing is going on, and the face must say it too.
  expect(await barOf(app)).toEqual({ face: "filing", title: "", nativeTitle: "" });
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  await app.close();
});

// ---- A review that ends while a thought is in flight ----
//
// Zel falls asleep when an evening review ends at night, unless a thought is in flight (`capturing`): it began before the review
// ended, so it is no "next capture" to wake Zel, and its filing would end on the asleep face. In each of these a thought is at a
// stage of its own when the review says it is over (`begin` starts the review, and the thought, in the order the stage asks, and
// `atReviewEnd` checks the stage); the thought is then `end`ed, and its filing ends on the idle face, with Zel never asleep.

const startReview = (app: ElectronApplication) => call(app, "runTask", "evening-review").then(() => undefined);

/** A thought spoken while the review works, and waiting behind it: its card shows Filing, with its seconds not begun. */
async function waitsBehindTheReview(app: ElectronApplication): Promise<void> {
  await startReview(app);
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
}

const MID_THOUGHT: {
  stage: string;
  env: Record<string, string>;
  begin(app: ElectronApplication): Promise<void>;
  atReviewEnd(app: ElectronApplication): Promise<void>;
  end?(app: ElectronApplication): Promise<void>;
}[] = [
  {
    stage: "is being recorded",
    env: { FAKE_AGENT_DELAY_MS: "1200" },
    begin: async (app) => {
      await startReview(app);
      await call(app, "toggleDictate");
    },
    atReviewEnd: async (app) => void expect(await faceOf(app)).toBe("listening"),
    end: async (app) => void (await call(app, "toggleDictate")), // the recording is stopped, and its words are filed
  },
  {
    stage: "is being made into words",
    env: { FAKE_AGENT_DELAY_MS: "1200", AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "5000" },
    begin: async (app) => {
      await startReview(app);
      await dictate(app);
    },
    atReviewEnd: async (app) => void expect(await capsuleKind(app)).toBe("transcribing"),
  },
  {
    stage: "waits behind it, its card showing",
    env: { FAKE_AGENT_DELAY_MS: "2000" },
    begin: waitsBehindTheReview,
    atReviewEnd: async (app) => void expect(await capsuleKind(app)).toBe("filing"),
  },
  {
    stage: "waits behind it, its card hidden",
    env: { FAKE_AGENT_DELAY_MS: "2000" },
    begin: async (app) => {
      await waitsBehindTheReview(app);
      await call(app, "dismiss");
    },
    atReviewEnd: async (app) => void expect(await capsuleKind(app)).toBe("hidden"),
  },
  {
    stage: "is being edited, its filing still to come",
    env: { FAKE_AGENT_DELAY_MS: "2000" },
    begin: async (app) => {
      await waitsBehindTheReview(app);
      await call(app, "edit");
    },
    atReviewEnd: async (app) => {
      expect(await capsuleKind(app)).toBe("editing");
      expect(await faceOf(app)).toBe("idle"); // not asleep, while the editor is open
    },
    end: async (app) => void (await call(app, "cancelEdit")), // the words are filed as they were
  },
  {
    // Its first run has come and gone (Edit stopped it): only the open editor says that the thought is in flight.
    stage: "is being edited, its first run over",
    env: { FAKE_AGENT_DELAY_MS: "2000" },
    begin: async (app) => {
      await dictate(app);
      await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing" });
      await call(app, "edit");
      await call(app, "idleForTests"); // the stopped run is over
      await startReview(app);
    },
    atReviewEnd: async (app) => {
      expect(await capsuleKind(app)).toBe("editing");
      expect(await faceOf(app)).toBe("idle");
    },
    end: async (app) => void (await call(app, "cancelEdit")),
  },
  // Edit stopped its first run, and its File came while the review ran: the corrected words wait to be filed behind the review. The work
  // that files them settles the edit when its turn comes (`settleEdit`), so until then only the edit says the thought is in flight: no
  // run, no place in `queuedToFile`, and, once its card is hidden, no card.
  ...[false, true].map((hidden) => ({
    stage: `is filed again after an edit, and waits behind it, its card ${hidden ? "hidden" : "showing"}`,
    env: { FAKE_AGENT_DELAY_MS: "4000" },
    begin: async (app: ElectronApplication) => {
      await dictate(app);
      await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing" });
      await call(app, "edit");
      await call(app, "idleForTests"); // the stopped run is over
      await startReview(app);
      await expect.poll(() => detailOf(app), { timeout: 30_000, intervals: [50] }).toBe("Filing 1 of 1"); // its run has the note
      await call(app, "submitEdit", "Plant tulips in late October");
      expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filing", waiting: true });
      if (hidden) await call(app, "dismiss");
    },
    atReviewEnd: async (app: ElectronApplication) => void expect(await capsuleKind(app)).toBe(hidden ? "hidden" : "filing"),
  })),
];

for (const { stage, env, begin, atReviewEnd, end } of MID_THOUGHT) {
  test(`a review that ends while a thought ${stage} doesn't put Zel to sleep`, async () => {
    const { app } = await withNote("21", env);
    await watchTray(app);
    const since = Date.now();
    await begin(app);
    expect(await reviewSaid(app), "how the review ended").toMatchObject({ title: "Evening review: 1 thought filed" });
    await atReviewEnd(app);
    await end?.(app);
    await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).toBe("filed");
    await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle"); // the thought's filing ends awake
    await sleep(500);
    expect(facesFrom(await changes(app), since)).not.toContain("asleep");
    await app.close();
  });
}

test("title ticks don't rebuild the menu", async () => {
  const { app } = await hearing();
  await call(app, "toggleDictate");
  await expect.poll(() => faceOf(app), { intervals: [50] }).toBe("listening");
  await countCalls(app, "refreshMenu");
  await sleep(3_200);
  // The title went on counting for these seconds. tick() (every minute, and on waking or unlocking) and broadcast() rebuild the
  // menu too, and one of them may land in them, so one rebuild is allowed, as filing.spec.ts allows it. A rebuild at each tick
  // would be three or more.
  expect(await titleOf(app)).toMatch(/^0:0[3-9]$/);
  expect(await calls(app, "refreshMenu")).toBeLessThanOrEqual(1);
  await call(app, "cancelRecording");
  await app.close();
});

test("the second ticker runs only while a recording or a hidden filing counts", async () => {
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "3000", FAKE_AGENT_DELAY_TASK: "file" });
  await countCalls(app, "showTray");
  // Nothing counts: the menu bar is not shown again by itself. (tick() may land in these seconds, as in the test of the menu.) A
  // ticker left running would show it three times.
  await sleep(3_200);
  expect(await calls(app, "showTray")).toBeLessThanOrEqual(1);
  // A recording counts: the menu bar is shown again each second.
  await call(app, "toggleDictate");
  const before = await calls(app, "showTray");
  await sleep(3_500);
  expect((await calls(app, "showTray")) - before).toBeGreaterThanOrEqual(3);
  // A hidden filing counts the same way.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "dismiss");
  await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[0-9]$/);
  // Both are over, and so is the stamp: the ticker has stopped, and nothing wakes the menu bar again.
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [100] }).toBe("filed");
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [100] }).toBe("idle");
  const after = await calls(app, "showTray");
  await sleep(3_200);
  expect((await calls(app, "showTray")) - after).toBeLessThanOrEqual(1);
  await app.close();
});

test("quitting on either path stops the count where it was", async () => {
  // The plain quit, when nothing is busy, and the one that waits for a run: both clear the timers, so a title is not left counting.
  for (const quit of ["stopAgentChecks", "stopForQuit"] as const) {
    const { app } = await hearing({ AVANZEL_QUIT_WAIT_MS: "2000" });
    await call(app, "toggleDictate");
    await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[1-9]$/); // it counts
    await call(app, quit);
    const frozen = await barOf(app);
    await sleep(2_300);
    expect(await barOf(app), quit).toEqual(frozen); // two seconds on, it still reads what it read
    // What happens after is still shown (the recording is given up), though nothing counts any more.
    await call(app, "cancelRecording");
    expect(await barOf(app), quit).toEqual({ face: "idle", title: "", nativeTitle: "" });
    await app.close();
  }
});

// ---------------------------------------------------------------- the menu says how today went

/** The default evening review's next run as the status line says it: tomorrow once 21:00 has passed today. */
const eveningWhen = () => (new Date().getHours() >= 21 ? "tomorrow at 21:00" : "at 21:00");

/** The menu's model now. */
const menuOf = async (app: ElectronApplication) => (await call(app, "menuForTests")) as MenuItemModel[];

/** The words of the menu's head now. */
const headOf = async (app: ElectronApplication) => {
  const [head] = await menuOf(app);
  return head?.type === "item" ? head.label : "";
};

/** The items right under the Recently filed header, up to the next separator. */
const recentOf = async (app: ElectronApplication) => {
  const items = await menuOf(app);
  const at = items.findIndex((item) => item.type === "header" && item.label === "Recently filed");
  return items.slice(at + 1, items.findIndex((item, i) => i > at && item.type === "separator"));
};

/**
 * What the tray holds for one menu item: its words, and its icon, or null without one. An icon is a template image or not (macOS tints a
 * template image for the menu: its ink, and white on the highlight), and the colour its pixels are drawn in (the most opaque one, "#rrggbb").
 */
type Held = { label: string; sublabel: string; icon: { template: boolean; ink: string } | null };

/** The menu the tray holds now, as macOS was given it. */
const heldMenu = (app: ElectronApplication): Promise<Held[]> =>
  app.evaluate(() => {
    type Icon = { isTemplateImage(): boolean; toBitmap(options: { scaleFactor: number }): Buffer };
    type Item = { label: string; sublabel?: string; icon?: Icon | string };
    const bar = (globalThis as unknown as { __avanzel: { menuBar: { menu: { items: Item[] } | null } } }).__avanzel.menuBar;
    return (bar.menu?.items ?? []).map((item) => {
      let icon: { template: boolean; ink: string } | null = null;
      if (item.icon && typeof item.icon !== "string") {
        const pixels = item.icon.toBitmap({ scaleFactor: 2 }); // BGRA
        let best = 0;
        for (let at = 0; at < pixels.length; at += 4) if ((pixels[at + 3] ?? 0) > (pixels[best + 3] ?? 0)) best = at;
        const ink = `#${[pixels[best + 2], pixels[best + 1], pixels[best]].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
        icon = { template: item.icon.isTemplateImage(), ink };
      }
      return { label: item.label, sublabel: item.sublabel ?? "", icon };
    });
  });

/** A date `days` from now, at noon: a day other than today, whatever the hour is. */
const onDay = (days: number) => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(12, 0, 0, 0);
  return at;
};

/** A page `title` in the folder `folder` of `library`, and a line in its log that says a thought was filed into it at `when`. */
function filedInto(library: string, folder: string, name: string, title: string, when: Date): void {
  mkdirSync(path.join(library, folder), { recursive: true });
  writeFileSync(path.join(library, folder, `${name}.md`), `# ${title}\n`);
  new Vault(library).appendLog("file", `[[capture-${name}]] → [[${name}]]`, when);
}

/** A library whose log says three thoughts were filed today, each into a page on its own shelf, the last off the shelves, and one yesterday. */
async function shelved(): Promise<string> {
  const library = await makeLibrary();
  const today = new Date();
  filedInto(library, "topics", "old-news", "Old news", onDay(-1));
  filedInto(library, "goals", "finish-the-prototype", "Finish the prototype", today);
  filedInto(library, "people", "maya", "Maya", today);
  filedInto(library, "projects", "trip", "Trip to Lisbon", today);
  return library;
}

test("the status line counts today's filings", async () => {
  const library = await makeLibrary();
  // What isn't a filing today isn't counted: yesterday's, a review and an Ask.
  const vault = new Vault(library);
  vault.appendLog("file", "[[2026-01-01-000000]] → [[old-page]]", onDay(-1));
  vault.appendLog("review", "[[2026-01-01]]");
  vault.appendLog("ask", "what did I file → [[old-page]]");
  const { app } = await hearing({}, library);
  // Nothing waits in the inbox, so the head's words don't mention it, and the click opens the library instead.
  expect(await menuOf(app)).toContainEqual({ type: "item", label: `Nothing filed today. Evening review ${eveningWhen()}.`, action: "open-library" });
  // A fake filing: the count goes up, and the evening review's time is said as the clock says it.
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  expect(await headOf(app)).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
  await dictate(app);
  await expect.poll(() => headOf(app), { timeout: 30_000 }).toBe(`2 thoughts filed today. Evening review ${eveningWhen()}.`);
  // The menu the tray holds says the same, with the notes in the inbox under it (none: both are filed).
  const [held] = await heldMenu(app);
  expect(held).toEqual({ label: `2 thoughts filed today. Evening review ${eveningWhen()}.`, sublabel: "", icon: null });
  await app.close();
});

test("the head opens the inbox while a note waits in it and its words say so, and the library when none does", async () => {
  const { app } = await withNote("12");
  // A note waits: the second line names the inbox, and the click opens the inbox.
  expect((await menuOf(app))[0]).toMatchObject({ type: "item", action: "open-inbox", sublabel: "1 note in the inbox" });
  expect((await heldMenu(app))[0]).toMatchObject({ sublabel: "1 note in the inbox" });
  // The review files it: the second line goes with the note, and the click goes to the library, where the page is.
  await reviewed(app);
  await expect.poll(async () => (await menuOf(app))[0], { timeout: 10_000 }).toMatchObject({ type: "item", action: "open-library" });
  expect((await menuOf(app))[0]).not.toHaveProperty("sublabel");
  expect((await heldMenu(app))[0]).toMatchObject({ sublabel: "" });
  await app.close();
});

test("Undo takes a filing off the count", async () => {
  const { app } = await hearing({}, await makeLibrary({ git: true })); // a library with git, for Undo to take a commit back
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await dictate(app);
  await expect.poll(() => headOf(app), { timeout: 30_000 }).toBe(`2 thoughts filed today. Evening review ${eveningWhen()}.`);
  await call(app, "undo");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await expect.poll(() => headOf(app), { timeout: 30_000 }).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
  await app.close();
});

test("the status line names the evening review by its own name, and leaves it out when it is off", async () => {
  const { app } = await hearing();
  const saved = (name: string, enabled: boolean) =>
    call(app, "saveTaskFromSettings", { id: "evening-review", name, schedule: "daily 21:00", agent: "auto", enabled, instructions: "Sort the inbox." });
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${eveningWhen()}.`);
  await saved("Nightly sweep", true);
  await expect.poll(() => headOf(app)).toBe(`Nothing filed today. Nightly sweep ${eveningWhen()}.`);
  await saved("Nightly sweep", false);
  await expect.poll(() => headOf(app)).toBe("Nothing filed today.");
  expect(JSON.stringify(await menuOf(app))).not.toMatch(/letter/i); // there is no letter yet
  await app.close();
});

test("Recently filed shows each page's shelf", async () => {
  const { app } = await hearing({}, await shelved());
  // Read from the log as the library opened: three thoughts today (yesterday's is not counted).
  expect(await headOf(app)).toBe(`3 thoughts filed today. Evening review ${eveningWhen()}.`);
  // The shelf's name as the design system names it, or the folder's name for a page the person put elsewhere.
  expect(await recentOf(app)).toEqual([
    { type: "item", label: "Trip to Lisbon", action: "open:projects/trip.md", shelf: "projects", sublabel: "projects" },
    { type: "item", label: "Maya", action: "open:people/maya.md", shelf: "people", sublabel: "People" },
    { type: "item", label: "Finish the prototype", action: "open:goals/finish-the-prototype.md", shelf: "goals", sublabel: "Goals" },
  ]);
  // A fake filing: its page comes first, on the ideas shelf, and the count goes on from the log.
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  // The section ends with the receipt of that filing, which can be shown again: a library without git has one all the same.
  expect(await recentOf(app)).toMatchObject([
    { label: "Plant tulips in October", shelf: "ideas", sublabel: "Ideas" },
    { label: "Trip to Lisbon", sublabel: "projects" },
    { label: "Maya", sublabel: "People" },
    { label: "Show the last receipt", action: "show-receipt" },
  ]);
  expect(await headOf(app)).toBe(`4 thoughts filed today. Evening review ${eveningWhen()}.`);
  await app.close();
});

test("a library that opens brings the count of its own log, and its own pages", async () => {
  const { app } = await hearing(); // an empty library to begin with
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${eveningWhen()}.`);
  await call(app, "createLibrary", await shelved()); // opens at once: no minute has come round to count it
  expect(await headOf(app)).toBe(`3 thoughts filed today. Evening review ${eveningWhen()}.`);
  expect((await recentOf(app)).map((item) => item.type === "item" && [item.label, item.sublabel])).toEqual([
    ["Trip to Lisbon", "projects"],
    ["Maya", "People"],
    ["Finish the prototype", "Goals"],
  ]);
  expect((await heldMenu(app))[0]).toMatchObject({ label: `3 thoughts filed today. Evening review ${eveningWhen()}.` });
  await app.close();
});

test("the shelf glyphs in the menu are black template images, which macOS tints, and the appearance turning builds no new menu", async () => {
  const { app } = await hearing({}, await shelved());
  let held = await heldMenu(app);
  const glyph = (label: string) => held.find((item) => item.label === label);
  // A template image is black on transparent: macOS gives it the menu's ink in light and in dark, and white on the highlight, where a
  // coloured image kept its colour (People's blue vanished on the default blue, and Ideas' yellow was 1.35:1 on a light menu).
  expect(glyph("Maya")).toMatchObject({ sublabel: "People", icon: { template: true, ink: "#000000" } });
  expect(glyph("Finish the prototype")).toMatchObject({ sublabel: "Goals", icon: { template: true, ink: "#000000" } });
  // A page off the shelves shows its folder's name and no glyph.
  expect(glyph("Trip to Lisbon")).toMatchObject({ sublabel: "projects", icon: null });
  // Nothing else in the menu has an icon.
  expect(held.filter((item) => item.icon).map((item) => item.label).sort()).toEqual(["Finish the prototype", "Maya"]);
  // The appearance turns dark, and light again. The menu was drawn for neither: no new menu is built, and the glyphs are as they were.
  const dark = () => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  await app.evaluate(({ nativeTheme }) => void (nativeTheme.themeSource = "light")); // a known place to turn from, whatever this Mac is set to
  await expect.poll(dark).toBe(false);
  await sleep(300); // an update for that, if this Mac was dark, has been told by now
  await countCalls(app, "refreshMenu");
  await app.evaluate(({ nativeTheme }) => {
    (globalThis as { themeUpdates?: number }).themeUpdates = 0;
    nativeTheme.on("updated", () => {
      (globalThis as { themeUpdates?: number }).themeUpdates = ((globalThis as { themeUpdates?: number }).themeUpdates ?? 0) + 1;
    });
  });
  const updates = () => app.evaluate(() => (globalThis as { themeUpdates?: number }).themeUpdates ?? 0);
  for (const to of ["dark", "light"] as const) {
    const seen = await updates();
    await app.evaluate(({ nativeTheme }, source) => void (nativeTheme.themeSource = source), to);
    await expect.poll(dark).toBe(to === "dark");
    // The appearance's own update has come: the controller's listener, had it one, was added before this one and has run.
    await expect.poll(updates, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(seen);
  }
  expect(await calls(app, "refreshMenu"), "no menu was built for the appearance").toBe(0);
  held = await heldMenu(app);
  expect(glyph("Maya")).toMatchObject({ icon: { template: true, ink: "#000000" } });
  expect(glyph("Finish the prototype")).toMatchObject({ icon: { template: true, ink: "#000000" } });
  await app.close();
});

test("a failed speech-model download is named in the menu", async () => {
  const hub = await fakeModelHub("missing");
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "needs-you", title: "" });
  const model = (await settingsSnap(app)).model;
  expect(model).toMatchObject({ kind: "error", cause: "download" });
  const [head, problem, after] = await menuOf(app);
  expect(head).toMatchObject({ action: "open-library" }); // nothing waits in the inbox
  // The capsule's own title, what is safe meanwhile (the capsule's and Settings → Voice's own words), and the fix: Settings → Voice,
  // where Try again is. What Try again does, whether it continues or starts over, is told there.
  expect(problem).toEqual({
    type: "item",
    label: "The speech model didn't finish downloading.",
    action: "open-settings:voice",
    sublabel: "Typing works meanwhile. Try again in Settings → Voice.",
  });
  expect(after).toEqual({ type: "separator" });
  // The menu the tray holds has it right after the head.
  expect((await heldMenu(app)).slice(0, 2).map((item) => item.label)).toEqual([await headOf(app), "The speech model didn't finish downloading."]);
  // Its action is the capsule card's own path: Settings opens on Voice, which tells it in the same words.
  await call(app, "menuAction", "open-settings:voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Voice", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByRole("alert").getByText("The speech model didn't finish downloading.")).toBeVisible();
  await app.close();
});

test("voice settings Avanzel can't use are named in the menu until a fix is read again", async () => {
  const library = await makeLibrary();
  const config = loadSettings(library);
  saveSettings(library, { ...config, voice: { ...config.voice, model: "parakeet-v9" } });
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  const title = "Avanzel can't use the voice settings in this library's config file.";
  await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "needs-you" });
  expect((await menuOf(app))[1]).toEqual({
    type: "item",
    label: title,
    action: "open-settings:voice",
    sublabel: "Typed thoughts are still saved to the inbox. Fix the config file.",
  });
  // Fixed by hand, with Avanzel running. Nothing watches the file; the minute that comes round reads it, and the test brings it round.
  // (Whether the item is still named before then is not asked: the real minute may come round first.)
  saveSettings(library, config);
  await call(app, "tick");
  await expect.poll(async () => (await menuOf(app))[1], { timeout: 10_000 }).toEqual({ type: "separator" });
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [50] }).toBe("idle");
  expect((await heldMenu(app)).map((item) => item.label)).not.toContain(title);
  expect(hub.requests).toEqual([]); // finding the fix downloads nothing: the shortcut does that
  await app.close();
});

test("choosing the voice settings problem in the menu reads them again, so Settings shows what is wrong now", async () => {
  const library = await makeLibrary();
  const config = loadSettings(library);
  saveSettings(library, { ...config, voice: { ...config.voice, model: "parakeet-v9" } });
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  const title = "Avanzel can't use the voice settings in this library's config file.";
  await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "needs-you" });
  expect((await menuOf(app))[1]).toMatchObject({ label: title });
  // Mended by hand a moment ago, before the minute came round: the person chooses the item to see what is wrong.
  saveSettings(library, config);
  await call(app, "menuAction", "open-settings:voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Voice", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByText("Speech model", { exact: true })).toBeVisible(); // the pane has read what is now
  await expect(settings.getByText(title)).toHaveCount(0);
  expect((await menuOf(app))[1]).toEqual({ type: "separator" });
  await expect.poll(() => faceOf(app), { timeout: 10_000, intervals: [50] }).toBe("idle");
  await app.close();
});

test("the count is read from the log once, and again when the day turns", async () => {
  const { app } = await hearing();
  const kept = (day: string, count: number) =>
    app.evaluate((_electron, cache) => void ((globalThis as unknown as { __avanzel: { filed: unknown } }).__avanzel.filed = cache), { day, count });
  const when = eveningWhen();
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${when}.`);
  // The menu is built from what was counted, not from the log, at every rebuild and every tick: a count planted for today stands.
  await kept(localDate(new Date()), 7);
  await call(app, "refreshMenu");
  await call(app, "tick");
  expect(await headOf(app)).toBe(`7 thoughts filed today. Evening review ${when}.`);
  expect((await heldMenu(app))[0]).toMatchObject({ label: `7 thoughts filed today. Evening review ${when}.` });
  // A count for a day that has passed is read again, from the log, by the next tick: nothing was filed today.
  await kept("2000-01-01", 7);
  await call(app, "tick");
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${when}.`);
  await app.close();
});

// ---------------------------------------------------------------- Undo the last filing, from the menu
//
// "Undo the last filing" takes back the filing the controller keeps as `lastFiled`: the last capsule or background filing that ended
// well with a commit, while nothing has run since. Every filing's run clears it as it starts, and so does each review's; so does a
// take-back of its commit. Setup's first thought and the evening review never set it: each has its own Undo. A library keeps its own
// (`undo-records.json`, below): it comes back with the library, and after a relaunch.
// A filing has a commit to take back only in a library with git, so these tests make one (`makeLibrary({ git: true })`).

/** The menu's Undo the last filing in the model now, or undefined while the menu doesn't offer it. */
const undoItem = async (app: ElectronApplication) => (await menuOf(app)).find((item) => item.type === "item" && item.action === "undo-filing");

/** The menu's Undo the last evening review in the model now, or undefined while the menu doesn't offer it. */
const reviewItem = async (app: ElectronApplication) => (await menuOf(app)).find((item) => item.type === "item" && item.action === "undo-review");

/** The menu's Show the last receipt in the model now, or undefined while the menu doesn't offer it. */
const receiptItem = async (app: ElectronApplication) => (await menuOf(app)).find((item) => item.type === "item" && item.action === "show-receipt");

/** The item as the menu models it: a plain item, with no shortcut, shelf or sublabel. */
const RECEIPT_ITEM = { type: "item", label: "Show the last receipt", action: "show-receipt" };

/** Undo the last filing as the menu models it: a plain item with its shortcut, ⌥⇧Z, and no shelf or sublabel. */
const UNDO_ITEM = { type: "item", label: "Undo the last filing", action: "undo-filing", accelerator: "Alt+Shift+Z" };

/**
 * What the app has kept of `library`'s two Undo items in its profile (`undo-records.json` in `userData`, under the library's resolved
 * path): undefined while there is no file, or nothing in it for the library, which is the record of a library with nothing to undo.
 */
function savedUndo(userData: string, library: string): SavedUndo | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(userData, "undo-records.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return (JSON.parse(text) as Record<string, SavedUndo>)[path.resolve(library)];
}

/** A library's record in `undo-records.json`: its two Undo items' commits, and the last filing's receipt (what "Show the last receipt" prints). */
type SavedUndo = {
  filing: string | null;
  evening: string[];
  receipt: FilingReceipt | null;
};

/** A commit as git prints it. */
const COMMIT = /^[0-9a-f]{40}$/;

/** Whether the menu the tray holds (as macOS was given it) offers Undo the last filing: it is built again where the model changes. */
const trayOffersUndo = async (app: ElectronApplication) => (await heldMenu(app)).some((item) => item.label === "Undo the last filing");

/** Whether the menu the tray holds offers Show the last receipt. */
const trayOffersReceipt = async (app: ElectronApplication) => (await heldMenu(app)).some((item) => item.label === "Show the last receipt");

/** The press of the menu's item; it returns once the filing is taken back and the person is told, or at once when there is nothing to take back. */
const pressUndo = (app: ElectronApplication) => call(app, "menuAction", "undo-filing").then(() => undefined);

/** The press of the menu's Show the last receipt; it returns at once, with the card up or, where the item does nothing, as it was. */
const showReceipt = (app: ElectronApplication) => call(app, "menuAction", "show-receipt").then(() => undefined);

/** The notifications the app has posted, oldest first. */
const said = (app: ElectronApplication) => call(app, "notificationsForTests") as Promise<{ title: string; body: string }[]>;

/** From now on the engine's fake agent behaves as `mode` says (FAKE_AGENT_MODE) for the runs that follow: each run is handed the app's environment. */
const agentMode = (app: ElectronApplication, mode: string) => app.evaluate((_electron, wanted) => void (process.env.FAKE_AGENT_MODE = wanted), mode);

/** The Undone card's note, under the default evening review at 21:00. */
const UNDONE_NOTE = "Your words are back in the inbox for the evening review at 21:00.";
const UNDO_REFUSED = { title: "This one can't be undone automatically.", body: "Usually a later change touched the same lines. The library's history keeps both versions." };

/**
 * A library with git whose agent is the stand-in `claude` in `bin` (agentStubs'), opened by an app that hears "Plant tulips in October":
 * for the tests that change what the agent does between two filings (`answerAs`), as a usage limit does.
 */
async function withClaude(bin: string, env: Record<string, string> = {}) {
  const library = await makeLibrary({ git: true });
  saveSettings(library, { ...loadSettings(library), harness: "claude" });
  return hearing({ ...onlyAgentsIn(bin), ...env }, library);
}

test("Undo from the menu takes the last filing back and says so once", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  // The menu offers it, in the model and in the menu the tray holds, with the filing counted.
  expect(await undoItem(app)).toEqual(UNDO_ITEM);
  expect(await trayOffersUndo(app)).toBe(true);
  expect(await headOf(app)).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
  await call(app, "dismiss"); // the card is hidden: the menu is all that offers Undo now
  expect(await capsuleKind(app)).toBe("hidden");
  await pressUndo(app);
  // The page is gone, and the note is back in the inbox.
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  expect(undone(library)).toHaveLength(1);
  // One notification says so, and nothing else was said.
  expect(await said(app)).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  // The status line has nothing filed, and the item is gone, in the model and in the menu the tray holds.
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${eveningWhen()}.`);
  expect((await heldMenu(app))[0]).toMatchObject({ label: `Nothing filed today. Evening review ${eveningWhen()}.` });
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // A second press takes nothing back: the filing was taken back once, and nobody is told again.
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  expect(await said(app)).toHaveLength(1);
  await app.close();
});

test("Undo from the menu turns the showing filed card to Undone", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  await pressUndo(app);
  // The card the person is looking at says it, as the card's own Undo does, over their words and where they wait now.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true, text: "Plant tulips in October", note: UNDONE_NOTE });
  expect(await said(app), "the card told it: no notification does").toEqual([]);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  expect(await undoItem(app)).toBeUndefined();
  expect(await headOf(app)).toBe(`Nothing filed today. Evening review ${eveningWhen()}.`);
  await app.close();
});

test("Undo from the menu answers once: while it waits for the library, the card's Undo and a second press do nothing", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app, { hold: true });
  await filedFromTheCapsule(app);
  const pressed = pressUndo(app);
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  // The filing was taken before the take-back landed: the menu stops offering it at once.
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // The card's Undo and a second press find the filing being taken back, and ask for nothing more.
  await call(app, "undo");
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(1);
  expect(await capsuleKind(app)).toBe("filed");
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await pressed;
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true, note: UNDONE_NOTE });
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  expect(await said(app)).toEqual([]);
  await app.close();
});

for (const showing of [true, false]) {
  test(`a refused Undo from the menu says so once, ${showing ? "on the card that shows the filing" : "in a notification"}`, async () => {
    const library = await makeLibrary({ git: true });
    const { app } = await hearing({}, library);
    await watchUndos(app, { fail: true }); // git can't run
    await filedFromTheCapsule(app);
    if (!showing) await call(app, "dismiss");
    await pressUndo(app);
    if (showing) {
      expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: UNDO_REFUSED.title, detail: UNDO_REFUSED.body });
      expect(await said(app)).toEqual([]);
    } else {
      expect(await said(app)).toEqual([UNDO_REFUSED]);
    }
    // The filing stands: its page is where the agent wrote it, and the menu still counts it.
    expect(filesUnder(library, "ideas")).toHaveLength(1);
    expect(inbox(library)).toEqual([]);
    expect(await headOf(app)).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
    // It was asked of the library once, and the menu doesn't offer it again.
    expect(await undoCalls(app)).toBe(1);
    expect(await undoItem(app)).toBeUndefined();
    expect(await trayOffersUndo(app)).toBe(false);
    await pressUndo(app);
    expect(await undoCalls(app)).toBe(1);
    expect(await said(app)).toHaveLength(showing ? 0 : 1);
    await app.close();
  });
}

test("Undo from the card takes the menu's Undo away, and leaves nothing for it to take back", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  await call(app, "undo"); // the card's own Undo
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true });
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  await app.close();
});

test("an Undo from the card that lands under a newer card is told by notification, and the menu follows it", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app, { hold: true });
  await filedFromTheCapsule(app);
  const pressed = call(app, "undo");
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  await call(app, "toggleDictate"); // a new thought begins while the take-back waits at the library's door
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("listening");
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await pressed;
  // Silent: the recording is on, and macOS's sound for the notification would be heard in the words.
  expect(await said(app)).toEqual([{ title: "Undone", body: UNDONE_NOTE, silent: true }]);
  expect(await capsuleKind(app)).toBe("listening");
  // A notification was all that answered, and the menu the tray holds counts what is left all the same.
  expect((await heldMenu(app))[0]).toMatchObject({ label: `Nothing filed today. Evening review ${eveningWhen()}.` });
  await call(app, "cancelRecording");
  await app.close();
});

test("Undo from the menu follows the last filing: a note filed in the background after a limit's reset offers its own commit", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const { app, library } = await withClaude(bin, { AVANZEL_RESET_MARGIN_MS: "0" }); // a wait files its note at the reset itself
  await watchUndos(app);
  // A thought filed from the capsule first: its commit is the last filing's, for now.
  await filedFromTheCapsule(app);
  const [first] = filesUnder(library, "ideas");
  expect(first).toBeDefined();
  expect(await undoItem(app)).toBeDefined();
  // The next one meets Claude Code's usage limit, which lifts 5 seconds on. Its run began, so the first filing is no longer the last.
  answerAs(bin, "claude", limitedClaudeFor(bin, 5));
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  expect(await undoItem(app)).toBeUndefined();
  // At the reset the note is filed in the background, and the filing that ended well there is the last one.
  await expect.poll(() => notified(app, "Filed by Claude Code"), { timeout: 30_000 }).toHaveLength(1);
  await call(app, "idleForTests");
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(inbox(library)).toEqual([]);
  expect(await undoItem(app)).toEqual(UNDO_ITEM);
  expect(await trayOffersUndo(app)).toBe(true);
  // It ended with a notification and no card, and its receipt is the last one: the words are read from the capture the engine archived
  // (a background job has none of its own), without the embed of the recording that a dictated thought ends with (B2).
  const second = filesUnder(library, "ideas").find((name) => name !== first);
  expect(second).toBeDefined();
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Plant tulips in October", canUndo: true, pages: [{ path: `ideas/${second}` }] });
  await call(app, "dismiss");
  await pressUndo(app);
  // Its own commit was taken back: the note filed at the reset is in the inbox again, and the first filing stands.
  expect(filesUnder(library, "ideas")).toEqual([first]);
  expect(inbox(library)).toHaveLength(1);
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  // A filing made in the background has no card to turn to Undone: a notification says it, once.
  expect(await notified(app, "Undone")).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  expect(await undoItem(app)).toBeUndefined();
  expect(await receiptItem(app), "its receipt went with the take-back of its filing").toBeUndefined();
  expect(await headOf(app)).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
  await app.close();
});

test("Undo from the menu is not offered after a filing that failed, and is back after one that ends well", async () => {
  const library = await makeLibrary({ git: true });
  const { app, userData } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  const first = savedUndo(userData, library)?.filing;
  expect(first, "kept for the next launch").toMatch(COMMIT);
  await agentMode(app, "fail");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  // The second filing's run began, so the first filing is no longer the last one; and this one failed, which is no filing to undo.
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  expect(savedUndo(userData, library)?.filing ?? null, "nor is it saved for a launch to offer").toBeNull();
  expect(savedUndo(userData, library)?.receipt?.commit, "the receipt is as it was: a failed filing leaves it").toBe(first);
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(0);
  expect(filesUnder(library, "ideas")).toHaveLength(1); // the first filing stands
  // The next filing that ends well is the last one.
  await agentMode(app, "ok");
  await filedFromTheCapsule(app);
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(await undoItem(app)).toBeDefined();
  expect(savedUndo(userData, library)?.filing).toMatch(COMMIT);
  expect(savedUndo(userData, library)?.filing).not.toBe(first);
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toHaveLength(2); // the note that failed, and the one just taken back
  expect(await undoCalls(app)).toBe(1);
  await app.close();
});

test("Undo from the menu is not offered after a filing that Stop took back", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  await watchUndos(app);
  await stopAtTheEnd(app); // the next filing is stopped the moment its agent ends
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  await call(app, "idleForTests");
  // Its run began, so the first filing is no longer the last one; and a filing that was taken back is none.
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  expect(await undoCalls(app)).toBe(1); // Stop's take-back, and no more
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(1);
  expect(filesUnder(library, "ideas")).toHaveLength(1); // the first filing's page stands, and the stopped one's is gone
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("Undo from the menu is not offered after setup's first thought, which has its own Undo", async () => {
  test.setTimeout(150_000); // a first run, taken to its first filing
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 60_000 });
  // It was filed with a commit, which setup's window can take back: that is the Undo this thought has.
  expect((await setupSnap(app)).filing).toMatchObject({ kind: "filed", canUndo: true });
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  await pressUndo(app);
  expect(undone(path.join(home, "Avanzel"))).toEqual([]);
  expect((await setupSnap(app)).filing).toMatchObject({ kind: "filed", canUndo: true }); // still filed
  await app.close();
});

test("Undo from the menu is not offered after an evening review that filed", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  await reviewed(app);
  // The review began, so the capsule's filing is no longer the last one; and the review's own commits are taken back by its own item.
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // The review's item reads like the filing's own ("Undo the last filing"), in the menu the model gave and the one the tray holds.
  expect((await menuOf(app)).filter((item) => item.type === "item" && item.action === "undo-review")).toEqual([
    { type: "item", label: "Undo the last evening review", action: "undo-review" },
  ]);
  expect((await heldMenu(app)).map((item) => item.label)).toContain("Undo the last evening review");
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(0);
  expect(filesUnder(library, "ideas")).toHaveLength(2); // the capsule's filing, and the review's
  await app.close();
});

/** A custom review, for the tests that ask what Avanzel does with one: it skips it, and says so. */
const STANDUP = "---\nname: Standup\nschedule: daily 09:00\nkind: custom\n---\nAsk about the day.\n";

// A review that writes to the library ends the offer: the weekly one commits the owner's changes and appends its own line to the log, and
// the evening review commits what it files. A revert of the filing before it would meet that later commit. The weekly review's start ends
// it; the evening review ends it as it ends, if it filed anything (one with nothing to file writes nothing: the test after these). A
// custom review is skipped and changes nothing: the last filing stands. While any of them waits or runs, the item is hidden.
for (const { review, name, ends } of [
  { review: "weekly-review", name: "Weekly review", ends: true },
  { review: "evening-review", name: "Evening review", ends: true },
  { review: "standup", name: "Standup", ends: false },
]) {
  test(`Undo from the menu hides while the ${name.toLowerCase()} waits and runs, and is ${ends ? "gone" : "back"} after it`, async () => {
    const library = await makeLibrary({ git: true });
    // Only its own case has the custom review: in the others, a run that crossed 09:00 would run it on its schedule.
    if (review === "standup") writeFileSync(path.join(library, "tasks", "standup.md"), STANDUP);
    const { app } = await hearing({}, library);
    await watchUndos(app);
    await filedFromTheCapsule(app);
    expect(await undoItem(app)).toBeDefined();
    expect(await receiptItem(app)).toBeDefined();
    // The evening review has a note to file, so it does write to the library.
    if (review === "evening-review") new Vault(library).newCapture("An earlier thought", { source: "text" });
    await holdTheQueue(app); // the review waits for its turn
    await call(app, "runTask", review);
    expect(await undoItem(app)).toBeUndefined();
    expect(await trayOffersUndo(app)).toBe(false);
    expect(await receiptItem(app)).toBeUndefined();
    expect(await trayOffersReceipt(app)).toBe(false);
    await showReceipt(app); // a press does nothing while the review is on: no reprint comes up
    expect(await call(app, "capsuleStateForTests")).not.toHaveProperty("reprint");
    await letTheQueueGo(app);
    await expect.poll(async () => (await said(app)).some((note) => note.title.startsWith(name)), { timeout: 60_000 }).toBe(true);
    if (review === "evening-review") expect((await said(app)).find((note) => note.title.startsWith(name))?.title).toBe("Evening review: 1 thought filed");
    await call(app, "idleForTests");
    if (ends) {
      expect(await undoItem(app)).toBeUndefined();
      expect(await trayOffersUndo(app)).toBe(false);
      await pressUndo(app);
      expect(await undoCalls(app)).toBe(0);
    } else {
      await expect.poll(() => trayOffersUndo(app), { timeout: 10_000 }).toBe(true);
      expect(await undoItem(app)).toBeDefined();
    }
    // A review doesn't clear the receipt: it is back after the review, and its Undo is the menu's, so a review that wrote has taken it.
    await expect.poll(() => trayOffersReceipt(app), { timeout: 10_000 }).toBe(true);
    expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
    await call(app, "dismiss");
    await showReceipt(app);
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Plant tulips in October", canUndo: !ends });
    await app.close();
  });
}

// An evening review with nothing to file makes no commit and writes no line in the log, so git would still take the last filing back:
// the offer stands until the next filing (spec §6.3). On the default path that is every evening whose inbox the day's filings emptied.
test("an evening review with nothing to file leaves Undo the last filing in place, and the Undo still takes the filing back", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(inbox(library)).toEqual([]);
  const commits = gitOut(library, "rev-list", "--count", "HEAD");
  await holdTheQueue(app); // the review waits for its turn
  await call(app, "runTask", "evening-review");
  // Hidden while it waits and runs, as for any review.
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  await letTheQueueGo(app);
  expect(await reviewSaid(app), "how the review ended").toMatchObject({ title: "Evening review", body: "Inbox was empty." });
  await call(app, "idleForTests");
  expect(gitOut(library, "rev-list", "--count", "HEAD"), "the review wrote nothing").toBe(commits);
  // Offered again, in the model and in the menu the tray holds.
  await expect.poll(() => trayOffersUndo(app), { timeout: 10_000 }).toBe(true);
  expect(await undoItem(app)).toEqual(UNDO_ITEM);
  // And it still works: the page goes, and the note is back in the inbox.
  await call(app, "dismiss"); // the card is hidden: the menu is all that offers Undo now
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  expect(undone(library)).toHaveLength(1);
  expect(await said(app)).toContainEqual({ title: "Undone", body: UNDONE_NOTE });
  expect(await undoItem(app)).toBeUndefined();
  await app.close();
});

// ---- The two Undo items outlast a quit, and each library keeps its own (2a: undo-records.json in the app's profile) ----
//
// The review's commits come before the filing's in the library's history, so the filing is always taken back first: its log line follows
// the review's, and a revert of a line that a later change sits next to conflicts.

/**
 * A git library with one note in its inbox, opened by an app on which the evening review has filed it and then a thought spoken into
 * the capsule has been filed: both Undo items show. `env` steers the app.
 */
async function withBothUndos(env: Record<string, string> = {}) {
  const library = await makeLibrary({ git: true });
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const launched = await hearing(env, library);
  await reviewed(launched.app);
  await filedFromTheCapsule(launched.app);
  expect(await undoItem(launched.app)).toBeDefined();
  expect(await reviewItem(launched.app)).toBeDefined();
  return launched;
}

/** Chooses the menu's Undo the last evening review; returns once the queue is idle again (the press itself returns at once). */
async function pressUndoReview(app: ElectronApplication): Promise<void> {
  await call(app, "menuAction", "undo-review");
  await call(app, "idleForTests");
}

/** How much work the app's queue holds now: what runs, and what waits behind it. */
const queuedWork = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __avanzel: { queued: number } }).__avanzel.queued);

/** Whether the open library's saved Undo has been checked against its git (`Controller.undoChecked`), whether or not it then offers anything. */
const undoChecked = (app: ElectronApplication) => call(app, "undoChecked") as Promise<boolean>;

test("both Undo items survive a quit and relaunch, and each takes its own back", async () => {
  const first = await withBothUndos();
  const { library } = first;
  const saved = savedUndo(first.userData, library);
  expect(saved?.filing).toMatch(COMMIT);
  expect(saved?.evening.length).toBeGreaterThan(0);
  await first.app.close();
  // Avanzel opens again with the same app data and the same library.
  const { app } = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await watchUndos(app);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toEqual(UNDO_ITEM);
  await expect.poll(() => reviewItem(app), { timeout: 20_000 }).toEqual({ type: "item", label: "Undo the last evening review", action: "undo-review" });
  expect(await trayOffersUndo(app)).toBe(true);
  expect((await heldMenu(app)).map((item) => item.label)).toContain("Undo the last evening review");
  expect(savedUndo(first.userData, library), "both commits are in the library's history: kept as they were").toEqual(saved);
  // The filing is the newer: it goes first. The review's page stays, and the capsule's note is back in the inbox.
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Undone")).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  expect(await undoItem(app)).toBeUndefined();
  expect(await reviewItem(app)).toBeDefined();
  expect(savedUndo(first.userData, library)).toEqual({ filing: null, evening: saved?.evening, receipt: null });
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
  expect(await notified(app, "Evening review undone")).toEqual([{ title: "Evening review undone", body: "Everything it filed is back in the inbox." }]);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(2);
  expect(await undoItem(app)).toBeUndefined();
  expect(await reviewItem(app)).toBeUndefined();
  expect(savedUndo(first.userData, library), "nothing left to undo: the library is out of the file").toBeUndefined();
  expect(await undoCalls(app)).toBe(2);
  await app.close();
});

test("a saved Undo whose commit has left the library's history isn't offered after a relaunch, and is dropped", async () => {
  const library = await makeLibrary({ git: true });
  const first = await hearing({}, library);
  await filedFromTheCapsule(first.app);
  expect(savedUndo(first.userData, library)?.filing).toMatch(COMMIT);
  expect(savedUndo(first.userData, library)?.receipt?.commit, "its receipt names that commit").toMatch(COMMIT);
  await first.app.close();
  // The library's history moved back (a reset here; a rebase, a pull that rewrote it or a backup that was restored do as much): the
  // filing's commit is not in it. A review's commit that was never in it stands for the second record.
  gitOut(library, "reset", "-q", "--hard", "HEAD~1");
  const file = path.join(first.userData, "undo-records.json");
  const records = JSON.parse(readFileSync(file, "utf8")) as Record<string, { filing: string | null; evening: string[] }>;
  const record = records[path.resolve(library)];
  expect(record).toBeDefined();
  if (record) record.evening = ["0".repeat(40)];
  writeFileSync(file, JSON.stringify(records));
  const { app } = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await watchUndos(app);
  await expect.poll(() => savedUndo(first.userData, library), { timeout: 20_000, message: "the check dropped both records, and the receipt of the filing" }).toBeUndefined();
  expect(await undoItem(app)).toBeUndefined();
  expect(await reviewItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // The receipt of a filing that is no longer in the history prints what is no longer so: it is not offered, and not kept.
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  expect(savedUndo(first.userData, library)?.receipt ?? null).toBeNull();
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("hidden");
  await pressUndo(app);
  await pressUndoReview(app);
  expect(await undoCalls(app)).toBe(0);
  const told = (await said(app)).map((note) => note.title); // dropped quietly: nothing was said of either record
  expect(told).not.toContain("Undone");
  expect(told).not.toContain("Evening review undone");
  expect(told).not.toContain(UNDO_REFUSED.title);
  await app.close();
});

test("a launch while git can't run offers neither Undo and keeps the saved records, and a launch with git offers both again", async () => {
  const first = await withBothUndos();
  const { library } = first;
  const saved = savedUndo(first.userData, library);
  expect(saved?.filing).toMatch(COMMIT);
  expect(saved?.evening.length).toBeGreaterThan(0);
  await first.app.close();
  // Git can't run for a while (the developer tools are gone after an update, say): nothing can be undone, so nothing is offered. The
  // library is checked all the same, and what it saved waits in the file for a launch that has git.
  const blind = await hearing({ AVANZEL_USER_DATA: first.userData, AVANZEL_GIT_USABLE: "0" }, library);
  await expect.poll(() => undoChecked(blind.app), { timeout: 20_000 }).toBe(true);
  expect(await undoItem(blind.app)).toBeUndefined();
  expect(await reviewItem(blind.app)).toBeUndefined();
  expect(await trayOffersUndo(blind.app)).toBe(false);
  // The receipt names a commit that nothing can say is there without git: not offered either, and kept all the same.
  expect(await receiptItem(blind.app)).toBeUndefined();
  expect(await trayOffersReceipt(blind.app)).toBe(false);
  expect(savedUndo(first.userData, library), "kept as it was").toEqual(saved);
  await blind.app.close();
  // The next launch finds git again: the same records are checked, found in the library's history, offered, and work.
  const { app } = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await watchUndos(app);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toBeDefined();
  await expect.poll(() => reviewItem(app), { timeout: 20_000 }).toBeDefined();
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  expect(savedUndo(first.userData, library)).toEqual(saved);
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await undoCalls(app)).toBe(2);
  await app.close();
});

test("each library keeps its own Undo items through a switch: only the open library's show, and they come back with it", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
  const { app, library } = await withBothUndos({ XDG_CONFIG_HOME: config });
  await watchUndos(app);
  // The first library's reprint is up when the person goes to another: its Open and its Undo are the first library's, so the switch puts it away.
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", reprint: { filedAt: expect.any(Number) }, canUndo: true });
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other);
  expect(await capsuleKind(app)).toBe("hidden");
  // The library that opens has no Undo of its own, and not the first library's: neither item shows, in the model and in the menu the tray holds.
  // Nor has it a receipt, though the first library has one.
  expect(await undoItem(app)).toBeUndefined();
  expect(await reviewItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("hidden");
  expect((await heldMenu(app)).map((item) => item.label)).not.toContain("Undo the last evening review");
  await pressUndo(app);
  await pressUndoReview(app);
  expect(await undoCalls(app)).toBe(0); // the first library's filing and review stand, and are not this library's to take back
  expect(undone(library)).toEqual([]);
  expect(undone(other)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  const told = (await said(app)).map((note) => note.title);
  expect(told).not.toContain("Undone");
  expect(told).not.toContain("Evening review undone");
  // The first library opens again, and its two items are back: their commits are in its history. Each takes its own back.
  await call(app, "useLibrary", library);
  expect((await settingsSnap(app)).library?.path).toBe(library);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toBeDefined();
  await expect.poll(() => reviewItem(app), { timeout: 20_000 }).toBeDefined();
  await expect.poll(() => receiptItem(app), { timeout: 20_000 }).toEqual(RECEIPT_ITEM);
  expect(await trayOffersUndo(app)).toBe(true);
  expect(await trayOffersReceipt(app)).toBe(true);
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await receiptItem(app)).toBeUndefined();
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(2);
  expect(await undoItem(app)).toBeUndefined();
  expect(await reviewItem(app)).toBeUndefined();
  expect(await undoCalls(app)).toBe(2);
  expect(undone(other)).toEqual([]);
  await app.close();
});

test("an evening review that ends after a library switch keeps its Undo with its own library", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
  const library = await makeLibrary({ git: true });
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app, userData } = await hearing({ XDG_CONFIG_HOME: config }, library);
  await filedFromTheCapsule(app); // the library has a filing to undo too, which the review that comes after it ends the offer of
  expect(savedUndo(userData, library)?.filing).toMatch(COMMIT);
  await app.evaluate(() => void (process.env.FAKE_AGENT_DELAY_MS = "3000")); // the agent takes a moment to file the note
  await call(app, "runTask", "evening-review");
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toBe("Filing 1 of 1");
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other); // the review is with its agent still
  expect((await settingsSnap(app)).library?.path).toBe(other);
  expect(await reviewSaid(app), "how the review ended").toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
  // The review filed in its own library, which is not the open one: nothing of it to undo here, its commits kept where they belong, and
  // the filing it came after gone from that library's file, though that library isn't open to show it.
  expect(await reviewItem(app)).toBeUndefined();
  const saved = savedUndo(userData, library);
  expect(saved?.filing, "the review's end took the filing out of its own library's file").toBeNull();
  expect(saved?.evening.length).toBeGreaterThan(0);
  expect(saved?.evening.every((sha) => COMMIT.test(sha))).toBe(true);
  expect(savedUndo(userData, other)).toBeUndefined();
  await call(app, "useLibrary", library);
  await expect.poll(() => reviewItem(app), { timeout: 20_000 }).toBeDefined();
  expect(await undoItem(app)).toBeUndefined();
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
  expect(await notified(app, "Evening review undone")).toEqual([{ title: "Evening review undone", body: "Everything it filed is back in the inbox." }]);
  expect(filesUnder(library, "ideas")).toHaveLength(1); // the capsule's filing stands
  expect(inbox(library)).toHaveLength(1);
  // Nothing is left to undo, but the capsule's filing stands and so does its receipt: the review ended its Undo, not its receipt.
  expect(savedUndo(userData, library)).toMatchObject({ filing: null, evening: [], receipt: { text: "Plant tulips in October" } });
  await app.close();
});

test("an evening review that ends after its library was opened again offers its Undo there, and it works", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
  const library = await makeLibrary({ git: true });
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app, userData } = await hearing({ XDG_CONFIG_HOME: config }, library);
  await app.evaluate(() => void (process.env.FAKE_AGENT_DELAY_MS = "3000")); // the agent takes a moment to file the note
  await call(app, "runTask", "evening-review");
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toBe("Filing 1 of 1");
  // The person goes to another library and back while the review is with its agent. Opening the folder again makes a new library
  // object, and it is the same library: the review's end is for the library that is open.
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other);
  await call(app, "useLibrary", library);
  expect((await settingsSnap(app)).library?.path).toBe(library);
  expect(await reviewSaid(app), "how the review ended").toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
  // Offered at once, with no further open, in the model and in the menu the tray holds.
  await expect.poll(() => reviewItem(app), { timeout: 10_000 }).toEqual({ type: "item", label: "Undo the last evening review", action: "undo-review" });
  await expect.poll(async () => (await heldMenu(app)).map((item) => item.label), { timeout: 10_000 }).toContain("Undo the last evening review");
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
  expect(await notified(app, "Evening review undone")).toEqual([{ title: "Evening review undone", body: "Everything it filed is back in the inbox." }]);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  expect(await reviewItem(app)).toBeUndefined();
  expect(savedUndo(userData, library)).toBeUndefined();
  await app.close();
});

test("a filing that ends after a library switch keeps its Undo with its own library", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
  const library = await makeLibrary({ git: true });
  const { app, userData } = await hearing({ XDG_CONFIG_HOME: config, FAKE_AGENT_DELAY_MS: "3000" }, library); // the agent takes a moment
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", other); // the agent has the note still
  expect((await settingsSnap(app)).library?.path).toBe(other);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await call(app, "idleForTests");
  // The filing is the first library's: the open library has no Undo for it, and the first library's file keeps its commit.
  expect(await undoItem(app)).toBeUndefined();
  expect(savedUndo(userData, library)?.filing).toMatch(COMMIT);
  expect(savedUndo(userData, other)).toBeUndefined();
  await call(app, "dismiss");
  await call(app, "useLibrary", library);
  await expect.poll(() => undoItem(app), { timeout: 20_000 }).toBeDefined();
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Undone")).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  expect(savedUndo(userData, library)).toBeUndefined();
  await app.close();
});

// An Undo takes back in the library it was asked in, whichever library is open when the queue gets to it. The other library is a copy of
// the first one's history, so it holds the very commits being taken back: an Undo that landed in it would revert them there.
for (const comeBack of [false, true]) {
  test(`an Undo asked in a library is taken back there, and told once, though ${comeBack ? "another library was opened and then this one again" : "another library is open"} when the queue gets to it`, async () => {
    const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
    const { app, library, userData } = await withBothUndos({ XDG_CONFIG_HOME: config });
    await call(app, "dismiss"); // the card is hidden: the menu is all that offers Undo now, and what it did is told in notifications
    const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
    gitOut(library, "clone", "-q", library, other);
    const copied = filesUnder(other, "ideas");
    expect(copied).toHaveLength(2); // the review's page and the capsule's
    await watchUndos(app);
    await holdTheQueue(app);
    // Both are asked in the first library, the filing first (it is the newer), and wait behind the held work.
    const filing = pressUndo(app);
    await expect.poll(() => queuedWork(app)).toBe(2);
    const review = call(app, "menuAction", "undo-review");
    await expect.poll(() => queuedWork(app)).toBe(3);
    expect(savedUndo(userData, library), "their one try: asked for, so gone from the file").toBeUndefined();
    // Before the queue gets to them, the copy opens, and the first library after it in one of the runs.
    await call(app, "createLibrary", other);
    if (comeBack) await call(app, "useLibrary", library);
    expect((await settingsSnap(app)).library?.path).toBe(comeBack ? library : other);
    await letTheQueueGo(app);
    await Promise.all([filing, review]);
    await call(app, "idleForTests");
    await expect.poll(async () => (await notified(app, "Evening review undone")).length).toBe(1);
    // Each was taken back in the first library, by the librarian made for it...
    expect(await undoCalls(app)).toBe(2);
    expect(filesUnder(library, "ideas")).toEqual([]);
    expect(inbox(library)).toHaveLength(2); // the capsule's note and the review's
    expect(undone(library).length).toBeGreaterThan(0);
    // ...and the copy, which holds the same commits, is as it was.
    expect(undone(other)).toEqual([]);
    expect(filesUnder(other, "ideas")).toEqual(copied);
    // The result is told once for each, and as it is told for any Undo: nothing says it can't be undone.
    expect(await notified(app, "Undone")).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
    expect(await notified(app, "Evening review undone")).toEqual([{ title: "Evening review undone", body: "Everything it filed is back in the inbox." }]);
    expect(await notified(app, UNDO_REFUSED.title)).toEqual([]);
    expect(savedUndo(userData, library)).toBeUndefined();
    await app.close();
  });
}

test("an evening review whose take-back fails says it can't be undone, once, and leaves nothing unhandled", async () => {
  const { app, library, userData } = await withBothUndos();
  // The menu starts the take-back and doesn't wait for it: a rejection nobody handles would end up here.
  await app.evaluate(() => {
    const unhandled: string[] = [];
    Object.assign(globalThis, { unhandled });
    process.on("unhandledRejection", (reason) => void unhandled.push(String(reason)));
  });
  await watchUndos(app, { fail: true }); // git can't run: the queued take-back throws
  await pressUndoReview(app);
  await expect.poll(async () => (await notified(app, UNDO_REFUSED.title)).length).toBe(1);
  expect(await notified(app, UNDO_REFUSED.title)).toEqual([UNDO_REFUSED]);
  expect(await notified(app, "Evening review undone")).toEqual([]);
  expect(await undoCalls(app)).toBe(1);
  expect(await app.evaluate(() => (globalThis as { unhandled?: string[] }).unhandled)).toEqual([]);
  // That was its one try: the review's item is gone and its record with it, and the filing's is as it was.
  expect(await reviewItem(app)).toBeUndefined();
  expect(savedUndo(userData, library)?.evening).toEqual([]);
  expect(savedUndo(userData, library)?.filing).toMatch(COMMIT);
  expect(await undoItem(app)).toBeDefined();
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  await app.close();
});

test("Undo from the menu is not offered once Avanzel is quitting", async () => {
  const library = await makeLibrary({ git: true });
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app, userData } = await hearing({ AVANZEL_QUIT_WAIT_MS: "2000" }, library);
  await watchUndos(app);
  await reviewed(app);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  expect(await reviewItem(app)).toBeDefined();
  const saved = savedUndo(userData, library);
  expect(saved?.filing).toMatch(COMMIT);
  expect(saved?.evening.length).toBeGreaterThan(0);
  await call(app, "stopForQuit");
  expect(await undoItem(app)).toBeUndefined();
  await pressUndo(app);
  await pressUndoReview(app);
  expect(await undoCalls(app)).toBe(0);
  expect(await notified(app, "Evening review undone")).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(2); // the capsule's filing, and the review's
  // A quit takes nothing back, and leaves both records for the next launch to offer.
  expect(savedUndo(userData, library)).toEqual(saved);
  await app.close();
});

test("a Stop on a filing that still waits in the queue leaves the last filing to undo", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  await holdTheQueue(app); // something else has the queue, so the next filing waits for its turn
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  // A filing waits: the menu doesn't offer Undo for the one before it meanwhile, in the model and in the menu the tray holds (which
  // the card's own rebuild made, as the filing joined the queue).
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  await capsule.evaluate(() => window.avanzel.capsule.cancelFiling()); // Stop: nothing has touched the note, so the card says Stopped at once
  await expect.poll(() => capsuleKind(app)).toBe("cancelled");
  await call(app, "dismiss");
  await letTheQueueGo(app); // its turn comes: it finds itself stopped, and does nothing
  // Nothing was taken back and no run began, so the filing before it is still the last: the menu the tray holds offers it again.
  await expect.poll(() => trayOffersUndo(app), { timeout: 5_000 }).toBe(true);
  await pressUndo(app);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(2); // the filing before it was taken back, and the stopped thought's note was never filed
  expect(await undoCalls(app)).toBe(1);
  expect(await notified(app, "Undone")).toHaveLength(1);
  await app.close();
});

// Without git no filing is held for the menu's Undo (`lastFiled`), so the last receipt alone asks for the menu to be built again when a
// filing that waited leaves without a run (`leftWithoutRun`).
test("a Stop on a filing that still waits in the queue leaves the last receipt to show, in a library without git", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await hearing({}, library);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  expect(await trayOffersReceipt(app)).toBe(true);
  await holdTheQueue(app); // something else has the queue, so the next filing waits for its turn
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  expect(await trayOffersReceipt(app), "a filing waits").toBe(false);
  await capsule.evaluate(() => window.avanzel.capsule.cancelFiling()); // Stop: nothing has touched the note, so the card says Stopped at once
  await expect.poll(() => capsuleKind(app)).toBe("cancelled");
  await call(app, "dismiss");
  expect(await trayOffersReceipt(app), "the stopped filing still waits for its turn").toBe(false);
  await letTheQueueGo(app); // its turn comes: it finds itself stopped, and does nothing
  // Nothing was filed and no run began, so the last receipt is still the last: the menu the tray holds offers it again.
  await expect.poll(() => trayOffersReceipt(app), { timeout: 5_000 }).toBe(true);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Plant tulips in October", canUndo: false, reprint: { filedAt: expect.any(Number) } });
  await app.close();
});

test("a take-back of the last filing's commit, which is what Stop and Edit make, takes the menu's Undo away", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  expect(await undoItem(app)).toBeDefined();
  const commit = gitOut(library, "log", "--format=%H %s").split("\n").find((line) => line.includes(" avanzel: file "))?.split(" ")[0];
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  // The job whose outcome holds that commit is taken back by name, as `settleStop` and `refile` do.
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  expect(await call(app, "takeBack", { outcome: { commit } })).toBeNull();
  expect(undone(library)).toHaveLength(1);
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersUndo(app)).toBe(false);
  // The filing's receipt goes with it: what it printed is no longer so.
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(1);
  await app.close();
});

for (const showing of [true, false]) {
  test(`a Stop whose take-back git refuses leaves the filing standing, and the menu counts it, ${showing ? "told on the card" : "told by notification"}`, async () => {
    const stopRefused = "Stop couldn't take back a filing that had finished.";
    const library = await makeLibrary({ git: true });
    const { app } = await hearing({}, library);
    await watchUndos(app, { fail: true, hold: !showing }); // git can't run; with the card gone, the take-back waits at its door first
    await stopAtTheEnd(app);
    await dictate(app);
    // Stop came as the agent finished, and git could not take the filing back: it stands, and Stop says it couldn't.
    if (showing) {
      await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
      expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "error", message: stopRefused });
    } else {
      await expect.poll(() => reachedUndo(app), { timeout: 30_000 }).toBe(true);
      await call(app, "dismiss"); // the card goes while the take-back waits: only a notification can tell the refusal
      await app.evaluate(() => (globalThis as Left).letUndoIn?.());
      await expect.poll(async () => (await notified(app, stopRefused)).length, { timeout: 30_000 }).toBe(1);
      expect(await capsuleKind(app)).toBe("hidden");
    }
    await call(app, "idleForTests");
    expect(filesUnder(library, "ideas")).toHaveLength(1);
    // The run stopped before it counted its filing, and the take-back that was refused leaves it in the log: the menu reads it again,
    // and the menu the tray holds is built again for it, though a notification builds nothing.
    expect(await headOf(app)).toBe(`1 thought filed today. Evening review ${eveningWhen()}.`);
    expect((await heldMenu(app))[0]).toMatchObject({ label: `1 thought filed today. Evening review ${eveningWhen()}.` });
    expect((await recentOf(app)).map((item) => item.type === "item" && item.label)).toEqual(["Plant tulips in October"]);
    // A filing Stop stopped is none to undo from the menu.
    expect(await undoItem(app)).toBeUndefined();
    await app.close();
  });
}

test("Undo from the menu is offered for a thought that was edited and filed again", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({ FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() }, library);
  await watchUndos(app);
  await dictate(app);
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true); // the agent's first run is halfway
  await call(app, "edit"); // Edit stops it, and the editor opens
  expect(await capsuleKind(app)).toBe("editing");
  await expect.poll(() => gitOut(library, "log", "--format=%s"), { timeout: 30_000 }).toContain("avanzel: leftovers of"); // its edits, committed
  await call(app, "idleForTests"); // and its run is over
  expect(await undoItem(app)).toBeUndefined();
  await call(app, "submitEdit", "corrected words"); // File: the leftovers come out first, then the corrected words are filed
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  expect(await undoCalls(app)).toBe(1); // the take-back of the leftovers, which Edit asked for
  // The thought filed again is the last filing, and the menu takes that one back.
  expect(await undoItem(app)).toBeDefined();
  expect(await trayOffersUndo(app)).toBe(true);
  await pressUndo(app);
  expect(await undoCalls(app)).toBe(2);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true, text: "corrected words" });
  expect(undone(library)).toHaveLength(2); // the leftovers, and the filing of the corrected words
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1); // the corrected words wait in the inbox
  expect(await undoItem(app)).toBeUndefined();
  await app.close();
});

// ---------------------------------------------------------------- Show the last receipt, from the menu
//
// "Show the last receipt" puts the last filing's card up again, filed or noted, as a reprint: its stamp is still and dated the day it was
// filed, it makes no sound, and it counts as no filing (no face, no notification). The receipt lives with the Undo records
// (`undo-records.json`), so it outlasts a quit. It is offered while nothing is recording, filing or reviewing, and only over a finished card
// (or none): over a problem, the editor or a capture the item is not in the menu, and a press that reaches the controller anyway does
// nothing. It replaces a finished card. Its Undo is the menu's.

test("Show the last receipt reopens the last filing's card as a reprint, with its pages, Open and Undo", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await hearing({}, library);
  await stubOpening(app);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  expect(await trayOffersReceipt(app)).toBe(true);
  const [page] = filesUnder(library, "ideas");
  expect(page).toBeDefined();
  const told = await said(app);
  const head = await headOf(app);
  await expect.poll(() => faceOf(app), { timeout: 10_000, message: "the stamp the filing put on the face has worn off" }).toBe("idle");
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filed",
    text: "Plant tulips in October",
    canUndo: true,
    noted: false,
    reprint: { filedAt: expect.any(Number) },
    pages: [{ shelf: "ideas", created: true, path: `ideas/${page}` }],
  });
  const card = capsule.getByRole("article");
  const bar = capsule.getByRole("status");
  // Its stamp is Filed, with today's date (it was filed a moment ago), and it does not land.
  const stamp = card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true });
  await expect(stamp).toBeVisible();
  await expect(stamp).not.toHaveAttribute("data-animate");
  await expect(bar.getByText(/^Filed by fake in \d+ s$/)).toBeVisible();
  expect(await said(app), "a reprint tells nothing: the notifications are what the filing posted").toEqual(told);
  // It is no new filing: the face doesn't wear a stamp for it (`markFiled`), and the day's count is as it was.
  await sleep(500);
  expect(await faceOf(app)).toBe("idle");
  expect(await headOf(app)).toBe(head);
  // The page's title opens its page, and the card stays for the next title.
  await card.getByRole("button", { name: "Plant tulips in October", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", page ?? "")));
  expect(await capsuleKind(app)).toBe("filed");
  // Only the pages it lists open: another page of the library, which the filing did not write, opens nothing, as on the card of a filing.
  writeFileSync(path.join(library, "goals", "other.md"), "# Another goal\n");
  await capsule.evaluate(async () => {
    window.avanzel.capsule.openPage("goals/other.md");
    await window.avanzel.settings.get(); // the press has reached main by the time this answers
  });
  expect(await openedWith(app)).toHaveLength(1);
  // Open opens the first page, and puts the card away.
  await bar.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(2);
  expect(realpathSync((await openedWith(app))[1] ?? "")).toBe(realpathSync(path.join(library, "ideas", page ?? "")));
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  // Shown again, its Undo takes the filing back and the card says so, as the card of a filing does: no notification.
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("filed");
  await bar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 })
    .toMatchObject({ kind: "saved", undone: true, text: "Plant tulips in October", note: UNDONE_NOTE });
  expect(await said(app)).toEqual(told);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  // The filing is taken back: neither item is left, in the model or in the menu the tray holds.
  expect(await receiptItem(app)).toBeUndefined();
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  expect(await trayOffersUndo(app)).toBe(false);
  await app.close();
});

test("Show the last receipt survives a relaunch, and its Undo still takes the filing back and says so on the card", async () => {
  const library = await makeLibrary({ git: true });
  const first = await hearing({}, library);
  await filedFromTheCapsule(first.app);
  const saved = savedUndo(first.userData, library);
  expect(saved?.receipt).toMatchObject({ commit: saved?.filing, text: "Plant tulips in October", agent: "fake", noted: false, restored: false });
  await first.app.close();
  // Avanzel opens again with the same app data and the same library: the receipt is found in the library's history and offered.
  const { app } = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await watchUndos(app);
  await expect.poll(() => receiptItem(app), { timeout: 20_000 }).toEqual(RECEIPT_ITEM);
  expect(await trayOffersReceipt(app)).toBe(true);
  expect(savedUndo(first.userData, library), "found in the history: kept as it was").toEqual(saved);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filed",
    text: "Plant tulips in October",
    canUndo: true,
    reprint: { filedAt: saved?.receipt?.filedAt },
    pages: [{ path: saved?.receipt?.pages[0]?.path, created: true }],
  });
  // The card has no job of this app run, and its Undo takes the filing back all the same, and says so on the card.
  await call(app, "undo");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true, text: "Plant tulips in October", note: UNDONE_NOTE });
  expect(await notified(app, "Undone")).toEqual([]);
  expect(await undoCalls(app)).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await undoItem(app)).toBeUndefined();
  expect(savedUndo(first.userData, library), "taken back: nothing left to offer, and the library is out of the file").toBeUndefined();
  await app.close();
});

/**
 * A library whose agent files as the engine's fake one does and also writes `topics/side-note.md`, so that one filing writes two pages:
 * `ideas/idea-….md`, titled with the words, and the side note. It has no git, so the receipt has no Undo to get in the way.
 */
async function libraryWhoseFilingsWriteTwoPages(): Promise<string> {
  const library = await makeLibrary();
  const files = `'${process.execPath}' '${fakeAgent}' "$0"; code=$?; mkdir -p topics; printf '# Side note\\n' > topics/side-note.md; exit $code`;
  // `sh -c` gets the prompt as `$0`.
  saveSettings(library, { ...loadSettings(library), harnesses: { fake: { name: "fake", headless: ["/bin/sh", "-c", files, "{prompt}"], interactive: [] } } });
  return library;
}

// A receipt lasts for days and across restarts, and the person may have renamed, moved or deleted a page it lists since: its title and Open
// would open nothing, and Open puts the card away all the same. The reprint lists the pages that are there when it is chosen.
test("a reprint lists only the pages that are still there, and has no Open once every one is gone", async () => {
  const library = await libraryWhoseFilingsWriteTwoPages();
  const { app, capsule } = await hearing({}, library);
  await stubOpening(app);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  const [idea] = filesUnder(library, "ideas");
  expect(idea).toBeDefined();
  const listed = async () => ((await call(app, "capsuleStateForTests")) as { pages: { path: string }[] }).pages.map((page) => page.path);
  const card = capsule.getByRole("article");
  const bar = capsule.getByRole("status");
  const title = (name: string) => card.getByRole("button", { name, exact: true });
  const open = bar.getByRole("button", { name: "Open", exact: true });
  // Both pages are there: the card lists both.
  await showReceipt(app);
  expect(await listed()).toEqual([`ideas/${idea}`, "topics/side-note.md"]);
  await expect(title("Plant tulips in October")).toBeVisible();
  await expect(title("Side note")).toBeVisible();
  await call(app, "dismiss");
  // The first is deleted: the card lists the other, and Open opens that one and puts the card away.
  rmSync(path.join(library, "ideas", idea ?? ""));
  await showReceipt(app);
  expect(await listed()).toEqual(["topics/side-note.md"]);
  await expect(title("Side note")).toBeVisible();
  await expect(title("Plant tulips in October")).toHaveCount(0);
  await open.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "topics", "side-note.md")));
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  // The other is renamed: no page is left, and the card has no Open, as a filed card with no page has none. Hide is all its bar holds.
  renameSync(path.join(library, "topics", "side-note.md"), path.join(library, "topics", "renamed.md"));
  await showReceipt(app);
  expect(await listed()).toEqual([]);
  await expect(bar.getByRole("button", { name: "Hide", exact: true })).toBeVisible();
  await expect(title("Side note")).toHaveCount(0);
  await expect(open).toHaveCount(0);
  await app.close();
});

test("Show the last receipt hides while a recording, a filing or the editor is going, and with no receipt; it replaces a finished card, and over a problem or the editor it does nothing", async () => {
  // In a library with git: without it `lastFiled` is never held, and the first rebuild of a filing's start (B1) never happens.
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  // A new library has no receipt: no item, and a press does nothing.
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("hidden");
  await filedFromTheCapsule(app);
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  await call(app, "dismiss");
  // A recording hides it, in the model and in the menu the tray holds, and a press does nothing; it is back once the recording is given up.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "dismiss");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect.poll(() => receiptItem(app)).toEqual(RECEIPT_ITEM);
  await expect.poll(() => trayOffersReceipt(app)).toBe(true);
  // A finished card is replaced: over a Saved card the reprint shows, and goes by itself in the time a filed card does.
  await call(app, "setCapsule", { kind: "saved", text: "Call the plumber on Monday", note: "Saved to the inbox for the evening review at 21:00." });
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Plant tulips in October", reprint: { filedAt: expect.any(Number) } });
  await sleep(5_000);
  expect(await capsuleKind(app), "still up at 5 s").toBe("filed");
  await expect.poll(() => capsuleKind(app), { timeout: 15_000, message: "hidden by itself" }).toBe("hidden");
  // A problem with its fix is not replaced: the reprint would take the one fix away.
  await call(app, "setCapsule", { kind: "error", message: "Avanzel couldn't capture the screen.", detail: "Nothing was saved." });
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "error", message: "Avanzel couldn't capture the screen." });
  await call(app, "dismiss");
  // A transcription is a thought in flight, like a recording: the item is gone, and a press does nothing.
  await call(app, "setCapsule", { kind: "transcribing", mode: "dictate", onThisMac: true });
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("transcribing");
  await call(app, "dismiss");
  // A second filing hides it while its run goes on (the card says filing, and is not waiting: the run has begun), and a press changes nothing.
  await app.evaluate(() => void (process.env.FAKE_AGENT_DELAY_MS = "3000"));
  await dictate(app);
  await expect
    .poll(async () => {
      const state = (await call(app, "capsuleStateForTests")) as { kind: string; waiting?: boolean };
      return state.kind === "filing" && !state.waiting;
    }, { timeout: 30_000 })
    .toBe(true);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("filing");
  // The editor hides it too, though the menu is built again with the run stopped and the card gone: the words in it are the person's.
  await call(app, "edit");
  expect(await capsuleKind(app)).toBe("editing");
  await call(app, "refreshMenu");
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "editing", text: "Plant tulips in October" });
  await app.close();
});

// A problem's notice stays until the person acts on it, and a reprint would take its one fix away: so the item is not in the menu for as long
// as one is up, as Undo is not there when it can't act. `setCapsule` builds the menu for every card, so each kind takes the item away and
// gives it back; a press that reaches the controller anyway leaves the notice (`showLastReceipt`).
test("Show the last receipt is not offered over a problem notice, whichever it is, and is back once the notice goes", async () => {
  const library = await makeLibrary();
  const { app } = await hearing({}, library);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  for (const [name, notice] of [
    ["an error", { kind: "error", message: "Avanzel couldn't capture the screen.", detail: "Nothing was saved." }],
    ["the speech model's failed download", { kind: "model-failed", reason: "The speech model couldn't be downloaded.", resumable: true }],
    ["a shortcut another app holds", { kind: "shortcut-taken", key: "dictate", accelerator: "Alt+Space", holder: null, alternatives: [] }],
    ["the speech model's download", { kind: "preparing", receivedBytes: 1_000_000, totalBytes: 600_000_000 }],
  ] as const) {
    await call(app, "setCapsule", notice);
    expect(await receiptItem(app), name).toBeUndefined();
    expect(await trayOffersReceipt(app), `${name}, in the menu the tray holds`).toBe(false);
    await showReceipt(app);
    expect(await call(app, "capsuleStateForTests"), `${name}, after a press`).toEqual(notice);
    await call(app, "dismiss");
    await expect.poll(() => trayOffersReceipt(app), { message: `${name}, once it is put away` }).toBe(true);
    expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  }
  await app.close();
});

// A Stopped card is a finished card, except when it tells the person that the stopped run's edits stay (`partial`, `leftovers`): `settleStop`
// posts no notification while it is up, so it is the only place they are told, and a reprint would replace that.
test("Show the last receipt is not offered over a Stopped card that says edits stay, and is over one with nothing more to say", async () => {
  const library = await makeLibrary();
  const { app } = await hearing({}, library);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  const stopped = (partial: boolean, leftovers: number) => ({ kind: "cancelled", text: "Call the plumber on Monday", agent: "Claude Code", partial, leftovers, review: "at 21:00" });
  for (const [name, card] of [
    ["a commit of the stopped run that stays", stopped(true, 0)],
    ["two edits that no commit holds", stopped(false, 2)],
  ] as const) {
    await call(app, "setCapsule", card);
    expect(await receiptItem(app), name).toBeUndefined();
    expect(await trayOffersReceipt(app), `${name}, in the menu the tray holds`).toBe(false);
    await showReceipt(app);
    expect(await call(app, "capsuleStateForTests"), `${name}, after a press`).toEqual(card);
    await call(app, "dismiss");
  }
  // Nothing of the run stays: the card has nothing more to say, and the reprint replaces it.
  await call(app, "setCapsule", stopped(false, 0));
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  expect(await trayOffersReceipt(app)).toBe(true);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", text: "Plant tulips in October", reprint: { filedAt: expect.any(Number) } });
  await app.close();
});

// A Saved card with a line about its recording ("Only your words were kept: …", `detail`) is the one place the person is told what became
// of it, so it is not a finished card either (`showsFinishedCard`): no reprint replaces it, and nor does ⌥⇧Z's bar, which says there is
// no filing to undo (the library has no git, so a filing leaves a receipt and nothing to undo). Over a Saved card without the line, both act.
test("Show the last receipt and ⌥⇧Z's bar are not offered over a Saved card with a line about its recording, and are over one without", async () => {
  const library = await makeLibrary();
  const { app } = await hearing({}, library);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  const saved = (detail?: string) => ({ kind: "saved", text: "Call the plumber on Monday", note: "Saved to the inbox.", ...(detail ? { detail } : {}) });
  const withLine = saved("Only your words were kept: the recording couldn't be saved.");
  await call(app, "setCapsule", withLine);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app), "in the menu the tray holds").toBe(false);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests"), "after a press of the receipt").toEqual(withLine);
  expect(await call(app, "pressShortcutForTests", "undo")).toBe(true);
  expect(await call(app, "capsuleStateForTests"), "after ⌥⇧Z").toEqual(withLine);
  await call(app, "dismiss");
  // Without the line, the card has nothing more to say: the bar replaces it, and the receipt is offered over the bar too.
  await call(app, "setCapsule", saved());
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  await expect.poll(() => trayOffersReceipt(app), { message: "in the menu the tray holds" }).toBe(true);
  expect(await call(app, "pressShortcutForTests", "undo")).toBe(true);
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "nothing-to-undo" });
  expect(await receiptItem(app), "while the bar shows").toEqual(RECEIPT_ITEM);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", reprint: { filedAt: expect.any(Number) } });
  await app.close();
});

test("a reprint keeps the line that the person's exact words were kept, after a relaunch too", async () => {
  const library = await makeLibrary({ git: true });
  const first = await hearing({ FAKE_AGENT_MODE: "tamper" }, library); // files, then rewrites the capture: the engine puts the words back
  await filedFromTheCapsule(first.app);
  expect(await call(first.app, "capsuleStateForTests")).toMatchObject({ kind: "filed", restored: true });
  expect(savedUndo(first.userData, library)?.receipt).toMatchObject({ restored: true });
  await first.app.close();
  const { app, capsule } = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await expect.poll(() => receiptItem(app), { timeout: 20_000 }).toEqual(RECEIPT_ITEM);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", restored: true, reprint: { filedAt: expect.any(Number) } });
  await expect(capsule.getByRole("article").locator("header").getByText("Your exact words are kept.", { exact: true })).toBeVisible();
  await app.close();
});

test("a filing that fails leaves the last receipt as it was, without its Undo, and the next that ends well replaces it", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await filedFromTheCapsule(app);
  const [first] = filesUnder(library, "ideas");
  expect(first).toBeDefined();
  await agentMode(app, "fail");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  // The problem card is up: the menu doesn't offer the item, and a press that reaches the controller anyway leaves the card. The receipt is
  // the first filing's all the same, and the item is back with the notice gone.
  expect(await receiptItem(app)).toBeUndefined();
  await showReceipt(app);
  expect(await capsuleKind(app)).toBe("error");
  await call(app, "dismiss");
  await expect.poll(() => receiptItem(app)).toEqual(RECEIPT_ITEM);
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filed",
    text: "Plant tulips in October",
    canUndo: false, // the failed filing's run began, so the first is no longer the last: there is nothing for the menu to undo
    pages: [{ path: `ideas/${first}` }],
  });
  await call(app, "dismiss");
  // The next filing that ends well is the last one, and its receipt replaces the first's.
  await agentMode(app, "ok");
  await filedFromTheCapsule(app);
  const second = filesUnder(library, "ideas").find((name) => name !== first);
  expect(second).toBeDefined();
  await call(app, "dismiss");
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: true, pages: [{ path: `ideas/${second}` }] });
  await app.close();
});

// The reprint's Undo is the menu's (`undo`): while the menu's Undo of the same filing waits for the library, the reprint's does nothing and
// the take-back tells the reprint, once. 1d guards the regular card with the job's `undoing`; a reprint after a relaunch has no job.
for (const relaunched of [false, true]) {
  test(`the reprint's Undo answers once${relaunched ? ", after a relaunch" : ""}: while the menu's Undo of its filing waits for the library, it does nothing, and the reprint tells the take-back`, async () => {
    const library = await makeLibrary({ git: true });
    let launched = await hearing({}, library);
    await filedFromTheCapsule(launched.app);
    await call(launched.app, "dismiss");
    if (relaunched) {
      await launched.app.close();
      launched = await hearing({ AVANZEL_USER_DATA: launched.userData }, library);
      await expect.poll(() => receiptItem(launched.app), { timeout: 20_000 }).toEqual(RECEIPT_ITEM);
    }
    const { app } = launched;
    await watchUndos(app, { hold: true });
    await showReceipt(app);
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: true, reprint: { filedAt: expect.any(Number) } });
    const pressed = pressUndo(app);
    await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
    // The filing was taken before the take-back landed: the menu stops offering it, and its receipt, at once.
    expect(await undoItem(app)).toBeUndefined();
    expect(await receiptItem(app)).toBeUndefined();
    // The reprint's Undo finds its commit being taken back, and asks for nothing more: the card stays as it is.
    await call(app, "undo");
    expect(await undoCalls(app)).toBe(1);
    expect(await capsuleKind(app)).toBe("filed");
    await app.evaluate(() => (globalThis as Left).letUndoIn?.());
    await pressed;
    // The take-back that was in flight tells the reprint, once, and nothing else is said.
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true, text: "Plant tulips in October", note: UNDONE_NOTE });
    expect(await undoCalls(app)).toBe(1);
    expect(await notified(app, "Undone")).toEqual([]);
    expect(undone(library)).toHaveLength(1);
    await app.close();
  });
}

test("a reprint whose Undo the menu no longer offers says it can't be undone on the card, and its Undo never waits for ever", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app);
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  await showReceipt(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: true });
  // A review that writes ends the menu's Undo while the reprint, drawn before, still has its button: a press is a refusal on the card.
  await call(app, "clearLastFiled");
  expect(await undoItem(app)).toBeUndefined();
  await call(app, "undo");
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: UNDO_REFUSED.title, detail: UNDO_REFUSED.body });
  expect(await undoCalls(app)).toBe(0);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(await said(app)).toEqual([]);
  await app.close();
});

test("Undo from the menu rebuilds the menu twice, as in 1d, and takes the receipt in the first", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({}, library);
  await watchUndos(app, { hold: true });
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  expect(await receiptItem(app)).toEqual(RECEIPT_ITEM);
  await countCalls(app, "refreshMenu");
  const pressed = pressUndo(app);
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  // The first rebuild took the Undo and the receipt together: the menu the tray holds has neither while the take-back waits at the door.
  expect(await trayOffersUndo(app)).toBe(false);
  expect(await trayOffersReceipt(app)).toBe(false);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await calls(app, "refreshMenu")).toBeGreaterThanOrEqual(1);
  expect(await calls(app, "refreshMenu")).toBeLessThanOrEqual(2); // a tick() or broadcast() may land in it (filing.spec.ts allows one too)
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await pressed;
  // The take-back's end is the other: its notification builds nothing, so the menu is built again for what the revert left.
  expect(await calls(app, "refreshMenu")).toBeGreaterThanOrEqual(2);
  expect(await calls(app, "refreshMenu")).toBeLessThanOrEqual(3);
  expect(await notified(app, "Undone")).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(false);
  await app.close();
});

// Git can't run for a while, and a filing begins: the earlier filing is not the last any more, and the commit that was saved for it must not
// wait in the file for a launch that has git to offer (`clearLastFiled`). The filing that ends meanwhile left no commit (nothing can be
// committed), so nothing of its own overwrites the old one: only the clearing at its start takes it out. Its receipt replaces the old one.
test("a filing that begins while git can't run takes the earlier saved Undo out of the file, and its receipt replaces the earlier one", async () => {
  const library = await makeLibrary({ git: true });
  const first = await hearing({}, library);
  await filedFromTheCapsule(first.app);
  const saved = savedUndo(first.userData, library);
  expect(saved?.filing).toMatch(COMMIT);
  expect(saved?.receipt?.commit).toBe(saved?.filing);
  await first.app.close();
  const { app } = await hearing({ AVANZEL_USER_DATA: first.userData, AVANZEL_GIT_USABLE: "0" }, library);
  await expect.poll(() => undoChecked(app), { timeout: 20_000 }).toBe(true);
  expect(savedUndo(first.userData, library), "kept as it was: nothing is known of the history, and nothing is offered").toEqual(saved);
  await filedFromTheCapsule(app);
  const record = savedUndo(first.userData, library);
  expect(record?.filing ?? null, "the earlier filing's commit is out of the file").toBeNull();
  expect(record?.receipt).toMatchObject({ commit: null, text: "Plant tulips in October" });
  expect(record?.receipt?.pages[0]?.path).not.toBe(saved?.receipt?.pages[0]?.path);
  await app.close();
  // A launch that has git finds no Undo to offer, and shows the new filing's receipt, which has no Undo.
  const again = await hearing({ AVANZEL_USER_DATA: first.userData }, library);
  await expect.poll(() => undoChecked(again.app), { timeout: 20_000 }).toBe(true);
  expect(await undoItem(again.app)).toBeUndefined();
  expect(await receiptItem(again.app)).toEqual(RECEIPT_ITEM);
  await showReceipt(again.app);
  expect(await call(again.app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: false, pages: [{ path: record?.receipt?.pages[0]?.path }] });
  await again.app.close();
});

// The menu a filing's start builds is the last one until its run ends (the steps build none), so it has to hide the receipt already: with a
// filing held, `clearLastFiled` builds it with the queue empty, and a card that was put away before the turn came shows no filing (B1).
test("Show the last receipt stays out of the menu for the whole run of a filing whose card was put away before its turn", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "3000" }, library); // a run takes long enough to look at
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
  const [first] = filesUnder(library, "ideas");
  expect(await trayOffersReceipt(app)).toBe(true);
  await holdTheQueue(app); // the next thought waits for its turn
  await dictate(app);
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  await call(app, "dismiss"); // its card is put away while it waits: nothing shows a filing when its turn comes
  expect(await capsuleKind(app)).toBe("hidden");
  await letTheQueueGo(app);
  const runs = () => app.evaluate(() => (globalThis as unknown as { __avanzel: { runs: Map<unknown, unknown> } }).__avanzel.runs.size);
  await expect.poll(runs, { timeout: 30_000, intervals: [50] }).toBe(1); // its agent is running
  expect(await receiptItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app), "in the menu the tray holds").toBe(false);
  expect(await trayOffersUndo(app)).toBe(false);
  await call(app, "idleForTests");
  // It ended with a notification, and the receipt is its own.
  await expect.poll(() => trayOffersReceipt(app), { timeout: 10_000 }).toBe(true);
  await showReceipt(app);
  const second = filesUnder(library, "ideas").find((name) => name !== first);
  expect(second).toBeDefined();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: true, pages: [{ path: `ideas/${second}` }] });
  await app.close();
});

// A note filed in the background joins the queue with no card of its own, so nothing else builds the menu as it does; and with no filing held
// (`lastFiled`: the thought before it failed) its run's start builds none either (`clearLastFiled`). The menu the tray holds then offers the
// item for the whole run (`fileInBackground`).
test("Show the last receipt leaves the menu as a note filed in the background after a limit's reset joins the queue, and is back after it", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const { app } = await withClaude(bin, { AVANZEL_RESET_MARGIN_MS: "0" }); // a wait files its note at the reset itself
  await filedFromTheCapsule(app);
  // The next one meets Claude Code's usage limit, which lifts 5 seconds on. Its run began, so the first filing is no longer the last: there
  // is no filing to undo, and the receipt is still the first one's.
  answerAs(bin, "claude", limitedClaudeFor(bin, 5));
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await call(app, "dismiss"); // the notice takes the item away while it is up
  expect(await undoItem(app)).toBeUndefined();
  expect(await trayOffersReceipt(app)).toBe(true);
  await app.evaluate(() => void (process.env.FAKE_AGENT_DELAY_MS = "3000")); // the filing at the reset takes long enough to look at
  // At the reset the note joins the queue, and the menu the tray holds stops offering the item with it.
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).toBe("filing");
  expect(await trayOffersReceipt(app), "in the menu the tray holds").toBe(false);
  expect(await receiptItem(app)).toBeUndefined();
  await expect.poll(() => notified(app, "Filed by Claude Code"), { timeout: 30_000 }).toHaveLength(1);
  await call(app, "idleForTests");
  await expect.poll(() => trayOffersReceipt(app), { timeout: 10_000 }).toBe(true);
  await app.close();
});

for (const card of [
  { kind: "error", message: "Something else went wrong.", detail: "It has nothing to do with the speech model." },
  { kind: "shortcut-taken", key: "dictate", accelerator: "Alt+Space", holder: null, alternatives: [] },
] as const) {
  test(`choosing the speech model's problem in the menu leaves ${card.kind === "error" ? "an error card" : "a taken shortcut's notice"} that is not about it up`, async () => {
    const hub = await fakeModelHub("missing");
    const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
    await expect.poll(() => barOf(app), { timeout: 20_000 }).toMatchObject({ face: "needs-you", title: "" });
    expect((await settingsSnap(app)).model).toMatchObject({ kind: "error", cause: "download" });
    await call(app, "setCapsule", card);
    await call(app, "menuAction", "open-settings:voice");
    // Settings opens on Voice, where the fix is. The card is about something else, and stays.
    const settings = await windowFor(app, "settings");
    await expect(settings.getByRole("radio", { name: "Voice", exact: true })).toHaveAttribute("aria-checked", "true");
    expect(await call(app, "capsuleStateForTests")).toEqual(card);
    await app.close();
  });
}

// ---------------------------------------------------------------- a scheduled review asks before it runs, and shows how far it is

/** The words beside the review `id` in the menu now: the time it runs next, "Running…", or how far it is ("Filing 1 of 2"). */
async function detailOf(app: ElectronApplication, id = "evening-review"): Promise<string | undefined> {
  const item = (await menuOf(app)).find((candidate) => candidate.type === "item" && candidate.action === `task:${id}`);
  return item?.type === "item" ? item.detail : undefined;
}

/** When the review `id` last ran, in the library's run state: null before it has. */
const lastRun = async (app: ElectronApplication, id: string) => (await settingsSnap(app)).tasks.find((task) => task.id === id)?.lastRun ?? null;

/** What a review's next time reads as in the menu: today's, or tomorrow's once 21:00 has passed. */
const NEXT_EVENING = /^(Tomorrow )?21:00$/;

/** What one rebuild of the menu said of the evening review: the model's detail beside it, and the label of the item the tray holds. */
type ReviewSaid = { detail: string | undefined; held: string | undefined };

/**
 * From now on, notes what each rebuild of the tray's menu (`MenuBar.update`) says of the evening review (`reviewSeen`), beginning with
 * what it says now, so that no poll has to catch a count in the moment it shows.
 */
async function watchReview(app: ElectronApplication): Promise<void> {
  await call(app, "capsuleStateForTests");
  await app.evaluate(() => {
    type Item = { type: string; action?: string; detail?: string };
    type Bar = { menu: { items: { label: string }[] } | null; update(input: unknown, now?: Date): void };
    const controller = (globalThis as unknown as { __avanzel: { menuForTests(): Item[]; menuBar: Bar } }).__avanzel;
    const seen: ReviewSaid[] = [];
    const note = () => {
      const item = controller.menuForTests().find((candidate) => candidate.type === "item" && candidate.action === "task:evening-review");
      seen.push({ detail: item?.detail, held: controller.menuBar.menu?.items.find((held) => /^Evening review( \(|$)/.test(held.label))?.label });
    };
    Object.assign(globalThis, { reviewSeen: seen });
    note();
    const update = controller.menuBar.update.bind(controller.menuBar);
    controller.menuBar.update = (input, now) => {
      update(input, now);
      note();
    };
  });
}

const reviewSeen = (app: ElectronApplication) => app.evaluate(() => (globalThis as { reviewSeen?: ReviewSaid[] }).reviewSeen ?? []);

/** The list without a value that repeats the one before it: a rebuild for another reason says what was said already. */
const inARow = <T>(list: T[]): T[] => list.filter((value, at) => value !== list[at - 1]);

/** Once the review has said how it ended, waits for its run to be over and the menu to show its time again; returns what the menu said meanwhile. */
async function seenToTheEnd(app: ElectronApplication): Promise<ReviewSaid[]> {
  await reviewSaid(app);
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toMatch(NEXT_EVENING);
  return reviewSeen(app);
}

test("running a review from the menu asks first, and runs it only on Run Now", async () => {
  const { app, library } = await withNote("12");
  await answerDialogs(app, 1); // Cancel
  await call(app, "menuAction", "task:evening-review");
  expect(await dialogsAsked(app)).toEqual([
    {
      sheetOn: null, // the menu is no window to be a sheet on
      options: {
        type: "question",
        buttons: ["Run Now", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "Run “Evening review” now?",
        detail: "It runs with fake on your plan, so it may count toward your usage limit.",
      },
    },
  ]);
  // Cancel: nothing ran. The note waits in the inbox, the review never ran, and no review said anything.
  await call(app, "idleForTests");
  expect(await lastRun(app, "evening-review")).toBeNull();
  expect(await detailOf(app)).toMatch(NEXT_EVENING);
  expect(inbox(library)).toHaveLength(1);
  expect((await said(app)).filter((note) => note.title.startsWith("Evening review"))).toEqual([]);
  // Run Now: it runs, and was asked about once.
  await answerDialogs(app, 0);
  await call(app, "menuAction", "task:evening-review");
  expect(await dialogsAsked(app)).toHaveLength(1);
  expect(await reviewSaid(app)).toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
  expect(await lastRun(app, "evening-review")).not.toBeNull();
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("the question before a review names no agent where none can be named", async () => {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "auto" }); // whichever agent is installed, and this Mac has none
  const { app } = await launchOn(library, onlyAgentsIn(mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"))));
  await answerDialogs(app, 1);
  await call(app, "menuAction", "task:evening-review");
  const [asked, ...more] = await dialogsAsked(app);
  expect(more).toEqual([]);
  expect(asked?.options).toMatchObject({ message: "Run “Evening review” now?", detail: "It runs on your plan, so it may count toward your usage limit." });
  await app.close();
});

test("a review that is running isn't asked about", async () => {
  const { app } = await withNote("12", { FAKE_AGENT_DELAY_MS: "5000", FAKE_AGENT_DELAY_TASK: "file" }); // its filing holds the library for 5 s
  await call(app, "runTask", "evening-review");
  expect(await detailOf(app)).toMatch(/^(Running…|Filing 1 of 1)$/);
  await answerDialogs(app, 0);
  await call(app, "menuAction", "task:evening-review"); // its item stays in the menu while it runs: pressed, it does nothing
  expect(await dialogsAsked(app)).toEqual([]);
  expect(await reviewSaid(app)).toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
  expect(await dialogsAsked(app)).toEqual([]);
  await app.close();
});

test("Settings' Run now asks first, as a sheet on Settings, and runs the review only on Run Now", async () => {
  const { app } = await hearing();
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await answerDialogs(app, 1); // Cancel
  await weekly.getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => dialogsAsked(app)).toHaveLength(1);
  expect(await dialogsAsked(app)).toEqual([
    {
      sheetOn: "Avanzel Settings",
      options: {
        type: "question",
        buttons: ["Run Now", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "Run “Weekly review” now?",
        detail: "It runs with fake on your plan, so it may count toward your usage limit.",
      },
    },
  ]);
  // Cancel: the review did not run, and Settings still says it never has.
  await call(app, "idleForTests");
  expect(await lastRun(app, "weekly-review")).toBeNull();
  await expect(weekly.getByText("Not run yet.", { exact: true })).toBeVisible();
  // Run Now: it runs, and was asked about once.
  await answerDialogs(app, 0);
  await weekly.getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => lastRun(app, "weekly-review")).not.toBeNull();
  await call(app, "idleForTests");
  expect(await dialogsAsked(app)).toHaveLength(1);
  expect(await notified(app, "Weekly review is ready")).toHaveLength(1);
  await app.close();
});

test("a review that comes due on its schedule runs without asking", async () => {
  const { app, library, userData } = await withNote("12");
  await answerDialogs(app, 1); // were it asked, Cancel would stop it
  // Its schedule last found it two days ago: the next tick finds it due.
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  writeFileSync(path.join(userData, "run-state.json"), JSON.stringify({ [path.resolve(library)]: { checked: { "evening-review": twoDaysAgo } } }));
  await call(app, "tick");
  expect(await reviewSaid(app)).toMatchObject({ title: "Evening review: 1 thought filed" });
  await call(app, "idleForTests");
  expect(await lastRun(app, "evening-review")).not.toBeNull();
  expect(await dialogsAsked(app)).toEqual([]);
  await app.close();
});

test("a running review shows how far it is, and its time again once it ends", async () => {
  const library = await makeLibrary();
  new Vault(library).newCapture("First thought", { source: "text" });
  new Vault(library).newCapture("Second thought", { source: "text" });
  const { app } = await hearing({ FAKE_AGENT_STEP_MS: "500" }, library); // each filing takes a moment
  await watchReview(app);
  await call(app, "runTask", "evening-review");
  // Each capture counts as the review takes it up, and the item says so instead of "Running…".
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toBe("Filing 1 of 2");
  expect((await menuOf(app)).find((item) => item.type === "item" && item.action === "task:evening-review")).toMatchObject({ label: "Evening review", detail: "Filing 1 of 2" });
  const seen = await seenToTheEnd(app);
  const next = seen[0]?.detail ?? "";
  expect(next).toMatch(NEXT_EVENING);
  expect(inARow(seen.map((entry) => entry.detail))).toEqual([next, "Running…", "Filing 1 of 2", "Filing 2 of 2", next]);
  // The tray's menu was given the same, in parentheses (menuLabel).
  expect(inARow(seen.map((entry) => entry.held))).toEqual([
    `Evening review (${next})`,
    "Evening review (Running…)",
    "Evening review (Filing 1 of 2)",
    "Evening review (Filing 2 of 2)",
    `Evening review (${next})`,
  ]);
  // Run again, on an empty inbox: it begins with "Running…", not with the count the last run ended on.
  const before = seen.length;
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => (await notified(app, "Evening review")).length, { timeout: 30_000 }).toBe(1); // "Inbox was empty."
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toMatch(NEXT_EVENING);
  expect(inARow((await reviewSeen(app)).slice(before).map((entry) => entry.detail))).toEqual(["Running…", next]);
  await app.close();
});

test("a capture that arrives while the review runs is filed too, and the count rises to meet it", async () => {
  const library = await makeLibrary();
  new Vault(library).newCapture("First thought", { source: "text" });
  new Vault(library).newCapture("Second thought", { source: "text" });
  const { app } = await hearing({ FAKE_AGENT_STEP_MS: "500" }, library);
  await watchReview(app);
  await call(app, "runTask", "evening-review");
  await expect.poll(() => detailOf(app), { timeout: 30_000 }).toBe("Filing 1 of 2");
  new Vault(library).newCapture("Third thought", { source: "text" }); // the review reads the inbox again after each capture
  const seen = await seenToTheEnd(app);
  const next = seen[0]?.detail ?? "";
  expect(inARow(seen.map((entry) => entry.detail))).toEqual([next, "Running…", "Filing 1 of 2", "Filing 2 of 2", "Filing 3 of 3", next]);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("the count leaves out a thought the review leaves alone", async () => {
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app } = await hearing({ FAKE_AGENT_STEP_MS: "300" }, library);
  await watchReview(app);
  await holdTheQueue(app);
  await call(app, "runTask", "evening-review"); // waits for its turn
  await dictate(app); // the thought's note is in the inbox, and its own filing waits behind the review: the review leaves it to that
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
  await letTheQueueGo(app);
  const seen = await seenToTheEnd(app);
  const next = seen[0]?.detail ?? "";
  // Two notes waited when it began, and one of them was not its to file.
  expect(inARow(seen.map((entry) => entry.detail))).toEqual([next, "Running…", "Filing 1 of 1", next]);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed"); // the thought's own filing came after the review
  await app.close();
});

// A recording in the inbox is reported twice by the engine: transcribed, then filed under the name of its transcript. It is one capture.
for (const words of ["Plant tulips in October", ""]) {
  test(`a recording in the inbox counts once${words ? ", though the engine reports it twice" : ", and the note after it counts too, though it had no words"}`, async () => {
    const library = await makeLibrary();
    writeFileSync(path.join(library, "inbox", "2020-01-01-0000-recording.wav"), ""); // sorts before the note
    new Vault(library).newCapture("A note", { source: "text" });
    const { app } = await hearing({ FAKE_AGENT_STEP_MS: "500" }, library);
    // The speech model is no matter of this test: the engine's transcription is stood in for. The recording leaves the inbox for the
    // archive as it does, and its words (none, for a silent recording) become a capture of their own.
    await app.evaluate((_electron, spoken) => {
      type Made = { vault: { archive(file: string): string; newCapture(text: string, options: { source: string }): { path: string } }; captureAudio(audio: string): Promise<{ path: string } | null> };
      const controller = (globalThis as unknown as { __avanzel: { librarian(harness?: string): Promise<Made> } }).__avanzel;
      const librarian = controller.librarian.bind(controller);
      controller.librarian = async (harness) => {
        const made = await librarian(harness);
        made.captureAudio = async (audio) => {
          made.vault.archive(audio);
          return spoken ? made.vault.newCapture(spoken, { source: "audio" }) : null;
        };
        return made;
      };
    }, words);
    await watchReview(app);
    await call(app, "runTask", "evening-review");
    const seen = await seenToTheEnd(app);
    const next = seen[0]?.detail ?? "";
    expect(inARow(seen.map((entry) => entry.detail))).toEqual([next, "Running…", "Filing 1 of 2", "Filing 2 of 2", next]);
    expect(inbox(library)).toEqual([]);
    await app.close();
  });
}

test("a custom review is never asked about: it runs no agent, and only says it was skipped", async () => {
  // The library's agent is the stand-in `claude`, which notes each call it gets (`agentCalls`), and a note waits in the inbox: a review
  // that ran an agent would put a question to it.
  const bin = agentStubs({ claude: filingClaude() });
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude" });
  writeFileSync(path.join(library, "tasks", "standup.md"), STANDUP);
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app } = await hearing(onlyAgentsIn(bin), library);
  await answerDialogs(app, 1); // were it asked, Cancel would stop it
  const skipped = { title: "Standup", body: "Avanzel doesn't run custom reviews yet, so this one was skipped." };
  await call(app, "menuAction", "task:standup");
  await call(app, "idleForTests");
  expect(await dialogsAsked(app)).toEqual([]);
  expect(await notified(app, "Standup")).toEqual([skipped]);
  // Settings' Run now takes the same way.
  await call(app, "runTaskFromSettings", "standup");
  await call(app, "idleForTests");
  expect(await dialogsAsked(app)).toEqual([]);
  expect(await notified(app, "Standup")).toEqual([skipped, skipped]);
  // The agent was never called, and the note still waits.
  expect(await agentCalls(app)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a review is not run in a library other than the one the question named", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the libraries that open are remembered here, not in ~/.config
  const library = await makeLibrary();
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const { app } = await hearing({ XDG_CONFIG_HOME: config }, library);
  await answerDialogs(app, 0, { hold: true }); // Run Now, once the test lets the question be answered
  const pressed = call(app, "menuAction", "task:evening-review");
  try {
    await expect.poll(() => dialogsAsked(app)).toHaveLength(1);
    // The person opens another library while the question is up. It has an evening review of the same name, which they never asked for.
    const other = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
    await call(app, "createLibrary", other);
    expect((await settingsSnap(app)).library?.path).toBe(other);
  } finally {
    await letDialogsGo(app); // answered even when a check above fails, so the press ends and the app can close
  }
  await pressed;
  await call(app, "idleForTests");
  expect(await lastRun(app, "evening-review")).toBeNull();
  expect(await detailOf(app)).toMatch(NEXT_EVENING);
  expect((await said(app)).filter((note) => note.title.startsWith("Evening review"))).toEqual([]);
  expect(inbox(library)).toHaveLength(1); // nor was the first library's review run
  expect(await dialogsAsked(app)).toHaveLength(1);
  await app.close();
});

test("a review builds the menu once for each capture it counts, and at its start and its end", async () => {
  const library = await makeLibrary();
  new Vault(library).newCapture("First thought", { source: "text" });
  new Vault(library).newCapture("Second thought", { source: "text" });
  const { app } = await hearing({ FAKE_AGENT_STEP_MS: "300" }, library); // each filing takes its time
  await watchReview(app);
  await call(app, "runTask", "evening-review");
  const seen = await seenToTheEnd(app);
  // Its start builds the menu once, each of the two captures once, and its end once (the first entry is what the menu said before).
  // tick() builds it too, every minute, and one may land in these seconds; a build at each report or step would be a dozen.
  const builds = seen.length - 1;
  expect(builds).toBeGreaterThanOrEqual(4);
  expect(builds).toBeLessThanOrEqual(5);
  await app.close();
});

test("a note the review can't read still counts, though the engine reports nothing of it", async () => {
  const library = await makeLibrary();
  const locked = path.join(library, "inbox", "0-locked.md"); // sorts first
  writeFileSync(locked, "Can't be read");
  chmodSync(locked, 0o000); // the engine takes it up, can't read it to adopt it, and goes on to the next
  new Vault(library).newCapture("A note", { source: "text" });
  const { app } = await hearing({ FAKE_AGENT_STEP_MS: "500" }, library);
  try {
    await watchReview(app);
    await call(app, "runTask", "evening-review");
    const seen = await seenToTheEnd(app);
    const next = seen[0]?.detail ?? "";
    expect(inARow(seen.map((entry) => entry.detail))).toEqual([next, "Running…", "Filing 1 of 2", "Filing 2 of 2", next]);
  } finally {
    chmodSync(locked, 0o644);
  }
  await app.close();
});
