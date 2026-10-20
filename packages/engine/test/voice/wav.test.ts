import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import { loadAudio, readWav, resampleLinear, writeWav } from "../../src/voice/wav.ts";
import { tempDir, wavBytes, withoutPath } from "./helpers.ts";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

function writeFixture(name: string, bytes: Buffer): string {
  const path = join(tempDir(), name);
  writeFileSync(path, bytes);
  return path;
}

describe("writeWav / readWav", () => {
  it("round-trips 16 kHz mono PCM16 exactly", () => {
    const samples = Float32Array.of(-1, -0.5, 0, 0.25, 12345 / 32768, 32767 / 32768);
    const path = join(tempDir(), "note.wav");
    writeWav(path, samples);
    const audio = readWav(path);
    expect(audio.sampleRate).toBe(16000);
    expect(audio.channels).toBe(1);
    expect(audio.bitsPerSample).toBe(16);
    expect([...audio.samples]).toEqual([...samples]);
  });

  it("keeps a custom sample rate and writes a plain PCM16 mono header", () => {
    const path = join(tempDir(), "a.wav");
    writeWav(path, new Float32Array(441), 44100);
    expect(readWav(path).sampleRate).toBe(44100);
    const bytes = readFileSync(path);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(bytes.readUInt16LE(20)).toBe(1); // PCM
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt32LE(24)).toBe(44100);
    expect(bytes.readUInt32LE(28)).toBe(44100 * 2); // byte rate
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.toString("ascii", 36, 40)).toBe("data");
    expect(bytes.readUInt32LE(40)).toBe(441 * 2);
  });

  it("clips samples outside [-1, 1]", () => {
    const path = join(tempDir(), "loud.wav");
    writeWav(path, Float32Array.of(1.5, -2, 1));
    expect([...readWav(path).samples]).toEqual([32767 / 32768, -1, 32767 / 32768]);
  });

  it("reads unsigned 8-bit PCM", () => {
    const path = writeFixture("u8.wav", wavBytes({ sampleRate: 8000, bits: 8, frames: [[0], [128], [255], [64]] }));
    const audio = readWav(path);
    expect(audio.sampleRate).toBe(8000);
    expect(audio.bitsPerSample).toBe(8);
    expect([...audio.samples]).toEqual([-1, 0, 127 / 128, -0.5]);
  });

  it("reads 24-bit PCM", () => {
    const frames = [[8388607], [-8388608], [0], [4194304], [-1]];
    const audio = readWav(writeFixture("s24.wav", wavBytes({ sampleRate: 48000, bits: 24, frames })));
    expect([...audio.samples]).toEqual([8388607 / 8388608, -1, 0, 0.5, -1 / 8388608]);
  });

  it("reads 32-bit PCM the way onnx-asr does (float32 rounding)", () => {
    const frames = [[2147483647], [-2147483648], [1073741824], [123456789]];
    const audio = readWav(writeFixture("s32.wav", wavBytes({ sampleRate: 16000, bits: 32, frames })));
    expect([...audio.samples]).toEqual([1, -1, 0.5, Math.fround(123456789) / 2147483648]);
  });

  it("averages stereo to mono", () => {
    const frames = [[1000, 3000], [-32768, 32767]];
    const audio = readWav(writeFixture("stereo.wav", wavBytes({ sampleRate: 44100, bits: 16, frames })));
    expect(audio.channels).toBe(2);
    expect([...audio.samples]).toEqual([2000 / 32768, -1 / 65536]);
  });

  it("averages any number of channels", () => {
    const frames = [[100, 200, 400]];
    const audio = readWav(writeFixture("three.wav", wavBytes({ sampleRate: 16000, bits: 16, frames })));
    expect([...audio.samples]).toEqual([Math.fround(700 / 32768 / 3)]);
  });

  it("skips other chunks, including odd-sized ones", () => {
    const extraChunks = [{ id: "LIST", body: Buffer.from("INFOabc", "ascii") }];
    const path = writeFixture("list.wav", wavBytes({ sampleRate: 16000, bits: 16, frames: [[16384], [-16384]], extraChunks }));
    expect([...readWav(path).samples]).toEqual([0.5, -0.5]);
  });

  it("reads WAVE_FORMAT_EXTENSIBLE PCM", () => {
    const path = writeFixture("ext.wav", wavBytes({ sampleRate: 16000, bits: 24, frames: [[4194304]], format: 0xfffe }));
    expect([...readWav(path).samples]).toEqual([0.5]);
  });

  it("reads the whole frames of a truncated data chunk", () => {
    const bytes = wavBytes({ sampleRate: 16000, bits: 16, frames: [[16384], [-16384], [8192]] });
    const path = writeFixture("cut.wav", bytes.subarray(0, bytes.length - 3));
    expect([...readWav(path).samples]).toEqual([0.5]);
  });

  it("rejects files that are not PCM WAV with an AvanzelError", () => {
    const junk = writeFixture("junk.wav", Buffer.from("definitely not audio"));
    expect(() => readWav(junk)).toThrow(AvanzelError);
    expect(() => readWav(junk)).toThrow(/junk\.wav/);
    const float = writeFixture("float.wav", wavBytes({ sampleRate: 16000, bits: 32, frames: [[0]], format: 3 }));
    expect(() => readWav(float)).toThrow(AvanzelError);
  });
});

describe("resampleLinear", () => {
  it("returns the samples unchanged at the same rate", () => {
    const samples = Float32Array.of(0.1, 0.2, 0.3);
    expect(resampleLinear(samples, 16000, 16000)).toEqual(samples);
  });

  it("produces round(n * to / from) samples", () => {
    expect(resampleLinear(new Float32Array(44100), 44100, 16000)).toHaveLength(16000);
    expect(resampleLinear(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
    expect(resampleLinear(new Float32Array(22050), 22050, 16000)).toHaveLength(16000);
    expect(resampleLinear(new Float32Array(4000), 8000, 16000)).toHaveLength(8000);
    expect(resampleLinear(new Float32Array(1001), 48000, 16000)).toHaveLength(334);
    expect(resampleLinear(new Float32Array(0), 44100, 16000)).toHaveLength(0);
  });

  it("interpolates linearly between neighbouring samples", () => {
    expect([...resampleLinear(Float32Array.of(0, 1, 2, 3), 8000, 16000)]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3]);
    expect([...resampleLinear(Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8), 48000, 16000)]).toEqual([0, 3, 6]);
  });
});

describe("loadAudio", () => {
  it("reads a WAV at any rate as 16 kHz mono", async () => {
    const frames = Array.from({ length: 44100 }, () => [8192, -8192]);
    const path = writeFixture("cd.wav", wavBytes({ sampleRate: 44100, bits: 16, frames }));
    const { samples, seconds } = await loadAudio(path);
    expect(samples).toHaveLength(16000);
    expect(seconds).toBe(1);
    expect(samples.every((value) => value === 0)).toBe(true);
  });

  it("asks the owner to install ffmpeg for other formats when it is missing", async () => {
    const memo = writeFixture("memo.m4a", Buffer.from("not really audio"));
    withoutPath();
    await expect(loadAudio(memo)).rejects.toThrow(AvanzelError);
    await expect(loadAudio(memo)).rejects.toThrow(/Install ffmpeg/);
  });

  it.skipIf(!hasFfmpeg)("converts other formats with ffmpeg", async () => {
    const memo = join(tempDir(), "memo.m4a");
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "2", "-ar", "44100", memo]);
    expect(made.status).toBe(0);
    const { samples, seconds } = await loadAudio(memo);
    expect(Math.abs(samples.length - 16000)).toBeLessThan(1600);
    expect(seconds).toBeCloseTo(samples.length / 16000, 6);
    expect(Math.max(...samples.subarray(4000, 8000))).toBeGreaterThan(0.05); // lavfi's sine peaks at 1/8
  });

  it.skipIf(!hasFfmpeg)("reports audio ffmpeg cannot read", async () => {
    const broken = writeFixture("broken.mp3", Buffer.from("not really audio"));
    await expect(loadAudio(broken)).rejects.toThrow(/ffmpeg could not read broken\.mp3/);
  });
});
