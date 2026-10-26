// What the setup window decides from plain data: names for places, a place too broad for a library, what is at the
// library's place, the agent that files, a mic check told from a thought, the question to suggest, the pages an answer
// used, and at the end where the window flies and where Zel's bubble goes. No Electron, so the tests run them as they
// are.
import { existsSync, opendirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { loadSettings, Vault, type FileOutcome } from "@avanzel/engine";
import { agentWorks, isAgentProblem, type FiledPage, type LibraryFolder, type SetupAgent } from "../shared/ipc.ts";
import type { TooBroad } from "../shared/problems.ts";
import { WIKILINK } from "../shared/wikilinks.ts";

/** `target` with the home folder as "~": only the folder itself, so /Users/ab stays as it is when home is /Users/a. */
export function tildePath(target: string, home: string): string {
  if (target === home) return "~";
  return target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}

/** The folders macOS makes in a home folder, each holding far more than notes. */
const HOME_FOLDERS: ReadonlySet<string> = new Set(
  ["Desktop", "Documents", "Downloads", "Library", "Movies", "Music", "Pictures", "Public", "Applications"].map((name) => name.toLowerCase()),
);

/**
 * The folders macOS and Unix keep for themselves: the apps, every account, the system and its tools, and the temporary
 * folders. Each is too broad as the folder it is, not by what lies inside it or by a name that starts like its own, so a
 * folder in one of them (/Applications/Avanzel, /Users/Shared/Avanzel) is a place like any other, and so is ~/Library-notes.
 */
const SYSTEM_FOLDERS: readonly string[] = [
  "/Applications", "/Library", "/System", "/Users", "/Users/Shared",
  "/private", "/usr", "/opt", "/bin", "/sbin", "/etc", "/var", "/tmp", "/cores",
];

/**
 * The volume macOS keeps the Mac's own folders on: /System/Volumes/Data/Users/me is /Users/me, and /System/Volumes/Data/Applications
 * is /Applications, though the disk gives each a path of its own (a firmlink, not a link a path can be followed through).
 */
const DATA_VOLUME = "/System/Volumes/Data";

/**
 * `place` as the disk has it: a leading `~` read as `home`, made absolute, and its links followed as far as it exists,
 * so the real path of its nearest existing folder with the rest of it after. /var/… is /private/var/… then, a link to
 * ~/Documents is ~/Documents, and /Volumes/Macintosh HD, an alias of the startup disk, is /. Should the disk not say
 * (a folder it may not read, say), the absolute path as it is.
 */
function onDisk(place: string, home: string): string {
  const absolute = path.resolve(place.replace(/^~(?=$|\/)/, () => home));
  const rest: string[] = [];
  let existing = absolute;
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  try {
    return path.join(realpathSync.native(existing), ...rest);
  } catch {
    return absolute;
  }
}

/** `place` as the startup disk's root shows it, when it is on the data volume (/System/Volumes/Data/Users/me is /Users/me); else null. */
function atTheRoot(place: string): string | null {
  const lower = place.toLowerCase();
  const data = DATA_VOLUME.toLowerCase();
  if (lower === data) return "/";
  return lower.startsWith(`${data}/`) ? place.slice(DATA_VOLUME.length) : null;
}

/**
 * Whether `target` is too broad to be a library, and why (null when it is a place like any other). One of the system's own
 * folders (SYSTEM_FOLDERS: /Applications, /Users, /usr, /tmp…) or the startup disk's root is `system`: nothing can be made in
 * most of them, or macOS doesn't keep it. The home folder `home`, one of the folders macOS makes in it (Documents, Desktop…),
 * /Volumes or another disk's root (/Volumes/Backup) is `broad`: a folder inside will do. Making a library at either would put
 * the shelves, an AGENTS.md and git history over everything in it, so setup and Settings refuse, and say why (tooBroadLine).
 * Places are compared as they are on disk (`onDisk`), so no link or alias of one of them gets through (/tmp is /private/tmp),
 * and names whatever their case. A place on the data volume is refused exactly when the same place at the root is, and for
 * the same reason: /System/Volumes/Data/Users/me is the home folder.
 */
export function tooBroad(target: string, home: string): TooBroad | null {
  const place = onDisk(target, home);
  const atRoot = atTheRoot(place);
  if (atRoot !== null) return tooBroad(atRoot, home);
  const parent = path.dirname(place);
  const own = onDisk(home, home);
  if (place === parent) return "system"; // the startup disk's root
  if (place === own || parent === "/Volumes" || place === "/Volumes") return "broad";
  const lower = place.toLowerCase();
  if (SYSTEM_FOLDERS.some((folder) => onDisk(folder, home).toLowerCase() === lower)) return "system";
  return parent === own && HOME_FOLDERS.has(path.basename(place).toLowerCase()) ? "broad" : null;
}

/** Where setup suggests the library when none is remembered, and where it starts over when the remembered one is gone. */
export function defaultLibraryPath(home: string): string {
  return path.join(home, "Avanzel");
}

/**
 * How many files a stopped filing run changed that no commit holds: the run left none (the library has no git, or has
 * automatic commits off, or the commit failed), so nothing can take its edits back and they stay as they are. 0 when it
 * changed nothing, when it left a commit (taking that back is the filing's `partial`), and when there was no run (`outcome`
 * is undefined: Cancel came before its turn).
 */
export function unrecordedEdits(outcome: Pick<FileOutcome, "commit" | "changes"> | undefined): number {
  if (!outcome || outcome.commit) return 0;
  const { created, modified, deleted } = outcome.changes;
  return created.length + modified.length + deleted.length;
}

/**
 * What to do with a filing that was stopped, once its run is over, given what the run left (`outcome`; undefined when there was
 * no run: Stop came before its turn, or the wait for the library ended with the run stopped). Stop may come after the agent has
 * finished and before the result is shown. A run that filed (`ok`) and left no commit stands as "filed": nothing records it
 * (the library has no git, or automatic commits off), so there is nothing to take back, and the note is archived. Anything else is
 * "take-back": the commit the run left, if any, is undone, which puts the words back in the inbox.
 */
export function afterStop(outcome: Pick<FileOutcome, "ok" | "commit"> | undefined): "filed" | "take-back" {
  return outcome?.ok && !outcome.commit ? "filed" : "take-back";
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

/**
 * The agent setup chooses until the person picks one. Of the agents that work: first the library's `own`, when the
 * folder is a library already, so a library brought from another Mac keeps its agent rather than silently switching;
 * else Claude Code, since it files best; else the first. When none works and every check has ended, the one whose check
 * found a problem the person can fix (not signed in, no reply in time, a failure), in the same order, so Found says
 * how to fix it at once. Never one whose check hasn't said yet: none (null) while a check is under way, and none when
 * no agent has a problem to show.
 */
export function bestAgent(agents: readonly SetupAgent[], own: string | null = null): string | null {
  const first = (list: readonly SetupAgent[]) =>
    (list.find((agent) => agent.name === own) ?? list.find((agent) => agent.name === "claude") ?? list[0])?.name ?? null;
  const working = agents.filter((agent) => agentWorks(agent.status));
  if (working.length) return first(working);
  if (agents.some((agent) => agent.status?.kind === "checking")) return null;
  return first(agents.filter((agent) => isAgentProblem(agent.status)));
}

/** The agent the library at `root` files with, as its .avanzel/config.toml says ("codex", or "auto"); null when that doesn't load. */
export function libraryAgent(root: string): string | null {
  try {
    return loadSettings(root).harness;
  } catch {
    return null;
  }
}

/**
 * The words of a mic check: "Testing, testing", "One, two, three" (or "1 2 3", "123", as a transcriber may write it),
 * "Can you hear me now?", "Is this thing on?".
 */
const MIC_CHECK: ReadonlySet<string> = new Set([
  "test", "testing", "tested", "hello", "hi", "hey", "one", "two", "three", "1", "2", "3", "123", "check", "checking",
  "mic", "microphone", "can", "you", "hear", "me", "now", "is", "this", "thing", "on", "ok", "okay",
]);

/**
 * Whether the first spoken thought's `words` are a mic check rather than a thought: one to eight words, each of them
 * one of MIC_CHECK's, in lower case and without punctuation. Setup answers one warmly instead of filing it.
 */
export function looksLikeATest(words: string): boolean {
  const list = words.toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  return list.length >= 1 && list.length <= 8 && list.every((word) => MIC_CHECK.has(word));
}

/**
 * The question the Ask step suggests about the pages the first filing wrote: about the first person among them, else
 * about the first page, wherever it is, its title in quotation marks; none without a page.
 */
export function suggestQuestion(pages: readonly FiledPage[]): string | null {
  const person = pages.find((page) => page.shelf === "people");
  if (person) return `What am I doing with ${person.title}?`;
  const first = pages[0];
  return first ? `What did I say about “${first.title}”?` : null;
}

/**
 * An agent's answer as the Ask step shows it: its lines with something in them, trimmed, each [[link]] read as its
 * label or else its page's name, and without Markdown's heading marks and bold; and the names of the pages it links,
 * in order and each once.
 */
export function answerSources(answer: string): { paragraphs: string[]; names: string[] } {
  const names: string[] = [];
  const words = answer.replace(WIKILINK, (_link, name: string, label?: string) => {
    const page = name.trim();
    if (!names.includes(page)) names.push(page);
    return (label ?? name).trim();
  });
  const paragraphs = words
    .split("\n")
    .map((line) => line.trim().replace(/^#+/, "").replaceAll("**", "").trim())
    .filter(Boolean);
  return { paragraphs, names };
}

/** A rectangle on screen, in points from the top left of the main display: the menu bar icon, a window, a work area. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the setup window flies when setup ends: a 24 × 24 square centred on the menu bar icon at `tray`, in whole
 * points. None (null) when the icon has no width or height, as when macOS hides it: there is nothing to fly to.
 */
export function flightTarget(tray: Box): Box | null {
  if (!(tray.width > 0 && tray.height > 0)) return null;
  return { x: Math.round(tray.x + tray.width / 2 - 12), y: Math.round(tray.y + tray.height / 2 - 12), width: 24, height: 24 };
}

/**
 * How far in from the bubble window's right edge the tip of Bubble's tail is: the tail is an 11 px square turned on its
 * corner, 20 px in from the bubble's right edge, so its tip is 20 + 11 / 2 px in, and the page pads the bubble 16 px in
 * from the window's edge. 41.5, rounded.
 */
const TAIL_TIP = 42;

/**
 * Where the window of Zel's bubble goes (its top left), so that the tip of its tail, TAIL_TIP in from the window's right
 * edge, is under the centre of the menu bar icon at `tray`, at the top of `work` or the icon's bottom, whichever is
 * lower. The window then moves back into `work`, the work area of the icon's display, as far as it has to.
 */
export function upHerePlace(tray: Box, work: Box, size: { width: number; height: number }): { x: number; y: number } {
  const x = Math.round(tray.x + tray.width / 2 + TAIL_TIP - size.width);
  const y = Math.round(Math.max(work.y, tray.y + tray.height));
  return {
    x: Math.min(Math.max(x, work.x), work.x + work.width - size.width),
    y: Math.min(Math.max(y, work.y), work.y + work.height - size.height),
  };
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
