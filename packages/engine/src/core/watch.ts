// Watching the library while an agent works, for the agents that don't report their own tool calls: each file the run
// writes or removes is a step, handed over as it happens rather than after the run ends.

import { statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { diff, snapshot, type Snapshot } from "./changes.ts";
import { stepPath, type FilingStep } from "./steps.ts";

/** How long a path is quiet before it is judged: one write is several events, and the file is whole after the last. */
const SETTLE_MS = 150;

type Written = Extract<FilingStep, { kind: "wrote" | "deleted" }>;

/**
 * Reports each file a run writes or removes, once, while it runs. stop() reports what is left, then ends the watch. What
 * is left is read from `after`, the library as the run left it, when stop() is given one by a caller that has taken it
 * already, and else from a snapshot of the folder that stop() takes itself.
 */
export function watchWrites(root: string, before: Snapshot, onStep: (step: FilingStep) => void): (after?: Snapshot) => void {
  const reported = new Set<string>();
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  let watcher: FSWatcher | null = null;
  let stopped = false;

  // A path is reported once, and its first report stands. A path judged to be as it was before the run isn't reported,
  // so it can still be, if the run changes it later.
  const tell = (step: Written) => {
    if (reported.has(step.path)) return;
    reported.add(step.path);
    try {
      onStep(step);
    } catch {
      // Whoever listens is no concern of the run.
    }
  };

  // What the file is now, against what it was before the run: new, changed (its size or mtime differs), or gone.
  const judge = (rel: string) => {
    const was = before.get(rel);
    const now = stampOf(join(root, rel));
    if (now === undefined) {
      if (was !== undefined) tell({ kind: "deleted", path: rel });
    } else if (now !== was) {
      tell({ kind: "wrote", path: rel, created: was === undefined });
    }
  };

  // A path is judged SETTLE_MS after its last event.
  const settle = (rel: string) => {
    clearTimeout(waiting.get(rel));
    const timer = setTimeout(() => {
      waiting.delete(rel);
      judge(rel);
    }, SETTLE_MS);
    waiting.set(rel, timer);
  };

  const end = () => {
    for (const timer of waiting.values()) clearTimeout(timer);
    waiting.clear();
    watcher?.close();
    watcher = null;
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (stopped || typeof name !== "string") return;
      const rel = stepPath(root, name);
      if (rel !== null) settle(rel);
    });
    watcher.on("error", end);
  } catch {
    // Nothing to watch, or no way to watch it: stop() still reports what changed, only at the end.
  }

  return (after) => {
    if (stopped) return;
    stopped = true;
    try {
      // Events reach fs.watch late, so the run's last write may not have arrived yet: the library as the run left it says
      // what's left, in the snapshot the caller gives, else in the folder as it is now.
      const { created, modified, deleted } = diff(before, after ?? snapshot(root));
      const left: Written[] = [
        ...created.map((path): Written => ({ kind: "wrote", path, created: true })),
        ...modified.map((path): Written => ({ kind: "wrote", path, created: false })),
        ...deleted.map((path): Written => ({ kind: "deleted", path })),
      ];
      for (const step of left) if (stepPath(root, step.path) !== null) tell(step);
    } finally {
      end();
    }
  };
}

/** The file's `size:mtimeNs`, as `snapshot` writes it; undefined when `path` isn't a file (gone, or a folder). */
function stampOf(path: string): string | undefined {
  try {
    const stat = statSync(path, { bigint: true });
    return stat.isFile() ? `${stat.size}:${stat.mtimeNs}` : undefined;
  } catch {
    return undefined;
  }
}
