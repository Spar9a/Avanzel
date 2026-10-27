// What the specs of the capsule's cards share: how a card is read, and what the two Stopped cards show. Below those, what the specs of
// a filing's run (filing.spec.ts), of the problems it ends in (capsule-problems.spec.ts) and of its results (capsule-results.spec.ts) share:
// a library that Claude Code's stand-in files, dictating to it, and the wrappers that watch what the app sends and takes back.
import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { agentStubs, call, filesUnder, gitOut, launch, makeLibrary, onlyAgentsIn, speechWav, windowFor } from "./helpers.ts";
import { zel } from "./setup-helpers.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today as a stamp prints it, "27 Oct 2026" (the page words it with stampDate): the stamp's name carries it. */
export function stampDay(): string {
  const day = new Date();
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/**
 * The capsule's window as the system holds it: whether it is the key window (the one the keyboard types into: not the page's
 * `document.hasFocus()`, which a test can emulate), whether it can be, whether it is on screen, and where. The panel is the key window
 * only while the editor is open, and only on a Mac where the test app can be active at all: while the screen is locked (the front app
 * is loginwindow) no window of it is ever key, so `key` reads false there whatever the panel was told. `watchBlur` counts the telling.
 */
export const panelOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!win) throw new Error("There is no capsule window.");
    return { key: win.isFocused(), focusable: win.isFocusable(), visible: win.isVisible(), position: win.getPosition() };
  });

/** From now on, counts the times the app tells the capsule's window to give the keyboard up (`blur`, which `blurs` reads). */
export async function watchBlur(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!win) throw new Error("There is no capsule window to watch.");
    const blur = win.blur.bind(win);
    const seen = { count: 0 };
    Object.assign(globalThis, { capsuleBlurs: seen });
    win.blur = () => {
      seen.count += 1;
      blur();
    };
  });
}

export const blurs = (app: ElectronApplication) => app.evaluate(() => (globalThis as { capsuleBlurs?: { count: number } }).capsuleBlurs?.count ?? 0);

/** The names of `buttons`, in order: a button's label when it has only an icon, else its words. */
export const namesOf = (buttons: Locator) => buttons.evaluateAll((all) => all.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""));

/** The card and the bar fit the panel: the card is below its top and above the bar, and the bar is no lower than its bottom. */
export async function expectInPanel(capsule: Page): Promise<void> {
  const card = (await capsule.getByRole("article").boundingBox())!;
  const bar = (await capsule.getByRole("status").boundingBox())!;
  const panel = await capsule.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(card.y).toBeGreaterThanOrEqual(8);
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  expect(bar.y + bar.height).toBeLessThanOrEqual(panel.height);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(panel.width);
}

/** What a problem card says: its title; the lines of its body, each whole (a string) or matched (a regular expression); the label of its one fix; the part of the body set in code. */
export interface ProblemCard {
  title: string;
  lines?: (string | RegExp)[];
  fix?: string;
  command?: string;
}

/**
 * The capsule shows a problem: one notice in the `alert` role (Zel worried, and no card or bar with it), headed `title`, with the
 * lines of its body under it, and its buttons: Hide first, quiet, and then the fix when there is one, the moment's one primary. All
 * small, and the notice inside the panel. Returns the notice.
 */
export async function expectProblem(capsule: Page, { title, lines = [], fix, command }: ProblemCard): Promise<Locator> {
  const alert = capsule.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(capsule.getByRole("status")).toHaveCount(0);
  await expect(capsule.getByRole("article")).toHaveCount(0);
  await expect(alert.getByText(title, { exact: true })).toBeVisible();
  for (const line of lines) await expect(typeof line === "string" ? alert.getByText(line, { exact: true }) : alert.getByText(line)).toBeVisible();
  // A command is in the code face, as the windows set it, and nothing else is.
  if (command === undefined) await expect(alert.locator("code")).toHaveCount(0);
  else await expect(alert.locator("code")).toHaveText(command);
  await expect(zel(capsule)).toHaveAttribute("data-mood", "needs-you");
  const buttons = alert.getByRole("button");
  expect(await namesOf(buttons)).toEqual(fix === undefined ? ["Hide"] : ["Hide", fix]);
  await expect(buttons.first()).toHaveAttribute("data-variant", "quiet");
  if (fix !== undefined) await expect(buttons.last()).toHaveAttribute("data-variant", "primary");
  for (const button of await buttons.all()) await expect(button).toHaveAttribute("data-size", "small");
  const box = (await alert.boundingBox())!;
  const panel = await capsule.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(panel.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(panel.height);
  return alert;
}

/** The capsule shows a Stopped filing: "Stopped" in the bar, which offers Hide alone, over the words and `line`, what is safe. */
export async function expectStoppedFiling(capsule: Page, words: string, line: string): Promise<void> {
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await expect(bar.getByText("Stopped", { exact: true })).toBeVisible();
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText(words, { exact: true })).toBeVisible();
  await expect(card.getByText(line, { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped"); // a stopped filing is not stamped
  await expectInPanel(capsule);
}

/** The capsule shows a Stopped transcription: "Stopped" in the bar, which offers Hide alone, over a card with no words and `line`. */
export async function expectStoppedRecording(capsule: Page, line: string): Promise<void> {
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await expect(bar.getByText("Stopped", { exact: true })).toBeVisible();
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText("Recording", { exact: true })).toBeVisible();
  await expect(card.getByText("Your recording", { exact: true })).toBeVisible(); // the empty card's placeholder
  await expect(card.getByText(line, { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped");
  await expectInPanel(capsule);
}

// ---- Shared by filing.spec.ts, capsule-problems.spec.ts and capsule-results.spec.ts ----

export const inbox = (root: string) => filesUnder(root, "inbox");

export const archived = (root: string) => filesUnder(root, "raw").filter((rel) => rel.endsWith(".md")).map((rel) => path.join(root, "raw", rel));

/** What `claudeLibrary` takes: the limit of its runs, whether its evening review is on, and more variables to launch with. */
export type ClaudeLibraryOptions = { timeoutSeconds?: number; eveningReview?: boolean; env?: Record<string, string> };

/**
 * A library that Claude Code files, opened on a Mac whose only agents are the stand-ins in `bin`. `timeoutSeconds` is the
 * limit of its runs, `eveningReview` whether the library's evening review is on, and `env` more variables for the app.
 */
export async function claudeLibrary(bin: string, { timeoutSeconds = 30, eveningReview = true, env = {} }: ClaudeLibraryOptions = {}) {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude", timeoutSeconds });
  if (!eveningReview) {
    const file = path.join(library, "tasks", "evening-review.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("enabled: true", "enabled: false"));
  }
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    ...onlyAgentsIn(bin),
    ...env,
  });
  return { library, app, capsule: await windowFor(app, "capsule") };
}

/** Records "Plant tulips in October" and files it. */
export async function dictate(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
}

/** The file name of the note the capsule's failure card is about, which its button files again; null while it shows no such card. */
export async function cardNote(app: ElectronApplication): Promise<string | null> {
  const capture = (await call(app, "cardCaptureForTests")) as string | null;
  return capture === null ? null : path.basename(capture);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The notifications whose title is `title`, oldest first. */
export async function notified(app: ElectronApplication, title: string): Promise<{ title: string; body: string }[]> {
  return ((await call(app, "notificationsForTests")) as { title: string; body: string }[]).filter((note) => note.title === title);
}

/** One filing state sent to the capsule's page: how many rows it carried, and how many times the menu had been rebuilt by then. */
export type FilingSend = { rows: number; menus: number };

/** From now on, notes each filing state sent to the capsule's page (`filingSends`), and counts the menu's rebuilds. */
export async function watchFilingStates(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const controller = (globalThis as unknown as { __avanzel: { refreshMenu(): void } }).__avanzel;
    let menus = 0;
    const refreshMenu = controller.refreshMenu.bind(controller);
    controller.refreshMenu = () => {
      menus += 1;
      refreshMenu();
    };
    const sent: FilingSend[] = [];
    Object.assign(globalThis, { filingSends: sent });
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      const state = args[0] as { kind?: string; rows?: unknown[] } | undefined;
      if (channel === "capsule:state" && state?.kind === "filing") sent.push({ rows: state.rows?.length ?? 0, menus });
      send(channel, ...args);
    };
  });
}

export const filingSends = (app: ElectronApplication) => app.evaluate(() => (globalThis as { filingSends?: FilingSend[] }).filingSends ?? []);

/** The controller as the e2e tests reach it in the main process, with the parts these tests wrap: the librarian made for each run. */
export type Wrappable = {
  librarian(harness?: string): Promise<{ file(...args: unknown[]): Promise<unknown>; undo(...args: unknown[]): Promise<unknown> }>;
  cancelFiling(sender: unknown): void;
};

/** What the wrappers leave in the main process for a test to read or call. */
export type Left = {
  atTheEnd?: boolean;
  letItEnd?: () => void;
  atUndo?: boolean;
  letUndoIn?: () => void;
  undoCalls?: number;
  stepsOf?: (step: unknown) => void;
};

export const reachedUndo = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).atUndo === true);

export const undoCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as Left).undoCalls ?? 0);

/**
 * From now on, counts the take-backs the app asks the library for (`undoCalls`). With `hold`, each waits at its door (`atUndo`)
 * until the test lets it in (`letUndoIn`). With `fail`, each throws instead of taking anything back, as git does when it can't run.
 */
export async function watchUndos(app: ElectronApplication, { hold = false, fail = false } = {}): Promise<void> {
  await app.evaluate((_electron, { holding, failing }) => {
    const controller = (globalThis as unknown as { __avanzel: Wrappable }).__avanzel;
    const librarian = controller.librarian.bind(controller);
    Object.assign(globalThis, { undoCalls: 0 });
    controller.librarian = async (harness) => {
      const made = await librarian(harness);
      const undo = made.undo.bind(made);
      made.undo = async (...args) => {
        const kept = globalThis as { undoCalls?: number };
        kept.undoCalls = (kept.undoCalls ?? 0) + 1;
        if (holding) {
          Object.assign(globalThis, { atUndo: true });
          await new Promise<void>((resolve) => Object.assign(globalThis, { letUndoIn: resolve }));
        }
        if (failing) throw new Error("git could not run");
        return undo(...args);
      };
      return made;
    };
  }, { holding: hold, failing: fail });
}

/** `library`, opened by an app that hears "Plant tulips in October" and files with the engine's fake agent; `env` steers them. */
export async function launchOn(library: string, env: Record<string, string> = {}) {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    ...onlyAgentsIn(agentStubs()),
    ...env,
  });
  return { app, library, userData, capsule: await windowFor(app, "capsule") };
}

/** The commits that took a filing or its leftovers back, newest first. */
export const undone = (library: string) => gitOut(library, "log", "--format=%s").split("\n").filter((subject) => subject.startsWith("avanzel: undo"));
