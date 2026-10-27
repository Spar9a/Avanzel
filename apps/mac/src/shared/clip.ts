// How a line of text becomes a line a card shows: a sentence (`ownLine`), and cut to the room the card has (`shortened`,
// `shortenedKeepingPaths`, `shortReason`). The problems' words (problems.ts), the main process and the windows share them. A page's
// title, which a link shows, is cut by its width instead (the capsule's `shortTitle`, which `shortened` serves).

/**
 * A line an agent printed, as a sentence: without the "Error:" label many CLIs put first, with a capital, and with a
 * full stop unless it ends a sentence already. Nothing stays nothing.
 */
export function ownLine(detail: string): string {
  const line = detail.trim().replace(/^error\s*:\s*/i, "");
  if (!line) return "";
  const sentence = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * `text` as a line of at most `max` characters (code points, so none is cut in half): whole when it fits, else cut after a word
 * that ends in the last 40% of what fits, or at the character when there is none, and ended with "…" with no space or stop
 * before it. Whole when `max` is not given. It knows nothing of paths: `shortenedKeepingPaths` is for a message that names some.
 */
export function shortened(text: string, max: number | undefined): string {
  if (max === undefined) return text;
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, Math.max(0, max - 1));
  const space = head.lastIndexOf(" ");
  const kept = space >= max * 0.6 ? head.slice(0, space) : head;
  return `${kept.join("").replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/** The quotes a path is put in: Node quotes the paths in its errors, and a shell does as well. */
const QUOTES = new Set(["'", '"', "`"]);

/**
 * The index of the first word of `words` that opens a quote that none of them closes, or -1. A word opens a quote when it starts
 * with one that the rest of the word doesn't close, and a later word closes it when it has that quote in it: what is between may
 * hold spaces, as a path does ('/Users/ana/My Notes/…').
 */
function openQuote(words: readonly string[]): number {
  let open = -1;
  let quote = "";
  words.forEach((word, i) => {
    if (open < 0) {
      const first = word.charAt(0);
      if (QUOTES.has(first) && !word.slice(1).includes(first)) {
        open = i;
        quote = first;
      }
    } else if (word.includes(quote)) {
      open = -1;
    }
  });
  return open;
}

/**
 * `text`, which may name paths (an error's message does, long and more than once), as a line of at most `max` characters: whole when
 * it fits, or when `max` is not given. A longer one is cut after the last whole word that fits, with its white space as it was
 * written and no space or stop before the "…"; but never through a path. A word with a slash in it is kept whole or left out, and so
 * is a quoted span, which Node puts a path in and which may hold spaces: a quote that the kept words open and don't close is the start
 * of a path, and the cut falls before it. When the cut falls before a path, the word that led up to it ("rename", "to") goes too, so
 * that the line doesn't end on a word that points at nothing. A line that begins with a path longer than the room, and a first word
 * longer than the room, are cut as `shortened` cuts: there is nothing before them to keep.
 */
export function shortenedKeepingPaths(text: string, max: number | undefined): string {
  if (max === undefined || Array.from(text).length <= max) return text;
  const words = Array.from(text.matchAll(/\S+/gu), (match) => ({ text: match[0], end: (match.index ?? 0) + match[0].length }));
  // As many whole words as fit beside the ellipsis.
  let fit = 0;
  while (fit < words.length && Array.from(text.slice(0, words[fit]?.end)).length <= max - 1) fit++;
  if (fit === words.length) return text.slice(0, words[fit - 1]?.end ?? 0); // only trailing white space made it long
  const opens = openQuote(words.slice(0, fit).map((word) => word.text));
  let cut = opens >= 0 ? opens : fit;
  if (cut === 0) return shortened(text, max);
  const beforePath = opens >= 0 || /\//.test(words[fit]?.text ?? "");
  if (beforePath && cut > 1 && /^[a-z]+,?$/.test(words[cut - 1]?.text ?? "")) cut--;
  return `${text.slice(0, words[cut - 1]?.end).replace(/[\s,;:.–—>-]+$/u, "")}…`;
}

/**
 * What an error says (Node's, the speech engine's), as a sentence (`ownLine`) of at most `max` characters for a card that clips,
 * cut as `shortenedKeepingPaths` cuts it. Whole when it fits, or when `max` is not given.
 */
export function shortReason(reason: string, max?: number): string {
  return shortenedKeepingPaths(ownLine(reason), max);
}
