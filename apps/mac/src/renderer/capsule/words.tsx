// The person's words, as a capsule card sets them on its paper.

/**
 * Their line breaks kept, and cut off after four lines of the card's ruling (`4lh` of the card's own line pitch), where the panel has
 * no more room (owner item 11: a fade is for `packages/ui`). A card that has more under the words, such as a filed card's pages
 * or a screen comment's screenshot, leaves room for three (`lines`). It is three and not two because a stamp stands where the first
 * line would run on, and the line wraps around it: words that fill two lines on the card that has no stamp (the filing card) fill
 * three on the card that has, and a limit of two ended them in the middle of a word as the stamp landed. A card that has still more
 * under them, a screen comment's screenshot and the line about its recording, which may take two lines of its own, leaves two: the
 * panel has no room for a third beside them. The words are cut here, not the whole card, so that its footer, which holds what the agent
 * is doing or what is safe, always shows. All the words are in the page, for a screen reader and, where the card takes the pointer, for
 * selecting. `latest`: words still being said, of which it is the oldest that are cut off, so that the newest stay in view.
 */
export function Words({ children, lines = 4, latest = false }: { children: string; lines?: 2 | 3 | 4; latest?: boolean }) {
  if (latest) {
    return (
      <div className="words latest">
        <div>{children}</div>
      </div>
    );
  }
  return <div className={lines === 4 ? "words" : `words lines-${lines}`}>{children}</div>;
}
