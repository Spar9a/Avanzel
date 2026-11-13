// The owner's own shelves: what a shelf is, and the rules that keep a folder, a name and a definition safe to use.
//
// The shelf list and the shelves the owner turned down live in `.avanzel/config.toml` (see config.ts); this file holds the rules both
// the settings reader and the app's shelf form check against.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lstatOrNull, replaceInside } from "./inside.ts";
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

/** What a definition can't hold: it goes in a Markdown table in `AGENTS.md`, between markers. */
const FORBIDDEN_IN_DEFINITION = /[|`<>]|\[\[|avanzel:shelves/;
const LINE_BREAK = /[\r\n\u2028\u2029]/;

/** Whether `definition` holds a character or string, or a line break, that a shelf's definition can't. */
export function definitionBreaksRules(definition: string): boolean {
  return FORBIDDEN_IN_DEFINITION.test(definition) || LINE_BREAK.test(definition);
}

/** Whether `name` holds a line break or the table separator `|`. */
export function nameBreaksRules(name: string): boolean {
  return name.includes("|") || LINE_BREAK.test(name);
}

/** How long `text` is as a shelf rule counts it: in characters a person sees as one each, not UTF-16 units. */
export function shelfTextLength(text: string): number {
  return [...text].length;
}

/** A definition as one safe line: whitespace collapsed, the characters and strings the AGENTS.md table can't hold removed, cut to length. */
export function cleanDefinition(text: string): string {
  // Removing one piece can join its neighbours into another (`av|anzel:shelves`), so repeat until nothing is left to remove.
  const forbidden = new RegExp(`${FORBIDDEN_IN_DEFINITION.source}|\\]\\]`, "g");
  let kept = text;
  for (let before = ""; before !== kept; ) {
    before = kept;
    kept = kept.replace(forbidden, "");
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

export const SHELF_SECTION_START = "<!-- avanzel:shelves -->";
export const SHELF_SECTION_END = "<!-- /avanzel:shelves -->";

const NO_SHELVES_LINE = "None yet. The owner adds them in Avanzel's Settings.";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A marker pair with no other start marker inside it, so a lone start marker never swallows the text up to a later pair's end. */
const SECTION_PAIR = new RegExp(
  `${escapeRegExp(SHELF_SECTION_START)}(?:(?!${escapeRegExp(SHELF_SECTION_START)})[\\s\\S])*?${escapeRegExp(SHELF_SECTION_END)}`,
  "g",
);

/** A cell of the shelves table: never holds the table separator, a backtick or a line break, whatever the shelf object holds. */
function tableCell(text: string): string {
  return text.replace(/[|`]/g, "").replace(new RegExp(LINE_BREAK.source, "g"), "").trim();
}

function shelfSection(shelves: readonly OwnShelf[]): string {
  const body =
    shelves.length === 0
      ? [NO_SHELVES_LINE]
      : [
          "| Path | Holds |",
          "|---|---|",
          ...shelves.map((shelf) => `| \`${tableCell(shelf.folder)}/\` | ${tableCell(cleanDefinition(shelf.definition))} |`),
        ];
  return [SHELF_SECTION_START, "## Your shelves", "", ...body, "", SHELF_SECTION_END].join("\n");
}

/**
 * `agentsMd` with the owner's shelves in the marked section: the first marker pair is rewritten in place, later pairs are dropped,
 * and with no pair the section goes before `## Pages` (else at the end). Every other byte stays as it was.
 */
export function withShelfSection(agentsMd: string, shelves: readonly OwnShelf[]): string {
  const section = shelfSection(shelves);
  const pairs = [...agentsMd.matchAll(SECTION_PAIR)];
  if (pairs.length > 0) {
    let out = "";
    let at = 0;
    pairs.forEach((pair, index) => {
      out += agentsMd.slice(at, pair.index);
      let end = pair.index + pair[0].length;
      if (index === 0) out += section;
      else end += /^\n{1,2}/.exec(agentsMd.slice(end))?.[0].length ?? 0;
      at = end;
    });
    return out + agentsMd.slice(at);
  }
  const pages = /^## Pages$/m.exec(agentsMd);
  if (pages) return `${agentsMd.slice(0, pages.index)}${section}\n\n${agentsMd.slice(pages.index)}`;
  if (agentsMd === "") return `${section}\n`;
  const gap = agentsMd.endsWith("\n\n") ? "" : agentsMd.endsWith("\n") ? "\n" : "\n\n";
  return `${agentsMd}${gap}${section}\n`;
}

/** Put the owner's shelves into `AGENTS.md` in the library at `root`. A symlink or other non-file there is replaced, never followed. */
export function writeShelfSection(root: string, shelves: readonly OwnShelf[]): void {
  const path = join(root, "AGENTS.md");
  const current = lstatOrNull(path)?.isFile() ? readFileSync(path, "utf8") : "";
  replaceInside(root, "AGENTS.md", withShelfSection(current, shelves));
}
