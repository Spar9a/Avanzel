// Setting up the owner's other agents to start Avanzel's MCP server (`Avanzel --mcp`, mcp-mode.ts): Settings → Agents adds it to
// Claude Code with `claude mcp add`, and gives every other client the snippet its own config file takes.
import { execFile } from "node:child_process";

/** The MCP clients Settings sets up, by id. */
export type McpClient = "claude-code" | "claude-desktop" | "cursor" | "codex" | "opencode" | "gemini";

/** A client as Settings lists it: its name, and where its setup goes (the file its snippet is pasted into, or Terminal). */
export interface McpClientInfo {
  client: McpClient;
  label: string;
  where: string;
}

/** How a client starts Avanzel's server: the command and its arguments (mcpLaunch). */
export interface McpLaunch {
  command: string;
  args: string[];
}

/** The name every client knows Avanzel's server by. */
const SERVER = "avanzel";

/** Every client Settings sets up, in the order its rows show: Claude Code first, as it has its own button. */
export const MCP_CLIENTS: readonly McpClientInfo[] = [
  { client: "claude-code", label: "Claude Code", where: "Terminal" },
  { client: "claude-desktop", label: "Claude Desktop", where: "~/Library/Application Support/Claude/claude_desktop_config.json" },
  { client: "cursor", label: "Cursor", where: "~/.cursor/mcp.json" },
  { client: "codex", label: "Codex", where: "~/.codex/config.toml" },
  { client: "opencode", label: "OpenCode", where: "~/.config/opencode/opencode.json" },
  { client: "gemini", label: "Gemini CLI", where: "~/.gemini/settings.json" },
];

/** Whether `value`, as the page sent it, names a client Settings sets up. */
export const isMcpClient = (value: unknown): value is McpClient => MCP_CLIENTS.some((info) => info.client === value);

/**
 * The command Add to Claude Code runs: Avanzel's server for every project of this user. Options sit between the name and `--`, which
 * hands the rest to the server untouched (https://code.claude.com/docs/en/mcp, "claude mcp add example --env … -- npx …";
 * `claude mcp add --help`: `claude mcp add [options] <name> <commandOrUrl> [args...]`, `-s, --scope <scope>` local, user or project).
 */
export function claudeAddArgv(launch: McpLaunch): string[] {
  return ["claude", "mcp", "add", SERVER, "--scope", "user", "--", launch.command, ...launch.args];
}

/** `argv` as one line to paste into Terminal: a word with anything a shell reads specially goes in single quotes. */
export function shellLine(argv: readonly string[]): string {
  return argv.map((word) => (/^[\w/.:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)).join(" ");
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** A TOML basic string: JSON's escapes for `"`, `\` and control characters are TOML's too. */
const tomlString = (value: string) => JSON.stringify(value);

/** What `client` needs to start Avanzel's server: the text to paste into its config file, or Claude Code's command line. */
export function setupSnippet(client: McpClient, launch: McpLaunch): string {
  const { command, args } = launch;
  switch (client) {
    case "claude-code":
      return shellLine(claudeAddArgv(launch));
    // https://modelcontextprotocol.io/docs/develop/connect-local-servers: claude_desktop_config.json's "mcpServers", each with
    // "command" and "args". https://geminicli.com/docs/tools/mcp-server/: settings.json's "mcpServers", the same keys.
    case "claude-desktop":
    case "gemini":
      return json({ mcpServers: { [SERVER]: { command, args } } });
    // https://cursor.com/docs/context/mcp: mcp.json's "mcpServers"; its table of stdio fields lists "type": "stdio" as required.
    case "cursor":
      return json({ mcpServers: { [SERVER]: { type: "stdio", command, args } } });
    // https://developers.openai.com/codex/mcp (now learn.chatgpt.com/docs/extend/mcp): a [mcp_servers.<name>] table in
    // ~/.codex/config.toml, with "command" and "args".
    case "codex":
      return `[mcp_servers.${SERVER}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]`;
    // https://opencode.ai/v1/docs/mcp-servers/: "mcp", each server "type": "local" with "command" one list and "enabled". OpenCode V2
    // (https://opencode.ai/docs/mcp-servers/) writes servers under "mcp.servers", and its migration guide
    // (https://opencode.ai/docs/migrate-v1/) says the V1 form keeps working, so this one suits both.
    case "opencode":
      return json({ mcp: { [SERVER]: { type: "local", command: [command, ...args], enabled: true } } });
  }
}

/** How a run of a command ended: its exit code, "ENOENT" when there was no such command, "timeout" when it ran past its time. */
export interface ExecResult {
  code: number | "ENOENT" | "timeout";
  stdout: string;
  stderr: string;
}

/** Runs a command and says how it ended. */
export type Exec = (file: string, args: string[]) => Promise<ExecResult>;

/** How long Add to Claude Code waits for `claude mcp add`. */
export const CLAUDE_ADD_TIMEOUT_MS = 15_000;

/** Runs `file` with this process's PATH, from `cwd`, for at most CLAUDE_ADD_TIMEOUT_MS. */
export function execIn(cwd: string): Exec {
  return (file, args) =>
    new Promise((resolve) => {
      execFile(file, args, { cwd, timeout: CLAUDE_ADD_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        let code: ExecResult["code"] = 0;
        if (failure?.code === "ENOENT") code = "ENOENT";
        else if (failure?.killed) code = "timeout";
        else if (failure) code = typeof failure.code === "number" ? failure.code : 1;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

/** The last line a command wrote that says anything, without its colours. */
function lastLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

/**
 * What Add to Claude Code came to: added (or there already), missing (no `claude` on this Mac), or failed, with a plain sentence for
 * the window (`detail`) and the last line Claude Code wrote (`output`), which goes to the log, never to the window.
 */
export type ClaudeAddOutcome = { kind: "added" } | { kind: "missing" } | { kind: "failed"; detail: string; output: string };

/** Claude Code's own words when a server of that name is there already ("MCP server avanzel already exists in user config"). */
const ALREADY_THERE = /MCP server \S+ already exists/;

/** Add to Claude Code: `claude mcp add` for this user's every project. Avanzel being there already counts as added. */
export async function addToClaudeCode(launch: McpLaunch, exec: Exec): Promise<ClaudeAddOutcome> {
  const [file, ...args] = claudeAddArgv(launch) as [string, ...string[]];
  const result = await exec(file, args);
  if (result.code === 0) return { kind: "added" };
  if (result.code === "ENOENT") return { kind: "missing" };
  const output = lastLine(result.stderr) || lastLine(result.stdout);
  if (result.code === "timeout") return { kind: "failed", detail: `Claude Code didn't answer within ${CLAUDE_ADD_TIMEOUT_MS / 1000} s.`, output };
  if (ALREADY_THERE.test(`${result.stderr}\n${result.stdout}`)) return { kind: "added" };
  return { kind: "failed", detail: `Claude Code stopped with code ${result.code}.`, output };
}
