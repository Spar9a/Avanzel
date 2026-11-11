// What the packaged app tells macOS, as electron-builder.yml writes it into Info.plist, and how it is built.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(fileURLToPath(new URL("../electron-builder.yml", import.meta.url)), "utf8");
const releaseConfig = readFileSync(fileURLToPath(new URL("../electron-builder.release.yml", import.meta.url)), "utf8");
/** The fuse settings under electronFuses in a config's text. */
const fuses = (config: string) => /^electronFuses:\n((?:[ \t]+.*\n)+)/m.exec(config)?.[1] ?? "";

describe("build config", () => {
  it("the microphone is asked for with the purpose setup promises", () => {
    expect(builderConfig).toContain(
      "NSMicrophoneUsageDescription: Avanzel listens only while you can see it listening, and turns speech into text on this Mac.",
    );
  });

  it("the packaged app carries the call-notes and cursor helpers, and signing covers both", () => {
    const signing = readFileSync(fileURLToPath(new URL("../scripts/signing.mjs", import.meta.url)), "utf8");
    const dist = (JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> }).scripts.dist;
    expect(builderConfig).toMatch(/from: native\/calltap\/build\n\s+to: calltap\n\s+filter: \["avanzel-calltap"\]/);
    expect(builderConfig).toMatch(/from: native\/cursor\/build\n\s+to: cursor\n\s+filter: \["avanzel-cursor"\]/);
    expect(signing).toContain("avanzel-calltap");
    expect(signing).toContain("avanzel-cursor");
    expect(dist).toContain("build-calltap.mjs");
    expect(dist).toContain("build-cursor.mjs");
  });

  it("the build turns Electron's run-as-node fuse off, and a release inherits it", () => {
    // Else any process on the Mac could run code as the signed app, with its microphone and screen recording permissions.
    expect(fuses(builderConfig)).toMatch(/^[ \t]+runAsNode: false$/m);
    expect(releaseConfig).toMatch(/^extends: electron-builder\.yml$/m);
    expect(fuses(releaseConfig)).not.toMatch(/runAsNode/);
  });

  it("a release can't be debugged, while a review build keeps --inspect for Playwright (e2e/packaged.spec.ts)", () => {
    expect(fuses(builderConfig)).toMatch(/^[ \t]+enableNodeCliInspectArguments: true$/m);
    expect(fuses(releaseConfig)).toMatch(/^[ \t]+enableNodeCliInspectArguments: false$/m);
    for (const line of ["enableNodeOptionsEnvironmentVariable: false", "onlyLoadAppFromAsar: true", "enableEmbeddedAsarIntegrityValidation: true"]) {
      expect(fuses(builderConfig)).toContain(line);
    }
  });

  it("nothing the app runs needs its binary to run as Node", () => {
    // With the fuse off, the variable does nothing, and a fork() in main would start a second app instead of a script.
    const sources = [
      ...filesUnder(fileURLToPath(new URL("../src", import.meta.url))),
      ...filesUnder(fileURLToPath(new URL("../../../packages/engine/src", import.meta.url))),
    ].filter((file) => /\.(ts|tsx|mjs|js)$/.test(file));
    expect(sources.length).toBeGreaterThan(50);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/ELECTRON_RUN_AS_NODE\s*(=|:)\s*["'`]?1/);
      expect(text, file).not.toMatch(/\bfork\(|utilityProcess/);
    }
  });
});

/** Every file below `dir`, at any depth. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
