// The capsule's result cards' words that are made from values: what a filing says of itself and of its pages, and the two Stopped
// cards, which name the evening review only while the library's runs. Also the taken-shortcut notice's second sentence, which says
// where the action's item is. The rest of their words are main's (a saved thought's note) or fixed, and are written where they are shown.
import { inMenuLine } from "../../main/shortcuts.ts";
import type { FiledPage, Shortcuts } from "../../shared/ipc.ts";
import { shortened } from "../../shared/clip.ts";
import { reviewDoes, stoppedLine } from "../../shared/problems.ts";

// What a Stopped filing's card says is shared with the main process, which tells the same in a notification when the card is gone.
export { stoppedLine };

/** The bar's line once a filing ends well: who filed it, in whole seconds, and never "0 s": a filing that took no time took one. */
export function filedLine(agent: string, seconds: number): string {
  return `Filed by ${agent} in ${Number.isFinite(seconds) ? Math.max(1, Math.round(seconds)) : 1} s`;
}

/** The footer of a filing that wrote no page: the agent only logged the capture. */
export function notedLine(agent: string): string {
  return `${agent} noted it in the log.`;
}

/** How many pages the filed card lists, at most: the rest are counted (`moreLine`). */
export const SHOWN_PAGES = 3;

/**
 * The most a page's title may take across in its link, in cells (`titleCells`): 32 Latin letters of the link's face, about 215 px. A
 * row is about 380 px wide beside the card's Undo and Open, which leaves the title that much beside most chips and badges; beside the
 * widest chip and "updated" it has about 200 px, and there the link ends the title in "…" where its room ends (`truncate` in pages.tsx).
 */
export const TITLE_CELLS = 32;

/**
 * The East Asian wide and fullwidth characters, which a proportional font draws about as wide as two Latin letters: the code points
 * (first, last) that Unicode's East Asian Width gives as wide or fullwidth, by width and not by script (the prolonged sound mark is
 * script-less, and as wide as any kana). The half-width forms (U+FF61 to U+FFDC) are narrow, and so are the Latin letters, the
 * Cyrillic and the rest of the scripts that are drawn as one. Emoji are wide too (`EMOJI`).
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK and Kangxi radicals, CJK punctuation, the ideographic space
  [0x3041, 0xa4cf], // kana, Bopomofo, Hangul compatibility Jamo, enclosed and compatibility forms, the CJK ideographs, Yi
  [0xa960, 0xa97f], // Hangul Jamo, extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff01, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1b000, 0x1b2ff], // kana supplement and extended, Nushu
  [0x20000, 0x3fffd], // the CJK ideographs of the planes after the first
];

/** A character drawn as an emoji, which is about as wide as two Latin letters too. */
const EMOJI = /^\p{Emoji_Presentation}$/u;

/** How wide `text` is, in cells: one for each character, and two for a wide one. */
export function titleCells(text: string): number {
  let cells = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    cells += WIDE_RANGES.some(([first, last]) => code >= first && code <= last) || EMOJI.test(char) ? 2 : 1;
  }
  return cells;
}

/**
 * A page's title as its link shows it: one wider than 32 cells is cut, after a word where there is a fit one (`shortened`), and ends
 * in "…", so the link, which never wraps its words and centres a label that is too wide for it, stays in its column. A wide
 * character is two cells, so a Japanese title is cut at about 15 characters, where a Latin one is cut at about 32. Characters are
 * code points, so none is cut in half.
 */
export function shortTitle(title: string): string {
  const chars = Array.from(title);
  const cells = chars.map((char) => titleCells(char));
  if (cells.reduce((all, one) => all + one, 0) <= TITLE_CELLS) return title;
  // As many characters as fit beside the ellipsis, which takes one cell.
  let fit = 0;
  let used = 0;
  while (fit < chars.length && used + (cells[fit] ?? 1) <= TITLE_CELLS - 1) used += cells[fit++] ?? 1;
  // `shortened` keeps `max - 1` characters and the ellipsis; one fewer than the title has, so that it always cuts.
  return shortened(title, Math.min(fit + 1, chars.length - 1));
}

/** What a page's row says of it: a page the filing made is "new", and any other, or one whose state doesn't say, "updated". */
export function pageCaption(page: Pick<FiledPage, "created">): string {
  return page.created === true ? "new" : "updated";
}

/** The count of the pages the card doesn't list: "and 2 more". */
export function moreLine(hidden: number): string {
  return `and ${hidden} more`;
}

/**
 * The footer of a Stopped transcription, whose recording waits in the inbox: where it is, then that the evening review turns it into
 * words and files it, when. While the review is off, where it is alone.
 */
export function recordedLine(review: string | null): string {
  const later = reviewDoes("The evening review turns it into words and files it", review);
  return later === null ? "It's in the inbox." : `It's in the inbox. ${later}`;
}

/** The taken-shortcut notice's body: pick another shortcut, and where the action's item is (`inMenuLine`, which Settings → General says too). */
export function stillInMenuLine(key: keyof Shortcuts): string {
  return `Pick another shortcut. ${inMenuLine(key)}`;
}
