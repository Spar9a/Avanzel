// The voice trigger's word, found in what was heard: the words as speech-to-text writes them, which spells a name it doesn't know a
// little differently from time to time ("Avanzel", "Avanzell", "Avansel"). Plain TypeScript, for main and its tests.

/** `text` as words: lower case, letters and digits of any script, everything else a space. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents off: "é" is "e"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** How many single-letter edits turn `a` into `b`. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length]!;
}

/** How many edits a word of `length` letters may be off by and still be the trigger's: none for a short one, one in five for a long one. */
const slack = (length: number) => (length < 4 ? 0 : Math.floor(length / 5));

/**
 * Whether `heard` says the trigger `word` (a word, or a few): its words, one after another, somewhere in what was heard, each spelled
 * as the trigger's is or nearly (`slack`). An empty trigger is never heard.
 */
export function heardTrigger(heard: string, word: string): boolean {
  const wanted = wordsOf(word);
  const words = wordsOf(heard);
  if (wanted.length === 0) return false;
  for (let start = 0; start + wanted.length <= words.length; start++) {
    if (wanted.every((each, k) => distance(words[start + k]!, each) <= slack(each.length))) return true;
  }
  return false;
}

/** How many words may follow the stop word and still be its, cut with it: a "thanks" or "okay" said after it. */
const AFTER_STOP = 2;

/**
 * `text` without the stop `word` said at its end, and the few words after it (`AFTER_STOP`), as the recording it stopped heard it:
 * the stop word isn't part of the thought. The last place it is said counts; said earlier on, or not found, `text` stays as it is.
 */
export function withoutStopWord(text: string, word: string): string {
  const wanted = wordsOf(word);
  if (wanted.length === 0) return text;
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ at: match.index, word: wordsOf(match[0]).join("") }));
  for (let start = tokens.length - wanted.length; start >= 0 && tokens.length - start - wanted.length <= AFTER_STOP; start--) {
    if (wanted.every((each, k) => distance(tokens[start + k]!.word, each) <= slack(each.length))) {
      return text.slice(0, tokens[start]!.at).replace(/[\s,;:—–-]+$/u, "").trim();
    }
  }
  return text;
}
