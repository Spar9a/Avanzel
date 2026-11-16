// The owner's notes from before Avanzel learned the library. A run may add to one of them but never rewrite or delete it, and it
// may not touch a folder the owner left out. The agent is told so; this is the check behind that, from what was read beforehand
// (so it holds in a library with no git, and in one where the owner's changes are not committed yet).

import { lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Changes } from "./changes.ts";
import { lstatOrNull, realFoldersTo, removeInside, replaceInside, writeInside } from "./inside.ts";
import { folderKey } from "./shelves.ts";

/** `{ "version": 1, "notes": string[] }`: library-relative paths of the notes that were there when the library was learned, in NFC. */
export const LEARNED_NOTES = ".avanzel/learned-notes.json";

/** The learned notes, as NFC paths; empty when the file is missing or can't be read. */
export function readLearnedNotes(root: string): Set<string> {
  try {
    const path = join(root, LEARNED_NOTES);
    if (!lstatOrNull(path)?.isFile()) return new Set();
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null) return new Set();
    const { version, notes } = data as { version?: unknown; notes?: unknown };
    if (version !== 1 || !Array.isArray(notes)) return new Set();
    return new Set(notes.filter((note): note is string => typeof note === "string").map((note) => note.normalize("NFC")));
  } catch {
    return new Set();
  }
}

/** Add `notes` to the learned ones. The list is written aside and renamed over the old one, so a half-written file never drops the protection. */
export function addLearnedNotes(root: string, notes: readonly string[]): void {
  const all = readLearnedNotes(root);
  for (const note of notes) all.add(note.normalize("NFC"));
  const text = `${JSON.stringify({ version: 1, notes: [...all].sort() }, null, 2)}\n`;
  if (!replaceInside(root, LEARNED_NOTES, text)) throw new Error(`${LEARNED_NOTES} could not be written inside the library.`);
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
 * Undo what `changes` did to what `captureKept` read: a learned note that was deleted, or whose lines were not all kept, gets its old bytes
 * back; anything created, changed or deleted under an excluded folder is put back as it was (what was created is removed; a file or link
 * made where the folder was is cleared away). Only what was really done is reported: the paths put back or removed, sorted.
 */
export function restoreKept(root: string, kept: KeptNotes, changes: Changes): string[] {
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
  return [...done].sort();
}
