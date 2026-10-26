// Adapters for the agent CLIs the owner already pays for — Avanzel is a harness over harnesses.
//
// Every run happens with cwd = the library, so the harness picks up AGENTS.md / CLAUDE.md, and with
// the narrowest permissions each CLI offers: file tools only for Claude Code, the workspace sandbox
// for Codex, the library's opencode.json for OpenCode. Claude Code's write runs also carry the write
// guard (guard-hook.ts), which refuses writes to the owner's words and the library's settings.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { AvanzelError } from "../types.ts";
import { ClaudeStream, type RateLimit, type ToolStep } from "./claude-stream.ts";
import type { CustomHarness, Env, Settings } from "./config.ts";
import { guardSettings, installHook } from "./guard-hook.ts";
import { which } from "./proc.ts";

// A run's result carries it, so it is offered here as well as where it is read.
export type { RateLimit } from "./claude-stream.ts";

export const BUILTIN_ORDER = ["claude", "codex", "opencode", "cursor-agent", "gemini"] as const;

// The built-in agents by the names a person knows them by, as the apps show them.
const AGENT_NAMES: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  "cursor-agent": "Cursor Agent",
  gemini: "Gemini CLI",
};

/** `harness`'s name as a person reads it: "Claude Code" for "claude". A harness of the library's own goes by its own name. */
export function agentName(harness: string): string {
  return Object.hasOwn(AGENT_NAMES, harness) ? (AGENT_NAMES[harness] ?? harness) : harness;
}

// Variables that tie a process to the Claude Code session that spawned it. Avanzel is often run
// *from* a Claude Code session (via the skill); the nested harness must start a fresh session.
const SESSION_VARS: ReadonlySet<string> = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);
const ANSI = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const KILL_AFTER_MS = 5_000;
// After the agent exits, how long its output may stay open (held by something it started).
const EXIT_GRACE_MS = 1_000;
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout fires at once beyond this

export interface HeadlessOptions {
  write: boolean;
  model?: string | null;
  /** Where the CLI may write its final message (read when `readsOutputFile`). */
  outputFile: string;
  /** Screenshots to attach, for CLIs that take images on the command line. */
  images?: readonly string[];
  /** Settings JSON for a write run, for CLIs that take it on the command line (Claude Code's `--settings`). */
  settings?: string | null;
}

/** A command that says whether an agent is signed in, which asks the model nothing. */
export interface SignInCheck {
  argv: readonly string[];
  /** One stream of what the command printed, with its exit code: signed in (true), signed out (false), or neither (null). */
  signedIn(output: string, exitCode: number): boolean | null;
}

export interface HarnessSpec {
  name: string;
  binary: string;
  headless: (prompt: string, vault: string, options: Required<HeadlessOptions>) => string[];
  interactive: (vault: string, model: string | null) => string[];
  readsOutputFile?: boolean;
  experimental?: boolean;
  /** Whether a run's stdout is Claude Code's stream-json, which a `ClaudeStream` reads as it arrives. */
  streams?: boolean;
  /** The agent's own sign-in status command, when it has one. */
  signIn?: SignInCheck;
  /**
   * Whether a write run carries the write guard (`guardSettings`), which refuses writes to the owner's words, the
   * library's settings and anything outside the library before they happen. Only Claude Code takes it.
   */
  guard?: boolean;
}

export class Harness {
  readonly name: string;
  readonly binary: string;
  readonly readsOutputFile: boolean;
  readonly experimental: boolean;
  readonly streams: boolean;
  readonly signIn: SignInCheck | undefined;
  readonly guard: boolean;
  readonly #spec: HarnessSpec;

  constructor(spec: HarnessSpec) {
    this.#spec = spec;
    this.name = spec.name;
    this.binary = spec.binary;
    this.readsOutputFile = spec.readsOutputFile ?? false;
    this.experimental = spec.experimental ?? false;
    this.streams = spec.streams ?? false;
    this.signIn = spec.signIn;
    this.guard = spec.guard ?? false;
  }

  available(): boolean {
    return which(this.binary) !== null;
  }

  headlessArgv(
    prompt: string,
    vault: string,
    { write, model = null, outputFile, images = [], settings = null }: HeadlessOptions,
  ): string[] {
    return this.#spec.headless(prompt, vault, { write, model, outputFile, images, settings });
  }

  interactiveArgv(vault: string, { model = null }: { model?: string | null } = {}): string[] {
    return this.#spec.interactive(vault, model);
  }
}

export interface RunResult {
  exitCode: number;
  output: string;
  stderr: string;
  seconds: number;
  ok: boolean;
  /** The paths of the writes the agent was refused, as it gave them. Only Claude Code reports these; the rest give []. */
  refused: string[];
  /**
   * The last rate limit the agent reported, even for a run that went well. Only Claude Code's stream reports one; the
   * rest give null.
   */
  rateLimit: RateLimit | null;
}

export interface RunOptions {
  write: boolean;
  model?: string | null;
  timeoutSeconds: number;
  images?: readonly string[];
  signal?: AbortSignal;
  /** Called with each thing the agent does, as it happens, for an agent whose output `streams`. */
  onStep?: (step: ToolStep) => void;
}

function opt(flag: string, value: string | null): string[] {
  return value ? [flag, value] : [];
}

// `claude auth status` prints JSON that also holds the account's email and organisation; only
// `loggedIn` is read, and nothing else is kept.
function claudeSignedIn(output: string): boolean | null {
  try {
    const status: unknown = JSON.parse(output);
    const loggedIn = typeof status === "object" && status !== null ? (status as { loggedIn?: unknown }).loggedIn : undefined;
    return loggedIn === true || loggedIn === false ? loggedIn : null;
  } catch {
    return null; // not JSON
  }
}

// `codex login status` says "Logged in using …", or "Not logged in" and exits 1, so "not" goes first.
function codexSignedIn(output: string, exitCode: number): boolean | null {
  if (/not logged in/i.test(output)) return false;
  return exitCode === 0 && /logged in/i.test(output) ? true : null;
}

const BUILTINS: Readonly<Record<string, Harness>> = {
  claude: new Harness({
    name: "claude",
    binary: "claude",
    headless: (prompt, _vault, { write, model, settings }) => {
      const tools = write ? "Read,Write,Edit,Glob,Grep" : "Read,Glob,Grep";
      // --tools limits which tools exist (--allowedTools only pre-approves them); --strict-mcp-config
      // keeps the owner's MCP servers out of the run. Claude reads screenshots with its Read tool.
      // stream-json prints each tool call as it happens (`streams`), and -p refuses it without --verbose.
      return [
        "claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--tools", tools, "--allowedTools", tools,
        "--strict-mcp-config", ...(write ? ["--permission-mode", "acceptEdits", ...opt("--settings", settings)] : []),
        ...opt("--model", model),
      ];
    },
    interactive: (_vault, model) => ["claude", ...opt("--model", model)],
    streams: true,
    signIn: { argv: ["claude", "auth", "status"], signedIn: claudeSignedIn },
    guard: true,
  }),
  codex: new Harness({
    name: "codex",
    binary: "codex",
    // `-i` takes several values, so `--` ends the images before the prompt.
    headless: (prompt, vault, { write, model, outputFile, images }) => [
      "codex", "exec", "--cd", vault, "--skip-git-repo-check", "--color", "never",
      "--sandbox", write ? "workspace-write" : "read-only", "-o", outputFile, ...opt("-m", model),
      ...(images.length ? [...images.flatMap((image) => ["-i", image]), "--"] : []), prompt,
    ],
    interactive: (vault, model) => ["codex", "--cd", vault, ...opt("-m", model)],
    readsOutputFile: true,
    signIn: { argv: ["codex", "login", "status"], signedIn: codexSignedIn },
  }),
  opencode: new Harness({
    name: "opencode",
    binary: "opencode",
    // `-f` takes several values, so the files come after the prompt.
    headless: (prompt, vault, { model, images }) => [
      "opencode", "run", "--dir", vault, ...opt("-m", model), prompt, ...images.flatMap((image) => ["-f", image]),
    ],
    interactive: (vault, model) => ["opencode", vault, ...opt("-m", model)],
  }),
  "cursor-agent": new Harness({
    name: "cursor-agent",
    binary: "cursor-agent",
    // Print mode only proposes edits without --force.
    headless: (prompt, _vault, { write, model }) => [
      "cursor-agent", "-p", ...(write ? ["--force"] : []), "--output-format", "text", ...opt("--model", model), prompt,
    ],
    interactive: (_vault, model) => ["cursor-agent", ...opt("--model", model)],
  }),
  gemini: new Harness({
    name: "gemini",
    binary: "gemini",
    headless: (prompt, _vault, { write, model }) => [
      "gemini", "-p", prompt, "--approval-mode", write ? "auto_edit" : "default", ...opt("-m", model),
    ],
    interactive: (_vault, model) => ["gemini", ...opt("-m", model)],
    experimental: true,
  }),
};

export function customHarness(spec: CustomHarness): Harness {
  const fill = (parts: readonly string[], prompt: string, vault: string) =>
    parts.map((part) => part.replace(/\{(prompt|vault)\}/g, (_, key: string) => (key === "prompt" ? prompt : vault)));
  return new Harness({
    name: spec.name,
    binary: spec.headless[0] ?? "",
    headless: (prompt, vault) => fill(spec.headless, prompt, vault),
    interactive: (vault) => fill(spec.interactive, "", vault),
  });
}

/** Every harness by name: the built-in ones, then the owner's (which may replace a built-in). */
export function harnesses(settings: Settings): Record<string, Harness> {
  const table: Record<string, Harness> = { ...BUILTINS };
  for (const [name, spec] of Object.entries(settings.harnesses)) table[name] = customHarness({ ...spec, name });
  return table;
}

export function installed(settings: Settings): string[] {
  return Object.entries(harnesses(settings))
    .filter(([, harness]) => harness.available())
    .map(([name]) => name);
}

/**
 * The agent a run needs isn't there. `agent` names the harness that was asked for ("claude") when it is unknown, isn't on
 * PATH, or was gone when it was started; it is null when none is installed at all.
 */
export class NoAgentError extends AvanzelError {
  override name = "NoAgentError";
  readonly agent: string | null;

  constructor(message: string, agent: string | null = null) {
    super(message);
    this.agent = agent;
  }
}

export function selectHarness(settings: Settings, requested?: string | null): Harness {
  const table = harnesses(settings);
  const choice = requested || settings.harness;
  if (choice === "auto") {
    for (const name of BUILTIN_ORDER) {
      const harness = table[name];
      if (harness?.available()) return harness;
    }
    throw new NoAgentError(
      "No agent CLI found. Install one of: Claude Code (claude), Codex (codex), OpenCode (opencode), " +
        "Cursor Agent (cursor-agent), Gemini CLI (gemini) — or add [harnesses.<name>] to .avanzel/config.toml.",
    );
  }
  const harness = Object.hasOwn(table, choice) ? table[choice] : undefined;
  if (!harness) {
    throw new NoAgentError(`Unknown harness '${choice}'. Known harnesses: ${Object.keys(table).join(", ")}.`, choice);
  }
  if (!harness.available()) {
    const others = installed(settings).join(", ") || "none";
    throw new NoAgentError(`Harness '${choice}' needs \`${harness.binary}\` on your PATH. Installed harnesses: ${others}.`, choice);
  }
  return harness;
}

// Words of the lines worth showing when an agent CLI fails. CLIs often print the whole prompt or a
// login banner before the line that matters.
const TELLING = [
  "error", "timed out", "sign in", "log in", "login", "not logged", "unauthorized", "authenticat", "api key",
  "quota", "rate limit",
];

/** The lines of `text` that say something: without colours, trimmed, and not blank. */
function rowsOf(text: string): string[] {
  return text.replace(ANSI, "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
}

/** The line of a failed run's output worth showing: the last error or login line, else the last line. */
export function errorLine(text: string): string {
  const rows = rowsOf(text);
  const telling = rows.filter((row) => TELLING.some((word) => row.toLowerCase().includes(word)));
  return Array.from(telling.at(-1) ?? rows.at(-1) ?? "").slice(0, 300).join("");
}

export function childEnv(env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !SESSION_VARS.has(entry[0])),
  );
}

/** Run one non-interactive agent turn inside the library and return its final message. */
export async function runHeadless(harness: Harness, prompt: string, vault: string, options: RunOptions): Promise<RunResult> {
  const { write, model = null, timeoutSeconds, images = [], signal, onStep } = options;
  const started = performance.now();
  const result = (
    exitCode: number,
    output: string,
    stderr: string,
    refused: string[] = [],
    rateLimit: RateLimit | null = null,
  ): RunResult => ({
    exitCode,
    output: output.replace(ANSI, "").trim(),
    stderr,
    seconds: (performance.now() - started) / 1000,
    ok: exitCode === 0,
    refused,
    rateLimit,
  });
  if (!isDirectory(vault)) throw new AvanzelError(`No such folder: ${vault}`);
  const cancelled = `${harness.name} was cancelled`;
  if (signal?.aborted) return result(130, "", cancelled);
  const tmp = mkdtempSync(join(tmpdir(), "avanzel-"));
  try {
    const outputFile = join(tmp, "last-message.txt");
    // A guarded write run is refused writes to the owner's words and the library's settings before they happen. Its
    // hook goes into this run's own folder, so it is gone with it.
    const settings = write && harness.guard ? guardSettings(vault, installHook(tmp, vault)) : null;
    const argv = harness.headlessArgv(prompt, vault, { write, model, outputFile, images, settings });
    // Claude Code prints a JSON event per line. Reading them as they arrive hands over each step while the agent works,
    // and its reply is the result event's text: what comes back as `output` is plain text, as for every other agent.
    const stream = harness.streams ? new ClaudeStream(onStep ?? (() => {})) : null;
    const run = await collect(
      argv,
      vault,
      timeoutSeconds * 1000,
      signal,
      stream ? (line) => stream.line(line) : undefined,
      harness.name,
    );
    const stdout = stream ? stream.reply : run.stdout;
    const refused = stream ? stream.refused : [];
    const rateLimit = stream ? stream.rateLimit : null;
    if (run.stopped === "timeout") {
      return result(124, stdout, `${run.stderr}\n${harness.name} timed out after ${timeoutSeconds}s`.trim(), refused, rateLimit);
    }
    if (run.stopped === "cancel") return result(130, stdout, `${run.stderr}\n${cancelled}`.trim(), refused, rateLimit);
    if (stream?.failed) {
      // The result says the run failed, whatever the exit code. Its words are what a plain run printed, so they go where
      // the error line is read.
      return result(run.exitCode || 1, stdout, `${run.stderr}\n${stream.reply}`.trim(), refused, rateLimit);
    }
    const output = harness.readsOutputFile && existsSync(outputFile) ? readFileSync(outputFile, "utf8") : stdout;
    return result(run.exitCode, output, run.stderr, refused, rateLimit);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * What a check of an agent found: that it works (signed in, or it replied), or why it doesn't. `unknown` comes only
 * from a check that may not ask the model (`prompt: false`): the agent's status command didn't say (it printed nothing
 * the check understands, ran out of time, couldn't start or was stopped), or the agent has none, and nothing was asked.
 */
export type AgentCheck =
  | { ok: true; how: "signed-in" | "replied"; seconds: number }
  | { ok: false; why: "signed-out" | "timeout" | "failed" | "unknown"; detail: string; seconds: number };

export interface CheckOptions {
  /** For the status command, and again for the prompt; 15 s unless given. */
  timeoutSeconds?: number;
  signal?: AbortSignal;
  /**
   * Whether the check may ask the agent one short question, which costs its owner's quota, when it has no status
   * command or its status doesn't say. Without (`false`) the check is `unknown` then. Defaults to true.
   */
  prompt?: boolean;
}

const CHECK_PROMPT = "Reply with the single word: ready.";
const SIGN_IN_LINE = /sign in|log in|login|not logged|unauthori[sz]ed|authenticat/i;

/** Whether a failed run's telling line (`errorLine`) is the agent asking its owner to sign in. */
export function asksToSignIn(line: string): boolean {
  return SIGN_IN_LINE.test(line);
}

/**
 * Why a run failed, as far as a person needs to tell: it hit a usage limit (`limit`), wants a sign-in (`signin`), ran
 * out of time and was stopped (`timeout`), or failed some other way (`other`).
 */
export type RunFailureKind = "limit" | "signin" | "timeout" | "other";

export interface RunFailure {
  kind: RunFailureKind;
  /** When a usage limit resets, in epoch ms, if the agent said; null when it didn't, and for every other kind. */
  resetsAt: number | null;
  /** The line of the run's output worth showing (`errorLine`). */
  line: string;
}

// The words of a usage limit, as the agents are expected to print it. None has been seen at a real limit on this Mac, so
// these are the shapes to expect, for a real limit to confirm. A 429 counts only as an HTTP status ("HTTP 429", "status: 429",
// "API Error: 429", "429 Too Many Requests"): a bare 429 may be anything, such as a line number in a crash's stack.
const USAGE_LIMIT = /usage limit|rate limit|limit reached|hit your limit|quota|too many requests|\b(?:HTTP|status|code|error)\s*[:=]?\s*429\b|\b429 too many/i;
// How Claude Code ends its limit message: a bar and the reset in epoch seconds ("Claude AI usage limit reached|1792532400").
const RESET_SUFFIX = /\|(\d{10})$/;
// A limit is looked for in this many of the last lines. Before them is what an agent echoed back (Codex prints the whole
// prompt on stderr, and the prompt holds the capture's slug or the question).
const TAIL_LINES = 5;

/**
 * Classifies a run that failed (the caller has checked `result.ok`), first match winning:
 * - `limit`: the stream's rate limit was rejected, or the last lines of its output name a usage limit. Its `resetsAt` is
 *   the stream's, whatever its status; else the epoch seconds that end a line (`…|1792532400`); else null. A time such as
 *   "try again at 3:05 PM" isn't read, since its date and zone aren't known.
 * - `timeout`: the run was stopped for its time (exit 124).
 * - `signin`: the telling line (`errorLine`) asks to sign in, as a failed check reads it.
 * - `other`.
 *
 * A limit is read from the last lines only, so that what the agent echoed can't pass for one. A sign-in is read from the
 * telling line, which is the last error or login line wherever it stands, as the agent check reads it.
 */
export function classifyFailure(result: RunResult): RunFailure {
  const text = `${result.output}\n${result.stderr}`;
  const line = errorLine(text);
  const tail = rowsOf(text).slice(-TAIL_LINES);
  if (result.rateLimit?.status === "rejected" || USAGE_LIMIT.test(tail.join("\n"))) {
    return { kind: "limit", resetsAt: result.rateLimit?.resetsAt ?? resetFrom(tail), line };
  }
  if (result.exitCode === 124) return { kind: "timeout", resetsAt: null, line };
  if (asksToSignIn(line)) return { kind: "signin", resetsAt: null, line };
  return { kind: "other", resetsAt: null, line };
}

/** The reset in epoch ms that the last of `rows` to end in one gives, or null. */
function resetFrom(rows: readonly string[]): number | null {
  for (const row of [...rows].reverse()) {
    const seconds = RESET_SUFFIX.exec(row)?.[1];
    if (seconds) return Number(seconds) * 1000;
  }
  return null;
}

/**
 * Check that an agent works: read its sign-in from its status command when it has one. When it has none, or the
 * status doesn't say, ask it one short question, unless `prompt` is false.
 */
export async function checkAgent(
  harness: Harness,
  vault: string,
  { timeoutSeconds = 15, signal, prompt = true }: CheckOptions = {},
): Promise<AgentCheck> {
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;
  if (harness.signIn && !signal?.aborted) {
    const signedIn = await readSignIn(harness.signIn, vault, timeoutSeconds, signal);
    if (signedIn === true) return { ok: true, how: "signed-in", seconds: elapsed() };
    if (signedIn === false) return { ok: false, why: "signed-out", detail: "", seconds: elapsed() };
  }
  if (!prompt) return { ok: false, why: "unknown", detail: "", seconds: elapsed() };
  try {
    const run = await runHeadless(harness, CHECK_PROMPT, vault, { write: false, timeoutSeconds, signal });
    if (run.ok) return { ok: true, how: "replied", seconds: run.seconds };
    const detail = errorLine(`${run.output}\n${run.stderr}`);
    // 124 is what runHeadless reports for a run that ran out of time.
    const why = run.exitCode === 124 ? "timeout" : asksToSignIn(detail) ? "signed-out" : "failed";
    return { ok: false, why, detail, seconds: run.seconds };
  } catch (error) {
    if (!(error instanceof AvanzelError)) throw error;
    return { ok: false, why: "failed", detail: error.message, seconds: elapsed() };
  }
}

// What the agent's status command says: signed in (true), signed out (false), or null when it says
// neither, can't start or is stopped; then only a check that may ask (`prompt`) finds out more.
async function readSignIn(signIn: SignInCheck, vault: string, timeoutSeconds: number, signal?: AbortSignal): Promise<boolean | null> {
  const status = await collect(signIn.argv, vault, timeoutSeconds * 1000, signal).catch((error: unknown) => {
    if (error instanceof AvanzelError) return null;
    throw error;
  });
  if (!status || status.stopped) return null;
  // Claude Code answers on stdout, Codex on stderr.
  return signIn.signedIn(status.stdout, status.exitCode) ?? signIn.signedIn(status.stderr, status.exitCode);
}

interface Collected {
  exitCode: number;
  stdout: string;
  stderr: string;
  stopped: "timeout" | "cancel" | null;
}

/**
 * Runs `argv` and collects what it printed. `onLine` is given each line of stdout as it arrives, without its line end
 * (`\n` or `\r\n`), and the last one at close if it had none; stdout is still collected whole. A program that is not
 * there rejects with a `NoAgentError` that names `agent`, the harness the run is for.
 */
function collect(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onLine?: (line: string) => void,
  agent: string | null = null,
): Promise<Collected> {
  const [file = "", ...args] = argv;
  return new Promise((resolve, reject) => {
    // In a process group of its own, so stopping the agent stops whatever it started too.
    const child = spawn(file, args, { cwd, env: childEnv(process.env), stdio: ["ignore", "pipe", "pipe"], detached: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stopped: Collected["stopped"] = null;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const signalGroup = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, name);
      } catch {
        // the whole group is gone already
      }
    };
    const stop = (why: "timeout" | "cancel") => {
      if (stopped) return;
      stopped = why;
      signalGroup("SIGTERM");
      // Whatever ignores that is killed, even once the agent itself is gone; nobody waits for it.
      killTimer = setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS);
      killTimer.unref();
    };
    const timeout = setTimeout(() => stop("timeout"), Math.min(timeoutMs, MAX_TIMER_MS));
    const onAbort = () => stop("cancel");
    signal?.addEventListener("abort", onAbort, { once: true });
    const exited = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const cleanUp = () => {
      exited();
      clearTimeout(graceTimer);
    };
    const lines = onLine ? lineSplitter(onLine) : null;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      lines?.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // Something the agent started may hold its output open long after it exited; don't wait for that.
    child.on("exit", () => {
      exited(); // a run that finished is not timed out or cancelled while its output drains
      graceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, EXIT_GRACE_MS);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      cleanUp();
      reject(
        error.code === "ENOENT"
          ? new NoAgentError(`Could not start \`${file}\`: it is not on your PATH.`, agent)
          : new AvanzelError(`Could not start \`${file}\`: ${error.message}`),
      );
    });
    child.on("close", (code, signalName) => {
      cleanUp();
      lines?.end();
      resolve({
        exitCode: code ?? 128 + (signalName ? constants.signals[signalName] : 0),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stopped,
      });
    });
  });
}

/**
 * Cuts what a process prints into lines as the chunks arrive. `\n` or `\r\n` ends a line, a character that two chunks
 * split stays whole, and `end()` gives the last line if it had no line end.
 */
function lineSplitter(onLine: (line: string) => void): { write(chunk: Buffer): void; end(): void } {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  return {
    write(chunk) {
      const text = rest + decoder.write(chunk);
      let start = 0;
      for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
        const line = text.slice(start, end);
        onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
        start = end + 1;
      }
      rest = text.slice(start);
    },
    end() {
      const last = rest + decoder.end();
      rest = "";
      if (last) onLine(last);
    },
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
