import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../src/core/config.ts";
import {
  Harness,
  asksToSignIn,
  checkAgent,
  childEnv,
  errorLine,
  harnesses,
  selectHarness,
} from "../../src/core/harness.ts";
import { AvanzelError } from "../../src/types.ts";
import { builtin, settingsWith } from "./harness-fixtures.ts";
import { binScripts, thrownBy, useTmp } from "./helpers.ts";

const VAULT = "/v/My Brain";
const OUT = "/tmp/out.txt";
const tmp = useTmp();

describe("argv", () => {
  it("limits Claude Code to file tools and keeps the owner's MCP servers out", () => {
    // --tools limits what exists (--allowedTools only pre-approves); --strict-mcp-config keeps the
    // owner's MCP servers out of filing runs. stream-json prints each tool call as it happens, and
    // -p refuses it without --verbose.
    expect(builtin("claude").headlessArgv("P", VAULT, { write: true, model: null, outputFile: OUT })).toEqual([
      "claude", "-p", "P", "--output-format", "stream-json", "--verbose",
      "--tools", "Read,Write,Edit,Glob,Grep", "--allowedTools", "Read,Write,Edit,Glob,Grep",
      "--strict-mcp-config", "--permission-mode", "acceptEdits",
    ]);
    expect(builtin("claude").headlessArgv("P", VAULT, { write: false, model: "sonnet", outputFile: OUT })).toEqual([
      "claude", "-p", "P", "--output-format", "stream-json", "--verbose", "--tools", "Read,Glob,Grep",
      "--allowedTools", "Read,Glob,Grep", "--strict-mcp-config", "--model", "sonnet",
    ]);
  });

  it("gives Claude Code's write runs their settings after the permission mode and before the model, and no other run", () => {
    const settings = '{"permissions":{"deny":["Edit(//lib/raw/**)"]}}';
    expect(builtin("claude").headlessArgv("P", VAULT, { write: true, model: "sonnet", outputFile: OUT, settings })).toEqual([
      "claude", "-p", "P", "--output-format", "stream-json", "--verbose",
      "--tools", "Read,Write,Edit,Glob,Grep", "--allowedTools", "Read,Write,Edit,Glob,Grep",
      "--strict-mcp-config", "--permission-mode", "acceptEdits", "--settings", settings, "--model", "sonnet",
    ]);
    expect(builtin("claude").headlessArgv("P", VAULT, { write: false, outputFile: OUT, settings })).toEqual(
      builtin("claude").headlessArgv("P", VAULT, { write: false, outputFile: OUT }),
    );
    for (const name of ["codex", "opencode", "cursor-agent", "gemini"]) {
      const harness = builtin(name);
      expect(harness.headlessArgv("P", VAULT, { write: true, outputFile: OUT, settings })).toEqual(
        harness.headlessArgv("P", VAULT, { write: true, outputFile: OUT }),
      );
    }
  });

  it("reads Claude Code's output as a stream, and no other agent's", () => {
    expect(builtin("claude").streams).toBe(true);
    for (const name of ["codex", "opencode", "cursor-agent", "gemini"]) expect(builtin(name).streams).toBe(false);
    // A custom harness doesn't, even one that takes the name claude.
    const mine = { name: "claude", headless: ["claude", "-p", "{prompt}"], interactive: [] };
    expect((harnesses(settingsWith({ harnesses: { claude: mine } })).claude as Harness).streams).toBe(false);
  });

  it("runs Codex in its sandbox and reads its last message from a file", () => {
    const codex = builtin("codex");
    expect(codex.readsOutputFile).toBe(true);
    expect(codex.headlessArgv("P", VAULT, { write: true, model: "m", outputFile: OUT })).toEqual([
      "codex", "exec", "--cd", "/v/My Brain", "--skip-git-repo-check", "--color", "never",
      "--sandbox", "workspace-write", "-o", "/tmp/out.txt", "-m", "m", "P",
    ]);
    const readonly = codex.headlessArgv("P", VAULT, { write: false, model: null, outputFile: OUT });
    expect(readonly[readonly.indexOf("--sandbox") + 1]).toBe("read-only");
  });

  it("builds OpenCode, Cursor Agent and Gemini CLI commands", () => {
    expect(builtin("opencode").headlessArgv("P", VAULT, { write: true, model: null, outputFile: OUT })).toEqual([
      "opencode", "run", "--dir", "/v/My Brain", "P",
    ]);
    // Cursor only proposes edits in print mode unless --force; read-only asks keep it off.
    expect(builtin("cursor-agent").headlessArgv("P", VAULT, { write: true, model: "gpt-5", outputFile: OUT })).toEqual([
      "cursor-agent", "-p", "--force", "--output-format", "text", "--model", "gpt-5", "P",
    ]);
    expect(builtin("cursor-agent").headlessArgv("P", VAULT, { write: false, model: null, outputFile: OUT })).toEqual([
      "cursor-agent", "-p", "--output-format", "text", "P",
    ]);
    expect(builtin("gemini").headlessArgv("P", VAULT, { write: false, model: null, outputFile: OUT })).toEqual([
      "gemini", "-p", "P", "--approval-mode", "default",
    ]);
    expect(builtin("gemini").experimental).toBe(true);
  });

  it("hands screenshots to Codex with -i and to OpenCode with -f (codex_and_opencode_receive_images)", () => {
    const images = ["raw/attachments/2026/10/a.png", "raw/attachments/2026/10/b.png"];
    // Both flags take several values, so the prompt must not follow them directly: Codex gets `--`
    // before the prompt, OpenCode gets its files after the prompt.
    expect(builtin("codex").headlessArgv("P", VAULT, { write: true, model: "m", outputFile: OUT, images })).toEqual([
      "codex", "exec", "--cd", "/v/My Brain", "--skip-git-repo-check", "--color", "never",
      "--sandbox", "workspace-write", "-o", "/tmp/out.txt", "-m", "m",
      "-i", "raw/attachments/2026/10/a.png", "-i", "raw/attachments/2026/10/b.png", "--", "P",
    ]);
    expect(builtin("opencode").headlessArgv("P", VAULT, { write: true, model: null, outputFile: OUT, images })).toEqual([
      "opencode", "run", "--dir", "/v/My Brain", "P",
      "-f", "raw/attachments/2026/10/a.png", "-f", "raw/attachments/2026/10/b.png",
    ]);
    for (const name of ["claude", "cursor-agent", "gemini"]) {
      const harness = builtin(name);
      expect(harness.headlessArgv("P", VAULT, { write: true, outputFile: OUT, images })).toEqual(
        harness.headlessArgv("P", VAULT, { write: true, outputFile: OUT }),
      );
    }
  });

  it("opens each CLI's own interactive UI", () => {
    expect(builtin("claude").interactiveArgv(VAULT)).toEqual(["claude"]);
    expect(builtin("codex").interactiveArgv(VAULT, { model: null })).toEqual(["codex", "--cd", "/v/My Brain"]);
    expect(builtin("opencode").interactiveArgv(VAULT, { model: "a/b" })).toEqual(["opencode", "/v/My Brain", "-m", "a/b"]);
  });

  it("substitutes {prompt} and {vault} in a custom harness, once", () => {
    const settings = settingsWith({
      harnesses: { mine: { name: "mine", headless: ["my-agent", "--dir={vault}", "{prompt}"], interactive: ["my-agent"] } },
    });
    const mine = harnesses(settings).mine as Harness;
    expect(mine.binary).toBe("my-agent");
    expect(mine.headlessArgv("say {vault} $1", VAULT, { write: true, outputFile: OUT })).toEqual([
      "my-agent", "--dir=/v/My Brain", "say {vault} $1",
    ]);
    expect(mine.interactiveArgv(VAULT)).toEqual(["my-agent"]);
  });
});

describe("selectHarness", () => {
  const onPath = (...names: string[]) =>
    vi.stubEnv("PATH", binScripts(tmp(), Object.fromEntries(names.map((name) => [name, "exit 0"]))));

  it("picks the first installed in the built-in order", () => {
    onPath("opencode", "codex");
    expect(selectHarness(defaultSettings()).name).toBe("codex");
  });

  it("prefers the requested harness over the configured one", () => {
    onPath("opencode", "codex");
    expect(selectHarness(settingsWith({ harness: "codex" }), "opencode").name).toBe("opencode");
  });

  it("explains a missing or unknown harness", () => {
    onPath("codex");
    expect(thrownBy(() => selectHarness(settingsWith({ harness: "claude" }))).message).toContain("codex");
    const unknown = thrownBy(() => selectHarness(defaultSettings(), "nope"));
    expect(unknown).toBeInstanceOf(AvanzelError);
    expect(unknown.message).toContain("nope");
    expect(thrownBy(() => selectHarness(defaultSettings(), "toString")).message).toContain("Unknown harness");
  });

  it("explains that no agent CLI is installed", () => {
    onPath();
    const error = thrownBy(() => selectHarness(defaultSettings()));
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error.message).toContain("claude");
  });
});

describe("errorLine", () => {
  it("picks the last error or login line over echoed prompts and banners", () => {
    const echoed = Array.from({ length: 40 }, (_, n) => `echoed prompt line ${n}`).join("\n");
    expect(errorLine(`${echoed}\nwarning: model metadata not found\nERROR: the model is not supported\nbye\n`)).toBe(
      "ERROR: the model is not supported",
    );
    expect(errorLine("  +i\n 11}[]-+####     Press any key to sign in...\n    ttttt/tZZfff^>\n")).toBe(
      "11}[]-+####     Press any key to sign in...",
    );
  });

  it("falls back to the last line, without colours", () => {
    expect(errorLine("first\n\n  \x1b[31msecond\x1b[0m  \n\n")).toBe("second");
    expect(errorLine("")).toBe("");
  });
});

describe("asksToSignIn", () => {
  it("asksToSignIn knows a sign-in line", () => {
    expect(asksToSignIn("Error: not logged in. Run cursor-agent login")).toBe(true);
    expect(asksToSignIn("Error: usage limit reached")).toBe(false);
  });
});

describe("childEnv", () => {
  it("strips the variables that tie a process to a Claude Code session", () => {
    const env = {
      PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k",
    };
    expect(childEnv(env)).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k" });
  });
});

describe("signIn", () => {
  const readSignIn = (name: string, output: string, exitCode = 0): boolean | null => {
    const { signIn } = builtin(name);
    if (!signIn) throw new Error(`no sign-in check for ${name}`);
    return signIn.signedIn(output, exitCode);
  };

  it("is the status command of Claude Code and Codex, and of no other agent", () => {
    expect(builtin("claude").signIn?.argv).toEqual(["claude", "auth", "status"]);
    expect(builtin("codex").signIn?.argv).toEqual(["codex", "login", "status"]);
    for (const name of ["opencode", "cursor-agent", "gemini"]) expect(builtin(name).signIn).toBeUndefined();
    // A custom harness has none, even one that takes a built-in's name.
    const mine = { name: "claude", headless: ["claude", "-p", "{prompt}"], interactive: [] };
    const custom = harnesses(settingsWith({ harnesses: { claude: mine } })).claude as Harness;
    expect(custom.signIn).toBeUndefined();
  });

  it("reads nothing but loggedIn from Claude Code's JSON", () => {
    expect(readSignIn("claude", '{"loggedIn": true, "email": "a@b"}')).toBe(true);
    expect(readSignIn("claude", '{"loggedIn": false}', 1)).toBe(false);
    for (const output of ["unknown command", "", "null", "[]", '{"email": "a@b"}', '{"loggedIn": "yes"}']) {
      expect(readSignIn("claude", output)).toBeNull();
    }
  });

  it("reads Codex's words, checking for not logged in first", () => {
    expect(readSignIn("codex", "Logged in using ChatGPT\n")).toBe(true);
    expect(readSignIn("codex", "Not logged in\n", 1)).toBe(false);
    expect(readSignIn("codex", "Logged in using ChatGPT", 1)).toBeNull(); // a failing exit is not believed
    expect(readSignIn("codex", "Error checking login status: boom", 1)).toBeNull();
    expect(readSignIn("codex", "")).toBeNull();
  });
});

describe("checkAgent", () => {
  /**
   * Fake agent CLIs, and nothing else, on PATH (so a script uses shell builtins and /bin/sleep). They
   * run in the library, so the files they write land in tmp().
   */
  const onPath = (scripts: Record<string, string>) => vi.stubEnv("PATH", binScripts(tmp(), scripts));
  const wrote = (file: string) => existsSync(join(tmp(), file));

  it("reads Claude Code's sign-in from `claude auth status`, without a prompt", async () => {
    onPath({ claude: `if [ "$*" = "auth status" ]; then echo '{"loggedIn": true, "email": "a@b"}'; else : > PROMPTED; fi` });
    const check = await checkAgent(builtin("claude"), tmp());
    // The whole result: nothing else from the JSON, such as the email, may come along.
    expect(check).toEqual({ ok: true, how: "signed-in", seconds: expect.any(Number) });
    expect(check.seconds).toBeGreaterThan(0);
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("a signed-out Claude Code is signed-out", async () => {
    onPath({ claude: `if [ "$*" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; else : > PROMPTED; fi` });
    expect(await checkAgent(builtin("claude"), tmp())).toMatchObject({ ok: false, why: "signed-out", detail: "" });
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("falls back to a prompt when the status command says nothing it understands", async () => {
    onPath({ claude: `if [ "$1" = auth ]; then echo "unknown command"; exit 1; fi; echo ready` });
    expect(await checkAgent(builtin("claude"), tmp())).toMatchObject({ ok: true, how: "replied" });
  });

  it("without `prompt`, a status command that says nothing it understands asks nothing, and is unknown", async () => {
    onPath({ claude: `if [ "$1" = auth ]; then echo "unknown command"; exit 1; else : > PROMPTED; fi` });
    const check = await checkAgent(builtin("claude"), tmp(), { prompt: false });
    expect(check).toEqual({ ok: false, why: "unknown", detail: "", seconds: expect.any(Number) });
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("without `prompt`, a status command that hangs or can't start asks nothing either", async () => {
    onPath({ claude: `if [ "$1" = auth ]; then /bin/sleep 5; else : > PROMPTED; fi` });
    const hung = await checkAgent(builtin("claude"), tmp(), { prompt: false, timeoutSeconds: 1 });
    expect(hung).toMatchObject({ ok: false, why: "unknown", detail: "" });
    expect(hung.seconds).toBeLessThan(5);
    expect(wrote("PROMPTED")).toBe(false);
    onPath({});
    expect(await checkAgent(builtin("codex"), tmp(), { prompt: false })).toMatchObject({ ok: false, why: "unknown", detail: "" });
  });

  it("without `prompt`, a status command is still read, and an agent without one is asked nothing", async () => {
    onPath({
      claude: `if [ "$*" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; else : > PROMPTED; fi`,
      "cursor-agent": ": > PROMPTED",
    });
    expect(await checkAgent(builtin("claude"), tmp(), { prompt: false })).toMatchObject({ ok: false, why: "signed-out", detail: "" });
    expect(await checkAgent(builtin("cursor-agent"), tmp(), { prompt: false })).toMatchObject({ ok: false, why: "unknown", detail: "" });
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("falls back to a prompt when the status command hangs", async () => {
    onPath({ claude: `if [ "$1" = auth ]; then /bin/sleep 5; exit 1; fi; echo ready` });
    const check = await checkAgent(builtin("claude"), tmp(), { timeoutSeconds: 1 });
    expect(check).toMatchObject({ ok: true, how: "replied" });
    expect(check.seconds).toBeLessThan(1); // the reply's own time, not the status command's wait
  });

  it("reads Codex's sign-in from `codex login status`", async () => {
    // Codex writes its answer to stderr, not stdout.
    onPath({ codex: `if [ "$*" = "login status" ]; then echo "Logged in using ChatGPT" >&2; else : > PROMPTED; fi` });
    expect(await checkAgent(builtin("codex"), tmp())).toMatchObject({ ok: true, how: "signed-in" });
    onPath({ codex: `if [ "$*" = "login status" ]; then echo "Not logged in" >&2; exit 1; else : > PROMPTED; fi` });
    expect(await checkAgent(builtin("codex"), tmp())).toMatchObject({ ok: false, why: "signed-out", detail: "" });
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("asks other agents one tiny read-only prompt", async () => {
    onPath({ "cursor-agent": `printf '%s\\n' "$@" > ARGV; echo ready` });
    const check = await checkAgent(builtin("cursor-agent"), tmp());
    expect(check).toMatchObject({ ok: true, how: "replied" });
    expect(check.seconds).toBeGreaterThan(0);
    const argv = readFileSync(join(tmp(), "ARGV"), "utf8").split("\n");
    expect(argv).toContain("Reply with the single word: ready.");
    expect(argv).not.toContain("--force");
  });

  it("a prompt slower than the timeout is timeout", async () => {
    onPath({ "cursor-agent": "/bin/sleep 5" });
    const check = await checkAgent(builtin("cursor-agent"), tmp(), { timeoutSeconds: 1 });
    expect(check).toMatchObject({ ok: false, why: "timeout" });
    expect(check.seconds).toBeLessThan(5);
  });

  it("a sign-in line in a failed reply is signed-out", async () => {
    onPath({ "cursor-agent": `echo "Error: not logged in. Run cursor-agent login" >&2; exit 1` });
    expect(await checkAgent(builtin("cursor-agent"), tmp())).toMatchObject({
      ok: false,
      why: "signed-out",
      detail: expect.stringContaining("not logged in"),
    });
  });

  it("any other failed reply is failed, with the line that tells why", async () => {
    onPath({ "cursor-agent": `echo "echoed prompt"; echo "Error: the model is overloaded"; echo "bye"; exit 1` });
    expect(await checkAgent(builtin("cursor-agent"), tmp())).toMatchObject({
      ok: false,
      why: "failed",
      detail: "Error: the model is overloaded",
    });
  });

  it("an agent that can't start is failed, whether or not it has a status command", async () => {
    onPath({});
    for (const name of ["claude", "cursor-agent"]) {
      expect(await checkAgent(builtin(name), tmp())).toMatchObject({
        ok: false,
        why: "failed",
        detail: `Could not start \`${name}\`: it is not on your PATH.`,
      });
    }
  });

  it("is failed for a library that is not a folder", async () => {
    onPath({ claude: "echo ready" });
    expect(await checkAgent(builtin("claude"), join(tmp(), "nope"))).toMatchObject({
      ok: false,
      why: "failed",
      detail: `No such folder: ${join(tmp(), "nope")}`,
    });
  });

  it("stops the status command when the caller cancels, and asks nothing after it", async () => {
    onPath({ claude: `if [ "$1" = auth ]; then /bin/sleep 5; else : > PROMPTED; fi` });
    const controller = new AbortController();
    const checking = checkAgent(builtin("claude"), tmp(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    const check = await checking;
    expect(check).toMatchObject({ ok: false, why: "failed", detail: "claude was cancelled" });
    expect(check.seconds).toBeLessThan(5);
    expect(wrote("PROMPTED")).toBe(false);
  });

  it("starts nothing for a caller that has cancelled already", async () => {
    onPath({ claude: ": > STARTED" });
    expect(await checkAgent(builtin("claude"), tmp(), { signal: AbortSignal.abort() })).toMatchObject({
      ok: false,
      why: "failed",
      detail: "claude was cancelled",
    });
    expect(wrote("STARTED")).toBe(false);
  });
});
