// The menu bar icon: Zel's face and the title beside it show what Avanzel is doing (tray-state.ts). Every test reads what the
// controller last gave the menu bar (`trayForTests`) and what macOS was given (`nativeTitle`), and the tests of a count read the
// times of the changes too (`watchTray`), so no poll has to catch a face in the moment it shows.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import { dictate, launchOn, notified, sleep } from "./capsule-helpers.ts";
import {
  call,
  capsuleKind,
  closeModelHubs,
  emptyHfCache,
  fakeModelHub,
  filesUnder,
  filingClaude,
  firstRun,
  hfSnapshot,
  launch,
  makeLibrary,
  shown,
  speechWav,
  toDone,
  windowFor,
} from "./helpers.ts";
import { settingsSnap } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

/** What the menu bar shows (`face`, `title`) and the title macOS was given. */
type Bar = { face: string; title: string; nativeTitle: string };
/** A change of what the menu bar shows, and when it came. */
type Change = { face: string; title: string; at: number };

/** Every sample of the menu bar a test took: at the end, each must have given macOS the title the menu bar shows. */
const sampled: Bar[] = [];
test.beforeEach(() => {
  sampled.length = 0;
});
test.afterEach(() => {
  expect(
    sampled.filter((bar) => bar.nativeTitle !== bar.title),
    "macOS was given the title the menu bar shows, at every sample",
  ).toEqual([]);
});

/** The menu bar now. */
async function barOf(app: ElectronApplication): Promise<Bar> {
  const bar = (await call(app, "trayForTests")) as Bar;
  sampled.push(bar);
  return bar;
}

/** Just the face now, as a poll reads it. */
const faceOf = async (app: ElectronApplication) => (await barOf(app)).face;

/** Just the title now. */
const titleOf = async (app: ElectronApplication) => (await barOf(app)).title;

/**
 * From now on, notes each change of what the controller gives the menu bar (`MenuBar.show`) with the time it came, for `changes`.
 * A view shown again as it was is no change.
 */
async function watchTray(app: ElectronApplication): Promise<void> {
  await call(app, "capsuleStateForTests"); // the controller is there once this answers
  await app.evaluate(() => {
    type Shown = { face: string; title: string };
    const controller = (globalThis as unknown as { __avanzel: { menuBar: { show(view: Shown): void } } }).__avanzel;
    const changes: Change[] = [];
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

/** Runs the evening review, and returns once it has filed the note and said so. */
async function reviewed(app: ElectronApplication): Promise<void> {
  await call(app, "runTask", "evening-review");
  await expect.poll(() => notified(app, "Evening review: 1 thing filed"), { timeout: 60_000 }).toHaveLength(1);
  await call(app, "idleForTests");
}

/**
 * Stands in for Reduce Motion as main reads it (systemPreferences.getAnimationSettings): on, so the setup window just closes
 * and no window flies over this Mac's screen. A stand-in that couldn't be put in place fails the test at once.
 */
async function reduceMotion(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ systemPreferences }) => {
    const real = systemPreferences.getAnimationSettings.bind(systemPreferences);
    const standIn: typeof systemPreferences.getAnimationSettings = () => ({ ...real(), prefersReducedMotion: true });
    systemPreferences.getAnimationSettings = standIn;
    if (systemPreferences.getAnimationSettings !== standIn) throw new Error("The Reduce Motion stand-in didn't take.");
  });
}

/**
 * From now on, Zel's bubble stays up until `letTheBubbleGo`: a Mac that is busy, or that its owner is using, may take the focus
 * from it, and a window that loses the focus puts the bubble away, which is not what the test that reads the title beside it asks.
 * Not now and Esc press `closeUpHere` all the same, and wait here.
 */
async function holdTheBubble(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const setup = (globalThis as unknown as { __avanzel: { setup: { closeUpHere(): void } } }).__avanzel.setup;
    const closeUpHere = setup.closeUpHere.bind(setup);
    Object.assign(globalThis, { bubbleHeld: true });
    setup.closeUpHere = () => {
      if (!(globalThis as { bubbleHeld?: boolean }).bubbleHeld) closeUpHere();
    };
  });
}

const letTheBubbleGo = (app: ElectronApplication) => app.evaluate(() => Object.assign(globalThis, { bubbleHeld: false })).then(() => undefined);

/** The menu bar icon in the setup test, as AVANZEL_FAKE_TRAY_BOUNDS gives it: "x,y,width,height". */
const ICON = "1000,0,24,24";

test("the face listens and the title counts while recording, then it files, stamps and rests", async () => {
  const { app } = await hearing({ FAKE_AGENT_DELAY_MS: "2000", FAKE_AGENT_DELAY_TASK: "file" }); // the filing can be seen
  await watchTray(app);
  const since = Date.now();
  await call(app, "toggleDictate");
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "listening", title: expect.stringMatching(/^0:0[0-9]$/) });
  // After two seconds the count has moved on.
  await expect.poll(() => titleOf(app), { timeout: 10_000, intervals: [100] }).toMatch(/^0:0[2-9]$/);
  expect(await faceOf(app)).toBe("listening");
  await call(app, "toggleDictate"); // stop
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "filing", title: "" });
  await expect.poll(() => faceOf(app), { timeout: 30_000, intervals: [50] }).toBe("filed");
  await expect.poll(() => barOf(app), { timeout: 10_000, intervals: [100] }).toEqual({ face: "idle", title: "", nativeTitle: "" });

  const list = await changes(app);
  // One face after another, none left out, and none put in between (a flash of idle as the transcription hands over to the filing).
  expect(facesFrom(list, since)).toEqual(["listening", "filing", "filed", "idle"]);
  // The count began at 0:00 and went up a second at a time while the recording ran.
  const counted = list.filter((change) => change.at >= since && change.face === "listening").map((change) => change.title);
  expect(counted.slice(0, 3)).toEqual(["0:00", "0:01", "0:02"]);
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
  await call(app, "dismiss"); // Hide
  await expect.poll(() => barOf(app), { intervals: [50] }).toMatchObject({ face: "idle", title: "" });
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
  await expect.poll(() => notified(app, "Evening review: 1 thing filed"), { timeout: 60_000 }).toHaveLength(2);
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
