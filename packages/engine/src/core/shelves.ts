// The owner's own shelves: what a shelf is, and the rules that keep a folder, a name and a definition safe to use.
//
// The shelf list and the shelves the owner turned down live in `.avanzel/config.toml` (see config.ts); this file holds the rules both
// the settings reader and the app's shelf form check against.

import { slugify } from "./vault.ts";

/** The shelves every library starts with. Kept here, and re-exported by vault.ts, so these rules can use them while vault.ts loads. */
export const SHELVES = ["goals", "ideas", "problems", "memories", "people", "topics"] as const;
/** Top-level folders that are not shelves. */
export const SPECIAL_DIRS: readonly string[] = ["inbox", "raw", "reviews", "tasks"];

/** A shelf the owner made: a folder in the library and what belongs on it. */
export interface OwnShelf {
  folder: string;
  name: string;
  definition: string;
}

/** The shelves Avanzel itself keeps: the six, and meetings (whose definition comes from Avanzel). */
export const BUILT_IN_SHELVES: readonly string[] = [...SHELVES, "meetings"];

export const MAX_OWN_SHELVES = 20;
export const MAX_SHELF_NAME = 40;
export const MAX_SHELF_DEFINITION = 300;
export const MAX_SHELF_FOLDER = 40;

/**
 * Why `folder` can't be a new shelf's folder, as a sentence the owner can read, or null when it can. `taken` is the folders of the
 * existing own shelves only: a folder already on disk that isn't one of them is adopted, not refused.
 */
export function folderProblem(folder: string, taken: readonly string[]): string | null {
  if (folder === "") return "A shelf needs a folder name. Type one in lowercase letters, digits and dashes.";
  if (folder.startsWith(".")) return "A folder name can't start with a dot. Choose another folder name.";
  if (folder.length > MAX_SHELF_FOLDER) {
    return `A folder name can be at most ${MAX_SHELF_FOLDER} characters, and this one has ${folder.length}. Choose a shorter folder name.`;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(folder)) {
    return "A folder name uses lowercase letters a to z, digits and single dashes, with no spaces. Choose another folder name.";
  }
  if (BUILT_IN_SHELVES.includes(folder)) return `${folder} is one of Avanzel's own shelves. Choose another folder name.`;
  if (SPECIAL_DIRS.includes(folder)) return `${folder} is a folder Avanzel keeps for itself. Choose another folder name.`;
  if (taken.includes(folder)) return `A shelf called ${folder} already exists. Choose another folder name.`;
  return null;
}

/** A definition as one safe line: whitespace collapsed, the characters and strings the AGENTS.md table can't hold removed, cut to length. */
export function cleanDefinition(text: string): string {
  // Removing one piece can join its neighbours into another (`av|anzel:shelves`), so repeat until nothing is left to remove.
  let kept = text;
  for (let before = ""; before !== kept; ) {
    before = kept;
    kept = kept.replace(/[|`<>]|\[\[|\]\]|avanzel:shelves/g, "");
  }
  const line = kept.replace(/\s+/g, " ").trim();
  return [...line].slice(0, MAX_SHELF_DEFINITION).join("").trim();
}

function shelfKey(text: string): string {
  return text.trim().toLowerCase().replace(/s$/, "");
}

/** Two shelves are the same when their folders or names match, ignoring case and one trailing "s". */
export function sameShelf(a: string, b: string): boolean {
  return shelfKey(a) === shelfKey(b);
}

/** A folder to suggest for a shelf name, made as page slugs are. Empty when the name has no Latin letters or digits. */
export function suggestFolder(name: string): string {
  return slugify(name, 5, MAX_SHELF_FOLDER);
}
