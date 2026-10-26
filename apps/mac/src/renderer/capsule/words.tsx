// The person's words, as a capsule card sets them on its paper.

/**
 * Their line breaks kept, and cut off after four lines of the card's ruling (`4lh` of the card's own line pitch), where the panel has
 * no more room (owner item 11: a fade is for `packages/ui`). A card that has more under the words, such as a filed card's pages
 * or a screen comment's screenshot, leaves room for two (`lines`). The words are cut here, not the whole card, so that its footer,
 * which holds what the agent is doing or what is safe, always shows. All the words are in the page, for a screen reader and for
 * selecting.
 */
export function Words({ children, lines = 4 }: { children: string; lines?: 2 | 4 }) {
  return <div className={lines === 2 ? "words short" : "words"}>{children}</div>;
}
