// The personal dictionary: names and terms the owner spells one way, corrected in what the speech model heard.
// "Heard as" aliases are the sure path. The sound-alike match is deliberately cautious: a miss is cheap, a wrong rewrite is not.

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

/** One line per entry: "Term" or "Term = heard one, heard two". Repeated terms merge. */
export function parseDictionary(lines: readonly string[]): DictionaryEntry[] {
  const byTerm = new Map<string, DictionaryEntry>();
  const seen = new Map<string, Set<string>>();
  for (const line of lines) {
    const split = line.indexOf("=");
    const term = (split < 0 ? line : line.slice(0, split)).trim();
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
      const alias = raw.trim();
      const folded = alias.toLowerCase();
      if (alias === "" || known.has(folded)) continue;
      known.add(folded);
      entry.heardAs.push(alias);
    }
  }
  return [...byTerm.values()];
}

export function applyDictionary(
  text: string,
  entries: readonly DictionaryEntry[],
  opts: DictionaryOptions = {},
): DictionaryResult {
  if (text === "" || entries.length === 0) return { text, changed: false };
  const aliased = applyAliases(text, entries);
  const result = opts.soundAlike === false
    ? aliased.text
    : applySoundAlike(aliased.text, entries, aliased.spans, opts.similarity ?? DEFAULT_SIMILARITY);
  return { text: result, changed: result !== text };
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

/** One pass over the text, so one entry's output is never read as another's alias. */
function applyAliases(text: string, entries: readonly DictionaryEntry[]): { text: string; spans: Span[] } {
  const termOf = new Map<string, string>();
  for (const entry of entries) {
    for (const alias of entry.heardAs) {
      const folded = foldAlias(alias.trim());
      if (folded !== "" && !termOf.has(folded)) termOf.set(folded, entry.term);
    }
  }
  if (termOf.size === 0) return { text, spans: [] };
  const aliases = [...termOf.keys()].sort((a, b) => b.length - a.length);
  const body = aliases.map((alias) => escapeRegExp(alias).replace(/ /g, "\\s+")).join("|");
  const pattern = new RegExp(`${WORD_EDGE_BEFORE}(?:${body})${WORD_EDGE_AFTER}`, "giu");

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

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost));
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

interface Candidate {
  term: string;
  key: string;
  minWords: number;
  maxWords: number;
  order: number;
}

interface Match {
  start: number;
  end: number;
  term: string;
  score: number;
  order: number;
}

function candidatesOf(entries: readonly DictionaryEntry[]): Map<string, Candidate[]> {
  const byFirst = new Map<string, Candidate[]>();
  const seen = new Set<string>();
  entries.forEach((entry, order) => {
    const term = entry.term.trim();
    if (term === "" || seen.has(term)) return;
    seen.add(term);
    if (/\p{L}/u.test(term.replace(/[A-Za-z]/g, ""))) return;
    if (term.toLowerCase().replace(/[^a-z]/g, "").length < MIN_TERM_LETTERS) return;
    const key = soundKey(term);
    if (key === "") return;
    const words = term.split(/\s+/).length;
    const list = byFirst.get(key[0] as string) ?? [];
    list.push({ term, key, minWords: Math.max(1, words - 1), maxWords: words + 2, order });
    byFirst.set(key[0] as string, list);
  });
  return byFirst;
}

function applySoundAlike(text: string, entries: readonly DictionaryEntry[], locked: readonly Span[], similarity: number): string {
  const candidates = candidatesOf(entries);
  if (candidates.size === 0) return text;

  const words: Word[] = [...text.matchAll(/[\p{L}\p{N}']+/gu)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  const lower = words.map((w) => w.text.toLowerCase());
  const unusable = words.map(
    (w) => !/^[A-Za-z0-9']+$/.test(w.text) || locked.some(([from, to]) => w.start < to && w.end > from),
  );
  const unusableBefore = [0];
  for (const bad of unusable) unusableBefore.push((unusableBefore[unusableBefore.length - 1] as number) + (bad ? 1 : 0));

  let longest = 0;
  for (const list of candidates.values()) for (const c of list) longest = Math.max(longest, c.maxWords);

  const best = new Map<string, Match>();
  for (let n = 1; n <= longest; n++) {
    for (let s = 0; s + n <= words.length; s++) {
      if ((unusableBefore[s + n] as number) - (unusableBefore[s] as number) > 0) continue;
      const first = lower[s] as string;
      const lastWord = lower[s + n - 1] as string;
      if (STOP.has(first) || STOP.has(lastWord)) continue;
      const key = soundKey(lower.slice(s, s + n).join(""));
      if (key === "") continue;
      const pool = candidates.get(key[0] as string);
      if (!pool) continue;
      for (const c of pool) {
        if (n < c.minWords || n > c.maxWords) continue;
        const longer = Math.max(key.length, c.key.length);
        if (Math.abs(key.length - c.key.length) / longer > 1 - similarity + 1e-9) continue;
        const distance = levenshtein(key, c.key);
        if (c.key.length <= SHORT_KEY && distance > 1) continue;
        const score = 1 - distance / longer;
        if (score < similarity) continue;
        const id = `${s}:${s + n}`;
        const current = best.get(id);
        if (!current || score > current.score) best.set(id, { start: s, end: s + n, term: c.term, score, order: c.order });
      }
    }
  }

  const ranked = [...best.values()].sort(
    (a, b) => b.score - a.score || a.end - a.start - (b.end - b.start) || a.order - b.order || a.start - b.start,
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
    if (text.slice(from, to) !== match.term) out = out.slice(0, from) + match.term + out.slice(to);
  }
  return out;
}
