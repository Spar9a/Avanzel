// A recording kept in a library's inbox, where the evening review finds audio (the engine's queue transcribes what the inbox
// holds): moved by a rename, or written from its samples, under its own name or the next free one. Nothing here knows Electron,
// so that the unit tests reach it.
import { lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * `name` in `folder`, or when the folder has it, the first of `name-2`, `name-3` … (before the extension) that it has not:
 * nothing there is replaced. A name is taken by anything at all: a file, a folder, or a link, even one with nothing at its end.
 * It is looked at with lstat, which doesn't follow a link, since a rename would replace the link itself, and a write would go
 * through it and make or overwrite a file where it leads. The folder needn't exist.
 */
export function freePath(folder: string, name: string): string {
  const { name: stem, ext } = path.parse(name);
  for (let n = 1; ; n++) {
    const candidate = path.join(folder, n === 1 ? name : `${stem}-${n}${ext}`);
    try {
      lstatSync(candidate);
    } catch {
      return candidate; // nothing there; or nothing that can be told, which what is done with the name then reports
    }
  }
}

/**
 * Moves `file` into `folder` (made when it is missing) by a rename, under its own name or the next free one (`freePath`), and
 * returns the path it has now. The same file, not a copy; the one thing a rename does that this must not is replace what it finds,
 * so the name is looked for first. Throws, with the file where it was, when the folder can't take it.
 */
export function moveInto(folder: string, file: string): string {
  mkdirSync(folder, { recursive: true });
  const to = freePath(folder, path.basename(file));
  renameSync(file, to);
  return to;
}

/**
 * Has `write` write a new file in `folder` (made when it is missing) under `name` or the next free one (`freePath`), and returns
 * its path. A file `write` leaves half written is ours, and is removed before what `write` threw is thrown again; should that
 * removal fail too, it is what `write` threw that is told.
 */
export function writeInto(folder: string, name: string, write: (file: string) => void): string {
  mkdirSync(folder, { recursive: true });
  const to = freePath(folder, name);
  try {
    write(to);
  } catch (error) {
    try {
      rmSync(to, { force: true });
    } catch {
      // the partial file stays; the failure to tell is the write's
    }
    throw error;
  }
  return to;
}
