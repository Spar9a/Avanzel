// A suite run holds apps/mac/.e2e-running (its pid inside; not in test-results, which Playwright empties) so a build can't delete dist under it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const distDir = (root, env = process.env) =>
  env.AVANZEL_DIST ? path.resolve(env.AVANZEL_DIST) : path.join(root, "dist");

const lockFile = (root) => path.join(root, ".e2e-running");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

export function suiteRunning(root) {
  try {
    const pid = Number(readFileSync(lockFile(root), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid);
  } catch {
    return false;
  }
}

export function holdLock(root, pid = process.pid) {
  mkdirSync(path.dirname(lockFile(root)), { recursive: true });
  writeFileSync(lockFile(root), String(pid));
  return () => rmSync(lockFile(root), { force: true });
}

export const runningMessage = () =>
  "An e2e suite is running here, so I did not build; wait for it to finish, or build into another folder with AVANZEL_DIST.";
