// The capsule's words about turning a recording into text. The engine's own speech model runs on this Mac; the command in a
// library's [voice] settings can run anywhere, so for it the words don't say where. Main sends the capsule which it is
// (`onThisMac`), and the capsule says no more than that.

/** The capsule's line while the words are made. */
export function transcribingLine(onThisMac: boolean): string {
  return onThisMac ? "Transcribing on this Mac…" : "Transcribing…";
}

/** The foot of the capsule's filing card: how long the words took to make, in seconds with one decimal. */
export function transcribedLine(seconds: number, onThisMac: boolean): string {
  return `Transcribed${onThisMac ? " on this Mac" : ""} in ${seconds.toFixed(1)} seconds`;
}
