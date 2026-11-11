// A release refuses a debugger's switches: DevTools' port and pipe, and Node's inspector (src/main/debug-switches.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEBUG_SWITCHES, debugSwitch } from "../src/main/debug-switches.ts";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("debug switches", () => {
  it("names the first debugger switch given, and nothing when none is", () => {
    const given = (names: string[]) => (name: string) => names.includes(name);
    expect(debugSwitch(given([]))).toBeNull();
    expect(debugSwitch(given(["enable-logging", "lang"]))).toBeNull();
    expect(debugSwitch(given(["remote-debugging-port"]))).toBe("remote-debugging-port");
    expect(debugSwitch(given(["remote-debugging-pipe"]))).toBe("remote-debugging-pipe");
    expect(debugSwitch(given(["inspect-brk", "remote-debugging-port"]))).toBe("remote-debugging-port");
    for (const name of DEBUG_SWITCHES) expect(debugSwitch(given([name]))).toBe(name);
  });

  it("only a release's bundle refuses them: release.mjs builds it with AVANZEL_RELEASE_BUILD=1, which build.mjs compiles in", () => {
    expect(read("../scripts/build.mjs")).toContain(`define: { __AVANZEL_RELEASE__: process.env.AVANZEL_RELEASE_BUILD === "1" ? "true" : "false" }`);
    expect(read("../scripts/release.mjs")).toContain(`AVANZEL_RELEASE_BUILD: "1"`);
    const main = read("../src/main/index.ts");
    expect(main).toContain("debugSwitch((name) => app.commandLine.hasSwitch(name))");
    // Before anything else runs: the check sits above the single-instance lock and the controller.
    expect(main.indexOf("debugSwitch((name)")).toBeLessThan(main.indexOf("requestSingleInstanceLock"));
  });
});
