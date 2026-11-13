// The words for what Make shelf did and what its Undo did, which the main process (a notification) and the capsule (its bar) share.

const pagesOf = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

/**
 * Make shelf made `name`'s shelf and `moved` pages went onto it: the capsule's `shelf-made` bar, which is one line, so it says no more.
 */
export function shelfMadeLine(name: string, moved: number): string {
  return `Made the ${name} shelf and moved ${moved === 0 ? "no pages" : pagesOf(moved)}.`;
}

/** Why Make shelf left a page where it was: a page of its name is in the shelf's folder (`taken`), or it isn't where it was filed (`missing`). */
export type NotMovedReason = "taken" | "missing";

/** `n` pages stayed where they were, as a page of that name was in the shelf's folder already. */
function takenLine(n: number): string {
  return n === 1
    ? "1 page stayed where it was, as a page with its name is already there."
    : `${n} pages stayed where they were, as pages with their names are already there.`;
}

/** `n` pages weren't moved, as they are no longer where they were filed (gone, moved or renamed since). */
function missingLine(n: number): string {
  return n === 1 ? "1 page wasn't moved, as it's no longer where it was filed." : `${n} pages weren't moved, as they're no longer where they were filed.`;
}

/** What is said of the pages that didn't move, each reason in its own sentence: "" when every page moved. */
function stayedLines(notMoved: readonly { reason: NotMovedReason }[]): string {
  const taken = notMoved.filter((page) => page.reason === "taken").length;
  const missing = notMoved.length - taken;
  return [taken > 0 ? takenLine(taken) : "", missing > 0 ? missingLine(missing) : ""].filter(Boolean).join(" ");
}

/**
 * The notifications once Make shelf made `name`'s shelf, beside the bar (`onBar`) or in its place, when the capsule is busy. Beside the
 * bar: none when every page moved, else one that says which stayed and why, which the bar has no room for. In its place: one that says it all.
 */
export function shelfMadeNotes(
  name: string,
  moved: number,
  notMoved: readonly { reason: NotMovedReason }[],
  onBar: boolean,
): { title: string; body: string }[] {
  const stayed = stayedLines(notMoved);
  if (onBar) return stayed === "" ? [] : [{ title: `The ${name} shelf is made`, body: stayed }];
  const made = shelfMadeLine(name, moved);
  return [{ title: "Shelf made", body: stayed === "" ? made : `${made} ${stayed}` }];
}

/**
 * What is told once an Undo has taken back a Make shelf: the shelf is gone and its pages are where they were; `pendingAgain` when its
 * suggestion is waiting again, which Library asks about.
 */
export function shelfUndoneNote(name: string, pendingAgain: boolean): string {
  const gone = `The ${name} shelf is gone, and its pages are back where they were.`;
  return pendingAgain ? `${gone} Library asks about it again.` : gone;
}
