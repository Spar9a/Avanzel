// What the setup window decides from plain data: names for places, and what is at the library's place. No Electron,
// so the tests run them as they are.
import { existsSync, opendirSync, statSync } from "node:fs";
import { Vault } from "@avanzel/engine";
import type { LibraryFolder } from "../shared/ipc.ts";

/** `target` with the home folder as "~": only the folder itself, so /Users/ab stays as it is when home is /Users/a. */
export function tildePath(target: string, home: string): string {
  if (target === home) return "~";
  return target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}

/**
 * What is at the library's place now: nothing ("missing"), an Avanzel library, a folder holding nothing but Finder's
 * .DS_Store ("empty"), or anything else ("has-files"), a file in the folder's place included.
 */
export function libraryFolder(target: string): LibraryFolder {
  if (!existsSync(target)) return "missing";
  if (new Vault(target).exists()) return "library";
  try {
    return statSync(target).isDirectory() && onlyDsStore(target) ? "empty" : "has-files";
  } catch {
    return "has-files"; // a folder it can't read may hold anything: never taken for an empty one
  }
}

/** Whether `folder` holds nothing but .DS_Store. It reads no further than the first other entry: setup asks often. */
function onlyDsStore(folder: string): boolean {
  const dir = opendirSync(folder);
  try {
    for (let entry = dir.readSync(); entry; entry = dir.readSync()) if (entry.name !== ".DS_Store") return false;
    return true;
  } finally {
    dir.closeSync();
  }
}
