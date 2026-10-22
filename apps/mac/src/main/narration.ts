// What setup's first filing says the agent is doing: each step it takes (the engine's `FilingStep`) becomes a row of the
// Filing step. `withStep` is pure, so its tests reach it; the controller hands it each step, with `rowPage` to name the
// pages, and setup sends the rows to its window.
import { posix } from "node:path";
import type { FilingStep } from "@avanzel/engine";
import type { FiledPage, NarrationRow } from "../shared/ipc.ts";
import { pageInfo } from "./library-info.ts";

/** How many rows a filing keeps: the newest. */
export const MAX_ROWS = 50;

/** The first folder of a library path; "" for a file at the library's root. */
const shelfOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "");

/**
 * The rows after one more step, kept to the newest MAX_ROWS. A step adds a row unless it repeats one: a read, once the page
 * has a row of any kind; a write that creates a page, once it has a "new" row; a write that changes one, once it has a
 * "new" or an "updated" row; a removal, once it has a "removed" row; a search, when the newest row is a search. `page` gives
 * a page's title (`rowPage`); a removed page is gone, so it is named by its file name. The rows given are left as they
 * were.
 */
export function withStep(rows: readonly NarrationRow[], step: FilingStep, page: (rel: string) => FiledPage): NarrationRow[] {
  const added = rowFor(rows, step, page);
  return (added ? [...rows, added] : [...rows]).slice(-MAX_ROWS);
}

/** The row `step` adds to `rows`, or null when it adds none. */
function rowFor(rows: readonly NarrationRow[], step: FilingStep, page: (rel: string) => FiledPage): NarrationRow | null {
  if (step.kind === "search") return rows.at(-1)?.kind === "search" ? null : { kind: "search", path: null, title: "", shelf: "" };
  const had = rows.filter((row) => row.path === step.path).map((row) => row.kind);
  const row = (kind: NarrationRow["kind"]): NarrationRow => ({
    kind,
    path: step.path,
    title: kind === "removed" ? posix.basename(step.path, ".md") : page(step.path).title,
    shelf: shelfOf(step.path),
  });
  switch (step.kind) {
    case "read":
      return had.length ? null : row("read");
    case "wrote":
      if (step.created) return had.includes("new") ? null : row("new");
      return had.includes("new") || had.includes("updated") ? null : row("updated");
    case "deleted":
      return had.includes("removed") ? null : row("removed");
  }
}

/**
 * The page `withStep` is given for a row, in the library at `root`: `info` (pageInfo) tells a Markdown page's title, from
 * the file. Any other file, which a step may name too, is named by its file name, extension included, and is not opened:
 * a big file would hold up the main process, and a title found in what isn't a page would be a guess.
 */
export function rowPage(root: string, rel: string, info: (root: string, rel: string) => FiledPage = pageInfo): FiledPage {
  if (rel.endsWith(".md")) return info(root, rel);
  return { title: posix.basename(rel), shelf: shelfOf(rel), path: rel };
}
