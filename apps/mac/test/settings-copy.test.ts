import { describe, expect, it } from "vitest";
import { asSentence, libraryLine, PANE_LABELS } from "../src/renderer/settings/copy.ts";
import { SETTINGS_PANES } from "../src/shared/ipc.ts";

describe("settings copy", () => {
  it("the toolbar lists the panes in their order", () => {
    expect(SETTINGS_PANES.map((pane) => PANE_LABELS[pane])).toEqual(["General", "Voice", "Agents", "Reviews", "Privacy"]);
  });

  it("libraryLine counts the six shelves' pages and says whether changes can be undone", () => {
    const shelves = { goals: 12, ideas: 41, problems: 9, memories: 18, people: 27, topics: 21 };
    expect(libraryLine(shelves, true)).toBe("128 pages on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({ ideas: 1 }, true)).toBe("1 page on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({}, true)).toBe("Your first thought will fill a shelf. Every change is a commit you can undo.");
    // A folder of the library's own that isn't one of the six shelves doesn't count.
    expect(libraryLine({ ideas: 2, projects: 5 }, false)).toBe("2 pages on six shelves. This folder has no git history, so changes can't be undone.");
  });

  it("asSentence ends a line with a full stop once", () => {
    expect(asSentence("Avanzel couldn't open the library at /x: EACCES: permission denied, mkdir '/x/tasks'")).toBe(
      "Avanzel couldn't open the library at /x: EACCES: permission denied, mkdir '/x/tasks'.",
    );
    expect(asSentence("Done.")).toBe("Done.");
    expect(asSentence("Is it open?")).toBe("Is it open?");
    expect(asSentence("Waiting…")).toBe("Waiting…");
  });
});
