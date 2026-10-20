import { describe, expect, it } from "vitest";
import { dueTasks, markChecked, markRan, normalizeRunState } from "../src/main/schedule.ts";

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
  it("remembers a first sighting without pretending the task ran", () => {
    const now = new Date(2026, 9, 20, 23, 0);
    const state = markChecked({ checked: {}, ran: {} }, ["evening-review"], now);
    expect(state.checked["evening-review"]).toBe(now.toISOString());
    expect(state.ran).toEqual({});
  });

  it("records a real run as both checked and ran", () => {
    const now = new Date(2026, 9, 20, 21, 0);
    const state = markRan({ checked: {}, ran: {} }, "evening-review", now);
    expect(state).toEqual({ checked: { "evening-review": now.toISOString() }, ran: { "evening-review": now.toISOString() } });
  });

  it("reads old state files that only had lastRun", () => {
    expect(normalizeRunState({ lastRun: { a: "2026-10-19T21:00:00.000Z" } })).toEqual({
      checked: { a: "2026-10-19T21:00:00.000Z" },
      ran: { a: "2026-10-19T21:00:00.000Z" },
    });
    expect(normalizeRunState("junk")).toEqual({ checked: {}, ran: {} });
  });
});
