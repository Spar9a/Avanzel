// What the Dictations pane is told about the history, and how an entry is forgotten. Kept apart from the controller, which needs
// Electron, so that the cut of a long text and the way a failed delete is told can be tested on their own.
import { dayFileNotUpdated, DELETE_FAILED_BODY, DICTATION_PAGE, type DeleteDictationResult, type DictationList, type DictationRow } from "../shared/ipc.ts";
import type { DictationEntry, DictationHistory } from "./dictation-history.ts";

/** How many characters of a dictation a row shows; Copy still copies all of it. */
export const PREVIEW_CHARACTERS = 400;

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
 * The newest `limit` of `entries` (newest first, as the history lists them) as rows, and how many there are in all. The history has no
 * limit of its own, so the pane asks for a page at a time: a `limit` that is not a whole number above 0 means the first page, and one
 * above the total gives them all. Only the rows kept are made, so a long history costs the window nothing.
 */
export function pageOf(entries: readonly DictationEntry[], limit?: number): DictationList {
  const wanted = limit !== undefined && Number.isInteger(limit) && limit > 0 ? limit : DICTATION_PAGE;
  return { rows: entries.slice(0, wanted).map(rowOf), total: entries.length };
}

/**
 * What forgetting calls once an entry has left the history, so that whatever else keeps a copy of it (the library's day file) drops it
 * too. It throws, or its promise rejects, when it couldn't: the words may then still be there, and the person is told.
 */
export type ForgetHook = (entry: DictationEntry) => void | Promise<void>;

/**
 * What a hook throws when the day file it couldn't update is in a library other than the open one: `library` is that library's
 * folder as the person reads it (`~/Notes`), for the sentence that tells them where the words may still be.
 */
export class DayFileNotUpdated extends Error {
  constructor(readonly library: string) {
    super("The day file of that dictation couldn't be updated.");
    this.name = "DayFileNotUpdated";
  }
}

/**
 * What a forget did: the entry that left the history (null when there was none), and whether every other copy went too; when not,
 * and the copy is in another library than the open one, `library` names its folder.
 */
export interface Forgotten {
  entry: DictationEntry | null;
  elsewhere: boolean;
  library?: string;
}

/**
 * Forgets entry `id`, then has `onForget` drop it elsewhere, and waits for that. It rejects when the history can't be rewritten, and
 * then the hook hears nothing: the entry is still there. If the hook fails the entry has left the history all the same, so that is
 * no failed delete: `elsewhere` is false, for the caller to say where the words may still be.
 */
export async function forgetDictation(history: Pick<DictationHistory, "remove">, id: string, onForget: ForgetHook | undefined): Promise<Forgotten> {
  const entry = history.remove(id);
  if (!entry || !onForget) return { entry, elsewhere: true };
  try {
    await onForget(entry);
    return { entry, elsewhere: true };
  } catch (error) {
    // Only the code: the message can name a path, and the words are what people said.
    console.error("forget dictation", (error as NodeJS.ErrnoException).code ?? "failed");
    return error instanceof DayFileNotUpdated ? { entry, elsewhere: false, library: error.library } : { entry, elsewhere: false };
  }
}

/**
 * What Delete answers: ok once the dictation is gone (also when it already was); a calm sentence and nothing removed when the history
 * couldn't be rewritten; and when it left the history but not the library's day file, where its words may still be, and the fix.
 */
export async function deleteDictationResult(forget: () => Promise<Forgotten>): Promise<DeleteDictationResult> {
  let forgotten: Forgotten;
  try {
    forgotten = await forget();
  } catch (error) {
    // The cause is not shown, and not logged whole: it can name a path, and the history holds what people said.
    console.error("delete dictation", (error as NodeJS.ErrnoException).code ?? "failed");
    return { ok: false, message: DELETE_FAILED_BODY };
  }
  if (forgotten.elsewhere) return { ok: true };
  const told = dayFileNotUpdated(forgotten.library ?? null);
  return { ok: false, title: told.title, message: told.body };
}
