import { describe, expect, it } from "vitest";
import { undoRefused } from "../src/shared/problems.ts";
import type { StudyProposal } from "../src/shared/ipc.ts";
import { parseStudyApply, studyEndedState, studyOffered, studyUndoNotice, unlearnedFoldersOf } from "../src/main/study-state.ts";

const PROPOSAL: StudyProposal = {
  shelves: [{ folder: "Philosophy", name: "Philosophy", definition: "Thinkers and their books.", map: "", confidence: "high", studied: true, hasDefinition: false }],
  style: "Write in short paragraphs.",
  currentStyle: "",
  attachments: [],
  clashes: [],
};

describe("studyOffered", () => {
  it("offers the study for folders of the owner's own, once, and not while one runs or waits", () => {
    expect(studyOffered(["Philosophy"], { kind: "idle", resumable: false }, [], "/lib")).toBe(true);
    expect(studyOffered(["Philosophy"], { kind: "idle", resumable: false }, ["/lib"], "/lib")).toBe(false);
    expect(studyOffered([], { kind: "idle", resumable: false }, [], "/lib")).toBe(false);
    expect(studyOffered(["Philosophy"], { kind: "running", done: 0, steps: 3, current: "", stopping: false }, [], "/lib")).toBe(false);
  });

  it("is not made while a proposal waits for review, and is made again for a study that stopped or failed", () => {
    expect(studyOffered(["Philosophy"], { kind: "ready", proposal: PROPOSAL }, [], "/lib")).toBe(false);
    expect(studyOffered(["Philosophy"], { kind: "idle", resumable: true }, [], "/lib")).toBe(true);
    expect(studyOffered(["Philosophy"], { kind: "failed", message: "The study paused because the agent is signed out." }, [], "/lib")).toBe(true);
  });

  it("is dismissed for one library only", () => {
    expect(studyOffered(["Philosophy"], { kind: "idle", resumable: false }, ["/other"], "/lib")).toBe(true);
  });
});

describe("unlearnedFoldersOf", () => {
  it("counts as unlearned only folders that are no built-in or own shelf and not excluded, in any Unicode form", () => {
    expect(unlearnedFoldersOf({ ideas: 1, Philosophy: 3, "Мой": 2, Архив: 1 }, [], ["архив"])).toEqual(["Philosophy", "Мой"]);
  });

  it("leaves out the owner's own shelves and Avanzel's folders in any case or Unicode form", () => {
    const decomposed = "Мой".normalize("NFD");
    const shelves = [{ folder: "Мой", name: "Мой", definition: "Mine." }];
    expect(unlearnedFoldersOf({ [decomposed]: 2, Ideas: 1, Inbox: 4, Meetings: 1, Work: 5 }, shelves, [])).toEqual(["Work"]);
  });

  it("leaves out a folder with no notes (attachments only), which the study doesn't study, and a folder excluded with a slash", () => {
    expect(unlearnedFoldersOf({ Pictures: 0, Work: 2, Old: 3 }, [], ["Old/"])).toEqual(["Work"]);
  });
});

describe("studyEndedState", () => {
  it("is ready with the proposal of a study that finished", () => {
    expect(studyEndedState({ proposal: PROPOSAL })).toEqual({ kind: "ready", proposal: PROPOSAL });
  });

  it("can be resumed after a stop, told by the engine's words or by the stop itself", () => {
    const stopped = "The study was stopped. What it learned so far is kept, and Learn this library goes on from there.";
    expect(studyEndedState({ message: stopped, aborted: false })).toEqual({ kind: "idle", resumable: true });
    expect(studyEndedState({ message: "anything", aborted: true })).toEqual({ kind: "idle", resumable: true });
  });

  it("failed with the engine's words otherwise", () => {
    const paused = "The study paused because the agent hit its usage limit. What it learned so far is kept, and Learn this library goes on from there.";
    expect(studyEndedState({ message: paused, aborted: false })).toEqual({ kind: "failed", message: paused });
  });
});

describe("parseStudyApply", () => {
  const item = { folder: "Philosophy", name: "Philosophy", definition: "Thinkers and their books.", map: "Thinkers/: one per thinker", fileHere: true };

  it("keeps the fields of a whole choice, and nothing else", () => {
    expect(parseStudyApply({ shelves: [{ ...item, extra: 1 }], style: "Short.", more: true })).toEqual({ shelves: [item], style: "Short." });
    expect(parseStudyApply({ shelves: [], style: "" })).toEqual({ shelves: [], style: "" });
  });

  it("is null for anything that isn't whole", () => {
    expect(parseStudyApply(null)).toBeNull();
    expect(parseStudyApply({ shelves: [item] })).toBeNull();
    expect(parseStudyApply({ shelves: "Philosophy", style: "" })).toBeNull();
    expect(parseStudyApply({ shelves: [{ ...item, fileHere: "yes" }], style: "" })).toBeNull();
    expect(parseStudyApply({ shelves: [{ ...item, map: undefined }], style: "" })).toBeNull();
  });
});

describe("studyUndoNotice", () => {
  it("says the shelves and the house style are gone, and the notes are where they were", () => {
    expect(studyUndoNotice(true)).toEqual({
      title: "Undone",
      body: "The shelves and the house style that Learn this library set up are gone. Your notes are where they were.",
    });
  });

  it("is told as any refused Undo when git refused", () => {
    expect(studyUndoNotice(false)).toEqual(undoRefused);
  });
});
