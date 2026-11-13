import { describe, expect, it } from "vitest";
import {
  AGENT_SHELF_ASK,
  agentShelfLine,
  agentShelfTitle,
  EDIT_FIRST,
  filedLine,
  MAKE_SHELF,
  moreLine,
  notedLine,
  NOT_NOW,
  pageCaption,
  recordedLine,
  SAY_NO,
  shelfAskLine,
  shelfMadeLine,
  SHOWN_PAGES,
  shortTitle,
  stillInMenuLine,
  stoppedLine,
  TITLE_CELLS,
  titleCells,
} from "../src/renderer/capsule/copy.ts";
import { shelfMakesLine, shelfQuestion } from "../src/renderer/panel/copy.ts";
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

  it("shows a title that is up to 32 characters wide whole, and a longer one cut after a word, with the one-character ellipsis", () => {
    expect(TITLE_CELLS).toBe(32);
    expect(shortTitle("Tulips for October")).toBe("Tulips for October");
    const whole = "x".repeat(TITLE_CELLS);
    expect(shortTitle(whole)).toBe(whole);
    expect(shortTitle("An idea page whose title goes on and on about indie game development")).toBe("An idea page whose title goes…");
    expect(shortTitle("Plan for the Q4 launch of the podcast")).toBe("Plan for the Q4 launch of the…");
  });

  it("cuts a title with no word to cut after at the character, and never to more than 32 characters wide", () => {
    expect(shortTitle(`${"x".repeat(TITLE_CELLS)}y`)).toBe(`${"x".repeat(TITLE_CELLS - 1)}…`);
    for (const title of ["An idea page whose title goes on and on about indie game development", "x".repeat(80), "ab cd ".repeat(20)]) {
      expect(titleCells(shortTitle(title)), title).toBeLessThanOrEqual(TITLE_CELLS);
    }
  });

  it("cuts a title by characters, never through one that takes two code units", () => {
    const clef = "\u{1D11E}"; // one narrow character, two UTF-16 code units
    expect(shortTitle(clef.repeat(TITLE_CELLS + 1))).toBe(`${clef.repeat(TITLE_CELLS - 1)}…`);
    expect(shortTitle(clef.repeat(TITLE_CELLS))).toBe(clef.repeat(TITLE_CELLS));
  });

  it("counts a wide character as two, as East Asian text is drawn: 16 of them fit, and a longer title is cut to 31 cells and the ellipsis", () => {
    // Kana and the prolonged sound mark, a Han character and one of the planes after the first, a Hangul syllable and a compatibility Jamo,
    // a fullwidth Latin letter and a fullwidth sign, CJK punctuation, and an emoji.
    for (const wide of ["あ", "ア", "ー", "日", "𠮷", "한", "ㄱ", "Ａ", "￥", "、", "。", "😀"]) {
      expect(titleCells(wide), wide).toBe(2);
      expect(shortTitle(wide.repeat(16)), wide).toBe(wide.repeat(16)); // 32 cells
      expect(shortTitle(wide.repeat(17)), wide).toBe(`${wide.repeat(15)}…`); // 30 cells and the ellipsis
    }
  });

  it("counts a narrow character as one: the Latin letters, a half-width katakana, and a letter with an accent", () => {
    for (const narrow of ["a", "Z", "é", "ｱ", "ﾊ", "｡", "-", " ", "·"]) expect(titleCells(narrow), narrow).toBe(1);
    expect(shortTitle("ｱ".repeat(TITLE_CELLS))).toBe("ｱ".repeat(TITLE_CELLS));
  });

  it("cuts a Japanese title where the line ends, not after 32 characters, which would be twice as wide as the column", () => {
    // 25 characters: 50 cells, about 325 px in the card's link, in a column of about 250 px.
    const title = "日本語のとても長いページのタイトルがここに入ります";
    expect(Array.from(title)).toHaveLength(25);
    expect(shortTitle(title)).toBe(`${Array.from(title).slice(0, 15).join("")}…`);
    expect(titleCells(shortTitle(title))).toBeLessThanOrEqual(TITLE_CELLS);
    // A mixed title counts each character for what it is, and keeps a word whole where it can.
    expect(shortTitle("Meeting notes 日本語のミーティングのメモ")).toBe("Meeting notes 日本語のミーティ…");
    expect(titleCells(shortTitle("Meeting notes 日本語のミーティングのメモ"))).toBeLessThanOrEqual(TITLE_CELLS);
  });

  it("never cuts a title to more than its cells, whatever it is made of", () => {
    const mixes = ["日本語 and English together in one page title", "😀😀😀 party plans for the whole year", "한국어로 쓴 아주 긴 페이지 제목입니다", "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴ", "ab".repeat(40)];
    for (const title of mixes) expect(titleCells(shortTitle(title)), title).toBeLessThanOrEqual(TITLE_CELLS);
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
    expect(stoppedLine("Claude Code", false, 0, "at 21:00")).toBe(`${cancelledLine("Claude Code", false, 0)} The evening review files your words at 21:00.`);
    expect(stoppedLine("Claude Code", true, 0, "at 21:00")).toBe(`${cancelledLine("Claude Code", true, 0)} The evening review files your words at 21:00.`);
    expect(stoppedLine("Claude Code", false, 2, "at 21:00")).toBe(`${cancelledLine("Claude Code", false, 2)} The evening review files your words at 21:00.`);
  });

  it("words a weekly review as the review does, never as tonight", () => {
    expect(stoppedLine("Codex", false, 0, "on Sundays at 18:00")).toBe(
      "Your words are back in the inbox, untouched, and nothing else changed. The evening review files your words on Sundays at 18:00.",
    );
    for (const review of REVIEWS) expect(stoppedLine("Codex", false, 0, review)).not.toMatch(/tonight/i);
  });

  it("names no time for a review whose schedule can't be read", () => {
    expect(stoppedLine("Claude Code", false, 0, "")).toBe(`${cancelledLine("Claude Code", false, 0)} The evening review files your words.`);
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
    expect(recordedLine("at 21:00")).toBe("It's in the inbox. The evening review turns it into words and files it at 21:00.");
    expect(recordedLine("on Sundays at 18:00")).toBe("It's in the inbox. The evening review turns it into words and files it on Sundays at 18:00.");
  });

  it("names no time for a review whose schedule can't be read", () => {
    expect(recordedLine("")).toBe("It's in the inbox. The evening review turns it into words and files it.");
  });

  it("says only where the recording is while the review is off, which promises it nothing", () => {
    expect(recordedLine(null)).toBe("It's in the inbox.");
  });
});

describe("stillInMenuLine: the taken notice's second sentence", () => {
  it("names where each item is", () => {
    expect(stillInMenuLine("dictate")).toBe("Pick another shortcut. “Record a thought” is still in the menu bar.");
    expect(stillInMenuLine("capture")).toBe("Pick another shortcut. “Capture screen” is still in the menu bar.");
    expect(stillInMenuLine("type")).toBe("Pick another shortcut. “Type a thought” is still in the menu bar.");
    expect(stillInMenuLine("ask")).toBe("Pick another shortcut. “Ask your library” is still in the menu bar.");
    // Undo the last filing is in the menu only after a filing, so it is not "still" there.
    expect(stillInMenuLine("undo")).toBe("Pick another shortcut. “Undo the last filing” is in the menu bar after each filing.");
  });
});

describe("the shelf question: on the filed card, in Library, and the bar once Make shelf is done", () => {
  it("asks on the card with the suggested shelf's name, the definition going under it", () => {
    expect(shelfAskLine("Projects")).toBe("This might belong on a new shelf: Projects");
    expect(shelfAskLine("Reading list")).toBe("This might belong on a new shelf: Reading list");
  });

  it("says when the agent started a folder of its own, by the folder's name, and what the person can do", () => {
    expect(agentShelfLine("projects")).toBe("The agent started a shelf called projects. Say what belongs on it, or turn it down.");
    // Library's Notice says the same: the first sentence its title, the second its body.
    expect(agentShelfTitle("projects")).toBe("The agent started a shelf called projects.");
    expect(AGENT_SHELF_ASK).toBe("Say what belongs on it, or turn it down.");
  });

  it("asks in Library with the shelf's name, whatever sound it starts with", () => {
    expect(shelfQuestion("Projects")).toBe("Make a shelf called Projects?");
    for (const name of ["Errands", "Users", "University", "One-offs"]) expect(shelfQuestion(name)).toBe(`Make a shelf called ${name}?`);
    expect(agentShelfTitle("one-offs")).toBe("The agent started a shelf called one-offs.");
  });

  it("says in Library what Make shelf does, for one page or more, and that Undo takes it back", () => {
    expect(shelfMakesLine(1)).toBe("Making it moves the suggested page onto it, and Undo takes it back.");
    expect(shelfMakesLine(3)).toBe("Making it moves the suggested pages onto it, and Undo takes them back.");
  });

  it("names its buttons with verbs, in sentence case", () => {
    expect([MAKE_SHELF, NOT_NOW, EDIT_FIRST, SAY_NO]).toEqual(["Make shelf", "Not now", "Edit first", "No"]);
  });

  it("tells what Make shelf did in the bar in one line, in one page or many", () => {
    expect(shelfMadeLine("Projects", 1)).toBe("Made the Projects shelf and moved 1 page.");
    expect(shelfMadeLine("Projects", 3)).toBe("Made the Projects shelf and moved 3 pages.");
    expect(shelfMadeLine("Projects", 0)).toBe("Made the Projects shelf and moved no pages.");
  });
});

describe("the result cards' words are written as the design rules ask", () => {
  /** The lines that are sentences. */
  const sentences = [
    filedLine("Claude Code", 6),
    notedLine("Claude Code"),
    ...REVIEWS.flatMap((review) => [stoppedLine("Claude Code", false, 0, review), stoppedLine("Claude Code", true, 0, review), recordedLine(review)]),
    stillInMenuLine("ask"),
    stillInMenuLine("undo"),
    shelfAskLine("Projects"),
    agentShelfLine("projects"),
    agentShelfTitle("projects"),
    AGENT_SHELF_ASK,
    shelfQuestion("Projects"),
    shelfMakesLine(1),
    shelfMakesLine(2),
    shelfMadeLine("Projects", 2),
    MAKE_SHELF,
    NOT_NOW,
    EDIT_FIRST,
    SAY_NO,
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
