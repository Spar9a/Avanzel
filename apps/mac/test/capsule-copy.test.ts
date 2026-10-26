import { describe, expect, it } from "vitest";
import { filedLine, moreLine, notedLine, pageCaption, recordedLine, SHOWN_PAGES, shortTitle, stoppedLine, TITLE_CHARS } from "../src/renderer/capsule/copy.ts";
import { cancelledLine } from "../src/renderer/setup/copy.ts";

// The capsule's result cards' words that are made from values: what a filing says of itself, of its pages, and the two Stopped
// cards, which promise the evening review only while the library's runs.

/** The three ways the review reads (reviewTime): a time, a schedule that can't be read, and off. */
const REVIEWS = ["at 21:00", "on Sundays at 18:00", "", null] as const;

describe("filedLine: the bar's line once a filing ends well", () => {
  it("names who filed it and the whole seconds it took, as macOS writes the unit", () => {
    expect(filedLine("Claude Code", 6)).toBe("Filed by Claude Code in 6 s");
    expect(filedLine("Codex", 23.4)).toBe("Filed by Codex in 23 s");
    expect(filedLine("Codex", 23.6)).toBe("Filed by Codex in 24 s");
  });

  it("never says 0 s: an agent that files in no time took a second", () => {
    expect(filedLine("fake", 0)).toBe("Filed by fake in 1 s");
    expect(filedLine("fake", 0.2)).toBe("Filed by fake in 1 s");
    expect(filedLine("fake", 0.49)).toBe("Filed by fake in 1 s");
    expect(filedLine("fake", 1.4)).toBe("Filed by fake in 1 s");
  });

  it("reads a clock that ran backwards, or no clock at all, as the first second", () => {
    expect(filedLine("fake", -5)).toBe("Filed by fake in 1 s");
    expect(filedLine("fake", Number.NaN)).toBe("Filed by fake in 1 s");
    expect(filedLine("fake", Number.POSITIVE_INFINITY)).toBe("Filed by fake in 1 s");
  });
});

describe("a filing that wrote no page", () => {
  it("is noted in the log, by the agent that did it", () => {
    expect(notedLine("Claude Code")).toBe("Claude Code noted it in the log.");
    expect(notedLine("fake")).toBe("fake noted it in the log.");
  });
});

describe("a page's row", () => {
  it("says a page the filing made is new", () => {
    expect(pageCaption({ created: true })).toBe("new");
  });

  it("says any other page is updated, a page whose state doesn't say included", () => {
    expect(pageCaption({ created: false })).toBe("updated");
    expect(pageCaption({})).toBe("updated");
  });

  it("shows a title of up to 32 characters whole, and a longer one cut after a word, with the one-character ellipsis", () => {
    expect(TITLE_CHARS).toBe(32);
    expect(shortTitle("Tulips for October")).toBe("Tulips for October");
    const whole = "x".repeat(TITLE_CHARS);
    expect(shortTitle(whole)).toBe(whole);
    expect(shortTitle("An idea page whose title goes on and on about indie game development")).toBe("An idea page whose title goes…");
    expect(shortTitle("Plan for the Q4 launch of the podcast")).toBe("Plan for the Q4 launch of the…");
  });

  it("cuts a title with no word to cut after at the character, and never to more than 32 characters", () => {
    expect(shortTitle(`${"x".repeat(TITLE_CHARS)}y`)).toBe(`${"x".repeat(TITLE_CHARS - 1)}…`);
    for (const title of ["An idea page whose title goes on and on about indie game development", "x".repeat(80), "ab cd ".repeat(20)]) {
      expect(Array.from(shortTitle(title)).length, title).toBeLessThanOrEqual(TITLE_CHARS);
    }
  });

  it("cuts a title by characters, never through one that takes two code units", () => {
    const smile = "\u{1F600}"; // one character, two UTF-16 code units
    expect(shortTitle(smile.repeat(TITLE_CHARS + 1))).toBe(`${smile.repeat(TITLE_CHARS - 1)}…`);
    expect(shortTitle(smile.repeat(TITLE_CHARS))).toBe(smile.repeat(TITLE_CHARS));
  });

  it("shows three pages, and says how many more there are", () => {
    expect(SHOWN_PAGES).toBe(3);
    expect(moreLine(1)).toBe("and 1 more");
    expect(moreLine(2)).toBe("and 2 more");
    expect(moreLine(12)).toBe("and 12 more");
  });
});

describe("stoppedLine: the Stopped filing's footer", () => {
  it("says what stayed of the run's edits, as setup does, and when the evening review files the note", () => {
    expect(stoppedLine("Claude Code", false, 0, "at 21:00")).toBe(`${cancelledLine("Claude Code", false, 0)} The evening review files it at 21:00.`);
    expect(stoppedLine("Claude Code", true, 0, "at 21:00")).toBe(`${cancelledLine("Claude Code", true, 0)} The evening review files it at 21:00.`);
    expect(stoppedLine("Claude Code", false, 2, "at 21:00")).toBe(`${cancelledLine("Claude Code", false, 2)} The evening review files it at 21:00.`);
  });

  it("words a weekly review as the review does, never as tonight", () => {
    expect(stoppedLine("Codex", false, 0, "on Sundays at 18:00")).toBe(
      "Your words are back in the inbox, untouched, and nothing else changed. The evening review files it on Sundays at 18:00.",
    );
    for (const review of REVIEWS) expect(stoppedLine("Codex", false, 0, review)).not.toMatch(/tonight/i);
  });

  it("names no time for a review whose schedule can't be read", () => {
    expect(stoppedLine("Claude Code", false, 0, "")).toBe(`${cancelledLine("Claude Code", false, 0)} The evening review files it.`);
  });

  it("promises no review while the review is off: it is setup's line alone", () => {
    for (const [partial, leftovers] of [[false, 0], [true, 0], [false, 3]] as const) {
      expect(stoppedLine("Claude Code", partial, leftovers, null)).toBe(cancelledLine("Claude Code", partial, leftovers));
    }
    expect(stoppedLine("Claude Code", false, 0, null)).not.toMatch(/review/i);
  });
});

describe("recordedLine: the Stopped transcription's footer", () => {
  it("says the recording is in the inbox, and when the evening review turns it into words and files it", () => {
    expect(recordedLine("at 21:00")).toBe("It's in your inbox. The evening review turns it into words and files it at 21:00.");
    expect(recordedLine("on Sundays at 18:00")).toBe("It's in your inbox. The evening review turns it into words and files it on Sundays at 18:00.");
  });

  it("names no time for a review whose schedule can't be read", () => {
    expect(recordedLine("")).toBe("It's in your inbox. The evening review turns it into words and files it.");
  });

  it("says only where the recording is while the review is off, which promises it nothing", () => {
    expect(recordedLine(null)).toBe("It's in your inbox.");
  });
});

describe("the result cards' words are written as the design rules ask", () => {
  /** The lines that are sentences. */
  const sentences = [
    filedLine("Claude Code", 6),
    notedLine("Claude Code"),
    ...REVIEWS.flatMap((review) => [stoppedLine("Claude Code", false, 0, review), stoppedLine("Claude Code", true, 0, review), recordedLine(review)]),
  ];
  /** A row's small words, under the title or beside it. */
  const captions = [pageCaption({ created: true }), pageCaption({}), moreLine(2)];

  it("begin with a capital when they are sentences, and are lower case when they are a row's caption", () => {
    for (const line of sentences) expect(line, line).toMatch(/^\p{Lu}/u);
    for (const line of captions) expect(line, line).toMatch(/^\p{Ll}/u);
  });

  it("have no “!”, no three dots, no emoji and no “I”", () => {
    for (const line of [...sentences, ...captions]) {
      expect(line, line).not.toContain("!");
      expect(line, line).not.toContain("...");
      expect(line, line).not.toMatch(/\p{Emoji_Presentation}/u);
      expect(line, line).not.toMatch(/(^|[^\p{L}'’])I(?=$|[^\p{L}'’])/u);
    }
  });

  it("speak of the person as they and them, never as he or she", () => {
    for (const line of [...sentences, ...captions]) expect(line, line).not.toMatch(/\b(he|she|him|his|her|hers)\b/i);
  });
});
