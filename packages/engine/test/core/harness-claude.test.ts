import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ToolStep } from "../../src/core/claude-stream.ts";
import { Harness, checkAgent, classifyFailure, errorLine, harnesses, runHeadless, type RunOptions } from "../../src/core/harness.ts";
import { builtin, script, settingsWith } from "./harness-fixtures.ts";
import { binScripts, useTmp } from "./helpers.ts";

// A Claude Code filing run, one JSON event per line (see claude-stream.test.ts).
const FILING = fileURLToPath(new URL("../fixtures/claude-filing.jsonl", import.meta.url));
const tmp = useTmp();

describe("runHeadless with Claude Code", () => {
  // A stand-in `claude`, and nothing else, on PATH (so its script uses shell builtins and /bin/sleep). It prints what
  // Claude Code prints with --output-format stream-json: one JSON event per line.
  const onPath = (script: string) => vi.stubEnv("PATH", binScripts(tmp(), { claude: script }));
  /** The shell that prints each event as a line (no event here holds a single quote). */
  const print = (...events: string[]) => events.map((event) => `printf '%s\\n' '${event}'`).join("; ");
  const readEvent = (path: string) =>
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: path } }] },
    });
  /** Claude Code's answer to `readEvent`: the page was read. A read is a step only once it has this. */
  const readDone = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "# Index" }] },
  });
  const resultEvent = (result: string, isError = false) =>
    JSON.stringify({ type: "result", subtype: "success", is_error: isError, result, permission_denials: [] });
  const runClaude = (options: Partial<RunOptions> = {}) =>
    runHeadless(builtin("claude"), "x", tmp(), { write: true, timeoutSeconds: 30, ...options });
  /** The steps a run hands over, in order. */
  const collecting = () => {
    const steps: ToolStep[] = [];
    return { steps, onStep: (step: ToolStep) => void steps.push(step) };
  };

  it("a streaming run hands over each step before the agent exits", async () => {
    // The read and its answer first, then the wait: the step is there to hand over long before the agent is done.
    onPath(`${print(readEvent("/lib/index.md"), readDone)}; /bin/sleep 1; ${print(resultEvent("Filed."))}`);
    const steps: ToolStep[] = [];
    let stepAt = 0;
    const result = await runClaude({
      onStep: (step) => {
        steps.push(step);
        stepAt ||= performance.now();
      },
    });
    const finishedAt = performance.now();
    expect(result.ok).toBe(true);
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }]);
    expect(finishedAt - stepAt).toBeGreaterThanOrEqual(500); // of the 1 s it sleeps, with slack for a loaded Mac
  });

  it("Claude Code's reply is the result's text", async () => {
    onPath(print('{"type":"system","subtype":"init"}', readEvent("/lib/index.md"), resultEvent("Filed.")));
    expect(await runClaude()).toMatchObject({ ok: true, exitCode: 0, output: "Filed.", refused: [], rateLimit: null });
  });

  it("hands over a whole filing's steps, its reply and the writes it was refused", async () => {
    onPath(`/bin/cat '${FILING}'`);
    const { steps, onStep } = collecting();
    const result = await runClaude({ onStep });
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }, { kind: "search" }, { kind: "wrote", path: "/lib/ideas/podcast.md" }]);
    expect(result).toMatchObject({ ok: true, output: "Filed into [[podcast]].", refused: ["/lib/raw/2026/10/x.md"] });
  });

  it("a failed result fails the run and puts its words on stderr", async () => {
    onPath(print(resultEvent("Not logged in · Please run /login", true))); // then exits 0, as Claude Code can
    const result = await runClaude({ write: false });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(errorLine(result.stderr)).toBe("Not logged in · Please run /login");
    expect(result.output).toBe("Not logged in · Please run /login");
  });

  it("a failed result leaves the agent's own exit code be", async () => {
    onPath(`${print(resultEvent("Credit balance is too low", true))}; exit 3`);
    expect(await runClaude()).toMatchObject({ ok: false, exitCode: 3, stderr: "Credit balance is too low" });
  });

  it("a failed result without text puts its errors on stderr", async () => {
    // The error subtypes carry errors[] and no result; the person still needs a reason.
    onPath(
      `${print('{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Claude AI usage limit reached"]}')}; exit 1`,
    );
    const result = await runClaude();
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(errorLine(result.stderr)).toBe("Claude AI usage limit reached");
    expect(result.output).toBe("Claude AI usage limit reached");
  });

  /** Claude Code's rate_limit_event, as the filing fixture's first line has it (no single quote, for the shell). */
  const rateLimitEvent = (status: string, resetsAt?: number) =>
    JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status, ...(resetsAt && { resetsAt }), rateLimitType: "five_hour" } });

  it("a run that hit its usage limit has the rate limit Claude Code reported, which classifies it", async () => {
    const limit = "Claude AI usage limit reached|1792532400";
    onPath(`${print(rateLimitEvent("rejected", 1792532400), resultEvent(limit, true))}; exit 1`);
    const result = await runClaude();
    expect(result).toMatchObject({ ok: false, exitCode: 1, rateLimit: { status: "rejected", resetsAt: 1792532400000 } });
    expect(classifyFailure(result)).toEqual({ kind: "limit", resetsAt: 1792532400000, line: limit });
  });

  it("a rejected rate limit makes a limit of a failure whose words say nothing of one", async () => {
    onPath(`${print(rateLimitEvent("rejected", 1792532400), resultEvent("Something went wrong", true))}; exit 1`);
    expect(classifyFailure(await runClaude())).toEqual({ kind: "limit", resetsAt: 1792532400000, line: "Something went wrong" });
  });

  it("a run that went well reports the rate limit Claude Code last saw", async () => {
    onPath(`/bin/cat '${FILING}'`);
    expect(await runClaude()).toMatchObject({ ok: true, rateLimit: { status: "allowed", resetsAt: 1792532400000 } });
  });

  it("a run that takes too long, or is cancelled, keeps the rate limit it had seen", async () => {
    const allowed = { status: "allowed", resetsAt: 1792532400000 };
    // The step comes after the event, so the event has been read when the step is handed over. Both runs are ended then, by
    // the step and not by a clock that started when the stand-in did: a Mac under load can start it late enough for a real 1 s
    // limit to run out before it has printed anything, and the run then has no rate limit to keep.
    const withStep = `${print(rateLimitEvent("allowed", 1792532400), readEvent("/lib/index.md"), readDone)}; /bin/sleep 30`;

    // The run's own limit is run out at once, by moving its timer on (only its timers; the stand-in is a real process).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      onPath(withStep);
      const timedOut = await runClaude({ timeoutSeconds: 1, onStep: () => void vi.advanceTimersByTime(1000) });
      expect(timedOut).toMatchObject({ exitCode: 124, stderr: "claude timed out after 1s", rateLimit: allowed });
    } finally {
      vi.useRealTimers();
    }

    onPath(withStep);
    const controller = new AbortController();
    const cancelled = await runClaude({ signal: controller.signal, onStep: () => controller.abort() });
    expect(cancelled).toMatchObject({ exitCode: 130, rateLimit: allowed });
  });

  it("another agent's output has no rate limit, even when it looks like Claude Code's", async () => {
    const event = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1792532400 } };
    const lookalike = script(`console.log(JSON.stringify(${JSON.stringify(event)})); process.exitCode = 1`);
    expect(await runHeadless(lookalike, "x", tmp(), { write: false, timeoutSeconds: 30 })).toMatchObject({ ok: false, rateLimit: null });
  });

  it("a Claude Code that prints plain text is read as before", async () => {
    onPath("echo 'Not logged in · Please run /login'; exit 1");
    const result = await runClaude();
    expect(result).toMatchObject({ ok: false, exitCode: 1, output: "Not logged in · Please run /login", refused: [] });
  });

  it("reads a plain reply whole: both kinds of line end, blank lines, and a last line without one", async () => {
    onPath("printf 'first\\r\\nsecond\\n\\nthird'");
    expect((await runClaude()).output).toBe("first\nsecond\n\nthird");
  });

  it("the last event counts even without a line end", async () => {
    onPath(`printf '%s' '${resultEvent("Filed.")}'`);
    expect((await runClaude()).output).toBe("Filed.");
  });

  it("a line split across two writes is one step", async () => {
    const line = readEvent("/lib/index.md");
    const half = Math.floor(line.length / 2);
    onPath(`printf '%s' '${line.slice(0, half)}'; /bin/sleep 0.2; printf '%s\\n' '${line.slice(half)}'; ${print(readDone, resultEvent("Filed."))}`);
    const { steps, onStep } = collecting();
    await runClaude({ onStep });
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }]);
  });

  it("a character split across two writes arrives whole", async () => {
    const bytes = Buffer.from(`${readEvent("/lib/café.md")}\n`);
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const octal = (part: Buffer) => [...part].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
    onPath(`printf '${octal(bytes.subarray(0, cut))}'; /bin/sleep 0.2; printf '${octal(bytes.subarray(cut))}'; ${print(readDone)}`);
    const { steps, onStep } = collecting();
    await runClaude({ onStep });
    expect(steps).toEqual([{ kind: "read", path: "/lib/café.md" }]);
  });

  it("a cancelled run keeps its code and message, and the steps it had handed over", async () => {
    onPath(`${print(readEvent("/lib/index.md"), readDone)}; /bin/sleep 30`);
    const controller = new AbortController();
    const steps: ToolStep[] = [];
    const result = await runClaude({
      signal: controller.signal,
      onStep: (step) => {
        steps.push(step);
        controller.abort();
      },
    });
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }]);
    expect(result).toMatchObject({ ok: false, exitCode: 130, stderr: "claude was cancelled", output: "", refused: [] });
    expect(result.seconds).toBeLessThan(10);
  });

  it("a run that takes too long keeps its code and message", async () => {
    onPath(`${print(readEvent("/lib/index.md"))}; /bin/sleep 30`);
    const result = await runClaude({ timeoutSeconds: 1 });
    expect(result).toMatchObject({ ok: false, exitCode: 124, stderr: "claude timed out after 1s", output: "", refused: [] });
    expect(result.seconds).toBeLessThan(10);
  });

  it("leaves another agent's output alone, even when it looks like Claude Code's", async () => {
    const lookalike = script(`console.log(JSON.stringify({ type: "result", is_error: true, result: "not for you" }))`);
    const { steps, onStep } = collecting();
    const result = await runHeadless(lookalike, "x", tmp(), { write: false, timeoutSeconds: 30, onStep });
    expect(result).toMatchObject({ ok: true, exitCode: 0, refused: [] });
    expect(result.output).toBe('{"type":"result","is_error":true,"result":"not for you"}');
    expect(steps).toEqual([]);
  });

  /** The shell that writes the agent's arguments into the library, one to a line (no argument here holds a newline). */
  const recordArgs = `printf '%s\\n' "$@" > ARGV`;
  const recordedArgs = () => readFileSync(join(tmp(), "ARGV"), "utf8").split("\n");
  /** The arguments `run` gave its agent: ARGV goes first, so what is read can't be an earlier run's. */
  const argsOf = async (run: () => Promise<unknown>): Promise<string[]> => {
    rmSync(join(tmp(), "ARGV"), { force: true });
    await run();
    return recordedArgs();
  };
  /** The --settings the agent was given, parsed. */
  const recordedSettings = () => {
    const args = recordedArgs();
    return JSON.parse(args[args.indexOf("--settings") + 1] ?? "") as {
      permissions: { deny: string[] };
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
  };

  it("Claude Code's write runs carry the guard; reads and other agents don't", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { claude: recordArgs, codex: recordArgs }));
    await argsOf(() => runClaude());
    expect(recordedSettings().permissions.deny.length).toBeGreaterThan(0);
    expect(await argsOf(() => runClaude({ write: false }))).not.toContain("--settings");
    const codex = await argsOf(() => runHeadless(builtin("codex"), "x", tmp(), { write: true, timeoutSeconds: 30 }));
    expect(codex[0]).toBe("exec"); // Codex's own arguments
    expect(codex).not.toContain("--settings");
    // Only the built-in Claude Code is guarded: not another agent, nor a custom harness that takes its name.
    expect(builtin("claude").guard).toBe(true);
    for (const name of ["codex", "opencode", "cursor-agent", "gemini"]) expect(builtin(name).guard).toBe(false);
    const mine = { name: "claude", headless: ["claude", "-p", "{prompt}"], interactive: [] };
    expect((harnesses(settingsWith({ harnesses: { claude: mine } })).claude as Harness).guard).toBe(false);
  });

  it("the hook works during the run and is gone after", async () => {
    // A stand-in Claude Code that runs its own hook, as Claude Code does before a Write of raw/x.md, and replies with
    // what the hook said. (Shell-quoted, so no single quote in it.)
    const standIn = [
      'const args = process.argv; const settings = JSON.parse(args[args.indexOf("--settings") + 1]);',
      "const { command } = settings.hooks.PreToolUse[0].hooks[0];",
      'const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: process.cwd() + "/raw/x.md" }, cwd: process.cwd() });',
      'const said = require("child_process").execFileSync("/bin/sh", ["-c", command], { input, encoding: "utf8" });',
      'console.log(JSON.stringify({ type: "result", is_error: false, result: said }));',
    ].join(" ");
    onPath(`${recordArgs}; exec '${process.execPath}' -e '${standIn}' -- "$@"`);
    const result = await runClaude();
    expect(result.output).toContain('"permissionDecision":"deny"');
    const command = recordedSettings().hooks.PreToolUse[0]?.hooks[0]?.command ?? "";
    const script = /'([^']*\/guard-hook\.mjs)'/.exec(command)?.[1] ?? "";
    expect(script).not.toBe("");
    expect(existsSync(script)).toBe(false);
  });

  // `claude auth status` says nothing a check understands here, so the check asks Claude Code one short question.
  const authUnknown = `if [ "$1" = auth ]; then echo "unknown command"; exit 1; fi; `;

  it("the agent check understands Claude Code's stream", async () => {
    onPath(authUnknown + print('{"type":"system","subtype":"init"}', resultEvent("ready")));
    expect(await checkAgent(builtin("claude"), tmp())).toMatchObject({ ok: true, how: "replied" });
  });

  it("the agent check finds a signed-out Claude Code in its stream", async () => {
    onPath(authUnknown + print(resultEvent("Not logged in · Please run /login", true)));
    expect(await checkAgent(builtin("claude"), tmp())).toMatchObject({
      ok: false,
      why: "signed-out",
      detail: "Not logged in · Please run /login",
    });
  });
});
