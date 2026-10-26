// When things happen: which shadow tasks should run now (a task seen for the first time is only remembered, so a fresh
// install never fires yesterday's run; a run missed while the Mac slept happens once), when a note that a usage limit
// stopped is filed again, and when a thought saved for the evening review, or a note that Stop left in the inbox, is filed, as
// the capsule tells it. And how long a filing takes, as the last ones of each agent tell it: the estimate the filing card shows.

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
 * When a review runs, read from its schedule as main sends it ("daily 21:00", "weekly sun 18:00"): its time, and for a weekly
 * review the name of its day ("Sunday"; null for a daily one). Null for a schedule it can't read, and for a weekly one whose day
 * isn't a day's short name (`DAY_NAMES`' own keys: "constructor" is no day).
 */
function readSchedule(schedule: string): { time: string; day: string | null } | null {
  const daily = /^daily (\d\d:\d\d)$/.exec(schedule);
  if (daily) return { time: daily[1] ?? "", day: null };
  const weekly = /^weekly (\w+) (\d\d:\d\d)$/.exec(schedule);
  const key = weekly?.[1] ?? "";
  return weekly && Object.hasOwn(DAY_NAMES, key) ? { time: weekly[2] ?? "", day: DAY_NAMES[key] ?? null } : null;
}

/**
 * What the capsule says of a thought saved for the evening review to file (Tonight, and every screen capture). While the
 * library's evening review is on, it names when that review runs, as Settings → General does: "at 21:00" for a daily one, and
 * by its day for a weekly one. `review` is that review, its schedule as main sends it ("daily 21:00", "weekly sun 18:00"); with
 * it off, or none (null), nothing files the thought by itself, and only where it is saved is said.
 */
export function savedNote(review: { schedule: string; enabled: boolean } | null): string {
  if (!review?.enabled) return "Saved to your inbox.";
  const when = readSchedule(review.schedule);
  if (!when) return "Saved to your inbox for the evening review.";
  return when.day
    ? `Saved to your inbox for the evening review, ${when.day}s at ${when.time}.`
    : `Saved to your inbox for the evening review at ${when.time}.`;
}

/**
 * When the evening review files a note that Stop left in the inbox, worded to follow "files it" (the capsule's Stopped card): "at
 * 21:00" for a daily review, "on Sundays at 18:00" for a weekly one, read from its schedule as `savedNote` reads it. "" for a
 * schedule it can't read, so that the sentence names no time. Null while the review is off, or the library has none: nothing
 * files the note by itself then, and the sentence that names the review is left out. It never says "tonight": a weekly review
 * isn't tonight's.
 */
export function reviewTime(review: { schedule: string; enabled: boolean } | null): string | null {
  if (!review?.enabled) return null;
  const when = readSchedule(review.schedule);
  if (!when) return "";
  return when.day ? `on ${when.day}s at ${when.time}` : `at ${when.time}`;
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

/** How many filing durations the run state keeps for each agent: the newest. */
export const MAX_DURATIONS = 10;

/** About how long a filing takes, in seconds, until its agent has done enough of them to tell (`MIN_DURATIONS`). */
export const DEFAULT_ESTIMATE_SECONDS = 15;

/** How many filings an agent must have done before what they took gives the estimate. */
const MIN_DURATIONS = 3;

/**
 * Per library (kept by `RunStateStore`): when each task was last checked for being due, and last ran, the notes that wait for
 * a usage limit to reset, and how long the agents' last filings took. Whatever writes a state back whole carries every one of
 * these (`markChecked`, `markRan`): a field it leaves out is lost the next time `tick()` writes the state.
 */
export interface RunState {
  checked: Record<string, string>;
  ran: Record<string, string>;
  waiting: LimitWait[];
  /**
   * The last `MAX_DURATIONS` filings' seconds of each agent, oldest first, by the harness that ran ("claude", never "auto").
   * A filing's seconds start when its run has the library, so the wait for it isn't in them. `estimateSeconds` makes the
   * estimate of them.
   */
  durations: Record<string, number[]>;
}

const stringRecord = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

/** Whether `value` can be the seconds a filing took: a number that is none of negative, infinite or not a number. */
const isDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The durations in `value`, as a state keeps them: for each agent the good ones of its list, the last `MAX_DURATIONS`. A
 * list with none left, and anything that isn't a list or a record, is dropped.
 */
const durationLists = (value: unknown): Record<string, number[]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([harness, list]): [string, number[]][] => {
      const kept = Array.isArray(list) ? list.filter(isDuration).slice(-MAX_DURATIONS) : [];
      return kept.length ? [[harness, kept]] : [];
    }),
  );
};

/** `durations` as a copy no other holds, so that what a state hands on is not the state it was made from. */
const copyDurations = (durations: Record<string, number[]>): Record<string, number[]> =>
  Object.fromEntries(Object.entries(durations).map(([harness, list]) => [harness, [...list]]));

/** `harness`'s durations, none when it has none: only its own, never a property that every object has (an agent called "constructor"). */
export function durationsOf(durations: Record<string, number[]>, harness: string): number[] {
  return Object.hasOwn(durations, harness) ? (durations[harness] ?? []) : [];
}

/**
 * `durations` with a filing's `seconds` after those of `harness`, the agent that ran it (never "auto"), keeping its last
 * `MAX_DURATIONS`. Seconds that can't be a duration (a negative number, or one that isn't finite) are not added. The
 * durations given are left as they were.
 */
export function withDuration(durations: Record<string, number[]>, harness: string, seconds: number): Record<string, number[]> {
  const copy = copyDurations(durations);
  if (!isDuration(seconds)) return copy;
  return { ...copy, [harness]: [...durationsOf(durations, harness), seconds].slice(-MAX_DURATIONS) };
}

/**
 * About how long a filing takes with an agent, whole seconds, from what its last filings took: their median, the mean of
 * the middle two when there is an even number of them. `DEFAULT_ESTIMATE_SECONDS` until it has done three, which are too few
 * to tell. A median, so that one filing that took far longer than the rest (a Mac that slept) doesn't move it.
 */
export function estimateSeconds(durations: readonly number[]): number {
  if (durations.length < MIN_DURATIONS) return DEFAULT_ESTIMATE_SECONDS;
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return Math.round(median);
}

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
  // Any field of the current format makes it the current format: a state of durations alone is not the legacy one.
  if ("checked" in r || "ran" in r || "waiting" in r || "durations" in r) {
    return { checked: stringRecord(r.checked), ran: stringRecord(r.ran), waiting: waits(r.waiting), durations: durationLists(r.durations) };
  }
  const legacy = stringRecord(r.lastRun);
  return { checked: { ...legacy }, ran: { ...legacy }, waiting: [], durations: {} };
}

export function markChecked(state: RunState, ids: string[], now: Date): RunState {
  const checked = { ...state.checked };
  for (const id of ids) checked[id] = now.toISOString();
  return { ...state, checked, ran: { ...state.ran }, waiting: state.waiting.map((wait) => ({ ...wait })), durations: copyDurations(state.durations) };
}

export function markRan(state: RunState, id: string, now: Date): RunState {
  const at = now.toISOString();
  return {
    ...state,
    checked: { ...state.checked, [id]: at },
    ran: { ...state.ran, [id]: at },
    waiting: state.waiting.map((wait) => ({ ...wait })),
    durations: copyDurations(state.durations),
  };
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
