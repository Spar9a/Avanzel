// The library's log of dictations: an optional day file, `raw/dictations/YYYY-MM-DD.md`, so the evening review can read the day.
//
// Each dictation is one block: a heading with the time, the app and the window or site it was said in, an opening marker
// `<!-- dictation ID -->`, the words, and a closing marker `<!-- /dictation ID -->`. Only those markers delimit a block, so nothing
// a dictation says may be able to make one: the app, title and site are flattened to one short plain line, and in every line of the
// words and the heard line the sequences `<!--` and `-->` are written as `&lt;!--` and `--&gt;`. That reads the same when the Markdown is
// shown, and no text can then contain a marker, or join pieces into one. (A text that already said `&lt;!--` keeps it as it was.)
//
// The day files are the owner's, and may be edited by hand: a missing final newline and Windows line ends are tolerated.
//
// Writes are not made under the library lock (`Vault.withLock`): a filing run holds that for minutes, and a dictation must not wait for
// it. Instead appends and rewrites are queued, one after the other, per library, inside this process. The app is the only writer.

import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { AvanzelError } from "../types.ts";
import { plainLine } from "./dictionary.ts";
import { localDate, localMinute } from "./dates.ts";
import { lstatOrNull, realFoldersTo } from "./inside.ts";
import type { Vault } from "./vault.ts";

export interface DictationLogEntry {
  /** A safe token (letters, digits, `_` and `-`, at most 64): it is part of the markers. */
  id: string;
  at: Date;
  /** The app's name. */
  app: string;
  /** The window's title, when it is known. */
  title: string | null;
  /** The website, when the app is a browser on one. Used in the heading when there is no title. */
  site: string | null;
  /** The words as they were pasted. */
  text: string;
  /** What the speech model heard, when it was changed before pasting. Written only when it differs from `text`. */
  heard?: string;
}

const FOLDER = "raw/dictations";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_HEADING_PART = 120;

/** Add the entry to the day file of `entry.at`'s local date, which is made, with its header, by the first. */
export function appendDictation(vault: Vault, entry: DictationLogEntry): Promise<void> {
  return queued(vault.root, () => append(vault.root, entry));
}

/**
 * Remove the entry `id` from its day file: only its block, and the blank line after it, every other byte as it was. `at` is when it was
 * said; the file of that day is looked in first, then the day before and the day after, since a clock's day and the entry's can differ.
 * True when it was found. False for an id that is not there, one that is not a safe token, and a day file that is a link.
 */
export function forgetDictation(vault: Vault, id: string, at: Date): Promise<boolean> {
  return queued(vault.root, () => forget(vault.root, id, at));
}

// --- the queue ----------------------------------------------------------------------------------

/** The end of each library's queue. It never rejects, so one failed job does not stop the ones behind it. */
const queues = new Map<string, Promise<void>>();

function queued<T>(root: string, job: () => T): Promise<T> {
  const key = resolve(root);
  const result = (queues.get(key) ?? Promise.resolve()).then(job);
  const end = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, end);
  void end.then(() => {
    if (queues.get(key) === end) queues.delete(key);
  });
  return result;
}

// --- writing ------------------------------------------------------------------------------------

function append(root: string, entry: DictationLogEntry): void {
  if (!SAFE_ID.test(entry.id)) {
    throw new AvanzelError("A dictation's id can be letters, digits, hyphens and underscores only, and 64 characters at most. It was not kept in the library.");
  }
  if (Number.isNaN(entry.at.getTime())) throw new AvanzelError("A dictation needs the time it was said. It was not kept in the library.");
  const day = localDate(entry.at);
  const rel = `${FOLDER}/${day}.md`;
  if (!realFoldersTo(root, rel, true)) {
    throw new AvanzelError(`Avanzel keeps dictations only in plain folders, and ${FOLDER} isn't one: a link or a file is on its path. Remove it, then try again.`);
  }
  const file = join(root, rel);
  const there = lstatOrNull(file);
  if (there && !there.isFile()) {
    throw new AvanzelError(`Avanzel keeps dictations only in plain files, and ${rel} isn't one. Remove it, then try again.`);
  }
  const existing = there ? readFileSync(file, "utf8") : "";
  appendFileSync(file, `${beginning(existing, day)}${block(entry)}`, "utf8");
}

/** What goes before a new block: the header for a file that is not there or is empty, else what makes the block start a paragraph. */
function beginning(existing: string, day: string): string {
  if (existing === "") {
    return `# Dictations ${day}\n\nWords said into other apps on this day, kept by Avanzel for the evening review. Each entry is marked with its time and where it was said.\n\n`;
  }
  if (/\n\r?\n$/.test(existing)) return "";
  return existing.endsWith("\n") ? "\n" : "\n\n";
}

function block(entry: DictationLogEntry): string {
  const where = heading(entry.title) || heading(entry.site);
  const app = heading(entry.app) || "Unknown app";
  const heard = entry.heard !== undefined && entry.heard.trim() !== "" && entry.heard !== entry.text ? `heard: ${plainText(entry.heard)}\n` : "";
  return (
    `## ${localMinute(entry.at).slice(-5)} · ${app}${where ? ` — ${where}` : ""}\n` +
    `<!-- dictation ${entry.id} -->\n${neutralise(entry.text)}\n${heard}<!-- /dictation ${entry.id} -->\n\n`
  );
}

/**
 * Words with the sequences that open or close an HTML comment written so that they no longer do. In two passes, since one pass that
 * replaced both would step over a `-->` made by the dashes of a `<!--` just replaced (`<!---->`). Neither pass can make what the other
 * took out: the second only changes `>`, and the first only adds `&lt;`, which has no `<`.
 */
function neutralise(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");
}

/** `value` as one plain line, its comment sequences neutralised. */
function plainText(value: string): string {
  return neutralise(plainLine(value));
}

/** A part of a heading: one plain line of at most 120 characters (cut at a whole character, with an ellipsis), and no leading `#`. */
function heading(value: string | null): string {
  const flat = plainText(value ?? "").replace(/^#+/, (hashes) => "\\#".repeat(hashes.length));
  const characters = Array.from(flat);
  return characters.length <= MAX_HEADING_PART ? flat : `${characters.slice(0, MAX_HEADING_PART - 1).join("").trimEnd()}…`;
}

function forget(root: string, id: string, at: Date): boolean {
  if (!SAFE_ID.test(id) || Number.isNaN(at.getTime())) return false;
  for (const day of [0, -1, 1].map((offset) => localDate(shifted(at, offset)))) {
    const rel = `${FOLDER}/${day}.md`;
    const file = join(root, rel);
    if (!lstatOrNull(file)?.isFile() || !realFoldersTo(root, rel, false)) continue;
    const text = readFileSync(file, "utf8");
    const found = findBlock(text, id);
    if (!found) continue;
    rewrite(file, text.slice(0, found.start) + text.slice(found.end));
    return true;
  }
  return false;
}

function shifted(date: Date, days: number): Date {
  const moved = new Date(date.getTime());
  moved.setDate(moved.getDate() + days);
  return moved;
}

/** The new text written aside in the same folder, then renamed over the file, so a crash leaves the old file whole. */
function rewrite(file: string, text: string): void {
  const partial = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(partial, text, { encoding: "utf8", flag: "wx" });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
}

/**
 * Where the block of `id` is in `text`: from its heading line (the line before the opening marker, when that is a `## ` heading) to the
 * end of the closing marker's line, and the blank line after it. Lines end in `\n` or `\r\n`. Null without both markers, in that order.
 */
function findBlock(text: string, id: string): { start: number; end: number } | null {
  const open = `<!-- dictation ${id} -->`;
  const close = `<!-- /dictation ${id} -->`;
  const lines: { from: number; to: number; content: string }[] = [];
  for (let from = 0; from < text.length; ) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline + 1;
    lines.push({ from, to, content: text.slice(from, newline < 0 ? text.length : newline).replace(/\r$/, "") });
    from = to;
  }
  const opening = lines.findIndex((line) => line.content === open);
  if (opening < 0) return null;
  const closing = lines.findIndex((line, index) => index > opening && line.content === close);
  if (closing < 0) return null;
  const before = lines[opening - 1];
  const start = before?.content.startsWith("## ") ? before.from : (lines[opening] as { from: number }).from;
  const after = lines[closing + 1];
  const end = after && after.content === "" ? after.to : (lines[closing] as { to: number }).to;
  return { start, end };
}
