import { describe, expect, it } from "vitest";
import {
  durationsOf,
  estimateSeconds,
  markChecked,
  markRan,
  normalizeRunState,
  withDuration,
  type RunState,
} from "../src/main/schedule.ts";

// How long a capsule filing takes, as the run state learns it: the last ten durations of each agent, and the estimate the
// filing card shows ("6 s of about 15") taken from them.

describe("estimateSeconds", () => {
  it("is 15 until the agent has done three filings", () => {
    expect(estimateSeconds([])).toBe(15);
    expect(estimateSeconds([10, 12])).toBe(15);
  });

  it("is the median of what its filings took", () => {
    expect(estimateSeconds([10, 12, 30])).toBe(12);
    expect(estimateSeconds([30, 10, 12])).toBe(12); // in whatever order they were kept
  });

  it("with an even count is the mean of the middle two", () => {
    expect(estimateSeconds([10, 12, 30, 40])).toBe(21);
    expect(estimateSeconds([40, 10, 30, 12])).toBe(21);
  });

  it("is a whole number of seconds", () => {
    expect(estimateSeconds([1.2, 1.4, 1.6])).toBe(1);
    expect(estimateSeconds([10, 11, 12, 13])).toBe(12); // 11.5 rounds up
    expect(estimateSeconds([9.6, 9.7, 9.8])).toBe(10);
  });

  it("is not moved by one filing that took far longer than the rest", () => {
    expect(estimateSeconds([11, 12, 12, 13, 600])).toBe(12);
  });

  it("leaves the list it is given as it was", () => {
    const kept = [30, 10, 12];
    estimateSeconds(kept);
    expect(kept).toEqual([30, 10, 12]);
  });
});

describe("withDuration", () => {
  it("adds a filing's seconds to its agent's list, after the ones it has", () => {
    expect(withDuration({}, "claude", 8)).toEqual({ claude: [8] });
    expect(withDuration({ claude: [8] }, "claude", 9.5)).toEqual({ claude: [8, 9.5] });
  });

  it("keeps each agent's list apart: the key is the agent that ran", () => {
    const before = { claude: [8, 9], codex: [20] };
    expect(withDuration(before, "codex", 22)).toEqual({ claude: [8, 9], codex: [20, 22] });
    expect(withDuration(before, "gemini", 5)).toEqual({ claude: [8, 9], codex: [20], gemini: [5] });
  });

  it("keeps the last ten: an eleventh value pushes out the oldest", () => {
    let durations: Record<string, number[]> = {};
    for (let seconds = 1; seconds <= 10; seconds++) durations = withDuration(durations, "claude", seconds);
    expect(durations.claude).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    durations = withDuration(durations, "claude", 11);
    expect(durations.claude).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("leaves the durations it is given as they were", () => {
    const before = { claude: [8, 9] };
    const after = withDuration(before, "claude", 10);
    expect(before).toEqual({ claude: [8, 9] });
    expect(after).not.toBe(before);
    expect(after.claude).not.toBe(before.claude);
  });

  it("takes in no value that is no duration: a negative one, or one that isn't finite", () => {
    for (const seconds of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(withDuration({ claude: [8] }, "claude", seconds)).toEqual({ claude: [8] });
    }
    expect(withDuration({}, "claude", 0)).toEqual({ claude: [0] }); // a filing can be that quick
  });

  it("names an agent whatever it is called", () => {
    expect(durationsOf(withDuration({}, "constructor", 7), "constructor")).toEqual([7]);
  });
});

describe("durationsOf", () => {
  it("is an agent's list, and none for an agent that has no filings kept", () => {
    expect(durationsOf({ claude: [8, 9] }, "claude")).toEqual([8, 9]);
    expect(durationsOf({ claude: [8, 9] }, "codex")).toEqual([]);
    expect(durationsOf({}, "toString")).toEqual([]); // never a property every object has
  });
});

describe("the run state's durations", () => {
  const now = new Date(2026, 9, 26, 21, 0);

  it("are kept as they are read", () => {
    const raw = { checked: {}, ran: {}, waiting: [], durations: { claude: [8, 9.5, 12], codex: [20] } };
    expect(normalizeRunState(raw)).toEqual(raw);
  });

  it("are none in a state written before they were kept, and in the legacy one", () => {
    expect(normalizeRunState({ checked: { a: "2026-10-19T21:00:00.000Z" }, ran: {}, waiting: [] }).durations).toEqual({});
    expect(normalizeRunState({ lastRun: { a: "2026-10-19T21:00:00.000Z" } }).durations).toEqual({});
    expect(normalizeRunState("junk").durations).toEqual({});
  });

  it("drop what is no duration: a value that isn't a number, a negative one, or one that isn't finite", () => {
    const raw = { durations: { claude: [4, "5", -1, null, Number.NaN, Infinity, 6, undefined, [7], {}, true, -0.5, 0] } };
    expect(normalizeRunState(raw).durations).toEqual({ claude: [4, 6, 0] });
  });

  it("are cut to the last ten of a list that is longer", () => {
    const fifty = Array.from({ length: 50 }, (_, n) => n + 1);
    expect(normalizeRunState({ durations: { claude: fifty } }).durations).toEqual({ claude: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50] });
  });

  it("cut a list to its last ten after its bad values are gone", () => {
    const mixed = Array.from({ length: 30 }, (_, n) => (n % 2 ? "x" : n)); // fifteen numbers: 0, 2, 4 … 28
    expect(normalizeRunState({ durations: { claude: mixed } }).durations).toEqual({ claude: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28] });
  });

  it("drop an agent's list that isn't a list, and an agent left with none", () => {
    const raw = { durations: { claude: "fast", codex: { 0: 5 }, gemini: null, cursor: 7, opencode: [], other: ["x", -3], good: [3] } };
    expect(normalizeRunState(raw).durations).toEqual({ good: [3] });
  });

  it("are none when they aren't a record at all", () => {
    for (const durations of [null, "fast", 7, [8, 9], undefined]) {
      expect(normalizeRunState({ checked: {}, ran: {}, waiting: [], durations }).durations).toEqual({});
    }
  });

  it("make a state of their own: one with only durations isn't the legacy format", () => {
    // The legacy format has a lastRun and none of checked, ran or waiting. A state with only durations has none of those
    // either, and must not be read as legacy, which would lose them.
    expect(normalizeRunState({ durations: { claude: [8, 9, 10] } })).toEqual({
      checked: {},
      ran: {},
      waiting: [],
      durations: { claude: [8, 9, 10] },
    });
  });

  it("keep an agent called __proto__ or constructor as a name, and nothing else", () => {
    // A name is only a key: one that sets the record's prototype, or reads one inherited, would lose the list or read the wrong one.
    const raw = JSON.parse('{"durations": {"__proto__": [3], "constructor": [4]}}') as unknown;
    const { durations } = normalizeRunState(raw);
    expect(Object.keys(durations).sort()).toEqual(["__proto__", "constructor"]);
    expect(durationsOf(durations, "constructor")).toEqual([4]);
    expect(durationsOf(durations, "__proto__")).toEqual([3]);
  });

  it("stay with the state when a task is checked or ran: tick() writes the state back whole", () => {
    const before: RunState = { checked: {}, ran: {}, waiting: [], durations: { claude: [8, 9, 10], codex: [20] } };
    expect(markChecked(before, ["evening-review"], now).durations).toEqual({ claude: [8, 9, 10], codex: [20] });
    expect(markChecked(before, [], now).durations).toEqual({ claude: [8, 9, 10], codex: [20] });
    expect(markRan(before, "evening-review", now).durations).toEqual({ claude: [8, 9, 10], codex: [20] });
  });

  it("are handed on as copies: the state they were made from is not the one they are handed to", () => {
    const before: RunState = { checked: {}, ran: {}, waiting: [], durations: { claude: [8, 9, 10] } };
    for (const after of [markChecked(before, ["evening-review"], now), markRan(before, "evening-review", now)]) {
      expect(after.durations).not.toBe(before.durations);
      expect(after.durations.claude).not.toBe(before.durations.claude);
    }
  });

  it("go through every helper in turn", () => {
    // What the app does over a day: a filing keeps a duration, a task is checked, another ran, and the state is read again.
    let state = normalizeRunState({});
    state = { ...state, durations: withDuration(state.durations, "claude", 9) };
    state = markChecked(state, ["evening-review"], now);
    state = markRan(state, "weekly-review", now);
    state = normalizeRunState(JSON.parse(JSON.stringify(state)) as unknown);
    expect(state.durations).toEqual({ claude: [9] });
    expect(Object.keys(state.checked).sort()).toEqual(["evening-review", "weekly-review"]);
  });
});
