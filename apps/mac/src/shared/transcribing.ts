// The capsule's words about a capture, from the recording to the filing: the file-mode button of a recording, turning a recording
// into text, and the seconds and the one line of a filing's card. The engine's own speech model runs on this Mac; the command in
// a library's [voice] settings can run anywhere, so for it the words don't say where. Main sends the capsule which it is
// (`onThisMac`), and the capsule says no more than that.
import { rowLine } from "../renderer/common/narration.ts";
import type { FileMode, NarrationRow } from "./ipc.ts";

/**
 * The file-mode button of a recording: what its words will do, in words that promise only what the app keeps. "Files now" when
 * they are filed at the stop. Saved for the evening review, they name when it files them (`review`, the review's words from
 * `reviewTime`: "at 21:00", "on Sundays at 18:00"): "Files at 21:00", "Files on Sundays at 18:00"; "Files at the review" for a
 * schedule that can't be read (""); and "Stays in your inbox" while the review is off (null), when nothing files them by itself.
 * It never says "tonight": a weekly review isn't tonight's.
 */
export function fileModeLabel(mode: FileMode, review: string | null): string {
  if (mode === "now") return "Files now";
  if (review === null) return "Stays in your inbox";
  return review === "" ? "Files at the review" : `Files ${review}`;
}

/** The capsule's line while the words are made. */
export function transcribingLine(onThisMac: boolean): string {
  return onThisMac ? "Transcribing on this Mac…" : "Transcribing…";
}

/** The foot of the capsule's filing card: how long the words took to make, in s (as macOS writes seconds) with one decimal. */
export function transcribedLine(seconds: number, onThisMac: boolean): string {
  return `Transcribed${onThisMac ? " on this Mac" : ""} in ${seconds.toFixed(1)} s`;
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

/** How long the agent may take no step before the card says it is still at work. */
export const STILL_WORKING_MS = 8_000;

/**
 * The filing card's one line of what is going on, in its footer: that the run waits for another (the library's, or the app's own
 * queue: `waiting`), which comes before anything else, since a run that has not begun has no steps and no quiet; else, when the
 * agent has taken no step for eight seconds (`stepAt` is its newest step of any kind, even one that adds no row, or the run's
 * start before the first), that it is still working; else its newest step (`rowLine`). Null before the first step. `now` is
 * Date.now(), which the card reads again as it counts its seconds.
 */
export function filingLine(filing: { agent: string; waiting?: boolean; rows: readonly NarrationRow[]; stepAt: number }, now: number): string | null {
  if (filing.waiting) return "Waiting for another Avanzel run to finish…";
  if (now - filing.stepAt >= STILL_WORKING_MS) return `${filing.agent} is still working…`;
  const newest = filing.rows.at(-1);
  return newest ? rowLine(newest) : null;
}
