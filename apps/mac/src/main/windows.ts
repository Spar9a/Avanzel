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

/** Wide enough for a recording's bar with its controls at full size (44 px buttons, 16 px words) and room at its ends. */
export const CAPSULE_SIZE = { width: 600, height: 320 };

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
 * Settings: an opaque window, as setup is, with the traffic lights inset over the page's drag strip and the panes'
 * toolbar under it. `pane`: the pane the page opens on, passed in its address (?pane=voice); without one it opens on
 * General. The height lets General show whole (its pane needs 557 px under the 87 px toolbar, so 644 would do): the pane it opens
 * on shouldn't need a scroll to reach its Startup switch. Another pane can scroll, down to the least height.
 */
export function createSettingsWindow(pane?: SettingsPane): BrowserWindow {
  const win = new BrowserWindow({
    width: 680,
    height: 660,
    minWidth: 640,
    minHeight: 440,
    show: false,
    title: "Avanzel Settings",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences,
  });
  void win.loadFile(pagePath("settings"), pane ? { query: { pane } } : undefined);
  return win;
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

export const PANEL_SIZE = { width: 520, height: 640 };

/**
 * The panel under the menu bar icon: Capture, Library and Settings. A popover macOS draws, with its material, corners and
 * shadow, as Quick is; it takes the keyboard, and hides when another window does (`Controller.showPanel`).
 */
export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    title: "Avanzel",
    frame: false,
    vibrancy: "popover",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    ...panelOptions(),
    type: "panel",
    webPreferences,
  });
  floatOverSpaces(win);
  void win.loadFile(pagePath("panel"));
  return win;
}

/**
 * Under the menu bar icon at `icon` (screen points), its middle under the icon's, kept inside the work area of the display the
 * icon is on with a little room at the edges. With no icon to go by (hidden, or no bounds), at the top right of the display
 * under the pointer.
 */
export function placePanel(win: BrowserWindow, icon: { x: number; y: number; width: number; height: number }): void {
  const [width] = win.getSize() as [number, number];
  const known = icon.width > 0 && icon.height > 0;
  const point = known ? { x: Math.round(icon.x + icon.width / 2), y: Math.round(icon.y + icon.height / 2) } : screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(point);
  const margin = 8;
  const centred = known ? point.x - width / 2 : workArea.x + workArea.width - width - margin;
  const x = Math.min(Math.max(centred, workArea.x + margin), workArea.x + workArea.width - width - margin);
  const y = known ? Math.max(workArea.y, icon.y + icon.height) + 4 : workArea.y + 4;
  win.setPosition(Math.round(x), Math.round(y));
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
