// Builds avanzel-calltap (apps/mac/native/calltap) as a universal binary at native/calltap/build/avanzel-calltap.
// On a Mac without swiftc it says so and exits 0: the app still builds, only call notes are missing.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../native/calltap");
const build = join(dir, "build");
const source = join(dir, "main.swift");

if (spawnSync("swiftc", ["--version"], { stdio: "ignore" }).status !== 0) {
  console.log("swiftc is not installed, so avanzel-calltap is not built and the app will have no call notes.");
  process.exit(0);
}

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });

const slices = ["arm64", "x86_64"].map((arch) => {
  const out = join(build, `avanzel-calltap-${arch}`);
  execFileSync("swiftc", ["-O", "-target", `${arch}-apple-macos14.2`, "-o", out, source], { stdio: "inherit" });
  return out;
});

execFileSync("lipo", ["-create", ...slices, "-output", join(build, "avanzel-calltap")], { stdio: "inherit" });
for (const slice of slices) rmSync(slice);
console.log(`Built ${join(build, "avanzel-calltap")} (arm64 and x86_64).`);
