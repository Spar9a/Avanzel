import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CallTap, macSupportsCallTap, type TapEvent } from "../src/main/calltap.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-calltap-"));
const realBinaryPath = CallTap.binaryPath;

afterEach(() => {
  delete process.env.AVANZEL_FAKE_CALLTAP;
  CallTap.binaryPath = realBinaryPath;
});

/** Resolves with the events once `last` has been seen. */
function collect(last: TapEvent["event"]): { events: TapEvent[]; onEvent(e: TapEvent): void; done: Promise<void> } {
  const events: TapEvent[] = [];
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return {
    events,
    done,
    onEvent(e) {
      events.push(e);
      if (e.event === last) finish();
    },
  };
}

function script(body: string): string {
  const file = path.join(tmp(), "avanzel-calltap");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("CallTap with the fake helper", () => {
  it("copies the raw file to outFile and says started, then stopped", async () => {
    const dir = tmp();
    const pcm = path.join(dir, "fixture.pcm");
    const bytes = Buffer.alloc(32_000, 7);
    writeFileSync(pcm, bytes);
    process.env.AVANZEL_FAKE_CALLTAP = pcm;
    const outFile = path.join(dir, "them.pcm");
    const seen = collect("stopped");

    new CallTap({ pids: [1], outFile, onEvent: seen.onEvent }).start();
    await seen.done;

    expect(seen.events.map((e) => e.event)).toEqual(["started", "stopped"]);
    expect(seen.events[1]?.seconds).toBe(1);
    expect(readFileSync(outFile).equals(bytes)).toBe(true);
  });

  it("resolves stop after it has stopped by itself", async () => {
    const dir = tmp();
    const pcm = path.join(dir, "fixture.pcm");
    writeFileSync(pcm, Buffer.alloc(64));
    process.env.AVANZEL_FAKE_CALLTAP = pcm;
    const seen = collect("stopped");
    const tap = new CallTap({ pids: [], outFile: path.join(dir, "them.pcm"), onEvent: seen.onEvent });
    tap.start();
    await seen.done;
    await expect(tap.stop()).resolves.toBeUndefined();
  });
});

describe("CallTap with a stand-in binary", () => {
  it("is not available when the binary is missing", () => {
    CallTap.binaryPath = () => path.join(tmp(), "nope");
    expect(CallTap.available()).toBe(false);
  });

  it("is available when the binary exists on a Mac new enough (the Mac running the tests is)", () => {
    CallTap.binaryPath = () => script("exit 0");
    expect(CallTap.available()).toBe(process.platform === "darwin");
  });

  it("names the app's pids, streams stdout to the file and reports started and stopped", async () => {
    const dir = tmp();
    const args = path.join(dir, "args.txt");
    CallTap.binaryPath = () =>
      script(
        `echo "$@" > '${args}'
sleep 30 &
trap 'kill $!; echo "{\\"event\\":\\"stopped\\",\\"seconds\\":2.5}" >&2; exit 0' TERM
printf 'abcd'
echo '{"event":"started","sampleRate":48000,"channels":2}' >&2
wait`,
      );
    const outFile = path.join(dir, "them.pcm");
    const seen = collect("started");
    const tap = new CallTap({ pids: [42, 43], outFile, onEvent: seen.onEvent });
    tap.start();
    await seen.done;
    await tap.stop();

    expect(seen.events).toEqual([{ event: "started" }, { event: "stopped", seconds: 2.5 }]);
    expect(readFileSync(outFile, "utf8")).toBe("abcd");
    expect(readFileSync(args, "utf8").trim()).toBe("--pid 42 --pid 43");
  });

  it("treats an exit during the waiting phase, with no stopped line, as a cancel", async () => {
    const dir = tmp();
    CallTap.binaryPath = () => script(`echo '{"event":"waiting"}' >&2\nexec sleep 30`);
    const events: TapEvent[] = [];
    const tap = new CallTap({ pids: [9], outFile: path.join(dir, "them.pcm"), onEvent: (e) => events.push(e) });
    tap.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await tap.stop();
    expect(events).toEqual([]);
  });

  it("turns an error line and a non-zero exit into an error event", async () => {
    const dir = tmp();
    CallTap.binaryPath = () => script(`echo '{"event":"error","message":"no app you named is playing sound"}' >&2\nexit 1`);
    const seen = collect("error");
    new CallTap({ pids: [9], outFile: path.join(dir, "them.pcm"), onEvent: seen.onEvent }).start();
    await seen.done;
    expect(seen.events).toEqual([{ event: "error", message: "no app you named is playing sound" }]);
  });

  it("turns a binary that cannot start into an error event", async () => {
    const dir = tmp();
    CallTap.binaryPath = () => path.join(dir, "missing");
    const seen = collect("error");
    const tap = new CallTap({ pids: [], outFile: path.join(dir, "them.pcm"), onEvent: seen.onEvent });
    tap.start();
    await seen.done;
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0]?.event).toBe("error");
    await expect(tap.stop()).resolves.toBeUndefined();
    expect(existsSync(path.join(dir, "them.pcm"))).toBe(true);
  });
});

describe("macSupportsCallTap", () => {
  it("needs macOS 14.2, which is Darwin 23.2", () => {
    expect(macSupportsCallTap("darwin", "23.1.0")).toBe(false);
    expect(macSupportsCallTap("darwin", "23.2.0")).toBe(true);
    expect(macSupportsCallTap("darwin", "24.0.0")).toBe(true);
    expect(macSupportsCallTap("darwin", "22.6.0")).toBe(false);
    expect(macSupportsCallTap("linux", "99.0.0")).toBe(false);
  });
});
