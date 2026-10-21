// What the setup window decides from plain data: names for places, what is at the library's place, the agent that
// files, a mic check told from a thought, the question to suggest and the pages an answer used. No Electron, so the
// tests run them as they are.
import { existsSync, opendirSync, statSync } from "node:fs";
import { loadSettings, Vault } from "@avanzel/engine";
import { agentWorks, type FiledPage, type LibraryFolder, type SetupAgent } from "../shared/ipc.ts";
import { WIKILINK } from "../shared/wikilinks.ts";

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

/**
 * The agent setup chooses until the person picks one. First the library's `own`, when the folder is a library already
 * and that agent works here: a library brought from another Mac keeps its agent rather than silently switching. Else
 * Claude Code when it works, since it files best; else the first agent that works; else none (null), while every
 * check is under way or found a problem.
 */
export function bestAgent(agents: readonly SetupAgent[], own: string | null = null): string | null {
  const working = agents.filter((agent) => agentWorks(agent.status));
  return (working.find((agent) => agent.name === own) ?? working.find((agent) => agent.name === "claude") ?? working[0])?.name ?? null;
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
 * about the first page, wherever it is; none without a page.
 */
export function suggestQuestion(pages: readonly FiledPage[]): string | null {
  const person = pages.find((page) => page.shelf === "people");
  if (person) return `What am I doing with ${person.title}?`;
  const first = pages[0];
  return first ? `What did I say about ${first.title}?` : null;
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
