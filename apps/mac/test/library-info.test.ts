import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filedPages, findPage, pageInfo, recentFromLog, rewriteCaptureBody } from "../src/main/library-info.ts";

function library() {
  const root = mkdtempSync(path.join(tmpdir(), "avz-lib-"));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  write("goals/launch-podcast.md", "---\ntitle: Launch the indie game dev podcast\nshelf: goals\n---\n# Launch the indie game dev podcast\n");
  write("ideas/balcony-garden.md", "# Маленький сад на балконе\n\nТекст.\n");
  write("people/mark.md", "No heading here.\n");
  write("raw/2026/10/2026-10-20-140312.md", "---\nid: x\n---\n\nwords\n");
  write("log.md", [
    "# Log",
    "- 2026-10-20 00:55 | file | [[2026-10-20-005550-i-want]] → [[launch-podcast]], [[mark]]",
    "- 2026-10-20 00:56 | review | [[2026-10-20]]",
    "- 2026-10-20 00:57 | file | [[2026-10-20-005619]] → [[balcony-garden]]",
    "",
  ].join("\n"));
  return root;
}

describe("library info", () => {
  it("titles a page from its frontmatter, then its heading, then its file name", () => {
    const root = library();
    expect(pageInfo(root, "goals/launch-podcast.md")).toEqual({ title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md" });
    expect(pageInfo(root, "ideas/balcony-garden.md").title).toBe("Маленький сад на балконе");
    expect(pageInfo(root, "people/mark.md").title).toBe("mark");
  });

  it("lists recently filed pages, newest first, from the log", () => {
    expect(recentFromLog(library()).map((p) => p.path)).toEqual(["ideas/balcony-garden.md", "goals/launch-podcast.md", "people/mark.md"]);
  });

  it("finds a page by its wikilink name, shelves before sources", () => {
    const root = library();
    expect(findPage(root, "mark")).toBe("people/mark.md");
    expect(findPage(root, "2026-10-20-140312")).toBe("raw/2026/10/2026-10-20-140312.md");
    expect(findPage(root, "nope")).toBeNull();
  });

  it("turns an agent run's changes into the pages it filed, new pages first", () => {
    const root = library();
    const pages = filedPages(root, { created: ["people/mark.md", "index.md"], modified: ["goals/launch-podcast.md", "log.md", "reviews/2026-10-20.md"] });
    expect(pages.map((p) => p.path)).toEqual(["people/mark.md", "goals/launch-podcast.md"]);
  });

  it("rewrites a capture's words but keeps its frontmatter and embeds", () => {
    const root = library();
    const file = path.join(root, "capture.md");
    writeFileSync(file, "---\nid: x\nsource: voice\n---\n\nhygienic tool\n\n![[2026-10-20-140312.wav]]\n");
    rewriteCaptureBody(file, "agentic tool");
    expect(readFileSync(file, "utf8")).toBe("---\nid: x\nsource: voice\n---\n\nagentic tool\n\n![[2026-10-20-140312.wav]]\n");
  });
});
