// What a filing says the agent is doing: each step it takes (the engine's `FilingStep`) becomes a row, and a page it writes
// joins the list the shelf tabs count. `withStep` and `withWritten` are pure, so their tests reach them; the controller hands
// each of them every step, `withStep` with `rowPage` to name the pages. Setup sends the rows and the list to its window, and
// the capsule sends its card the rows; either at the pace `stepThrottle` keeps.
import { posix } from "node:path";
import type { FilingStep } from "@avanzel/engine";
import type { FiledPage, NarrationRow } from "../shared/ipc.ts";
import { pageInfo } from "./library-info.ts";

/** How many rows a filing keeps: the newest. */
export const MAX_ROWS = 50;

/**
 * At most how often the steps of a filing reach a window (`stepThrottle`): a burst of steps is a few updates rather than one
 * each, and the newest is never more than this far behind. Setup's window and the capsule's card are sent them at this pace.
 */
export const STEP_MS = 250;

/** The function a filing calls at each step it takes, to have its window sent them; `cancel` drops the send that waits. */
export interface StepThrottle {
  (): void;
  /** The send that waits, if one does, is dropped. The time of the last send is kept: a step right after it still waits. */
  cancel(): void;
}

/**
 * Spaces out the sends of a filing's steps: `send` runs at the first step at once, and then at most once every STEP_MS. A step
 * that comes sooner after the last send waits, and the steps that come meanwhile go in the one send that ends the wait, so the
 * window is never more than STEP_MS behind. `send` reads what the steps changed (the job's rows) when it runs, and is the one
 * to ask whether anything still shows them: a send that has waited may find the filing over. Narration is best effort: a
 * `send` that throws at the first step throws to the step's caller, who notes it, and one that throws once a wait has ended is
 * noted here, since no one is there to catch it, and never takes the app down.
 */
export function stepThrottle(send: () => void): StepThrottle {
  let sentAt = -Infinity;
  let timer: NodeJS.Timeout | null = null;
  const step = (): void => {
    if (timer) return; // its newest steps go in the send that waits
    const wait = sentAt + STEP_MS - performance.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        try {
          step();
        } catch (error) {
          console.warn("narration", error);
        }
      }, wait);
      return;
    }
    sentAt = performance.now();
    send();
  };
  return Object.assign(step, {
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  });
}

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

/**
 * Every Markdown path a filing has written so far, after one more step: a write adds its path, once however often it is
 * written, and a removal takes its path off. Any other step, and any file that isn't Markdown, changes nothing. The list
 * holds index.md, log.md and pages off the shelves too; the shelf tabs count only those on a shelf, which are the pages
 * `filedPages` will find there once the filing is filed. Unlike the rows, it is not cut to MAX_ROWS: a page written early
 * in a long filing must keep its count when its row has gone by. The list given is left as it was.
 */
export function withWritten(written: readonly string[], step: FilingStep): string[] {
  if (step.kind === "wrote" && step.path.endsWith(".md") && !written.includes(step.path)) return [...written, step.path];
  if (step.kind === "deleted") return written.filter((path) => path !== step.path);
  return [...written];
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
