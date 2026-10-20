// Writing inside the library without ever following a symlink. After an agent run, anything below
// the library root may have been swapped for a link to somewhere else; Avanzel's own writes (the
// guard's restores, the log line, reports, the archive) go through these and refuse instead.

import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

export function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Whether every folder from the library root down to `rel` (vault-relative, `/`-separated) is a
 * real folder inside the library, creating missing ones when asked — except `.git`: git takes a
 * half-made `.git` for no repository at all and goes looking for one in the folders above.
 */
export function realFoldersTo(root: string, rel: string, create: boolean): boolean {
  const parts = rel.split("/").slice(0, -1);
  for (let depth = 1; depth <= parts.length; depth++) {
    const folder = join(root, ...parts.slice(0, depth));
    const stat = lstatOrNull(folder);
    if (stat === null) {
      if (!create || (depth === 1 && parts[0] === ".git")) return false;
      mkdirSync(folder);
    } else if (!stat.isDirectory()) {
      return false; // a symlink, or a file, on the way
    }
  }
  const realRoot = realpathSync(root);
  const realFolder = realpathSync(join(root, ...parts));
  return realFolder === realRoot || realFolder.startsWith(`${realRoot}${sep}`);
}

/** Write `data` at `rel` itself, replacing whatever is there; never through a symlink or outside the library (else not at all). */
export function writeInside(root: string, rel: string, data: Buffer | string): void {
  if (!realFoldersTo(root, rel, true)) return;
  const path = join(root, rel);
  if (lstatOrNull(path)) rmSync(path, { recursive: true, force: true });
  writeFileSync(path, data);
}

/** Create `rel` holding `data` unless anything at all (a dangling link too) is there; false when not created. */
export function createInside(root: string, rel: string, data: string): boolean {
  if (!realFoldersTo(root, rel, true)) return false;
  try {
    writeFileSync(join(root, rel), data, { encoding: "utf8", flag: "wx" }); // O_EXCL: fails on any existing entry
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Put a fresh file holding `data` at `rel`: written aside, then renamed over the old one. A symlink
 * at `rel` is replaced, not followed, and a file that another hard link shares is left as it was.
 */
export function replaceInside(root: string, rel: string, data: string): boolean {
  if (!realFoldersTo(root, rel, true)) return false;
  const path = join(root, rel);
  const partial = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(partial, data, { encoding: "utf8", flag: "wx" });
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
  return true;
}

/** Remove `rel` itself (a symlink, not what it points to), never through a symlink or outside the library. */
export function removeInside(root: string, rel: string): void {
  if (realFoldersTo(root, rel, false)) rmSync(join(root, rel), { recursive: true, force: true });
}
