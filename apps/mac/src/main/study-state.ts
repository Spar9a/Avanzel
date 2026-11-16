// Learn this library as the windows see it (`StudyState`): whether the panel offers it, which folders it would study, what a study that
// ended leaves, and what its Apply's Undo tells. Pure: the controller runs the study (`Controller.startStudy`).
import { BUILT_IN_SHELVES, folderKey, SPECIAL_DIRS, type OwnShelf } from "@avanzel/engine";
import type { StudyApply, StudyProposal, StudyState } from "../shared/ipc.ts";
import { undoRefused, type Problem } from "../shared/problems.ts";

/** How the engine's words for a stopped study begin (`Librarian.study`). */
const STOPPED = "The study was stopped.";

/**
 * Whether the panel offers Learn this library for the library at `library`: it has folders of the owner's own (`unlearned`), no study runs
 * or waits for review, and the offer wasn't put away there (`dismissed`, library paths). A study that stopped or failed is offered again.
 */
export function studyOffered(unlearned: readonly string[], study: StudyState, dismissed: readonly string[], library: string): boolean {
  if (unlearned.length === 0 || study.kind === "running" || study.kind === "ready") return false;
  return !dismissed.includes(library);
}

/**
 * The top-level folders (`counts`: each with how many notes it holds, as `Vault.shelfCounts` gives them) that Learn this library would
 * study: those that hold notes and are none of Avanzel's own (its shelves and its folders), none of the owner's shelves, and not left out
 * (`excluded`, as config.toml keeps them, maybe with a slash). Folders are compared as the disk does, in one Unicode form and case
 * (`folderKey`). In `counts`' order.
 */
export function unlearnedFoldersOf(counts: Readonly<Record<string, number>>, shelves: readonly OwnShelf[], excluded: readonly string[]): string[] {
  const known = new Set([
    ...BUILT_IN_SHELVES,
    ...SPECIAL_DIRS,
    ...shelves.map((shelf) => shelf.folder),
    ...excluded.map((folder) => folder.replace(/\/+$/, "")),
  ].map(folderKey));
  return Object.entries(counts)
    .filter(([folder, notes]) => notes > 0 && !folder.startsWith(".") && !known.has(folderKey(folder)))
    .map(([folder]) => folder);
}

/**
 * What a study that ended leaves: its proposal, ready for review; after a stop (`aborted`, or the engine's words for one), a study that
 * goes on from where it stopped; otherwise a failure, in the engine's words ("The study paused because …").
 */
export function studyEndedState(end: { proposal: StudyProposal } | { message: string; aborted: boolean }): StudyState {
  if ("proposal" in end) return { kind: "ready", proposal: end.proposal };
  if (end.aborted || end.message.startsWith(STOPPED)) return { kind: "idle", resumable: true };
  return { kind: "failed", message: end.message };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the review screen sent to Apply: its fields of the right types, in one order, or null when any is missing or wrong. Anything else goes. */
export function parseStudyApply(raw: unknown): StudyApply | null {
  if (!isObject(raw) || typeof raw.style !== "string" || !Array.isArray(raw.shelves)) return null;
  const shelves: StudyApply["shelves"] = [];
  for (const item of raw.shelves) {
    if (!isObject(item)) return null;
    const { folder, name, definition, map, fileHere } = item;
    if (typeof folder !== "string" || typeof name !== "string" || typeof definition !== "string" || typeof map !== "string" || typeof fileHere !== "boolean") {
      return null;
    }
    shelves.push({ folder, name, definition, map, fileHere });
  }
  return { shelves, style: raw.style };
}

/** What is told once an Undo has taken back a study's Apply (by notification: no filed card is of it), or the refusal of any Undo. */
export function studyUndoNotice(undone: boolean): Problem {
  if (!undone) return undoRefused;
  return { title: "Undone", body: "The shelves and the house style that Learn this library set up are gone. Your notes are where they were." };
}
