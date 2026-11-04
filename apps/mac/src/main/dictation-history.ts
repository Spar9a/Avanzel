// Every dictation at the cursor, kept on this Mac in a file of the app's own (userData/dictations.jsonl), never in the
// library: one JSON object per line, so a dictation is added by appending and a crash costs at most the line being written.
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One dictation at the cursor, as the history keeps it. */
export interface DictationEntry {
  id: string;
  /** When it was said, ISO with the local offset. */
  at: string;
  /** The words as they were pasted (or would have been, when `inserted` is false). */
  text: string;
  /** What was heard before refining, when the session kept it. */
  heard?: string;
  /** The app that had the cursor. */
  app: string;
  bundleId: string;
  /** The title of the window, when the app told it and storing it is allowed. */
  title: string | null;
  /** The host of the page, when the app is a browser and storing it is allowed. */
  site: string | null;
  seconds: number;
  /** Whether the words were pasted: false when they were only copied for the person to paste. */
  inserted: boolean;
  /**
   * The root of the library whose day file the dictation was also written to, so forgetting it finds that file even when another
   * library is open by then. Absent when the log was off, and in entries kept before the field was.
   */
  library?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nullableString = (value: unknown): boolean => value === null || typeof value === "string";

/** The entry a line holds, or null when it is not JSON or lacks a field the history cannot do without. */
function parseEntry(line: string): DictationEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const ok =
    typeof raw.id === "string" &&
    typeof raw.at === "string" &&
    typeof raw.text === "string" &&
    (raw.heard === undefined || typeof raw.heard === "string") &&
    typeof raw.app === "string" &&
    typeof raw.bundleId === "string" &&
    nullableString(raw.title) &&
    nullableString(raw.site) &&
    typeof raw.seconds === "number" &&
    Number.isFinite(raw.seconds) &&
    typeof raw.inserted === "boolean" &&
    (raw.library === undefined || typeof raw.library === "string");
  return ok ? (raw as unknown as DictationEntry) : null;
}

/** The moment `at` names, so that offsets don't change the order; a time that can't be read counts as the oldest. */
const momentOf = (at: string): number => {
  const moment = Date.parse(at);
  return Number.isNaN(moment) ? Number.NEGATIVE_INFINITY : moment;
};

/** Whether the file has bytes and the last is not a newline, as it is when a crash cut a line short. */
function endsMidLine(file: string): boolean {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return false;
  }
  if (size === 0) return false;
  const fd = openSync(file, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * The history of dictations at the cursor. It is private to the person (the file is 0600) and is read afresh on every
 * call, so a store made later on the same file sees the same data. A line that cannot be read is skipped, never fatal.
 * Adding is best effort: a disk that can't take the line costs the history entry, never the dictation itself. Removing
 * is not: a person who asked for a dictation to be forgotten must be told when it was not, so `remove` throws when the
 * file can't be rewritten.
 */
export class DictationHistory {
  /**
   * `onChange` is called after an entry was added or removed, so that what shows the history (the Dictations pane, the menu's
   * "Forget the last dictation") can read it again. It is told nothing of the entry, and a failure in it costs nothing here.
   */
  constructor(
    private readonly file: string,
    private readonly onChange?: () => void,
  ) {}

  /**
   * Appends `entry`. It never throws (a disk problem must not lose or block the dictation itself), and says whether the entry reached
   * the file, so a caller can keep it nowhere else when it didn't: a copy the history doesn't list can't be forgotten from the app.
   */
  add(entry: DictationEntry): boolean {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      // A line cut short by a crash would swallow this entry if it were glued on, so this one starts a fresh line.
      const lead = endsMidLine(this.file) ? "\n" : "";
      appendFileSync(this.file, `${lead}${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error("dictation history", error);
      return false;
    }
    this.changed();
    return true;
  }

  private changed(): void {
    try {
      this.onChange?.();
    } catch (error) {
      console.error("dictation history", error);
    }
  }

  /** Every entry that can be read, newest first by when it was said; of two said at once, the later-added first. */
  list(): DictationEntry[] {
    const entries: DictationEntry[] = [];
    for (const line of this.lines()) {
      const entry = parseEntry(line);
      if (entry) entries.push(entry);
    }
    // Reversing first makes the stable sort put the later-added first among entries with the same moment.
    return entries.reverse().sort((a, b) => {
      const x = momentOf(a.at);
      const y = momentOf(b.at);
      return x === y ? 0 : x < y ? 1 : -1;
    });
  }

  /** The newest entry, or null when there is none. */
  last(): DictationEntry | null {
    return this.list()[0] ?? null;
  }

  /**
   * Forgets the entry with this id (every copy, should the id repeat) and returns the first, or null when there was none.
   * The file is rewritten whole or not at all, through a temp file and a rename; lines that are not entries are kept as
   * they are, since they are not this call's to throw away.
   */
  remove(id: string): DictationEntry | null {
    let removed: DictationEntry | null = null;
    const kept: string[] = [];
    for (const line of this.lines()) {
      const entry = parseEntry(line);
      if (entry?.id === id) {
        removed ??= entry;
      } else {
        kept.push(line);
      }
    }
    if (!removed) return null;
    const partial = `${this.file}.tmp`;
    writeFileSync(partial, kept.map((line) => `${line}\n`).join(""), { mode: 0o600 });
    renameSync(partial, this.file);
    this.changed();
    return removed;
  }

  /** The file's non-blank lines, in the order they were written; none when it can't be read. */
  private lines(): string[] {
    try {
      return readFileSync(this.file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "");
    } catch {
      return [];
    }
  }
}
