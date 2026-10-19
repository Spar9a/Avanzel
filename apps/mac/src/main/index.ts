// Avanzel for Mac: a menu-bar app. No Dock icon, no main window.
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
process.env.PATH = widenedPath(process.env.PATH ?? "", process.env.AVANZEL_TEST === "1" ? null : loginShellPath());
if (process.env.AVANZEL_USER_DATA) app.setPath("userData", process.env.AVANZEL_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: Controller | null = null;
  app.on("second-instance", () => controller?.showSettings());
  app.on("window-all-closed", () => {
    // Stay in the menu bar when Settings or Ask close.
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
    if (process.env.AVANZEL_TEST === "1") (globalThis as { __avanzel?: Controller }).__avanzel = controller;
  });
}
