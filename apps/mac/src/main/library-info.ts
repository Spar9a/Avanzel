// Read-only views of the library for the UI: page titles, recent filings, wikilink lookup.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import { defaultSettings, localDate, privateProblem, type Settings } from "@avanzel/engine";
import { type FiledPage, HOSTED_AGENTS, type HostedModelInfo, type LibraryInfo } from "../shared/ipc.ts";
import { pageName, WIKILINK } from "../shared/wikilinks.ts";
import { answerSources } from "./setup-model.ts";

const NOT_PAGES = new Set(["inbox", "raw", "reviews", "tasks"]);

/**
 * What is at `rel` (a library path, as a filing's pages, the log and an answer's links name them) in the library at `root`, as a page
 * Avanzel may open or read: "page" for a plain file there, reached through no link; "link" for a link, or a file in a linked folder,
 * which would open, or be read, as whatever the link points at (an agent with a shell could point one at a script it wrote, which
 * opening it would run); "none" when nothing is there, or no file, or the path leads out of the library. The library's real path and
 * the page's are compared, so a library that is itself reached through a link (/tmp is /private/tmp on a Mac) keeps its pages.
 */
export function pageAt(root: string, rel: string): "page" | "link" | "none" {
  const full = path.join(root, rel);
  let stat: Stats;
  try {
    stat = lstatSync(full);
  } catch {
    return "none";
  }
  if (stat.isSymbolicLink()) return "link";
  if (!stat.isFile()) return "none";
  try {
    const library = realpathSync(root);
    const expected = path.join(library, rel);
    if (!expected.startsWith(`${library}${path.sep}`)) return "none";
    return realpathSync(full) === expected ? "page" : "link";
  } catch {
    return "none";
  }
}

/**
 * The `[dictation]` settings as Settings shows them: whether the library keeps a day file of dictations, and the skip list. Without
 * settings (no library, or a config.toml that can't be read) they are the defaults, which are what a new library starts with.
 */
export function dictationInfo(settings: Settings | null): Pick<LibraryInfo, "dictationLog" | "dictationSkipApps" | "dictationSkipSites"> {
  const { log, skipApps, skipSites } = (settings ?? defaultSettings()).dictation;
  return { dictationLog: log, dictationSkipApps: [...skipApps], dictationSkipSites: [...skipSites] };
}

/**
 * The `[private]` settings as Settings shows them, and the problem that keeps them from running with `agent` (the one in use, null when
 * none is). Without settings they are the defaults: off.
 */
export function privateInfo(
  settings: Settings | null,
  agent: string | null,
  hosted: readonly HostedModelInfo[] = [],
): Pick<LibraryInfo, "private" | "privateProblem"> {
  const model = (settings ?? defaultSettings()).private;
  return { private: { ...model }, privateProblem: model.enabled && agent ? problemOf(model, agent, hosted) : null };
}

/** What stops the private model from running with `agent`: for a model Avanzel hosts, an agent that can't take one, then the model not being downloaded. */
function problemOf(model: Settings["private"], agent: string, hosted: readonly HostedModelInfo[]): string | null {
  if (model.source !== "hosted") return privateProblem(model, agent);
  if (!HOSTED_AGENTS.includes(agent)) return "This agent can't run a model on this Mac. Use pi, OpenCode, Claude Code or Codex.";
  const info = hosted.find((entry) => entry.id === model.hostedModel);
  if (!info) return "Avanzel doesn't host that model.";
  if (info.problem) return info.problem;
  return info.state.kind === "ready" ? null : `${info.label} isn't downloaded yet.`;
}

/**
 * A page's title, from its frontmatter, then its first heading, then its file name, and its shelf, the first folder of `rel`. A page
 * that is a link, or lies in a linked folder (`pageAt`), is not read: a link is no page, and what it points at may be any file at all.
 * It keeps its file name.
 */
export function pageInfo(root: string, rel: string): FiledPage {
  const shelf = rel.split("/")[0] ?? "";
  let title = path.basename(rel, ".md");
  try {
    if (pageAt(root, rel) !== "page") return { title, shelf, path: rel };
    const text = readFileSync(path.join(root, rel), "utf8");
    const fromFrontmatter = /^---\n[\s\S]*?^title:\s*(.+?)\s*$/m.exec(text.split(/\n---\n/)[0] ?? "")?.[1];
    const fromHeading = /^#\s+(.+?)\s*$/m.exec(text)?.[1];
    title = (fromFrontmatter ?? fromHeading ?? title).replace(/^["']|["']$/g, "");
  } catch {
    // keep the file name
  }
  return { title, shelf, path: rel };
}

/**
 * Pages an agent run wrote: Markdown inside a shelf folder, new pages before updated ones. Each says which it is (`created`):
 * a page the run made, or one the library had that the run changed. A page on one of the owner's shelves (`own`, the library's) carries
 * that shelf's name (`shelfName`), which the filed card's chip shows.
 */
export function filedPages(
  root: string,
  changes: { created: string[]; modified: string[] },
  own: readonly { folder: string; name: string }[] = [],
): FiledPage[] {
  const isPage = (rel: string) => rel.endsWith(".md") && rel.includes("/") && !NOT_PAGES.has(rel.split("/")[0] ?? "");
  const made = new Set(changes.created);
  const ordered = [...changes.created.filter(isPage), ...changes.modified.filter(isPage)];
  return [...new Set(ordered)].map((rel) => {
    const page = { ...pageInfo(root, rel), created: made.has(rel) };
    const shelfName = own.find((shelf) => shelf.folder === page.shelf)?.name;
    return shelfName === undefined ? page : { ...page, shelfName };
  });
}

/**
 * The page a save made, among the pages the run wrote (`pages`, as `filedPages` lists them: new ones first). A run can make more than
 * one new page (a person's, say, in people/, which sorts before topics/), and the first listed is not always the answer. So, among the new
 * pages: the one the run's Ask line links, when it links just one of them (`linked`: its names, `askLinks`; the engine's own line lists
 * every page the run wrote, and says nothing then); else the first in topics/, where the library keeps saved answers (its AGENTS.md); else
 * the first page listed, as before. A page the run only changed is never named by the line, which an older save could have written.
 */
export function savedPage(pages: readonly FiledPage[], linked: readonly string[]): FiledPage | undefined {
  const made = pages.filter((page) => page.created);
  const named = made.filter((page) => linked.includes(pageName(page.path)));
  if (named.length === 1) return named[0];
  return made.find((page) => page.path.startsWith("topics/")) ?? pages[0];
}

// An Ask line as Vault.appendLog writes it, `- 2026-10-20 14:03 | ask | question → [[page]]`, and only an Ask's: the words of a question
// that mention " | ask | " are no such line, since the operation is the third field.
const ASK_LINE = /^- \d{4}-\d{2}-\d{2}[^|]*\| ask \| /;

/**
 * The page names the newest Ask line of the library's log links (what an answer saved as a page leaves, written by the agent or, when it
 * wrote none, by the engine): the names after its last arrow, as a link gives them (`[[name|label]]` and `[[name#heading]]` are `name`).
 * None when the log has no such line or can't be read.
 */
export function askLinks(root: string): string[] {
  let lines: string[];
  try {
    lines = readFileSync(path.join(root, "log.md"), "utf8").split("\n");
  } catch {
    return [];
  }
  const line = lines.reverse().find((one) => ASK_LINE.test(one));
  if (!line) return [];
  return [...line.slice(line.lastIndexOf("→") + 1).matchAll(WIKILINK)].map((link) => (link[1] ?? "").trim());
}

function walk(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), childRel) : [childRel];
  });
}

/**
 * An `obsidian://` link to a page (or, with "", the library), only when the library has a
 * `.obsidian/` folder: Obsidian ignores links into a folder it has never opened as a vault.
 */
export function obsidianUrl(root: string, rel: string): string | null {
  try {
    if (!statSync(path.join(root, ".obsidian")).isDirectory()) return null;
  } catch {
    return null;
  }
  return `obsidian://open?path=${encodeURIComponent(rel ? path.join(root, rel) : root)}`;
}

/** The folders that hold the owner's words as sources, which a link finds last. */
const SOURCES = new Set(["inbox", "raw"]);

/**
 * `[[name]]` → library-relative path; shelf pages win, then reviews and tasks, then sources in raw/ and inbox/. A day file of
 * dictations (`raw/dictations/2026-11-05.md`) has the name of that day's review (`reviews/2026-11-05.md`), which a link means.
 */
export function findPage(root: string, name: string): string | null {
  const target = `${name}.md`;
  const matches = walk(root).filter((rel) => rel.includes("/") && path.basename(rel) === target);
  const rank = (rel: string) => {
    const top = rel.split("/")[0] ?? "";
    return SOURCES.has(top) ? 2 : NOT_PAGES.has(top) ? 1 : 0;
  };
  return matches.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * An answer as the Ask window and setup's Ask step show it: its lines (answerSources), and the pages its [[links]] name,
 * each found in the library `root` with findPage, as a page is found to open it. A name that finds no page is left out,
 * and so is one whose search hits a folder it can't read, so the answer still shows. Without a library (`root` null) it
 * names no page.
 */
export function answeredFrom(root: string | null, text: string): { paragraphs: string[]; sources: FiledPage[] } {
  const { paragraphs, names } = answerSources(text);
  if (!root) return { paragraphs, sources: [] };
  const sources = names.flatMap((name) => {
    try {
      const rel = findPage(root, name);
      return rel ? [pageInfo(root, rel)] : [];
    } catch {
      return [];
    }
  });
  return { paragraphs, sources };
}

export function recentFromLog(root: string, limit = 3): FiledPage[] {
  let lines: string[];
  try {
    lines = readFileSync(path.join(root, "log.md"), "utf8").split("\n");
  } catch {
    return [];
  }
  const recent: FiledPage[] = [];
  const seen = new Set<string>();
  for (const line of lines.reverse()) {
    if (!line.includes(" | file | ")) continue;
    const targets = line.split("→")[1] ?? "";
    for (const [, name] of targets.matchAll(/\[\[([^\]|#]+)/g)) {
      const rel = name ? findPage(root, name.trim()) : null;
      if (!rel || seen.has(rel) || NOT_PAGES.has(rel.split("/")[0] ?? "")) continue;
      seen.add(rel);
      recent.push(pageInfo(root, rel));
      if (recent.length === limit) return recent;
    }
  }
  return recent;
}

// A log line as Vault.logLine writes it, `- 2026-10-20 14:03 | file | [[capture]] → [[page]]`, and only a filing's: the operation is
// "file", so the words of an Ask that mention " | file | " are not one. Group 1 is the day, in the library's local time.
const FILE_LINE = /^- (\d{4}-\d{2}-\d{2})[^|]*\| file \| /;

/**
 * How many thoughts the library's log says were filed on the local day of `now`: its "file" lines dated that day. A review's lines
 * and an Ask's are no filings. It looks up no page (`recentFromLog` does, for the lines it shows), so it is cheap to ask at each
 * filing; a library with no log, or one that can't be read, has filed nothing.
 */
export function filedToday(root: string, now: Date): number {
  let text: string;
  try {
    text = readFileSync(path.join(root, "log.md"), "utf8");
  } catch {
    return 0;
  }
  const today = localDate(now);
  let count = 0;
  for (const line of text.split("\n")) {
    if (FILE_LINE.exec(line)?.[1] === today) count += 1;
  }
  return count;
}

export interface CaptureMeta {
  source: string;
  /** Library-relative recording path. */
  audio?: string;
  transcriber?: string;
  created?: Date;
}

/** What a capture re-created after Edit must keep from the original. */
export function captureMeta(file: string): CaptureMeta {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"))?.[1];
  if (!frontmatter) return { source: "text" };
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(frontmatter)?.[1]?.replace(/^["']|["']$/g, "");
  const meta: CaptureMeta = { source: field("source") ?? "text" };
  const audio = field("audio");
  const transcriber = field("transcriber");
  const created = field("created");
  if (audio) meta.audio = audio;
  if (transcriber) meta.transcriber = transcriber;
  if (created && !Number.isNaN(Date.parse(created))) meta.created = new Date(created);
  return meta;
}

/** A line that is only an embed of the kind `Vault.newCapture` writes after the words: `![[x.wav]]`. */
const EMBED_LINE = /^!\[\[[^\]]+\]\]$/;

/**
 * What `Vault.newCapture` writes where the words would be when a capture has attachments and no words, a screen capture with no comment
 * (vault.ts: `words || "(no comment)"`). The engine exports no constant for it, so it is named here, once, beside the embed rule.
 */
const NO_COMMENT = "(no comment)";

/**
 * The words of a capture: its body after the frontmatter (as `captureMeta` finds the frontmatter), trimmed, and without the embed lines
 * `newCapture` appends after them for each attachment and for the recording (`![[x.wav]]`), which every dictation has and which are not
 * the person's words. A capture with no comment has none: the `(no comment)` that `newCapture` puts in their place is its placeholder, as
 * the Saved card has its own. For a filing in the background, whose job has none of its own, to print again (`FilingReceipt.text`). The
 * cost: a line of the person's own that is exactly an embed is dropped as well, and words that are exactly `(no comment)` read as none.
 * "" when the file can't be read.
 */
export function captureWords(file: string): string {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const words = body
    .split("\n")
    .filter((line) => !EMBED_LINE.test(line.trim()))
    .join("\n")
    .trim();
  return words === NO_COMMENT ? "" : words;
}
