// What an outside agent's note goes through on its way into the inbox: checked, cleaned, capped and written
// as a capture the librarian files later. Nothing here touches a page; the only thing written is one capture.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { loadSettings } from "../core/config.ts";
import { pageMeta, tagCounts } from "../core/pages.ts";
import { searchLibrary } from "../core/search.ts";
import { BUILT_IN_SHELVES } from "../core/shelves.ts";
import type { Vault } from "../core/vault.ts";

/** At most this many agent notes wait in the inbox at once, because each costs one filing run. */
export const MAX_UNFILED_AGENT_NOTES = 30;

const MAX_TEXT = 10_000;
const MAX_TAGS = 12;
const MAX_TAG = 40;
const MAX_TITLE = 120;
const MAX_RELATED = 12;
const MAX_NAME = 120;
const MAX_CONTEXT_KEYS = 5;
const MAX_CONTEXT_VALUE = 300;
const MAX_AGENT = 60;
const SIMILAR_TEXT = 900;
const SIMILAR_LIMIT = 3;

const TAG = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}/-]*$/u;
const CONTEXT_KEY = /^[A-Za-z][\w-]*$/;
// Written by the capture or by this module, so a note's own context can't set them (compared without case).
const RESERVED_KEYS = new Set([
  "id",
  "type",
  "source",
  "created",
  "attachments",
  "audio",
  "transcriber",
  "agent",
  "title",
  "shelf",
  "tags",
  "related",
  "supersedes",
]);
// Zero-width characters, bidi controls and invisible operators, and HTML comments: how hidden instructions are smuggled into stored memory.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
const COMMENT = /<!--[\s\S]*?-->/g;

export interface RememberInput {
  text: string;
  tags?: string[];
  title?: string;
  shelf?: string;
  related?: string[];
  supersedes?: string;
  context?: Record<string, string>;
}

export type RememberResult =
  | {
      ok: true;
      id: string;
      newTags: string[];
      similar: Array<{ path: string; title: string | null }>;
      stripped: boolean;
      when: string;
    }
  | { ok: false; error: string };

/** The names of the shelves a note can be hinted at: the built-in ones and the owner's own. A settings file that doesn't load adds none. */
export function libraryShelves(root: string): string[] {
  let own: string[] = [];
  try {
    own = loadSettings(root).shelves.map((shelf) => shelf.folder);
  } catch {
    // The owner's settings are theirs to fix; the built-in shelves still stand.
  }
  return [...BUILT_IN_SHELVES, ...own];
}

/** How many notes from agents are waiting in the inbox to be filed. */
export function unfiledAgentNotes(vault: Vault): number {
  let count = 0;
  for (const path of vault.pending()) {
    if (extname(path).toLowerCase() !== ".md") continue;
    try {
      if (pageMeta(readFileSync(path, "utf8")).source === "agent") count += 1;
    } catch {
      // A file that vanished or can't be read isn't a note waiting.
    }
  }
  return count;
}

/** Remove invisible characters and HTML comments until nothing is left to remove (one removal can join the pieces of another). */
function clean(value: string): { value: string; stripped: boolean } {
  let current = value;
  for (;;) {
    const next = current.replace(INVISIBLE, "").replace(COMMENT, "");
    if (next === current) return { value: current, stripped: current !== value };
    current = next;
  }
}

const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A page name for `[[…]]`: one line of 1–120 characters with nothing that would end or split a link. */
function nameProblem(field: string, name: string): string | null {
  if (!name.trim() || name.length > MAX_NAME || /[[\]|\r\n]/.test(name)) {
    return `${field} “${name.slice(0, 40)}” isn't allowed: use a page name of 1 to ${MAX_NAME} characters, on one line, without [, ] or |.`;
  }
  return null;
}

/** Check, clean and cap an agent's note, then write it to the inbox as a capture. Refuses with a reason; never rewrites what it refuses. */
export function remember(
  vault: Vault,
  input: RememberInput,
  agent: string,
  options: { now?: Date; shelves: readonly string[]; eveningReviewOn: boolean },
): RememberResult {
  let stripped = false;
  const cleaned = (value: string): string => {
    const result = clean(value);
    stripped ||= result.stripped;
    return result.value;
  };

  const text = cleaned(input.text).trim();
  if (!text) return refuse("The text is empty: say what the library should remember.");
  if (text.length > MAX_TEXT) return refuse(`The text is too long: ${MAX_TEXT.toLocaleString("en-US")} characters is the most.`);

  const tags = input.tags ?? [];
  if (tags.length > MAX_TAGS) return refuse(`Too many tags: ${MAX_TAGS} tags is the most.`);
  for (const [index, tag] of tags.entries()) {
    if (tag === "") return refuse("A tag can't be empty: leave it out, or write 1 to 40 characters.");
    if (typeof tag !== "string" || tag.length > MAX_TAG || !TAG.test(tag)) {
      return refuse(`Tag “${String(tag)}” isn't allowed: use lowercase letters, digits, - and /, up to ${MAX_TAG} characters.`);
    }
    if (tags.indexOf(tag) !== index) return refuse(`Tag “${tag}” is given twice: list each tag once.`);
  }

  let title: string | undefined;
  if (input.title !== undefined) {
    title = cleaned(input.title).trim();
    if (!title || title.length > MAX_TITLE || /[\r\n]/.test(title)) {
      return refuse(`The title isn't allowed: use 1 to ${MAX_TITLE} characters on one line.`);
    }
  }

  if (input.shelf !== undefined && !options.shelves.includes(input.shelf)) {
    return refuse(`Shelf “${input.shelf.slice(0, 40)}” isn't one of this library's shelves: ${options.shelves.join(", ")}.`);
  }

  const related = input.related ?? [];
  if (related.length > MAX_RELATED) return refuse(`Too many related pages: ${MAX_RELATED} related pages is the most.`);
  const relatedNames: string[] = [];
  for (const name of related) {
    const value = typeof name === "string" ? cleaned(name).trim() : "";
    const problem = nameProblem("Related page", value);
    if (problem) return refuse(problem);
    relatedNames.push(value);
  }

  let supersedes: string | undefined;
  if (input.supersedes !== undefined) {
    supersedes = cleaned(input.supersedes).trim();
    const problem = nameProblem("Supersedes", supersedes);
    if (problem) return refuse(problem);
  }

  const context: Record<string, string> = {};
  const entries = Object.entries(input.context ?? {});
  if (entries.length > MAX_CONTEXT_KEYS) return refuse(`Too many context keys: ${MAX_CONTEXT_KEYS} keys is the most.`);
  for (const [key, value] of entries) {
    if (!CONTEXT_KEY.test(key) || RESERVED_KEYS.has(key.toLowerCase())) {
      return refuse(`Context key “${key.slice(0, 40)}” isn't allowed: start with a letter, use letters, digits, - and _, and don't reuse a field the note already has.`);
    }
    if (typeof value !== "string" || value.length > MAX_CONTEXT_VALUE) {
      return refuse(`Context “${key}” isn't allowed: give a string of up to ${MAX_CONTEXT_VALUE} characters.`);
    }
    context[key] = cleaned(value).trim();
  }

  const label = cleaned(agent).replace(/\s+/g, " ").trim().slice(0, MAX_AGENT).trim() || "an agent";

  const when = options.eveningReviewOn
    ? "It will be filed at the evening review."
    : "The evening review is off: the owner can file the inbox from Avanzel's panel.";
  if (unfiledAgentNotes(vault) >= MAX_UNFILED_AGENT_NOTES) {
    return refuse(`Your library's inbox already holds ${MAX_UNFILED_AGENT_NOTES} notes from agents. ${when.replace("It will be", "They are")}`);
  }

  const used = new Set(tagCounts(vault.root).map((entry) => entry.tag));
  const newTags = tags.filter((tag) => !used.has(tag));
  const similar = searchLibrary(vault.root, [title, text.slice(0, SIMILAR_TEXT)].filter(Boolean).join(" "), { limit: SIMILAR_LIMIT })
    .hits.map(({ path, title: pageTitle }) => ({ path, title: pageTitle }));

  const capture = vault.newCapture(text, {
    source: "agent",
    ...(options.now ? { now: options.now } : {}),
    context: {
      agent: label,
      title,
      shelf: input.shelf,
      supersedes: supersedes && `[[${supersedes}]]`,
      ...context,
    },
    lists: { tags, related: relatedNames.map((name) => `[[${name}]]`) },
  });
  return { ok: true, id: capture.id, newTags, similar, stripped, when };
}
