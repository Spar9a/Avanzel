// Read-only views of the library for the UI: page titles, recent filings, wikilink lookup.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Replace a capture's words after Edit, keeping its frontmatter and any ![[embeds]] at the end. */
export function rewriteCaptureBody(file: string, text: string): void {
  const original = readFileSync(file, "utf8");
  const match = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(original);
  const frontmatter = match?.[1] ?? "";
  const body = match?.[2] ?? original;
  const embeds = body.split("\n").filter((line) => /^!\[\[.+\]\]$/.test(line.trim()));
  const parts = [`${frontmatter}\n${text.trim()}\n`];
  if (embeds.length) parts.push(`\n${embeds.join("\n")}\n`);
  writeFileSync(file, parts.join(""));
}
