// Avanzel --mcp, as an agent's MCP client starts it: the app's own binary serves the library over stdin and stdout, with no window,
// tray or lock, while Settings lets other agents in, and quits once the client closes stdin.
import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENT_ACCESS_OFF } from "../../../packages/engine/src/index.ts";
import { appDir, makeLibrary } from "./helpers.ts";

const made: string[] = [];
test.afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A library with one page to find, and app data whose settings point at it with the switch `agentAccess`. */
async function setUp(agentAccess: boolean): Promise<{ library: string; userData: string }> {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "memories", "pnpm.md"), "---\ntitle: Package manager\ntags: [tooling]\n---\n\nThe owner prefers pnpm.\n");
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, libraryPath: library, agentAccess }));
  made.push(library, userData);
  return { library, userData };
}

/** An MCP client connected to `Avanzel --mcp` (the dev app, or AVANZEL_E2E_PACKAGED's binary), and what went wrong on its stdout. */
async function connect(userData: string) {
  const packaged = process.env.AVANZEL_E2E_PACKAGED;
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  const app = process.env.AVANZEL_DIST ? path.join(path.resolve(process.env.AVANZEL_DIST), "main.mjs") : appDir;
  // As mcpLaunch (src/main/mcp-mode.ts) gives it; that module needs Electron's own main process to load.
  const { command, args } = packaged ? { command: packaged, args: ["--mcp"] } : { command: electron, args: [app, "--mcp"] };
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && k !== "AVANZEL_AGENT_RUN" && v !== undefined),
  ) as Record<string, string>;
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: appDir,
    env: { ...env, AVANZEL_TEST: "1", AVANZEL_USER_DATA: userData },
    stderr: "pipe",
  });
  const stderr: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  const problems: string[] = [];
  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(transport);
  // A line on stdout that isn't a protocol message comes back here: nothing but the protocol may be written there.
  transport.onerror = (error) => problems.push(String(error));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return (result.content as Array<{ text: string }>).map((part) => part.text).join("");
  };
  return { client, transport, call, problems, stderr };
}

test("an outside agent reads the library and leaves a note in its inbox, and the server quits when the agent closes it", async () => {
  const { library, userData } = await setUp(true);
  const { client, transport, call, problems, stderr } = await connect(userData);
  const pid = transport.pid;
  expect(pid).not.toBeNull();

  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(["library_overview", "read_page", "recent_changes", "remember", "search"]);
  expect(await call("search", { query: "pnpm" })).toContain("memories/pnpm.md");

  const answer = JSON.parse(await call("remember", { text: "The owner keeps a changelog in every project.", tags: ["tooling"] })) as { id: string };
  const note = readFileSync(path.join(library, "inbox", `${answer.id}.md`), "utf8");
  expect(note).toContain("source: agent");
  expect(note).toContain("agent: e2e-agent");
  expect(note).toContain("The owner keeps a changelog in every project.");

  // Closing ends stdin; the server quits by itself, well before the client would stop it (2 s, then SIGTERM).
  const closing = Date.now();
  await client.close();
  expect(Date.now() - closing, stderr.join("")).toBeLessThan(2_000);
  expect(() => process.kill(pid as number, 0)).toThrow();
  expect(problems).toEqual([]);
  // The settings file is only read: MCP mode never rewrites it.
  expect(JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8"))).toEqual({ version: 1, libraryPath: library, agentAccess: true });
});

test("while Settings keeps the library closed, every tool answers that it is closed and the inbox stays as it was", async () => {
  const { library, userData } = await setUp(false);
  mkdirSync(path.join(library, "inbox"), { recursive: true });
  const before = readdirSync(path.join(library, "inbox")).sort();
  const { client, call, problems } = await connect(userData);
  expect(await call("search", { query: "pnpm" })).toBe(AGENT_ACCESS_OFF);
  expect(await call("remember", { text: "A note." })).toBe(AGENT_ACCESS_OFF);
  expect(readdirSync(path.join(library, "inbox")).sort()).toEqual(before);
  await client.close();
  expect(problems).toEqual([]);
});
