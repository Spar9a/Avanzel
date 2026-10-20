import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvanzelError, type Transcript, type VoiceOptions } from "../../src/types.ts";
import { CommandTranscriber } from "../../src/voice/command.ts";
import { lazily, makeTranscriber, MissingModelError, modelFiles } from "../../src/voice/index.ts";
import { pinnedSizeFiles, tempDir, useHfCache } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";

function voice(overrides: Partial<VoiceOptions>): VoiceOptions {
  return { backend: "onnx-asr", model: V3, quantization: "int8", command: [], ...overrides };
}

beforeEach(() => {
  useHfCache(); // an empty Hugging Face cache, so only what a test puts in modelsDir exists
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
    for (const id of [V3, "silero-vad"]) pinnedSizeFiles(join(models, id), id, modelFiles(id));
    // Present now, so loading gets past the missing-model check (and fails on the fake files).
    const error = await transcriber.transcribe(new Float32Array(16000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error).not.toBeInstanceOf(MissingModelError);
    expect((error as Error).message).toMatch(/Could not load speech model/);
  });

  it("rejects models and quantizations it cannot run", async () => {
    await expect(makeTranscriber(voice({ model: "whisper-base" }), tempDir())).rejects.toThrow(/whisper-base/);
    // Silero VAD is a known model, but not one to transcribe with; the message lists the Parakeet models.
    await expect(makeTranscriber(voice({ model: "silero-vad" }), tempDir())).rejects.toThrow(
      /'silero-vad' is not supported; use "nemo-parakeet-tdt-0\.6b-v3" or "nemo-parakeet-tdt-0\.6b-v2"/,
    );
    await expect(makeTranscriber(voice({ quantization: "fp16" }), tempDir())).rejects.toThrow(AvanzelError);
  });

  it("builds a command transcriber", async () => {
    const transcriber = await makeTranscriber(voice({ backend: "command", command: ["/opt/bin/whisper-cli", "-f", "{audio}"] }), tempDir());
    expect(transcriber).toBeInstanceOf(CommandTranscriber);
    expect(transcriber.engine).toBe("command:whisper-cli");
    await expect(makeTranscriber(voice({ backend: "command" }), tempDir())).rejects.toThrow(/voice\.command/);
  });

  it("releases a command transcriber without anything to free", async () => {
    const transcriber = await makeTranscriber(voice({ backend: "command", command: ["/opt/bin/whisper-cli", "-f", "{audio}"] }), tempDir());
    await expect(transcriber.release?.()).resolves.toBeUndefined();
  });

  it("can be released before it has loaded anything, and is still usable", async () => {
    const transcriber = await makeTranscriber(voice({}), tempDir());
    await expect(transcriber.release?.()).resolves.toBeUndefined();
    await expect(transcriber.transcribe(new Float32Array(16000))).rejects.toThrow(MissingModelError);
  });

  it("rejects unknown backends", async () => {
    await expect(makeTranscriber(voice({ backend: "nope" }), tempDir())).rejects.toThrow(AvanzelError);
    await expect(makeTranscriber(voice({ backend: "nope" }), tempDir())).rejects.toThrow(/nope/);
  });
});

const heard: Transcript = { text: "heard", engine: "fake", seconds: 1 };
const audio = new Float32Array(16000);

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets every pending promise callback run; the fakes below use no timers. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Hooks {
  /** Loading finishes when this does. */
  ready?: Promise<void>;
  transcribe?: () => Promise<Transcript>;
  release?: () => Promise<void>;
}

/** A loader of fake models, which it keeps in `models` with their calls counted. */
function fakeModels({ ready, transcribe = async () => heard, release = async () => {} }: Hooks = {}) {
  const make = () => ({ engine: "fake", transcribe: vi.fn(transcribe), release: vi.fn(release) });
  const models: ReturnType<typeof make>[] = [];
  const load = vi.fn(async () => {
    await ready;
    const model = make();
    models.push(model);
    return model;
  });
  return { load, models };
}

describe("a lazily loading transcriber", () => {
  it("release frees the loaded model and the next use loads it again", async () => {
    const { load, models } = fakeModels();
    const transcriber = lazily("fake", load);
    expect(load).not.toHaveBeenCalled();
    await transcriber.transcribe(audio);
    await transcriber.transcribe(audio);
    expect(load).toHaveBeenCalledTimes(1);
    expect(models[0]!.release).not.toHaveBeenCalled();

    await transcriber.release();
    expect(models[0]!.release).toHaveBeenCalledTimes(1);

    expect(await transcriber.transcribe(audio)).toEqual(heard);
    expect(load).toHaveBeenCalledTimes(2);
    expect(models[1]!.transcribe).toHaveBeenCalledTimes(1);
    expect(models[0]!.transcribe).toHaveBeenCalledTimes(2); // not used again once released
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("release waits for a transcription in progress", async () => {
    const answer = deferred<Transcript>();
    const { load, models } = fakeModels({ transcribe: () => answer.promise });
    const transcriber = lazily("fake", load);
    const transcribing = transcriber.transcribe(audio);
    await settle();
    expect(models[0]!.transcribe).toHaveBeenCalledTimes(1);

    const released = transcriber.release();
    await settle();
    expect(models[0]!.release).not.toHaveBeenCalled();

    answer.resolve(heard);
    expect(await transcribing).toEqual(heard);
    await released;
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("release during a load waits for the load and the transcription that wanted it", async () => {
    const ready = deferred();
    const answer = deferred<Transcript>();
    const { load, models } = fakeModels({ ready: ready.promise, transcribe: () => answer.promise });
    const transcriber = lazily("fake", load);
    const transcribing = transcriber.transcribe(audio);
    const released = transcriber.release();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(models).toHaveLength(0); // still loading

    ready.resolve();
    await settle();
    expect(models[0]!.transcribe).toHaveBeenCalledTimes(1); // loaded, and the transcription that wanted it has begun
    expect(models[0]!.release).not.toHaveBeenCalled();

    answer.resolve(heard);
    expect(await transcribing).toEqual(heard);
    await released;
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("two releases at once free the model once, and neither is done before it is freed", async () => {
    const freed = deferred();
    const { load, models } = fakeModels({ release: () => freed.promise });
    const transcriber = lazily("fake", load);
    await transcriber.transcribe(audio);

    const finished: number[] = [];
    const first = transcriber.release().then(() => finished.push(1));
    const second = transcriber.release().then(() => finished.push(2));
    await settle();
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
    expect(finished).toEqual([]);

    freed.resolve();
    await Promise.all([first, second]);
    expect(finished).toHaveLength(2);
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("a transcription that starts during a release loads the model again once it is freed", async () => {
    const answer = deferred<Transcript>();
    const answers = [answer.promise]; // the first transcription waits; later ones answer at once
    const { load, models } = fakeModels({ transcribe: () => answers.shift() ?? Promise.resolve(heard) });
    const transcriber = lazily("fake", load);
    const first = transcriber.transcribe(audio);
    await settle();
    const released = transcriber.release();
    const second = transcriber.transcribe(audio);
    await settle();
    expect(load).toHaveBeenCalledTimes(1); // the old model is neither reused nor loaded alongside a new one

    answer.resolve(heard);
    await Promise.all([first, released, second]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(models[0]!.transcribe).toHaveBeenCalledTimes(1);
    expect(models[0]!.release).toHaveBeenCalledTimes(1);
    expect(models[0]!.release.mock.invocationCallOrder[0]!).toBeLessThan(load.mock.invocationCallOrder[1]!);
    expect(models[1]!.transcribe).toHaveBeenCalledTimes(1);
    expect(models[1]!.release).not.toHaveBeenCalled();
  });

  it("a release that fails is reported to its caller, not to a transcription waiting for it", async () => {
    const answer = deferred<Transcript>();
    const answers = [answer.promise];
    const { load, models } = fakeModels({
      transcribe: () => answers.shift() ?? Promise.resolve(heard),
      release: () => Promise.reject(new Error("could not free it")),
    });
    const transcriber = lazily("fake", load);
    const first = transcriber.transcribe(audio);
    await settle();
    const released = transcriber.release();
    const second = transcriber.transcribe(audio);

    answer.resolve(heard);
    await expect(released).rejects.toThrow("could not free it");
    expect(await first).toEqual(heard);
    expect(await second).toEqual(heard);
    expect(load).toHaveBeenCalledTimes(2);
    expect(models[1]!.transcribe).toHaveBeenCalledTimes(1);
  });
});
