// The words for what Make shelf did and what its Undo did, which the main process (a notification) and the capsule (its bar) share.

const pagesOf = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

/**
 * Make shelf made `name`'s shelf: `moved` pages went onto it, and `notMoved` stayed where they were, as a page of that name was in its
 * folder already. The capsule's `shelf-made` bar, and the notification when the capsule is busy.
 */
export function shelfMadeLine(name: string, moved: number, notMoved: number): string {
  const made = `Made the ${name} shelf and moved ${pagesOf(moved)}.`;
  if (notMoved === 0) return made;
  return notMoved === 1
    ? `${made} 1 page stayed where it was, as one with its name is already there.`
    : `${made} ${notMoved} pages stayed where they were, as ones with their names are already there.`;
}

/**
 * What is told once an Undo has taken back a Make shelf: the shelf is gone and its pages are where they were; `pendingAgain` when its
 * suggestion is waiting again, which Library asks about.
 */
export function shelfUndoneNote(name: string, pendingAgain: boolean): string {
  const gone = `The ${name} shelf is gone, and its pages are back where they were.`;
  return pendingAgain ? `${gone} Library asks about it again.` : gone;
}
