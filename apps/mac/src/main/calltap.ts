// The process that hears a call app: avanzel-calltap (apps/mac/native/calltap) writes what the app plays to stdout as raw
// 16 kHz mono s16le samples, and says what it is doing as JSON lines on stderr. CallTap runs it, streams its sound to a
// file (a call is never held in memory) and passes the lines on as events.
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, type WriteStream } from "node:fs";
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
  /** Ends the fake helper's wait for stop() (`runFake`). */
  private releaseFake: (() => void) | null = null;

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
    this.terminate();
    this.releaseFake?.();
    await this.done;
  }

  /** SIGTERM to the helper if it still runs, and SIGKILL if it hasn't ended after a while. */
  private terminate(): void {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }

  private run(): Promise<void> {
    const { pids, outFile, onEvent } = this.opts;
    return new Promise((resolve) => {
      const file = createWriteStream(outFile);
      // A file that can't be written (disk full, no folder) loses the call's sound: the helper ends, and the call ends in an error.
      let writeFailed: TapEvent | null = null;
      const fileClosed = new Promise<void>((done) => {
        file.on("close", () => done());
        file.on("error", () => {
          writeFailed ??= { event: "error", message: "The call's sound couldn't be written to disk." };
          this.terminate();
          done();
        });
      });
      // Stopped and error are held back until the sound is all in the file, so a reader told "stopped" finds it complete.
      let final: TapEvent | null = null;
      let started = false;
      const finish = (event: TapEvent | null): void => {
        void fileClosed.then(() => {
          const last = writeFailed ?? event;
          if (last) onEvent(last);
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
        if (event === "started") {
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
        if (final) return finish(final);
        // Asked to stop, or killed by a signal before it started (during its wait): a cancel, not a failure.
        if (this.stopping || (!started && code === null)) return finish(null);
        if (code === 0) return finish(null);
        finish({
          event: "error",
          message: code === null ? "avanzel-calltap ended unexpectedly" : `avanzel-calltap exited with code ${code}`,
        });
      });
    });
  }

  /**
   * `AVANZEL_FAKE_CALLTAP`: a raw file stands in for the helper's sound. It says started, writes the file, and holds, as a call runs,
   * until stop(); then it ends quietly, as the helper does on SIGTERM. A file that can't be written ends it with an error, as the helper.
   */
  private runFake(source: string): Promise<void> {
    const { outFile, onEvent } = this.opts;
    const stopped = new Promise<void>((resolve) => (this.releaseFake = resolve));
    return new Promise((resolve) => {
      const out: WriteStream = createWriteStream(outFile);
      process.nextTick(() => onEvent({ event: "started" }));
      let failed = false;
      const fail = (error: Error): void => {
        if (failed) return;
        failed = true;
        input.destroy();
        out.destroy();
        onEvent({ event: "error", message: error.message });
        resolve();
      };
      const input = createReadStream(source);
      input.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => {
        if (!failed) void stopped.then(resolve);
      });
      input.pipe(out);
    });
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
