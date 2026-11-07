// What a filing's steps say, in words: a row for each step the agent takes, and the two lines that end the first filing
// with its proof. Setup's window shows them, and so does the capsule's filing card, whose one line (`filingLine`) is the newest
// row, so the words are written once, here. A row is not Zel speaking: it never says "I".
import type { Shelf } from "@avanzel/ui";
import type { NarrationRow } from "../../shared/ipc.ts";

/** How many of the newest rows a window shows. */
export const SHOWN_ROWS = 6;

/** The first line of a filing's proof: the person's words are kept in raw/, whatever the agent did to their capture. */
export const KEPT_LINE = "Kept your exact words in raw/.";

/**
 * The second: the filing is its own commit, and git has not refused to take it back. The step goes on in the same line
 * with how to put everything back, ⌘Z or Undo, so a window says that once.
 */
export const SAVED_LINE = "Saved a snapshot.";

/** What a new page on each shelf is called: "New idea page: …". */
const NOUN: Record<Shelf, string> = {
  goals: "goal",
  ideas: "idea",
  problems: "problem",
  memories: "memory",
  people: "person",
  topics: "topic",
};

/**
 * A row in words, with no closing period. The library's own files, which sit at its root, are named for their job; any
 * other page is named by its title, which is its file name for a page that is gone (a removal) or a file that isn't a page.
 * A new page says what kind it is by the shelf it is on, and a new file that isn't a page says it is a file.
 */
export function rowLine(row: NarrationRow): string {
  switch (row.kind) {
    case "search":
      return "Searching your library";
    case "read":
      return readLine(row);
    case "new":
      return ownFileWritten(row) ?? newLine(row);
    case "updated":
      return ownFileWritten(row) ?? `Updated: ${row.title}`;
    case "removed":
      return `Removed: ${row.title}`;
  }
}

/**
 * A read: the library's index, log or rules by what they are for, a Markdown page in people/ as someone's, and any other
 * file by its title (a file in people/ that isn't Markdown is no one's page).
 */
function readLine({ path, title, shelf }: NarrationRow): string {
  switch (path) {
    case "index.md":
      return "Reading your library index";
    case "log.md":
      return "Reading the log";
    case "AGENTS.md":
      return "Reading the library's rules";
  }
  return shelf === "people" && path?.endsWith(".md") ? `Reading ${title}'s note` : `Reading ${title}`;
}

/** A write to the index or the log, new or updated alike, by what it did; null for any other file. */
function ownFileWritten({ path }: NarrationRow): string | null {
  if (path === "index.md") return "Updated your library index";
  if (path === "log.md") return "Added a line to the log";
  return null;
}

/**
 * A new page: of its shelf's kind on one of the six shelves ("New idea note: …"), only a note anywhere else. A file that
 * isn't Markdown is not a page, wherever it is: it is a file, named by its file name.
 */
function newLine({ path, title, shelf }: NarrationRow): string {
  if (!path?.endsWith(".md")) return `New file: ${title}`;
  // Own properties only, since a folder may be called anything, "constructor" included.
  return Object.hasOwn(NOUN, shelf) ? `New ${NOUN[shelf as Shelf]} note: ${title}` : `New note: ${title}`;
}

/** How long the agent may take no step before the capsule's filing card says it is still at work. */
export const STILL_WORKING_MS = 8_000;

/**
 * The capsule's filing card's one line of what is going on, in its footer: that the run waits for another (the library's, or the
 * app's own queue: `waiting`), which comes before anything else, since a run that has not begun has no steps and no quiet; else,
 * when the agent has taken no step for eight seconds (`stepAt` is its newest step of any kind, even one that adds no row, or the
 * run's start before the first), that it is still working; else its newest step (`rowLine`). Null before the first step. `now` is
 * Date.now(), which the card reads again as it counts its seconds.
 */
export function filingLine(filing: { agent: string; waiting?: boolean; rows: readonly NarrationRow[]; stepAt: number }, now: number): string | null {
  if (filing.waiting) return "Waiting for another Avanzel run to finish…";
  if (now - filing.stepAt >= STILL_WORKING_MS) return `${filing.agent} is still working…`;
  const newest = filing.rows.at(-1);
  return newest ? rowLine(newest) : null;
}
