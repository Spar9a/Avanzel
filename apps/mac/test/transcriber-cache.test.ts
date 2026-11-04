import { defaultSettings, type Transcriber, type VoiceSettings } from "@avanzel/engine";
import { describe, expect, it, vi } from "vitest";
import { TranscriberCache } from "../src/main/transcriber-cache.ts";

const audio = new Float32Array(16000);

/** A speech model that hears `text`, alone or as one segment, and counts its releases. */
function model(text = "Dimitri will cover the weekly sync"): Transcriber & { release: ReturnType<typeof vi.fn> } {
  return {
    engine: "fake:asr",
    transcribe: vi.fn(async () => ({ text, engine: "fake:asr", seconds: 1 })),
    transcribeSegments: vi.fn(async () => [{ start: 0, end: 1, text }]),
    release: vi.fn(async () => {}),
  };
}

/** A cache whose models are made by `make` and recorded in `made`, with the options each was made with. */
function cache() {
  const made: { options: VoiceSettings; model: ReturnType<typeof model> }[] = [];
  const make = vi.fn(async (options: VoiceSettings) => {
    const one = model();
    made.push({ options, model: one });
    return one;
  });
  return { cache: new TranscriberCache(make), made, make };
}

const voice = (patch: Partial<VoiceSettings> = {}): VoiceSettings => ({ ...defaultSettings().voice, ...patch });

describe("TranscriberCache", () => {
  it("makes the model with no dictionary, and applies the dictionary itself", async () => {
    const { cache: speech, made } = cache();
    const transcriber = await speech.for(voice({ dictionary: ["Dmitri"] }));
    expect(made).toHaveLength(1);
    expect(made[0]!.options.dictionary).toEqual([]);
    expect(await transcriber.transcribe(audio, 16000)).toEqual({
      text: "Dmitri will cover the weekly sync",
      engine: "fake:asr",
      seconds: 1,
      heard: "Dimitri will cover the weekly sync",
    });
  });

  it("keeps the model loaded when only the dictionary changes", async () => {
    const { cache: speech, made } = cache();
    await speech.for(voice({ dictionary: ["Ollama = Alema"] }));
    const next = await speech.for(voice({ dictionary: ["Ollama = Alema", "Dmitri"], dictionarySoundAlike: false }));
    expect(made).toHaveLength(1);
    expect(made[0]!.model.release).not.toHaveBeenCalled();
    expect((await next.transcribe(audio, 16000)).text).toBe("Dimitri will cover the weekly sync"); // sound-alike is off now
    const again = await speech.for(voice({ dictionary: ["Dmitri"] }));
    expect((await again.transcribe(audio, 16000)).text).toBe("Dmitri will cover the weekly sync");
    expect(made).toHaveLength(1);
    expect(made[0]!.model.transcribe).toHaveBeenCalledTimes(2);
  });

  it("makes the model again, and releases the old one, when the speech settings change", async () => {
    const { cache: speech, made } = cache();
    await speech.for(voice({ dictionary: ["Dmitri"] }));
    await speech.for(voice({ dictionary: ["Dmitri"], quantization: "fp32" }));
    expect(made).toHaveLength(2);
    expect(made[0]!.model.release).toHaveBeenCalledOnce();
    expect(made[1]!.model.release).not.toHaveBeenCalled();
  });

  it("gives transcribers whose release leaves the shared model loaded; drop releases it", async () => {
    const { cache: speech, made } = cache();
    for (const dictionary of [[], ["Dmitri"]]) {
      const transcriber = await speech.for(voice({ dictionary }));
      await transcriber.release?.();
    }
    expect(made[0]!.model.release).not.toHaveBeenCalled();
    speech.drop();
    expect(made[0]!.model.release).toHaveBeenCalledOnce();
    await speech.for(voice());
    expect(made).toHaveLength(2);
  });

  it("reuses one corrector for the same dictionary", async () => {
    const { cache: speech } = cache();
    const first = await speech.for(voice({ dictionary: ["Dmitri"] }));
    expect(await speech.for(voice({ dictionary: ["Dmitri"] }))).toBe(first);
    expect(await speech.for(voice({ dictionary: ["Dmitri"] }), { aliasesOnly: true })).not.toBe(first);
  });

  describe("for a call: aliases only, whatever dictionary_sound_alike says", () => {
    it("leaves a near miss that only sounds like a term", async () => {
      const { cache: speech } = cache();
      const calls = await speech.for(voice({ dictionary: ["Dmitri"], dictionarySoundAlike: true }), { aliasesOnly: true });
      expect(await calls.transcribeSegments?.(audio, 16000)).toEqual([{ start: 0, end: 1, text: "Dimitri will cover the weekly sync" }]);
    });

    it("corrects what a heard-as entry names", async () => {
      const { cache: speech } = cache();
      const calls = await speech.for(voice({ dictionary: ["Dmitri = Dimitri"] }), { aliasesOnly: true });
      expect(await calls.transcribeSegments?.(audio, 16000)).toEqual([{ start: 0, end: 1, text: "Dmitri will cover the weekly sync" }]);
    });
  });
});
