// Avanzel --mcp: the app's own binary serving the library to the owner's other agents (src/main/mcp-mode.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isMcpMode, mcpLaunch } from "../src/main/mcp-mode.ts";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("MCP mode", () => {
  it("is on when the command line has --mcp, and only then", () => {
    expect(isMcpMode(["/Applications/Avanzel.app/Contents/MacOS/Avanzel", "--mcp"])).toBe(true);
    expect(isMcpMode(["/path/to/Electron", "/path/to/apps/mac", "--mcp"])).toBe(true);
    expect(isMcpMode(["/Applications/Avanzel.app/Contents/MacOS/Avanzel"])).toBe(false);
    expect(isMcpMode(["/Applications/Avanzel.app/Contents/MacOS/Avanzel", "--mcp=1", "mcp"])).toBe(false);
  });

  it("is launched as the packaged binary alone, or as Electron with the app's folder in development", () => {
    expect(mcpLaunch(true, "/Applications/Avanzel.app/Contents/MacOS/Avanzel", "/Applications/Avanzel.app/Contents/Resources/app.asar")).toEqual({
      command: "/Applications/Avanzel.app/Contents/MacOS/Avanzel",
      args: ["--mcp"],
    });
    expect(mcpLaunch(false, "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", "/repo/apps/mac")).toEqual({
      command: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      args: ["/repo/apps/mac", "--mcp"],
    });
  });

  it("starts before the login shell, the single-instance lock and the controller, but after a release's debugger check", () => {
    const main = read("../src/main/index.ts");
    const at = main.indexOf("isMcpMode(");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(main.indexOf("debugSwitch((name)"));
    expect(at).toBeLessThan(main.indexOf("widenedPath("));
    expect(at).toBeLessThan(main.indexOf("requestSingleInstanceLock"));
    expect(at).toBeLessThan(main.indexOf("new Controller("));
  });

  it("has an npm script that builds and starts the dev app in MCP mode", () => {
    const { scripts } = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
    expect(scripts.mcp).toBe("node scripts/build.mjs && env -u ELECTRON_RUN_AS_NODE electron . --mcp");
  });
});
