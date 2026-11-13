// Avanzel --mcp: the app's own binary as the MCP server the owner's other agents start (their MCP client runs
// `/Applications/Avanzel.app/Contents/MacOS/Avanzel --mcp`). It opens no window, tray or helper, takes no single-instance lock,
// so it runs beside the open app, and serves on stdin and stdout until the client closes stdin. Settings' switch decides,
// call by call, whether the library is open to it.
import { app } from "electron";
import path from "node:path";
import { launchedBy, serveStdio, type AgentAccess } from "@avanzel/engine";
import { SettingsStore } from "./store.ts";

/** Whether Avanzel was started as the MCP server rather than as the app. */
export function isMcpMode(argv: readonly string[]): boolean {
  return argv.includes("--mcp");
}

/** The command an agent's MCP client runs to start Avanzel's server: the app's binary, and in development Electron with the app's folder. */
export function mcpLaunch(packaged: boolean, execPath: string, appPath: string): { command: string; args: string[] } {
  return packaged ? { command: execPath, args: ["--mcp"] } : { command: execPath, args: [appPath, "--mcp"] };
}

/**
 * Serves one agent until it closes stdin, then quits. Settings are read from the file on every call, so turning access on or off,
 * or choosing another library, counts at once. Remembering is refused when one of Avanzel's own runs started this server.
 */
export async function runMcpMode(): Promise<never> {
  // The protocol owns stdout: anything else logged goes to stderr, which MCP clients keep as the server's log.
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  app.dock?.hide();
  const userData = app.getPath("userData");
  const file = path.join(userData, "settings.json");
  // Chromium's own state (Local State, GPU caches) goes to a folder of its own, still before `ready`: its caches aren't made for two
  // browser processes at once, and this one runs beside the open app, without the lock that would keep them apart.
  app.setPath("userData", path.join(userData, "mcp"));
  const settings = () => new SettingsStore(file).get();
  const access: AgentAccess = {
    root: () => settings().libraryPath || null,
    enabled: () => settings().agentAccess,
    fromAvanzel: () => launchedBy(process.execPath, process.pid) || process.env.AVANZEL_AGENT_RUN === "1",
  };
  try {
    await serveStdio(access, app.getVersion());
    app.exit(0);
  } catch (error) {
    console.error("Avanzel couldn't serve other agents:", error);
    app.exit(1);
  }
  return new Promise<never>(() => {});
}
