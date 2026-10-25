import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Harness, harnesses, runHeadless } from "../../src/core/harness.ts";
import { AvanzelError } from "../../src/types.ts";
import { script, settingsWith } from "./harness-fixtures.ts";
import { useTmp } from "./helpers.ts";

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
