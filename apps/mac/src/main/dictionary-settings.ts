// The personal dictionary as Settings → Voice saves it, and as the stand-in for the speech model hears with it.
import {
  AvanzelError,
  applyDictionary,
  hostedModel,
  MAX_DICTIONARY_ENTRIES,
  MAX_DICTIONARY_LINE_LENGTH,
  parseDictionary,
  plainLine,
  PRIVATE_APIS,
  type PrivateModel,
  type Settings,
  SPEECH_MODELS,
  type Transcriber,
  type VoiceSettings,
  withDictionary,
} from "@avanzel/engine";
import type { LibraryPatch } from "../shared/ipc.ts";
import { cleanSkipList } from "./skip-list.ts";

/**
 * The lines as typed, as the library keeps them: each one plain line (runs of whitespace become one space), blank lines, lines
 * with no term ("= foo") and repeated ones dropped. Two lines for one term stay two: each is short enough, and the dictionary uses both. Refuses, in plain
 * words for the Settings window's Notice, more lines than the dictionary holds or a line longer than it takes (config loading
 * refuses both too, in words for someone editing config.toml). A long line is named by its place in the field as typed.
 */
export function cleanDictionary(typed: readonly string[]): string[] {
  const kept: string[] = [];
  for (const [index, raw] of typed.entries()) {
    const line = plainLine(raw);
    // A line with no term before its equals sign ("= foo") names nothing to correct to: the dictionary would ignore it.
    if (line === "" || line.startsWith("=") || kept.includes(line)) continue;
    if (line.length > MAX_DICTIONARY_LINE_LENGTH) {
      throw new AvanzelError(
        `Line ${index + 1} of the dictionary is ${line.length} characters, and ${MAX_DICTIONARY_LINE_LENGTH} is the most. ` +
          "Shorten it, or put some of its heard-as words on a second line for the same term.",
      );
    }
    kept.push(line);
  }
  if (kept.length > MAX_DICTIONARY_ENTRIES) {
    throw new AvanzelError(
      `The dictionary has ${kept.length} lines, and ${MAX_DICTIONARY_ENTRIES} is the most it can hold. Remove the lines you use least.`,
    );
  }
  return kept;
}

/** A speech model to keep as `[voice] model`: one the engine runs, else it throws in words for Settings' Notice. */
export function cleanSpeechModel(model: string): string {
  if (!SPEECH_MODELS.includes(model)) throw new AvanzelError("Avanzel doesn't have that speech model. Choose one from the list.");
  return model;
}

/**
 * A private model as it is kept: the strings trimmed. The kind of server and the context size are what the settings file reads back,
 * so a value it would refuse throws, and nothing of the patch is kept.
 */
export function cleanPrivate(model: PrivateModel): PrivateModel {
  if (!PRIVATE_APIS.includes(model.api)) throw new AvanzelError("A private model's server speaks chat, messages or responses.");
  if (model.source !== "own" && model.source !== "hosted") throw new AvanzelError("A private model runs on your own server or on a model Avanzel hosts.");
  if (!hostedModel(model.hostedModel)) throw new AvanzelError("Avanzel doesn't host that model.");
  if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0) throw new AvanzelError("The context size must be a whole number.");
  return {
    enabled: model.enabled === true,
    source: model.source,
    hostedModel: model.hostedModel,
    baseUrl: model.baseUrl.trim(),
    model: model.model.trim(),
    api: model.api,
    contextWindow: model.contextWindow,
    keyEnv: model.keyEnv.trim(),
  };
}

/**
 * `settings` with what Settings changed (`setLibrary`); a dictionary is cleaned first (`cleanDictionary`), and so are the skip lists
 * (`cleanSkipList`). A line either refuses throws, and nothing of the patch is kept.
 */
export function patchedSettings(settings: Settings, patch: LibraryPatch): Settings {
  const dictation = {
    ...settings.dictation,
    ...(patch.dictationLog !== undefined ? { log: patch.dictationLog } : {}),
    ...(patch.dictationSkipApps !== undefined ? { skipApps: cleanSkipList(patch.dictationSkipApps, "apps") } : {}),
    ...(patch.dictationSkipSites !== undefined ? { skipSites: cleanSkipList(patch.dictationSkipSites, "sites") } : {}),
  };
  return {
    ...settings,
    ...(patch.harness !== undefined ? { harness: patch.harness } : {}),
    ...(patch.models !== undefined ? { models: patch.models } : {}),
    ...(patch.private !== undefined ? { private: cleanPrivate({ ...settings.private, ...patch.private }) } : {}),
    ...(patch.timeoutSeconds !== undefined ? { timeoutSeconds: patch.timeoutSeconds } : {}),
    voice: {
      ...settings.voice,
      ...(patch.dictionary !== undefined ? { dictionary: cleanDictionary(patch.dictionary) } : {}),
      ...(patch.speechModel !== undefined ? { model: cleanSpeechModel(patch.speechModel) } : {}),
    },
    dictation,
  };
}

/**
 * What the stand-in for the speech model (AVANZEL_FAKE_TRANSCRIPT) hears: `words`, through the library's dictionary as the real
 * transcriber's are (the engine's `withDictionary`), with `heard` only when the dictionary changed them.
 */
export function fakeTranscript(
  words: string,
  voice: Pick<VoiceSettings, "dictionary" | "dictionarySoundAlike">,
): { text: string; engine: string; heard?: string } {
  const { text, changed } = applyDictionary(words, parseDictionary(voice.dictionary), { soundAlike: voice.dictionarySoundAlike });
  return changed ? { text, engine: "fake", heard: words } : { text: words, engine: "fake" };
}

/**
 * The stand-in for the speech model on a call (AVANZEL_FAKE_TRANSCRIPT): it hears `words` in each side, through the library's
 * heard-as entries only, whatever `dictionarySoundAlike` says, as the real call transcriber does (`TranscriberCache.for` with
 * `aliasesOnly`).
 */
export function fakeCallTranscriber(words: string, voice: Pick<VoiceSettings, "dictionary" | "dictionarySoundAlike">): Transcriber {
  const fake: Transcriber = {
    engine: "fake",
    transcribe: async (audio) => ({ text: words, engine: "fake", seconds: typeof audio === "string" ? 0 : audio.length / 16000 }),
  };
  return withDictionary(fake, voice.dictionary, { soundAlike: false });
}
