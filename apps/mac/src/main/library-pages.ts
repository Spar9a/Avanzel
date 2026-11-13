// The library's pages as the menu bar panel's Library lists them: each shelf's Markdown pages, read from their front matter and
// their text, newest change first.
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PANEL_PAGES, type PanelPage } from "../shared/ipc.ts";

const SHELF_FOLDERS = ["goals", "ideas", "problems", "memories", "people", "topics"] as const;
/** The folders every library lists besides the owner's own: the six shelves and meetings. */
const BUILT_IN_FOLDERS: readonly string[] = [...SHELF_FOLDERS, "meetings"];
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

/**
 * Markdown links as plain words: `[[page|Name]]` and `[[page]]` and `[words](url)`, and no emphasis marks. A link to a file of the
 * library's raw/attachments (`[the recording](raw/attachments/…)`) is kept as it is: the panel draws it as a link that opens the file.
 */
export function plainWords(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => path.basename(target))
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (link, words: string, url: string) => (url.trim().startsWith("raw/attachments/") ? link : words))
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

/**
 * One page, read from `file` (absolute) in the library at `root`. Its shelf is the front matter's `shelf:` when that is a built-in or
 * own folder (`ownFolders`), else its folder when that is one, else null. Null for a file that can't be read.
 */
export function readPage(root: string, file: string, ownFolders: readonly string[] = []): PanelPage | null {
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
  const known = (name: string) => BUILT_IN_FOLDERS.includes(name) || ownFolders.includes(name);
  const shelf = known(shelfField) ? shelfField : known(folder) ? folder : null;
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
    attachments: attachmentsIn(root, text),
    attachmentNames: attachmentNamesIn(root, text),
  };
}

/**
 * The names files of raw/attachments had when they were added, from where `text` writes one beside its path, in brackets and maybe
 * guillemets ("raw/attachments/….mov («Screen Recording 10.54.48.mov»)"): each once, for a file that is there.
 */
export function attachmentNamesIn(root: string, text: string): { name: string; path: string }[] {
  const there = new Set(attachmentsIn(root, text));
  const found = new Map<string, string>();
  for (const match of text.matchAll(/(raw\/attachments\/[^\s)\]|"'«»,;]+\.[A-Za-z0-9]{1,5})\s*\(\s*[«"“]?([^)«»"“”]+?)[»"”]?\s*\)/g)) {
    const [, rel = "", name = ""] = match;
    const clean = name.trim();
    if (there.has(rel) && clean.length >= 3 && !found.has(clean)) found.set(clean, rel);
  }
  return [...found].map(([name, rel]) => ({ name, path: rel }));
}

/** A path into the library's raw/attachments, as a page names one: up to the first space, bracket, quote or closing mark. */
export const ATTACHMENT_PATH = /raw\/attachments\/[^\s)\]|"'«»,;]+\.[A-Za-z0-9]{1,5}/g;

/** The files of raw/attachments `text` names, each once, in its order, that are regular files in the library at `root`. */
export function attachmentsIn(root: string, text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ATTACHMENT_PATH)) {
    const rel = match[0];
    if (seen.has(rel) || rel.split("/").includes("..")) continue;
    try {
      if (statSync(path.join(root, rel)).isFile()) seen.add(rel);
    } catch {
      // named, but not there (taken away since): not offered
    }
  }
  return [...seen];
}

/**
 * A page as a prompt for an agent, from its file's `text` at `rel` in the library at `root`: a line that says what it is, the title,
 * its shelf, status and tags, then its words as they are (the front matter and the title left out), each file of raw/attachments it
 * names written as its full path on this Mac, so an agent can open it, and those files listed at the end.
 */
export function pagePrompt(root: string, rel: string, text: string): string {
  const { fields, body } = frontMatter(text);
  const words = pageText(body);
  const title = (typeof fields.title === "string" && fields.title) || words.heading || path.basename(rel, ".md");
  const files = attachmentsIn(root, text);
  const full = (file: string) => path.join(root, file);
  const about: string[] = [];
  const shelf = typeof fields.shelf === "string" ? fields.shelf : rel.split("/")[0];
  if (shelf) about.push(`Shelf: ${shelf}.`);
  if (typeof fields.status === "string" && fields.status) about.push(`Status: ${fields.status}.`);
  const tags = Array.isArray(fields.tags) ? fields.tags : typeof fields.tags === "string" ? splitList(fields.tags) : [];
  if (tags.length > 0) about.push(`Tags: ${tags.join(", ")}.`);
  const own = body
    .replace(/^\s*#\s+.*\r?\n/, "") // the title, which the prompt says once itself
    .replace(ATTACHMENT_PATH, (file) => (files.includes(file) ? full(file) : file))
    .trim();
  return [
    "Here is a note from my notes in Avanzel. Read it, look at the files it names, and help me with it.",
    "",
    `# ${title}`,
    ...(about.length > 0 ? [about.join(" ")] : []),
    "",
    own,
    ...(files.length > 0 ? ["", "Files (on this Mac):", ...files.map((file) => `- ${full(file)}`)] : []),
    "",
  ].join("\n");
}

/** The Markdown files under `dir`, `depth` folders deep at most, skipping hidden ones and links. */
function markdownUnder(dir: string, depth: number, into: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 1) markdownUnder(full, depth - 1, into);
    else if (entry.isFile() && entry.name.endsWith(".md")) into.push(full);
  }
}

/**
 * The captures a page was filed from that go with it when it is deleted: the notes its front matter's `sources` names (`[[name]]`),
 * found in the library's inbox or raw/ archive, each a regular file. A capture that another page names too stays: one thought can
 * be filed into several pages, and it is still theirs. Absolute paths; none when the page names no sources.
 */
export function sourcesOnlyOf(root: string, rel: string, text: string): string[] {
  const field = frontMatter(text).fields.sources;
  const listed = Array.isArray(field) ? field : typeof field === "string" ? splitList(field) : [];
  const names = [...new Set(listed.map((each) => /\[\[([^\]|#]+)/.exec(each)?.[1]?.trim() ?? "").filter(Boolean).map((each) => path.basename(each)))];
  if (names.length === 0) return [];
  const captures: string[] = [];
  markdownUnder(path.join(root, "inbox"), 1, captures);
  markdownUnder(path.join(root, "raw"), 3, captures);
  const pages: string[] = [];
  markdownUnder(root, 3, pages);
  const self = path.join(root, rel);
  const others = pages.filter((file) => file !== self && !file.startsWith(path.join(root, "raw") + path.sep) && !file.startsWith(path.join(root, "inbox") + path.sep));
  const named = (name: string) =>
    others.some((file) => {
      try {
        return readFileSync(file, "utf8").includes(`[[${name}`);
      } catch {
        return false;
      }
    });
  const out: string[] = [];
  for (const name of names) {
    const capture = captures.find((file) => path.basename(file, ".md") === name);
    if (!capture || named(name)) continue;
    try {
      if (lstatSync(capture).isFile()) out.push(capture);
    } catch {
      // gone meanwhile
    }
  }
  return out;
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
 * time. The shelves are the six, meetings and the owner's own (`ownFolders`); a folder with no definition is not one. PANEL_PAGES at
 * most. Links are never followed out of the library: a shelf folder or a page that is a link is skipped.
 */
export function libraryPages(root: string, ownFolders: readonly string[] = []): PanelPage[] {
  const files: { file: string; mtime: number }[] = [];
  for (const shelf of new Set([...BUILT_IN_FOLDERS, ...ownFolders])) {
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
    const page = readPage(root, file, ownFolders);
    if (page) pages.push({ page, mtime });
  }
  pages.sort((a, b) => (b.page.updated ?? "").localeCompare(a.page.updated ?? "") || b.mtime - a.mtime);
  return pages.slice(0, PANEL_PAGES).map((p) => p.page);
}

/**
 * `text`, a page, without one line of its section headed `heading`: the first whose words are `item`, as the panel lists them
 * (`lineWords`: "☐ Do it" for "- [ ] Do it"), with the lines indented under it. Null when the section or the line isn't there.
 */
export function withoutItem(text: string, heading: string, item: string): string | null {
  const lines = text.split(/\r?\n/);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{2,6})\s+(.*?)\s*#*\s*$/.exec(lines[i] ?? "");
    if (h) {
      if (level > 0 && (h[1] ?? "").length <= level) return null; // the section ended without the line
      if (level === 0 && plainWords(h[2] ?? "") === heading) level = (h[1] ?? "").length;
      continue;
    }
    if (level === 0 || !(lines[i] ?? "").trim() || lineWords(lines[i] ?? "") !== item) continue;
    const indent = /^\s*/.exec(lines[i] ?? "")?.[0].length ?? 0;
    let end = i + 1;
    while (end < lines.length && (lines[end] ?? "").trim() && (/^\s*/.exec(lines[end] ?? "")?.[0].length ?? 0) > indent) end++;
    return [...lines.slice(0, i), ...lines.slice(end)].join(eol);
  }
  return null;
}
