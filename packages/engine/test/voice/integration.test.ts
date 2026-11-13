// End to end with the real models and macOS `say`; opt-in because it needs both:
//   AVANZEL_TEST_ASR=1 npm test -w @avanzel/engine -- test/voice
// Models come from the Hugging Face cache when it has them; anything missing is downloaded once
// into $TMPDIR/avanzel-test-models.
import { spawnSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceSession } from "onnxruntime-node";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { AvanzelError, type Transcriber } from "../../src/types.ts";
import {
  downloadModel,
  locateModel,
  makeTranscriber,
  modelFiles,
  ParakeetTranscriber,
  readWav,
  segmentSpeech,
  VAD_MODEL,
} from "../../src/voice/index.ts";
import { SESSION_OPTIONS } from "../../src/voice/parakeet.ts";
import { tempDir } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";
const MODELS_DIR = join(tmpdir(), "avanzel-test-models");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Speaks `text` into a file; 16 kHz mono PCM16 WAV unless other `say` options are given. */
function say(voice: string, text: string, name: string, options = ["--data-format=LEI16@16000"]): string {
  const path = join(tempDir(), name);
  expect(spawnSync("say", ["-v", voice, "-o", path, ...options, text]).status).toBe(0);
  return path;
}

describe.skipIf(process.env.AVANZEL_TEST_ASR !== "1")("Parakeet v3 end to end (AVANZEL_TEST_ASR=1)", () => {
  let transcriber: Transcriber;

  beforeAll(async () => {
    for (const id of [V3, VAD_MODEL]) if (!locateModel(id, MODELS_DIR)) await downloadModel(id, MODELS_DIR);
    transcriber = await makeTranscriber({ backend: "onnx-asr", model: V3, quantization: "int8", command: [] }, MODELS_DIR);
  }, 300_000);

  // Expected texts are what Avanzel v0.1 (`avanzel transcribe <wav>`) printed for the same `say` output.
  it("transcribes English like v0.1", async () => {
    const wav = say("Samantha", "I want to launch my podcast about indie game development before the end of the year.", "en.wav");
    const transcript = await transcriber.transcribe(wav);
    expect(transcript.text).toBe("I want to launch my podcast about indie game development before the end of the year.");
    expect(transcript.engine).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    expect(transcript.seconds).toBeGreaterThan(3);
    // Recorded samples take the same path as the file.
    expect((await transcriber.transcribe(readWav(wav).samples)).text).toBe(transcript.text);
  });

  it("transcribes Russian like v0.1", async () => {
    const wav = say("Milena", "Идея: сделать маленький сад на балконе с помидорами и базиликом.", "ru.wav");
    expect((await transcriber.transcribe(wav)).text).toBe("Идея сделать маленький сад на балконе с помидорами и базиликом.");
  });

  it("splits audio longer than 25 s with Silero VAD", async () => {
    const sentence = "The lighthouse keeper writes a long letter to the harbour master every single morning before sunrise.";
    const spoken = Array(8).fill(sentence).join(" ");
    const wav = say("Samantha", spoken, "long.wav");
    const { samples } = readWav(wav);

    const vad = await InferenceSession.create(join(locateModel(VAD_MODEL, MODELS_DIR)!, modelFiles(VAD_MODEL)[0]!), SESSION_OPTIONS);
    const segments = await segmentSpeech(samples, vad);
    expect(segments.length).toBeGreaterThan(1);
    let previousEnd = 0;
    for (const [start, end] of segments) {
      expect(start).toBeGreaterThanOrEqual(previousEnd - 960); // neighbours may share their padding
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(samples.length);
      expect(end - start).toBeLessThanOrEqual(20 * 16000);
      previousEnd = end;
    }

    const transcript = await transcriber.transcribe(wav);
    expect(transcript.seconds).toBeGreaterThan(25);
    // The clip is the macOS voice Samantha (macOS 26.6) reading `spoken`: eight sentences, each with its full stop, one space
    // between them. Avanzel v0.1 (onnx-asr 0.12.0), which heard it pause by pause, printed exactly `spoken`; heard in pieces of
    // up to 25 s, as now, Parakeet spells the one word the American way. If a macOS update changes the voice and this fails,
    // expect what the transcriber prints for the new `say` output.
    expect(transcript.text).toBe(spoken.replaceAll("harbour", "harbor"));
  }, 60_000);

  it("reads other sample rates and channel counts", async () => {
    const options = ["--data-format=LEI16@44100", "--channels=2"];
    const wav = say("Samantha", "I want to launch my podcast about indie game development.", "stereo.wav", options);
    expect((await transcriber.transcribe(wav)).text).toMatch(/podcast about indie game development/);
  });

  it.skipIf(!hasFfmpeg)("reads compressed audio through ffmpeg", async () => {
    const m4a = say("Samantha", "I want to launch my podcast about indie game development.", "memo.m4a", [
      "--file-format=m4af",
      "--data-format=aac",
    ]);
    expect((await transcriber.transcribe(m4a)).text).toMatch(/podcast about indie game development/);
  });

  it("uses the engine's own nemo128.onnx, not one in the model directory", async () => {
    const located = locateModel(V3, MODELS_DIR)!;
    const modelDir = tempDir();
    for (const name of modelFiles(V3)) symlinkSync(join(located, name), join(modelDir, name));
    writeFileSync(join(modelDir, "nemo128.onnx"), "not a preprocessor");
    const parakeet = await ParakeetTranscriber.load(modelDir, { model: V3 });
    const wav = say("Samantha", "I want to launch my podcast about indie game development before the end of the year.", "en.wav");
    expect((await parakeet.transcribe(wav)).text).toBe("I want to launch my podcast about indie game development before the end of the year.");
  });

  it("returns no text for audio too short to hold a word", async () => {
    for (const length of [0, 100, 200, 319]) {
      expect((await transcriber.transcribe(new Float32Array(length))).text).toBe("");
    }
  });

  it("release frees the sessions and a released model refuses to transcribe", async () => {
    const vadPath = join(locateModel(VAD_MODEL, MODELS_DIR)!, modelFiles(VAD_MODEL)[0]!);
    // Still makes real sessions; the spy keeps them, so the test can ask each one whether it is freed.
    const create = vi.spyOn(InferenceSession, "create");
    onTestFinished(() => create.mockRestore());
    const parakeet = await ParakeetTranscriber.load(locateModel(V3, MODELS_DIR)!, { model: V3, vadPath });
    const sessions = await Promise.all(create.mock.results.map((result) => result.value as Promise<InferenceSession>));
    expect(sessions).toHaveLength(4); // nemo128, encoder, decoder and Silero VAD

    // Releasing while a transcription runs, twice: the transcription finishes, then the sessions are freed once.
    const wav = say("Samantha", "I want to launch my podcast about indie game development before the end of the year.", "en.wav");
    const transcribing = parakeet.transcribe(wav);
    const releases = [parakeet.release(), parakeet.release()];
    expect((await transcribing).text).toBe("I want to launch my podcast about indie game development before the end of the year.");
    await Promise.all(releases);
    // Releasing a session that is already freed fails; one the model had left alone would be freed here instead.
    for (const session of sessions) await expect(session.release()).rejects.toThrow(/already disposed/);

    const refused = parakeet.transcribe(wav);
    await expect(refused).rejects.toThrow(AvanzelError);
    await expect(refused).rejects.toThrow(/released/);
    await expect(parakeet.transcribe(new Float32Array(16000))).rejects.toThrow(/released/);
  });
});
