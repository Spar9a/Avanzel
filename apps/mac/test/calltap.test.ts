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
  // The fake stands in for a call that runs until Stop, as the real helper does: it says started, writes the raw file to outFile, and
  // holds until stop(), after which it says nothing more (the real helper's SIGTERM ends it quietly too).
  it("copies the raw file to outFile, says started, and holds until stop()", async () => {
    const dir = tmp();
    const pcm = path.join(dir, "fixture.pcm");
    const bytes = Buffer.alloc(32_000, 7);
    writeFileSync(pcm, bytes);
    process.env.AVANZEL_FAKE_CALLTAP = pcm;
    const outFile = path.join(dir, "them.pcm");
    const events: TapEvent[] = [];
    const tap = new CallTap({ pids: [1], outFile, onEvent: (e) => events.push(e) });
    tap.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events.map((e) => e.event)).toEqual(["started"]); // still "in the call"
    expect(readFileSync(outFile).equals(bytes)).toBe(true);
    await tap.stop();
    expect(events.map((e) => e.event)).toEqual(["started"]);
    expect(readFileSync(outFile).equals(bytes)).toBe(true);
  });

  it("a stop right after the start resolves once the file is complete", async () => {
    const dir = tmp();
    const pcm = path.join(dir, "fixture.pcm");
    const bytes = Buffer.alloc(320_000, 3);
    writeFileSync(pcm, bytes);
    process.env.AVANZEL_FAKE_CALLTAP = pcm;
    const outFile = path.join(dir, "them.pcm");
    const tap = new CallTap({ pids: [], outFile, onEvent: () => undefined });
    tap.start();
    await tap.stop();
    expect(readFileSync(outFile).equals(bytes)).toBe(true);
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

  it("treats a signal death during the waiting phase, with no stop asked for, as a cancel", async () => {
    const dir = tmp();
    CallTap.binaryPath = () => script(`echo '{"event":"waiting"}' >&2\nkill -TERM $$\nsleep 5`);
    const events: TapEvent[] = [];
    const tap = new CallTap({ pids: [9], outFile: path.join(dir, "them.pcm"), onEvent: (e) => events.push(e) });
    tap.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(events).toEqual([]);
    await tap.stop();
    expect(events).toEqual([]);
  });

  it("reports a helper killed by a signal after it started as an error", async () => {
    const dir = tmp();
    CallTap.binaryPath = () => script(`echo '{"event":"waiting"}' >&2\necho '{"event":"started"}' >&2\nkill -KILL $$\nsleep 5`);
    const seen = collect("error");
    new CallTap({ pids: [9], outFile: path.join(dir, "them.pcm"), onEvent: seen.onEvent }).start();
    await seen.done;
    expect(seen.events.map((e) => e.event)).toEqual(["started", "error"]);
    expect(seen.events[1]?.message).toBeTruthy();
  });

  it("ends the call with one error when the sound can't be written, and no stopped after it", async () => {
    const dir = tmp();
    CallTap.binaryPath = () =>
      script(
        `yes &
trap 'kill $!; echo "{\\"event\\":\\"stopped\\",\\"seconds\\":1}" >&2; exit 0' TERM
echo '{"event":"started"}' >&2
wait`,
      );
    const events: TapEvent[] = [];
    const tap = new CallTap({ pids: [9], outFile: path.join(dir, "no-such-folder", "them.pcm"), onEvent: (e) => events.push(e) });
    tap.start();
    await tap.stop();
    // Nothing more comes after the error, even later.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The file fails to open at once, so the helper may not have said started yet; either way the error is the only end.
    expect(events.filter((e) => e.event === "error")).toEqual([{ event: "error", message: "The call's sound couldn't be written to disk." }]);
    expect(events.at(-1)?.event).toBe("error");
    expect(events.some((e) => e.event === "stopped")).toBe(false);
  });

  it("ends the fake helper with an error too when the file can't be written", async () => {
    const dir = tmp();
    const pcm = path.join(dir, "fixture.pcm");
    writeFileSync(pcm, Buffer.alloc(64));
    process.env.AVANZEL_FAKE_CALLTAP = pcm;
    const events: TapEvent[] = [];
    const tap = new CallTap({ pids: [], outFile: path.join(dir, "no-such-folder", "them.pcm"), onEvent: (e) => events.push(e) });
    tap.start();
    await tap.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.map((e) => e.event)).toEqual(["started", "error"]);
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
