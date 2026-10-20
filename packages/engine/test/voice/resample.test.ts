import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import { ONNX_RESAMPLE_RATES, resampleTo16k } from "../../src/voice/resample.ts";
import { withoutPath } from "./helpers.ts";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** `seconds` of Σ amplitude·sin(2π·frequency·t) at `rate` as float32, computed in float64 like numpy does. */
function sines(rate: number, seconds: number, ...tones: [frequency: number, amplitude: number][]): Float32Array {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    tones.reduce((sum, [frequency, amplitude]) => sum + amplitude * Math.sin(2 * Math.PI * frequency * (i / rate)), 0),
  );
}

function rms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

/** What onnx-asr 0.12.0 made of `sines(rate, 0.5, [440, 0.5], [5000, 0.25])`; see fixtures/make-resample-fixtures.py. */
function onnxAsrResampled(rate: number): Float32Array {
  const bytes = readFileSync(new URL(`fixtures/resample-${rate}.f32`, import.meta.url));
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(4 * i));
}

describe("resampleTo16k", () => {
  it("matches onnx-asr exactly at 44.1 and 48 kHz", async () => {
    for (const rate of [44100, 48000]) {
      const expected = onnxAsrResampled(rate);
      const resampled = await resampleTo16k(sines(rate, 0.5, [440, 0.5], [5000, 0.25]), rate);
      expect(resampled).toHaveLength(expected.length);
      const off = Array.from(resampled, (value, i) => Math.abs(value - expected[i]!));
      expect(Math.max(...off)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("keeps a 1 kHz tone at every rate onnx-asr knows", async () => {
    expect(ONNX_RESAMPLE_RATES).toEqual([8000, 11025, 22050, 24000, 32000, 44100, 48000]);
    withoutPath(); // none of them needs ffmpeg
    for (const rate of ONNX_RESAMPLE_RATES) {
      const tone = sines(rate, 1, [1000, 0.5]);
      const resampled = await resampleTo16k(tone, rate);
      expect(resampled).toHaveLength(16000);
      expect(Math.abs(rms(resampled) / rms(tone) - 1)).toBeLessThan(0.02);
    }
  });

  it("filters what 16 kHz can't hold", async () => {
    for (const rate of [44100, 48000]) {
      const tone = sines(rate, 1, [10_000, 0.5]); // linear interpolation folds it to 6 kHz at full level
      expect(rms(await resampleTo16k(tone, rate))).toBeLessThan(0.01 * rms(tone));
    }
  });

  it("returns 16 kHz input as it is", async () => {
    const samples = sines(16000, 0.1, [1000, 0.5]);
    expect(await resampleTo16k(samples, 16000)).toBe(samples);
  });

  it.skipIf(!hasFfmpeg)("uses ffmpeg for other rates", async () => {
    const tone = sines(96000, 1, [1000, 0.5]);
    const resampled = await resampleTo16k(tone, 96000);
    expect(Math.abs(resampled.length - tone.length / 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(rms(resampled) / rms(tone) - 1)).toBeLessThan(0.05);
  });

  it("asks for ffmpeg for other rates when it is missing", async () => {
    withoutPath();
    const resampling = resampleTo16k(sines(96000, 0.1, [1000, 0.5]), 96000);
    await expect(resampling).rejects.toThrow(AvanzelError);
    await expect(resampling).rejects.toThrow(/96000 Hz needs ffmpeg/);
  });
});
