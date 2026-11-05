import { describe, expect, it } from "vitest";
import { cursorKeyName, fileModeLabel, filingMeta, transcribedLine, transcribingLine } from "../src/shared/transcribing.ts";

// The capsule's words about turning a recording into text. The engine's own model runs on this Mac; the command in a library's
// [voice] settings can run anywhere, so for it the words don't say where. And the card's: the file-mode button of a recording,
// and the seconds (`filingMeta`) of a filing. The filing card's one line (`filingLine`) is tested with the rows' words
// (narration-copy.test.ts).

describe("the capsule's words about turning a recording into text", () => {
  it("while the words are made, say where only when it is on this Mac", () => {
    expect(transcribingLine(true)).toBe("Transcribing on this Mac…");
    expect(transcribingLine(false)).toBe("Transcribing…");
  });

  it("once they are made, say how long they took, in s with one decimal as macOS writes the unit, and where only when it is on this Mac", () => {
    expect(transcribedLine(1.4, true)).toBe("Transcribed on this Mac in 1.4 s");
    expect(transcribedLine(1.4, false)).toBe("Transcribed in 1.4 s");
    expect(transcribedLine(0, false)).toBe("Transcribed in 0.0 s");
    expect(transcribedLine(12.34, true)).toBe("Transcribed on this Mac in 12.3 s");
  });

  it("claim nothing about this Mac for a command", () => {
    for (const line of [transcribingLine(false), transcribedLine(2, false)]) expect(line).not.toMatch(/this Mac|locally|offline/i);
  });

  it("are written as the design rules ask: sentence case, the one-character ellipsis, no “!”", () => {
    for (const on of [true, false]) {
      for (const line of [transcribingLine(on), transcribedLine(3.2, on)]) {
        expect(line).toMatch(/^\p{Lu}/u);
        expect(line).not.toContain("!");
        expect(line).not.toContain("...");
      }
    }
  });
});

describe("fileModeLabel: the listening bar's file-mode button", () => {
  it("says the capture files now, whatever the review", () => {
    for (const review of [null, "", "at 21:00", "on Sundays at 18:00"]) expect(fileModeLabel("now", review)).toBe("Files now");
  });

  it("names when the evening review files a capture saved for it, as the review's schedule says", () => {
    expect(fileModeLabel("evening", "at 21:00")).toBe("Files at 21:00");
    expect(fileModeLabel("evening", "at 07:30")).toBe("Files at 07:30");
    expect(fileModeLabel("evening", "on Sundays at 18:00")).toBe("Files on Sundays at 18:00");
  });

  it("names no time for a schedule it can't read, only that the evening review files it", () => {
    expect(fileModeLabel("evening", "")).toBe("Files at the evening review");
  });

  it("promises no review while the review is off: nothing files the capture, which stays in the inbox", () => {
    expect(fileModeLabel("evening", null)).toBe("Stays in the inbox");
  });

  it("calls the review by its name where it names it, the evening review, and the inbox the inbox, as every other card does", () => {
    for (const review of [null, "", "at 21:00", "on Sundays at 18:00"]) {
      const label = fileModeLabel("evening", review);
      expect(label, String(review)).not.toMatch(/the review/);
      expect(label, String(review)).not.toMatch(/your inbox/);
    }
  });

  it("never says tonight: a weekly review isn't tonight's, and a review that is off files nothing", () => {
    for (const review of [null, "", "at 21:00", "on Mondays at 07:30", "on Sundays at 18:00"]) {
      expect(fileModeLabel("evening", review)).not.toMatch(/tonight/i);
    }
  });

  it("is written as the design rules ask: a verb first, sentence case (a day is a name), no “!”, no ellipsis", () => {
    for (const review of [null, "", "at 21:00", "on Sundays at 18:00"]) {
      for (const mode of ["now", "evening"] as const) {
        const label = fileModeLabel(mode, review);
        expect(label).toMatch(/^(Files|Stays) [a-z]/); // a verb, and then no capital but a day's
        expect(label).not.toContain("!");
        expect(label).not.toMatch(/…|\.\.\./);
      }
    }
  });
});

describe("filingMeta: the filing card's seconds", () => {
  it("counts whole seconds towards the estimate, and says how many it is about", () => {
    expect(filingMeta(0, 15)).toBe("0 s of about 15");
    expect(filingMeta(6, 15)).toBe("6 s of about 15");
    expect(filingMeta(6.9, 15)).toBe("6 s of about 15"); // whole seconds, rounded down: the count never runs ahead of the clock
    expect(filingMeta(14.99, 15)).toBe("14 s of about 15");
  });

  it("just counts from the estimate on", () => {
    expect(filingMeta(15, 15)).toBe("15 s");
    expect(filingMeta(15.4, 15)).toBe("15 s");
    expect(filingMeta(18, 15)).toBe("18 s");
    expect(filingMeta(92.6, 15)).toBe("92 s");
  });

  it("reads seconds at the estimate as past it, so it never says 0 s of about 0", () => {
    // A fast agent's estimate is small (the tests' fake one gives 0 to 2): "of about 0" is no estimate at all.
    expect(filingMeta(0, 0)).toBe("0 s");
    expect(filingMeta(0.4, 0)).toBe("0 s");
    expect(filingMeta(3, 0)).toBe("3 s");
    expect(filingMeta(0, 1)).toBe("0 s of about 1");
    expect(filingMeta(1, 1)).toBe("1 s");
    expect(filingMeta(1.9, 2)).toBe("1 s of about 2");
    expect(filingMeta(2, 2)).toBe("2 s");
    for (let seconds = 0; seconds < 120; seconds += 0.5) expect(filingMeta(seconds, 0)).not.toContain("about");
  });

  it("never counts backwards: a clock that ran behind the run's start reads as its first second", () => {
    expect(filingMeta(-3, 15)).toBe("0 s of about 15");
    expect(filingMeta(-0.2, 0)).toBe("0 s");
    expect(filingMeta(Number.NaN, 15)).toBe("0 s of about 15");
  });

  it("is written as the design rules ask: a space before the unit, no “!”, no emoji", () => {
    for (const line of [filingMeta(6, 15), filingMeta(18, 15), filingMeta(0, 0)]) {
      expect(line).toMatch(/^\d+ s( of about \d+)?$/);
      expect(line).not.toContain("!");
    }
  });
});

describe("the keys a dictation can listen to", () => {
  it("names each key as the Settings menu does", () => {
    expect(cursorKeyName("right-option")).toBe("Right Option");
    expect(cursorKeyName("right-control")).toBe("Right Control");
  });
});
