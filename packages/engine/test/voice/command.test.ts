import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import { CommandTranscriber } from "../../src/voice/command.ts";
import { tempDir, wavBytes, withoutPath } from "./helpers.ts";

// A fake speech-to-text CLI: prints the WAV it was given, with messy whitespace.
const DESCRIBE_WAV = `
const b = require("node:fs").readFileSync(process.argv[1]);
const channels = b.readUInt16LE(22), rate = b.readUInt32LE(24), bits = b.readUInt16LE(34);
console.log("heard", process.argv[1]);
console.log("  rate=" + rate, " channels=" + channels + "\\n\\n bits=" + bits + "   frames=" + b.readUInt32LE(40) / (channels * bits / 8) + "  ");
`;
const fake = [process.execPath, "-e", DESCRIBE_WAV, "{audio}"];

function wavFile(name: string, sampleRate: number, bits: 8 | 16, frames: number[][]): string {
  const path = join(tempDir(), name);
  writeFileSync(path, wavBytes({ sampleRate, bits, frames }));
  return path;
}

function heardPath(text: string): string {
  return text.split(" ")[1]!;
}

describe("CommandTranscriber", () => {
  it("names the engine after the command", () => {
    expect(new CommandTranscriber(fake).engine).toBe(`command:${basename(process.execPath)}`);
    expect(new CommandTranscriber(["/usr/local/bin/whisper-cli", "-f", "{audio}"]).engine).toBe("command:whisper-cli");
  });

  it("needs a command", () => {
    expect(() => new CommandTranscriber([])).toThrow(AvanzelError);
    expect(() => new CommandTranscriber([])).toThrow(/voice\.command/);
  });

  it("passes a 16 kHz mono PCM16 WAV through as-is and collapses whitespace in the output", async () => {
    const wav = wavFile("note.wav", 16000, 16, Array.from({ length: 8000 }, () => [0]));
    const transcript = await new CommandTranscriber(fake).transcribe(wav);
    expect(transcript.text).toBe(`heard ${wav} rate=16000 channels=1 bits=16 frames=8000`);
    expect(transcript.engine).toBe(`command:${basename(process.execPath)}`);
    expect(transcript.seconds).toBe(0.5);
  });

  it("passes a path with $ characters to the command unchanged", async () => {
    const dir = join(tempDir(), "a$&b$$c"); // $&, $$ and the $' in the file name are all replacement patterns
    mkdirSync(dir);
    const path = join(dir, "x$'y.wav");
    writeFileSync(path, wavBytes({ sampleRate: 16000, bits: 16, frames: Array.from({ length: 1600 }, () => [0]) }));
    const echo = new CommandTranscriber([process.execPath, "-e", "process.stdout.write(process.argv[1])", "{audio}"]);
    expect((await echo.transcribe(path)).text).toBe(path);
  });

  it("converts other WAVs to 16 kHz mono PCM16 in a temporary file", async () => {
    const wav = wavFile("cd.wav", 44100, 16, Array.from({ length: 44100 }, () => [100, -100]));
    const transcript = await new CommandTranscriber(fake).transcribe(wav);
    expect(transcript.text).toMatch(/ rate=16000 channels=1 bits=16 frames=16000$/);
    const converted = heardPath(transcript.text);
    expect(converted).not.toBe(wav);
    expect(existsSync(converted)).toBe(false); // cleaned up afterwards
    expect(transcript.seconds).toBe(1);

    const u8 = wavFile("u8.wav", 16000, 8, Array.from({ length: 1600 }, () => [128]));
    expect((await new CommandTranscriber(fake).transcribe(u8)).text).toMatch(/bits=16 frames=1600$/);
  });

  it("writes recorded samples to a WAV, resampling to 16 kHz", async () => {
    const at16k = await new CommandTranscriber(fake).transcribe(new Float32Array(8000));
    expect(at16k.text).toMatch(/ rate=16000 channels=1 bits=16 frames=8000$/);
    expect(at16k.seconds).toBe(0.5);
    const at48k = await new CommandTranscriber(fake).transcribe(new Float32Array(48000), 48000);
    expect(at48k.text).toMatch(/ frames=16000$/);
    expect(at48k.seconds).toBe(1);
  });

  it("reports a failing command with the end of its stderr", async () => {
    const failing = new CommandTranscriber([process.execPath, "-e", "console.error('model missing'); process.exit(3)", "{audio}"]);
    const transcribe = failing.transcribe(new Float32Array(1600));
    await expect(transcribe).rejects.toThrow(AvanzelError);
    await expect(transcribe).rejects.toThrow(/failed: model missing/);
  });

  it("reports a command that is not installed", async () => {
    const missing = new CommandTranscriber(["avanzel-no-such-speech-cli", "{audio}"]);
    await expect(missing.transcribe(new Float32Array(1600))).rejects.toThrow(/avanzel-no-such-speech-cli.*not on your PATH/);
  });

  it("needs ffmpeg for audio that is not WAV", async () => {
    const memo = join(tempDir(), "memo.m4a");
    writeFileSync(memo, "not really audio");
    withoutPath();
    await expect(new CommandTranscriber(fake).transcribe(memo)).rejects.toThrow(/Install ffmpeg/);
  });

  it("needs ffmpeg for recorded samples at a rate onnx-asr doesn't resample", async () => {
    withoutPath();
    await expect(new CommandTranscriber(fake).transcribe(new Float32Array(9600), 96000)).rejects.toThrow(/96000 Hz needs ffmpeg/);
  });
});
