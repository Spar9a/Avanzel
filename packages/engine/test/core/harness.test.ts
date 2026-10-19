import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings, type CustomHarness, type Settings } from "../../src/core/config.ts";
import { Harness, childEnv, harnesses, runHeadless, selectHarness } from "../../src/core/harness.ts";
import { AvanzelError } from "../../src/types.ts";
import { binScripts, thrownBy, useTmp } from "./helpers.ts";

const VAULT = "/v/My Brain";
const OUT = "/tmp/out.txt";
const tmp = useTmp();

function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...defaultSettings(), ...overrides };
}

function builtin(name: string): Harness {
  const harness = harnesses(defaultSettings())[name];
  if (!harness) throw new Error(`no harness ${name}`);
  return harness;
}

/** A custom harness running a Node script; the prompt arrives as process.argv[1]. */
function script(code: string, name = "js"): Harness {
  const spec: CustomHarness = { name, headless: [process.execPath, "-e", code, "{prompt}"], interactive: [] };
  return harnesses(settingsWith({ harnesses: { [name]: spec } }))[name] as Harness;
}

describe("argv", () => {
  it("limits Claude Code to file tools and keeps the owner's MCP servers out", () => {
    // --tools limits what exists (--allowedTools only pre-approves); --strict-mcp-config keeps the
    // owner's MCP servers out of filing runs.
    expect(builtin("claude").headlessArgv("P", VAULT, { write: true, model: null, outputFile: OUT })).toEqual([
      "claude", "-p", "P", "--output-format", "text",
      "--tools", "Read,Write,Edit,Glob,Grep", "--allowedTools", "Read,Write,Edit,Glob,Grep",
      "--strict-mcp-config", "--permission-mode", "acceptEdits",
    ]);
    expect(builtin("claude").headlessArgv("P", VAULT, { write: false, model: "sonnet", outputFile: OUT })).toEqual([
      "claude", "-p", "P", "--output-format", "text", "--tools", "Read,Glob,Grep",
      "--allowedTools", "Read,Glob,Grep", "--strict-mcp-config", "--model", "sonnet",
    ]);
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

describe("childEnv", () => {
  it("strips the variables that tie a process to a Claude Code session", () => {
    const env = {
      PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k",
    };
    expect(childEnv(env)).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k" });
  });
});

describe("runHeadless", () => {
  it("runs inside the library and returns stdout", async () => {
    const harness = script("console.log('cwd=' + process.cwd()); console.log('prompt=' + process.argv[1])");
    const result = await runHeadless(harness, "hello", tmp(), { write: true, timeoutSeconds: 30 });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(`cwd=${tmp()}\nprompt=hello`);
    expect(result.seconds).toBeGreaterThan(0);
  });

  it("gives the agent no stdin and no Claude Code session", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    const harness = script(
      "const input = require('fs').readFileSync(0, 'utf8'); console.log((process.env.CLAUDECODE ?? 'unset') + ' ' + JSON.stringify(input))",
    );
    expect((await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 30 })).output).toBe('unset ""');
  });

  it("stops an agent that runs too long and says so at the end of stderr", async () => {
    const harness = script("process.stderr.write('echoed prompt\\n'); setTimeout(() => {}, 30_000)");
    const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 1 });
    expect(result.exitCode).toBe(124);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("echoed prompt\n\njs timed out after 1s"); // as v0.1: f"{stderr}\n{note}".strip()
    expect(result.seconds).toBeLessThan(10);
  });

  it("does not fire a huge timeout at once", async () => {
    const result = await runHeadless(script("console.log('fine')"), "x", tmp(), { write: false, timeoutSeconds: 10_000_000 });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("fine");
  });

  it("keeps stderr of a failed run", async () => {
    const harness = script("process.stderr.write('please log in'); process.exitCode = 2");
    const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 30 });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("please log in");
  });

  it("strips ANSI escapes from the output", async () => {
    const harness = script(String.raw`process.stdout.write('\x1b[1mBold\x1b[0m done\x1b]0;title\x07\n')`);
    expect((await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 30 })).output).toBe("Bold done");
  });

  it("prefers the output file when the harness writes one", async () => {
    const filer = new Harness({
      name: "filer",
      binary: process.execPath,
      headless: (_prompt, _vault, { outputFile }) => [
        process.execPath,
        "-e",
        `require('fs').writeFileSync(${JSON.stringify(outputFile)}, 'final answer'); console.log('progress noise')`,
      ],
      interactive: () => [],
      readsOutputFile: true,
    });
    expect((await runHeadless(filer, "x", tmp(), { write: false, timeoutSeconds: 30 })).output).toBe("final answer");
  });

  it("names a binary that is not installed", async () => {
    const ghost = harnesses(
      settingsWith({ harnesses: { ghost: { name: "ghost", headless: ["definitely-not-installed-avanzel", "{prompt}"], interactive: [] } } }),
    ).ghost as Harness;
    await expect(runHeadless(ghost, "x", tmp(), { write: false, timeoutSeconds: 30 })).rejects.toThrow(
      /definitely-not-installed-avanzel/,
    );
    await expect(runHeadless(ghost, "x", tmp(), { write: false, timeoutSeconds: 30 })).rejects.toBeInstanceOf(AvanzelError);
  });

  it("stops the agent when the caller cancels", async () => {
    const controller = new AbortController();
    const running = runHeadless(script("setTimeout(() => {}, 30_000)"), "x", tmp(), {
      write: false,
      timeoutSeconds: 30,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const result = await running;
    expect(result.exitCode).toBe(130);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("js was cancelled");
    expect(result.seconds).toBeLessThan(10);

    const never = await runHeadless(script("require('fs').writeFileSync('RAN', '')"), "x", tmp(), {
      write: false,
      timeoutSeconds: 30,
      signal: AbortSignal.abort(),
    });
    expect(never.exitCode).toBe(130);
    expect(existsSync(join(tmp(), "RAN"))).toBe(false);
  });

  it("returns once the agent exits, even if something it started keeps the output open", async () => {
    const harness = script(
      "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', detached: true }).unref(); console.log('done')",
    );
    const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 30 });
    expect(result.output).toBe("done");
    expect(result.seconds).toBeLessThan(5);
  });
});
