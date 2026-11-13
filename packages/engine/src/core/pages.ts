// What a library page says about itself: its front-matter fields, its Log bullets and the tags it carries.
// Search and the agent tools read pages through these.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleFiles } from "./changes.ts";
import { flowItems, frontmatterFields, splitFrontmatter } from "./frontmatter.ts";
import { lstatOrNull } from "./inside.ts";
import { SPECIAL_DIRS } from "./shelves.ts";

/** Text as matching sees it: lowercase, with ё treated as е so Russian matches the way it is typed. */
export function fold(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е");
}

/** The front-matter fields a reader of the library cares about; a missing field is null (or empty for lists). */
export interface PageMeta {
  title: string | null;
  shelf: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  aliases: string[];
  source: string | null;
  agent: string | null;
}

export function pageMeta(text: string): PageMeta {
  const fields = frontmatterFields(splitFrontmatter(text)[0]);
  const scalar = (key: string) => fields.get(key) || null;
  return {
    title: scalar("title"),
    shelf: scalar("shelf"),
    status: scalar("status"),
    updated: scalar("updated"),
    tags: flowItems(fields.get("tags") ?? ""),
    aliases: flowItems(fields.get("aliases") ?? ""),
    source: scalar("source"),
    agent: scalar("agent"),
  };
}

/** One dated line of a page's `## Log`, and the capture it cites (the last `[[…]]` in the line). */
export interface LogBullet {
  date: string;
  text: string;
  captureId: string | null;
}

export function logBullets(text: string): LogBullet[] {
  const bullets: LogBullet[] = [];
  let inLog = false;
  for (const line of splitFrontmatter(text)[1].split(/\r?\n/)) {
    if (/^##[ \t]/.test(line)) {
      inLog = /^##[ \t]+Log[ \t]*$/.test(line);
      continue;
    }
    if (!inLog) continue;
    const match = /^- (\d{4}-\d{2}-\d{2}) — (.*)$/.exec(line);
    if (!match?.[1]) continue;
    const links = [...(match[2] ?? "").matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)];
    bullets.push({ date: match[1], text: match[2] ?? "", captureId: links.at(-1)?.[1]?.trim() || null });
  }
  return bullets;
}

/**
 * Every Markdown file in a top-level folder, as a vault-relative path: no root files, no hidden folders, and no symlinks, so
 * nothing read through here can lead outside the library.
 */
export function markdownFiles(root: string): string[] {
  return visibleFiles(root).filter(
    (rel) => rel.endsWith(".md") && rel.includes("/") && lstatOrNull(join(root, rel))?.isFile() === true,
  );
}

/** The tags used across shelf pages with how many pages carry each, most used first, ties A to Z. */
export function tagCounts(root: string): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rel of markdownFiles(root)) {
    if (SPECIAL_DIRS.includes(rel.split("/")[0] ?? "")) continue;
    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    for (const tag of new Set(pageMeta(text).tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
