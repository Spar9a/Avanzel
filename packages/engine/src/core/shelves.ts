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

/** What each shelf Avanzel keeps holds, as the "Holds" column of the table in the template `AGENTS.md` says. */
export const BUILT_IN_DEFINITIONS: Readonly<Record<string, string>> = {
  goals: "Outcomes the owner wants to achieve: why, status, next steps, progress",
  ideas: "Things the owner might make, do or explore",
  problems: "Open problems, frictions and questions the owner is wrestling with",
  memories: "Facts, events, experiences, decisions and lessons from the owner's life",
  people: "People the owner mentions: who they are, context, commitments",
  meetings: "One page per call: what was decided and who promised what",
  topics: "Knowledge and recurring themes; saved answers and syntheses",
};

// --- the librarian's suggestion of a new shelf ----------------------------------------------------------------------------------

/** A shelf the librarian suggests after a filing, for the owner to make or turn down. */
export interface ShelfSuggestion {
  folder: string;
  name: string;
  /** What belongs on it. Empty for a folder the agent made on its own: the owner writes it. */
  definition: string;
  /** The pages this run created that would move onto the shelf. */
  pages: string[];
  /** The agent made the folder itself, instead of asking for it in its reply. */
  agentMade: boolean;
}

/** A suggestion some earlier filing made that the owner has not answered yet. */
export interface PendingShelf {
  folder: string;
  name: string;
  definition: string;
}

const SUGGESTION_LINE = /^New shelf: (.+)$/;

/**
 * The shelf a reply asks for: its last well-formed `New shelf: <folder> | <Name> | <definition> | <page>` line outside a fenced
 * block. A line with other than four non-empty parts is malformed, and skipped for an earlier one. Null when there is none.
 */
export function parseSuggestion(reply: string): { folder: string; name: string; definition: string; page: string } | null {
  let fenced = false;
  const found: Array<{ folder: string; name: string; definition: string; page: string }> = [];
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const body = SUGGESTION_LINE.exec(line)?.[1];
    if (body === undefined) continue;
    const parts = body.split(" | ").map((part) => part.trim());
    if (parts.length !== 4 || parts.some((part) => part === "")) continue;
    const [folder, name, definition, page] = parts as [string, string, string, string];
    found.push({ folder: folder.replace(/\/$/, ""), name, definition, page: page.replace(/\.$/, "") });
  }
  return found.at(-1) ?? null;
}

/** A page of a shelf: `<folder>/<file>.md` in one of the six shelves or an own shelf (a meeting's page is a call's record). */
function onAShelf(page: string, own: readonly OwnShelf[]): boolean {
  const parts = page.split("/");
  const folder = parts[0] ?? "";
  if (parts.length !== 2 || !page.endsWith(".md") || parts[1] === ".md") return false;
  return (SHELVES as readonly string[]).includes(folder) || own.some((shelf) => shelf.folder === folder);
}

/** A name as one line, with no `|` or line break: whitespace collapsed, cut to length. */
function cleanName(text: string): string {
  const line = text.replace(/\|/g, " ").replace(/\s+/g, " ").trim(); // \s takes line breaks, U+2028 and U+2029 too
  return [...line].slice(0, MAX_SHELF_NAME).join("").trim();
}

/**
 * `parsed` as a suggestion to keep, or null when it is dropped: a folder, name or definition that is empty once cleaned; a folder
 * that breaks the folder rules, is on disk already, or was turned down; one that is the same shelf as a built-in, own or turned-down
 * shelf; a page that this run did not create, or that is not a shelf page. One that is the same shelf as a pending suggestion
 * joins it: that one's folder, name and definition, with this page. The name and the definition are cleaned.
 */
export function checkedSuggestion(
  parsed: { folder: string; name: string; definition: string; page: string } | null,
  {
    created,
    own,
    declined,
    pending,
    onDisk,
  }: {
    created: readonly string[];
    own: readonly OwnShelf[];
    declined: readonly string[];
    pending: readonly PendingShelf[];
    /** The folders at the top of the library as the run left it. */
    onDisk: readonly string[];
  },
): ShelfSuggestion | null {
  if (parsed === null) return null;
  const folder = parsed.folder.trim();
  const name = cleanName(parsed.name);
  const definition = cleanDefinition(parsed.definition);
  const page = parsed.page.trim();
  if (folder === "" || name === "" || definition === "") return null;
  if (folderProblem(folder, own.map((shelf) => shelf.folder)) !== null) return null;
  const sameAs = (other: { folder: string; name: string }) =>
    [other.folder, other.name].some((theirs) => sameShelf(theirs, folder) || sameShelf(theirs, name));
  if (declined.some((turnedDown) => sameAs({ folder: turnedDown, name: turnedDown }))) return null;
  if (own.some(sameAs)) return null;
  if (BUILT_IN_SHELVES.some((built) => sameAs({ folder: built, name: built }))) return null;
  if (!created.includes(page) || !onAShelf(page, own)) return null;
  const joined = pending.find(sameAs);
  if (joined) return { folder: joined.folder, name: joined.name, definition: joined.definition, pages: [page], agentMade: false };
  if (onDisk.some((existing) => sameShelf(existing, folder))) return null;
  return { folder, name, definition, pages: [page], agentMade: false };
}

/**
 * The top-level folders a run made that nobody asked for: the first path segment of each created page that is in no `known` folder
 * (the built-in and own shelves and the special folders), mapped to its pages, in the order the folders first appear.
 */
export function agentMadeFolders(created: readonly string[], known: readonly string[]): Map<string, string[]> {
  const made = new Map<string, string[]>();
  for (const page of created) {
    const at = page.indexOf("/");
    if (at < 1 || !page.endsWith(".md")) continue;
    const folder = page.slice(0, at);
    if (known.includes(folder)) continue;
    made.set(folder, [...(made.get(folder) ?? []), page]);
  }
  return made;
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

// --- index.md headings ---------------------------------------------------------------------------------------------------------
//
// One `## <Name>` heading per shelf, its pages' lines below it. These change only the heading and lines asked for.

const SHELF_HEADING = /^## (.*?)\s*$/;
const ANY_HEADING = /^#{1,2} /;

function headingAt(lines: readonly string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return lines.findIndex((line) => SHELF_HEADING.exec(line)?.[1]?.toLowerCase() === wanted);
}

/** Where the block under the heading at `heading` ends: the next heading, or the end of the file. */
function blockEnd(lines: readonly string[], heading: number): number {
  const next = lines.findIndex((line, at) => at > heading && ANY_HEADING.test(line));
  return next === -1 ? lines.length : next;
}

/** `index` with a `## <name>` heading after the last block, unless it has one with that name already. */
export function withIndexHeading(index: string, name: string): string {
  if (headingAt(index.split("\n"), name) !== -1) return index;
  if (index === "") return `## ${name}\n`;
  const gap = index.endsWith("\n\n") ? "" : index.endsWith("\n") ? "\n" : "\n\n";
  return `${index}${gap}## ${name}\n`;
}

/** `index` with the heading `from` renamed to `to`, unless there is none, or one called `to` already. */
export function withIndexHeadingRenamed(index: string, from: string, to: string): string {
  const lines = index.split("\n");
  const at = headingAt(lines, from);
  const existing = headingAt(lines, to);
  if (at === -1 || (existing !== -1 && existing !== at)) return index;
  lines[at] = `## ${to}`;
  return lines.join("\n");
}

/** `index` without the heading `name` and the blank lines after it, when nothing but blank lines sits under it. */
export function withoutEmptyIndexHeading(index: string, name: string): string {
  const lines = index.split("\n");
  const at = headingAt(lines, name);
  if (at === -1) return index;
  const end = blockEnd(lines, at);
  if (lines.slice(at + 1, end).some((line) => line.trim() !== "")) return index;
  let stop = at + 1;
  while (stop < lines.length && lines[stop]?.trim() === "") stop++;
  if (stop === lines.length && lines[stop - 1] === "" && stop - 1 > at) stop--; // keep the file's final newline
  lines.splice(at, stop - at);
  return lines.join("\n");
}

/**
 * `index` with the line holding `[[<stem>]]` moved to the end of the block under the heading `name`, adding the heading when it
 * is missing. Without such a line the index stays as it is.
 */
export function withIndexLineMoved(index: string, stem: string, name: string): string {
  const lines = index.split("\n");
  const from = lines.findIndex((line) => line.includes(`[[${stem}]]`));
  if (from === -1) return index;
  const [line] = lines.splice(from, 1) as [string];
  const moved = withIndexHeading(lines.join("\n"), name).split("\n");
  const heading = headingAt(moved, name);
  let last = blockEnd(moved, heading) - 1;
  while (last > heading && moved[last]?.trim() === "") last--;
  if (last === heading) moved.splice(heading + 1, 0, "", line);
  else moved.splice(last + 1, 0, line);
  return moved.join("\n");
}
