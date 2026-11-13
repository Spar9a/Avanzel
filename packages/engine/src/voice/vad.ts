// Speech segmentation for long recordings with Silero VAD: a port of onnx-asr's models/silero.py (16 kHz)
// and vad.py (`_merge_segments`), with onnx-asr's default options.
import { type InferenceSession, Tensor } from "onnxruntime-node";

export type VadSession = Pick<InferenceSession, "run">;

const HOP = 512;
const CONTEXT = 64;
const THRESHOLD = 0.5;
const NEG_THRESHOLD = THRESHOLD - 0.15;
const MIN_SPEECH_MS = 250;
const MAX_SPEECH_S = 20;
const MIN_SILENCE_MS = 100;
const SPEECH_PAD_MS = 30;
const INF = 10 ** 15;

/** Speech segments [start, end) in samples of 16 kHz mono audio. */
export async function segmentSpeech(samples: Float32Array, vad: VadSession): Promise<[number, number][]> {
  return mergeSegments(findSegments(await speechProbabilities(samples, vad), HOP), samples.length, 16000);
}

/** One speech probability per 512-sample hop, each fed with the 64 samples before it as context. */
export async function speechProbabilities(samples: Float32Array, vad: VadSession): Promise<Float32Array> {
  const probs: number[] = [];
  const sr = new Tensor("int64", BigInt64Array.of(16000n), []);
  let state: Tensor = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const step = async (frame: Float32Array) => {
    const out = await vad.run({ input: new Tensor("float32", frame, [1, frame.length]), state, sr });
    state = out.stateN!;
    probs.push((out.output!.data as Float32Array)[0]!);
  };

  const first = new Float32Array(CONTEXT + Math.min(HOP, samples.length));
  first.set(samples.subarray(0, HOP), CONTEXT);
  await step(first);
  for (let start = HOP; start + HOP <= samples.length; start += HOP) {
    await step(samples.slice(start - CONTEXT, start + HOP));
  }
  const rest = samples.length % HOP;
  if (rest) {
    const last = new Float32Array(CONTEXT + HOP);
    last.set(samples.subarray(Math.max(0, samples.length - rest - CONTEXT)));
    await step(last);
  }
  return Float32Array.from(probs);
}

/** Speech starts at a probability >= 0.5 and ends below 0.35, compared in float32 like numpy does. */
export function findSegments(probs: Float32Array, hopSize: number): [number, number][] {
  const on = Math.fround(THRESHOLD);
  const off = Math.fround(NEG_THRESHOLD);
  const segments: [number, number][] = [];
  let speaking = false;
  let start = 0;
  for (let i = 0; i <= probs.length; i++) {
    const p = i < probs.length ? probs[i]! : 0;
    if (!speaking && p >= on) {
      speaking = true;
      start = i * hopSize;
    } else if (speaking && p < off) {
      speaking = false;
      segments.push([start, i * hopSize]);
    }
  }
  return segments;
}

/**
 * Joins consecutive speech segments, with the pauses between them, into pieces of at most `maxSamples`; a segment longer
 * than that alone is cut into pieces of `maxSamples`. Parakeet recognises a few seconds of speech on its own far worse than
 * the same words with what was said around them (on accented English, 10.9 % of words wrong rather than 6.4 %, and the
 * odd English word written in Cyrillic), so a long recording is heard in the longest pieces it takes in one pass.
 */
export function packSegments(segments: Iterable<readonly [number, number]>, maxSamples: number): [number, number][] {
  const pieces: [number, number][] = [];
  let piece: [number, number] | null = null;
  for (const [segmentStart, end] of segments) {
    if (piece && end - piece[0] <= maxSamples) {
      piece[1] = end;
      continue;
    }
    if (piece) pieces.push(piece);
    let start = segmentStart;
    for (; end - start > maxSamples; start += maxSamples) pieces.push([start, start + maxSamples]);
    piece = [start, end];
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Joins segments split by short silences, drops blips, pads each side and cuts anything over 20 s. */
export function mergeSegments(segments: Iterable<readonly [number, number]>, waveformLen: number, sampleRate: number): [number, number][] {
  const pad = Math.floor((SPEECH_PAD_MS * sampleRate) / 1000);
  const minSpeech = Math.floor((MIN_SPEECH_MS * sampleRate) / 1000) - 2 * pad;
  const maxSpeech = Math.floor(MAX_SPEECH_S * sampleRate) - 2 * pad;
  const minSilence = Math.floor((MIN_SILENCE_MS * sampleRate) / 1000) + 2 * pad;
  const merged: [number, number][] = [];
  let curStart = -INF;
  let curEnd = -INF;
  for (const [segmentStart, end] of [...segments, [waveformLen, waveformLen] as const, [INF, INF] as const]) {
    let start = segmentStart;
    if (start - curEnd < minSilence && end - curStart < maxSpeech) {
      curEnd = end;
      continue;
    }
    if (curStart < waveformLen && curEnd > curStart && curEnd - curStart > minSpeech) {
      merged.push([Math.max(curStart - pad, 0), Math.min(curEnd + pad, waveformLen)]);
    }
    while (end - start > maxSpeech) {
      merged.push([Math.max(start - pad, 0), start + maxSpeech + pad]);
      start += maxSpeech;
    }
    curStart = start;
    curEnd = end;
  }
  return merged;
}
