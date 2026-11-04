// What the Dictations pane is told about the history, and how an entry is forgotten. Kept apart from the controller, which needs
// Electron, so that the cut of a long text and the way a failed delete is told can be tested on their own.
import type { DeleteDictationResult, DictationRow } from "../shared/ipc.ts";
import type { DictationEntry, DictationHistory } from "./dictation-history.ts";

/** How many characters of a dictation a row shows; Copy still copies all of it. */
export const PREVIEW_CHARACTERS = 400;

/**
 * What the pane says under "That dictation couldn't be deleted.": what is safe, and the one fix. The system's own words are not
 * told, since they name files and say nothing a person could act on.
 */
export const DELETE_FAILED_BODY = "It is still in the history. Try deleting it again.";

/**
 * The first 400 characters of `text`, with an ellipsis when there was more. It counts whole characters, so a character made of two
 * UTF-16 units is never cut in half, and it leaves no space before the ellipsis.
 */
export function previewOf(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= PREVIEW_CHARACTERS) return text;
  return `${characters.slice(0, PREVIEW_CHARACTERS).join("").trimEnd()}…`;
}

/** An entry as the pane shows it. The whole text stays here, in main: the pane asks for it to be copied by id. */
export function rowOf(entry: DictationEntry): DictationRow {
  return { id: entry.id, at: entry.at, preview: previewOf(entry.text), app: entry.app, title: entry.title, site: entry.site, inserted: entry.inserted };
}

/**
 * Forgets entry `id` and tells `onForget` about it, the entry that went. Returns it, or null when there was none. It throws when the
 * history can't be rewritten, and then the hook hears nothing: the entry is still there. The hook exists so that whatever else keeps a
 * copy of a dictation (the library's day file) can drop it too. If the hook fails the entry is gone all the same, and the person's
 * delete has worked, so that failure is only logged.
 */
export function forgetDictation(history: Pick<DictationHistory, "remove">, id: string, onForget: ((entry: DictationEntry) => void) | undefined): DictationEntry | null {
  const entry = history.remove(id);
  if (entry && onForget) {
    try {
      onForget(entry);
    } catch (error) {
      console.error("forget dictation", (error as NodeJS.ErrnoException).code ?? "failed");
    }
  }
  return entry;
}

/** What Delete answers: ok once the dictation is gone (also when it already was), else a calm sentence and nothing removed. */
export function deleteDictationResult(forget: () => DictationEntry | null): DeleteDictationResult {
  try {
    forget();
    return { ok: true };
  } catch (error) {
    // The cause is not shown, and not logged whole: it can name a path, and the history holds what people said.
    console.error("delete dictation", (error as NodeJS.ErrnoException).code ?? "failed");
    return { ok: false, message: DELETE_FAILED_BODY };
  }
}
