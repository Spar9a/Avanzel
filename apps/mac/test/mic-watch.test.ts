import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicWatch, parseMicLine, type MicHolder } from "../src/main/mic-watch.ts";

/** A test may stand in for `spawn` (a start that fails with no pipes, as EMFILE does); otherwise the real one runs. */
const spawning = vi.hoisted(() => ({ fake: null as ((...args: unknown[]) => unknown) | null }));
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return { ...real, spawn: (...args: unknown[]) => (spawning.fake ? spawning.fake(...args) : (real.spawn as (...a: unknown[]) => unknown)(...args)) };
});

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-micwatch-"));

function script(body: string): string {
  const file = path.join(tmp(), "avanzel-calltap");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** Resolves once `check` is true, polling briefly; fails the test after five seconds, which a shell script's spawn under a full suite's load needs. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome: MicHolder = { pid: 1234, bundle: "com.google.Chrome.helper", appPid: 1200, app: "Google Chrome", path: "/Applications/Google Chrome.app" };
const chromeLine = `{"event":"mic","holders":[{"pid":1234,"bundle":"com.google.Chrome.helper","appPid":1200,"app":"Google Chrome","path":"/Applications/Google Chrome.app"}]}`;
const emptyLine = `{"event":"mic","holders":[]}`;

const watches: MicWatch[] = [];
afterEach(async () => {
  await Promise.all(watches.splice(0).map((watch) => watch.stop()));
  spawning.fake = null;
  vi.restoreAllMocks();
});
const track = (watch: MicWatch): MicWatch => {
  watches.push(watch);
  return watch;
};

describe("parseMicLine", () => {
  it("reads the holders of a mic line", () => {
    expect(parseMicLine(chromeLine)).toEqual([chrome]);
    expect(parseMicLine(emptyLine)).toEqual([]);
  });

  it("turns unknown fields into null", () => {
    expect(parseMicLine(`{"event":"mic","holders":[{"pid":7,"bundle":null,"appPid":null,"app":null,"path":null}]}`)).toEqual([
      { pid: 7, bundle: null, appPid: null, app: null, path: null },
    ]);
    expect(parseMicLine(`{"event":"mic","holders":[{"pid":7,"bundle":5,"appPid":"x","app":{},"path":[]}]}`)).toEqual([
      { pid: 7, bundle: null, appPid: null, app: null, path: null },
    ]);
  });

  it("returns null for any other line, bad JSON, or a holder without a numeric pid", () => {
    expect(parseMicLine(`{"event":"stopped"}`)).toBeNull();
    expect(parseMicLine("not json at all")).toBeNull();
    expect(parseMicLine("null")).toBeNull();
    expect(parseMicLine(`{"event":"mic"}`)).toBeNull();
    expect(parseMicLine(`{"event":"mic","holders":[{"pid":"1"}]}`)).toBeNull();
    expect(parseMicLine(`{"event":"mic","holders":[{"bundle":"a"}]}`)).toBeNull();
  });
});

describe("MicWatch", () => {
  it("passes on each mic line", async () => {
    const bin = script(`echo '${chromeLine}' >&2\necho '${emptyLine}' >&2\nexec sleep 30`);
    const seen: MicHolder[][] = [];
    const watch = track(new MicWatch({ onHolders: (h) => seen.push(h), binaryPath: () => bin }));
    watch.start();
    expect(watch.running).toBe(true);
    await until(() => seen.length >= 2);
    expect(seen).toEqual([[chrome], []]);
    await watch.stop();
    expect(watch.running).toBe(false);
  });

  it("restarts a helper that exits, with no holders meanwhile", async () => {
    const bin = script(`echo '${chromeLine}' >&2`);
    const seen: MicHolder[][] = [];
    const watch = track(new MicWatch({ onHolders: (h) => seen.push(h), binaryPath: () => bin, restartMs: 50 }));
    watch.start();
    await until(() => seen.length >= 3);
    await watch.stop();
    expect(seen.slice(0, 3)).toEqual([[chrome], [], [chrome]]);
  });

  it("gives up after maxRestarts", async () => {
    const dir = tmp();
    const count = path.join(dir, "spawns");
    const bin = script(`echo x >> '${count}'`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const watch = track(new MicWatch({ onHolders: () => {}, binaryPath: () => bin, restartMs: 10, maxRestarts: 2 }));
    watch.start();
    await until(() => warn.mock.calls.length > 0);
    await pause(150); // a fourth spawn, if there were one, would have happened by now
    expect(readFileSync(count, "utf8").trim().split("\n")).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(watch.running).toBe(false);
  });

  it("counts a helper that can't be started as an exit, and never throws", async () => {
    const seen: MicHolder[][] = [];
    let spawns = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const watch = track(
      new MicWatch({
        onHolders: (h) => seen.push(h),
        binaryPath: () => {
          spawns++;
          return path.join(tmp(), "missing");
        },
        restartMs: 10,
        maxRestarts: 1,
      }),
    );
    expect(() => watch.start()).not.toThrow();
    await until(() => warn.mock.calls.length > 0);
    await pause(100);
    expect(spawns).toBe(2);
    expect(seen).toEqual([[], []]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a helper started with no pipes (out of file descriptors) counts as a failed start, and nothing throws", async () => {
    let spawns = 0;
    spawning.fake = () => {
      spawns++;
      // What Node hands back when the pipes can't be made: no stderr, then `error` and `close`.
      const child = Object.assign(new EventEmitter(), { stderr: null, exitCode: null, signalCode: null, kill: () => false });
      process.nextTick(() => {
        child.emit("error", Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));
        child.emit("close", -24);
      });
      return child;
    };
    const seen: MicHolder[][] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const watch = track(new MicWatch({ onHolders: (h) => seen.push(h), binaryPath: () => "avanzel-calltap", restartMs: 10, maxRestarts: 1 }));
    expect(() => watch.start()).not.toThrow();
    await until(() => warn.mock.calls.length > 0);
    await pause(100);
    expect(spawns).toBe(2);
    expect(seen).toEqual([[], []]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("start() while running does nothing", async () => {
    const dir = tmp();
    const count = path.join(dir, "spawns");
    const bin = script(`echo x >> '${count}'\nexec sleep 30`);
    const watch = track(new MicWatch({ onHolders: () => {}, binaryPath: () => bin }));
    watch.start();
    watch.start();
    await until(() => existsSync(count));
    await pause(100);
    expect(readFileSync(count, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("stop() ends the helper and it isn't started again", async () => {
    const dir = tmp();
    const count = path.join(dir, "spawns");
    const bin = script(`echo x >> '${count}'\necho '${chromeLine}' >&2\nexec sleep 30`);
    const seen: MicHolder[][] = [];
    const watch = track(new MicWatch({ onHolders: (h) => seen.push(h), binaryPath: () => bin, restartMs: 20 }));
    watch.start();
    await until(() => seen.length >= 1);
    await watch.stop();
    expect(watch.running).toBe(false);
    await pause(150);
    expect(readFileSync(count, "utf8").trim().split("\n")).toHaveLength(1);
    expect(seen.at(-1)).toEqual([]);
  });

  it("stop() while a restart is waiting cancels the restart", async () => {
    const dir = tmp();
    const count = path.join(dir, "spawns");
    const bin = script(`echo x >> '${count}'`);
    const watch = track(new MicWatch({ onHolders: () => {}, binaryPath: () => bin, restartMs: 100 }));
    watch.start();
    await until(() => existsSync(count));
    await pause(40); // the helper has exited; the restart is waiting
    await watch.stop();
    await pause(200);
    expect(readFileSync(count, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("stop() when not running resolves at once", async () => {
    const watch = new MicWatch({ onHolders: () => {} });
    await watch.stop();
    expect(watch.running).toBe(false);
  });
});
