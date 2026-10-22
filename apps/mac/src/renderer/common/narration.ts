// What a filing's steps say, in words: a row for each step the agent takes, the count of pages they wrote for each shelf's
// tab, and the two lines that end the first filing with its proof. Setup's window shows them, and the capsule will (1c), so
// the words are written once, here. A row is not Zel speaking: it never says "I".
import type { Shelf } from "@avanzel/ui";
import type { NarrationRow } from "../../shared/ipc.ts";

/** How many of the newest rows a window shows. */
export const SHOWN_ROWS = 6;

/** The first line of a filing's proof: the person's words are kept in raw/, whatever the agent did to their capture. */
export const KEPT_LINE = "Kept your exact words in raw/.";

/** The second: the filing is its own commit, and git has not refused to take it back. */
export const SAVED_LINE = "Saved a snapshot you can undo.";

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
 * A new page says what kind it is by the shelf it is on.
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

/** A read: the library's index, log or rules by what they are for, a page of someone as theirs, any other by its title. */
function readLine({ path, title, shelf }: NarrationRow): string {
  switch (path) {
    case "index.md":
      return "Reading your library index";
    case "log.md":
      return "Reading the log";
    case "AGENTS.md":
      return "Reading the library's rules";
  }
  return shelf === "people" ? `Reading ${title}'s page` : `Reading ${title}`;
}

/** A write to the index or the log, new or updated alike, by what it did; null for any other file. */
function ownFileWritten({ path }: NarrationRow): string | null {
  if (path === "index.md") return "Updated your library index";
  if (path === "log.md") return "Added a line to the log";
  return null;
}

/** A new page: of its shelf's kind on one of the six shelves ("New idea page: …"), only a page anywhere else. */
function newLine({ title, shelf }: NarrationRow): string {
  // Own properties only, since a folder may be called anything, "constructor" included.
  return Object.hasOwn(NOUN, shelf) ? `New ${NOUN[shelf as Shelf]} page: ${title}` : `New page: ${title}`;
}

/**
 * How many pages the rows say were written on `shelf` so far, for its tab: the distinct paths of its "new" and "updated"
 * rows. Only Markdown counts, as it does for the pages a filed filing lists (`filedPages`), so the count a tab shows while
 * the filing works is the count it shows once it is filed. A page that was only read counts for nothing.
 */
export function pagesWritten(rows: readonly NarrationRow[], shelf: string): number {
  const written = new Set<string>();
  for (const row of rows) {
    if ((row.kind === "new" || row.kind === "updated") && row.shelf === shelf && row.path?.endsWith(".md")) written.add(row.path);
  }
  return written.size;
}
