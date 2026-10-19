import { describe, expect, it } from "vitest";
import { search } from "../../src/core/search.ts";
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
