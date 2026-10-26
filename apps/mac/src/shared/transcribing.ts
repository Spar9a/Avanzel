// The capsule's words about turning a recording into text, and the seconds on the card of a filing. The engine's own speech model
// runs on this Mac; the command in a library's [voice] settings can run anywhere, so for it the words don't say where. Main sends
// the capsule which it is (`onThisMac`), and the capsule says no more than that.

/** The capsule's line while the words are made. */
export function transcribingLine(onThisMac: boolean): string {
  return onThisMac ? "Transcribing on this Mac…" : "Transcribing…";
}

/** The foot of the capsule's filing card: how long the words took to make, in seconds with one decimal. */
export function transcribedLine(seconds: number, onThisMac: boolean): string {
  return `Transcribed${onThisMac ? " on this Mac" : ""} in ${seconds.toFixed(1)} seconds`;
}

/**
 * The seconds a filing has taken, on the header of its card: whole seconds, rounded down, and "of about {estimate}" until they
 * reach the estimate ("6 s of about 15"), then just the seconds ("18 s"). Seconds that have reached the estimate are past it, so
 * an estimate of 0, which an agent that files in no time earns, never reads "0 s of about 0". Setup's working line has its own
 * estimate, a fixed 15 (`workingLine`).
 */
export function filingMeta(seconds: number, estimate: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return whole < estimate ? `${whole} s of about ${estimate}` : `${whole} s`;
}
