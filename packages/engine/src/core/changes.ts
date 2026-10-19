// What an agent run changed in the library: snapshot before, snapshot after, diff.

import { readdirSync, statSync, type BigIntStats } from "node:fs";
import { join } from "node:path";

/** Every visible file, as a vault-relative POSIX path → its size and mtime in nanoseconds. */
export type Snapshot = Map<string, string>;

export class Changes {
  readonly created: string[];
  readonly modified: string[];
  readonly deleted: string[];
  /** Markdown files written inside a folder (shelf pages), not root files like index.md. */
  readonly pages: string[];
  readonly empty: boolean;

  // `pages` and `empty` are plain fields, not getters, so they survive structured cloning (IPC).
  constructor(created: string[], modified: string[], deleted: string[]) {
    this.created = created;
    this.modified = modified;
    this.deleted = deleted;
    this.pages = [...created, ...modified].filter((path) => path.endsWith(".md") && path.includes("/")).sort();
    this.empty = !(created.length || modified.length || deleted.length);
  }

  without(prefixes: readonly string[]): Changes {
    const keep = (paths: string[]) => paths.filter((path) => !prefixes.some((prefix) => path.startsWith(prefix)));
    return new Changes(keep(this.created), keep(this.modified), keep(this.deleted));
  }
}

/** Map every visible file to (size, mtime); hidden paths (.git, .avanzel, .obsidian, …) are skipped. */
export function snapshot(root: string): Snapshot {
  return new Map(visibleEntries(root).map(([rel, stat]) => [rel, `${stat.size}:${stat.mtimeNs}`]));
}

export function diff(before: Snapshot, after: Snapshot): Changes {
  return new Changes(
    [...after.keys()].filter((path) => !before.has(path)).sort(),
    [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path)).sort(),
    [...before.keys()].filter((path) => !after.has(path)).sort(),
  );
}

/** Every visible file under `root` as a sorted POSIX path relative to it (symlinked folders are not followed). */
export function visibleFiles(root: string): string[] {
  return visibleEntries(root).map(([rel]) => rel);
}

function visibleEntries(root: string): Array<[string, BigIntStats]> {
  const found: Array<[string, BigIntStats]> = [];
  const walk = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      try {
        const stat = statSync(join(root, child), { bigint: true });
        if (stat.isFile()) found.push([child, stat]);
      } catch {
        // a dangling symlink, or gone already
      }
    }
  };
  walk("");
  return found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
