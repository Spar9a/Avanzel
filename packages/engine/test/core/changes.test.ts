import { unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Changes, diff, snapshot } from "../../src/core/changes.ts";
import { useTmp, write } from "./helpers.ts";

const tmp = useTmp();

describe("snapshot and diff", () => {
  it("find created, modified and deleted files", () => {
    write(tmp(), "goals/a.md", "a");
    write(tmp(), "ideas/b.md", "b");
    write(tmp(), "index.md", "i");
    const before = snapshot(tmp());
    write(tmp(), "goals/a.md", "a changed");
    unlinkSync(join(tmp(), "ideas", "b.md"));
    write(tmp(), "people/c.md", "c");
    expect(diff(before, snapshot(tmp()))).toEqual(new Changes(["people/c.md"], ["goals/a.md"], ["ideas/b.md"]));
  });

  it("notice an edit that keeps the size", () => {
    const page = write(tmp(), "a.md", "aaaa");
    utimesSync(page, 1, 1);
    const before = snapshot(tmp());
    write(tmp(), "a.md", "bbbb");
    utimesSync(page, 2, 2);
    expect(diff(before, snapshot(tmp())).modified).toEqual(["a.md"]);
  });

  it("skip hidden paths", () => {
    for (const rel of [".git/HEAD", ".avanzel/lock", ".obsidian/workspace.json", ".DS_Store", "goals/.DS_Store"]) {
      write(tmp(), rel, "x");
    }
    write(tmp(), "goals/a.md", "a");
    expect([...snapshot(tmp()).keys()]).toEqual(["goals/a.md"]);
  });
});

describe("Changes", () => {
  it("drop paths under the given prefixes", () => {
    const changes = new Changes(["inbox/x.md", "goals/a.md"], ["raw/2026/10/y.md", "index.md"], ["inboxes/z.md"]);
    expect(changes.without(["inbox/", "raw/"])).toEqual(new Changes(["goals/a.md"], ["index.md"], ["inboxes/z.md"]));
  });

  it("list the Markdown pages written inside folders", () => {
    const changes = new Changes(["goals/a.md", "index.md", "raw/audio/x.wav"], ["people/b.md", "log.md"], ["ideas/c.md"]);
    expect(changes.pages).toEqual(["goals/a.md", "people/b.md"]);
    expect(changes.empty).toBe(false);
    expect(new Changes([], [], []).empty).toBe(true);
  });

  it("survive structured cloning (apps send them between processes)", () => {
    const changes = structuredClone(new Changes(["goals/a.md"], [], []));
    expect(changes.pages).toEqual(["goals/a.md"]);
    expect(changes.empty).toBe(false);
  });
});
