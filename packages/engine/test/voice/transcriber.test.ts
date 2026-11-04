import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvanzelError, type Transcriber, type Transcript, type VoiceOptions } from "../../src/types.ts";
import { CommandTranscriber } from "../../src/voice/command.ts";
import { lazily, makeTranscriber, MissingModelError, modelFiles, speechModels, withDictionary } from "../../src/voice/index.ts";
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

describe("speechModels", () => {
  it("names Parakeet and Silero for onnx-asr, and nothing for a command", () => {
    expect(speechModels({ backend: "onnx-asr", model: V3, quantization: "int8", command: [] })).toEqual([V3, "silero-vad"]);
    const v2 = "nemo-parakeet-tdt-0.6b-v2";
    expect(speechModels(voice({ model: v2, quantization: "" }))).toEqual([v2, "silero-vad"]);

    const command = ["/opt/bin/whisper-cli", "-f", "{audio}"];
    expect(speechModels(voice({ backend: "command", command }))).toEqual([]);
    // A command has no model or quantization to look at.
    expect(speechModels(voice({ backend: "command", model: "whisper-base", quantization: "fp16" }))).toEqual([]);
    expect(() => speechModels(voice({ backend: "nope" }))).toThrow(/Unknown voice backend/);
  });

  it("rejects what makeTranscriber rejects, with the same message", async () => {
    const unusable = [
      voice({ backend: "nope" }),
      voice({ model: "whisper-base" }),
      voice({ model: "silero-vad" }), // known, but not a model to transcribe with
      voice({ quantization: "fp16" }),
    ];
    for (const options of unusable) {
      const refused = await makeTranscriber(options, tempDir()).then(() => undefined, (error: unknown) => error);
      expect(refused).toBeInstanceOf(AvanzelError);
      expect(() => speechModels(options)).toThrow(new AvanzelError((refused as AvanzelError).message));
    }
  });
});

const heard: Transcript = { text: "heard", engine: "fake", seconds: 1 };
const timed = [{ start: 0, end: 1, text: "heard" }];
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
  const make = () => ({
    engine: "fake",
    transcribe: vi.fn(transcribe),
    transcribeSegments: vi.fn(async () => timed),
    release: vi.fn(release),
  });
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
  it("transcribeSegments loads the model and returns its timed texts", async () => {
    const { load, models } = fakeModels();
    const transcriber = lazily("fake", load);
    expect(await transcriber.transcribeSegments(audio, 8000)).toEqual(timed);
    expect(models[0]!.transcribeSegments).toHaveBeenCalledWith(audio, 8000);
  });

  it("transcribeSegments says so when the model cannot time its speech", async () => {
    const transcriber = lazily("fake", async () => ({ engine: "fake", transcribe: async () => heard }));
    await expect(transcriber.transcribeSegments(audio)).rejects.toThrow(AvanzelError);
  });

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

describe("withDictionary", () => {
  const spoken = [
    { start: 0, end: 2.5, text: "We tried Alema locally." },
    { start: 3, end: 4, text: "It was slow." },
    { start: 5, end: 7, text: "Then Alema again." },
  ];
  function inner(overrides: Partial<Transcriber> = {}): Transcriber {
    return {
      engine: "fake:asr",
      transcribe: vi.fn(async () => ({ text: "We tried Alema locally.", engine: "fake:asr", seconds: 2.5 })),
      transcribeSegments: vi.fn(async () => spoken.map((s) => ({ ...s }))),
      release: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("corrects the text, keeps the engine and seconds, and keeps what was heard", async () => {
    const wrapped = withDictionary(inner(), ["Ollama = Alema"]);
    expect(wrapped.engine).toBe("fake:asr");
    expect(await wrapped.transcribe(audio)).toEqual({
      text: "We tried Ollama locally.",
      engine: "fake:asr",
      seconds: 2.5,
      heard: "We tried Alema locally.",
    });
  });

  it("sets heard only when the text changed", async () => {
    const result = await withDictionary(inner(), ["Kowalczyk"]).transcribe(audio);
    expect(result).toEqual({ text: "We tried Alema locally.", engine: "fake:asr", seconds: 2.5 });
    expect("heard" in result).toBe(false);
  });

  it("passes the audio and sample rate through", async () => {
    const transcribe = vi.fn(async () => heard);
    await withDictionary(inner({ transcribe }), ["Ollama = Alema"]).transcribe(audio, 44100);
    expect(transcribe).toHaveBeenCalledWith(audio, 44100);
  });

  it("corrects every segment and leaves the timings alone", async () => {
    const wrapped = withDictionary(inner(), ["Ollama = Alema"]);
    expect(await wrapped.transcribeSegments?.(audio, 16000)).toEqual([
      { start: 0, end: 2.5, text: "We tried Ollama locally." },
      { start: 3, end: 4, text: "It was slow." },
      { start: 5, end: 7, text: "Then Ollama again." },
    ]);
  });

  it("makes the dictionary ready once, so a long call's segments are corrected quickly", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Term${String.fromCharCode(97 + (i % 26))}${i} = heard${i}, ${Array.from({ length: 5 }, (_, a) => `misheard${i}x${a}`).join(", ")}`);
    const segments = Array.from({ length: 3000 }, (_, i) => ({ start: i, end: i + 1, text: `so we said heard${i % 500} and then the plan moved on again` }));
    const wrapped = withDictionary(inner({ transcribeSegments: vi.fn(async () => segments) }), lines);
    const started = performance.now();
    const corrected = await wrapped.transcribeSegments?.(audio, 16000);
    expect(performance.now() - started).toBeLessThan(500);
    expect(corrected?.[7]?.text).toBe(`so we said Termh7 and then the plan moved on again`);
  });

  it("does not offer segments when the transcriber cannot time its speech", () => {
    const wrapped = withDictionary(inner({ transcribeSegments: undefined }), ["Ollama = Alema"]);
    expect(wrapped.transcribeSegments).toBeUndefined();
  });

  it("releases the transcriber it wraps, and has nothing to release when that has none", async () => {
    const release = vi.fn(async () => {});
    await withDictionary(inner({ release }), ["Ollama = Alema"]).release?.();
    expect(release).toHaveBeenCalledOnce();
    expect(withDictionary(inner({ release: undefined }), ["Ollama = Alema"]).release).toBeUndefined();
  });

  it("lets a failure through unchanged", async () => {
    const wrapped = withDictionary(inner({ transcribe: () => Promise.reject(new AvanzelError("no model")) }), ["Ollama = Alema"]);
    await expect(wrapped.transcribe(audio)).rejects.toThrow("no model");
  });

  it("honours the sound-alike switch", async () => {
    const sounds = inner({ transcribe: async () => ({ text: "Mr Kowalkzik signed.", engine: "fake:asr", seconds: 1 }) });
    expect((await withDictionary(sounds, ["Kowalczyk"]).transcribe(audio)).text).toBe("Mr Kowalczyk signed.");
    const exact = await withDictionary(sounds, ["Kowalczyk"], { soundAlike: false }).transcribe(audio);
    expect(exact.text).toBe("Mr Kowalkzik signed.");
    expect("heard" in exact).toBe(false);
  });

  it("is the transcriber itself when the dictionary has nothing to correct", () => {
    const model = inner();
    expect(withDictionary(model, [])).toBe(model);
    expect(withDictionary(model, ["", "  ", "= foo"])).toBe(model);
  });

  it("wraps what makeTranscriber makes only when options carry a dictionary", async () => {
    const plain = await makeTranscriber(voice({ backend: "command", command: ["/opt/bin/whisper-cli", "{audio}"] }), tempDir());
    expect(plain).toBeInstanceOf(CommandTranscriber);
    const empty = await makeTranscriber(voice({ backend: "command", command: ["/opt/bin/whisper-cli", "{audio}"], dictionary: [] }), tempDir());
    expect(empty).toBeInstanceOf(CommandTranscriber);
    const listed = await makeTranscriber(
      voice({ backend: "command", command: ["/opt/bin/whisper-cli", "{audio}"], dictionary: ["Ollama = Alema"] }),
      tempDir(),
    );
    expect(listed).not.toBeInstanceOf(CommandTranscriber);
    expect(listed.engine).toBe("command:whisper-cli");
    // Without a dictionary the Parakeet backend is the lazily loading transcriber itself: nothing wraps it.
    for (const options of [voice({}), voice({ dictionary: [] }), voice({ dictionary: ["", "= foo"] })]) {
      const bare = await makeTranscriber(options, tempDir());
      expect(Object.keys(bare).sort()).toEqual(["engine", "release", "transcribe", "transcribeSegments"]);
      expect(Object.getPrototypeOf(bare)).toBe(Object.prototype);
      expect(bare.engine).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    }
    const parakeet = await makeTranscriber(voice({ dictionary: ["Ollama = Alema"] }), tempDir());
    expect(parakeet.engine).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    expect(parakeet.transcribeSegments).toBeDefined();
    await expect(parakeet.transcribe(audio)).rejects.toThrow(MissingModelError);
  });
});
