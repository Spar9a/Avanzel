// The personal dictionary as Settings → Voice saves it, and as the stand-in for the speech model hears with it.
import {
  AvanzelError,
  applyDictionary,
  MAX_DICTIONARY_ENTRIES,
  MAX_DICTIONARY_LINE_LENGTH,
  parseDictionary,
  plainLine,
  type Settings,
  type VoiceSettings,
} from "@avanzel/engine";
import type { LibraryPatch } from "../shared/ipc.ts";

/**
 * The lines as typed, as the library keeps them: each one plain line (runs of whitespace become one space), blank lines and
 * repeated ones dropped. Two lines for one term stay two: each is short enough, and the dictionary uses both. Refuses, in plain
 * words for the Settings window's Notice, more lines than the dictionary holds or a line longer than it takes (config loading
 * refuses both too, in words for someone editing config.toml). A long line is named by its place in the field as typed.
 */
export function cleanDictionary(typed: readonly string[]): string[] {
  const kept: string[] = [];
  for (const [index, raw] of typed.entries()) {
    const line = plainLine(raw);
    if (line === "" || kept.includes(line)) continue;
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

/** `settings` with what Settings changed (`setLibrary`); a dictionary is cleaned first (`cleanDictionary`). */
export function patchedSettings(settings: Settings, patch: LibraryPatch): Settings {
  return {
    ...settings,
    ...(patch.harness !== undefined ? { harness: patch.harness } : {}),
    ...(patch.models !== undefined ? { models: patch.models } : {}),
    ...(patch.timeoutSeconds !== undefined ? { timeoutSeconds: patch.timeoutSeconds } : {}),
    ...(patch.dictionary !== undefined ? { voice: { ...settings.voice, dictionary: cleanDictionary(patch.dictionary) } } : {}),
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
