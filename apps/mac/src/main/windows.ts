// The app's windows. All renderers are sandboxed and talk to main only through the preload bridge.
import { BrowserWindow, screen, type WebContents } from "electron";
import path from "node:path";
import { floatAbove, floatOverSpaces, panelOptions } from "./stage.ts";
import { fileURLToPath } from "node:url";
import type { SettingsPane } from "../shared/ipc.ts";

const DIST = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(DIST, "preload.js");
export const pagePath = (name: string) => path.join(DIST, "renderer", name, "index.html");

const webPreferences = {
  preload: PRELOAD,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
} as const;

/**
 * Whether `sender`, the page an IPC message came from (`event.sender`), is the page of `win`, an open window of ours. Every
 * window gets the same preload bridge, so a channel that belongs to one window can be sent from any: a channel that acts on
 * one window's own state answers only that window.
 */
export function isPageOf(sender: WebContents, win: BrowserWindow | null): boolean {
  return win !== null && !win.isDestroyed() && sender === win.webContents;
}

export const CAPSULE_SIZE = { width: 480, height: 300 };

/** A non-activating panel above the Dock: it never takes focus from the app you are typing in. */
export function createCapsuleWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...CAPSULE_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    ...panelOptions(),
    type: "panel",
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  floatAbove(win);
  floatOverSpaces(win);
  win.setIgnoreMouseEvents(true, { forward: true });
  void win.loadFile(pagePath("capsule"));
  return win;
}

/** Bottom-centre of the work area (above the Dock) on the display under the pointer. */
export function placeCapsule(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [width, height] = win.getSize() as [number, number];
  win.setPosition(Math.round(workArea.x + (workArea.width - width) / 2), Math.round(workArea.y + workArea.height - height));
}

/**
 * Settings: an opaque window of one width, as a macOS settings window is, with the traffic lights inset over the page's strip, which holds
 * the pane's name, and the panes' toolbar under it. The person doesn't size it: the page says what its pane needs (`settingsFrame`). `pane`:
 * the pane the page opens on, passed in its address (?pane=voice); without one it opens on the pane it showed last. The height here is
 * only what it starts from, and the page has fitted it before it first shows.
 */
export function createSettingsWindow(pane?: SettingsPane): BrowserWindow {
  const win = new BrowserWindow({
    width: 680,
    height: 660,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Avanzel Settings",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 14 },
    webPreferences,
  });
  void win.loadFile(pagePath("settings"), pane ? { query: { pane } } : undefined);
  return win;
}

/** Settings' height, whatever its pane asks: enough for a small pane to read as a window, and a long one (a long history) scrolls inside the most. */
const SETTINGS_HEIGHT = { least: 320, most: 800 };

/** A window's place and size on screen, or a display's work area. */
interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where Settings goes for a pane that needs `height` px: that high, within SETTINGS_HEIGHT and the screen. Its top stays where it is, as a macOS
 * settings window's does, unless its bottom would then go below the work area: then it moves up by what it needs, and no further.
 */
export function settingsFrame(now: Frame, workArea: Frame, height: number): Frame {
  const fitted = Math.round(Math.min(Math.max(height, SETTINGS_HEIGHT.least), SETTINGS_HEIGHT.most, workArea.height));
  const lowest = workArea.y + workArea.height - fitted;
  return { ...now, y: Math.max(workArea.y, Math.min(now.y, lowest)), height: fitted };
}

/**
 * Settings takes the height its page asks for, at once: macOS's animated resize would hold this process, and everything it does, for as long as it runs,
 * 230 to 350 ms for a pane. A height it already has moves nothing.
 */
export function fitSettings(win: BrowserWindow, height: number): void {
  const now = win.getBounds();
  const next = settingsFrame(now, screen.getDisplayMatching(now).workArea, height);
  if (next.y !== now.y || next.height !== now.height) win.setBounds(next);
}

/** The first run's window: one fixed size, the traffic lights inset over the page's drag strip. */
export function createSetupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 700,
    height: 480,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: "Set up Avanzel",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences,
  });
  void win.loadFile(pagePath("setup"));
  return win;
}

export const UP_HERE_SIZE = { width: 320, height: 200 };

/**
 * Zel's bubble under the menu bar icon, once setup has flown there: a see-through panel the page draws the bubble on,
 * at its top right (upHerePlace puts its tail under the icon). Like Quick, it takes focus, so Esc reaches it.
 */
export function createUpHereWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...UP_HERE_SIZE,
    show: false,
    title: "Avanzel",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    ...panelOptions(),
    type: "panel",
    webPreferences,
  });
  floatOverSpaces(win);
  void win.loadFile(pagePath("up-here"));
  return win;
}

/** The field is 44 px tall, with 12 px above and below it for its focus ring. */
export const QUICK_SIZE = { width: 640, height: 68 };

/**
 * Type a thought: a panel macOS draws, with its popover material, corners and shadow. Its page is clear and holds the
 * field.
 */
export function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...QUICK_SIZE,
    show: false,
    frame: false,
    vibrancy: "popover",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    ...panelOptions(),
    type: "panel",
    webPreferences,
  });
  floatOverSpaces(win);
  void win.loadFile(pagePath("quick"));
  return win;
}

/** A third of the way down the display under the pointer, like Spotlight. */
export function placeQuick(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [width] = win.getSize() as [number, number];
  win.setPosition(Math.round(workArea.x + (workArea.width - width) / 2), Math.round(workArea.y + workArea.height * 0.22));
}

export function createAskWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 700,
    height: 580,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: "Ask your library",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences,
  });
  void win.loadFile(pagePath("ask"));
  return win;
}
