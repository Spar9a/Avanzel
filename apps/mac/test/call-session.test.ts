import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AvanzelError, type TimedText, type Transcriber } from "@avanzel/engine";
import { CallSession } from "../src/main/call-session.ts";

const RATE = 16_000;
const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-call-"));
const startedAt = new Date("2026-11-04T10:00:00.000Z");

/** s16le bytes of `seconds` of a constant `level` in [-1, 1]. */
function pcm(seconds: number, level: number): Buffer {
  const samples = new Int16Array(Math.round(seconds * RATE)).fill(Math.round(level * 32767));
  return Buffer.from(samples.buffer);
}

/** A transcriber that tells the streams apart by their level: the microphone is the louder one in these tests. */
function fake(answers: { you: TimedText[]; them: TimedText[] }, withSegments = true): Transcriber {
  const side = (samples: Float32Array): "you" | "them" => (Math.max(...samples.slice(0, 100)) > 0.3 ? "you" : "them");
  const t: Transcriber = {
    engine: "fake",
    async transcribe(audio) {
      const samples = audio as Float32Array;
      const text = answers[side(samples)].map((s) => s.text).join(" ");
      return { text, engine: "fake", seconds: samples.length / RATE };
    },
  };
  if (withSegments) t.transcribeSegments = async (samples) => answers[side(samples)];
  return t;
}

describe("CallSession", () => {
  it("makes its folder and writes call.json, which read gives back", () => {
    const dir = path.join(tmp(), "calls", "abc");
    const session = new CallSession({ dir, app: "zoom.us", startedAt });
    expect(JSON.parse(readFileSync(path.join(dir, "call.json"), "utf8"))).toEqual({
      app: "zoom.us",
      startedAt: "2026-11-04T10:00:00.000Z",
    });
    expect(session.youFile).toBe(path.join(dir, "you.pcm"));
    expect(session.themFile).toBe(path.join(dir, "them.pcm"));
    expect(CallSession.read(dir)).toEqual({ app: "zoom.us", startedAt });
    new CallSession({ dir: path.join(dir, "everything"), app: null, startedAt });
    expect(CallSession.read(path.join(dir, "everything"))).toEqual({ app: null, startedAt });
  });

  it("reads nothing from a folder with no call.json or a broken one", () => {
    const dir = tmp();
    expect(CallSession.read(dir)).toBeNull();
    writeFileSync(path.join(dir, "call.json"), "{nope");
    expect(CallSession.read(dir)).toBeNull();
    writeFileSync(path.join(dir, "call.json"), JSON.stringify({ app: 3, startedAt: "never" }));
    expect(CallSession.read(dir)).toBeNull();
  });

  it("appends the microphone's samples as 16-bit PCM", () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    session.appendYou(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    session.appendYou(new Float32Array([0.25]));
    const bytes = readFileSync(session.youFile);
    const read = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    expect(Array.from(read)).toEqual([0, 32767, -32768, 16384, 32767, -32768, 8192]);
  });

  it("merges both sides in order and drops the microphone's echo of the call", async () => {
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    writeFileSync(session.youFile, pcm(10, 0.5));
    writeFileSync(session.themFile, pcm(10, 0.1));
    const t = fake({
      you: [
        { start: 4, end: 6, text: "Sure, send me the draft." },
        { start: 7, end: 9, text: "so the deadline is Friday" },
      ],
      them: [
        { start: 0, end: 3, text: "Can you review this today?" },
        { start: 7, end: 9, text: "So the deadline is Friday." },
      ],
    });

    const result = await session.finish(t, new Date());

    expect(result.themHeard).toBe(true);
    expect(result.seconds).toBe(10);
    expect(result.transcript).toBe(
      "[00:00] Them: Can you review this today?\n\n[00:04] You: Sure, send me the draft.\n\n[00:07] Them: So the deadline is Friday.\n",
    );
  });

  it("gives a transcriber without segments one segment per stream", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(session.youFile, pcm(2, 0.5));
    writeFileSync(session.themFile, pcm(5, 0.1));
    const result = await session.finish(
      fake({ you: [{ start: 0, end: 2, text: "Hello there" }], them: [{ start: 0, end: 5, text: "Hi" }] }, false),
      new Date(),
    );
    expect(result.transcript).toBe("[00:00] Them: Hi\n\n[00:00] You: Hello there\n");
    expect(result.seconds).toBe(5);
  });

  it("says themHeard is false when the other side's file is missing, empty or silent", async () => {
    const you: TimedText[] = [{ start: 0, end: 2, text: "Talking to myself" }];
    const t = fake({ you, them: [] });

    const missing = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(missing.youFile, pcm(2, 0.5));
    expect((await missing.finish(t, new Date())).themHeard).toBe(false);

    const empty = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(empty.youFile, pcm(2, 0.5));
    writeFileSync(empty.themFile, "");
    expect((await empty.finish(t, new Date())).themHeard).toBe(false);

    const silent = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(silent.youFile, pcm(2, 0.5));
    writeFileSync(silent.themFile, pcm(2, 0.001));
    const result = await silent.finish(t, new Date());
    expect(result.themHeard).toBe(false);
    expect(result.transcript).toBe("[00:00] You: Talking to myself\n");

    const quiet = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(quiet.youFile, pcm(2, 0.5));
    writeFileSync(quiet.themFile, pcm(2, 0.01));
    expect((await quiet.finish(t, new Date())).themHeard).toBe(true);
  });

  it("throws when neither side produced text", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    await expect(session.finish(fake({ you: [], them: [] }), new Date())).rejects.toThrow(
      new AvanzelError("No speech was heard on this call."),
    );

    writeFileSync(session.youFile, pcm(3, 0.5));
    writeFileSync(session.themFile, pcm(3, 0.1));
    const error = await session.finish(fake({ you: [], them: [] }), new Date()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvanzelError);
    expect((error as Error).message).toBe("No speech was heard on this call.");
  });

  it("leaves the files where they are, so Try again can run finish again", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(session.youFile, pcm(2, 0.5));
    writeFileSync(session.themFile, pcm(2, 0.1));
    const t = fake({ you: [{ start: 0, end: 1, text: "Hello" }], them: [] });
    await session.finish(t, new Date());
    expect(existsSync(session.youFile)).toBe(true);
    expect(existsSync(session.themFile)).toBe(true);
    expect(statSync(session.youFile).size).toBe(2 * RATE * 2);
    appendFileSync(session.youFile, pcm(1, 0.5));
    expect((await session.finish(t, new Date())).seconds).toBe(3);
  });
});
