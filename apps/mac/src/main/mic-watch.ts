// Which apps hold the microphone: avanzel-calltap's `--watch-mic` mode prints a JSON line on stderr when it starts and each
// time the set of processes recording from a microphone changes. MicWatch runs it for as long as Avanzel does, passes the
// holders on, and starts it again if it stops by itself. What to do with the holders (offer call notes) is decided elsewhere.
import { spawn, type ChildProcess } from "node:child_process";
import { CallTap } from "./calltap.ts";

/** A process that records from a microphone; `bundle`, `appPid`, `app` and `path` are null where macOS doesn't say. */
export interface MicHolder {
  pid: number;
  bundle: string | null;
  appPid: number | null;
  app: string | null;
  path: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/**
 * The holders in one line of the helper's stderr, or null when the line isn't a `mic` line (a `stopped` line, noise, bad JSON) or
 * a holder has no numeric pid. A line the helper may have garbled is skipped whole rather than half-believed, so a wrong set is
 * never passed on.
 */
export function parseMicLine(line: string): MicHolder[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { event, holders } = parsed as Record<string, unknown>;
  if (event !== "mic" || !Array.isArray(holders)) return null;
  const result: MicHolder[] = [];
  for (const holder of holders) {
    if (typeof holder !== "object" || holder === null) return null;
    const fields = holder as Record<string, unknown>;
    const pid = num(fields.pid);
    if (pid === null) return null;
    result.push({ pid, bundle: text(fields.bundle), appPid: num(fields.appPid), app: text(fields.app), path: text(fields.path) });
  }
  return result;
}

const KILL_AFTER_MS = 3_000;
/** Exits further apart than this don't count together towards the cap. */
const EXIT_WINDOW_MS = 10 * 60_000;

/**
 * Keeps `avanzel-calltap --watch-mic` running and reports who holds the microphone. When the helper exits by itself it says
 * nobody does (`onHolders([])`, so a stale holder is never believed) and starts it again after `restartMs`; if it keeps
 * exiting, more than `maxRestarts` times within ten minutes, it stops trying and warns once, since a helper that can't stay up
 * would only spin.
 */
export class MicWatch {
  private active = false;
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** When the helper recently exited by itself, newest last. */
  private exits: number[] = [];
  /** Resolves when the helper last spawned has closed. */
  private closed: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: {
      onHolders(holders: MicHolder[]): void;
      /** Where the helper is; defaults to the one CallTap uses. */
      binaryPath?: () => string;
      /** How long to wait before starting the helper again after it exits. */
      restartMs?: number;
      /** How many exits within ten minutes are answered with a restart; one more and the watch gives up. */
      maxRestarts?: number;
    },
  ) {}

  /** Whether the watch is on: started, not stopped, and not given up. A restart that is waiting counts as on. */
  get running(): boolean {
    return this.active;
  }

  /** Starts the helper. Does nothing if the watch is already on. A helper that can't be started counts as an exit; this never throws. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.exits = [];
    this.spawnHelper();
  }

  /** Ends the helper (SIGTERM, then SIGKILL after a while), cancels any waiting restart, and resolves once the helper has closed. Fine to call when not running. */
  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null; // its lines and its exit no longer count
    if (!child) return this.closed;
    this.opts.onHolders([]);
    this.terminate(child);
    return this.closed;
  }

  private spawnHelper(): void {
    let child: ChildProcess;
    try {
      child = spawn((this.opts.binaryPath ?? CallTap.binaryPath)(), ["--watch-mic"], { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      this.exited(null);
      return;
    }
    this.child = child;
    let release!: () => void;
    this.closed = new Promise<void>((resolve) => (release = resolve));

    let buffered = "";
    const line = (value: string): void => {
      if (this.child !== child) return;
      const holders = parseMicLine(value);
      if (holders) this.opts.onHolders(holders);
    };

    // Node emits `close` after `error` too (a failed spawn emits both), and the `ended` guard ends the child once.
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      if (buffered.trim()) line(buffered);
      release();
      this.exited(child);
    };
    child.on("error", end);
    child.on("close", end);

    // A spawn that couldn't make its pipes (out of file descriptors: EMFILE) hands back no stderr. That is a failed start, ended
    // the same way, so nothing throws out of start() or the restart timer.
    const stderr = child.stderr;
    if (stderr === null) {
      this.terminate(child);
      return end();
    }
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      lines.forEach((value) => value.trim() && line(value));
    });
  }

  /** The helper `child` (null: it never started) has ended. Unless the watch was stopped meanwhile, says nobody holds the mic and restarts, or gives up. */
  private exited(child: ChildProcess | null): void {
    if (child !== null && this.child !== child) return; // stopped, or an older helper
    this.child = null;
    if (!this.active) return;
    this.opts.onHolders([]);
    const now = Date.now();
    this.exits = this.exits.filter((at) => now - at < EXIT_WINDOW_MS);
    this.exits.push(now);
    if (this.exits.length > (this.opts.maxRestarts ?? 5)) {
      this.active = false;
      console.warn("avanzel-calltap --watch-mic keeps stopping; the microphone is no longer watched.");
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active) this.spawnHelper();
    }, this.opts.restartMs ?? 5_000);
  }

  /** SIGTERM to `child` if it still runs, and SIGKILL if it hasn't ended after a while (as CallTap does). */
  private terminate(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }
}
