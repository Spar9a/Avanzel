// The words for what Make shelf did and what its Undo did, which the main process (a notification) and the capsule (its bar) share.

const pagesOf = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

/**
 * Make shelf made `name`'s shelf and `moved` pages went onto it: the capsule's `shelf-made` bar, which is one line, so it says no more.
 */
export function shelfMadeLine(name: string, moved: number): string {
  return `Made the ${name} shelf and moved ${moved === 0 ? "no pages" : pagesOf(moved)}.`;
}

/** `notMoved` pages stayed where they were, as a page of that name was in the shelf's folder already. */
function stayedLine(notMoved: number): string {
  return notMoved === 1
    ? "1 page stayed where it was, as a page with its name is already there."
    : `${notMoved} pages stayed where they were, as pages with their names are already there.`;
}

/**
 * The notifications once Make shelf made `name`'s shelf, beside the bar (`onBar`) or in its place, when the capsule is busy. Beside the
 * bar: none when every page moved, else one that says which stayed, which the bar has no room for. In its place: one that says it all.
 */
export function shelfMadeNotes(name: string, moved: number, notMoved: number, onBar: boolean): { title: string; body: string }[] {
  if (onBar) return notMoved === 0 ? [] : [{ title: `The ${name} shelf is made`, body: stayedLine(notMoved) }];
  const made = shelfMadeLine(name, moved);
  return [{ title: "Shelf made", body: notMoved === 0 ? made : `${made} ${stayedLine(notMoved)}` }];
}

/**
 * What is told once an Undo has taken back a Make shelf: the shelf is gone and its pages are where they were; `pendingAgain` when its
 * suggestion is waiting again, which Library asks about.
 */
export function shelfUndoneNote(name: string, pendingAgain: boolean): string {
  const gone = `The ${name} shelf is gone, and its pages are back where they were.`;
  return pendingAgain ? `${gone} Library asks about it again.` : gone;
}
