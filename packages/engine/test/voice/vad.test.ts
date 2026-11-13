import { type InferenceSession, Tensor } from "onnxruntime-node";
import { describe, expect, it } from "vitest";
import { findSegments, mergeSegments, packSegments, segmentSpeech, speechProbabilities } from "../../src/voice/vad.ts";

describe("mergeSegments (onnx-asr vad.py at 16 kHz)", () => {
  // 16 kHz defaults: pad 480, min speech 4000-960, max speech 320000-960, min silence 1600+960 samples.
  // Expected values were produced by onnx-asr's BaseVad._merge_segments in Python.
  const cases: [string, [number, number][], number, [number, number][]][] = [
    ["nothing", [], 48000, []],
    ["one segment gets padded", [[16000, 32000]], 48000, [[15520, 32480]]],
    ["a short silence merges", [[16000, 32000], [33000, 40000]], 48000, [[15520, 40480]]],
    ["a long silence splits", [[16000, 32000], [40000, 48000]], 48000, [[15520, 32480], [39520, 48000]]],
    ["too short speech is dropped", [[16000, 18000]], 48000, []],
    ["just long enough speech is kept", [[16000, 19500]], 48000, [[15520, 19980]]],
    ["over-long speech is cut into max-length pieces", [[0, 700000]], 700000, [[0, 319520], [318560, 638560], [637600, 700000]]],
    ["merging stops at the max length", [[0, 200000], [201000, 400000]], 400000, [[0, 200480], [200520, 400000]]],
    ["padding is clamped to the audio", [[100, 8000]], 8000, [[0, 8000]]],
    ["an end past the audio is clamped", [[30000, 50176]], 50000, [[29520, 50000]]],
    ["several close segments merge", [[1000, 2000], [2500, 4000], [4100, 9000]], 20000, [[520, 9480]]],
  ];

  it.each(cases)("%s", (_name, segments, length, expected) => {
    expect(mergeSegments(segments, length, 16000)).toEqual(expected);
  });
});

describe("findSegments (onnx-asr silero.py)", () => {
  const below035 = 0.34999996423721313; // the float32 just under float32(0.35)
  const cases: [number[], [number, number][]][] = [
    [[0.1, 0.6, 0.7, 0.2, 0.1], [[512, 1536]]],
    [[0.1, 0.6, 0.4, 0.36, 0.34, 0.9], [[512, 2048], [2560, 3072]]],
    [[0.5, 0.5], [[0, 1024]]],
    // Python compares float32 probabilities with float32 thresholds: float32(0.35) does not end speech.
    [[Math.fround(0.35), 0.6, Math.fround(0.35), below035, 0], [[512, 1536]]],
    [[Math.fround(0.49999997), 0.2], []],
  ];

  it.each(cases)("%j", (probs, expected) => {
    expect(findSegments(Float32Array.from(probs), 512)).toEqual(expected);
  });
});

/** A stand-in Silero session: records what it is fed and returns scripted probabilities. */
function fakeVad(probs: number[]) {
  const frames: number[][] = [];
  const states: number[] = [];
  const rates: bigint[] = [];
  const session: Pick<InferenceSession, "run"> = {
    async run(feeds: InferenceSession.FeedsType) {
      const { input, state, sr } = feeds as Record<string, Tensor>;
      expect(input!.dims).toEqual([1, input!.data.length]);
      expect(state!.dims).toEqual([2, 1, 128]);
      expect(sr!.type).toBe("int64");
      frames.push([...(input!.data as Float32Array)]);
      states.push((state!.data as Float32Array)[0]!);
      rates.push((sr!.data as BigInt64Array)[0]!);
      const call = frames.length;
      return {
        output: new Tensor("float32", Float32Array.of(probs[call - 1] ?? 0), [1, 1]),
        stateN: new Tensor("float32", new Float32Array(256).fill(call), [2, 1, 128]),
      };
    },
  };
  return { session, frames, states, rates };
}

describe("speechProbabilities", () => {
  it("feeds 512-sample hops with 64 samples of context, like onnx-asr", async () => {
    const samples = Float32Array.from({ length: 512 * 3 + 100 }, (_, i) => i + 1);
    const { session, frames, states, rates } = fakeVad([0.1, 0.2, 0.3, 0.4]);
    const probs = await speechProbabilities(samples, session);
    expect([...probs]).toEqual([0.1, 0.2, 0.3, 0.4].map(Math.fround));
    const range = (from: number, to: number) => [...samples.subarray(from, to)];
    expect(frames).toEqual([
      [...new Array(64).fill(0), ...range(0, 512)],
      range(448, 1024),
      range(960, 1536),
      [...range(1472, 1636), ...new Array(412).fill(0)],
    ]);
    expect(states).toEqual([0, 1, 2, 3]);
    expect(rates).toEqual([16000n, 16000n, 16000n, 16000n]);
  });

  it("adds no partial frame when the length is a multiple of the hop", async () => {
    const { session, frames } = fakeVad([]);
    expect(await speechProbabilities(new Float32Array(1024), session)).toHaveLength(2);
    expect(frames.map((frame) => frame.length)).toEqual([576, 576]);
  });
});

describe("segmentSpeech", () => {
  it("turns Silero probabilities into padded speech segments", async () => {
    // Speech in hops 2..15 = samples [1024, 8192); onnx-asr merges that to [(544, 8672)].
    const probs = [0.1, 0.1, ...new Array(14).fill(0.9), ...new Array(15).fill(0.1)];
    const { session } = fakeVad(probs);
    expect(await segmentSpeech(new Float32Array(512 * 30 + 100), session)).toEqual([[544, 8672]]);
  });
});

describe("packSegments", () => {
  // In samples, with pieces of at most 100.
  const cases: [string, [number, number][], [number, number][]][] = [
    ["nothing", [], []],
    ["one segment stays as it is", [[10, 40]], [[10, 40]]],
    ["segments join, pauses and all, up to the most a piece takes", [[0, 30], [40, 70], [80, 100]], [[0, 100]]],
    ["the segment that would make a piece too long starts the next", [[0, 30], [40, 70], [80, 101]], [[0, 70], [80, 101]]],
    ["a piece starts where its first segment does", [[50, 90], [95, 140], [160, 200]], [[50, 140], [160, 200]]],
    ["a segment longer than a piece is cut into pieces", [[0, 30], [40, 290]], [[0, 30], [40, 140], [140, 240], [240, 290]]],
    ["what is left of a cut segment takes the next ones", [[0, 150], [160, 180]], [[0, 100], [100, 180]]],
  ];

  it.each(cases)("%s", (_name, segments, expected) => {
    expect(packSegments(segments, 100)).toEqual(expected);
  });
});
