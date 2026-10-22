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

  it("the build keeps Electron's run-as-node fuse, which the filing guard needs", () => {
    // The guard's hook runs with Avanzel's own binary as Node (ELECTRON_RUN_AS_NODE=1). Fuses could turn that off.
    expect(builderConfig).not.toMatch(/^\s*electronFuses\s*:/m);
  });
});
