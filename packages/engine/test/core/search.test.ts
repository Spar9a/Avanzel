import { describe, expect, it } from "vitest";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { search, searchLibrary } from "../../src/core/search.ts";
import { useTmp, write } from "./helpers.ts";

const tmp = useTmp();

describe("search", () => {
  it("ranks pages named after the term first", () => {
    write(tmp(), "goals/run-a-marathon.md", "---\ntitle: Run a marathon\n---\n# Run a marathon\nTraining plan.\n");
    write(tmp(), "memories/city-race.md", "# City race\nWatched the marathon downtown. A marathon is long.\n");
    write(tmp(), "ideas/blog.md", "# Blog\nWrite about cooking.\n");
    const hits = search(tmp(), "Marathon");
    expect(hits.map((hit) => hit.path)).toEqual(["goals/run-a-marathon.md", "memories/city-race.md"]);
    expect(hits[0]?.line).toBe("# Run a marathon");
    expect(hits[1]?.line).toBe("Watched the marathon downtown. A marathon is long.");
  });

  it("matches non-Latin words", () => {
    write(tmp(), "goals/marafon.md", "# Марафон\nПробежать марафон весной.\n");
    write(tmp(), "ideas/other.md", "# Другое\n");
    expect(search(tmp(), "марафон").map((hit) => hit.path)).toEqual(["goals/marafon.md"]);
  });

  it("skips sources, root files and hidden folders", () => {
    write(tmp(), "raw/2026/10/x.md", "marathon");
    write(tmp(), "inbox/y.md", "marathon");
    write(tmp(), "index.md", "marathon");
    write(tmp(), ".obsidian/z.md", "marathon");
    expect(search(tmp(), "marathon")).toEqual([]);
  });

  it("returns nothing for a query without words", () => {
    write(tmp(), "goals/a.md", "anything");
    expect(search(tmp(), "  ?! ")).toEqual([]);
  });

  it("stops at the limit", () => {
    for (let n = 0; n < 5; n++) write(tmp(), `ideas/idea-${n}.md`, "garden ".repeat(n + 1));
    expect(search(tmp(), "garden", 2).map((hit) => hit.path)).toEqual(["ideas/idea-4.md", "ideas/idea-3.md"]);
  });
});

describe("searchLibrary", () => {
  it("folds case and ё, and matches aliases", () => {
    write(tmp(), "people/alexander.md", "---\ntitle: Alexander\naliases: [Саша]\n---\n# Alexander\nПроект ёлка.\n");
    expect(searchLibrary(tmp(), "проект ЕЛКА").hits.map((h) => h.path)).toEqual(["people/alexander.md"]);
    expect(searchLibrary(tmp(), "саша").hits[0]?.title).toBe("Alexander");
  });

  it("scores a title or alias match above plain body mentions", () => {
    write(tmp(), "topics/mentions.md", "# Notes\nvelo velo velo\n");
    write(tmp(), "topics/bikes.md", "---\ntitle: Velo\n---\n# Bikes\n");
    expect(searchLibrary(tmp(), "velo").hits.map((h) => h.path)).toEqual(["topics/bikes.md", "topics/mentions.md"]);
  });

  it("returns the page's fields", () => {
    write(
      tmp(),
      "goals/run.md",
      "---\ntitle: Run\nshelf: goals\nstatus: active\nupdated: 2026-10-20\ntags: [health]\n---\n# Run\nA marathon plan.\n",
    );
    const hit = searchLibrary(tmp(), "marathon").hits[0];
    expect(hit).toMatchObject({
      path: "goals/run.md",
      title: "Run",
      shelf: "goals",
      status: "active",
      updated: "2026-10-20",
      tags: ["health"],
      line: "A marathon plan.",
      log: null,
      capture: null,
    });
  });

  it("returns the matching Log bullet, total and paging", () => {
    write(
      tmp(),
      "goals/a.md",
      "# A\n\n## Log\n- 2026-10-01 — Started the garden. ([[2026-10-01-090000-garden]])\n- 2026-10-05 — Watered the garden. ([[2026-10-05-090000-water]])\n",
    );
    write(tmp(), "ideas/b.md", "# B\ngarden garden\n");
    write(tmp(), "topics/c.md", "# C\ngarden\n");
    const all = searchLibrary(tmp(), "garden");
    expect(all.total).toBe(3);
    expect(all.hits.find((h) => h.path === "goals/a.md")?.log).toEqual({
      date: "2026-10-01",
      text: "Started the garden. ([[2026-10-01-090000-garden]])",
      captureId: "2026-10-01-090000-garden",
    });
    const page = searchLibrary(tmp(), "garden", { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.offset).toBe(2);
    expect(page.hits).toHaveLength(1);
  });

  it("clamps the limit to 1 to 50", () => {
    for (let n = 0; n < 3; n++) write(tmp(), `ideas/i-${n}.md`, "garden");
    expect(searchLibrary(tmp(), "garden", { limit: 0 }).hits).toHaveLength(1);
    expect(searchLibrary(tmp(), "garden", { limit: 500 }).hits).toHaveLength(3);
  });

  it("leaves captures out unless asked, then lists them after pages", () => {
    write(tmp(), "inbox/a.md", "---\nsource: agent\n---\nmarathon marathon marathon marathon\n");
    write(tmp(), "raw/2026/11/b.md", "marathon marathon marathon\n");
    write(tmp(), "raw/dictations/2026-11-13.md", "marathon\n");
    write(tmp(), "goals/run.md", "# Run\nmarathon\n");
    expect(searchLibrary(tmp(), "marathon").hits.map((h) => h.path)).toEqual(["goals/run.md"]);
    const withCaptures = searchLibrary(tmp(), "marathon", { includeCaptures: true });
    expect(withCaptures.hits.map((h) => [h.path, h.capture])).toEqual([
      ["goals/run.md", null],
      ["inbox/a.md", "unfiled"],
      ["raw/2026/11/b.md", "filed"],
    ]);
    expect(withCaptures.total).toBe(3);
  });

  it("searches reviews as pages and never tasks, root files or hidden folders", () => {
    write(tmp(), "reviews/r.md", "# Review\nmarathon\n");
    write(tmp(), "tasks/t.md", "marathon");
    write(tmp(), "index.md", "marathon");
    write(tmp(), "log.md", "marathon");
    write(tmp(), ".git/x.md", "marathon");
    expect(searchLibrary(tmp(), "marathon").hits.map((h) => h.path)).toEqual(["reviews/r.md"]);
  });

  it("skips non-Markdown files and symlinks", () => {
    write(tmp(), "goals/a.txt", "marathon");
    write(tmp(), "outside.md", "marathon");
    symlinkSync(join(tmp(), "outside.md"), join(tmp(), "goals/link.md"));
    expect(searchLibrary(tmp(), "marathon").hits).toEqual([]);
  });

  it("filters by tag prefix and shelf", () => {
    write(tmp(), "goals/a.md", "---\ntags: [work/avanzel]\n---\n# A\nplan\n");
    write(tmp(), "ideas/b.md", "---\ntags: [home]\n---\n# B\nplan\n");
    expect(searchLibrary(tmp(), "plan", { tag: "work" }).hits.map((h) => h.path)).toEqual(["goals/a.md"]);
    expect(searchLibrary(tmp(), "plan", { tag: "work/avanzel" }).hits.map((h) => h.path)).toEqual(["goals/a.md"]);
    expect(searchLibrary(tmp(), "plan", { tag: "wor" }).hits).toEqual([]);
    expect(searchLibrary(tmp(), "plan", { shelf: "ideas" }).hits.map((h) => h.path)).toEqual(["ideas/b.md"]);
  });

  it("takes the shelf from the page's own field, else its folder", () => {
    write(tmp(), "goals/a.md", "---\nshelf: people\n---\nplan\n");
    write(tmp(), "ideas/b.md", "plan\n");
    const shelves = Object.fromEntries(searchLibrary(tmp(), "plan").hits.map((h) => [h.path, h.shelf]));
    expect(shelves).toEqual({ "goals/a.md": "people", "ideas/b.md": "ideas" });
  });

  it("breaks equal scores by updated, newest first, pages without a date last", () => {
    write(tmp(), "ideas/old.md", "---\nupdated: 2026-11-01\n---\nsame text\n");
    write(tmp(), "ideas/new.md", "---\nupdated: 2026-11-10\n---\nsame text\n");
    write(tmp(), "ideas/undated.md", "---\ntitle: x\n---\nsame text\n");
    expect(searchLibrary(tmp(), "same").hits.map((h) => h.path)).toEqual(["ideas/new.md", "ideas/old.md", "ideas/undated.md"]);
  });

  it("returns nothing for a query without words", () => {
    write(tmp(), "goals/a.md", "anything");
    expect(searchLibrary(tmp(), "  ?! ")).toEqual({ total: 0, offset: 0, hits: [] });
  });
});
