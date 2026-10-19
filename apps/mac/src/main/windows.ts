// The app's windows. All renderers are sandboxed and talk to main only through the preload bridge.
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    alwaysOnTop: true,
    type: "panel",
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

export function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 780,
    height: 600,
    minWidth: 680,
    minHeight: 460,
    show: false,
    title: "Avanzel Settings",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences,
  });
  void win.loadFile(pagePath("settings"));
  return win;
}

export function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 660,
    height: 76,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: "panel",
    webPreferences,
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences,
  });
  void win.loadFile(pagePath("ask"));
  return win;
}
