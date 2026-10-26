import { describe, expect, it } from "vitest";
import {
  MAX_TIMER_MS,
  dueTasks,
  markChecked,
  markRan,
  normalizeRunState,
  resetMarginMs,
  savedNote,
  signInPollMs,
  signInWatchMs,
  splitWaits,
  timerDelay,
  withWait,
  type LimitWait,
  type RunState,
} from "../src/main/schedule.ts";

// Daily at 21:00, local time.
const lastDue = (_schedule: string, now: Date) => {
  const due = new Date(now);
  due.setHours(21, 0, 0, 0);
  if (due > now) due.setDate(due.getDate() - 1);
  return due;
};
const task = { id: "evening-review", schedule: "daily 21:00", enabled: true };

describe("shadow task scheduling", () => {
  it("does not run a task the first time it is seen, only remembers it", () => {
    const now = new Date(2026, 9, 20, 23, 0);
    expect(dueTasks([task], {}, now, lastDue)).toEqual({ due: [], baseline: ["evening-review"] });
  });

  it("runs once when the scheduled time has passed since the last run", () => {
    const state = { "evening-review": new Date(2026, 9, 19, 21, 1).toISOString() };
    expect(dueTasks([task], state, new Date(2026, 9, 20, 20, 59), lastDue).due).toEqual([]);
    expect(dueTasks([task], state, new Date(2026, 9, 20, 21, 0), lastDue).due).toEqual(["evening-review"]);
  });

  it("runs a missed run exactly once after the Mac wakes up", () => {
    // Asleep from 18:00 until 08:00 the next morning: one catch-up run, then nothing until 21:00.
    const state: Record<string, string> = { "evening-review": new Date(2026, 9, 19, 21, 0).toISOString() };
    const wake = new Date(2026, 9, 21, 8, 0);
    expect(dueTasks([task], state, wake, lastDue).due).toEqual(["evening-review"]);
    state["evening-review"] = wake.toISOString();
    expect(dueTasks([task], state, new Date(2026, 9, 21, 12, 0), lastDue).due).toEqual([]);
  });

  it("skips disabled tasks", () => {
    const state = { "evening-review": new Date(2026, 9, 19, 21, 0).toISOString() };
    expect(dueTasks([{ ...task, enabled: false }], state, new Date(2026, 9, 20, 22, 0), lastDue).due).toEqual([]);
  });
});

describe("run state", () => {
  const waiting = [
    { capture: "/libs/a/inbox/2026-10-25-100000-one.md", agent: "claude", until: 1_792_532_460_000 },
    { capture: "/libs/a/inbox/2026-10-25-100500-two.md", agent: "codex", until: 1_792_536_000_000 },
  ];

  it("remembers a first sighting without pretending the task ran", () => {
    const now = new Date(2026, 9, 20, 23, 0);
    const state = markChecked({ checked: {}, ran: {}, waiting: [], durations: {} }, ["evening-review"], now);
    expect(state.checked["evening-review"]).toBe(now.toISOString());
    expect(state.ran).toEqual({});
  });

  it("records a real run as both checked and ran", () => {
    const now = new Date(2026, 9, 20, 21, 0);
    const state = markRan({ checked: {}, ran: {}, waiting: [], durations: {} }, "evening-review", now);
    expect(state).toEqual({ checked: { "evening-review": now.toISOString() }, ran: { "evening-review": now.toISOString() }, waiting: [], durations: {} });
  });

  it("keeps the usage-limit waits when a task is checked or ran", () => {
    // tick() and runTask write these back whole: a state that loses its waits would lose the notes' promise.
    const before: RunState = { checked: {}, ran: {}, waiting, durations: {} };
    const now = new Date(2026, 9, 20, 21, 0);
    expect(markChecked(before, ["evening-review"], now).waiting).toEqual(waiting);
    expect(markRan(before, "evening-review", now).waiting).toEqual(waiting);
    // ... as copies: the state they were made from is not the one they hand on
    expect(markChecked(before, [], now).waiting).not.toBe(before.waiting);
    expect(markRan(before, "evening-review", now).waiting[0]).not.toBe(before.waiting[0]);
  });

  it("reads old state files that only had lastRun", () => {
    expect(normalizeRunState({ lastRun: { a: "2026-10-19T21:00:00.000Z" } })).toEqual({
      checked: { a: "2026-10-19T21:00:00.000Z" },
      ran: { a: "2026-10-19T21:00:00.000Z" },
      waiting: [],
      durations: {},
    });
    expect(normalizeRunState("junk")).toEqual({ checked: {}, ran: {}, waiting: [], durations: {} });
  });

  it("reads the waits it is given, keeping good entries and dropping malformed ones", () => {
    const [one, two] = waiting;
    expect(normalizeRunState({ checked: {}, ran: {}, waiting })).toEqual({ checked: {}, ran: {}, waiting, durations: {} });
    expect(
      normalizeRunState({
        checked: { a: "2026-10-19T21:00:00.000Z" },
        ran: {},
        waiting: [
          one,
          { capture: "/libs/a/inbox/x.md", agent: "claude" }, // no time
          { capture: "/libs/a/inbox/x.md", agent: "claude", until: Number.NaN },
          { capture: "/libs/a/inbox/x.md", agent: "", until: 1 }, // no agent
          { capture: "", agent: "claude", until: 1 }, // no note
          { capture: "/libs/a/inbox/x.md", agent: 4, until: 1 },
          [],
          null,
          { ...two, extra: "dropped" }, // a good wait with something more: only what a wait is stays
        ],
      }),
    ).toEqual({ checked: { a: "2026-10-19T21:00:00.000Z" }, ran: {}, waiting: [one, two], durations: {} });
    expect(normalizeRunState({ checked: {}, ran: {}, waiting: { capture: "x" } }).waiting).toEqual([]);
    expect(normalizeRunState({ checked: {}, ran: {} }).waiting).toEqual([]);
  });
});

describe("usage-limit waits", () => {
  const wait = (capture: string, agent: string, until: number): LimitWait => ({ capture, agent, until });

  it("tells the waits whose time has come from the others, a wait due at this very moment being due", () => {
    const early = wait("/inbox/a.md", "claude", 1_000);
    const exact = wait("/inbox/b.md", "claude", 2_000);
    const late = wait("/inbox/c.md", "codex", 2_001);
    expect(splitWaits([late, exact, early], 2_000)).toEqual({ due: [exact, early], later: [late] });
    expect(splitWaits([], 2_000)).toEqual({ due: [], later: [] });
  });

  it("adds a wait in place of any for the same note and agent, and leaves the other agent's", () => {
    const claude = wait("/inbox/a.md", "claude", 1_000);
    const codex = wait("/inbox/a.md", "codex", 5_000);
    const other = wait("/inbox/b.md", "claude", 3_000);
    const before = [claude, codex, other];
    expect(withWait(before, wait("/inbox/a.md", "claude", 9_000))).toEqual([codex, other, wait("/inbox/a.md", "claude", 9_000)]);
    expect(withWait(before, wait("/inbox/c.md", "claude", 9_000))).toEqual([claude, codex, other, wait("/inbox/c.md", "claude", 9_000)]);
    expect(before).toEqual([claude, codex, other]); // the list it was given is left as it was
  });

  it("sets a timer for the time left, never more than a timer can hold", () => {
    expect(timerDelay(10_000, 4_000)).toBe(6_000);
    expect(timerDelay(4_000, 4_000)).toBe(0);
    expect(timerDelay(1_000, 4_000)).toBe(0); // already past: at once
    expect(timerDelay(4_000 + MAX_TIMER_MS, 4_000)).toBe(MAX_TIMER_MS);
    expect(timerDelay(4_000 + MAX_TIMER_MS + 1, 4_000)).toBe(MAX_TIMER_MS); // a timer set beyond that fires at once; it is set again when it fires
    expect(MAX_TIMER_MS).toBe(2_147_483_647);
  });
});

describe("the times tests can shorten", () => {
  const test = { AVANZEL_TEST: "1" };

  it("is a minute after a reset, 10 s between sign-in looks, and 30 min of looking", () => {
    expect(resetMarginMs({})).toBe(60_000);
    expect(signInPollMs({})).toBe(10_000);
    expect(signInWatchMs({})).toBe(1_800_000);
  });

  it("reads the variables only under AVANZEL_TEST=1", () => {
    const set = { AVANZEL_RESET_MARGIN_MS: "0", AVANZEL_SIGNIN_POLL_MS: "500", AVANZEL_SIGNIN_WATCH_MS: "1500" };
    expect(resetMarginMs(set)).toBe(60_000);
    expect(signInPollMs(set)).toBe(10_000);
    expect(signInWatchMs(set)).toBe(1_800_000);
    expect(resetMarginMs({ ...set, AVANZEL_TEST: "0" })).toBe(60_000);
    expect(resetMarginMs({ ...set, ...test })).toBe(0); // no time at all after the reset is allowed
    expect(signInPollMs({ ...set, ...test })).toBe(500);
    expect(signInWatchMs({ ...set, ...test })).toBe(1_500);
  });

  it("keeps the default for a value that is no time", () => {
    for (const value of ["", "soon", "-5", "NaN", "Infinity"]) {
      expect(resetMarginMs({ ...test, AVANZEL_RESET_MARGIN_MS: value })).toBe(60_000);
    }
    for (const value of ["", "soon", "0", "-5", "NaN", "Infinity"]) {
      expect(signInPollMs({ ...test, AVANZEL_SIGNIN_POLL_MS: value })).toBe(10_000); // looking every 0 ms would be a busy loop
      expect(signInWatchMs({ ...test, AVANZEL_SIGNIN_WATCH_MS: value })).toBe(1_800_000);
    }
  });
});

describe("what a thought saved for the evening review says", () => {
  it("names the review's own time while it is on, as General says when it runs", () => {
    expect(savedNote({ schedule: "daily 21:00", enabled: true })).toBe("Saved to your inbox for the evening review at 21:00.");
    expect(savedNote({ schedule: "daily 07:30", enabled: true })).toBe("Saved to your inbox for the evening review at 07:30.");
    expect(savedNote({ schedule: "weekly sun 18:00", enabled: true })).toBe("Saved to your inbox for the evening review, Sundays at 18:00.");
  });

  it("promises no review while it is off, or when the library has none: nothing files the thought by itself", () => {
    expect(savedNote({ schedule: "daily 21:00", enabled: false })).toBe("Saved to your inbox.");
    expect(savedNote(null)).toBe("Saved to your inbox.");
  });
});
