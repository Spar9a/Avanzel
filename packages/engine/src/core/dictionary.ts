// The personal dictionary: names and terms the owner spells one way, corrected in what the speech model heard.
// "Heard as" aliases are the sure path. The sound-alike match is deliberately cautious: a miss is cheap, a wrong rewrite is not.
// A window of words may become a term only when it sounds like it, is spelt something like it, and stands inside one line
// with nothing but spaces between its words. Known limit: an ordinary word that is both spelt and sounds close to a
// term ("election" for "Electron") is still rewritten; the owner can add the term's spelling to their own words list.
// A window spelt, letter for letter, as any listed term is that term and never becomes another that sounds the same
// (Katherine and Catherine both listed keep their spellings).
// A term the speech model splits across two call segments is not corrected, each segment being corrected alone.
// A term and each alias are one plain line: runs of whitespace and control characters become one space, so a line
// from a hand-edited config can never carry a newline into a prompt.

export interface DictionaryEntry {
  term: string;
  heardAs: string[];
}

export interface DictionaryResult {
  text: string;
  changed: boolean;
}

export interface DictionaryOptions {
  soundAlike?: boolean;
  similarity?: number;
}

export const MAX_DICTIONARY_ENTRIES = 500;
const DEFAULT_SIMILARITY = 0.85;
const MIN_TERM_LETTERS = 4;
const SHORT_KEY = 5;
const MIN_KEY = 4;
const MIN_LETTER_SIMILARITY = 0.6;

/** `value` as one plain line: every run of whitespace and control characters (newline, tab, DEL, ...) is one space; trimmed. */
export function plainLine(value: string): string {
  return value.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

/** One line per entry: "Term" or "Term = heard one, heard two". Repeated terms merge. */
export function parseDictionary(lines: readonly string[]): DictionaryEntry[] {
  const byTerm = new Map<string, DictionaryEntry>();
  const seen = new Map<string, Set<string>>();
  for (const line of lines) {
    const split = line.indexOf("=");
    const term = plainLine(split < 0 ? line : line.slice(0, split));
    if (term === "") continue;
    let entry = byTerm.get(term);
    if (!entry) {
      if (byTerm.size >= MAX_DICTIONARY_ENTRIES) continue;
      entry = { term, heardAs: [] };
      byTerm.set(term, entry);
      seen.set(term, new Set());
    }
    const known = seen.get(term) as Set<string>;
    if (split < 0) continue;
    for (const raw of line.slice(split + 1).split(",")) {
      const alias = plainLine(raw);
      const folded = alias.toLowerCase();
      if (alias === "" || known.has(folded)) continue;
      known.add(folded);
      entry.heardAs.push(alias);
    }
  }
  return [...byTerm.values()];
}

/** `text` corrected by `entries`. To correct many texts with one dictionary, compile it once (`compileDictionary`). */
export function applyDictionary(
  text: string,
  entries: readonly DictionaryEntry[],
  opts: DictionaryOptions = {},
): DictionaryResult {
  return compileDictionary(entries, opts)(text);
}

/**
 * `entries` made ready once (the aliases' pattern, the sound-alike candidates and the listed spellings), as a function that
 * corrects a text as `applyDictionary` does. For a long call's thousands of segments, or every transcript of a transcriber.
 */
export function compileDictionary(
  entries: readonly DictionaryEntry[],
  opts: DictionaryOptions = {},
): (text: string) => DictionaryResult {
  if (entries.length === 0) return (text) => ({ text, changed: false });
  const aliases = compileAliases(entries);
  const sound = opts.soundAlike === false ? null : compileSoundAlike(entries, opts.similarity ?? DEFAULT_SIMILARITY);
  return (text) => {
    if (text === "") return { text, changed: false };
    const aliased = aliases ? applyAliases(text, aliases) : { text, spans: [] };
    const result = sound ? applySoundAlike(aliased.text, sound, aliased.spans) : aliased.text;
    return { text: result, changed: result !== text };
  };
}

const WORD_EDGE_BEFORE = "(?<![\\p{L}\\p{N}_])";
const WORD_EDGE_AFTER = "(?![\\p{L}\\p{N}_])";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function foldAlias(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}

type Span = readonly [start: number, end: number];

interface Aliases {
  termOf: Map<string, string>;
  pattern: RegExp;
}

/** Every alias in one pattern, longest first; an alias's words match across spaces and tabs only, never a line break. */
function compileAliases(entries: readonly DictionaryEntry[]): Aliases | null {
  const termOf = new Map<string, string>();
  for (const entry of entries) {
    for (const alias of entry.heardAs) {
      const folded = foldAlias(alias.trim());
      if (folded !== "" && !termOf.has(folded)) termOf.set(folded, entry.term);
    }
  }
  if (termOf.size === 0) return null;
  const aliases = [...termOf.keys()].sort((a, b) => b.length - a.length);
  const body = aliases.map((alias) => escapeRegExp(alias).replace(/ /g, "[ \\t]+")).join("|");
  return { termOf, pattern: new RegExp(`${WORD_EDGE_BEFORE}(?:${body})${WORD_EDGE_AFTER}`, "giu") };
}

/** One pass over the text, so one entry's output is never read as another's alias. */
function applyAliases(text: string, { termOf, pattern }: Aliases): { text: string; spans: Span[] } {
  const spans: Span[] = [];
  let out = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const replacement = termOf.get(foldAlias(match[0])) ?? match[0];
    out += text.slice(last, match.index) + replacement;
    spans.push([out.length - replacement.length, out.length]);
    last = match.index + match[0].length;
  }
  out += text.slice(last);
  return { text: out, spans };
}

const STOP = new Set(
  ("a an the and or but of to in on at for from with by as is are was were be been it its i you he she we they me my your our their " +
    "this that these those do does did have has had not no so if then than there here what who when where how which can could will " +
    "would should shall may might must just very also too up out about into over after before more most some any all each one two").split(" "),
);

const KEY_RULES: readonly (readonly [string, string])[] = [
  ["ph", "f"], ["ck", "k"], ["ch", "k"], ["kn", "n"], ["wr", "r"], ["gh", ""], ["sh", "x"], ["th", "t"],
  ["qu", "kv"], ["x", "ks"], ["q", "k"], ["w", "v"], ["z", "s"], ["y", "i"], ["ce", "se"], ["ci", "si"],
  ["cy", "si"], ["c", "k"], ["h", ""],
];

/** A rough sound of a word: the first letter, then consonants with vowel runs squashed. No voicing merges. */
function soundKey(value: string): string {
  let s = value.toLowerCase().replace(/[^a-z]/g, "");
  for (const [from, to] of KEY_RULES) s = s.replaceAll(from, to);
  s = s.replace(/(.)\1+/g, "$1");
  return s.slice(0, 1) + s.slice(1).replace(/[aeiou]+/g, "a");
}

const ROW_SIZE = 256;
let rowA = new Int32Array(ROW_SIZE);
let rowB = new Int32Array(ROW_SIZE);

/** True when two different strings of near length are one edit apart: trim what they share at both ends and see what is left. */
function withinOneEdit(a: string, b: string): boolean {
  const shortest = Math.min(a.length, b.length);
  let start = 0;
  while (start < shortest && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a.charCodeAt(endA) === b.charCodeAt(endB)) {
    endA--;
    endB--;
  }
  return Math.max(endA - start + 1, endB - start + 1) <= 1;
}

/** The edit distance, or `limit + 1` as soon as it is certain to exceed `limit`. Only the band around the diagonal is filled. */
function levenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (limit < 2) return withinOneEdit(a, b) ? 1 : limit + 1;
  if (b.length + 1 > rowA.length) {
    rowA = new Int32Array(b.length + 1);
    rowB = new Int32Array(b.length + 1);
  }
  const over = limit + 1;
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j > limit ? over : j;
  for (let i = 1; i <= a.length; i++) {
    const from = Math.max(1, i - limit);
    const to = Math.min(b.length, i + limit);
    cur[from - 1] = from === 1 ? i : over;
    if (to < b.length) cur[to + 1] = over;
    let rowMin = from === 1 ? i : over;
    const ca = a.charCodeAt(i - 1);
    for (let j = from; j <= to; j++) {
      const substitute = (prev[j - 1] as number) + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const insert = (cur[j - 1] as number) + 1;
      const remove = (prev[j] as number) + 1;
      let value = substitute < insert ? substitute : insert;
      if (remove < value) value = remove;
      if (value > over) value = over;
      cur[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return over;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  const result = prev[b.length] as number;
  return result > limit ? over : result;
}

function lettersOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

interface Word {
  text: string;
  start: number;
  end: number;
}

interface Candidate {
  term: string;
  key: string;
  letters: string;
  minWords: number;
  maxWords: number;
  order: number;
}

interface Match {
  start: number;
  end: number;
  /** The spelling the window takes; null for a listed spelling the window keeps as it is. */
  term: string | null;
  score: number;
  order: number;
}

/** The score of a window spelt, letter for letter, as a listed term: above every sound-alike score. */
const EXACT = 2;

/** A listed term by its bare letters: a window spelt so is that term, and never becomes another. */
interface Spelling {
  term: string;
  /** Whether the window takes the term's own spelling (its case, its spaces): only for a term the sound-alike match uses. */
  respell: boolean;
  order: number;
}

interface SoundAlike {
  /** Candidates by the first sound of their key, then by the length of the key, so a window meets only terms that could be close. */
  candidates: Map<string, Candidate[][]>;
  spellings: Map<string, Spelling>;
  /** The most words a window may have. */
  longest: number;
  similarity: number;
}

function compileSoundAlike(entries: readonly DictionaryEntry[], similarity: number): SoundAlike | null {
  const candidates = new Map<string, Candidate[][]>();
  const spellings = new Map<string, Spelling>();
  const seen = new Set<string>();
  let longest = 0;
  entries.forEach((entry, order) => {
    const term = entry.term.trim();
    if (term === "" || seen.has(term)) return;
    seen.add(term);
    if (/\p{L}/u.test(term.replace(/[A-Za-z]/g, ""))) return;
    const letters = lettersOf(term);
    if (letters === "") return;
    const words = term.split(/\s+/).length;
    longest = Math.max(longest, words);
    const key = soundKey(term);
    const usable = letters.length >= MIN_TERM_LETTERS && key.length >= MIN_KEY;
    if (!spellings.has(letters)) spellings.set(letters, { term, respell: usable, order });
    if (!usable) return;
    const byLength = candidates.get(key[0] as string) ?? [];
    const list = byLength[key.length] ?? [];
    list.push({ term, key, letters, minWords: Math.max(1, words - 1), maxWords: words + 2, order });
    byLength[key.length] = list;
    candidates.set(key[0] as string, byLength);
    longest = Math.max(longest, words + 2);
  });
  // With no candidate, nothing can change: a listed spelling that no candidate is only keeps its window as it is.
  return candidates.size === 0 ? null : { candidates, spellings, longest, similarity };
}

function applySoundAlike(text: string, { candidates, spellings, longest, similarity }: SoundAlike, locked: readonly Span[]): string {

  const words: Word[] = [...text.matchAll(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu)].map((m) => {
    const possessive = /^(.*[\p{L}\p{N}])['\u2019][sS]$/u.exec(m[0]);
    const core = possessive?.[1] ?? m[0];
    return { text: core, start: m.index, end: m.index + core.length };
  });
  const lower = words.map((w) => w.text.toLowerCase());
  const unusable = words.map(
    (w) => !/^[A-Za-z0-9]+(?:['\u2019][A-Za-z0-9]+)*$/.test(w.text) || locked.some(([from, to]) => w.start < to && w.end > from),
  );
  const unusableBefore = [0];
  for (const bad of unusable) unusableBefore.push((unusableBefore[unusableBefore.length - 1] as number) + (bad ? 1 : 0));
  const breaksBefore = [0, 0];
  for (let i = 1; i < words.length; i++) {
    const gap = text.slice((words[i - 1] as Word).end, (words[i] as Word).start);
    breaksBefore.push((breaksBefore[i] as number) + (/^[ \t]+$/.test(gap) ? 0 : 1));
  }

  const best = new Map<string, Match>();
  for (let n = 1; n <= longest; n++) {
    for (let s = 0; s + n <= words.length; s++) {
      if ((unusableBefore[s + n] as number) - (unusableBefore[s] as number) > 0) continue;
      if ((breaksBefore[s + n] as number) - (breaksBefore[s + 1] as number) > 0) continue;
      const first = lower[s] as string;
      const lastWord = lower[s + n - 1] as string;
      const stopped = STOP.has(first) || STOP.has(lastWord);
      const joined = lower.slice(s, s + n).join("");
      const letters = lettersOf(joined);
      const id = `${s}:${s + n}`;
      // A window spelt as a listed term is that term: it keeps its letters, whatever else it sounds like.
      const spelt = spellings.get(letters);
      if (spelt) {
        best.set(id, { start: s, end: s + n, term: spelt.respell && !stopped ? spelt.term : null, score: EXACT, order: spelt.order });
        continue;
      }
      if (stopped) continue;
      const key = soundKey(joined);
      if (key.length < MIN_KEY) continue;
      const pool = candidates.get(key[0] as string);
      if (!pool) continue;
      const reach = similarity > 0 ? Math.floor((key.length * (1 - similarity)) / similarity + 1e-9) : pool.length;
      const nearest: Candidate[] = [];
      for (let len = Math.max(MIN_KEY, key.length - reach); len <= Math.min(pool.length - 1, key.length + reach); len++) {
        for (const c of pool[len] ?? []) nearest.push(c);
      }
      for (const c of nearest) {
        if (n < c.minWords || n > c.maxWords) continue;
        const longer = Math.max(key.length, c.key.length);
        let limit = Math.floor((1 - similarity) * longer + 1e-9);
        if (c.key.length <= SHORT_KEY) limit = Math.min(limit, 1);
        const distance = levenshtein(key, c.key, limit);
        if (distance > limit) continue;
        const score = 1 - distance / longer;
        if (score < similarity) continue;
        const spelling = Math.max(letters.length, c.letters.length);
        if (1 - levenshtein(letters, c.letters, spelling) / spelling < MIN_LETTER_SIMILARITY) continue;
        const current = best.get(id);
        if (!current || score > current.score || (score === current.score && c.order < current.order)) best.set(id, { start: s, end: s + n, term: c.term, score, order: c.order });
      }
    }
  }

  // Listed spellings first, the longest of them first; then the best sound, the narrowest window first.
  const width = (match: Match) => match.end - match.start;
  const ranked = [...best.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (a.score === EXACT ? width(b) - width(a) : width(a) - width(b)) ||
      a.order - b.order ||
      a.start - b.start,
  );
  const taken = new Set<number>();
  const chosen: Match[] = [];
  for (const match of ranked) {
    let free = true;
    for (let i = match.start; i < match.end; i++) if (taken.has(i)) free = false;
    if (!free) continue;
    for (let i = match.start; i < match.end; i++) taken.add(i);
    chosen.push(match);
  }

  let out = text;
  for (const match of chosen.sort((a, b) => b.start - a.start)) {
    const from = (words[match.start] as Word).start;
    const to = (words[match.end - 1] as Word).end;
    if (match.term !== null && text.slice(from, to) !== match.term) out = out.slice(0, from) + match.term + out.slice(to);
  }
  return out;
}
