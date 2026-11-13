// What the menu's two Undo items take back, kept per library so that they outlast a quit (`UndoRecord`): the commit of the last filing,
// and the commits of the last evening review. With them goes the last filing's receipt (`FilingReceipt`), which "Show the last receipt"
// prints again. Like the run state (run-state.ts) it is about this Mac, not the library, so it lives in the app's own data folder,
// keyed by the library's resolved path, and never shows up in the library's history. A record is only what a commit was; whether the
// commit is still there to take back is for whoever loads it to ask the library's git (`checkUndo`). Whatever is read comes through
// `normalizeUndoRecord`, so anything that isn't a commit is dropped on the way in, and a receipt that isn't whole is none.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FiledPage, ShelfAsk } from "../shared/ipc.ts";
import { parseShelfAsk } from "./shelf-asks.ts";
import { writeJsonAtomic } from "./store.ts";

/** What a filing that ended well told the person, kept so that the card can be printed again (`Controller.showLastReceipt`). */
export interface FilingReceipt {
  /** Its commit; null when the run left none (a library without git, or auto_commit off): the reprint then offers no Undo. */
  commit: string | null;
  text: string;
  agent: string;
  seconds: number;
  /** New pages first (`filedPages`). */
  pages: FiledPage[];
  noted: boolean;
  restored: boolean;
  /** Date.now() as the filing ended: the reprint's stamp prints that day. */
  filedAt: number;
  /** The shelf the filing suggested, as it was pending then; null for none. The reprint asks only while it is still pending. */
  suggestion: ShelfAsk | null;
}

export interface UndoRecord {
  /** The commit "Undo the last filing" takes back, or null. */
  filing: string | null;
  /** The last evening review's commits, oldest first (`EveningReviewResult.commits`): "Undo the last evening review". Empty for none. */
  evening: string[];
  /** The last filing's receipt, kept after the filing's Undo is gone (a review that wrote, a failed filing) until the next filing replaces it; null for none. */
  receipt: FilingReceipt | null;
}

/** A commit's name in full: 40 hex digits (SHA-1), up to 64 (SHA-256). A shorter one, or a name such as HEAD, names no commit for sure. */
const COMMIT = /^[0-9a-f]{40,64}$/i;

const isCommit = (value: unknown): value is string => typeof value === "string" && COMMIT.test(value);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A count of seconds, or a time in milliseconds: a number that is finite and not below zero (JSON keeps no NaN or Infinity, and reads them as null). */
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A page of a receipt: `title`, `shelf` and `path` are strings, and `created` is a boolean when it is there. Anything else about it goes. */
function normalizePage(raw: unknown): FiledPage | null {
  if (!isObject(raw) || typeof raw.title !== "string" || typeof raw.shelf !== "string" || typeof raw.path !== "string") return null;
  if (raw.created === undefined) return { title: raw.title, shelf: raw.shelf, path: raw.path };
  return typeof raw.created === "boolean" ? { title: raw.title, shelf: raw.shelf, path: raw.path, created: raw.created } : null;
}

/**
 * A receipt from whatever was read: kept only when it is whole, otherwise none. A copy, in one order of fields, as `patch` compares them.
 * Its suggestion is the one part that may be missing (a receipt from before suggestions) or broken: either reads as none, and the
 * receipt stays.
 */
function normalizeReceipt(raw: unknown): FilingReceipt | null {
  if (!isObject(raw)) return null;
  const { commit, text, agent, seconds, noted, restored, filedAt } = raw;
  if (!(commit === null || isCommit(commit)) || typeof text !== "string" || typeof agent !== "string") return null;
  if (!isCount(seconds) || !isCount(filedAt) || typeof noted !== "boolean" || typeof restored !== "boolean" || !Array.isArray(raw.pages)) return null;
  const pages = raw.pages.map(normalizePage);
  if (!pages.every((page): page is FiledPage => page !== null)) return null;
  return { commit, text, agent, seconds, pages, noted, restored, filedAt, suggestion: parseShelfAsk(raw.suggestion) };
}

/** A record from whatever was read: a `filing` that is no commit is none, `evening` is kept only when every item is a commit, and a receipt only when whole. */
export function normalizeUndoRecord(raw: unknown): UndoRecord {
  const r = isObject(raw) ? raw : {};
  return {
    filing: isCommit(r.filing) ? r.filing : null,
    evening: Array.isArray(r.evening) && r.evening.every(isCommit) ? [...r.evening] : [],
    receipt: normalizeReceipt(r.receipt),
  };
}

/** Whether a record has nothing to keep: no Undo and no receipt. It is taken out of the file; a record with only a receipt stays. */
const isEmpty = (record: UndoRecord) => record.filing === null && record.evening.length === 0 && record.receipt === null;

export class UndoRecordStore {
  constructor(private readonly file: string) {}

  /** The record for `library`: none (no filing, no commits) when the file has nothing for it, is missing, or is corrupt. */
  get(library: string): UndoRecord {
    return normalizeUndoRecord(this.load()[path.resolve(library)]);
  }

  /**
   * Merges `change` into `library`'s record and writes the whole file, atomically. A field `change` doesn't name is left as it is. A
   * record left with nothing to undo and no receipt is taken out of the file, and a patch that changes nothing writes nothing. A write that fails is
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
      return isObject(raw) ? raw : {};
    } catch {
      return {};
    }
  }
}
