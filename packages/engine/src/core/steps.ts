// What an agent did during a filing, and which paths a step may name. An agent gives a path as it sees it: absolute or
// relative, through the library's real path or through the path the library was reached by. A step has one form of
// it: relative to the library.

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** One thing an agent did during a filing, as a path inside the library. */
export type FilingStep =
  | { kind: "read"; path: string }
  | { kind: "search" }
  | { kind: "wrote"; path: string; created: boolean } // created: the path wasn't in the snapshot taken before the run
  | { kind: "deleted"; path: string };

// A library's real path, found once per root: it doesn't change while the app runs. A folder under os.tmpdir() on
// macOS is reached as /var/folders/… but really lives in /private/var/folders/…, and an agent working there reports
// the latter.
const realPaths = new Map<string, string>();

function realPathOf(root: string): string {
  const known = realPaths.get(root);
  if (known !== undefined) return known;
  try {
    const real = realpathSync(root);
    realPaths.set(root, real);
    return real;
  } catch {
    return root; // no such folder (yet): the root as given is all there is
  }
}

/** `path` relative to the folder `base` as a POSIX path, or null when it is outside it or is `base` itself. */
function under(base: string, path: string): string | null {
  const rel = relative(base, resolve(base, path)); // resolve settles any ".." and a relative path against `base`
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * `path` (absolute, or relative to the library) relative to the library: under `root` as given or under its real path
 * (realpathSync, remembered per root). Null when it is outside, or is the library itself.
 */
export function insideLibrary(root: string, path: string): string | null {
  return under(root, path) ?? under(realPathOf(root), path);
}

/** insideLibrary, and also null for a dot path or a path under inbox/ or raw/: the paths a step may name. */
export function stepPath(root: string, path: string): string | null {
  const rel = insideLibrary(root, path);
  if (rel === null) return null;
  const parts = rel.split("/");
  if (parts.some((part) => part.startsWith(".")) || parts[0] === "inbox" || parts[0] === "raw") return null;
  return rel;
}
