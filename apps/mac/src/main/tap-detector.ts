// Tells a tap of the chosen modifier key from the same key used in a shortcut. The helper (apps/mac/native/cursor) reports each
// press and release of the key, and a `key` event for any other key-down or click; a tap is a press and release with none of those
// between, so Right Option held with another key (to type a symbol) never starts a dictation.

export type CursorKey = "right-option" | "left-option" | "right-command" | "right-control";

export type KeyEvent = { event: "modifier"; down: boolean } | { event: "key" };

export class TapDetector {
  private held = false;
  /** Something else was pressed or clicked while the key was held. */
  private broken = false;

  /** True exactly when this event completes a tap: the key was pressed and is now released, with nothing else pressed between. */
  push(event: KeyEvent): boolean {
    if (event.event === "key") {
      if (this.held) this.broken = true;
      return false;
    }
    if (event.down) {
      // A repeated press (the helper can say it twice) is the same press, so it does not clear a break.
      if (!this.held) {
        this.held = true;
        this.broken = false;
      }
      return false;
    }
    if (!this.held) return false; // a release with no press, or the second of two
    this.held = false;
    return !this.broken;
  }
}
