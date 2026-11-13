import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ShelfSuggestion } from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import { ShelfSuggestions } from "../src/main/shelf-suggestions.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-shelf-suggestions-"));

const suggestion = (over: Partial<ShelfSuggestion> = {}): ShelfSuggestion => ({
  folder: "projects",
  name: "Projects",
  definition: "Work the owner is building",
  pages: ["projects/a.md"],
  agentMade: false,
  ...over,
});

describe("pending shelf suggestions", () => {
  it("lists what was added, with the capture each page came from", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    const added = store.add("/lib", suggestion(), "c1");
    expect(added).toEqual({
      folder: "projects",
      name: "Projects",
      definition: "Work the owner is building",
      agentMade: false,
      pages: [{ path: "projects/a.md", captureId: "c1" }],
    });
    expect(store.list("/lib")).toEqual([added]);
  });

  it("keeps what it was given across a new store on the same file", () => {
    const file = path.join(tmp(), "shelf-suggestions.json");
    new ShelfSuggestions(file).add("/lib", suggestion(), "c1");
    expect(new ShelfSuggestions(file).list("/lib")).toHaveLength(1);
  });

  it("joins a same-shelf suggestion and appends its pages, never twice", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    store.add("/lib", suggestion(), "c1");
    const joined = store.add(
      "/lib",
      suggestion({ folder: "project", name: "Project", definition: "Other words", pages: ["project/b.md", "projects/a.md"] }),
      "c2",
    );
    expect(store.list("/lib")).toHaveLength(1);
    expect(joined.folder).toBe("projects");
    expect(joined.name).toBe("Projects");
    expect(joined.definition).toBe("Work the owner is building");
    expect(joined.pages).toEqual([
      { path: "projects/a.md", captureId: "c1" },
      { path: "project/b.md", captureId: "c2" },
    ]);
  });

  it("joins by name when the folders differ, and takes the incoming definition for an agent-made one", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    store.add("/lib", suggestion({ folder: "work", name: "Projects", definition: "", agentMade: true }), "c1");
    const joined = store.add("/lib", suggestion({ folder: "projects", name: "Project" }), "c2");
    expect(store.list("/lib")).toHaveLength(1);
    expect(joined.folder).toBe("work");
    expect(joined.definition).toBe("Work the owner is building");
    expect(joined.agentMade).toBe(false);
  });

  it("stays agent-made while no definition is known", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    store.add("/lib", suggestion({ definition: "", agentMade: true }), "c1");
    const joined = store.add("/lib", suggestion({ definition: "", agentMade: true, pages: ["projects/b.md"] }), "c2");
    expect(joined.agentMade).toBe(true);
  });

  it("drops a capture's pages, and a suggestion left with none", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    store.add("/lib", suggestion(), "c1");
    store.add("/lib", suggestion({ pages: ["projects/b.md"] }), "c2");
    store.forgetCapture("/lib", "c1");
    expect(store.list("/lib")[0]?.pages).toEqual([{ path: "projects/b.md", captureId: "c2" }]);
    store.forgetCapture("/lib", "c2");
    expect(store.list("/lib")).toEqual([]);
  });

  it("removes a suggestion and returns it, or null when none matches", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    const added = store.add("/lib", suggestion(), "c1");
    expect(store.remove("/lib", "nothing")).toBeNull();
    expect(store.remove("/lib", "projects")).toEqual(added);
    expect(store.list("/lib")).toEqual([]);
  });

  it("puts a removed suggestion back with restore, and doesn't double it", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    const added = store.add("/lib", suggestion(), "c1");
    store.remove("/lib", "projects");
    store.restore("/lib", added);
    store.restore("/lib", added);
    expect(store.list("/lib")).toEqual([added]);
  });

  it("loads empty from a file that doesn't parse", () => {
    const file = path.join(tmp(), "shelf-suggestions.json");
    writeFileSync(file, "{ not json");
    const store = new ShelfSuggestions(file);
    expect(store.list("/lib")).toEqual([]);
    store.add("/lib", suggestion(), "c1");
    expect(JSON.parse(readFileSync(file, "utf8"))).toBeTypeOf("object");
  });

  it("keeps each library's suggestions apart", () => {
    const store = new ShelfSuggestions(path.join(tmp(), "shelf-suggestions.json"));
    store.add("/lib-a", suggestion(), "c1");
    expect(store.list("/lib-b")).toEqual([]);
    expect(store.list("/lib-a/../lib-a")).toHaveLength(1);
  });

  it("throws when the file can't be written", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "file"), "a file where a folder should be");
    const store = new ShelfSuggestions(path.join(dir, "file", "shelf-suggestions.json"));
    expect(() => store.add("/lib", suggestion(), "c1")).toThrow();
  });
});
