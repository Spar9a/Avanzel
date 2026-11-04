import { describe, expect, it } from "vitest";
import { callTranscript, echoScore, echoSegments, mergeCall } from "../../src/core/calls.ts";

describe("mergeCall", () => {
  it("orders both sides by start, ties going to them, and keeps each speaker", () => {
    const you = [
      { start: 0, end: 2, text: "Hi Mark" },
      { start: 5, end: 6, text: "Sure" },
    ];
    const them = [
      { start: 5, end: 7, text: "Can you?" },
      { start: 2.4, end: 4, text: "Hello" },
    ];
    expect(mergeCall(you, them)).toEqual([
      { speaker: "you", start: 0, end: 2, text: "Hi Mark" },
      { speaker: "them", start: 2.4, end: 4, text: "Hello" },
      { speaker: "them", start: 5, end: 7, text: "Can you?" },
      { speaker: "you", start: 5, end: 6, text: "Sure" },
    ]);
  });
});

const RATE = 16_000;

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

/**
 * Speech-like sound: bursts of low-passed noise (most of a voice's energy is low) of changing loudness, 0.25 s on and 0.15 s off,
 * about `level` at the loudest.
 */
function bursts(seconds: number, seed: number, level = 0.5): Float32Array {
  const next = noise(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  const burst = 0.4 * RATE;
  let loud = 0;
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    if (i % burst === 0) loud = level * (0.4 + 0.6 * Math.abs(next()));
    low = 0.8 * low + 0.2 * next();
    out[i] = i % burst < 0.25 * RATE ? loud * low * 3 : 0;
  }
  return out;
}

/** What a microphone hears of `them` through speakers: `delay` seconds late, `gain` as loud, smoothed, with a little noise. */
function echoOf(them: Float32Array, { delay = 0.06, gain = 0.25, seed = 99 } = {}): Float32Array {
  const next = noise(seed);
  const shift = Math.round(delay * RATE);
  const out = new Float32Array(them.length + shift);
  for (let i = 0; i < them.length; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += them[Math.min(them.length - 1, Math.max(0, i + k))]!;
    out[i + shift] = (sum / 5) * gain;
  }
  for (let i = 0; i < out.length; i++) out[i]! += next() * 0.003;
  return out;
}

/** The sum of two sounds, as long as the longer. */
function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** `sound` after `seconds` of silence. */
function after(seconds: number, sound: Float32Array): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE) + sound.length);
  out.set(sound, Math.round(seconds * RATE));
  return out;
}

/** Floats as the 16-bit samples the call's files hold. */
function int16(samples: Float32Array): Int16Array {
  return Int16Array.from(samples, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
}

const seg = (start: number, end: number, text = "words") => ({ start, end, text });

describe("echoSegments", () => {
  const them = bursts(4, 1);
  const themPcm = int16(them);

  it("drops a segment that is the other side's sound, late, quieter and smeared", () => {
    const youPcm = int16(echoOf(them));
    const echo = seg(0, 4);
    expect(echoScore(echo, youPcm, themPcm)).toBeGreaterThan(0.5);
    expect(echoSegments([echo], youPcm, themPcm)).toEqual([]);
  });

  it("keeps a segment of other sound as long", () => {
    const youPcm = int16(bursts(4, 2));
    const own = seg(0, 4);
    expect(echoScore(own, youPcm, themPcm)).toBeLessThan(0.1);
    expect(echoSegments([own], youPcm, themPcm)).toEqual([own]);
  });

  it("keeps the person's own words said over the other side's bleed", () => {
    const youPcm = int16(mix(bursts(4, 3, 0.5), echoOf(bursts(4, 1, 0.2))));
    const own = seg(0, 4);
    // The bleed is there (an unrelated sound scores under 0.04) but the person's own voice is most of it.
    expect(echoScore(own, youPcm, themPcm)).toBeGreaterThan(0.05);
    expect(echoScore(own, youPcm, themPcm)).toBeLessThan(0.12);
    expect(echoSegments([own], youPcm, themPcm)).toEqual([own]);
  });

  it("drops only the segments that are echo, and keeps their order and shape", () => {
    // 0-4 s the other side's echo, then 4-8 s the person's own sound.
    const youPcm = int16(mix(echoOf(them), after(4, bursts(4, 4))));
    const segments = [seg(0.2, 3.6, "the echo"), seg(4.3, 7.8, "my reply")];
    expect(echoSegments(segments, youPcm, themPcm)).toEqual([segments[1]]);
  });

  it("keeps a segment shorter than half a second, echo or not", () => {
    const youPcm = int16(echoOf(them));
    expect(echoScore(seg(0.5, 0.8), youPcm, themPcm)).toBeGreaterThan(0.5);
    expect(echoSegments([seg(0.5, 0.8)], youPcm, themPcm)).toEqual([seg(0.5, 0.8)]);
  });

  it("keeps everything when the other side's stream is empty or silent there", () => {
    const youPcm = int16(echoOf(them));
    expect(echoSegments([seg(0, 4)], youPcm, new Int16Array(0))).toEqual([seg(0, 4)]);
    expect(echoSegments([seg(0, 4)], youPcm, new Int16Array(themPcm.length))).toEqual([seg(0, 4)]);
    expect(echoScore(seg(0, 4), youPcm, new Int16Array(0))).toBe(0);
  });

  it("keeps a segment whose own samples are silent", () => {
    expect(echoSegments([seg(0, 4)], new Int16Array(themPcm.length), themPcm)).toEqual([seg(0, 4)]);
  });

  it("lines the other side up by its offset: an echo of a stream that starts 5 s later is found only with that offset", () => {
    const youPcm = int16(after(5, echoOf(them)));
    const echo = seg(5, 9);
    expect(echoSegments([echo], youPcm, themPcm, { themOffsetSeconds: 5 })).toEqual([]);
    expect(echoSegments([echo], youPcm, themPcm)).toEqual([echo]);
  });

  it("looks no further back than maxLagSeconds", () => {
    const youPcm = int16(echoOf(them, { delay: 0.6 }));
    const echo = seg(0, 4.6);
    expect(echoSegments([echo], youPcm, themPcm)).toEqual([echo]);
    expect(echoSegments([echo], youPcm, themPcm, { maxLagSeconds: 0.7 })).toEqual([]);
  });

  it("drops at the threshold it is given", () => {
    const youPcm = int16(mix(bursts(4, 3, 0.5), echoOf(bursts(4, 1, 0.2))));
    const own = seg(0, 4);
    const score = echoScore(own, youPcm, themPcm);
    expect(echoSegments([own], youPcm, themPcm, { threshold: score - 0.001 })).toEqual([]);
    expect(echoSegments([own], youPcm, themPcm, { threshold: score + 0.001 })).toEqual([own]);
  });

  it("scores as the sum it stands for: the largest correlation over the lags, over both energies at no lag", () => {
    // Long enough for the correlation to take several FFT blocks, with the other side starting 0.1 s late.
    const rate = 1000;
    const opts = { sampleRate: rate, maxLagSeconds: 0.05, themOffsetSeconds: 0.1 };
    const next = noise(7);
    const youPcm = Int16Array.from({ length: 70_000 }, () => Math.round(next() * 20_000));
    const themPcm = Int16Array.from({ length: 70_000 }, (_, i) => Math.round(0.5 * (youPcm[i + 130] ?? 0) + next() * 8_000));
    const segment = { start: 1.3, end: 68.7 };
    const [from, to, lag, shift] = [1300, 68_700, 50, 100];
    const them = (i: number) => (i - shift >= 0 && i - shift < themPcm.length ? themPcm[i - shift]! / 32768 : 0);
    let best = 0;
    for (let k = 0; k <= lag; k++) {
      let sum = 0;
      for (let t = from; t < to; t++) sum += (youPcm[t]! / 32768) * them(t - k);
      best = Math.max(best, Math.abs(sum));
    }
    let you2 = 0;
    let them2 = 0;
    for (let t = from; t < to; t++) {
      you2 += (youPcm[t]! / 32768) ** 2;
      them2 += them(t) ** 2;
    }
    const direct = best / Math.sqrt(you2 * them2);
    expect(direct).toBeGreaterThan(0.5);
    expect(echoScore(segment, youPcm, themPcm, opts)).toBeCloseTo(direct, 9);
  });

  it("scores a 25 s segment well within a second", () => {
    const longThem = bursts(25, 5);
    const youPcm = int16(echoOf(longThem));
    const started = performance.now();
    const score = echoScore(seg(0, 25), youPcm, int16(longThem));
    const took = performance.now() - started;
    expect(score).toBeGreaterThan(0.5);
    expect(took).toBeLessThan(1000);
  });
});

describe("callTranscript", () => {
  it("writes one paragraph per line, led by a minute and second stamp", () => {
    expect(
      callTranscript([
        { speaker: "you", start: 0, end: 2, text: "Hi Mark" },
        { speaker: "them", start: 2.4, end: 5, text: "Hello" },
      ]),
    ).toBe("[00:00] You: Hi Mark\n\n[00:02] Them: Hello\n");
  });

  it("lets minutes pass 59 instead of adding hours", () => {
    expect(callTranscript([{ speaker: "them", start: 61 * 60 + 5, end: 3700, text: "Still here" }])).toBe(
      "[61:05] Them: Still here\n",
    );
  });
});
