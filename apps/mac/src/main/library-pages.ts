// The library's pages as the menu bar panel's Library lists them: each shelf's Markdown pages, read from their front matter and
// their text, newest change first.
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PANEL_PAGES, type PanelPage } from "../shared/ipc.ts";
import { isShelf } from "./shelf-glyphs.ts";

const SHELF_FOLDERS = ["goals", "ideas", "problems", "memories", "people", "topics"] as const;
/** How deep under a shelf's folder pages are looked for. */
const DEPTH = 3;
/** How long a page may be and still be read whole: a bigger one is read only for its head. */
const MAX_BYTES = 256 * 1024;

/** Front matter's simple YAML: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines. Quotes are taken off. */
export function frontMatter(text: string): { fields: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const list = fields[listKey];
      if (Array.isArray(list)) list.push(unquote(item[1] ?? ""));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1]!.toLowerCase();
    const value = (pair[2] ?? "").trim();
    if (value === "") {
      fields[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      fields[key] = splitList(value.slice(1, -1));
      listKey = null;
    } else {
      fields[key] = unquote(value);
      listKey = null;
    }
  }
  return { fields, body: text.slice(match[0].length) };
}

function splitList(inner: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ",") {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

/** Markdown links as plain words: `[[page|Name]]` and `[[page]]` and `[words](url)`, and no emphasis marks. */
export function plainWords(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => path.basename(target))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A list item's words without its mark: "- [ ] Do it" is "☐ Do it", "- [x] Done" is "☑ Done", "- note" is "note". */
function lineWords(line: string): string {
  const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (task) return `${task[1] === " " ? "☐" : "☑"} ${plainWords(task[2] ?? "")}`;
  const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
  return plainWords(item ? (item[1] ?? "") : line);
}

/** The page's title, first paragraph and `##` sections, from its body. */
export function pageText(body: string): { heading: string | null; summary: string; sections: PanelPage["sections"] } {
  let heading: string | null = null;
  const intro: string[] = [];
  const sections: PanelPage["sections"] = [];
  let current: PanelPage["sections"][number] | null = null;
  let introDone = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && heading === null && !current) {
      heading = plainWords(h1[1] ?? "");
      continue;
    }
    const h = /^#{2,6}\s+(.*)$/.exec(line);
    if (h) {
      current = { heading: plainWords(h[1] ?? ""), lines: [] };
      sections.push(current);
      introDone = true;
      continue;
    }
    if (!line.trim()) {
      if (intro.length) introDone = true;
      continue;
    }
    if (current) {
      const words = lineWords(line);
      if (words) current.lines.push(words);
    } else if (!introDone) intro.push(plainWords(line));
  }
  return { heading, summary: intro.join(" "), sections: sections.filter((s) => s.lines.length > 0) };
}

const day = (date: Date) => date.toISOString().slice(0, 10);

function dateField(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : null;
}

/** One page, read from `file` (absolute) in the library at `root`. Null for a file that can't be read. */
export function readPage(root: string, file: string): PanelPage | null {
  let text: string;
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
    if (!stat.isFile()) return null;
    text = readFileSync(file, "utf8");
    if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
  } catch {
    return null;
  }
  const rel = path.relative(root, file).split(path.sep).join("/");
  const { fields, body } = frontMatter(text);
  const words = pageText(body);
  const folder = rel.split("/")[0] ?? "";
  const shelfField = typeof fields.shelf === "string" ? fields.shelf.toLowerCase() : "";
  const shelf = isShelf(shelfField) ? shelfField : isShelf(folder) ? folder : null;
  const tagsField = fields.tags;
  const tags = (Array.isArray(tagsField) ? tagsField : typeof tagsField === "string" ? splitList(tagsField) : []).map((t) => t.replace(/^#/, "")).filter(Boolean);
  const title = (typeof fields.title === "string" && fields.title) || words.heading || path.basename(file, ".md");
  return {
    path: rel,
    title,
    shelf,
    status: typeof fields.status === "string" && fields.status ? fields.status : null,
    tags,
    created: dateField(fields.created) ?? day(stat.birthtime),
    updated: dateField(fields.updated) ?? day(stat.mtime),
    summary: words.summary,
    sections: words.sections,
  };
}

function markdownFiles(dir: string, depth: number, into: { file: string; mtime: number }[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 1) markdownFiles(full, depth - 1, into);
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        into.push({ file: full, mtime: statSync(full).mtimeMs });
      } catch {
        // gone while it was listed
      }
    }
  }
}

/**
 * The pages on the library's shelves at `root`, the newest change first: by the front matter's `updated`, then by the file's own
 * time. PANEL_PAGES at most. Links are never followed out of the library: a shelf folder or a page that is a link is skipped.
 */
export function libraryPages(root: string): PanelPage[] {
  const files: { file: string; mtime: number }[] = [];
  for (const shelf of SHELF_FOLDERS) {
    const dir = path.join(root, shelf);
    try {
      if (!lstatSync(dir).isDirectory()) continue; // a link, even to a folder, leads out of the library
    } catch {
      continue;
    }
    markdownFiles(dir, DEPTH, files);
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const pages: { page: PanelPage; mtime: number }[] = [];
  for (const { file, mtime } of files.slice(0, PANEL_PAGES * 2)) {
    const page = readPage(root, file);
    if (page) pages.push({ page, mtime });
  }
  pages.sort((a, b) => (b.page.updated ?? "").localeCompare(a.page.updated ?? "") || b.mtime - a.mtime);
  return pages.slice(0, PANEL_PAGES).map((p) => p.page);
}
