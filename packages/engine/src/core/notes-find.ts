// Finding notes by text in a shelf of any depth, and reading what a note shows about itself: its headings, a few passages that
// mention the words searched for, and how new entries are dated and where they are added. Learning a library files with these.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleFiles } from "./changes.ts";
import { localDate } from "./dates.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { fold, pageMeta } from "./pages.ts";
import { folderKey } from "./shelves.ts";

const PASSAGES_PER_NOTE = 3;
const PASSAGE_CHARS = 300;
const OUTLINE_HEADINGS = 30;
const ENTRIES_SHOWN = 3;
const ENTRY_CHARS = 400;
/** A word shorter than this once stemmed would match inside almost every text, so a query leaves it out. */
const MIN_STEM = 3;

const SUFFIXES = [
  // Russian noun, adjective and verb endings
  "иями", "ями", "ами", "ией", "ием", "иях", "ого", "его", "ому", "ему", "ыми", "ими", "ость", "ости", "ение", "ения", "ений",
  "ать", "ять", "ить", "еть", "ала", "яла", "ила", "ала", "ов", "ев", "ей", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие",
  "ам", "ям", "ах", "ях", "ом", "ем", "ую", "юю", "ы", "и", "а", "я", "о", "е", "у", "ю", "ь",
  // English
  "ings", "ing", "edly", "ed", "es", "s", "ly",
].sort((a, b) => b.length - a.length);

/** A word brought to the part its forms share: folded, then without the longest ending that leaves at least three characters. */
export function stem(word: string): string {
  const folded = fold(word);
  const size = [...folded].length;
  const ending = SUFFIXES.find((suffix) => folded.endsWith(suffix) && size - [...suffix].length >= 3);
  return ending === undefined ? folded : folded.slice(0, folded.length - ending.length);
}

export type DateFormat = "yyyy-mm-dd" | "dd.mm.yyyy" | "dd.mm.yy" | "dd/mm/yyyy";

/** How a note takes new entries. `top` means before the first entry, `end` after the last, `under` at the end of that heading's section. */
export interface EntryPattern {
  /** The newest entries as they are written, in file order. */
  entries: string[];
  dateFormat: DateFormat | null;
  /** The first entry's first line with its date replaced by today's, in the note's own format. */
  today: string | null;
  where: "end" | "top" | { under: string };
}

export interface FoundNote {
  path: string;
  title: string | null;
  outline: string[];
  passages: string[];
  score: number;
  pattern: EntryPattern | null;
}

const cut = (text: string, chars: number): string => [...text].slice(0, chars).join("");

/** The lines of a note's body: Windows line ends read as any others and the front matter left out. */
function bodyLines(text: string): string[] {
  return splitFrontmatter(text.replaceAll("\r\n", "\n"))[1].split("\n");
}

/** The lines that are written as Markdown, not inside a code fence; each with its place in `lines`. */
function proseLines(lines: readonly string[]): Array<[number, string]> {
  const prose: Array<[number, string]> = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^[ \t]{0,3}(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) prose.push([index, line]);
  });
  return prose;
}

const headingLevel = (line: string): number => /^(#{1,6}) /.exec(line)?.[1]?.length ?? 0;

/** The note's headings as written (`## Letters`), at most 30. */
export function outlineOf(text: string): string[] {
  return proseLines(bodyLines(text))
    .filter(([, line]) => headingLevel(line) > 0)
    .slice(0, OUTLINE_HEADINGS)
    .map(([, line]) => line.trimEnd());
}

/** The search words of a query, stemmed, each once. */
function queryStems(query: string): string[] {
  const words = fold(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words.map(stem).filter((word) => [...word].length >= MIN_STEM))];
}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

function passagesOf(text: string, stems: readonly string[]): string[] {
  const passages: string[] = [];
  for (const [, line] of proseLines(bodyLines(text))) {
    if (passages.length === PASSAGES_PER_NOTE) break;
    const trimmed = line.trim();
    if (trimmed && stems.some((word) => fold(trimmed).includes(word))) passages.push(cut(trimmed, PASSAGE_CHARS));
  }
  return passages;
}

function read(root: string, rel: string): string | null {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * The notes under the given top-level folders of `root`, at any depth, that mention the words of `query` in any of their forms:
 * the most mentions first (a word in the file name or the title counts extra), then by path. Each comes with its headings and a few
 * passages, never its whole text.
 */
export function findNotes(
  root: string,
  query: string,
  { folders, limit = 5 }: { folders: readonly string[]; limit?: number },
): FoundNote[] {
  const stems = queryStems(query);
  const wanted = new Set(folders.map(folderKey));
  if (!stems.length || !wanted.size) return [];
  const scored: Array<{ path: string; title: string | null; score: number }> = [];
  for (const rel of visibleFiles(root)) {
    const top = rel.split("/")[0] ?? "";
    if (!rel.endsWith(".md") || !rel.includes("/") || !wanted.has(folderKey(top))) continue;
    const text = read(root, rel);
    if (text === null) continue;
    const title = pageMeta(text.replaceAll("\r\n", "\n")).title;
    const folded = fold(text);
    const named = fold(`${(rel.split("/").at(-1) ?? "").slice(0, -".md".length)} ${title ?? ""}`);
    const score = stems.reduce((sum, word) => sum + occurrences(folded, word) + (named.includes(word) ? 3 : 0), 0);
    if (score) scored.push({ path: rel, title, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const now = new Date();
  return scored.slice(0, limit).map(({ path, title, score }) => {
    const text = read(root, path) ?? "";
    return { path, title, outline: outlineOf(text), passages: passagesOf(text, stems), score, pattern: entryPattern(text, now) };
  });
}

const DATE_FORMATS: Array<{ format: DateFormat; pattern: RegExp }> = [
  { format: "yyyy-mm-dd", pattern: /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/ },
  { format: "dd.mm.yyyy", pattern: /(?<![\d.])(\d{2})\.(\d{2})\.(\d{4})(?![\d.]?\d)/ },
  { format: "dd.mm.yy", pattern: /(?<![\d.])(\d{2})\.(\d{2})\.(\d{2})(?!\d|\.\d)/ },
  { format: "dd/mm/yyyy", pattern: /(?<![\d/])(\d{2})\/(\d{2})\/(\d{4})(?![\d/]?\d)/ },
];

interface DateMention {
  format: DateFormat;
  index: number;
  text: string;
  /** yyyymmdd, to tell which of two dates is later. */
  sortKey: number;
}

/** The first real date in a line, in whichever of the four formats it is written. */
function dateIn(line: string): DateMention | null {
  let found: DateMention | null = null;
  for (const { format, pattern } of DATE_FORMATS) {
    const match = pattern.exec(line);
    if (!match || (found && match.index >= found.index)) continue;
    const parts = [match[1], match[2], match[3]].map(Number) as [number, number, number];
    const [year, day, month] = format === "yyyy-mm-dd" ? [parts[0], parts[2], parts[1]] : [parts[2], parts[0], parts[1]];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const fullYear = year < 100 ? 2000 + year : year;
    found = { format, index: match.index, text: match[0], sortKey: fullYear * 10_000 + month * 100 + day };
  }
  return found;
}

function formatDate(format: DateFormat, now: Date): string {
  const [year = "", month = "", day = ""] = localDate(now).split("-");
  switch (format) {
    case "yyyy-mm-dd":
      return `${year}-${month}-${day}`;
    case "dd.mm.yyyy":
      return `${day}.${month}.${year}`;
    case "dd.mm.yy":
      return `${day}.${month}.${year.slice(2)}`;
    case "dd/mm/yyyy":
      return `${day}/${month}/${year}`;
  }
}

interface Entry {
  /** Index of the entry's first line in the note's body, and one past its last. */
  start: number;
  end: number;
  level: number;
  date: DateMention;
}

/**
 * How a note takes new entries: dated headings or top-level dated list items, the way the owner dates them and where they go.
 * Null when the note has no dated entries.
 */
export function entryPattern(text: string, now: Date): EntryPattern | null {
  const lines = bodyLines(text);
  const prose = proseLines(lines);
  const starts: Entry[] = [];
  for (const [index, line] of prose) {
    const level = headingLevel(line) || (/^[-*] /.test(line) ? 7 : 0);
    const date = level ? dateIn(line) : null;
    if (date) starts.push({ start: index, end: lines.length, level, date });
  }
  if (!starts.length) return null;
  // An entry runs to the next entry, or to a heading of its own level or higher (any heading ends a list item).
  for (const entry of starts) {
    const next = prose.find(([index, line]) => index > entry.start && headingLevel(line) > 0 && headingLevel(line) <= entry.level);
    const following = starts.find((other) => other.start > entry.start);
    entry.end = Math.min(next?.[0] ?? lines.length, following?.start ?? lines.length);
  }

  const tally = new Map<DateFormat, number>();
  for (const { date } of starts) tally.set(date.format, (tally.get(date.format) ?? 0) + 1);
  const dateFormat = [...tally.entries()].reduce((best, current) => (current[1] > best[1] ? current : best))[0];

  const first = starts[0]!;
  const firstLine = lines[first.start] ?? "";
  const today = firstLine.slice(0, first.date.index) + formatDate(dateFormat, now) + firstLine.slice(first.date.index + first.date.text.length);

  const sections = new Set(starts.map((entry) => parentHeading(prose, entry, starts)));
  const [section] = [...sections];
  let where: EntryPattern["where"];
  if (sections.size === 1 && section) {
    where = { under: section };
  } else {
    let down = 0;
    let up = 0;
    starts.slice(1).forEach((entry, index) => {
      const before = starts[index]!.date.sortKey;
      if (entry.date.sortKey < before) down++;
      else if (entry.date.sortKey > before) up++;
    });
    where = down > up ? "top" : "end";
  }

  const shown = where === "top" ? starts.slice(0, ENTRIES_SHOWN) : starts.slice(-ENTRIES_SHOWN);
  const entries = shown.map((entry) => cut(lines.slice(entry.start, entry.end).join("\n").trimEnd(), ENTRY_CHARS));
  return { entries, dateFormat, today, where };
}

/**
 * The heading an entry sits under, as written: the nearest one above it that is higher than the entry. Null when there is none, when
 * it is dated itself, or when it is the note's title (a level-1 heading), under which entries are simply added at the end or the top.
 */
function parentHeading(prose: ReadonlyArray<[number, string]>, entry: Entry, starts: readonly Entry[]): string | null {
  for (let at = prose.length - 1; at >= 0; at--) {
    const [index, line] = prose[at]!;
    const level = headingLevel(line);
    if (index >= entry.start || !level || level >= entry.level) continue;
    if (level === 1 || starts.some((other) => other.start === index)) return null;
    return line.trimEnd();
  }
  return null;
}
