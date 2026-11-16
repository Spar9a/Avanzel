// The owner's notes on the shelves Avanzel learned from the library: every note there but the pages Avanzel made itself, whether it
// was written before the shelf was learned or after. A run may add to one of them but never rewrite or delete it, and it may not
// touch a folder the owner left out. The agent is told so; this is the check behind that, from what was read beforehand
// (so it holds in a library with no git, and in one where the owner's changes are not committed yet).

import { lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Changes } from "./changes.ts";
import { lstatOrNull, realFoldersTo, removeInside, replaceInside, writeInside } from "./inside.ts";
import { folderKey } from "./shelves.ts";

/**
 * `{ "version": 1, "notes": string[], "avanzel"?: string[] }`, library-relative paths in NFC. `notes`: the notes that were there when a
 * shelf was first learned (kept for libraries learned before the rule below). `avanzel`: the pages Avanzel itself made on learned shelves
 * since. Every other Markdown file on a learned shelf is the owner's note (`ownersNotes`), whenever it was written.
 */
export const LEARNED_NOTES = ".avanzel/learned-notes.json";

interface LearnedList {
  notes: Set<string>;
  avanzel: Set<string>;
}

const nfcStrings = (list: unknown): Set<string> =>
  new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").map((item) => item.normalize("NFC")) : []);

/** Both lists, as NFC paths; empty when the file is missing or can't be read. */
function readList(root: string): LearnedList {
  try {
    const path = join(root, LEARNED_NOTES);
    if (!lstatOrNull(path)?.isFile()) return { notes: new Set(), avanzel: new Set() };
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null) return { notes: new Set(), avanzel: new Set() };
    const { version, notes, avanzel } = data as { version?: unknown; notes?: unknown; avanzel?: unknown };
    if (version !== 1 || !Array.isArray(notes)) return { notes: new Set(), avanzel: new Set() };
    return { notes: nfcStrings(notes), avanzel: nfcStrings(avanzel) };
  } catch {
    return { notes: new Set(), avanzel: new Set() };
  }
}

/** The list written aside and renamed over the old one, so a half-written file never drops the protection. */
function writeList(root: string, list: LearnedList): void {
  const data = { version: 1, notes: [...list.notes].sort(), ...(list.avanzel.size ? { avanzel: [...list.avanzel].sort() } : {}) };
  if (!replaceInside(root, LEARNED_NOTES, `${JSON.stringify(data, null, 2)}\n`)) {
    throw new Error(`${LEARNED_NOTES} could not be written inside the library.`);
  }
}

/** The learned notes, as NFC paths; empty when the file is missing or can't be read. */
export function readLearnedNotes(root: string): Set<string> {
  return readList(root).notes;
}

/** Add `notes` to the learned ones. */
export function addLearnedNotes(root: string, notes: readonly string[]): void {
  const list = readList(root);
  for (const note of notes) list.notes.add(note.normalize("NFC"));
  writeList(root, list);
}

/** The pages Avanzel made on learned shelves, as NFC paths. */
export function readAvanzelPages(root: string): Set<string> {
  return readList(root).avanzel;
}

/** Remember `pages` as Avanzel's own, which a later run may rewrite; nothing is written when all of them are known already. */
export function addAvanzelPages(root: string, pages: readonly string[]): void {
  const list = readList(root);
  const before = list.avanzel.size;
  for (const page of pages) list.avanzel.add(page.normalize("NFC"));
  if (list.avanzel.size !== before) writeList(root, list);
}

/** Whether `rel` is a Markdown file somewhere under one of `folders` (`folderKey`s), below its top level. */
export function onFolders(folders: readonly string[], rel: string): boolean {
  const slash = rel.indexOf("/");
  return slash !== -1 && rel.toLowerCase().endsWith(".md") && folders.includes(folderKey(rel.slice(0, slash)));
}

/**
 * The owner's notes among `paths` (library-relative, as a snapshot's keys), as NFC paths: every Markdown file on a learned shelf
 * (`learnedFolders`) but the pages Avanzel made there (`readAvanzelPages`), whenever it was written, and every note of the older list.
 */
export function ownersNotes(root: string, learnedFolders: readonly string[], paths: Iterable<string>): Set<string> {
  const list = readList(root);
  const folders = learnedFolders.map(folderKey).filter((key) => key !== "");
  const owners = new Set(list.notes);
  if (folders.length === 0) return owners;
  for (const rel of paths) {
    const nfc = rel.normalize("NFC");
    if (onFolders(folders, rel) && !list.avanzel.has(nfc)) owners.add(nfc);
  }
  return owners;
}

function linesOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // the newline that ends the last line is not a line
  return lines;
}

/** Whether every line of `before`, in order, is a line of `after` (`\r\n` read as `\n`): text may be added anywhere, nothing taken out or changed. */
export function keepsOldLines(before: string, after: string): boolean {
  const kept = linesOf(after);
  let at = 0;
  for (const line of linesOf(before)) {
    while (at < kept.length && kept[at] !== line) at += 1;
    if (at === kept.length) return false;
    at += 1;
  }
  return true;
}

export interface KeptNotes {
  /** The bytes, by library path as it is on disk, of every learned note there was and every Markdown file under an excluded folder. */
  files: Map<string, Buffer>;
  /** The excluded folders as `folderKey`s. */
  folders: string[];
}

/** Whether `rel` is an excluded folder or inside one (compared with `folderKey`); a root file named like one stands where the folder was. */
function underExcluded(folders: readonly string[], rel: string): boolean {
  const slash = rel.indexOf("/");
  return folders.includes(folderKey(slash === -1 ? rel : rel.slice(0, slash)));
}

/**
 * Read what a run must not be able to lose: the bytes of every learned note that exists and of every Markdown file under an excluded
 * folder. `paths` is every library-relative file there is now, which the caller already has (a snapshot's keys); nothing is walked here.
 * Only Markdown under an excluded folder is read, since agents edit text: a file of another kind that a run creates there is still
 * removed, but one it changes or deletes is not put back.
 */
export function captureKept(root: string, learned: ReadonlySet<string>, excluded: readonly string[], paths: Iterable<string>): KeptNotes {
  const folders = excluded.map(folderKey).filter((key) => key !== "");
  const files = new Map<string, Buffer>();
  if (learned.size === 0 && folders.length === 0) return { files, folders };
  for (const rel of paths) {
    const asExcluded = underExcluded(folders, rel) && rel.toLowerCase().endsWith(".md");
    if (!asExcluded && !learned.has(rel.normalize("NFC"))) continue;
    try {
      if (!lstatSync(join(root, rel)).isFile()) continue; // a link can't be put back as the link it was
      files.set(rel, readFileSync(join(root, rel)));
    } catch {
      /* gone or unreadable meanwhile: nothing to keep */
    }
  }
  return { files, folders };
}

/** Take away a file or link that stands where a folder on `rel`'s path has to be, so the old file can go back under it. */
function clearObstacles(root: string, rel: string): void {
  const parts = rel.split("/").slice(0, -1);
  for (let depth = 1; depth <= parts.length; depth++) {
    const path = join(root, ...parts.slice(0, depth));
    const stat = lstatOrNull(path);
    if (stat === null) return;
    if (!stat.isDirectory()) rmSync(path, { force: true }); // a link is removed, never followed
  }
}

/**
 * What `restoreKept` really did, library-relative and sorted. `old`: learned notes put back as they were. `out`: what was put back or
 * removed under an excluded folder; a file the run made there is gone rather than kept, so it is told apart from the old notes.
 */
export interface RestoredKept {
  old: string[];
  out: string[];
}

/** Every path `restoreKept` put back or removed, which a run's changes leave out. */
export const keptPaths = (kept: RestoredKept): string[] => [...kept.old, ...kept.out];

/**
 * Undo what `changes` did to what `captureKept` read: a learned note that was deleted, or whose lines were not all kept, gets its old bytes
 * back; anything created, changed or deleted under an excluded folder is put back as it was (what was created is removed; a file or link
 * made where the folder was is cleared away). Only what was really done is reported: the learned notes put back (`old`), and the paths put
 * back or removed under an excluded folder (`out`), each sorted. A learned note under an excluded folder counts as `out`.
 */
export function restoreKept(root: string, kept: KeptNotes, changes: Changes): RestoredKept {
  const done = new Set<string>();
  const putBack = (rel: string, bytes: Buffer) => {
    clearObstacles(root, rel);
    if (!realFoldersTo(root, rel, true)) return;
    writeInside(root, rel, bytes);
    done.add(rel);
  };

  for (const rel of changes.created) {
    if (!underExcluded(kept.folders, rel) || kept.files.has(rel)) continue;
    removeInside(root, rel);
    if (lstatOrNull(join(root, rel)) === null) done.add(rel);
  }
  for (const rel of [...changes.modified, ...changes.deleted]) {
    const old = kept.files.get(rel);
    if (old === undefined) continue;
    if (underExcluded(kept.folders, rel) || changes.deleted.includes(rel)) {
      putBack(rel, old);
      continue;
    }
    const now = lstatOrNull(join(root, rel));
    let text: string | null = null;
    if (now?.isFile()) {
      try {
        text = readFileSync(join(root, rel), "utf8");
      } catch {
        text = null;
      }
    }
    if (text === null || !keepsOldLines(old.toString("utf8"), text)) putBack(rel, old);
  }
  const all = [...done].sort();
  const out = all.filter((rel) => underExcluded(kept.folders, rel));
  return { old: all.filter((rel) => !underExcluded(kept.folders, rel)), out };
}
