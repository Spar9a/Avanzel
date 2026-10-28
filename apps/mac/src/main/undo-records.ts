// What the menu's two Undo items take back, kept per library so that they outlast a quit (`UndoRecord`): the commit of the last filing,
// and the commits of the last evening review. Like the run state (run-state.ts) it is about this Mac, not the library, so it lives in
// the app's own data folder, keyed by the library's resolved path, and never shows up in the library's history. A record is only
// what a commit was; whether the commit is still there to take back is for whoever loads it to ask the library's git (`checkUndo`).
// Whatever is read comes through `normalizeUndoRecord`, so anything that isn't a commit is dropped on the way in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./store.ts";

export interface UndoRecord {
  /** The commit "Undo the last filing" takes back, or null. */
  filing: string | null;
  /** The last evening review's commits, oldest first (`EveningReviewResult.commits`): "Undo the last evening review". Empty for none. */
  evening: string[];
}

/** A commit's name in full: 40 hex digits (SHA-1), up to 64 (SHA-256). A shorter one, or a name such as HEAD, names no commit for sure. */
const COMMIT = /^[0-9a-f]{40,64}$/i;

const isCommit = (value: unknown): value is string => typeof value === "string" && COMMIT.test(value);

/** A record from whatever was read: a `filing` that is no commit is none, and `evening` is kept only when every item is a commit. */
export function normalizeUndoRecord(raw: unknown): UndoRecord {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    filing: isCommit(r.filing) ? r.filing : null,
    evening: Array.isArray(r.evening) && r.evening.every(isCommit) ? [...r.evening] : [],
  };
}

/** Whether a record has nothing to undo: it is taken out of the file. */
const isEmpty = (record: UndoRecord) => record.filing === null && record.evening.length === 0;

export class UndoRecordStore {
  constructor(private readonly file: string) {}

  /** The record for `library`: none (no filing, no commits) when the file has nothing for it, is missing, or is corrupt. */
  get(library: string): UndoRecord {
    return normalizeUndoRecord(this.load()[path.resolve(library)]);
  }

  /**
   * Merges `change` into `library`'s record and writes the whole file, atomically. A field `change` doesn't name is left as it is. A
   * record left with nothing to undo is taken out of the file, and a patch that changes nothing writes nothing. A write that fails is
   * logged and let go, as the first-run log's is: the Undo it was for works this app run all the same, and is lost to the next launch.
   */
  patch(library: string, change: Partial<UndoRecord>): void {
    const key = path.resolve(library);
    const all = this.load();
    const before = normalizeUndoRecord(all[key]);
    // Whatever `change` names goes through the same reading as a record from the file; a field it leaves undefined is not named.
    const named = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined));
    const after = normalizeUndoRecord({ ...before, ...named });
    if (JSON.stringify(after) === JSON.stringify(before)) return; // both come from `normalizeUndoRecord`, whose fields are always in one order
    const next = { ...all };
    if (isEmpty(after)) delete next[key];
    else next[key] = after;
    try {
      writeJsonAtomic(this.file, next);
    } catch (error) {
      console.error("undo records", error);
    }
  }

  private load(): Record<string, unknown> {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
