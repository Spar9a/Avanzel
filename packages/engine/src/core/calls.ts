// A call is two streams of speech: the microphone ("you") and the call app's sound ("them"). Merged by time they read
// as the transcript of the conversation.
import type { TimedText } from "../types.ts";
import { fft, nextPow2 } from "./fft.ts";

export type Speaker = "you" | "them";

export interface CallLine extends TimedText {
  speaker: Speaker;
}

// Without headphones the microphone also hears the call app's sound: the "you" stream holds an echo of the "them" one, late (the
// speakers, the room), quieter and smeared. The echo is found in the sound, not the words: the tap's "them" stream is the clean
// original, and a "you" segment that correlates with it closely enough is its echo. (Words fail here: the recognised echo is
// garbled, and a read-back such as "Friday for the copy, got it" says the other side's words in the person's own voice.)

/** The sample rate of both streams, unless told otherwise. */
const ECHO_SAMPLE_RATE = 16_000;
/** How late the echo may come after the other side's sound: speakers, the room and the microphone's buffers. */
const ECHO_MAX_LAG_SECONDS = 0.4;
/**
 * A "you" segment whose score (`echoScore`) reaches this is an echo. From a study of 160 clips through the speech model: 12 of 20
 * echoes caught and none of 99 honest segments dropped (0.15 caught 13 and dropped 1).
 */
const ECHO_THRESHOLD = 0.2;
/** A segment shorter than this is never taken for an echo: too little sound to tell. */
const ECHO_MIN_SECONDS = 0.5;
/** A stretch of sound whose energy (the sum of its squared samples in [-1, 1]) is under this is silent: nothing to compare. */
const ECHO_SILENT = 1e-9;
/** The largest FFT the correlation is done in: a longer segment is correlated block by block, so its memory stays small. */
const ECHO_FFT_MAX = 1 << 16;

export interface EchoOptions {
  /** Both streams' samples per second. Default 16 000. */
  sampleRate?: number;
  /** How many seconds after the "you" stream's first sample the "them" stream's first one came. Default 0. */
  themOffsetSeconds?: number;
  /** How late an echo may come. Default 0.4 s. */
  maxLagSeconds?: number;
  /** The score (`echoScore`) at which a segment is an echo. Default 0.2. */
  threshold?: number;
}

/**
 * How much the "you" segment [start, end] (seconds on the "you" stream) sounds like the "them" stream heard up to `maxLagSeconds`
 * later, from 0 to 1: the largest correlation over those lags, normalised by the segment's own energy and that of the "them" sound
 * over the same stretch (with no lag). Samples outside either stream count as silence; 0 when either side is silent there.
 */
export function echoScore(segment: { start: number; end: number }, youPcm: Int16Array, themPcm: Int16Array, opts: EchoOptions = {}): number {
  const rate = opts.sampleRate ?? ECHO_SAMPLE_RATE;
  const lag = Math.max(0, Math.round((opts.maxLagSeconds ?? ECHO_MAX_LAG_SECONDS) * rate));
  const shift = Math.round((opts.themOffsetSeconds ?? 0) * rate);
  const from = Math.max(0, Math.round(segment.start * rate));
  const to = Math.min(youPcm.length, Math.round(segment.end * rate));
  const n = to - from;
  if (n <= 0 || themPcm.length === 0) return 0;
  const you = (t: number): number => youPcm[from + t]! / 32768;
  /** The "them" sample heard at "you" sample `from - lag + j`: the reference starts `lag` samples before the segment. */
  const ref = (j: number): number => {
    const i = from - lag + j - shift;
    return i >= 0 && i < themPcm.length ? themPcm[i]! / 32768 : 0;
  };
  let youEnergy = 0;
  let themEnergy = 0;
  for (let t = 0; t < n; t++) {
    youEnergy += you(t) ** 2;
    themEnergy += ref(lag + t) ** 2;
  }
  if (youEnergy < ECHO_SILENT || themEnergy < ECHO_SILENT) return 0;

  // corr[m] = sum over t of you(t) * ref(t + m), for m in 0..lag (the echo `lag - m` samples late), block by block: each block's
  // correlation is one FFT of you + i·ref and one inverse, in a size where nothing wraps round (size >= block + lag).
  const size = Math.max(nextPow2(Math.min(n + lag, ECHO_FFT_MAX)), nextPow2(2 * lag + 1));
  const block = size - lag;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const outRe = new Float64Array(size);
  const outIm = new Float64Array(size);
  const corr = new Float64Array(lag + 1);
  for (let t0 = 0; t0 < n; t0 += block) {
    const length = Math.min(block, n - t0);
    re.fill(0);
    im.fill(0);
    for (let t = 0; t < length; t++) re[t] = you(t0 + t);
    for (let j = 0; j < length + lag; j++) im[j] = ref(t0 + j);
    fft(re, im);
    // With Z the transform of a + i·b: A = (Z[k] + conj Z[-k]) / 2, B = (Z[k] - conj Z[-k]) / 2i; the correlation's is conj(A)·B.
    for (let k = 0; k < size; k++) {
      const zr = re[k]!;
      const zi = im[k]!;
      const wr = re[(size - k) & (size - 1)]!;
      const wi = im[(size - k) & (size - 1)]!;
      const ar = (zr + wr) / 2;
      const ai = (zi - wi) / 2;
      const br = (zi + wi) / 2;
      const bi = (wr - zr) / 2;
      outRe[k] = ar * br + ai * bi;
      outIm[k] = ar * bi - ai * br;
    }
    fft(outRe, outIm, true);
    for (let m = 0; m <= lag; m++) corr[m]! += outRe[m]!;
  }
  let best = 0;
  for (let m = 0; m <= lag; m++) best = Math.max(best, Math.abs(corr[m]!));
  return best / Math.sqrt(youEnergy * themEnergy);
}

/**
 * The "you" segments without those that are the call app's sound picked up again by the microphone: a segment goes when its
 * `echoScore` against the "them" stream reaches the threshold. A segment shorter than half a second stays, and so does every
 * segment when the "them" stream is empty. `youPcm` and `themPcm` are the two streams as recorded (16-bit samples).
 */
export function echoSegments(you: readonly TimedText[], youPcm: Int16Array, themPcm: Int16Array, opts: EchoOptions = {}): TimedText[] {
  if (themPcm.length === 0) return [...you];
  const threshold = opts.threshold ?? ECHO_THRESHOLD;
  return you.filter((segment) => segment.end - segment.start < ECHO_MIN_SECONDS || echoScore(segment, youPcm, themPcm, opts) < threshold);
}

/** Both sides in one list ordered by start; when two begin together, "them" comes first. */
export function mergeCall(you: readonly TimedText[], them: readonly TimedText[]): CallLine[] {
  const lines: CallLine[] = [
    ...them.map((segment): CallLine => ({ ...segment, speaker: "them" })),
    ...you.map((segment): CallLine => ({ ...segment, speaker: "you" })),
  ];
  return lines.sort((a, b) => a.start - b.start);
}

function stamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `[${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}]`;
}

/** One paragraph per line, `[mm:ss] You: …`; minutes keep counting past 59 rather than adding hours. */
export function callTranscript(lines: readonly CallLine[]): string {
  return lines.map((line) => `${stamp(line.start)} ${line.speaker === "you" ? "You" : "Them"}: ${line.text}\n`).join("\n");
}
