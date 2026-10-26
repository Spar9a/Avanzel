// The person's words, as a capsule card sets them on its paper.

/**
 * Their line breaks kept, and cut off after four lines of the card's ruling (`4lh` of the card's own line pitch), where the panel has
 * no more room (owner item 11: a fade is for `packages/ui`). The words are cut here, not the whole card, so that its footer, which
 * holds what the agent is doing, always shows. All the words are in the page, for a screen reader and for selecting.
 */
export function Words({ children }: { children: string }) {
  return <div className="words">{children}</div>;
}
