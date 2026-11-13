// Whether a process was started, at any depth, by Avanzel itself. A filing or Ask run is always a child of the app, so
// walking up the parent chain tells an outside agent's MCP server apart from one Avanzel's own librarian started.
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** A process's parent and the path of the executable it runs, or null when it can't be looked up. */
export type ParentOf = (pid: number) => { ppid: number; path: string } | null;

const MAX_STEPS = 64;

/**
 * `ps`'s view of `pid`: its parent and its executable. On macOS `comm` is the path the program was started by (the full
 * path for an app launchd opens, the name typed for one found on PATH). Null when `ps` fails, prints something else or
 * takes over five seconds.
 */
export function psParentOf(pid: number): { ppid: number; path: string } | null {
  const env = { ...process.env, LC_ALL: "C" };
  const ps = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", env, timeout: 5_000 });
  if (ps.status !== 0 || typeof ps.stdout !== "string") return null;
  const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(ps.stdout.split("\n")[0] ?? "");
  if (!match?.[1] || !match[2]) return null;
  return { ppid: Number(match[1]), path: match[2] };
}

/** `path` with its symlinks resolved, or as it is when it can't be. */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Whether any ancestor of `pid` (its parent, that one's parent, and so on up to launchd, at most 64 steps) runs
 * `execPath`. The process itself doesn't count: Avanzel's own `--mcp` mode runs the same executable. A symlink to the
 * executable counts as the executable.
 */
export function launchedBy(execPath: string, pid: number, parentOf: ParentOf = psParentOf): boolean {
  const target = real(execPath);
  const seen = new Set<number>([pid]);
  let current = parentOf(pid)?.ppid;
  for (let step = 0; step < MAX_STEPS && current !== undefined && current > 1 && !seen.has(current); step++) {
    seen.add(current);
    const parent = parentOf(current);
    if (parent === null) return false;
    if (parent.path === execPath || (parent.path.startsWith("/") && real(parent.path) === target)) return true;
    current = parent.ppid;
  }
  return false;
}
