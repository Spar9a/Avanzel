// Runs the e2e suite as a background job: builds once, then Playwright at background priority with
// the Mac kept awake (-s holds off sleep on mains power), the list report in /tmp, one summary line.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holdLock, runningMessage, suiteRunning } from "./e2e-lock.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (suiteRunning(root)) {
  console.error(runningMessage());
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const report = path.join(os.tmpdir(), `avanzel-e2e-${stamp}.txt`);
let code = 1;
let release = () => {};
try {
  const built = spawnSync("node", ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) throw new Error("build failed");
  release = holdLock(root);
  const out = createWriteStream(report);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn("taskpolicy", ["-b", "caffeinate", "-i", "-s", "npx", "playwright", "test", ...process.argv.slice(2)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  code = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? 1)));
  out.end();
} catch (error) {
  console.error(String(error.message ?? error));
} finally {
  release();
}
const lines = readFileSync(report, "utf8").split("\n").filter((l) => /^\s*\d+ (passed|failed|skipped|flaky)/.test(l));
console.log(lines.length ? lines.map((l) => l.trim()).join(", ") : `no summary; see the report`);
console.log(`report: ${report}`);
process.exit(code);
