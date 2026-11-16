import { describe, expect, it } from "vitest";
import { draftOf, editOf, initialStyle, reviewKey, studyApplyOf, studyReady, type ShelfEdit } from "../src/renderer/settings/study-apply.ts";
import type { ProposedShelf, StudyProposal } from "../src/shared/ipc.ts";

const shelf = (fields: Partial<ProposedShelf> & { folder: string }): ProposedShelf => ({
  name: fields.folder,
  definition: `Notes about ${fields.folder}.`,
  map: "",
  confidence: "high",
  studied: true,
  hasDefinition: false,
  ...fields,
});

const proposal = (shelves: ProposedShelf[], style = "Dates as dd.mm.yyyy.", currentStyle = ""): StudyProposal => ({
  shelves,
  style,
  currentStyle,
  attachments: [],
  clashes: [],
  styleInAgents: true,
});

/** An edit as the review screen keeps it: by default untouched, with nothing typed. */
const edit = (fields: Partial<ShelfEdit>): ShelfEdit => ({ fileHere: true, switched: false, definition: "", map: "", ...fields });

describe("what the review screen starts with", () => {
  it("turns a folder on when it has something to say what belongs on it, and off when it has nothing, the switch untouched", () => {
    expect(editOf(shelf({ folder: "Philosophy", map: "Stoicism/" }))).toEqual({
      fileHere: true,
      switched: false,
      definition: "Notes about Philosophy.",
      map: "Stoicism/",
    });
    expect(editOf(shelf({ folder: "Scans", definition: "", studied: false })).fileHere).toBe(false);
    expect(editOf(shelf({ folder: "Diary", hasDefinition: true })).fileHere).toBe(true);
  });

  it("takes the study's house style, or the style in use when the study wrote none", () => {
    expect(initialStyle(proposal([], "New style.", "Old style."))).toBe("New style.");
    expect(initialStyle(proposal([], "  ", "Old style."))).toBe("Old style.");
    expect(initialStyle(proposal([], "", ""))).toBe("");
    expect(draftOf(proposal([shelf({ folder: "A" })], "", "Old style."))).toEqual({
      edits: [{ fileHere: true, switched: false, definition: "Notes about A.", map: "" }],
      style: "Old style.",
    });
  });

  it("keys a draft by its library and its proposal, so another library's or another study's starts afresh", () => {
    const one = proposal([shelf({ folder: "A" })]);
    expect(reviewKey("/lib", one)).toBe(reviewKey("/lib", proposal([shelf({ folder: "A" })])));
    expect(reviewKey("/lib", one)).not.toBe(reviewKey("/other", one));
    expect(reviewKey("/lib", one)).not.toBe(reviewKey("/lib", proposal([shelf({ folder: "B" })])));
  });
});

describe("what Apply sends", () => {
  it("files into a folder that is already a shelf, keeping its definition, whatever the switch says", () => {
    const p = proposal([shelf({ folder: "Diary", definition: "Days.", hasDefinition: true, map: "one note per year" })]);
    const sent = studyApplyOf(p, { edits: [edit({ fileHere: false, switched: true, definition: "typed over", map: "  one note per month  " })], style: "S" });
    expect(sent.shelves).toEqual([{ folder: "Diary", name: "Diary", definition: "Days.", map: "one note per month", fileHere: true }]);
  });

  it("leaves out a folder the owner turned off, and trims what was typed", () => {
    const p = proposal([shelf({ folder: "Recipes" }), shelf({ folder: "Work", name: "Work things" })], "x");
    const sent = studyApplyOf(p, {
      edits: [
        edit({ fileHere: false, switched: true, definition: "Food." }),
        edit({ fileHere: true, definition: "  Projects with a goal.  ", map: "\nclients/\n" }),
      ],
      style: "  Short titles.\n",
    });
    expect(sent).toEqual({
      shelves: [
        { folder: "Recipes", name: "Recipes", definition: "Food.", map: "", fileHere: false },
        { folder: "Work", name: "Work things", definition: "Projects with a goal.", map: "clients/", fileHere: true },
      ],
      style: "Short titles.",
    });
  });

  it("skips a folder that started off and was never touched, as a folder that wasn't studied does, so it isn't left out for good", () => {
    const scans = shelf({ folder: "Scans", definition: "", studied: false });
    const p = proposal([scans, shelf({ folder: "Old", definition: "" })]);
    const sent = studyApplyOf(p, draftOf(p));
    expect(sent.shelves.map((item) => item.fileHere)).toEqual(["skip", "skip"]);
    // Turned on and off again, it was the owner's choice: left out.
    const back = studyApplyOf(p, { edits: [edit({ fileHere: false, switched: true }), edit({ fileHere: true, definition: "Old things." })], style: "" });
    expect(back.shelves.map((item) => item.fileHere)).toEqual([false, true]);
  });

  it("is ready once every folder turned on that isn't a shelf yet says what belongs on it", () => {
    const p = proposal([shelf({ folder: "A" }), shelf({ folder: "B", definition: "Kept.", hasDefinition: true })]);
    expect(studyReady(p, [edit({ definition: "Something." }), edit({})])).toBe(true);
    expect(studyReady(p, [edit({ definition: "   " }), edit({})])).toBe(false);
    expect(studyReady(p, [edit({ fileHere: false }), edit({ fileHere: false })])).toBe(true);
  });
});
