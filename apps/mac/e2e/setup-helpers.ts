// What the setup window's test files share. Each tests one stretch of the first run (setup-hello-found, setup-think,
// setup-filing, setup-spoken, setup-filed-ask and setup-ending), and every test launches it as a first run (firstRun): a
// new HOME, an empty Hugging Face cache, and only stand-in agents on PATH. A helper only one of them uses stays in its file.
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { SettingsSnapshot, SetupSnapshot } from "../src/shared/ipc.ts";
import { agentCalls, call, filesUnder, launch, throughFound, typeFirstThought } from "./helpers.ts";

/**
 * How many windows have `title` ("Set up Avanzel"), shown or not. A window has its title from the moment it is made, while its address is
 * "" until its page starts loading, so this counts one made a moment ago.
 */
export const windowsTitled = (app: ElectronApplication, title: string) =>
  app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === wanted).length, title);

/** How many Settings windows there are, shown or not: by the title it is made with, or by its page, which titles it for its pane once that has loaded. */
export const settingsWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === "Avanzel Settings" || w.webContents.getURL().includes("/renderer/settings/")).length);

/** Whether Avanzel shows its Dock icon now. */
export const dockShown = (app: ElectronApplication) => app.evaluate(({ app: electronApp }) => electronApp.dock?.isVisible() ?? false);

/** What the setup window is sent now. */
export const setupSnap = async (app: ElectronApplication) => (await call(app, "setupSnapshot")) as SetupSnapshot;

/** What Settings is sent now: which library is open. */
export const settingsSnap = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

/** The heading of the step after Found. */
export const THINK = "What's on your mind this week?";

/** The first-thought step's instruction, which holds Record a thought's shortcut. */
export const INSTRUCTION = /^Press .+, ramble for half a minute, then press it again\. I'll sort it out\.$/;

/** The nudge the first-thought step shows when no press of the shortcut arrives within the wait. */
export const NUDGE = /^Did .+ do nothing\?$/;

/** The install command Found shows for Codex when no agent is installed: the vendor's own, as its install docs give it. */
export const CODEX_INSTALL = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";

/** How the app has called the stand-in for `binary` so far, oldest first. */
export const callsTo = async (app: ElectronApplication, binary: string) => (await agentCalls(app)).filter((line) => line.startsWith(`${binary} `));

/** How far the setup step scrolls sideways: 0 while every line fits its width, a long path's included. */
export const sideways = (setup: Page) => setup.getByRole("main").evaluate((el) => el.scrollWidth - el.clientWidth);

/** From now on, notes the kind of every state sent to the capsule, for sentToCapsule. */
export async function watchCapsule(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const sent: string[] = [];
    (globalThis as { sentToCapsule?: string[] }).sentToCapsule = sent;
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:state") sent.push((args[0] as { kind: string }).kind);
      send(channel, ...args);
    };
  });
}

export const sentToCapsule = (app: ElectronApplication) => app.evaluate(() => (globalThis as { sentToCapsule?: string[] }).sentToCapsule ?? []);

/**
 * A press of Record a thought's shortcut: the callback it registered runs, as when the person presses the keys. Record
 * a thought in the menu (menuAction "dictate") and toggleDictate aren't presses of it.
 */
export const pressShortcut = (app: ElectronApplication) => call(app, "pressShortcutForTests", "dictate");

/**
 * The person reaches for the shortcut and doesn't press it: modifier `key`, as a keydown names it, goes down in the
 * setup window and comes back up. Only the shortcut's first modifier (⌥ for ⌥Space) starts the press test's wait.
 */
export async function reachFor(setup: Page, key: "Alt" | "Control" | "Shift" | "Meta"): Promise<void> {
  await setup.keyboard.down(key);
  await setup.keyboard.up(key);
}

/** Closes the setup window, as its red button does, and waits until it has gone. */
export async function closeSetup(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const open = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes("/renderer/setup/"));
    await Promise.all(open.map((w) => new Promise<void>((resolve) => {
      w.once("closed", () => resolve());
      w.close();
    })));
  });
}

/**
 * Stands in for Reduce Motion as main reads it (systemPreferences.getAnimationSettings): on, or off. A stand-in that
 * couldn't be put in place fails the test at once.
 */
export async function reduceMotion(app: ElectronApplication, on = true): Promise<void> {
  await app.evaluate(({ systemPreferences }, reduce) => {
    const real = systemPreferences.getAnimationSettings.bind(systemPreferences);
    const standIn: typeof systemPreferences.getAnimationSettings = () => ({ ...real(), prefersReducedMotion: reduce });
    systemPreferences.getAnimationSettings = standIn;
    if (systemPreferences.getAnimationSettings !== standIn) throw new Error("The Reduce Motion stand-in didn't take.");
  }, on);
}

/** The captures waiting in `library`'s inbox. */
export const inbox = (library: string) => filesUnder(library, "inbox");

/** Zel's mood on the stage. */
export const zel = (setup: Page) => setup.locator("svg[data-mood]");

/**
 * What the step's live regions hold now, in page order, the empty ones left out: what VoiceOver hears as each changes.
 * A Notice is one too.
 */
export const live = (setup: Page) =>
  setup.getByRole("main").locator('[role="status"], [role="alert"]').evaluateAll((regions) => regions.map((region) => region.textContent?.trim() ?? "").filter(Boolean));

/** A `claude` that is signed in, but whose filing fails: it prints `line` on stderr and exits 1, as a CLI does. */
export const failingClaude = (line: string) => `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else echo '${line}' >&2; exit 1; fi`;

/** The heading once the first thought is filed. */
export const FILED = /^All filed\. Claude Code took \d+ s\.$/;

/** The stage's shelf tabs, each read as its name and then its count, when it has one: "Ideas1". */
export const tabs = (setup: Page) => setup.locator('[data-shelf][data-variant="tab"]');

/** A first run launched with `env`, where "Plant tulips in October" is typed and filed: the app and its setup window, once filed. */
export async function filedFirstThought(env: Record<string, string>): Promise<{ app: ElectronApplication; setup: Page }> {
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  return { app, setup };
}
