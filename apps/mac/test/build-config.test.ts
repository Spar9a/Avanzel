// What the packaged app tells macOS, as electron-builder.yml writes it into Info.plist.
import { readFileSync } from "node:fs";
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

  it("the build keeps Electron's run-as-node fuse, which the filing guard needs", () => {
    // The guard's hook runs with Avanzel's own binary as Node (ELECTRON_RUN_AS_NODE=1). Its fuse could turn that off.
    expect(fuses(builderConfig)).toMatch(/^[ \t]+runAsNode: true$/m);
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
});
