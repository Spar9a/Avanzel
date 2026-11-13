// Whether a process was started, at any depth, by Avanzel itself. A filing or Ask run is always a child of the app, so
// walking up the parent chain tells an outside agent's MCP server apart from one Avanzel's own librarian started.
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * A process's parent and the path of the executable it runs; null when no such process runs. Throws when the process table
 * can't be read at all.
 */
export type ParentOf = (pid: number) => { ppid: number; path: string } | null;

const MAX_STEPS = 64;
// By its full path: in `--mcp` mode PATH is whatever the agent's MCP client passes, and a `ps` found there could be anything.
const PS = "/bin/ps";

/**
 * `ps`'s view of `pid`: its parent and its executable. On macOS `comm` is the path the program was started by (the full
 * path for an app launchd opens, the name typed for one found on PATH). Null when `ps` finds no such process (it exits 1 and
 * prints nothing). Throws when `ps` can't be run, is killed, takes over five seconds, or prints something else.
 */
export function psParentOf(pid: number, ps: string = PS): { ppid: number; path: string } | null {
  const env = { ...process.env, LC_ALL: "C" };
  const run = spawnSync(ps, ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", env, timeout: 5_000 });
  if (run.error) throw run.error;
  if (typeof run.stdout !== "string" || run.status === null) throw new Error(`${ps} stopped without an answer`);
  const first = run.stdout.split("\n")[0] ?? "";
  if (run.status === 1 && first.trim() === "") return null;
  const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(first);
  if (run.status !== 0 || !match?.[1] || !match[2]) throw new Error(`${ps} answered ${run.status}: ${first.slice(0, 80)}`);
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
 * executable counts as the executable. "unknown" when the process table can't be read, or `pid` itself isn't in it: a
 * caller deciding whether to let a note in must treat that as yes. An ancestor that ends while it is looked at ends the walk.
 */
export function launchedBy(execPath: string, pid: number, parentOf: ParentOf = psParentOf): boolean | "unknown" {
  const target = real(execPath);
  const seen = new Set<number>([pid]);
  try {
    const self = parentOf(pid);
    if (self === null) return "unknown";
    let current = self.ppid;
    for (let step = 0; step < MAX_STEPS && current > 1 && !seen.has(current); step++) {
      seen.add(current);
      const parent = parentOf(current);
      if (parent === null) return false;
      if (parent.path === execPath || (parent.path.startsWith("/") && real(parent.path) === target)) return true;
      current = parent.ppid;
    }
    return false;
  } catch {
    return "unknown";
  }
}
