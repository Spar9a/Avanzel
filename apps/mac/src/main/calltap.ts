// The process that hears a call app: avanzel-calltap (apps/mac/native/calltap) writes what the app plays to stdout as raw
// 16 kHz mono s16le samples, and says what it is doing as JSON lines on stderr. CallTap runs it, streams its sound to a
// file (a call is never held in memory) and passes the lines on as events.
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, statSync, type WriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TapEvent {
  event: "started" | "stopped" | "error";
  message?: string;
  seconds?: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the helper is: in the app's Resources when packaged, else where `build-calltap.mjs` puts it (from src/main or dist). */
function defaultBinaryPath(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const packaged = path.join(resources, "calltap", "avanzel-calltap");
    if (existsSync(packaged)) return packaged;
  }
  const dev = ["../native/calltap/build/avanzel-calltap", "../../native/calltap/build/avanzel-calltap"].map((rel) =>
    path.resolve(HERE, rel),
  );
  return dev.find((file) => existsSync(file)) ?? dev[0]!;
}

/** Whether `release` (os.release()) is macOS 14.2 or later: Darwin 23.2 is macOS 14.2. */
export function macSupportsCallTap(platform: string, release: string): boolean {
  if (platform !== "darwin") return false;
  const [major = 0, minor = 0] = release.split(".").map(Number);
  return major > 23 || (major === 23 && minor >= 2);
}

const KILL_AFTER_MS = 3_000;
const BYTES_PER_SECOND = 16_000 * 2;

export class CallTap {
  /** Where the helper is; tests set it. */
  static binaryPath: () => string = defaultBinaryPath;

  /** The call app's sound can be tapped: macOS 14.2 or later, and the helper is built. */
  static available(): boolean {
    return macSupportsCallTap(process.platform, os.release()) && existsSync(CallTap.binaryPath());
  }

  private done: Promise<void> | null = null;
  private stopping = false;
  private child: ChildProcess | null = null;

  constructor(private readonly opts: { pids: number[]; outFile: string; onEvent(e: TapEvent): void }) {}

  /** Spawns the helper (no pids taps everything the Mac plays); its sound streams to `outFile`. */
  start(): void {
    if (this.done) return;
    const fake = process.env.AVANZEL_FAKE_CALLTAP;
    this.done = fake ? this.runFake(fake) : this.run();
  }

  /** Asks the helper to end (SIGTERM) and resolves once it has, and `outFile` is complete. Fine to call after it ended by itself. */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
      timer.unref();
      await this.done;
      clearTimeout(timer);
      return;
    }
    await this.done;
  }

  private run(): Promise<void> {
    const { pids, outFile, onEvent } = this.opts;
    return new Promise((resolve) => {
      const file = createWriteStream(outFile);
      const fileClosed = new Promise<void>((done) => {
        file.on("close", () => done());
        file.on("error", () => done());
      });
      // Stopped and error are held back until the sound is all in the file, so a reader told "stopped" finds it complete.
      let final: TapEvent | null = null;
      let waiting = false;
      let started = false;
      const finish = (event: TapEvent | null): void => {
        void fileClosed.then(() => {
          if (event) onEvent(event);
          resolve();
        });
      };

      let child: ChildProcess;
      try {
        child = spawn(CallTap.binaryPath(), pids.flatMap((pid) => ["--pid", String(pid)]), { stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        file.end();
        finish({ event: "error", message: errorText(error) });
        return;
      }
      this.child = child;
      child.stdout!.pipe(file);

      let buffered = "";
      const line = (text: string): void => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (typeof parsed !== "object" || parsed === null) return;
        const { event, message, seconds } = parsed as Record<string, unknown>;
        if (event === "waiting") waiting = true;
        else if (event === "started") {
          started = true;
          onEvent({ event: "started" });
        } else if (event === "stopped") {
          final = { event: "stopped", ...(typeof seconds === "number" ? { seconds } : {}) };
        } else if (event === "error") {
          final = { event: "error", message: typeof message === "string" ? message : "avanzel-calltap failed" };
        }
      };
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        lines.forEach((text) => text.trim() && line(text));
      });

      let ended = false;
      child.on("error", (error) => {
        if (ended) return;
        ended = true;
        file.end();
        finish({ event: "error", message: errorText(error) });
      });
      child.on("close", (code) => {
        if (ended) return;
        ended = true;
        if (buffered.trim()) line(buffered);
        file.end();
        // A signal during the wait kills the helper with no stopped line: that is a cancel, not a failure.
        const cancelled = this.stopping || ((waiting || !started) && code === null);
        const failed = !final && code !== 0 && code !== null && !cancelled;
        finish(final ?? (failed ? { event: "error", message: `avanzel-calltap exited with code ${code}` } : null));
      });
    });
  }

  /** `AVANZEL_FAKE_CALLTAP`: a raw file stands in for the helper's sound. */
  private runFake(source: string): Promise<void> {
    const { outFile, onEvent } = this.opts;
    return new Promise((resolve) => {
      const out: WriteStream = createWriteStream(outFile);
      process.nextTick(() => onEvent({ event: "started" }));
      const fail = (error: Error): void => {
        out.destroy();
        onEvent({ event: "error", message: error.message });
        resolve();
      };
      const input = createReadStream(source);
      input.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => {
        onEvent({ event: "stopped", seconds: statSync(outFile).size / BYTES_PER_SECOND });
        resolve();
      });
      input.pipe(out);
    });
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
