// The capsule's result cards' words that are made from values: what a filing says of itself and of its pages, and the two Stopped
// cards, which name the evening review only while the library's runs. The rest of their words are main's (a saved thought's
// note) or fixed, and are written where they are shown.
import type { FiledPage } from "../../shared/ipc.ts";
import { shortened } from "../../shared/problems.ts";
import { cancelledLine } from "../setup/copy.ts";

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

/** The most characters of a page's title its link shows: a row is 396 px wide, and the widest chip and caption leave about 250 px. */
export const TITLE_CHARS = 32;

/**
 * A page's title as its link shows it: one longer than 32 characters is cut, after a word where there is a fit one (`shortened`),
 * and ends in "…", so the link, which never wraps its words, stays in its column. Characters are code points, so none is cut in half.
 */
export function shortTitle(title: string): string {
  return shortened(title, TITLE_CHARS);
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
 * `what`, a sentence without its end, with when the evening review does it (`review`, as `reviewTime` words it: "at 21:00", "on
 * Sundays at 18:00"), then a full stop. A review whose schedule can't be read ("") is named without a time. Null while the review is
 * off: nothing will do it, so no sentence promises it.
 */
function reviewDoes(what: string, review: string | null): string | null {
  if (review === null) return null;
  return review === "" ? `${what}.` : `${what} ${review}.`;
}

/**
 * The footer of a Stopped filing: what became of the words and of the run's edits (setup's `cancelledLine`, which setup says of
 * the same ending), then when the evening review files the note. While the review is off, the first alone.
 */
export function stoppedLine(agent: string, partial: boolean, leftovers: number, review: string | null): string {
  const kept = cancelledLine(agent, partial, leftovers);
  const later = reviewDoes("The evening review files it", review);
  return later === null ? kept : `${kept} ${later}`;
}

/**
 * The footer of a Stopped transcription, whose recording waits in the inbox: where it is, then that the evening review turns it into
 * words and files it, when. While the review is off, where it is alone.
 */
export function recordedLine(review: string | null): string {
  const later = reviewDoes("The evening review turns it into words and files it", review);
  return later === null ? "It's in your inbox." : `It's in your inbox. ${later}`;
}
