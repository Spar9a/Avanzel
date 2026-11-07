// Avanzel from source that keeps itself current: `npm run dev:watch`.
// The build watches every source (scripts/build.mjs --watch). A change to the main process or the preload restarts Avanzel,
// through its own quit, so an agent run is stopped as it would be on ⌘Q; a change to a window (or @avanzel/ui) only reloads the windows.
// Ctrl+C ends both.
import { fork, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronBin = createRequire(import.meta.url)("electron");
const QUIT_GRACE_MS = 15_000;

const env = { ...process.env, AVANZEL_DEV_RELOAD: "1" };
delete env.ELECTRON_RUN_AS_NODE;

let app = null;
let restarting = false;
let ending = false;
const firstBuilds = new Set(["main", "preload", "renderer"]);

function start() {
  app = spawn(electronBin, ["."], { cwd: root, env, stdio: ["pipe", "inherit", "inherit"] });
  const self = app;
  self.on("exit", (code, signal) => {
    if (app === self) app = null;
    if (ending) return;
    if (restarting) {
      restarting = false;
      start();
    } else {
      console.log(`[dev] Avanzel ended (${signal ?? code}); it starts again on the next change to the main process`);
    }
  });
}

function tell(line) {
  if (app?.stdin?.writable) app.stdin.write(`${line}\n`);
}

function restart() {
  if (!app) return start();
  if (restarting) return;
  restarting = true;
  console.log("[dev] main process changed: restarting Avanzel");
  const self = app;
  tell("quit");
  setTimeout(() => {
    if (self.exitCode === null && self.signalCode === null) self.kill("SIGTERM");
  }, QUIT_GRACE_MS).unref();
}

const builder = fork(path.join(root, "scripts", "build.mjs"), ["--watch"], { cwd: root, stdio: "inherit" });
builder.on("exit", (code) => {
  if (ending) return;
  console.error(`[dev] the build stopped (${code}); ending`);
  end();
});
builder.on("message", (message) => {
  const part = message?.built;
  if (!part) return;
  if (firstBuilds.size) {
    firstBuilds.delete(part);
    if (!firstBuilds.size) start();
    return;
  }
  if (part === "renderer") {
    console.log("[dev] a window changed: reloading the windows");
    tell("reload");
  } else {
    restart();
  }
});

function end() {
  if (ending) return;
  ending = true;
  builder.kill("SIGTERM");
  if (!app) return process.exit(0);
  tell("quit");
  app.on("exit", () => process.exit(0));
  setTimeout(() => {
    app?.kill("SIGTERM");
    process.exit(0);
  }, QUIT_GRACE_MS).unref();
}
process.on("SIGINT", end);
process.on("SIGTERM", end);
