// The review screen's draft of a study's proposal and the Apply it becomes (`settings.applyStudy`), with no window or bridge in it, so the
// tests can hold it: which folders start turned on, the house style it starts with, when Apply can be pressed, and what Apply sends.
import type { ProposedShelf, StudyApply, StudyProposal } from "../../shared/ipc.ts";

/**
 * What the owner made of one proposed folder: whether to file into it, whether the owner turned its switch themselves (`switched`), and
 * its definition and map as they stand in the fields.
 */
export interface ShelfEdit {
  fileHere: boolean;
  switched: boolean;
  definition: string;
  map: string;
}

/** The review screen's draft: each proposed folder's edit, in the proposal's order, and the house style as it stands in its field. */
export interface ReviewDraft {
  edits: ShelfEdit[];
  style: string;
}

/**
 * A folder starts turned on when it has something to say what belongs on it: an unstudied folder with no definition starts off, so Apply
 * isn't held back by a field the owner never asked for. A folder that is already one of the owner's shelves is always filed into.
 */
export const editOf = (shelf: ProposedShelf): ShelfEdit => ({
  fileHere: shelf.hasDefinition || shelf.definition.trim() !== "",
  switched: false,
  definition: shelf.definition,
  map: shelf.map,
});

/** The house style the field starts with: the study's, or, when it wrote none, the style in use, which Apply would otherwise wipe. */
export const initialStyle = (proposal: StudyProposal): string => (proposal.style.trim() !== "" ? proposal.style : proposal.currentStyle);

/** The draft a proposal starts as. */
export const draftOf = (proposal: StudyProposal): ReviewDraft => ({ edits: proposal.shelves.map(editOf), style: initialStyle(proposal) });

/** What a draft is kept under: its library and its proposal, so another library's or a later study's review starts afresh. */
export const reviewKey = (library: string, proposal: StudyProposal): string => `${library}\n${JSON.stringify(proposal)}`;

/** Whether Apply can be pressed: every folder turned on that isn't a shelf yet says what belongs on it. */
export function studyReady(proposal: StudyProposal, edits: readonly ShelfEdit[]): boolean {
  return proposal.shelves.every((shelf, i) => {
    const edit = edits[i] ?? editOf(shelf);
    return shelf.hasDefinition || !edit.fileHere || edit.definition.trim() !== "";
  });
}

/**
 * What Apply sends, folder by folder, trimmed: a folder that is already the owner's shelf is always filed into and keeps its definition
 * (Apply gives it only its map); any other is filed into as its switch says, with the definition typed. A folder that is off is left out
 * (and remembered so) only when the owner switched it off; one that started off and was never touched (a folder that wasn't studied) is
 * skipped, which leaves it as it is for a later study.
 */
export function studyApplyOf(proposal: StudyProposal, draft: ReviewDraft): StudyApply {
  return {
    shelves: proposal.shelves.map((shelf, i) => {
      const edit = draft.edits[i] ?? editOf(shelf);
      return {
        folder: shelf.folder,
        name: shelf.name,
        definition: shelf.hasDefinition ? shelf.definition : edit.definition.trim(),
        map: edit.map.trim(),
        fileHere: shelf.hasDefinition || edit.fileHere ? true : edit.switched ? false : "skip",
      };
    }),
    style: draft.style.trim(),
  };
}
