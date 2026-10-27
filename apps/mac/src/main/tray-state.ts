// What the menu bar icon shows of what Avanzel is doing: Zel's face and the title beside it. The controller reads its own state into
// a `TrayInput` and `trayView` decides what shows, so every rule of precedence lives here, apart from Electron, where it can be tested.
// Plain TypeScript with only a type from the design system: main may take no value from the package's root.
import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { clock } from "../shared/clock.ts";

/**
 * The count of `ms`, "0:07", "1:05" or "12:03": whole seconds, rounded down, and never negative. It is the capsule's own clock
 * (shared/clock.ts), so that the card and the menu bar count the same way.
 */
export const elapsed = clock;

/** How the controller's state reads to the menu bar. A time is Date.now() in ms; null is "not going on". */
export interface TrayInput {
  /** Setup's window or Zel's bubble under the icon shows: the title would widen the icon's bounds, which they centre on. */
  setupOpen: boolean;
  /** Something needs the person: a card of a problem, a library that won't open or isn't there, or a speech model that can't be had. */
  problem: boolean;
  /** When the recording that listens began. */
  recordingSince: number | null;
  /** An agent runs or waits for its turn, or speech is made into words: Zel is thinking. */
  busy: boolean;
  /** When the run of a filing whose card is hidden began; null while the card shows, and while the filing waits for its turn. */
  hiddenFilingSince: number | null;
  /** How many whole percent of the speech models have arrived, while they download. */
  downloadPercent: number | null;
  /** When the stamp of a filing that ended well wears off. */
  filedUntil: number | null;
  /** An evening review has finished for the night, and nothing has been captured since. */
  asleep: boolean;
}

export interface TrayView {
  face: MenuBarState;
  title: string;
}

/**
 * The words of each face, for the icon's tooltip. Electron's Tray has no accessibility label, so the tooltip is all the text a hover or
 * VoiceOver gets of the icon: the states carry words, not just a face (DESIGN.md, Accessibility). The filing face needs them most, since
 * at 18 pt it reads like idle. The words hold on every path to a face: the busy face is a filing, but also an Ask, a transcription for a
 * screen comment or for the evening review, and the weekly review, so it says "working"; the stamp follows a saved card too (a screen
 * comment, words kept for the review), where Filed is "saved and undoable" (spec §4.2), so it says "saved".
 */
const TOOLTIPS: Record<MenuBarState, string> = {
  idle: "Avanzel",
  listening: "Avanzel is recording",
  filing: "Avanzel is working",
  filed: "Avanzel saved it",
  "needs-you": "Avanzel needs you",
  asleep: "The evening review is done",
};

/** The tooltip for `face`: what the icon says in words while it shows that face. */
export function trayTooltip(face: MenuBarState): string {
  return TOOLTIPS[face];
}

/** What the title counts: a recording, else a hidden filing's run; null when neither does. */
function countingSince(input: TrayInput): number | null {
  return input.recordingSince ?? input.hiddenFilingSince;
}

/** What shows at `now`. For the face and for the title, the first rule that holds wins. */
export function trayView(input: TrayInput, now: number): TrayView {
  let face: MenuBarState = "idle";
  if (input.problem) face = "needs-you";
  else if (input.recordingSince !== null) face = "listening";
  else if (input.busy) face = "filing";
  else if (input.filedUntil !== null && input.filedUntil > now) face = "filed";
  else if (input.asleep) face = "asleep";

  let title = "";
  const since = countingSince(input);
  if (input.setupOpen) title = "";
  else if (since !== null) title = elapsed(now - since);
  else if (input.downloadPercent !== null) title = `${input.downloadPercent}%`;

  return { face, title };
}

/**
 * How many ms from `now` until the view changes by itself, which is when it must be shown again: the next whole second of a count
 * the title shows, and the end of a filed stamp, whichever is sooner. Null when nothing is counting down, so no timer is needed.
 * Everything else that changes the view comes with a change of the controller's state, which shows it then.
 */
export function nextTrayWake(input: TrayInput, now: number): number | null {
  const waits: number[] = [];
  const since = countingSince(input);
  if (since !== null && !input.setupOpen) waits.push(1000 - (Math.max(0, now - since) % 1000));
  if (input.filedUntil !== null && input.filedUntil > now) waits.push(input.filedUntil - now);
  const real = waits.filter((wait) => Number.isFinite(wait)); // a time that isn't one must not become a timer that fires at once, for ever
  return real.length ? Math.min(...real) : null;
}

/** Whether Zel sleeps after an evening review that finished at `at`, local time: from 18:00 to 05:59. */
export function sleepsAfterReview(at: Date): boolean {
  const hour = at.getHours();
  return hour >= 18 || hour < 6;
}

/**
 * When an evening review that has just finished ended, for `sleepsAfterReview`: `now`. With AVANZEL_TEST=1 in `env`, its
 * AVANZEL_FAKE_HOUR (0 to 23) stands in for the hour, as AVANZEL_FAKE_TRAY_BOUNDS stands in for the icon's place, so no test
 * depends on when it runs. Anything else it holds is no hour, and is ignored.
 */
export function reviewEndedAt(env: Record<string, string | undefined>, now: Date = new Date()): Date {
  const at = new Date(now);
  const fake = env.AVANZEL_TEST === "1" ? env.AVANZEL_FAKE_HOUR : undefined;
  if (fake !== undefined && /^\d{1,2}$/.test(fake) && Number(fake) < 24) at.setHours(Number(fake), 0, 0, 0);
  return at;
}

/** How many whole percent of `total` bytes `received` is, from 0 to 100; null while the total isn't known. */
export function wholePercent(received: number, total: number): number | null {
  if (!(total > 0)) return null;
  const percent = Math.floor((received * 100) / total); // times 100 first: 0.29 * 100 is 28.999999999999996
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
}
