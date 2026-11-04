// The library's day file of dictations (the engine's `raw/dictations/YYYY-MM-DD.md`) as the app feeds it: what the history keeps is
// written there when the library's log is on, and forgotten there when the person forgets it. Kept apart from the controller, which
// needs Electron, so both ways can be tested on a real library.
import { lstatSync, readFileSync, type Stats } from "node:fs";
import path from "node:path";
import { appendDictation, forgetDictation, localDate, type DictationLogEntry, type Vault } from "@avanzel/engine";
import type { DictationEntry } from "./dictation-history.ts";

/** The history's entry as the day file takes it: the time as a Date, and `heard` only when the history kept one. */
export function logEntryOf(entry: DictationEntry): DictationLogEntry {
  const logged: DictationLogEntry = { id: entry.id, at: new Date(entry.at), app: entry.app, title: entry.title, site: entry.site, text: entry.text };
  if (entry.heard !== undefined) logged.heard = entry.heard;
  return logged;
}

/**
 * Appends `entry` to the day file of `vault`. It never rejects: the words are pasted and in the history already, and a day file
 * that can't be written must not undo that, so a failure is only logged, without the words (an AvanzelError says what was wrong
 * with the folder or file in plain words, and names no words; any other error by its code alone).
 */
export async function logDictation(vault: Vault, entry: DictationEntry): Promise<void> {
  try {
    await appendDictation(vault, logEntryOf(entry));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error("dictation log", code ?? (error instanceof Error && error.name === "AvanzelError" ? error.message : "failed"));
  }
}

/**
 * Takes `entry` out of the day file of `vault` it was kept in. It rejects when its words may still be there: the file couldn't be
 * rewritten, or the engine found no block to take out though a day file it looks in names the entry's id (a block edited by hand)
 * or is no plain file. An entry that was never kept there (the log was off, or the dictation was skipped) is no failure.
 */
export async function forgetLogged(vault: Vault, entry: DictationEntry): Promise<void> {
  const at = new Date(entry.at);
  if (await forgetDictation(vault, entry.id, at)) return;
  if (mayHold(vault.root, entry.id, at)) throw new Error("The day file of that dictation couldn't be updated.");
}

/** Whether a day file the engine looks in for `id` (the day of `at`, and the day before and after) might still hold it. */
function mayHold(root: string, id: string, at: Date): boolean {
  if (Number.isNaN(at.getTime())) return false;
  return [0, -1, 1].some((offset) => {
    const day = new Date(at.getTime());
    day.setDate(day.getDate() + offset);
    const file = path.join(root, "raw", "dictations", `${localDate(day)}.md`);
    let stat: Stats;
    try {
      stat = lstatSync(file);
    } catch {
      return false; // no day file: nothing of it is there
    }
    if (!stat.isFile()) return true;
    try {
      return readFileSync(file, "utf8").includes(id);
    } catch {
      return true; // a file it can't read may hold the words
    }
  });
}
