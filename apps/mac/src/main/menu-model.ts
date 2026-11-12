// What the menu bar's panel is worked out from (`MenuInput`, which `Controller.panelSnapshot` reads), and the words it says of the day,
// the evening review and the speech model.
import type { ModelStatus, Shortcuts } from "../shared/ipc.ts";
import { downloadFailedProblem, TYPED_THOUGHTS_SAVED, TYPING_WORKS_MEANWHILE, voiceSettingsProblem } from "../shared/problems.ts";

export interface MenuTask {
  id: string;
  name: string;
  /** The kind of review the task file says it is: "evening-review", "review" or "custom". The status line names the evening review. */
  kind: string;
  at: Date | null;
  enabled: boolean;
  running: boolean;
  /**
   * How far the review is while it runs, "Filing 2 of 5" (`reviewProgress`): the panel shows it under the review in place of "Running…".
   * The evening review counts its captures (`Controller.countReview`); a review that has begun none, or doesn't count, has none, and
   * says "Running…".
   */
  progress?: string;
}

export interface MenuInput {
  libraryReady: boolean;
  /** Why the library couldn't be opened, if that is why it isn't ready. */
  problem?: string | null;
  /** The remembered library's place as the person knows it ("~/Avanzel"), if that is why it isn't ready: it isn't there any more. */
  missingLibrary?: string | null;
  inbox: number;
  /** How many thoughts the library's log says were filed today (`filedToday`): the head counts them. */
  filedToday: number;
  tasks: MenuTask[];
  /**
   * The capsule's own title for why the speech model can't be used (`speechProblemOf`), or null when nothing is wrong with it. The panel
   * names it under its headline, with Open voice settings, where the fix is.
   */
  speechProblem: string | null;
  /** The second line under `speechProblem`: what is safe meanwhile and where the fix is (`speechProblemOf`). Nothing without a problem. */
  speechSublabel?: string;
  recording: boolean;
  /**
   * Notes on a call: "ready" offers "Take notes on a call…", "running" offers "Stop taking notes", and "off" offers neither: the Mac
   * can't tap a call, no library is open, or a call is starting or being finished (`Controller.menuInput`).
   */
  callNotes: "off" | "ready" | "running";
  /**
   * How many calls cut short (by a quit, a crash, or a microphone, helper or disk that failed) wait to be finished, while one can be
   * now (no call starts, runs or is being finished, no thought records); 0 otherwise. Over 0, the panel offers "Finish notes for a call
   * that was cut short", which finishes the oldest.
   */
  cutShortCalls: number;
  shortcuts: Shortcuts;
  /**
   * The actions whose shortcut didn't register: another app holds it, an earlier action has it, or macOS doesn't
   * understand it. Pressing it does nothing for them, so the panel doesn't show it beside them.
   */
  unregisteredShortcuts: readonly (keyof Shortcuts)[];
  undoableReview: boolean;
  /**
   * The last filing can be taken back from here (`Controller.undoableFiling`): a capsule or background filing ended well with a commit,
   * no run has begun since, and no filing or review waits or runs. The panel then offers "Undo the last filing".
   */
  undoableFiling: boolean;
  /**
   * "Show the last receipt" can be chosen now (`Controller.receiptShowable`): the open library has a receipt, and nothing is recording,
   * filing or reviewing, Avanzel isn't quitting, the library's saved Undo is checked, and the capsule shows nothing or a finished card (not
   * a problem's notice, the editor or a capture, which it would do nothing over). The panel then offers it, beside "Undo the last filing".
   */
  showableReceipt: boolean;
  /** The history of dictations at the cursor has one: the panel offers "Forget the last dictation", which takes the newest out of it. */
  forgettableDictation: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);

/** "21:00" today, "Tomorrow 09:05" or "Yesterday 23:59", "Sun 18:00" within the coming week, else "2 Nov 18:00". */
export function formatWhen(at: Date, now: Date): string {
  const days = daysBetween(now, at);
  if (days === 0) return hhmm(at);
  if (days === 1) return `Tomorrow ${hhmm(at)}`;
  if (days === -1) return `Yesterday ${hhmm(at)}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[at.getDay()]} ${hhmm(at)}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${hhmm(at)}`;
}

function nextPhrase(at: Date, now: Date): string {
  const days = daysBetween(now, at);
  if (days === 0) return `at ${hhmm(at)}`;
  if (days === 1) return `tomorrow at ${hhmm(at)}`;
  return `on ${formatWhen(at, now).replace(/ (\d\d:\d\d)$/, " at $1")}`;
}

/** How today went, for the panel's headline: "Nothing filed today", "1 thought filed today" or "3 thoughts filed today". */
export function filedLine(filedToday: number): string {
  if (filedToday <= 0) return "Nothing filed today";
  return filedToday === 1 ? "1 thought filed today" : `${filedToday} thoughts filed today`;
}

/**
 * What waits: in the inbox, and when an evening review is on, its own name and its next time ("2 in the inbox · Evening
 * review at 21:00", "Evening review tomorrow at 21:00"); none with neither. `evening` is the soonest evening review that is on and has a time
 * to say. It is a review, not a letter: no letter is built yet.
 */
export function waitingLine(inbox: number, evening: MenuTask | undefined, now: Date): string | undefined {
  const parts = [...(inbox > 0 ? [`${inbox} in the inbox`] : []), ...(evening?.at ? [`${evening.name} ${nextPhrase(evening.at, now)}`] : [])];
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * How far an evening review is, for `MenuTask.progress`: "Filing 2 of 5", capitalised like the other details ("Running…", "Off"). The
 * total never falls short of the count, since a capture that arrives meanwhile is filed too: the panel never reads "Filing 3 of 2".
 */
export function reviewProgress(done: number, total: number): string {
  return `Filing ${done} of ${Math.max(total, done)}`;
}

/**
 * What is wrong with the speech model, for the panel to name: the capsule's own title for it, and a second line under it that says what
 * is safe meanwhile and where the fix is, as the capsule's card and Settings → Voice do (the title and the safe sentence are the
 * builders' own, in shared/problems.ts). A download that failed is tried again in Settings → Voice, which tells whether it continues
 * where it stopped or starts over: the panel leaves that there. Voice settings Avanzel can't use have no Try again: they are fixed in
 * the config file. Null while the model is ready, on its way or still to be fetched: none of those is a problem.
 */
export function speechProblemOf(model: ModelStatus): { title: string; sublabel: string } | null {
  if (model.kind !== "error") return null;
  if (model.cause === "settings") {
    return { title: voiceSettingsProblem(model.message).title, sublabel: `${TYPED_THOUGHTS_SAVED} Fix the config file.` };
  }
  return { title: downloadFailedProblem(model.message, model.resumable).title, sublabel: `${TYPING_WORKS_MEANWHILE}. Try again in Settings → Voice.` };
}
