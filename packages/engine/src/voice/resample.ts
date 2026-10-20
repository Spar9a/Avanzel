// Any sample rate to 16 kHz as Avanzel v0.1 did it: onnx-asr's own band-limited resamplers for the rates
// onnx-asr knows (assets/resample_*_16.onnx, see assets/NOTICE.md), and ffmpeg for any other rate.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { AvanzelError } from "../types.ts";
import { assetsDir, SESSION_OPTIONS } from "./onnx.ts";
import { findExecutable, readWav, runCommand, SAMPLE_RATE, writeWav } from "./wav.ts";

/** onnx-asr's own resamplers handle these source rates; any other goes through ffmpeg. */
export const ONNX_RESAMPLE_RATES: readonly number[] = [8000, 11025, 22050, 24000, 32000, 44100, 48000];

/** One resampler session per source rate, created on first use. */
const sessions = new Map<number, Promise<InferenceSession>>();

/** Mono samples at `from` Hz as 16 kHz; 16 kHz input comes back as the same array. */
export async function resampleTo16k(samples: Float32Array, from: number): Promise<Float32Array> {
  if (from === SAMPLE_RATE) return samples;
  if (!ONNX_RESAMPLE_RATES.includes(from)) return resampleWithFfmpeg(samples, from);
  const { resampled, resampled_lens } = await (await resampler(from)).run({
    waveforms: new Tensor("float32", samples, [1, samples.length]),
    waveforms_lens: new Tensor("int64", BigInt64Array.of(BigInt(samples.length)), [1]),
  });
  return (resampled!.data as Float32Array).subarray(0, Number((resampled_lens!.data as BigInt64Array)[0]));
}

/** onnx-asr's resampler from `rate` (resample_44_16.onnx for 44.1 kHz), read as bytes so it also loads from inside app.asar. */
function resampler(rate: number): Promise<InferenceSession> {
  let session = sessions.get(rate);
  if (!session) {
    session = InferenceSession.create(readFileSync(join(assetsDir(), `resample_${Math.floor(rate / 1000)}_16.onnx`)), SESSION_OPTIONS);
    sessions.set(rate, session);
    session.catch(() => sessions.delete(rate)); // a failed load is not kept, so a later call tries again
  }
  return session;
}

/** A rate onnx-asr has no resampler for: the samples go to ffmpeg as a PCM16 WAV and come back at 16 kHz. */
async function resampleWithFfmpeg(samples: Float32Array, from: number): Promise<Float32Array> {
  const ffmpeg = findExecutable("ffmpeg");
  if (!ffmpeg) {
    throw new AvanzelError(`Audio at ${from} Hz needs ffmpeg. Install it (macOS: \`brew install ffmpeg\`) to transcribe this audio.`);
  }
  const dir = mkdtempSync(join(tmpdir(), "avanzel-audio-"));
  try {
    const source = join(dir, "source.wav");
    const wav = join(dir, "audio.wav");
    writeWav(source, samples, from);
    const argv = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", source];
    const result = await runCommand(ffmpeg, [...argv, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", wav]);
    if (result.code !== 0) throw new AvanzelError(`ffmpeg could not convert audio at ${from} Hz: ${result.stderr.trim().slice(-400)}`);
    return readWav(wav).samples;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
