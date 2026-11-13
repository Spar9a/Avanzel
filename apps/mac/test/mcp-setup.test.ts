// Setting up the owner's other agents to start Avanzel --mcp (src/main/mcp-setup.ts): the snippet each client's config takes, the
// `claude mcp add` that Add to Claude Code runs, and what Settings says when that fails.
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { addToClaudeCode, claudeAddArgv, MCP_CLIENTS, setupSnippet, shellLine, type ExecResult } from "../src/main/mcp-setup.ts";

const BINARY = "/Applications/Avanzel.app/Contents/MacOS/Avanzel";
const PACKAGED = { command: BINARY, args: ["--mcp"] };

describe("MCP setup", () => {
  it("lists every client Settings sets up, Claude Code first, each with where its setup goes", () => {
    expect(MCP_CLIENTS).toEqual([
      { client: "claude-code", label: "Claude Code", where: "Terminal" },
      { client: "claude-desktop", label: "Claude Desktop", where: "~/Library/Application Support/Claude/claude_desktop_config.json" },
      { client: "cursor", label: "Cursor", where: "~/.cursor/mcp.json" },
      { client: "codex", label: "Codex", where: "~/.codex/config.toml" },
      { client: "opencode", label: "OpenCode", where: "~/.config/opencode/opencode.json" },
      { client: "gemini", label: "Gemini CLI", where: "~/.gemini/settings.json" },
    ]);
  });

  it("gives Claude Desktop and Gemini CLI an mcpServers entry with the command and its arguments", () => {
    const expected = `{
  "mcpServers": {
    "avanzel": {
      "command": "${BINARY}",
      "args": [
        "--mcp"
      ]
    }
  }
}`;
    for (const client of ["claude-desktop", "gemini"] as const) {
      const snippet = setupSnippet(client, PACKAGED);
      expect(snippet).toBe(expected);
      expect(JSON.parse(snippet)).toEqual({ mcpServers: { avanzel: { command: BINARY, args: ["--mcp"] } } });
    }
  });

  it("gives Cursor an mcpServers entry that says it is a stdio server", () => {
    const snippet = setupSnippet("cursor", PACKAGED);
    expect(snippet).toBe(`{
  "mcpServers": {
    "avanzel": {
      "type": "stdio",
      "command": "${BINARY}",
      "args": [
        "--mcp"
      ]
    }
  }
}`);
    expect(JSON.parse(snippet)).toEqual({ mcpServers: { avanzel: { type: "stdio", command: BINARY, args: ["--mcp"] } } });
  });

  it("gives Codex a TOML table", () => {
    const snippet = setupSnippet("codex", PACKAGED);
    expect(snippet).toBe(`[mcp_servers.avanzel]\ncommand = "${BINARY}"\nargs = ["--mcp"]`);
    expect(parseToml(snippet)).toEqual({ mcp_servers: { avanzel: { command: BINARY, args: ["--mcp"] } } });
  });

  it("gives OpenCode a local server whose command is one list", () => {
    const snippet = setupSnippet("opencode", PACKAGED);
    expect(snippet).toBe(`{
  "mcp": {
    "avanzel": {
      "type": "local",
      "command": [
        "${BINARY}",
        "--mcp"
      ],
      "enabled": true
    }
  }
}`);
    expect(JSON.parse(snippet)).toEqual({ mcp: { avanzel: { type: "local", command: [BINARY, "--mcp"], enabled: true } } });
  });

  it("gives Claude Code the claude mcp add line, for every project", () => {
    expect(claudeAddArgv(PACKAGED)).toEqual(["claude", "mcp", "add", "avanzel", "--scope", "user", "--", BINARY, "--mcp"]);
    expect(setupSnippet("claude-code", PACKAGED)).toBe(`claude mcp add avanzel --scope user -- ${BINARY} --mcp`);
  });

  it("quotes for the shell only the words that need it", () => {
    expect(shellLine(["claude", "--", "/Users/a b/Electron", "it's"])).toBe(`claude -- '/Users/a b/Electron' 'it'\\''s'`);
    expect(shellLine(["a/b-c_d.e:f=g@h%i+j,k"])).toBe("a/b-c_d.e:f=g@h%i+j,k");
    expect(shellLine([""])).toBe("''");
  });

  it("escapes what JSON and TOML need in a path, so a dev path with quotes still parses", () => {
    const odd = { command: `/Users/o"k\\/Electron`, args: ["/Users/o\"k\\/apps/mac", "--mcp"] };
    expect(JSON.parse(setupSnippet("cursor", odd)).mcpServers.avanzel.command).toBe(odd.command);
    expect(parseToml(setupSnippet("codex", odd))).toEqual({ mcp_servers: { avanzel: { command: odd.command, args: odd.args } } });
  });
});

/** An exec that answers as given and keeps what it was asked to run. */
function fakeExec(result: ExecResult) {
  const calls: { file: string; args: string[] }[] = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return result;
  };
  return { exec, calls };
}

describe("Add to Claude Code", () => {
  it("runs claude mcp add avanzel for the user's every project, and is added when it exits 0", async () => {
    const { exec, calls } = fakeExec({ code: 0, stdout: "Added stdio MCP server avanzel to user config\n", stderr: "" });
    expect(await addToClaudeCode(PACKAGED, exec)).toEqual({ kind: "added" });
    expect(calls).toEqual([{ file: "claude", args: ["mcp", "add", "avanzel", "--scope", "user", "--", BINARY, "--mcp"] }]);
  });

  it("is added when Claude Code says Avanzel's server is there already, and only then", async () => {
    const { exec } = fakeExec({ code: 1, stdout: "", stderr: "MCP server avanzel already exists in user config\n" });
    expect(await addToClaudeCode(PACKAGED, exec)).toEqual({ kind: "added" });
    // Other words that happen to say "already exists" are a failure like any other.
    const other = fakeExec({ code: 1, stdout: "", stderr: "error: lock file already exists\n" });
    expect(await addToClaudeCode(PACKAGED, other.exec)).toEqual({ kind: "failed", detail: "Claude Code stopped with code 1.", output: "error: lock file already exists" });
  });

  it("is missing when there is no claude to run", async () => {
    const { exec } = fakeExec({ code: "ENOENT", stdout: "", stderr: "" });
    expect(await addToClaudeCode(PACKAGED, exec)).toEqual({ kind: "missing" });
  });

  it("says Claude Code didn't answer when it ran past its time", async () => {
    const { exec } = fakeExec({ code: "timeout", stdout: "", stderr: "" });
    expect(await addToClaudeCode(PACKAGED, exec)).toEqual({ kind: "failed", detail: "Claude Code didn't answer within 15 s.", output: "" });
  });

  it("says how Claude Code stopped in a plain sentence, and keeps the last line it wrote, without colours, for the log", async () => {
    const { exec } = fakeExec({ code: 1, stdout: "", stderr: "Usage: claude mcp add\n\u001b[31merror: invalid scope\u001b[39m\n\n" });
    expect(await addToClaudeCode(PACKAGED, exec)).toEqual({ kind: "failed", detail: "Claude Code stopped with code 1.", output: "error: invalid scope" });
    const quiet = fakeExec({ code: 2, stdout: "", stderr: "" });
    expect(await addToClaudeCode(PACKAGED, quiet.exec)).toEqual({ kind: "failed", detail: "Claude Code stopped with code 2.", output: "" });
  });
});
