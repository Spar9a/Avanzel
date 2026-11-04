// The process that does what only the Mac itself can for "dictate into any app": avanzel-cursor (apps/mac/native/cursor) watches one
// modifier key, says which app is in front and whether its cursor takes text, and sends the paste keystroke. It is long-running:
// commands go in on stdin and events and replies come out on stdout, one JSON object per line (the protocol is in that folder's
// README). CursorHelper runs it, turns the key events into taps, and gives each request its own answer by `id`.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TapDetector, type CursorKey } from "./tap-detector.ts";

export type { CursorKey } from "./tap-detector.ts";

/** What the helper saw in front: the app, its window, and the focused element. Nulls are what it could not read. */
export interface Target {
  /** The helper may not know an app's name or bundle id; they are then empty strings. */
  app: { name: string; bundleId: string; pid: number };
  window: { title: string } | null;
  /** Null when Accessibility is not granted or nothing could be read; `role` is null when the element had none. */
  element: { role: string | null; secure: boolean; takesText: "yes" | "no" | "unknown" } | null;
}

export interface CursorPermissions {
  accessibility: boolean;
  inputMonitoring: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the helper is: in the app's Resources when packaged, else where `build-cursor.mjs` puts it (from src/main or dist). */
function defaultBinaryPath(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const packaged = path.join(resources, "cursor", "avanzel-cursor");
    if (existsSync(packaged)) return packaged;
  }
  const dev = ["../native/cursor/build/avanzel-cursor", "../../native/cursor/build/avanzel-cursor"].map((rel) => path.resolve(HERE, rel));
  return dev.find((file) => existsSync(file)) ?? dev[0]!;
}

const KILL_AFTER_MS = 3_000;
/** A helper that does not answer in this long is stuck; the caller gets an error instead of a wait with no end. */
const REQUEST_TIMEOUT_MS = 3_000;

/** The helper ended, or was never there, so nothing it was asked can be answered. Already told to `onProblem` once. */
class HelperGone extends Error {}

interface Pending {
  resolve(reply: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The script `AVANZEL_FAKE_CURSOR` points to: a stand-in for the Mac, for tests that must run without one. */
interface FakeScript {
  targets?: Target[];
  /** Milliseconds after start() at which the key is tapped. */
  taps?: number[];
  permissions?: CursorPermissions;
  /** A file that each paste appends the clipboard's text to. */
  pasteOut?: string;
}

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

/** The helper's `inspect` reply as a Target: a missing name or bundle id becomes an empty string, and the rest keeps its nulls. */
function targetFrom(reply: Record<string, unknown>): Target {
  const app = (reply.app ?? {}) as Record<string, unknown>;
  const window = reply.window as Record<string, unknown> | null | undefined;
  const element = reply.element as Record<string, unknown> | null | undefined;
  return {
    app: { name: text(app.name, ""), bundleId: text(app.bundleId, ""), pid: typeof app.pid === "number" ? app.pid : 0 },
    window: window ? { title: text(window.title, "") } : null,
    element: element
      ? {
          role: typeof element.role === "string" ? element.role : null,
          secure: element.secure === true,
          takesText: element.takesText === "yes" || element.takesText === "no" ? element.takesText : "unknown",
        }
      : null,
  };
}

export class CursorHelper {
  /** Where the helper is; tests set it. */
  static binaryPath: () => string = defaultBinaryPath;

  /** Reads the text on the clipboard for the fake helper's paste. Electron is loaded only when this runs, so tests never load it. */
  static fakeClipboardText: () => string | Promise<string> = async () => (await import("electron")).clipboard.readText();

  /** The helper can run: it is built (or the fake is on). */
  static available(): boolean {
    return Boolean(process.env.AVANZEL_FAKE_CURSOR) || (process.platform === "darwin" && existsSync(CursorHelper.binaryPath()));
  }

  private child: ChildProcess | null = null;
  private key: CursorKey | null = null;
  private detector = new TapDetector();
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** stop() was called and start() has not been since: the helper is not to be run again, and its ending is no problem. */
  private closed = false;
  private exited: Promise<void> | null = null;
  private fake: { script: FakeScript; timers: ReturnType<typeof setTimeout>[]; targetsGiven: number } | null = null;

  constructor(private readonly opts: { onTap(): void; onProblem(message: string): void }) {}

  /** Runs the helper if it is not running, and has it watch `key`; a call while it runs asks it to watch again, which retries a watch that was refused. */
  start(key: CursorKey): void {
    this.closed = false;
    this.useKey(key);
    if (process.env.AVANZEL_FAKE_CURSOR) return this.startFake(process.env.AVANZEL_FAKE_CURSOR);
    if (this.child) this.watch();
    else this.spawnChild();
  }

  /** Watches another key, or the same one again; if the helper is not running the key is kept for the next start(). */
  setKey(key: CursorKey): void {
    this.useKey(key);
    if (this.child) this.watch();
  }

  /** Whether Avanzel may see the key and use the Accessibility API; `prompt` has macOS ask for both. */
  async permissions(prompt: boolean): Promise<CursorPermissions> {
    if (this.fake) return this.fake.script.permissions ?? { accessibility: true, inputMonitoring: true };
    const reply = await this.request({ cmd: "permissions", prompt });
    return { accessibility: reply.accessibility === true, inputMonitoring: reply.inputMonitoring === true };
  }

  /** The app in front and what holds its cursor. Rejects when no app is in front. */
  async inspect(): Promise<Target> {
    if (this.fake) {
      const { targets = [] } = this.fake.script;
      const target = targets[Math.min(this.fake.targetsGiven, targets.length - 1)];
      if (!target) throw new Error("The fake cursor helper has no targets.");
      this.fake.targetsGiven += 1;
      return target;
    }
    return targetFrom(await this.request({ cmd: "inspect" }));
  }

  /** Has the front app paste what is on the clipboard (Command-V). Rejects when Accessibility is not granted. */
  async paste(): Promise<void> {
    if (this.fake) {
      const { pasteOut } = this.fake.script;
      if (pasteOut) appendFileSync(pasteOut, await CursorHelper.fakeClipboardText());
      return;
    }
    await this.request({ cmd: "paste" });
  }

  /** Ends the helper (SIGTERM, then SIGKILL if it lingers) and resolves once it has. Fine to call when it is not running. */
  async stop(): Promise<void> {
    this.closed = true;
    if (this.fake) {
      this.fake.timers.forEach(clearTimeout);
      this.fake = null;
    }
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
      timer.unref();
      child.once("close", () => clearTimeout(timer));
    }
    await this.exited;
  }

  private useKey(key: CursorKey): void {
    // Half a tap of the old key is nothing for the new one.
    if (key !== this.key) this.detector = new TapDetector();
    this.key = key;
  }

  /** Tells the helper which key to watch. A refusal (no Input Monitoring yet) is a problem to show, not the end: the key stays chosen. */
  private watch(): void {
    if (!this.key) return;
    this.request({ cmd: "watch", key: this.key }).catch((error: unknown) => {
      if (!(error instanceof HelperGone)) this.opts.onProblem(errorText(error));
    });
  }

  private spawnChild(): void {
    let child: ChildProcess;
    try {
      child = spawn(CursorHelper.binaryPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      this.opts.onProblem(errorText(error));
      return;
    }
    this.child = child;
    // The helper's stderr is for people reading a log; it is drained so the pipe never fills, and not kept.
    child.stderr!.resume();
    // A write to a helper that has just died would otherwise be an uncaught error; its ending is handled on close.
    child.stdin!.on("error", () => undefined);

    let buffered = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      lines.forEach((line) => line.trim() && this.line(line));
    });

    let ended = false;
    const end = (message: string): void => {
      if (ended) return;
      ended = true;
      if (this.child === child) this.child = null;
      const expected = this.closed;
      this.rejectAll(new HelperGone(message));
      if (!expected) this.opts.onProblem(message);
    };
    child.on("error", (error) => end(errorText(error)));
    child.on("close", (code) => end(code === null ? "The cursor helper stopped unexpectedly." : `The cursor helper stopped (exit code ${code}).`));
    // 'close' does not always follow a failed spawn, so an error counts as the end too; waiting for 'close' alone could hang stop().
    this.exited = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });

    this.watch();
  }

  /** One line of the helper's stdout: a reply for a waiting request, or an event. Anything else is ignored. */
  private line(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as Record<string, unknown>;
    if (typeof message.id === "number") return this.reply(message.id, message);
    if (message.event === "modifier" && typeof message.down === "boolean") {
      if (this.detector.push({ event: "modifier", down: message.down })) this.opts.onTap();
    } else if (message.event === "key") {
      this.detector.push({ event: "key" });
    }
    // `ready` and `error` are diagnostics: the permissions reply says the real state, and what the helper could not parse is a bug in this file.
  }

  private reply(id: number, message: Record<string, unknown>): void {
    const waiting = this.pending.get(id);
    if (!waiting) return;
    this.pending.delete(id);
    clearTimeout(waiting.timer);
    if (message.ok === true) waiting.resolve(message);
    else waiting.reject(new Error(text(message.message, "The cursor helper could not do that.")));
  }

  private rejectAll(error: Error): void {
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
      this.pending.delete(id);
    }
  }

  /** Sends a command and waits for the reply that carries its id, for at most three seconds. */
  private request(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new HelperGone("The cursor helper is not running."));
    if (!this.child) this.spawnChild();
    const child = this.child;
    if (!child) return Promise.reject(new HelperGone("The cursor helper could not start."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The cursor helper didn't answer."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  private startFake(file: string): void {
    if (this.fake) return;
    let script: FakeScript;
    try {
      script = JSON.parse(readFileSync(file, "utf8")) as FakeScript;
    } catch (error) {
      this.opts.onProblem(errorText(error));
      return;
    }
    const fake = { script, timers: [] as ReturnType<typeof setTimeout>[], targetsGiven: 0 };
    this.fake = fake;
    for (const at of script.taps ?? []) fake.timers.push(setTimeout(() => this.opts.onTap(), at));
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
