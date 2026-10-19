// Adapters for the agent CLIs the owner already pays for — Avanzel is a harness over harnesses.
//
// Every run happens with cwd = the library, so the harness picks up AGENTS.md / CLAUDE.md, and with
// the narrowest permissions each CLI offers: file tools only for Claude Code, the workspace sandbox
// for Codex, the library's opencode.json for OpenCode.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { AvanzelError } from "../types.ts";
import type { CustomHarness, Env, Settings } from "./config.ts";
import { which } from "./proc.ts";

export const BUILTIN_ORDER = ["claude", "codex", "opencode", "cursor-agent", "gemini"] as const;

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
}

export interface HarnessSpec {
  name: string;
  binary: string;
  headless: (prompt: string, vault: string, options: Required<HeadlessOptions>) => string[];
  interactive: (vault: string, model: string | null) => string[];
  readsOutputFile?: boolean;
  experimental?: boolean;
}

export class Harness {
  readonly name: string;
  readonly binary: string;
  readonly readsOutputFile: boolean;
  readonly experimental: boolean;
  readonly #spec: HarnessSpec;

  constructor(spec: HarnessSpec) {
    this.#spec = spec;
    this.name = spec.name;
    this.binary = spec.binary;
    this.readsOutputFile = spec.readsOutputFile ?? false;
    this.experimental = spec.experimental ?? false;
  }

  available(): boolean {
    return which(this.binary) !== null;
  }

  headlessArgv(prompt: string, vault: string, { write, model = null, outputFile, images = [] }: HeadlessOptions): string[] {
    return this.#spec.headless(prompt, vault, { write, model, outputFile, images });
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
}

export interface RunOptions {
  write: boolean;
  model?: string | null;
  timeoutSeconds: number;
  images?: readonly string[];
  signal?: AbortSignal;
}

function opt(flag: string, value: string | null): string[] {
  return value ? [flag, value] : [];
}

const BUILTINS: Readonly<Record<string, Harness>> = {
  claude: new Harness({
    name: "claude",
    binary: "claude",
    headless: (prompt, _vault, { write, model }) => {
      const tools = write ? "Read,Write,Edit,Glob,Grep" : "Read,Glob,Grep";
      // --tools limits which tools exist (--allowedTools only pre-approves them); --strict-mcp-config
      // keeps the owner's MCP servers out of the run. Claude reads screenshots with its Read tool.
      return [
        "claude", "-p", prompt, "--output-format", "text", "--tools", tools, "--allowedTools", tools,
        "--strict-mcp-config", ...(write ? ["--permission-mode", "acceptEdits"] : []), ...opt("--model", model),
      ];
    },
    interactive: (_vault, model) => ["claude", ...opt("--model", model)],
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

export function selectHarness(settings: Settings, requested?: string | null): Harness {
  const table = harnesses(settings);
  const choice = requested || settings.harness;
  if (choice === "auto") {
    for (const name of BUILTIN_ORDER) {
      const harness = table[name];
      if (harness?.available()) return harness;
    }
    throw new AvanzelError(
      "No agent CLI found. Install one of: Claude Code (claude), Codex (codex), OpenCode (opencode), " +
        "Cursor Agent (cursor-agent), Gemini CLI (gemini) — or add [harnesses.<name>] to .avanzel/config.toml.",
    );
  }
  const harness = Object.hasOwn(table, choice) ? table[choice] : undefined;
  if (!harness) throw new AvanzelError(`Unknown harness '${choice}'. Known harnesses: ${Object.keys(table).join(", ")}.`);
  if (!harness.available()) {
    const others = installed(settings).join(", ") || "none";
    throw new AvanzelError(`Harness '${choice}' needs \`${harness.binary}\` on your PATH. Installed harnesses: ${others}.`);
  }
  return harness;
}

// Words of the lines worth showing when an agent CLI fails. CLIs often print the whole prompt or a
// login banner before the line that matters.
const TELLING = [
  "error", "timed out", "sign in", "log in", "login", "not logged", "unauthorized", "authenticat", "api key",
  "quota", "rate limit",
];

/** The line of a failed run's output worth showing: the last error or login line, else the last line. */
export function errorLine(text: string): string {
  const rows = text.replace(ANSI, "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
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
  const { write, model = null, timeoutSeconds, images = [], signal } = options;
  const started = performance.now();
  const result = (exitCode: number, output: string, stderr: string): RunResult => ({
    exitCode,
    output: output.replace(ANSI, "").trim(),
    stderr,
    seconds: (performance.now() - started) / 1000,
    ok: exitCode === 0,
  });
  if (!isDirectory(vault)) throw new AvanzelError(`No such folder: ${vault}`);
  const cancelled = `${harness.name} was cancelled`;
  if (signal?.aborted) return result(130, "", cancelled);
  const tmp = mkdtempSync(join(tmpdir(), "avanzel-"));
  try {
    const outputFile = join(tmp, "last-message.txt");
    const argv = harness.headlessArgv(prompt, vault, { write, model, outputFile, images });
    const run = await collect(argv, vault, timeoutSeconds * 1000, signal);
    if (run.stopped === "timeout") {
      return result(124, run.stdout, `${run.stderr}\n${harness.name} timed out after ${timeoutSeconds}s`.trim());
    }
    if (run.stopped === "cancel") return result(130, run.stdout, `${run.stderr}\n${cancelled}`.trim());
    const output = harness.readsOutputFile && existsSync(outputFile) ? readFileSync(outputFile, "utf8") : run.stdout;
    return result(run.exitCode, output, run.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface Collected {
  exitCode: number;
  stdout: string;
  stderr: string;
  stopped: "timeout" | "cancel" | null;
}

function collect(argv: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<Collected> {
  const [file = "", ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: childEnv(process.env), stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stopped: Collected["stopped"] = null;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const stop = (why: "timeout" | "cancel") => {
      if (stopped) return;
      stopped = why;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
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
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
    };
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
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
        new AvanzelError(
          error.code === "ENOENT"
            ? `Could not start \`${file}\`: it is not on your PATH.`
            : `Could not start \`${file}\`: ${error.message}`,
        ),
      );
    });
    child.on("close", (code, signalName) => {
      cleanUp();
      resolve({
        exitCode: code ?? 128 + (signalName ? constants.signals[signalName] : 0),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stopped,
      });
    });
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
