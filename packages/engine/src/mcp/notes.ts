// What an outside agent's note goes through on its way into the inbox: checked, cleaned, capped and written
// as a capture the librarian files later. Nothing here touches a page; the only thing written is one capture.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { loadSettings } from "../core/config.ts";
import { fold, markdownFiles, pageMeta, tagCounts } from "../core/pages.ts";
import { BUILT_IN_SHELVES, SPECIAL_DIRS } from "../core/shelves.ts";
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
const SIMILAR_TERMS = 12;
const SIMILAR_CANDIDATES = 40;

const TAG = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}/-]*$/u;
const CONTEXT_KEY = /^[A-Za-z][\w-]*$/;
// Written by the capture or by this module, or read by the librarian and search as the owner's (`continues` points a filing
// at a page to update; `status`, `updated` and `aliases` are a page's own), so a note's context can't set them (compared without case).
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
  "continues",
  "status",
  "updated",
  "aliases",
]);
// Hangul filler letters: \p{Lo} lets them through, and they show as nothing, so a tag made of them looks empty or like another.
const TAG_FILLERS = /[\u115F\u1160\u3164\uFFA0]/u;
// Characters a reader can't see: soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width and bidi controls
// (U+200B-200F, U+202A-202E, U+2060-2069 with the isolates), the byte order mark, and the Unicode tag block, the usual way
// to hide instructions in text. HTML comments are the other way, so they go too.
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
const COMMENT = /<!--[\s\S]*?-->/g;
// What is left of a comment that never closes: it would hide everything after it once the Markdown is rendered.
const COMMENT_OPEN = /<!--/g;

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

/** Remove invisible characters, HTML comments and a comment's unclosed opening until nothing is left to remove (one removal can join the pieces of another). */
function clean(value: string): { value: string; stripped: boolean } {
  let current = value;
  for (;;) {
    const next = current.replace(INVISIBLE, "").replace(COMMENT, "").replace(COMMENT_OPEN, "");
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
    if (typeof tag !== "string" || tag.length > MAX_TAG || !TAG.test(tag) || TAG_FILLERS.test(tag)) {
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
  const similar = similarPages(vault.root, title ?? "", text.slice(0, SIMILAR_TEXT));

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

// Words too common to say what a note is about, in English and Russian (folded, ё as е). Words under three letters go anyway.
const STOPWORDS = new Set(
  (
    "the and that with for this from have has had was were are not but you your they them their there then than what when " +
    "where which who will would can could should about into over also just more most some such only other its our out all any " +
    "been being does did one very owner " +
    "они это что как для или его она был все так уже еще его ему ее она оно мне меня нас вас они них при про над под без " +
    "через когда если чтобы тоже также только было были будет есть нет этот эта эти тот там тут где кто чем вот себя свой " +
    "очень можно нужно владелец"
  )
    .split(" ")
    .map(fold),
);

/** The distinct words of `text` worth matching on: folded, three letters or more, and not a common word. */
function keywords(text: string): string[] {
  const words = fold(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words.filter((word) => [...word].length >= 3 && !STOPWORDS.has(word)))];
}

/**
 * Up to three shelf pages that look like the same thing as a note. The note's own words are cut to its 12 most telling: the
 * title's first, then those fewest pages use, longer ones before shorter. A page scores one for each of them it contains (a word
 * of the page starting with it) and two more for each in its title, aliases or file name, so a long page full of common words
 * doesn't outrank the one page about the thing.
 */
function similarPages(root: string, title: string, text: string): Array<{ path: string; title: string | null }> {
  const titleTerms = keywords(title);
  const textTerms = keywords(text)
    .filter((term) => !titleTerms.includes(term))
    .sort((a, b) => b.length - a.length);
  const candidates = [...titleTerms, ...textTerms].slice(0, SIMILAR_CANDIDATES);
  if (candidates.length === 0) return [];
  const pages: Array<{ path: string; title: string | null; body: string; names: string }> = [];
  for (const rel of markdownFiles(root)) {
    if (SPECIAL_DIRS.includes(rel.split("/")[0] ?? "")) continue;
    let content: string;
    try {
      content = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const meta = pageMeta(content);
    const stem = (rel.split("/").at(-1) ?? "").slice(0, -".md".length);
    pages.push({ path: rel, title: meta.title, body: fold(content), names: fold([meta.title ?? "", ...meta.aliases, stem].join(" ")) });
  }
  const startsWord = new Map(candidates.map((term) => [term, new RegExp(`(?<![\\p{L}\\p{N}_])${term}`, "u")]));
  const used = new Map(candidates.map((term) => [term, pages.filter((page) => startsWord.get(term)?.test(page.body)).length]));
  const rank = (a: string, b: string) => (used.get(a) ?? 0) - (used.get(b) ?? 0) || b.length - a.length;
  const terms = [
    ...titleTerms.filter((term) => (used.get(term) ?? 0) > 0).sort(rank),
    ...textTerms.filter((term) => (used.get(term) ?? 0) > 0).sort(rank),
  ].slice(0, SIMILAR_TERMS);
  const scored = pages
    .map((page) => ({
      page,
      score: terms.reduce((sum, term) => {
        const pattern = startsWord.get(term);
        if (!pattern) return sum;
        return sum + (pattern.test(page.body) ? 1 : 0) + (pattern.test(page.names) ? 2 : 0);
      }, 0),
    }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.page.path < b.page.path ? -1 : a.page.path > b.page.path ? 1 : 0));
  return scored.slice(0, SIMILAR_LIMIT).map(({ page }) => ({ path: page.path, title: page.title }));
}
