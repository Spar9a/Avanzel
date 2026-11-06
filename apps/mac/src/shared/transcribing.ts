// The capsule's words about a capture, from the recording to the filing: the file-mode button of a recording, turning a recording
// into text, and the seconds of a filing's card. The engine's own speech model runs on this Mac; the command in a library's
// [voice] settings can run anywhere, so for it the words don't say where. Main sends the capsule which it is (`onThisMac`), and the
// capsule says no more than that. The filing card's line of what the agent is doing is with the rows' words (`filingLine`, in
// renderer/common/narration.ts): nothing in shared/ imports from the renderer.
import type { CursorKey, FileMode } from "./ipc.ts";

/** The keys dictating into any app can listen to, in the order Settings' menu lists them, named as the keyboard names them. */
export const CURSOR_KEYS: readonly { key: CursorKey; name: string }[] = [
  { key: "right-option", name: "Right Option" },
  { key: "left-option", name: "Left Option" },
  { key: "right-command", name: "Right Command" },
  { key: "right-control", name: "Right Control" },
];

export const cursorKeyName = (key: CursorKey): string => CURSOR_KEYS.find((entry) => entry.key === key)?.name ?? "the key";

/**
 * The listening card of a dictation into another app: what it is doing, and how it ends, with the key the person chose (`key`, from the
 * setting). Esc gives it up.
 */
export function dictationListeningLine(key: CursorKey): string {
  return `Dictating into another app. Tap ${cursorKeyName(key)} again to finish, or press Esc.`;
}

/**
 * The file-mode button of a recording: what its words will do, in words that promise only what the app keeps. "Files now" when
 * they are filed at the stop. Saved for the evening review, they name when it files them (`review`, the review's words from
 * `reviewTime`: "at 21:00", "on Sundays at 18:00"): "Files at 21:00", "Files on Sundays at 18:00"; "Files at the evening review" for a
 * schedule that can't be read (""); and "Stays in the inbox" while the review is off (null), when nothing files them by itself.
 * It never says "tonight": a weekly review isn't tonight's.
 */
export function fileModeLabel(mode: FileMode, review: string | null): string {
  if (mode === "now") return "Files now";
  if (review === null) return "Stays in the inbox";
  return review === "" ? "Files at the evening review" : `Files ${review}`;
}

/**
 * The listening bar's file-mode switch: two choices beside the word "Filing", so it reads as a choice and not as a state. "Now"
 * is the agent filing the words as soon as the recording stops; the other is the evening review, worded from its time as
 * `reviewTime` gives it ("At 21:00", "On Sundays at 18:00"), "At the review" for a schedule that can't be read (""), and "Inbox"
 * while the review is off (null), when the words wait in the inbox for the person.
 */
export function fileModeChoices(review: string | null): { now: string; evening: string } {
  if (review === null) return { now: "Now", evening: "Inbox" };
  if (review === "") return { now: "Now", evening: "Review" };
  // As short as the bar can hold beside its buttons: "21:00" for a daily review, "Sundays 18:00" for a weekly one.
  const daily = /^at (\d{1,2}:\d{2})$/.exec(review);
  if (daily) return { now: "Now", evening: daily[1]! };
  const weekly = /^on (\w+) at (\d{1,2}:\d{2})$/.exec(review);
  if (weekly) return { now: "Now", evening: `${weekly[1]} ${weekly[2]}` };
  return { now: "Now", evening: review.charAt(0).toUpperCase() + review.slice(1) };
}

/** What the bar's Stop does, as its label says it and its badge shows it: file now, or keep for the review or the inbox. */
export function stopLabel(mode: FileMode | null, review: string | null): string {
  if (mode === "now") return "Stop, and your agent files it now";
  if (mode === "evening") return review === null ? "Stop, and keep it in the inbox" : `Stop, and file it at the evening review${review ? ` ${review}` : ""}`;
  return "Stop";
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

/** The bar's line while notes on a call are taken: it stays the same for the whole call, beside the call's time. */
export const CALL_LISTENING_LINE = "Taking notes on the call";

/** The capsule's bar when a thought, a screen comment or a question is asked for while notes on a call are taken. */
export const CALL_RUNNING_LINE = "Notes on the call are running. Stop them to record a thought.";

/** The capsule's bar when a dictation into any app is asked for while a thought records or notes on a call are taken. */
export const DICTATION_REFUSED_LINE = "Something else is recording. Try again when it stops.";
