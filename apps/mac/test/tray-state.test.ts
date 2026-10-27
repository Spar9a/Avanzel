import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { describe, expect, it } from "vitest";
import { clock } from "../src/shared/clock.ts";
import { elapsed, nextTrayWake, reviewEndedAt, sleepsAfterReview, trayTooltip, trayView, wholePercent, type TrayInput } from "../src/main/tray-state.ts";

const NOW = 1_000_000;
/** Nothing going on: the idle face, no title. */
const CALM: TrayInput = {
  setupOpen: false,
  problem: false,
  recordingSince: null,
  busy: false,
  hiddenFilingSince: null,
  downloadPercent: null,
  filedUntil: null,
  asleep: false,
};
const input = (over: Partial<TrayInput> = {}): TrayInput => ({ ...CALM, ...over });

// The face's rules, first match first. Each entry is what makes that rule hold and nothing else.
const FACE_RULES: { name: string; holds: Partial<TrayInput>; face: MenuBarState }[] = [
  { name: "a problem", holds: { problem: true }, face: "needs-you" },
  { name: "a recording", holds: { recordingSince: NOW - 5_000 }, face: "listening" },
  { name: "something busy", holds: { busy: true }, face: "filing" },
  { name: "a filed stamp that lasts", holds: { filedUntil: NOW + 1_500 }, face: "filed" },
  { name: "Zel asleep", holds: { asleep: true }, face: "asleep" },
];

// The title's rules, first match first. Each entry's title is what its rule shows at NOW.
const TITLE_RULES: { name: string; holds: Partial<TrayInput>; title: string }[] = [
  { name: "setup's window or bubble", holds: { setupOpen: true }, title: "" },
  { name: "a recording", holds: { recordingSince: NOW - 5_000 }, title: "0:05" },
  { name: "a hidden filing", holds: { hiddenFilingSince: NOW - 65_400 }, title: "1:05" },
  { name: "a download", holds: { downloadPercent: 37 }, title: "37%" },
];

describe("trayView's face", () => {
  it("is idle when nothing is going on", () => {
    expect(trayView(CALM, NOW)).toEqual({ face: "idle", title: "" });
  });

  it.each(FACE_RULES)("is $face for $name alone", ({ holds, face }) => {
    expect(trayView(input(holds), NOW).face).toBe(face);
  });

  // The first match wins: for every pair of rules, the earlier one's face shows when both hold.
  const pairs = FACE_RULES.flatMap((first, i) => FACE_RULES.slice(i + 1).map((second) => ({ first, second })));
  it.each(pairs)("shows $first.face for $first.name over $second.face for $second.name", ({ first, second }) => {
    expect(trayView(input({ ...first.holds, ...second.holds }), NOW).face).toBe(first.face);
    expect(trayView(input({ ...second.holds, ...first.holds }), NOW).face).toBe(first.face);
  });

  it("shows needs-you with the title 0:05 for a problem during a recording", () => {
    expect(trayView(input({ problem: true, recordingSince: NOW - 5_000 }), NOW)).toEqual({ face: "needs-you", title: "0:05" });
  });

  it("shows filing while busy with a stamp still to last, and idle once the stamp has expired", () => {
    expect(trayView(input({ busy: true, filedUntil: NOW + 1_000 }), NOW).face).toBe("filing");
    expect(trayView(input({ filedUntil: NOW - 1 }), NOW).face).toBe("idle");
  });

  it("ends the stamp at its time exactly", () => {
    expect(trayView(input({ filedUntil: NOW + 1 }), NOW).face).toBe("filed");
    expect(trayView(input({ filedUntil: NOW }), NOW).face).toBe("idle");
  });

  it("gives an expired stamp to Zel asleep", () => {
    expect(trayView(input({ filedUntil: NOW - 1, asleep: true }), NOW).face).toBe("asleep");
  });

  it("starts a recording at 0, even at the epoch", () => {
    expect(trayView(input({ recordingSince: 0 }), 0)).toEqual({ face: "listening", title: "0:00" });
  });

  it("shows the face of setup's window as it would be without it", () => {
    expect(trayView(input({ setupOpen: true, busy: true }), NOW)).toEqual({ face: "filing", title: "" });
  });
});

describe("trayView's title", () => {
  it("is empty when nothing counts", () => {
    for (const holds of [{}, { busy: true }, { problem: true }, { filedUntil: NOW + 1_000 }, { asleep: true }]) {
      expect(trayView(input(holds), NOW).title, JSON.stringify(holds)).toBe("");
    }
  });

  it.each(TITLE_RULES)("is $title for $name alone", ({ holds, title }) => {
    expect(trayView(input(holds), NOW).title).toBe(title);
  });

  const pairs = TITLE_RULES.flatMap((first, i) => TITLE_RULES.slice(i + 1).map((second) => ({ first, second })));
  it.each(pairs)("shows the title of $first.name over that of $second.name", ({ first, second }) => {
    expect(trayView(input({ ...first.holds, ...second.holds }), NOW).title).toBe(first.title);
    expect(trayView(input({ ...second.holds, ...first.holds }), NOW).title).toBe(first.title);
  });

  it("is empty for every source while setup's window or bubble shows", () => {
    for (const { holds } of TITLE_RULES) expect(trayView(input({ ...holds, setupOpen: true }), NOW).title).toBe("");
  });

  it("shows a download's percent alone as the title, on the idle face", () => {
    expect(trayView(input({ downloadPercent: 37 }), NOW)).toEqual({ face: "idle", title: "37%" });
    expect(trayView(input({ downloadPercent: 0 }), NOW)).toEqual({ face: "idle", title: "0%" });
    expect(trayView(input({ downloadPercent: 100 }), NOW)).toEqual({ face: "idle", title: "100%" });
  });

  it("counts a hidden filing from the start of its run", () => {
    expect(trayView(input({ hiddenFilingSince: NOW }), NOW).title).toBe("0:00");
    expect(trayView(input({ hiddenFilingSince: NOW - 12_999 }), NOW).title).toBe("0:12");
  });
});

describe("trayTooltip", () => {
  // Keyed by every MenuBarState, so a state the design system adds fails the typecheck here until its words are pinned too. The words
  // hold on every path to the face: the busy face is also an Ask, a transcription that files nothing yet and the weekly review, so it
  // says "working", not "filing"; the stamp also follows a saved card (a screen comment, words kept for the review), and Filed is
  // "saved and undoable" (spec §4.2), so it says "saved".
  const WORDS: Record<MenuBarState, string> = {
    idle: "Avanzel",
    listening: "Avanzel is recording",
    filing: "Avanzel is working",
    filed: "Avanzel saved it",
    "needs-you": "Avanzel needs you",
    asleep: "The evening review is done",
  };
  const FACES = Object.keys(WORDS) as MenuBarState[];

  it.each(FACES)("gives the %s face its words", (face) => {
    expect(trayTooltip(face)).toBe(WORDS[face]);
  });

  it("gives every face words of its own, since the face alone is all a state has at 18 pt", () => {
    expect(new Set(FACES.map(trayTooltip)).size).toBe(FACES.length);
  });

  it("follows the copy rules: sentence case, plain, no exclamation mark, no emoji, no Letter", () => {
    for (const face of FACES) {
      const words = trayTooltip(face);
      expect(words, face).toMatch(/^[A-Z]/);
      expect(words, face).not.toMatch(/[!.]$/); // a tooltip is a label, not a sentence
      expect(words, face).not.toMatch(/!|oops|letter|\p{Extended_Pictographic}/iu);
    }
  });
});

describe("elapsed", () => {
  it("is the capsule's clock, so that the card and the menu bar count the same way (test/clock.test.ts has its cases)", () => {
    expect(elapsed).toBe(clock);
  });

  it("gives the brief's examples: 0:07, 1:05, 12:03, and 0:00 for a time before the start", () => {
    expect(elapsed(7_000)).toBe("0:07");
    expect(elapsed(65_400)).toBe("1:05");
    expect(elapsed(723_000)).toBe("12:03");
    expect(elapsed(-5)).toBe("0:00");
  });
});

describe("sleepsAfterReview", () => {
  const at = (hours: number, minutes: number) => new Date(2026, 9, 27, hours, minutes);

  it("is false before 18:00, true from 18:00 to 05:59, and false from 06:00", () => {
    expect(sleepsAfterReview(at(17, 59))).toBe(false);
    expect(sleepsAfterReview(at(18, 0))).toBe(true);
    expect(sleepsAfterReview(at(23, 59))).toBe(true);
    expect(sleepsAfterReview(at(0, 0))).toBe(true);
    expect(sleepsAfterReview(at(5, 59))).toBe(true);
    expect(sleepsAfterReview(at(6, 0))).toBe(false);
    expect(sleepsAfterReview(at(12, 0))).toBe(false);
  });
});

describe("reviewEndedAt", () => {
  const now = new Date(2026, 9, 27, 14, 35, 12);

  it("is now", () => {
    expect(reviewEndedAt({}, now)).toEqual(now);
    expect(reviewEndedAt({ AVANZEL_TEST: "1" }, now)).toEqual(now);
  });

  it("is the hour AVANZEL_FAKE_HOUR gives, today, with AVANZEL_TEST=1", () => {
    expect(reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: "21" }, now)).toEqual(new Date(2026, 9, 27, 21, 0, 0));
    expect(reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: "9" }, now)).toEqual(new Date(2026, 9, 27, 9, 0, 0));
    expect(reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: "0" }, now)).toEqual(new Date(2026, 9, 27, 0, 0, 0));
    expect(reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: "23" }, now)).toEqual(new Date(2026, 9, 27, 23, 0, 0));
  });

  it("reads AVANZEL_FAKE_HOUR only with AVANZEL_TEST=1", () => {
    expect(reviewEndedAt({ AVANZEL_FAKE_HOUR: "21" }, now)).toEqual(now);
    expect(reviewEndedAt({ AVANZEL_TEST: "0", AVANZEL_FAKE_HOUR: "21" }, now)).toEqual(now);
    expect(reviewEndedAt({ AVANZEL_TEST: "true", AVANZEL_FAKE_HOUR: "21" }, now)).toEqual(now);
  });

  it("ignores what is no hour", () => {
    for (const fake of ["", "24", "99", "-1", "9.5", "nine", " 9", "9 ", "0x9"]) {
      expect(reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: fake }, now), JSON.stringify(fake)).toEqual(now);
    }
  });

  it("leaves the date it was given alone", () => {
    const given = new Date(now);
    reviewEndedAt({ AVANZEL_TEST: "1", AVANZEL_FAKE_HOUR: "21" }, given);
    expect(given).toEqual(now);
  });
});

describe("wholePercent", () => {
  it("is the share received, rounded down", () => {
    expect(wholePercent(0, 673)).toBe(0);
    expect(wholePercent(1, 673)).toBe(0);
    expect(wholePercent(250, 1000)).toBe(25);
    expect(wholePercent(999, 1000)).toBe(99);
    expect(wholePercent(1000, 1000)).toBe(100);
  });

  it("is exact where a share is a whole percent, though a fraction times 100 is not", () => {
    for (const percent of [29, 57, 58]) expect(wholePercent(percent, 100), `${percent} of 100`).toBe(percent);
  });

  it("stays between 0 and 100 whatever it is told", () => {
    expect(wholePercent(1500, 1000)).toBe(100);
    expect(wholePercent(-5, 1000)).toBe(0);
  });

  it("is nothing while the size isn't known, or what arrived isn't a number", () => {
    expect(wholePercent(10, 0)).toBeNull();
    expect(wholePercent(0, 0)).toBeNull();
    expect(wholePercent(10, Number.NaN)).toBeNull();
    expect(wholePercent(Number.NaN, 100)).toBeNull();
    expect(wholePercent(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });
});

describe("nextTrayWake", () => {
  it("is never while nothing counts down", () => {
    expect(nextTrayWake(CALM, NOW)).toBeNull();
    for (const holds of [{ problem: true }, { busy: true }, { asleep: true }, { downloadPercent: 40 }, { filedUntil: NOW }, { filedUntil: NOW - 50 }]) {
      expect(nextTrayWake(input(holds), NOW), JSON.stringify(holds)).toBeNull();
    }
  });

  it("is the rest of the second while a recording counts", () => {
    expect(nextTrayWake(input({ recordingSince: NOW - 400 }), NOW)).toBe(600);
    expect(nextTrayWake(input({ recordingSince: NOW - 12_250 }), NOW)).toBe(750);
  });

  it("is a whole second on the second's own boundary, never 0", () => {
    expect(nextTrayWake(input({ recordingSince: NOW }), NOW)).toBe(1_000);
    expect(nextTrayWake(input({ recordingSince: NOW - 3_000 }), NOW)).toBe(1_000);
  });

  it("counts a hidden filing's seconds the same way", () => {
    expect(nextTrayWake(input({ hiddenFilingSince: NOW - 1_900 }), NOW)).toBe(100);
  });

  it("follows the source the title shows: the recording's, over a hidden filing's", () => {
    expect(nextTrayWake(input({ recordingSince: NOW - 300, hiddenFilingSince: NOW - 800 }), NOW)).toBe(700);
  });

  it("waits a whole second for a clock that went back", () => {
    expect(nextTrayWake(input({ recordingSince: NOW + 5_000 }), NOW)).toBe(1_000);
  });

  it("is not while setup's window or bubble hides the title", () => {
    expect(nextTrayWake(input({ recordingSince: NOW - 400, setupOpen: true }), NOW)).toBeNull();
    expect(nextTrayWake(input({ hiddenFilingSince: NOW - 400, setupOpen: true }), NOW)).toBeNull();
  });

  it("is never a wait that isn't a time", () => {
    expect(nextTrayWake(input({ recordingSince: Number.NaN }), NOW)).toBeNull();
    expect(nextTrayWake(input({ hiddenFilingSince: Number.NaN, filedUntil: NOW + 700 }), NOW)).toBe(700);
    expect(nextTrayWake(input({ filedUntil: Number.POSITIVE_INFINITY }), NOW)).toBeNull();
  });

  it("is the time left of a filed stamp", () => {
    expect(nextTrayWake(input({ filedUntil: NOW + 1_500 }), NOW)).toBe(1_500);
    expect(nextTrayWake(input({ filedUntil: NOW + 1 }), NOW)).toBe(1);
  });

  it("is the sooner of the count's next second and the stamp's end", () => {
    expect(nextTrayWake(input({ recordingSince: NOW - 400, filedUntil: NOW + 300 }), NOW)).toBe(300);
    expect(nextTrayWake(input({ recordingSince: NOW - 400, filedUntil: NOW + 1_800 }), NOW)).toBe(600);
  });

  it("still ends the stamp while setup hides the title", () => {
    expect(nextTrayWake(input({ setupOpen: true, filedUntil: NOW + 900 }), NOW)).toBe(900);
  });
});
