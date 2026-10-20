// The guard: after every agent run, whatever it changed among the library's rules, settings and
// tasks is put back. Take a `protectedState` before the run and `undoProtected` after it. Nothing
// is written or deleted through a symlink, or outside the library.

import { readdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { lstatOrNull, realFoldersTo, removeInside, writeInside } from "./inside.ts";

// Instructions and settings that load or execute on later runs. A headless agent run may not change
// them (a capture could carry a prompt injection); Avanzel undoes any change after every run.
export const PROTECTED = [
  "AGENTS.md", "CLAUDE.md", ".avanzel/config.toml", "opencode.json", ".mcp.json",
  ".git/config", ".git/hooks", ".agents", ".claude", ".codex", ".cursor", ".gemini", ".opencode", "tasks",
];
// The folders those lie in (.avanzel, .git): swapping one for a symlink would redirect what is inside.
export const PROTECTED_PARENTS = [
  ...new Set(PROTECTED.flatMap((rel) => rel.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/")))),
];
// What Avanzel itself writes to after a run (the capture, its archive, reports, the log line). Agents
// may change what is in them, but swapping one for a symlink would make Avanzel write outside.
export const OWN_PATHS = ["inbox", "raw", "reviews", "log.md"];

/** The protected paths as they are, never looking through a symlink: files, symlinks (and where they point), folders. */
export interface ProtectedState {
  files: Map<string, Buffer>;
  links: Map<string, string>;
  dirs: Set<string>;
}

export function protectedState(root: string): ProtectedState {
  const state: ProtectedState = { files: new Map(), links: new Map(), dirs: new Set() };
  const record = (rel: string, descend: boolean): void => {
    const path = join(root, rel);
    const stat = lstatOrNull(path);
    if (stat?.isSymbolicLink()) {
      state.links.set(rel, readlinkSync(path));
    } else if (stat?.isFile()) {
      state.files.set(rel, readFileSync(path));
    } else if (stat?.isDirectory()) {
      state.dirs.add(rel);
      if (descend) for (const name of readdirSync(path)) record(`${rel}/${name}`, true);
    }
  };
  for (const rel of PROTECTED_PARENTS) record(rel, false);
  for (const rel of PROTECTED) if (!behindLink(root, rel)) record(rel, true);
  for (const rel of OWN_PATHS) {
    const path = join(root, rel);
    if (lstatOrNull(path)?.isSymbolicLink()) state.links.set(rel, readlinkSync(path)); // links only, never contents
  }
  return state;
}

/**
 * Undo every change to the protected paths since `before`; returns the files and links that were
 * changed. Nothing is written or deleted through a symlink, or outside the library.
 */
export function undoProtected(root: string, before: ProtectedState): string[] {
  const touched = new Set<string>();
  // Links first, shallowest first: one an agent put anywhere on or under a protected path goes (one
  // the owner had is put back), so nothing below it is read or written through it.
  for (const rel of byDepth(new Set([...before.links.keys(), ...protectedState(root).links.keys()]))) {
    const path = join(root, rel);
    const link = lstatOrNull(path)?.isSymbolicLink() ? readlinkSync(path) : undefined;
    const original = before.links.get(rel);
    if (link === original) continue;
    touched.add(rel);
    if (link !== undefined || (original !== undefined && lstatOrNull(path))) removeInside(root, rel);
    if (original !== undefined && realFoldersTo(root, rel, true)) symlinkSync(original, path);
  }
  // Then, shallowest first, whatever the run added, or turned from a file into a folder or the other
  // way round: so nothing it added stays, and nothing is in the way of what is put back next.
  const now = protectedState(root);
  for (const rel of byDepth([...now.files.keys(), ...now.dirs])) {
    if (kindOf(now, rel) !== kindOf(before, rel)) removeInside(root, rel);
  }
  for (const [rel, data] of before.files) {
    if (!now.files.get(rel)?.equals(data)) writeInside(root, rel, data);
  }
  for (const rel of new Set([...before.files.keys(), ...now.files.keys()])) {
    const was = before.files.get(rel);
    if (!was || !now.files.get(rel)?.equals(was)) touched.add(rel);
  }
  return [...touched].sort();
}

function kindOf(state: ProtectedState, rel: string): "file" | "folder" | "link" | "none" {
  if (state.files.has(rel)) return "file";
  if (state.dirs.has(rel)) return "folder";
  return state.links.has(rel) ? "link" : "none";
}

/** Whether a folder between the library root and `rel` is a symlink (or no folder at all). */
function behindLink(root: string, rel: string): boolean {
  const parts = rel.split("/");
  return parts.slice(0, -1).some((_, i) => {
    const stat = lstatOrNull(join(root, ...parts.slice(0, i + 1)));
    return stat !== null && !stat.isDirectory();
  });
}

/** Shallowest first, then by name. */
function byDepth(paths: Iterable<string>): string[] {
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0));
}
