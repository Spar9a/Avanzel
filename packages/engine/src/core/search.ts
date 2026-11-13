// Plain keyword search over the shelves — enough for a personal library, no index to maintain.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleFiles } from "./changes.ts";
import { fold, logBullets, markdownFiles, pageMeta, type LogBullet } from "./pages.ts";

const SOURCE_DIRS = new Set(["inbox", "raw"]);

export interface SearchHit {
  path: string;
  score: number;
  line: string;
}

export function search(root: string, query: string, limit = 10): SearchHit[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const rel of visibleFiles(root)) {
    const parts = rel.split("/");
    if (!rel.endsWith(".md") || parts.length < 2 || SOURCE_DIRS.has(parts[0] ?? "")) continue;
    const text = readFileSync(join(root, rel), "utf8");
    const lower = text.toLowerCase();
    const stem = (parts.at(-1) ?? "").slice(0, -".md".length).toLowerCase();
    // Body occurrences, plus a bonus when the page is named after the term.
    const score = terms.reduce((sum, term) => sum + (lower.split(term).length - 1) + (stem.includes(term) ? 3 : 0), 0);
    if (score) hits.push({ path: rel, score, line: matchingLine(text, terms) });
  }
  hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return hits.slice(0, limit);
}

function matchingLine(text: string, terms: string[], normalise: (text: string) => string = (t) => t.toLowerCase()): string {
  let lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    lines = lines.slice(Math.max(end, 0) + 1);
  }
  const line = lines.find((candidate) => terms.some((term) => normalise(candidate).includes(term)));
  return line === undefined ? "" : Array.from(line.trim()).slice(0, 160).join("");
}

/** A page (or capture) that matched, with the fields a reader needs to decide whether to open it. */
export interface PageHit {
  path: string;
  title: string | null;
  shelf: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  score: number;
  line: string;
  /** The first Log bullet that mentions a search word. */
  log: LogBullet | null;
  /** Set for captures only: whether the librarian has filed it yet. */
  capture: "filed" | "unfiled" | null;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Keep pages tagged with this tag, or with a tag below it (`work` matches `work/avanzel`). */
  tag?: string;
  shelf?: string;
  includeCaptures?: boolean;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Keyword search over pages and, when asked, captures. Matching folds case and ё; a title or alias match counts extra.
 * Pages come first, then captures; within each, the best score, then the most recently updated.
 */
export function searchLibrary(
  root: string,
  query: string,
  options: SearchOptions = {},
): { total: number; offset: number; hits: PageHit[] } {
  const wanted = Math.trunc(options.limit ?? DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isNaN(wanted) ? DEFAULT_LIMIT : wanted));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0) || 0);
  const terms = fold(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!terms.length) return { total: 0, offset, hits: [] };
  const tag = options.tag === undefined ? null : fold(options.tag);
  const shelf = options.shelf === undefined ? null : fold(options.shelf);
  const hits: PageHit[] = [];
  for (const rel of markdownFiles(root)) {
    const parts = rel.split("/");
    const top = parts[0] ?? "";
    let capture: PageHit["capture"] = null;
    if (top === "tasks") continue;
    if (top === "inbox") {
      if (!options.includeCaptures || parts.length !== 2) continue;
      capture = "unfiled";
    } else if (top === "raw") {
      if (!options.includeCaptures || parts[1] === "dictations") continue;
      capture = "filed";
    }
    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const meta = pageMeta(text);
    const hitShelf = meta.shelf ?? (capture === null ? top : null);
    if (shelf !== null && fold(hitShelf ?? "") !== shelf) continue;
    if (tag !== null && !meta.tags.some((own) => fold(own) === tag || fold(own).startsWith(`${tag}/`))) continue;
    const folded = fold(text);
    const stem = fold((parts.at(-1) ?? "").slice(0, -".md".length));
    const names = [meta.title ?? "", ...meta.aliases].map(fold);
    const score = terms.reduce(
      (sum, term) =>
        sum +
        (folded.split(term).length - 1) +
        (stem.includes(term) ? 3 : 0) +
        (names.some((name) => name.includes(term)) ? 3 : 0),
      0,
    );
    if (!score) continue;
    hits.push({
      path: rel,
      title: meta.title,
      shelf: hitShelf,
      status: meta.status,
      updated: meta.updated,
      tags: meta.tags,
      score,
      line: matchingLine(text, terms, fold),
      log: logBullets(text).find((bullet) => terms.some((term) => fold(bullet.text).includes(term))) ?? null,
      capture,
    });
  }
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  hits.sort(
    (a, b) =>
      Number(a.capture !== null) - Number(b.capture !== null) ||
      b.score - a.score ||
      (a.updated === b.updated ? 0 : a.updated === null ? 1 : b.updated === null ? -1 : byText(b.updated, a.updated)) ||
      byText(a.path, b.path),
  );
  return { total: hits.length, offset, hits: hits.slice(offset, offset + limit) };
}
