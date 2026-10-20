// Audio in and out: PCM WAV files, linear resampling, and ffmpeg for every other format.
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { AvanzelError } from "../types.ts";

/** The rate the speech models (and the app's recorder) work at. */
export const SAMPLE_RATE = 16000;

export interface WavAudio {
  /** Mono samples in [-1, 1]; multi-channel files are averaged. */
  samples: Float32Array;
  sampleRate: number;
  /** Channels and sample width of the file itself. */
  channels: number;
  bitsPerSample: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Reads an integer PCM WAV (8/16/24/32-bit, any channel count and rate), scaled like onnx-asr's reader. */
export function readWav(path: string): WavAudio {
  const bytes = readFileSync(path);
  const notPcm = (why: string) => new AvanzelError(`${basename(path)} is not a PCM WAV file (${why}).`);
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw notPcm("no RIFF/WAVE header");
  }
  let format: { channels: number; sampleRate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length && !data; ) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, Math.min(offset + 8 + size, bytes.length));
    if (id === "fmt ") {
      if (body.length < 16) throw notPcm("short fmt chunk");
      const tag = body.readUInt16LE(0) === WAVE_FORMAT_EXTENSIBLE && body.length >= 26 ? body.readUInt16LE(24) : body.readUInt16LE(0);
      if (tag !== WAVE_FORMAT_PCM) throw notPcm(`format ${tag}; only integer PCM is supported`);
      format = { channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === "data") {
      data = body; // the declared size may exceed the file when a recorder was cut off; read what is there
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw notPcm(format ? "no data chunk" : "no fmt chunk before the data");
  const { channels, sampleRate, bits } = format;
  if (channels < 1 || sampleRate < 1 || ![8, 16, 24, 32].includes(bits)) throw notPcm(`${bits}-bit, ${channels} channels, ${sampleRate} Hz`);

  // Each sample becomes a float32 exactly as numpy computes it: int / 2^(bits-1) (unsigned 8-bit is offset by 1).
  const pcm = data;
  const width = bits / 8;
  const read: (offset: number) => number =
    bits === 8
      ? (offset) => pcm.readUInt8(offset) / 128 - 1
      : bits === 32
        ? (offset) => Math.fround(pcm.readInt32LE(offset)) / 2147483648
        : (offset) => pcm.readIntLE(offset, width) / 2 ** (bits - 1);
  const frameBytes = width * channels;
  const samples = new Float32Array(Math.floor(pcm.length / frameBytes));
  for (let frame = 0; frame < samples.length; frame++) {
    const offset = frame * frameBytes;
    if (channels === 1) {
      samples[frame] = read(offset);
    } else {
      let sum = 0; // numpy's float32 mean over the channel axis
      for (let channel = 0; channel < channels; channel++) sum = Math.fround(sum + read(offset + channel * width));
      samples[frame] = sum / channels;
    }
  }
  return { samples, sampleRate, channels, bitsPerSample: bits };
}

/** Writes mono samples in [-1, 1] as a PCM16 WAV (values outside are clipped). */
export function writeWav(path: string, samples: Float32Array, sampleRate = SAMPLE_RATE): void {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i]! * 32768) || 0; // the inverse of readWav, so PCM16 round-trips exactly
    bytes.writeInt16LE(value > 32767 ? 32767 : value < -32768 ? -32768 : value, 44 + 2 * i);
  }
  writeFileSync(path, bytes);
}

/** Linear interpolation from one sample rate to another; returns `samples` itself when the rates match. */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const out = new Float32Array(Math.round((samples.length * to) / from));
  const last = samples.length - 1;
  for (let i = 0; i < out.length; i++) {
    const position = (i * from) / to;
    const left = Math.floor(position);
    const a = samples[Math.min(left, last)]!;
    const b = samples[Math.min(left + 1, last)]!;
    out[i] = a + (b - a) * (position - left);
  }
  return out;
}

/** Any audio file as 16 kHz mono samples: PCM WAVs are read directly, other formats go through ffmpeg. */
export async function loadAudio(path: string): Promise<{ samples: Float32Array; seconds: number }> {
  if (!existsSync(path)) throw new AvanzelError(`No such audio file: ${path}`);
  let audio: WavAudio;
  try {
    audio = readWav(path);
  } catch (error) {
    if (!(error instanceof AvanzelError)) throw error;
    audio = await decodeWithFfmpeg(path);
  }
  return {
    samples: resampleLinear(audio.samples, audio.sampleRate, SAMPLE_RATE),
    seconds: audio.samples.length / audio.sampleRate,
  };
}

async function decodeWithFfmpeg(path: string): Promise<WavAudio> {
  const ffmpeg = findExecutable("ffmpeg");
  if (!ffmpeg) {
    throw new AvanzelError(`Can't read ${basename(path)} directly. Install ffmpeg (macOS: \`brew install ffmpeg\`) to transcribe this audio.`);
  }
  const dir = mkdtempSync(join(tmpdir(), "avanzel-audio-"));
  try {
    const wav = join(dir, "audio.wav");
    const argv = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path];
    const result = await runCommand(ffmpeg, [...argv, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", wav]);
    if (result.code !== 0) throw new AvanzelError(`ffmpeg could not read ${basename(path)}: ${result.stderr.trim().slice(-400)}`);
    return readWav(wav);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first executable called `name` on PATH, like `shutil.which`. */
export function findExecutable(name: string, path = process.env.PATH ?? ""): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** Runs argv without a shell or stdin; rejects only when the program cannot be started. */
export function runCommand(command: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
