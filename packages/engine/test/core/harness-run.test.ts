import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolStep } from "../../src/core/claude-stream.ts";
import { Harness, NoAgentError, classifyFailure, errorLine, harnesses, runHeadless } from "../../src/core/harness.ts";
import { AvanzelError } from "../../src/types.ts";
import { builtin, script, settingsWith } from "./harness-fixtures.ts";
import { binScripts, useTmp } from "./helpers.ts";

const tmp = useTmp();

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

  describe("a run that prints without end", () => {
    // A megabyte of progress (21,000 lines of 51 bytes in the script harness), and then the line that says why it failed.
    const PROGRESS = 21_000;
    const GAVE_UP = "Error: the agent gave up";
    const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
    /** The shell that prints the progress, one numbered line at a time. A stand-in `claude` is alone on PATH: builtins only. */
    const progress = `i=0; while [ "$i" -lt ${PROGRESS} ]; do echo "progress $i of a long run"; i=$((i + 1)); done`;
    const claudeOnPath = (body: string) => vi.stubEnv("PATH", binScripts(tmp(), { claude: body }));

    it("keeps the last 64 KB of its output, and the line that says why it failed is still found", async () => {
      const harness = script(
        `for (let i = 0; i < ${PROGRESS}; i++) console.log('progress ' + String(i).padStart(5, '0') + ' of a long run, kept only at its end');` +
          ` console.log('${GAVE_UP}'); process.exitCode = 1`,
      );
      const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 60 });
      expect(result.exitCode).toBe(1);
      const kept = Buffer.byteLength(result.output);
      expect(kept).toBeLessThanOrEqual(64 * 1024);
      expect(kept).toBeGreaterThan(63 * 1024); // the last 64 KB, not a sliver of it
      expect(result.output).toContain(`progress ${PROGRESS - 1} `); // the end of the run is there
      expect(result.output).not.toContain("progress 00000 "); // the beginning is not
      expect(errorLine(result.output)).toBe(GAVE_UP);
      expect(classifyFailure(result).line).toBe(GAVE_UP);
    });

    it("keeps the last 64 KB of what it printed on stderr too, where a prompt it echoed long ago is no sign-in", async () => {
      // Like Codex, which echoes the prompt on stderr: this one says to log in. A megabyte of progress follows, and the
      // run fails with a line that says nothing of signing in.
      const FAILED = "stream disconnected before completion";
      const harness = script(
        "console.error('echoed prompt: remember to log in to the bank');" +
          ` for (let i = 0; i < ${PROGRESS}; i++) console.error('progress ' + String(i).padStart(5, '0') + ' of a long run, kept only at its end');` +
          ` console.error('${FAILED}'); process.exitCode = 1`,
      );
      const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 60 });
      expect(result.exitCode).toBe(1);
      const kept = Buffer.byteLength(result.stderr);
      expect(kept).toBeLessThanOrEqual(64 * 1024);
      expect(kept).toBeGreaterThan(63 * 1024); // the last 64 KB, not a sliver of it
      expect(result.stderr).not.toContain("echoed prompt");
      expect(result.stderr.trimEnd().endsWith(FAILED)).toBe(true); // stderr is given as it was printed, line end and all
      expect(classifyFailure(result)).toEqual({ kind: "other", resetsAt: null, line: FAILED });
    });

    it("cuts at 64 KB exactly, however much comes", async () => {
      // 'a', then `b`s, then the line end that `output` is trimmed of: the first byte goes as soon as there is one over.
      const limit = 64 * 1024;
      const printed = async (bs: number) => {
        const harness = script(`console.log('a' + 'b'.repeat(${bs}))`);
        return (await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 60 })).output;
      };
      expect(await printed(limit - 2)).toBe(`a${"b".repeat(limit - 2)}`); // 64 KB in all
      for (const bs of [limit - 1, 100_000, 2 * limit - 2, 3 * limit + 7]) {
        expect(await printed(bs), `${bs} bs`).toBe("b".repeat(limit - 1)); // the last 64 KB, which end with the line end
      }
    });

    it("starts what it keeps at a whole character", async () => {
      // 2 bytes to a character, so the cut that leaves the last 64 KB falls inside one.
      const harness = script("console.log('é'.repeat(100_000))");
      const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 60 });
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(64 * 1024);
      expect(result.output).toMatch(/^é+$/);
      expect(result.output).not.toContain(REPLACEMENT_CHARACTER);
    });

    it("keeps the last 200 lines of a Claude Code run that never replied", async () => {
      claudeOnPath(`${progress}; echo '${GAVE_UP}'; exit 1`);
      const result = await runHeadless(builtin("claude"), "x", tmp(), { write: false, timeoutSeconds: 60 });
      expect(result.ok).toBe(false);
      const lines = result.output.split("\n");
      expect(lines).toHaveLength(200);
      expect(lines[0]).toBe(`progress ${PROGRESS - 199} of a long run`); // 199 lines of progress, then the error
      expect(errorLine(result.output)).toBe(GAVE_UP);
    });

    it("reads every line of a Claude Code run as it comes, whether or not it is kept", async () => {
      // Its one step is among the first half of the lines, which are long gone by the end.
      const search = JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "*.md" } }] },
      });
      const done = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Filed.", permission_denials: [] });
      claudeOnPath(`${progress}; printf '%s\\n' '${search}'; ${progress}; printf '%s\\n' '${done}'`);
      const steps: ToolStep[] = [];
      const run = await runHeadless(builtin("claude"), "x", tmp(), {
        write: false,
        timeoutSeconds: 60,
        onStep: (step) => void steps.push(step),
      });
      expect(steps).toEqual([{ kind: "search" }]);
      expect(run).toMatchObject({ ok: true, output: "Filed." });
    });
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

  it("a binary that is not installed is a NoAgentError naming the harness", async () => {
    const ghost = harnesses(
      settingsWith({ harnesses: { ghost: { name: "ghost", headless: ["definitely-not-installed-avanzel", "{prompt}"], interactive: [] } } }),
    ).ghost as Harness;
    const error: unknown = await runHeadless(ghost, "x", tmp(), { write: false, timeoutSeconds: 30 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NoAgentError);
    expect(error).toMatchObject({
      name: "NoAgentError",
      agent: "ghost",
      message: "Could not start `definitely-not-installed-avanzel`: it is not on your PATH.",
    });
    // Claude Code is named the same way.
    vi.stubEnv("PATH", binScripts(tmp(), {}));
    const claude: unknown = await runHeadless(builtin("claude"), "x", tmp(), { write: false, timeoutSeconds: 30 }).catch(
      (caught: unknown) => caught,
    );
    expect(claude).toBeInstanceOf(NoAgentError);
    expect(claude).toMatchObject({ agent: "claude" });
  });

  it("a binary that can't be run is no missing agent", async () => {
    // A folder named as the binary is there but can't be run: spawning it fails with EACCES, not ENOENT.
    const refused = harnesses(
      settingsWith({ harnesses: { refused: { name: "refused", headless: [tmp(), "{prompt}"], interactive: [] } } }),
    ).refused as Harness;
    const error: unknown = await runHeadless(refused, "x", tmp(), { write: false, timeoutSeconds: 30 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error).not.toBeInstanceOf(NoAgentError);
    expect(error).toMatchObject({ message: expect.stringContaining(`Could not start \`${tmp()}\``) });
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

  describe("stops what the agent started, too", () => {
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /**
     * An agent that starts a helper process (an MCP server, a build) and never finishes. The agent
     * writes the helper's pid; the helper runs `helperCode`, then says it is ready.
     */
    const starter = (helperCode = "") => {
      const pidFile = join(tmp(), "helper.pid");
      const readyFile = join(tmp(), "helper.ready");
      const helper = `${helperCode}; require('fs').writeFileSync(${JSON.stringify(readyFile)}, ''); setInterval(() => {}, 1000)`;
      const harness = script(
        `const helper = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helper)}], { stdio: 'ignore' });` +
          ` require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(helper.pid)); setTimeout(() => {}, 30_000)`,
      );
      const helperPid = () => {
        const pid = Number(readFileSync(pidFile, "utf8"));
        pids.push(pid);
        return pid;
      };
      const ready = () => vi.waitFor(() => expect(existsSync(readyFile)).toBe(true), { timeout: 10_000 });
      return { harness, helperPid, ready };
    };
    const pids: number[] = [];
    afterEach(() => {
      for (const pid of pids.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
    });

    it("when it times out", async () => {
      const { harness, helperPid } = starter();
      const result = await runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 2 });
      expect(result.exitCode).toBe(124);
      const pid = helperPid();
      await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
    });

    it("when it is cancelled, even what ignores the polite signal", async () => {
      const { harness, helperPid, ready } = starter("process.on('SIGTERM', () => {})");
      const controller = new AbortController();
      const running = runHeadless(harness, "x", tmp(), { write: false, timeoutSeconds: 30, signal: controller.signal });
      await ready();
      const pid = helperPid();
      controller.abort();
      expect((await running).exitCode).toBe(130);
      await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 15_000 });
    });
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
