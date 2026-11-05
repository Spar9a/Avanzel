// The setup window's last step, Done, and the end of setup: opening at login, Start using Avanzel and its flight to the menu
// bar, Zel's bubble, and the milestones in first-run.json. Every test launches as a first run (firstRun).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { FirstRun } from "../src/main/store.ts";
import {
  call,
  capsuleKind,
  closeModelHubs,
  fakeModelHub,
  filingClaude,
  firstRun,
  launch,
  read,
  shown,
  snap,
  speechWav,
  throughFound,
  toDone,
  typeFirstThought,
  windowFor,
} from "./helpers.ts";
import { closeSetup, dockShown, filedFirstThought, reduceMotion, settingsSnap, settingsWindows, windowsTitled, zel } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

// You're all set: the last step. Entering it turns opening at login on, and its switches, opening at login, the library's evening
// review, apply at once, as Settings' own do. Start using Avanzel ends setup: the window closes, and Avanzel waits in the menu bar. With AVANZEL_TEST=1 the login setting is
// saved, and this Mac's login items are left be.

/**
 * Stands in for macOS's login items: from now on, each call that would change them is noted for `loginItemCalls`, and
 * none reaches this Mac. A stand-in that couldn't be put in place fails the test at once.
 */
async function stubLoginItems(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const calls: unknown[] = [];
    (globalThis as { loginItemCalls?: unknown[] }).loginItemCalls = calls;
    const standIn: typeof electronApp.setLoginItemSettings = (settings) => {
      calls.push(settings);
    };
    electronApp.setLoginItemSettings = standIn;
    if (electronApp.setLoginItemSettings !== standIn) throw new Error("The login items' stand-in didn't take.");
  });
}

const loginItemCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as { loginItemCalls?: unknown[] }).loginItemCalls ?? []);

/**
 * From now on, notes what the first switch to appear in `page` says as it is drawn: on Done, its opening at login, since
 * no step before it has a switch. For `firstSwitch`.
 */
async function watchFirstSwitch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const first = document.querySelector('[role="switch"]');
      if (!first) return;
      observer.disconnect();
      (window as { firstSwitch?: string | null }).firstSwitch = first.getAttribute("aria-checked");
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

const firstSwitch = (page: Page) => page.evaluate(() => (window as { firstSwitch?: string | null }).firstSwitch ?? null);

test("the last step turns on opening at login, and both switches apply at once", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  await stubLoginItems(app);
  await watchFirstSwitch(await windowFor(app, "setup"));
  const library = path.join(home, "Avanzel");
  expect((await settingsSnap(app)).app.launchAtLogin).toBe(false); // a new Mac's setting
  const setup = await toDone(app);
  await expect.poll(async () => (await settingsSnap(app)).app.launchAtLogin).toBe(true);
  const login = setup.getByRole("switch", { name: "Open Avanzel when I log in" });
  await expect(login).toHaveAttribute("aria-checked", "true");
  // On from the moment it is drawn: it never shows off, then slides on by itself.
  expect(await firstSwitch(setup)).toBe("true");
  await login.click();
  await expect.poll(async () => (await settingsSnap(app)).app.launchAtLogin).toBe(false);
  await expect(login).toHaveAttribute("aria-checked", "false");
  // Only the step's first showing in a session turns it on: showing it again leaves the person's choice be.
  await call(app, "enterSetupStep", "done");
  expect((await settingsSnap(app)).app.launchAtLogin).toBe(false);
  // The library's evening review, as a new library has it: every day at 21:00, and on.
  const review = setup.getByRole("switch", { name: "Review my inbox every day at 21:00" });
  await expect(review).toHaveAttribute("aria-checked", "true");
  await expect(review).toHaveAccessibleDescription("Files anything still in the inbox and writes a short summary.");
  await review.click();
  await expect.poll(() => read(library, "tasks/evening-review.md")).toContain("enabled: false");
  await expect(review).toHaveAttribute("aria-checked", "false");
  // A library without an evening review has no switch for it: here its file goes, and the next change redraws the step.
  rmSync(path.join(library, "tasks", "evening-review.md"));
  await login.click();
  await expect(login).toHaveAttribute("aria-checked", "true");
  await expect(setup.getByRole("switch")).toHaveCount(1); // opening at login alone
  await expect(setup.getByRole("switch", { name: "Play sounds" })).toHaveCount(0);
  // None of it reached this Mac's login items.
  expect(await loginItemCalls(app)).toEqual([]);
  await app.close();
});

test("Start using Avanzel closes the window, and the menu bar is where Avanzel lives", async () => {
  // With the menu bar icon hidden (empty bounds) the window just closes, with no flight and no bubble, so this test
  // doesn't depend on where this Mac's own menu bar icon is. AVANZEL_FAKE_TRANSCRIPT stands in for a speech model
  // that is ready.
  const app = await launch({
    ...firstRun({ claude: filingClaude() }).env,
    AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0",
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
  });
  const setup = await toDone(app);
  // The step says how to talk to Avanzel and where it waits, beside Zel at rest, looking at the step. Start using
  // Avanzel is its one primary, and there is no Back.
  await expect(setup.getByText(/^Press ⌥Space anywhere to talk to me\. I'll wait in the menu bar\.$/)).toBeVisible();
  await expect(setup.getByText(/My ears|type a thought/)).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  await expect(zel(setup)).toHaveAttribute("data-look", "right");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Start using Avanzel"]);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect.poll(() => dockShown(app)).toBe(true);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  // Closed, not hidden away: the session has ended with its window, and the Dock icon went with it.
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  expect(await call(app, "setupStepForTests")).toBeNull();
  await expect.poll(() => dockShown(app)).toBe(false);
  const menu = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(menu).toContainEqual(expect.objectContaining({ type: "item", label: "Record a thought", action: "dictate" }));
  // Opening Avanzel again opens Settings now, as it does once there is a library, rather than setup.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  expect(await settingsWindows(app)).toBe(1);
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(0);
  await app.close();
});

// The milestones of a first run, which setup keeps in first-run.json in Avanzel's own data folder (§5.4's measures).
// They stay on this Mac: nothing reports them.

/** What setup has noted in first-run.json, in the data folder `userData` an app was launched with. */
function firstRunNotes(userData: string): FirstRun {
  return JSON.parse(readFileSync(path.join(userData, "first-run.json"), "utf8")) as FirstRun;
}

test("a finished setup leaves its milestones in first-run.json", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  // With the menu bar icon hidden (empty bounds) the window just closes: no flight, no bubble on this Mac's menu bar.
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_USER_DATA: userData, AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  // Closed, not just hidden: the session has ended, and ending it did not note a close.
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => call(app, "setupStepForTests"), { timeout: 10_000 }).toBeNull();
  const noted = firstRunNotes(userData);
  expect(Object.keys(noted.steps)).toEqual(["hello", "found", "think", "filing", "ask", "done"]);
  expect(noted).toMatchObject({ version: 1, undone: false, closedOn: null });
  // Each time is when it happened, in ISO form, and they come in the order of the walk.
  const times = [
    noted.firstLaunchAt, noted.steps.hello, noted.steps.found, noted.steps.think, noted.steps.filing,
    noted.firstFiledAt, noted.steps.ask, noted.steps.done, noted.finishedAt,
  ];
  for (const time of times) expect(time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(times).toEqual([...times].sort());
  await app.close();
});

test("Undo, and closing the window before the end, are noted in first-run.json", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, AVANZEL_USER_DATA: userData });
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await closeSetup(app);
  const noted = firstRunNotes(userData);
  expect(Object.keys(noted.steps)).toEqual(["hello", "found", "think", "filing"]);
  expect(noted.firstFiledAt).not.toBeNull(); // it was filed, and then undone
  expect(noted).toMatchObject({ undone: true, finishedAt: null, closedOn: "filing" });
  await app.close();
});

test("a thought filed after the window was closed is the first filed thought all the same", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env } = firstRun({ claude: filingClaude() });
  const slow = { FAKE_AGENT_DELAY_MS: "3000", FAKE_AGENT_DELAY_TASK: "file" }; // the agent takes 3 s to file
  const app = await launch({ ...env, AVANZEL_USER_DATA: userData, ...slow });
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await closeSetup(app);
  await call(app, "idleForTests");
  const noted = firstRunNotes(userData);
  expect(noted.firstFiledAt).not.toBeNull();
  expect(noted).toMatchObject({ finishedAt: null, closedOn: "filing" });
  await app.close();
});

// The ending: Start using Avanzel flies the blank setup window onto the menu bar icon, then Zel says it's up there in a
// bubble under the icon. AVANZEL_FAKE_TRAY_BOUNDS stands in for the icon's place, and `reduceMotion` for the Reduce
// Motion main reads, so neither the flight nor the bubble depends on this Mac's own menu bar or settings.

/** The menu bar icon in these tests, as AVANZEL_FAKE_TRAY_BOUNDS gives it: "x,y,width,height". */
const ICON = "1000,0,24,24";

/** A first run whose microphone hears "hello" as "Call the vet on Monday", with the menu bar icon at ICON. */
const endingRun = (): Record<string, string> => ({
  ...firstRun({ claude: filingClaude() }).env,
  AVANZEL_FAKE_AUDIO: speechWav("hello"),
  AVANZEL_FAKE_TRANSCRIPT: "Call the vet on Monday",
  AVANZEL_FAKE_TRAY_BOUNDS: ICON,
});

/**
 * From now on, notes each frame the setup window is given (setBounds), and whether macOS animates it, for `flights`;
 * and when the last one landed and when the window was told to close, for `flightTimes`. With `holdClose`, the window
 * closes that many ms after it is told to, so a test can read what it showed as it flew.
 */
async function watchFlight(app: ElectronApplication, holdClose = 0): Promise<void> {
  await app.evaluate(({ BrowserWindow }, hold) => {
    const setup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!setup) throw new Error("There is no setup window to watch.");
    const flights: unknown[] = [];
    const times: { landed?: number; closed?: number } = {};
    Object.assign(globalThis, { flights, flightTimes: times });
    const setBounds = setup.setBounds.bind(setup);
    setup.setBounds = (bounds, animate) => {
      flights.push({ bounds, animate: animate === true });
      setBounds(bounds, animate); // with animate, macOS returns once the frame has landed
      times.landed = Date.now();
    };
    const close = setup.close.bind(setup);
    setup.close = () => {
      times.closed = Date.now();
      if (hold) setTimeout(close, hold);
      else close();
    };
  }, holdClose);
}

const flights = (app: ElectronApplication) => app.evaluate(() => (globalThis as { flights?: unknown[] }).flights ?? []);

const flightTimes = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { flightTimes?: { landed?: number; closed?: number } }).flightTimes ?? {});

/** Where the bubble's window is, and the work area of the display that holds the icon. */
const bubblePlace = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const bubble = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/up-here/"));
    return { bounds: bubble?.getBounds() ?? null, work: screen.getDisplayMatching({ x: 1000, y: 0, width: 24, height: 24 }).workArea };
  });

test("Start using Avanzel flies the window to the menu bar, Zel says it's up there, and Try it now records", async () => {
  const app = await launch(endingRun());
  const setup = await toDone(app);
  await reduceMotion(app, false);
  await watchFlight(app, 1_500); // the window stays a moment after the flight, for the test to see what flew
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  // The window flies with Zel alone in its middle, looking up where it goes: no step, and no blank page.
  await expect(setup.getByRole("main")).toHaveCount(0);
  await expect(zel(setup)).toHaveCount(1);
  await expect(zel(setup)).toHaveAttribute("data-look", "up");
  // It flew: macOS animated its frame onto a 24 px square centred on the icon, and the window was closed the moment it
  // landed, with no wait for the rest of a set time.
  await expect.poll(async () => (await flightTimes(app)).closed ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  const { landed = 0, closed = 0 } = await flightTimes(app);
  expect(landed).toBeGreaterThan(0);
  expect(closed - landed).toBeLessThan(100);
  expect(await flights(app)).toEqual([{ bounds: { x: 1000, y: 0, width: 24, height: 24 }, animate: true }]);
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  const bubble = await windowFor(app, "up-here");
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  await expect(bubble.getByText("⌥Space", { exact: true })).toBeVisible();
  await expect(bubble.getByText(/^Press ⌥Space anywhere, say what's on your mind, and press it again\.$/)).toBeVisible();
  await expect(bubble.locator('button[data-variant="primary"]')).toHaveText(["Try it now"]);
  // Its tail's tip, 42 px in from the window's right edge, is under the icon's centre (x 1012), and the window's top is
  // the top of the work area, under the menu bar. This display is wider than 1054 pt, so nothing moves it back in.
  const { bounds, work } = await bubblePlace(app);
  expect(bounds).toEqual({ x: 1012 + 42 - 320, y: Math.max(work.y, 24), width: 320, height: 200 });
  await bubble.getByRole("button", { name: "Try it now" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  await call(app, "cancelRecording");
  await app.close();
});

test("while the speech model isn't ready, Done and Zel's bubble offer typing, not talking", async () => {
  // No speech model here (its download fails), and nothing stands in for one.
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_FAKE_TRAY_BOUNDS: ICON });
  const setup = await toDone(app);
  // Done says the ears aren't here, as the first-thought step does, and how to type a thought from anywhere.
  const ears = "The speech model didn't finish downloading, so I can't hear you yet. Type it instead, or try the download again.";
  await expect(setup.getByText(ears, { exact: true })).toBeVisible();
  await expect(setup.getByText(/^Press ⌥⇧Space anywhere to type a thought\. I'll wait in the menu bar\.$/)).toBeVisible();
  await expect(setup.getByText(/anywhere to talk to me/)).toHaveCount(0);
  await snap(setup, "setup-done-no-ears");
  await reduceMotion(app, true); // it just closes: no flight on this Mac's screen
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  // The bubble says the download failed too, not that the ears are on their way, and its primary types a thought:
  // Quick opens, and nothing records.
  const bubble = await windowFor(app, "up-here");
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  await expect(
    bubble.getByText(
      "The speech model didn't finish downloading, so I can't hear you yet. Type a thought meanwhile, or try the download again in Settings → Voice.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(bubble.getByText(/still arriving/)).toHaveCount(0);
  await expect(bubble.locator('button[data-variant="primary"]')).toHaveText(["Type a thought"]);
  await expect(bubble.getByRole("button", { name: "Try it now" })).toHaveCount(0);
  await snap(bubble, "up-here-no-ears");
  await bubble.getByRole("button", { name: "Type a thought" }).click();
  const quickOpened = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes("/renderer/quick/")));
  await expect.poll(quickOpened).toBe(true);
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("while the speech model is on its way and ⌥⇧Space is another app's, Done and the bubble point to the menu bar", async () => {
  // The download stays in progress, and another app holds Type a thought's shortcut, so it didn't register.
  const hub = await fakeModelHub("stall");
  const app = await launch({
    ...firstRun({ claude: filingClaude() }).env,
    AVANZEL_MODELS_URL: hub.url,
    AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Shift+Space",
    AVANZEL_FAKE_TRAY_BOUNDS: ICON,
  });
  const setup = await toDone(app);
  await expect(setup.getByText("My ears are still arriving. Type it instead, or talk to me once they land.", { exact: true })).toBeVisible();
  await expect(setup.getByText("Choose Type a thought… in the menu bar to type one. I'll wait there.", { exact: true })).toBeVisible();
  await expect(setup.getByText(/⌥⇧Space/)).toHaveCount(0);
  // The menu bar's item it names is there.
  const menu = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(menu).toContainEqual(expect.objectContaining({ type: "item", label: "Type a thought…", action: "type" }));
  await reduceMotion(app, true);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  const bubble = await windowFor(app, "up-here");
  await expect(bubble.getByText(/^My ears are still arriving\. Choose Type a thought… in the menu bar to type one\.$/)).toBeVisible();
  await expect(bubble.getByText(/⌥⇧Space/)).toHaveCount(0);
  await app.close();
});

test("Not now and Esc put the bubble away", async () => {
  test.setTimeout(180_000); // two first runs, each walked to the end
  for (const dismiss of ["Not now", "Esc"] as const) {
    const app = await launch(endingRun());
    const setup = await toDone(app);
    await setup.getByRole("button", { name: "Start using Avanzel" }).click();
    const bubble = await windowFor(app, "up-here");
    await expect.poll(() => shown(app, "up-here")).toBe(true);
    if (dismiss === "Not now") await bubble.getByRole("button", { name: "Not now" }).click();
    else await bubble.keyboard.down("Escape"); // the bubble goes at once, before the key comes back up
    await expect.poll(() => shown(app, "up-here"), { message: dismiss }).toBe(false);
    expect(await capsuleKind(app)).toBe("hidden"); // and nothing records
    await app.close();
  }
});

test("under Reduce Motion the window just closes, Zel still says it's up there, and a click elsewhere puts it away", async () => {
  const app = await launch(endingRun());
  const setup = await toDone(app);
  await reduceMotion(app, true);
  await watchFlight(app);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  expect(await flights(app)).toEqual([]); // it closed where it was
  const bubble = await windowFor(app, "up-here");
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  // A click elsewhere takes the focus from it, and macOS tells its window so (blur). The app under test may not be this
  // Mac's active app, which would have no focus to lose, so the test tells the window itself.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/up-here/"))?.emit("blur");
  });
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  await app.close();
});

test("with the menu bar icon hidden, the window just closes, and no bubble points at it", async () => {
  const app = await launch({ ...endingRun(), AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  await reduceMotion(app, false);
  await watchFlight(app);
  // The bubble's window is titled "Avanzel", and so is the capsule's, which has no title of its own but the app's name.
  const titled = await windowsTitled(app, "Avanzel");
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  expect(await flights(app)).toEqual([]);
  // A bubble is made as the window closes, if at all: none was.
  expect(await windowsTitled(app, "Avanzel")).toBe(titled);
  // Opening Avanzel again finds it: Settings, now that there is a library.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  expect(await settingsWindows(app)).toBe(1);
  await app.close();
});

test("Start using Avanzel closes the window even when its flight fails, and no bubble opens while Avanzel quits", async () => {
  test.setTimeout(180_000); // two first runs, each walked to the end
  // The flight fails: macOS refuses the window's new frame.
  const app = await launch(endingRun());
  const setup = await toDone(app);
  await reduceMotion(app, false);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!win) throw new Error("There is no setup window.");
    win.setBounds = () => {
      throw new Error("The window server refused the frame.");
    };
  });
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  expect(await call(app, "setupStepForTests")).toBeNull();
  // It closed where it was, as under Reduce Motion, and Zel still says it's up there.
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  await app.close();
  // Avanzel is quitting as Start using Avanzel is pressed: the window closes, and no bubble opens on the way out.
  const quitting = await launch(endingRun());
  const done = await toDone(quitting);
  await reduceMotion(quitting, true);
  const titled = await windowsTitled(quitting, "Avanzel");
  await quitting.evaluate(({ app: electronApp }) => electronApp.emit("before-quit", { preventDefault: () => {} }));
  await done.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => windowsTitled(quitting, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 1_000)); // a bubble opens as the window closes, if at all
  expect(await windowsTitled(quitting, "Avanzel")).toBe(titled);
  await quitting.close();
});

test("a development run saves opening at login, but leaves this Mac's login items be", async () => {
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  await stubLoginItems(app);
  // This run's app is node_modules' Electron.app, not a packaged Avanzel. For the switch's change, AVANZEL_TEST (which
  // keeps login items be in every test) is gone, as outside the tests; the stand-in still keeps this Mac's own be.
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(false);
  await app.evaluate(() => {
    delete process.env.AVANZEL_TEST;
  });
  try {
    await setup.getByRole("switch", { name: "Open Avanzel when I log in" }).click();
    await expect.poll(async () => (await settingsSnap(app)).app.launchAtLogin).toBe(false);
  } finally {
    await app.evaluate(() => {
      process.env.AVANZEL_TEST = "1";
    });
  }
  expect(await loginItemCalls(app)).toEqual([]);
  await app.close();
});
