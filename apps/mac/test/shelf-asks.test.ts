import { describe, expect, it } from "vitest";
import { askOf, libraryAskOf, ownShelvesInfo, parseShelfAsk, parseShelfOp, shelfUndoNotice } from "../src/main/shelf-asks.ts";
import { undoRefused } from "../src/shared/problems.ts";
import { shelfMadeLine, shelfMadeNotes, shelfUndoneNote } from "../src/shared/shelves.ts";

const ASK = { folder: "projects", name: "Projects", definition: "Work with a goal and a deadline.", agentMade: false };

describe("askOf", () => {
  it("is a pending suggestion without its pages", () => {
    expect(askOf({ ...ASK, pages: [{ path: "ideas/launch.md", captureId: "c1" }] } as Parameters<typeof askOf>[0])).toEqual(ASK);
  });
});

describe("libraryAskOf", () => {
  it("is a pending suggestion as Library asks about it: with how many pages Make shelf would move", () => {
    const pages = [
      { path: "ideas/launch.md", captureId: "c1" },
      { path: "ideas/plan.md", captureId: "c2" },
    ];
    expect(libraryAskOf({ ...ASK, pages } as Parameters<typeof libraryAskOf>[0])).toEqual({ ...ASK, pages: 2 });
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
    const empty = (folder: string) => folder !== "projects" && folder !== "garden";
    expect(ownShelvesInfo(shelves, counts, empty)).toEqual([
      { folder: "projects", name: "Projects", definition: "Work with a goal.", pages: 5, empty: false },
      { folder: "reading", name: "Reading", definition: "Books to read.", pages: 0, empty: true }, // its folder isn't there yet
      { folder: "garden", name: "garden", definition: "", pages: 3, empty: false },
      { folder: "side-work", name: "side-work", definition: "", pages: 0, empty: true },
    ]);
    expect(ownShelvesInfo([], { goals: 1, meetings: 0 }, empty)).toEqual([]); // Avanzel's own shelves, meetings among them, are never listed
  });

  it("says an own shelf with no pages isn't empty when its folder holds something else", () => {
    const shelves = [{ folder: "trips", name: "Trips", definition: "Journeys." }];
    expect(ownShelvesInfo(shelves, { trips: 0 }, () => false)).toEqual([
      { folder: "trips", name: "Trips", definition: "Journeys.", pages: 0, empty: false },
    ]);
  });
});

describe("shelfUndoneNote", () => {
  it("says the shelf is gone and the pages are back, and that Library asks again when it does", () => {
    expect(shelfUndoneNote("Projects", true)).toBe("The Projects shelf is gone, and its pages are back where they were. Library asks about it again.");
    expect(shelfUndoneNote("Projects", false)).toBe("The Projects shelf is gone, and its pages are back where they were.");
  });
});

describe("shelfMadeLine, the bar's one line once Make shelf is done", () => {
  it("says what moved, in one page, many or none, and nothing of what stayed", () => {
    expect(shelfMadeLine("Projects", 1)).toBe("Made the Projects shelf and moved 1 page.");
    expect(shelfMadeLine("Projects", 2)).toBe("Made the Projects shelf and moved 2 pages.");
    expect(shelfMadeLine("Projects", 0)).toBe("Made the Projects shelf and moved no pages.");
  });
});

describe("shelfMadeNotes, the notifications once Make shelf is done", () => {
  const kept = (reason: "taken" | "missing", n: number) => Array.from({ length: n }, (_, at) => ({ path: `ideas/${reason}-${at}.md`, reason }));
  const TAKEN_ONE = "1 page stayed where it was, as a page with its name is already there.";
  const TAKEN_MANY = "2 pages stayed where they were, as pages with their names are already there.";
  const MISSING_ONE = "1 page wasn't moved, as it's no longer where it was filed.";
  const MISSING_MANY = "3 pages weren't moved, as they're no longer where they were filed.";

  it("adds none to the bar when every page moved", () => {
    expect(shelfMadeNotes("Projects", 2, [], true)).toEqual([]);
  });

  it("tells, beside the bar, the page that stayed, and the pages that stayed", () => {
    expect(shelfMadeNotes("Projects", 0, kept("taken", 1), true)).toEqual([{ title: "The Projects shelf is made", body: TAKEN_ONE }]);
    expect(shelfMadeNotes("Projects", 1, kept("taken", 2), true)).toEqual([{ title: "The Projects shelf is made", body: TAKEN_MANY }]);
  });

  it("tells, beside the bar, the page and the pages no longer where they were filed", () => {
    expect(shelfMadeNotes("Projects", 0, kept("missing", 1), true)).toEqual([{ title: "The Projects shelf is made", body: MISSING_ONE }]);
    expect(shelfMadeNotes("Projects", 1, kept("missing", 3), true)).toEqual([{ title: "The Projects shelf is made", body: MISSING_MANY }]);
  });

  it("tells both reasons in one notification", () => {
    expect(shelfMadeNotes("Projects", 0, [...kept("missing", 3), ...kept("taken", 1)], true)).toEqual([
      { title: "The Projects shelf is made", body: `${TAKEN_ONE} ${MISSING_MANY}` },
    ]);
    expect(shelfMadeNotes("Projects", 1, [...kept("taken", 2), ...kept("missing", 1)], false)).toEqual([
      { title: "Shelf made", body: `Made the Projects shelf and moved 1 page. ${TAKEN_MANY} ${MISSING_ONE}` },
    ]);
  });

  it("tells it all in one notification when there is no bar", () => {
    expect(shelfMadeNotes("Projects", 1, [], false)).toEqual([{ title: "Shelf made", body: "Made the Projects shelf and moved 1 page." }]);
    expect(shelfMadeNotes("Projects", 1, kept("taken", 1), false)).toEqual([
      { title: "Shelf made", body: `Made the Projects shelf and moved 1 page. ${TAKEN_ONE}` },
    ]);
    expect(shelfMadeNotes("Projects", 0, kept("missing", 1), false)).toEqual([
      { title: "Shelf made", body: `Made the Projects shelf and moved no pages. ${MISSING_ONE}` },
    ]);
  });
});

describe("shelfUndoNotice, what an Undo of Make shelf tells", () => {
  it("says Library asks again only when the suggestion is pending again", () => {
    expect(shelfUndoNotice(true, "Projects", true)).toEqual({ title: "Undone", body: "The Projects shelf is gone, and its pages are back where they were. Library asks about it again." });
    expect(shelfUndoNotice(true, "Projects", false)).toEqual({ title: "Undone", body: "The Projects shelf is gone, and its pages are back where they were." });
  });

  it("tells a refused one as any refused Undo, never that the words are in the inbox", () => {
    for (const restored of [true, false]) expect(shelfUndoNotice(false, "Projects", restored)).toEqual(undoRefused);
    for (const restored of [true, false]) expect(shelfUndoNotice(true, "Projects", restored).body).not.toMatch(/inbox/);
  });
});
