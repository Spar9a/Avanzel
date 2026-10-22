import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answeredFrom, captureMeta, filedPages, findPage, obsidianUrl, pageInfo, recentFromLog } from "../src/main/library-info.ts";

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

  it("answeredFrom reads an answer's lines and the pages its links name, and leaves out a name with no page", () => {
    const answered = answeredFrom(library(), "See [[launch-podcast|the podcast]] and [[nowhere]].\n\n## Next\n**Call Mark**");
    expect(answered.paragraphs).toEqual(["See the podcast and nowhere.", "Next", "Call Mark"]);
    expect(answered.sources).toEqual([{ title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md" }]);
  });

  it("answeredFrom without a library keeps the lines and names no page", () => {
    expect(answeredFrom(null, "See [[x]].")).toEqual({ paragraphs: ["See x."], sources: [] });
  });

  it("answeredFrom leaves out a name whose search can't read the library, so the answer still shows", () => {
    const notAFolder = path.join(library(), "log.md"); // a library path that is a file: reading it as a folder throws
    expect(answeredFrom(notAFolder, "See [[mark]].")).toEqual({ paragraphs: ["See mark."], sources: [] });
  });

  it("turns an agent run's changes into the pages it filed, new pages first", () => {
    const root = library();
    const pages = filedPages(root, { created: ["people/mark.md", "index.md"], modified: ["goals/launch-podcast.md", "log.md", "reviews/2026-10-20.md"] });
    expect(pages.map((p) => p.path)).toEqual(["people/mark.md", "goals/launch-podcast.md"]);
  });

  it("opens pages in Obsidian only when Obsidian knows the library as a vault", () => {
    const root = library();
    expect(obsidianUrl(root, "goals/launch-podcast.md")).toBeNull();
    mkdirSync(path.join(root, ".obsidian"));
    expect(obsidianUrl(root, "goals/launch-podcast.md")).toBe(`obsidian://open?path=${encodeURIComponent(path.join(root, "goals/launch-podcast.md"))}`);
    expect(obsidianUrl(root, "")).toBe(`obsidian://open?path=${encodeURIComponent(root)}`);
  });

  it("reads what a re-filed capture must keep: source, audio, transcriber and creation time", () => {
    const root = library();
    const file = path.join(root, "capture.md");
    writeFileSync(file, "---\nid: 2026-10-20-040829-a-hygienic-tool\ntype: capture\nsource: voice\ncreated: 2026-10-20T04:08:29+04:00\naudio: raw/audio/2026/10/2026-10-20-040829.wav\ntranscriber: onnx-asr:nemo-parakeet-tdt-0.6b-v3\n---\n\nwords\n");
    const meta = captureMeta(file);
    expect(meta.source).toBe("voice");
    expect(meta.audio).toBe("raw/audio/2026/10/2026-10-20-040829.wav");
    expect(meta.transcriber).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    expect(meta.created?.toISOString()).toBe(new Date("2026-10-20T04:08:29+04:00").toISOString());
    writeFileSync(file, "just text\n");
    expect(captureMeta(file)).toEqual({ source: "text" });
  });
});
