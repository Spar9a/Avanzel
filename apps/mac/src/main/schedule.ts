// When things happen: which shadow tasks should run now (a task seen for the first time is only remembered, so a fresh
// install never fires yesterday's run; a run missed while the Mac slept happens once), when a note that a usage limit
// stopped is filed again, and when a thought saved for the evening review is filed, as the capsule tells it.

export interface SchedulableTask {
  id: string;
  schedule: string;
  enabled: boolean;
}

/** A weekly schedule's day as a schedule writes it ("sun"), by its name. */
const DAY_NAMES: Readonly<Record<string, string>> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

/**
 * What the capsule says of a thought saved for the evening review to file (Tonight, and every screen capture). While the
 * library's evening review is on, it names when that review runs, as Settings → General does: "at 21:00" for a daily one, and
 * by its day for a weekly one. `review` is that review, its schedule as main sends it ("daily 21:00", "weekly sun 18:00"); with
 * it off, or none (null), nothing files the thought by itself, and only where it is saved is said.
 */
export function savedNote(review: { schedule: string; enabled: boolean } | null): string {
  if (!review?.enabled) return "Saved to your inbox.";
  const daily = /^daily (\d\d:\d\d)$/.exec(review.schedule);
  if (daily) return `Saved to your inbox for the evening review at ${daily[1]}.`;
  const weekly = /^weekly (\w+) (\d\d:\d\d)$/.exec(review.schedule);
  const day = weekly ? DAY_NAMES[weekly[1] ?? ""] : undefined;
  return weekly && day ? `Saved to your inbox for the evening review, ${day}s at ${weekly[2]}.` : "Saved to your inbox for the evening review.";
}

export function dueTasks(
  tasks: SchedulableTask[],
  lastRuns: Record<string, string>,
  now: Date,
  lastDue: (schedule: string, now: Date) => Date,
): { due: string[]; baseline: string[] } {
  const due: string[] = [];
  const baseline: string[] = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    const last = lastRuns[task.id];
    if (!last) {
      baseline.push(task.id);
      continue;
    }
    if (new Date(last).getTime() < lastDue(task.schedule, now).getTime()) due.push(task.id);
  }
  return { due, baseline };
}

/** A note that a usage limit stopped, which is filed again once the limit has reset. */
export interface LimitWait {
  /** The note, as the path of its capture in the library's inbox. */
  capture: string;
  /** The agent that was stopped, by harness name ("claude"): the one that files the note again. */
  agent: string;
  /** When to file it, in epoch ms: the limit's reset, and a little after (`resetMarginMs`). */
  until: number;
}

/**
 * Per library (kept by `RunStateStore`): when each task was last checked for being due, and last ran, and the notes that
 * wait for a usage limit to reset.
 */
export interface RunState {
  checked: Record<string, string>;
  ran: Record<string, string>;
  waiting: LimitWait[];
}

const stringRecord = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

const isWait = (value: unknown): value is LimitWait => {
  if (typeof value !== "object" || value === null) return false;
  const { capture, agent, until } = value as Record<string, unknown>;
  return typeof capture === "string" && capture !== "" && typeof agent === "string" && agent !== "" && typeof until === "number" && Number.isFinite(until);
};

/** The good waits in `value`, each with only what a wait is; anything else in it is dropped. */
const waits = (value: unknown): LimitWait[] =>
  Array.isArray(value) ? value.filter(isWait).map(({ capture, agent, until }) => ({ capture, agent, until })) : [];

export function normalizeRunState(raw: unknown): RunState {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if ("checked" in r || "ran" in r || "waiting" in r) {
    return { checked: stringRecord(r.checked), ran: stringRecord(r.ran), waiting: waits(r.waiting) };
  }
  const legacy = stringRecord(r.lastRun);
  return { checked: { ...legacy }, ran: { ...legacy }, waiting: [] };
}

export function markChecked(state: RunState, ids: string[], now: Date): RunState {
  const checked = { ...state.checked };
  for (const id of ids) checked[id] = now.toISOString();
  return { checked, ran: { ...state.ran }, waiting: state.waiting.map((wait) => ({ ...wait })) };
}

export function markRan(state: RunState, id: string, now: Date): RunState {
  const at = now.toISOString();
  return { checked: { ...state.checked, [id]: at }, ran: { ...state.ran, [id]: at }, waiting: state.waiting.map((wait) => ({ ...wait })) };
}

/** `waiting` with `wait` in it, in place of any wait for the same note and agent. */
export function withWait(waiting: readonly LimitWait[], wait: LimitWait): LimitWait[] {
  return [...waiting.filter((each) => each.capture !== wait.capture || each.agent !== wait.agent), { ...wait }];
}

/** The waits whose time has come at `now` (epoch ms), a wait due at this very moment among them, and the others. */
export function splitWaits(waiting: readonly LimitWait[], now: number): { due: LimitWait[]; later: LimitWait[] } {
  return { due: waiting.filter((wait) => wait.until <= now), later: waiting.filter((wait) => wait.until > now) };
}

/** The longest delay a timer can have: one set beyond it fires at once (the engine's MAX_TIMER_MS, harness.ts). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** The delay of a timer for `until`: the time left, none when it has passed, and at most what a timer can hold (set again when it fires). */
export function timerDelay(until: number, now: number): number {
  return Math.min(Math.max(until - now, 0), MAX_TIMER_MS);
}

/**
 * A time in ms that a test sets in `name`, read only with AVANZEL_TEST=1; null when it isn't set, or isn't a time of at least
 * `least`.
 */
function testMs(env: NodeJS.ProcessEnv, name: string, least: number): number | null {
  const set = env.AVANZEL_TEST === "1" ? env[name]?.trim() : undefined;
  if (!set) return null;
  const ms = Number(set);
  return Number.isFinite(ms) && ms >= least ? ms : null;
}

/**
 * How long after a usage limit's reset its note is filed: a minute, so the agent has surely let the owner back in. With
 * AVANZEL_TEST=1, AVANZEL_RESET_MARGIN_MS sets it (0 too), for the tests.
 */
export function resetMarginMs(env: NodeJS.ProcessEnv = process.env): number {
  return testMs(env, "AVANZEL_RESET_MARGIN_MS", 0) ?? 60_000;
}

/** How often the watch of a missing sign-in looks: every 10 s. With AVANZEL_TEST=1, AVANZEL_SIGNIN_POLL_MS sets it, for the tests. */
export function signInPollMs(env: NodeJS.ProcessEnv = process.env): number {
  return testMs(env, "AVANZEL_SIGNIN_POLL_MS", 1) ?? 10_000;
}

/** How long that watch lasts: 30 min, after which the evening review has the note. With AVANZEL_TEST=1, AVANZEL_SIGNIN_WATCH_MS sets it, for the tests. */
export function signInWatchMs(env: NodeJS.ProcessEnv = process.env): number {
  return testMs(env, "AVANZEL_SIGNIN_WATCH_MS", 1) ?? 1_800_000;
}
