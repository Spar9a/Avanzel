// The speech model the library's [voice] settings ask for, kept loaded while they stay the same, with the library's dictionary
// applied on each use. Editing the dictionary never reloads the model (Parakeet's is ~700 MB and takes seconds to load).
import { withDictionary, type Transcriber, type VoiceSettings } from "@avanzel/engine";

/** Makes the bare speech model for `voice`, whose dictionary is empty: the cache applies the dictionary itself. */
export type MakeModel = (voice: VoiceSettings) => Promise<Transcriber>;

/** Correctors kept at once: one for thoughts and one for calls, for this dictionary and the one before. */
const MAX_CORRECTORS = 4;

export class TranscriberCache {
  readonly #make: MakeModel;
  #model: Transcriber | null = null;
  #key = "";
  /** The model with a dictionary applied, by that dictionary and whether it corrects by sound; none owns the model. */
  #correctors = new Map<string, Transcriber>();

  constructor(make: MakeModel) {
    this.#make = make;
  }

  /**
   * The transcriber for `voice`: its speech model, made again only when the speech settings change (not its dictionary), with its
   * dictionary applied. `aliasesOnly`, for a call, corrects only what a heard-as entry names, whatever `dictionarySoundAlike` says:
   * a call keeps no record of what was heard, so nothing but the owner's own entries may change its words. Its `release()` leaves
   * the shared model loaded; `drop` is what frees it.
   */
  async for(voice: VoiceSettings, { aliasesOnly = false }: { aliasesOnly?: boolean } = {}): Promise<Transcriber> {
    const { dictionary, dictionarySoundAlike, ...speech } = voice;
    const key = JSON.stringify(speech);
    if (!this.#model || key !== this.#key) {
      const made = await this.#make({ ...speech, dictionary: [], dictionarySoundAlike });
      this.drop(); // the one these settings replace
      this.#model = made;
      this.#key = key;
    }
    const soundAlike = !aliasesOnly && dictionarySoundAlike;
    const which = JSON.stringify([soundAlike, dictionary]);
    let corrector = this.#correctors.get(which);
    if (!corrector) {
      if (this.#correctors.size >= MAX_CORRECTORS) this.#correctors.clear();
      corrector = withDictionary(shared(this.#model), dictionary, { soundAlike });
      this.#correctors.set(which, corrector);
    }
    return corrector;
  }

  /** Lets the speech model go: it frees its model once the transcriptions in progress end. Not awaited (see `release`). */
  drop(): void {
    const old = this.#model;
    this.#model = null;
    this.#correctors.clear();
    // Not awaited: release() waits for the transcriptions in progress, and a librarian would stall behind a long one.
    old?.release?.().catch((error: unknown) => console.error("speech model", error));
  }
}

/** `model` without its `release`: what the cache gives out uses the model, and only the cache lets it go. */
function shared(model: Transcriber): Transcriber {
  const view: Transcriber = { engine: model.engine, transcribe: (audio, sampleRate) => model.transcribe(audio, sampleRate) };
  const { transcribeSegments } = model;
  if (transcribeSegments) view.transcribeSegments = (samples, sampleRate) => transcribeSegments.call(model, samples, sampleRate);
  return view;
}
