// Read-only views of the library for the UI: page titles, recent filings, wikilink lookup.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FiledPage } from "../shared/ipc.ts";

const NOT_PAGES = new Set(["inbox", "raw", "reviews", "tasks"]);

export function pageInfo(root: string, rel: string): FiledPage {
  const shelf = rel.split("/")[0] ?? "";
  let title = path.basename(rel, ".md");
  try {
    const text = readFileSync(path.join(root, rel), "utf8");
    const fromFrontmatter = /^---\n[\s\S]*?^title:\s*(.+?)\s*$/m.exec(text.split(/\n---\n/)[0] ?? "")?.[1];
    const fromHeading = /^#\s+(.+?)\s*$/m.exec(text)?.[1];
    title = (fromFrontmatter ?? fromHeading ?? title).replace(/^["']|["']$/g, "");
  } catch {
    // keep the file name
  }
  return { title, shelf, path: rel };
}

/** Pages an agent run wrote: Markdown inside a shelf folder, new pages before updated ones. */
export function filedPages(root: string, changes: { created: string[]; modified: string[] }): FiledPage[] {
  const isPage = (rel: string) => rel.endsWith(".md") && rel.includes("/") && !NOT_PAGES.has(rel.split("/")[0] ?? "");
  const ordered = [...changes.created.filter(isPage), ...changes.modified.filter(isPage)];
  return [...new Set(ordered)].map((rel) => pageInfo(root, rel));
}

function walk(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), childRel) : [childRel];
  });
}

/**
 * An `obsidian://` link to a page (or, with "", the library), only when the library has a
 * `.obsidian/` folder: Obsidian ignores links into a folder it has never opened as a vault.
 */
export function obsidianUrl(root: string, rel: string): string | null {
  try {
    if (!statSync(path.join(root, ".obsidian")).isDirectory()) return null;
  } catch {
    return null;
  }
  return `obsidian://open?path=${encodeURIComponent(rel ? path.join(root, rel) : root)}`;
}

/** `[[name]]` → library-relative path; shelf pages win over sources in raw/ and inbox/. */
export function findPage(root: string, name: string): string | null {
  const target = `${name}.md`;
  const matches = walk(root).filter((rel) => rel.includes("/") && path.basename(rel) === target);
  const rank = (rel: string) => (NOT_PAGES.has(rel.split("/")[0] ?? "") ? 1 : 0);
  return matches.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export function recentFromLog(root: string, limit = 3): FiledPage[] {
  let lines: string[];
  try {
    lines = readFileSync(path.join(root, "log.md"), "utf8").split("\n");
  } catch {
    return [];
  }
  const recent: FiledPage[] = [];
  const seen = new Set<string>();
  for (const line of lines.reverse()) {
    if (!line.includes(" | file | ")) continue;
    const targets = line.split("→")[1] ?? "";
    for (const [, name] of targets.matchAll(/\[\[([^\]|#]+)/g)) {
      const rel = name ? findPage(root, name.trim()) : null;
      if (!rel || seen.has(rel) || NOT_PAGES.has(rel.split("/")[0] ?? "")) continue;
      seen.add(rel);
      recent.push(pageInfo(root, rel));
      if (recent.length === limit) return recent;
    }
  }
  return recent;
}

export interface CaptureMeta {
  source: string;
  /** Library-relative recording path. */
  audio?: string;
  transcriber?: string;
  created?: Date;
}

/** What a capture re-created after Edit must keep from the original. */
export function captureMeta(file: string): CaptureMeta {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"))?.[1];
  if (!frontmatter) return { source: "text" };
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(frontmatter)?.[1]?.replace(/^["']|["']$/g, "");
  const meta: CaptureMeta = { source: field("source") ?? "text" };
  const audio = field("audio");
  const transcriber = field("transcriber");
  const created = field("created");
  if (audio) meta.audio = audio;
  if (transcriber) meta.transcriber = transcriber;
  if (created && !Number.isNaN(Date.parse(created))) meta.created = new Date(created);
  return meta;
}
