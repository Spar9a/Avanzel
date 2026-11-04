// Avanzel for Mac: a menu-bar app. No main window, and no Dock icon except while setup is open.
import { app, Menu, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Controller } from "./controller.ts";
import { registerIpc } from "./ipc.ts";
import { loginShellPath, widenedPath } from "./shell-path.ts";

const DIST = path.dirname(fileURLToPath(import.meta.url));
process.env.AVANZEL_TEMPLATES ??= path.join(DIST, "templates");
process.env.AVANZEL_ASSETS ??= path.join(DIST, "engine-assets");
delete process.env.ELECTRON_RUN_AS_NODE;
// The tests' first runs keep PATH exactly as given (AVANZEL_EXACT_PATH), so no agent CLI of this Mac's own is found.
if (!(process.env.AVANZEL_TEST === "1" && process.env.AVANZEL_EXACT_PATH === "1")) {
  process.env.PATH = widenedPath(process.env.PATH ?? "", process.env.AVANZEL_TEST === "1" ? null : loginShellPath());
}
if (process.env.AVANZEL_USER_DATA) app.setPath("userData", process.env.AVANZEL_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: Controller | null = null;
  // The safe stop before quitting: begun by the first quit that finds an agent run, an edit or queued work to stop (`stopping`),
  // and over once it has ended and quits for good (`stopped`).
  let stopping = false;
  let stopped = false;
  // Opening Avanzel again (Spotlight, Finder) brings its own window forward: setup while it is open or there is no
  // library, else Settings.
  app.on("second-instance", () => controller?.showHome());
  app.on("window-all-closed", () => {
    // Stay in the menu bar when setup, Settings or Ask close.
  });
  // An agent still running when Avanzel quits is stopped first, and its run's bookkeeping finished:
  // otherwise it would go on editing the library unguarded, and its edits would never be undoable.
  // An agent check is stopped too, but never waited for; stopForQuit stops them when it runs.
  // Every quit asked while that stop waits (the menu's Quit, ⌘Q, Quit and reopen) waits with it: the first quit's choice stands,
  // and the quit the stop ends with is the one that goes through.
  // The cursor helper is a process of its own: it is ended with Avanzel, whichever way the quit went.
  app.on("will-quit", () => void controller?.stopCursorHelper());
  app.on("before-quit", (event) => {
    if (stopped || !controller) return;
    if (stopping) return event.preventDefault();
    if (!controller.busy()) return controller.stopAgentChecks();
    stopping = true;
    event.preventDefault();
    void controller.stopForQuit().finally(() => {
      stopped = true;
      app.quit();
    });
  });

  app.whenReady().then(async () => {
    app.dock?.hide();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
    const ours = (url: string) => url.startsWith(`file://${DIST}`);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(permission === "media" && ours(contents.getURL())));
    session.defaultSession.setPermissionCheckHandler((contents, permission) =>
      permission === "media" && !!contents && ours(contents.getURL()));

    controller = new Controller(app.getPath("userData"));
    registerIpc(controller);
    await controller.start();
    // Only once it has started, so the launch itself never counts as opening Avanzel again.
    app.on("activate", () => controller?.showHome());
    if (process.env.AVANZEL_TEST === "1") (globalThis as { __avanzel?: Controller }).__avanzel = controller;
  });
}
