// Plain keyword search over the shelves — enough for a personal library, no index to maintain.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleFiles } from "./changes.ts";

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

function matchingLine(text: string, terms: string[]): string {
  let lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    lines = lines.slice(Math.max(end, 0) + 1);
  }
  const line = lines.find((candidate) => terms.some((term) => candidate.toLowerCase().includes(term)));
  return line === undefined ? "" : Array.from(line.trim()).slice(0, 160).join("");
}
