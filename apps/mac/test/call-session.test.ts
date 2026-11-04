import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AvanzelError, type TimedText, type Transcriber } from "@avanzel/engine";
import { CallSession, NoSpeechError } from "../src/main/call-session.ts";

const RATE = 16_000;
const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-call-"));
const startedAt = new Date("2026-11-04T10:00:00.000Z");

/** s16le bytes of `seconds` of a constant `level` in [-1, 1]: the other side's sound in most tests. */
function pcm(seconds: number, level: number): Buffer {
  const samples = new Int16Array(Math.round(seconds * RATE)).fill(Math.round(level * 32767));
  return Buffer.from(samples.buffer);
}

/** s16le bytes of `seconds` at `level`, its sign flipping every sample: a microphone's sound unlike the other side's constant one. */
function mic(seconds: number, level: number): Buffer {
  const samples = Int16Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.round((i % 2 ? -level : level) * 32767));
  return Buffer.from(samples.buffer);
}

/** A seeded generator of floats in [-1, 1) (mulberry32), so every run hears the same sound. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Speech-like sound: bursts of low-passed noise of changing loudness, 0.25 s on and 0.15 s off. */
function bursts(seconds: number, seed: number): Float32Array {
  const next = noise(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  let loud = 0;
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    if (i % (0.4 * RATE) === 0) loud = 0.5 * (0.4 + 0.6 * Math.abs(next()));
    low = 0.8 * low + 0.2 * next();
    out[i] = i % (0.4 * RATE) < 0.25 * RATE ? loud * low * 3 : 0;
  }
  return out;
}

/** What the microphone hears of `them` through speakers: 60 ms late, a quarter as loud, smoothed. */
function echoOf(them: Float32Array): Float32Array {
  const shift = Math.round(0.06 * RATE);
  const out = new Float32Array(shift + them.length);
  for (let i = 0; i < them.length; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += them[Math.min(them.length - 1, Math.max(0, i + k))]!;
    out[shift + i] = (sum / 5) * 0.25;
  }
  return out;
}

/** `sound` after `seconds` of silence. */
function at(seconds: number, sound: Float32Array): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE) + sound.length);
  out.set(sound, Math.round(seconds * RATE));
  return out;
}

/** The sum of two sounds, as long as the longer. */
function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** Floats as the s16le bytes of a call's file. */
function s16(samples: Float32Array): Buffer {
  return Buffer.from(Int16Array.from(samples, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)).buffer);
}

/** A transcriber that hears the streams in turn: the microphone's first, as `finish` reads them, then the call app's. */
function inTurn(answers: { you: TimedText[]; them: TimedText[] }): Transcriber {
  let calls = 0;
  return {
    engine: "fake",
    async transcribe() {
      throw new Error("segments only");
    },
    async transcribeSegments() {
      return calls++ === 0 ? answers.you : answers.them;
    },
  };
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
      themOffsetSeconds: 0,
    });
    expect(session.youFile).toBe(path.join(dir, "you.pcm"));
    expect(session.themFile).toBe(path.join(dir, "them.pcm"));
    expect(CallSession.read(dir)).toEqual({ app: "zoom.us", startedAt, themOffsetSeconds: 0 });
    new CallSession({ dir: path.join(dir, "everything"), app: null, startedAt });
    expect(CallSession.read(path.join(dir, "everything"))).toEqual({ app: null, startedAt, themOffsetSeconds: 0 });
  });

  it("create makes a new folder for each call, with a numeric suffix when the id is taken", () => {
    const callsDir = path.join(tmp(), "calls");
    const first = CallSession.create({ callsDir, id: "2026-11-04-100000", app: "zoom.us", startedAt });
    const second = CallSession.create({ callsDir, id: "2026-11-04-100000", app: null, startedAt });
    const third = CallSession.create({ callsDir, id: "2026-11-04-100000", app: null, startedAt });
    expect(first.dir).toBe(path.join(callsDir, "2026-11-04-100000"));
    expect(second.dir).toBe(path.join(callsDir, "2026-11-04-100000-2"));
    expect(third.dir).toBe(path.join(callsDir, "2026-11-04-100000-3"));
    expect(CallSession.read(first.dir)?.app).toBe("zoom.us"); // the first call's call.json is untouched
  });

  it("stores the offset of the other side's clock in call.json, and read gives it back (0 when none was stored)", () => {
    const dir = path.join(tmp(), "call");
    const session = new CallSession({ dir, app: null, startedAt });
    expect(CallSession.read(dir)).toEqual({ app: null, startedAt, themOffsetSeconds: 0 });
    session.setThemOffset(4.96);
    expect(JSON.parse(readFileSync(path.join(dir, "call.json"), "utf8")).themOffsetSeconds).toBe(5);
    expect(CallSession.read(dir)).toEqual({ app: null, startedAt, themOffsetSeconds: 5 });
    session.setThemOffset(-2);
    expect(CallSession.read(dir)?.themOffsetSeconds).toBe(0);
  });

  it("shifts the other side by its offset before merging: a Them segment at 0-2 s comes after a You segment at 3-4 s", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt, themOffsetSeconds: 5 });
    writeFileSync(session.youFile, mic(10, 0.5));
    writeFileSync(session.themFile, pcm(4, 0.1));
    const t = fake({
      you: [
        { start: 3, end: 4, text: "Shall we start?" },
        { start: 8, end: 9, text: "Good, thanks everyone." },
      ],
      them: [
        { start: 0, end: 2, text: "Yes, the budget is ready." },
        { start: 2.5, end: 3.5, text: "Here it is." },
      ],
    });
    const result = await session.finish(t, new Date());
    expect(result.transcript).toBe(
      "[00:03] You: Shall we start?\n\n[00:05] Them: Yes, the budget is ready.\n\n[00:07] Them: Here it is.\n\n[00:08] You: Good, thanks everyone.\n",
    );
    expect(result.seconds).toBe(10);
  });

  it("transcribes the microphone's side before it reads the call app's", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(session.youFile, mic(2, 0.5));
    writeFileSync(session.themFile, pcm(2, 0.1));
    const order: string[] = [];
    const t = fake({ you: [{ start: 0, end: 1, text: "Hello" }], them: [{ start: 1, end: 2, text: "Hi" }] });
    const segments = t.transcribeSegments!;
    t.transcribeSegments = async (samples, rate) => {
      order.push(`${Math.max(...samples.slice(0, 100)) > 0.3 ? "you" : "them"} while them.pcm is ${existsSync(session.themFile) ? "there" : "gone"}`);
      if (order.length === 1) rmSync(session.themFile); // read after this: the call app's side is gone
      return segments(samples, rate);
    };
    const result = await session.finish(t, new Date());
    expect(order).toEqual(["you while them.pcm is there"]);
    expect(result.transcript).toBe("[00:00] You: Hello\n");
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

  it("merges both sides in order and drops the microphone's echo of the call, found in its sound", async () => {
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    const them = bursts(6, 1);
    // 0-6 s the speakers' echo of the other side, then 6.5-9 s the person's own voice.
    writeFileSync(session.youFile, s16(mix(echoOf(them), at(6.5, bursts(2.5, 2)))));
    writeFileSync(session.themFile, s16(them));
    const t = inTurn({
      you: [
        { start: 1, end: 5, text: "the deadline Friday" },
        { start: 6.5, end: 9, text: "Sure, send me the draft." },
      ],
      them: [{ start: 1, end: 5, text: "So the deadline is Friday." }],
    });

    const result = await session.finish(t, new Date());

    expect(result.themHeard).toBe(true);
    expect(result.transcript).toBe("[00:01] Them: So the deadline is Friday.\n\n[00:06] You: Sure, send me the draft.\n");
  });

  it("keeps the microphone's segment when its sound is the person's own", async () => {
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    writeFileSync(session.youFile, s16(bursts(6, 2)));
    writeFileSync(session.themFile, s16(bursts(6, 1)));
    const t = inTurn({ you: [{ start: 1, end: 5, text: "Sounds good to me." }], them: [{ start: 1, end: 5, text: "So the deadline is Friday." }] });
    expect((await session.finish(t, new Date())).transcript).toBe("[00:01] Them: So the deadline is Friday.\n\n[00:01] You: Sounds good to me.\n");
  });

  it("finds the echo of a call app's side that started 3 s after the microphone (its offset in call.json)", async () => {
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt, themOffsetSeconds: 3 });
    expect(CallSession.read(session.dir)?.themOffsetSeconds).toBe(3);
    const them = bursts(5, 1);
    writeFileSync(session.youFile, s16(at(3, echoOf(them)))); // heard from 3 s on, as the other side was
    writeFileSync(session.themFile, s16(them));
    const t = inTurn({ you: [{ start: 4, end: 7.5, text: "budget is ready" }], them: [{ start: 1, end: 4.5, text: "Yes, the budget is ready." }] });
    expect((await session.finish(t, new Date())).transcript).toBe("[00:04] Them: Yes, the budget is ready.\n");
  });

  it("keeps a quick reply after the other side stops, while the call app's stream runs on at a low noise floor", async () => {
    // The other side speaks until 3.85 s, then their stream carries only a faint floor; the person answers 0.15 s later. Their last
    // words fall in the stretch looked back over, and the reply must not be taken for an echo of them (Ruling 19).
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    const floor = noise(11);
    writeFileSync(session.themFile, s16(mix(bursts(3.85, 1), at(3.85, Float32Array.from({ length: 6 * RATE }, () => floor() * 0.003)))));
    writeFileSync(session.youFile, s16(at(4, bursts(3, 2))));
    const t = inTurn({ you: [{ start: 4, end: 7, text: "Sure, I can do that." }], them: [{ start: 0.5, end: 3.85, text: "Can you send the draft?" }] });
    expect((await session.finish(t, new Date())).transcript).toBe("[00:00] Them: Can you send the draft?\n\n[00:04] You: Sure, I can do that.\n");
  });

  it("never scores a whole stream: with a transcriber without segments, the microphone's side stays even when it is echo", async () => {
    // Such a transcriber gives each stream as one segment. Scored whole, a call without headphones could pass the threshold and
    // lose everything the person said, so the echo check is skipped (Ruling 18).
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    const them = bursts(6, 1);
    writeFileSync(session.youFile, s16(echoOf(them)));
    writeFileSync(session.themFile, s16(them));
    let calls = 0;
    const t: Transcriber = {
      engine: "fake",
      async transcribe(audio) {
        const samples = audio as Float32Array;
        return { text: calls++ === 0 ? "the deadline Friday" : "So the deadline is Friday.", engine: "fake", seconds: samples.length / RATE };
      },
    };
    expect((await session.finish(t, new Date())).transcript).toBe("[00:00] Them: So the deadline is Friday.\n\n[00:00] You: the deadline Friday\n");
  });

  it("keeps a read-back: the other side's words said again in the person's own voice", async () => {
    // The text rule this replaced dropped these: the same words at the same time on both sides.
    const session = new CallSession({ dir: tmp(), app: "zoom.us", startedAt });
    writeFileSync(session.youFile, s16(bursts(10, 2)));
    writeFileSync(session.themFile, s16(bursts(10, 1)));
    const t = inTurn({
      you: [
        { start: 1, end: 4, text: "Friday for the copy, got it." },
        { start: 6, end: 8, text: "Talk soon." },
      ],
      them: [
        { start: 1, end: 4, text: "Friday for the copy, got it." },
        { start: 8.5, end: 9.5, text: "Bye then." },
      ],
    });
    expect((await session.finish(t, new Date())).transcript).toBe(
      "[00:01] Them: Friday for the copy, got it.\n\n[00:01] You: Friday for the copy, got it.\n\n[00:06] You: Talk soon.\n\n[00:08] Them: Bye then.\n",
    );
  });

  it("gives a transcriber without segments one segment per stream", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(session.youFile, mic(2, 0.5));
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
    writeFileSync(missing.youFile, mic(2, 0.5));
    expect((await missing.finish(t, new Date())).themHeard).toBe(false);

    const empty = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(empty.youFile, mic(2, 0.5));
    writeFileSync(empty.themFile, "");
    expect((await empty.finish(t, new Date())).themHeard).toBe(false);

    const silent = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(silent.youFile, mic(2, 0.5));
    writeFileSync(silent.themFile, pcm(2, 0.001));
    const result = await silent.finish(t, new Date());
    expect(result.themHeard).toBe(false);
    expect(result.transcript).toBe("[00:00] You: Talking to myself\n");

    const quiet = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(quiet.youFile, mic(2, 0.5));
    writeFileSync(quiet.themFile, pcm(2, 0.01));
    expect((await quiet.finish(t, new Date())).themHeard).toBe(true);
  });

  it("throws when neither side produced text", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    await expect(session.finish(fake({ you: [], them: [] }), new Date())).rejects.toThrow(NoSpeechError);

    writeFileSync(session.youFile, mic(3, 0.5));
    writeFileSync(session.themFile, pcm(3, 0.1));
    const error = await session.finish(fake({ you: [], them: [] }), new Date()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoSpeechError);
    expect(error).toBeInstanceOf(AvanzelError);
    expect((error as Error).message).toBe("No speech was heard on this call.");
    expect(new AvanzelError("No speech was heard on this call.")).not.toBeInstanceOf(NoSpeechError);
  });

  it("leaves the files where they are, so Try again can run finish again", async () => {
    const session = new CallSession({ dir: tmp(), app: null, startedAt });
    writeFileSync(session.youFile, mic(2, 0.5));
    writeFileSync(session.themFile, pcm(2, 0.1));
    const t = fake({ you: [{ start: 0, end: 1, text: "Hello" }], them: [] });
    await session.finish(t, new Date());
    expect(existsSync(session.youFile)).toBe(true);
    expect(existsSync(session.themFile)).toBe(true);
    expect(statSync(session.youFile).size).toBe(2 * RATE * 2);
    appendFileSync(session.youFile, mic(1, 0.5));
    expect((await session.finish(t, new Date())).seconds).toBe(3);
  });
});
