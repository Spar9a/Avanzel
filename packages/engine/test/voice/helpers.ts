import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** A fresh temporary directory, removed when the current test finishes. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "avanzel-voice-test-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface WavSpec {
  sampleRate: number;
  bits: 8 | 16 | 24 | 32;
  /** frames[i][c] = integer sample of channel c (unsigned for 8-bit, as stored). */
  frames: number[][];
  /** 1 = PCM, 3 = IEEE float, 0xfffe = WAVE_FORMAT_EXTENSIBLE (with a PCM sub-format). */
  format?: number;
  /** Extra chunks written before `data`, e.g. LIST metadata; odd sizes get a pad byte. */
  extraChunks?: { id: string; body: Buffer }[];
}

function chunk(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
}

/** Builds WAV bytes by hand so tests don't depend on the code under test. */
export function wavBytes({ sampleRate, bits, frames, format = 1, extraChunks = [] }: WavSpec): Buffer {
  const channels = frames[0]?.length ?? 1;
  const width = bits / 8;
  const fmt = Buffer.alloc(format === 0xfffe ? 40 : 16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * width, 8);
  fmt.writeUInt16LE(channels * width, 12);
  fmt.writeUInt16LE(bits, 14);
  if (format === 0xfffe) {
    fmt.writeUInt16LE(22, 16); // cbSize
    fmt.writeUInt16LE(bits, 18); // valid bits per sample
    fmt.writeUInt32LE(0, 20); // channel mask
    fmt.writeUInt16LE(1, 24); // sub-format GUID starts with WAVE_FORMAT_PCM
    Buffer.from("000000001000800000aa00389b71", "hex").copy(fmt, 26);
  }
  const data = Buffer.alloc(frames.length * channels * width);
  let offset = 0;
  for (const frame of frames) {
    for (const value of frame) {
      if (bits === 8) data.writeUInt8(value, offset);
      else data.writeIntLE(value, offset, width);
      offset += width;
    }
  }
  const body = Buffer.concat([
    Buffer.from("WAVE", "ascii"),
    chunk("fmt ", fmt),
    ...extraChunks.map(({ id, body }) => chunk(id, body)),
    chunk("data", data),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
