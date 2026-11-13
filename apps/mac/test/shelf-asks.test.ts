import { describe, expect, it } from "vitest";
import { askOf, ownShelvesInfo, parseShelfAsk, parseShelfOp } from "../src/main/shelf-asks.ts";
import { shelfMadeLine, shelfUndoneNote } from "../src/shared/shelves.ts";

const ASK = { folder: "projects", name: "Projects", definition: "Work with a goal and a deadline.", agentMade: false };

describe("askOf", () => {
  it("is a pending suggestion without its pages", () => {
    expect(askOf({ ...ASK, pages: [{ path: "ideas/launch.md", captureId: "c1" }] } as Parameters<typeof askOf>[0])).toEqual(ASK);
  });
});

describe("parseShelfAsk", () => {
  it("keeps the four fields of a whole one, and nothing else", () => {
    expect(parseShelfAsk(ASK)).toEqual(ASK);
    expect(parseShelfAsk({ ...ASK, pages: ["ideas/launch.md"] })).toEqual(ASK);
    expect(parseShelfAsk({ ...ASK, definition: "", agentMade: true })).toEqual({ ...ASK, definition: "", agentMade: true });
  });

  it("reads anything else as none", () => {
    const broken: unknown[] = [null, undefined, "projects", [ASK], { ...ASK, folder: undefined }, { ...ASK, name: 1 }, { ...ASK, definition: null }, { ...ASK, agentMade: "no" }];
    for (const raw of broken) expect(parseShelfAsk(raw)).toBeNull();
  });
});

describe("parseShelfOp", () => {
  const shelf = { folder: "projects", name: "Projects", definition: "Work with a goal." };

  it("reads make, edit and remove, keeping only their own fields", () => {
    expect(parseShelfOp({ op: "make", shelf: { ...shelf, extra: 1 } })).toEqual({ op: "make", shelf });
    expect(parseShelfOp({ op: "make", shelf, fromSuggestion: "projects" })).toEqual({ op: "make", shelf, fromSuggestion: "projects" });
    expect(parseShelfOp({ op: "edit", folder: "projects", name: "Work" })).toEqual({ op: "edit", folder: "projects", name: "Work" });
    expect(parseShelfOp({ op: "edit", folder: "projects", definition: "Jobs." })).toEqual({ op: "edit", folder: "projects", definition: "Jobs." });
    expect(parseShelfOp({ op: "remove", folder: "projects", name: "x" })).toEqual({ op: "remove", folder: "projects" });
  });

  it("refuses what isn't one", () => {
    const broken: unknown[] = [
      null,
      "make",
      { op: "rename", folder: "projects" },
      { op: "make" },
      { op: "make", shelf: { ...shelf, definition: undefined } },
      { op: "make", shelf, fromSuggestion: 3 },
      { op: "edit" },
      { op: "edit", folder: "projects", name: null },
      { op: "edit", folder: "projects", definition: 7 },
      { op: "remove", folder: ["projects"] },
    ];
    for (const raw of broken) expect(parseShelfOp(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe("ownShelvesInfo", () => {
  it("lists the own shelves in their order with their pages, then each hand-made folder with no definition", () => {
    const counts = { goals: 2, ideas: 1, meetings: 4, garden: 3, projects: 5, "side-work": 0 };
    const shelves = [
      { folder: "projects", name: "Projects", definition: "Work with a goal." },
      { folder: "reading", name: "Reading", definition: "Books to read." },
    ];
    expect(ownShelvesInfo(shelves, counts)).toEqual([
      { folder: "projects", name: "Projects", definition: "Work with a goal.", pages: 5 },
      { folder: "reading", name: "Reading", definition: "Books to read.", pages: 0 }, // its folder isn't there yet
      { folder: "garden", name: "garden", definition: "", pages: 3 },
      { folder: "side-work", name: "side-work", definition: "", pages: 0 },
    ]);
    expect(ownShelvesInfo([], { goals: 1, meetings: 0 })).toEqual([]); // Avanzel's own shelves, meetings among them, are never listed
  });
});

describe("shelfUndoneNote", () => {
  it("says the shelf is gone and the pages are back, and that Library asks again when it does", () => {
    expect(shelfUndoneNote("Projects", true)).toBe("The Projects shelf is gone, and its pages are back where they were. Library asks about it again.");
    expect(shelfUndoneNote("Projects", false)).toBe("The Projects shelf is gone, and its pages are back where they were.");
  });
});

describe("shelfMadeLine", () => {
  it("says what moved, in one page or many, and what stayed because its name was taken", () => {
    expect(shelfMadeLine("Projects", 1, 0)).toBe("Made the Projects shelf and moved 1 page.");
    expect(shelfMadeLine("Projects", 2, 0)).toBe("Made the Projects shelf and moved 2 pages.");
    expect(shelfMadeLine("Projects", 0, 1)).toBe("Made the Projects shelf and moved 0 pages. 1 page stayed where it was, as one with its name is already there.");
    expect(shelfMadeLine("Projects", 1, 2)).toBe("Made the Projects shelf and moved 1 page. 2 pages stayed where they were, as ones with their names are already there.");
  });
});
