import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AvanzelError, type VoiceOptions } from "../../src/types.ts";
import { CommandTranscriber } from "../../src/voice/command.ts";
import { makeTranscriber, MissingModelError, modelFiles } from "../../src/voice/index.ts";
import { tempDir } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";

function voice(overrides: Partial<VoiceOptions>): VoiceOptions {
  return { backend: "onnx-asr", model: V3, quantization: "int8", command: [], ...overrides };
}

beforeEach(() => {
  // An empty Hugging Face cache, so only what a test puts in modelsDir exists.
  const hub = mkdtempSync(join(tmpdir(), "avanzel-voice-hub-"));
  const saved = process.env.HF_HUB_CACHE;
  process.env.HF_HUB_CACHE = hub;
  return () => {
    if (saved === undefined) delete process.env.HF_HUB_CACHE;
    else process.env.HF_HUB_CACHE = saved;
    rmSync(hub, { recursive: true, force: true });
  };
});

describe("makeTranscriber", () => {
  it("returns a lazily loading Parakeet transcriber without touching the models", async () => {
    const v3 = await makeTranscriber(voice({}), tempDir());
    expect(v3.engine).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    const v2 = await makeTranscriber(voice({ model: "nemo-parakeet-tdt-0.6b-v2", quantization: "" }), tempDir());
    expect(v2.engine).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v2");
  });

  it("asks for a download on first use when the models are missing", async () => {
    const transcriber = await makeTranscriber(voice({}), tempDir());
    const attempt = transcriber.transcribe(new Float32Array(16000));
    await expect(attempt).rejects.toThrow(MissingModelError);
    await expect(attempt).rejects.toThrow(AvanzelError);
    await expect(attempt).rejects.toMatchObject({ models: [V3, "silero-vad"] });
  });

  it("looks again after a failed load, e.g. once the owner has downloaded the models", async () => {
    const models = tempDir();
    const transcriber = await makeTranscriber(voice({}), models);
    await expect(transcriber.transcribe(new Float32Array(16000))).rejects.toThrow(MissingModelError);
    for (const [id, files] of [[V3, modelFiles(V3)], ["silero-vad", modelFiles("silero-vad")]] as const) {
      mkdirSync(join(models, id), { recursive: true });
      for (const name of files) writeFileSync(join(models, id, name), "not a real model");
    }
    // Present now, so loading gets past the missing-model check (and fails on the fake files).
    const error = await transcriber.transcribe(new Float32Array(16000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error).not.toBeInstanceOf(MissingModelError);
    expect((error as Error).message).toMatch(/Could not load speech model/);
  });

  it("rejects models and quantizations it cannot run", async () => {
    await expect(makeTranscriber(voice({ model: "whisper-base" }), tempDir())).rejects.toThrow(/whisper-base/);
    await expect(makeTranscriber(voice({ quantization: "fp16" }), tempDir())).rejects.toThrow(AvanzelError);
  });

  it("builds a command transcriber", async () => {
    const transcriber = await makeTranscriber(voice({ backend: "command", command: ["/opt/bin/whisper-cli", "-f", "{audio}"] }), tempDir());
    expect(transcriber).toBeInstanceOf(CommandTranscriber);
    expect(transcriber.engine).toBe("command:whisper-cli");
    await expect(makeTranscriber(voice({ backend: "command" }), tempDir())).rejects.toThrow(/voice\.command/);
  });

  it("rejects unknown backends", async () => {
    await expect(makeTranscriber(voice({ backend: "nope" }), tempDir())).rejects.toThrow(AvanzelError);
    await expect(makeTranscriber(voice({ backend: "nope" }), tempDir())).rejects.toThrow(/nope/);
  });
});
