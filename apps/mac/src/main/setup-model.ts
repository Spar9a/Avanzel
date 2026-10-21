// What the setup window decides from plain data: names for places, what is at the library's place, and the agent
// that files. No Electron, so the tests run them as they are.
import { existsSync, opendirSync, statSync } from "node:fs";
import { Vault } from "@avanzel/engine";
import type { LibraryFolder, SetupAgent } from "../shared/ipc.ts";

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

/** Whether its check found that an agent works: it is signed in, or it replied. */
const works = ({ status }: SetupAgent) => status?.kind === "signed-in" || status?.kind === "replied";

/**
 * The agent setup chooses until the person picks one: Claude Code when it works, since it files best; else the first
 * agent that works; else none (null), while every check is under way or found a problem.
 */
export function bestAgent(agents: readonly SetupAgent[]): string | null {
  if (agents.some((agent) => agent.name === "claude" && works(agent))) return "claude";
  return agents.find(works)?.name ?? null;
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
