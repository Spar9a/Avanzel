// What the packaged app tells macOS, as electron-builder.yml writes it into Info.plist.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(fileURLToPath(new URL("../electron-builder.yml", import.meta.url)), "utf8");

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
    // The guard's hook runs with Avanzel's own binary as Node (ELECTRON_RUN_AS_NODE=1). Fuses could turn that off.
    expect(builderConfig).not.toMatch(/^\s*electronFuses\s*:/m);
  });
});
