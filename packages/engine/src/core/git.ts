// Version the library with git so every agent edit is reviewable and undoable.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { AvanzelError } from "../types.ts";
import { run, which, type Completed } from "./proc.ts";

// The library is private notes, not code: no hooks (an agent must not be able to plant one) and
// no signing prompts.
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"];
// Most often git has no user name/email on this machine; author the commit as Avanzel instead.
const FALLBACK_IDENTITY = ["-c", "user.name=Avanzel", "-c", "user.email=avanzel@localhost"];
const SHA = /^[0-9a-f]{4,64}$/i;

// The `git` every Mac has in /usr/bin is a stub. Without Apple's Command Line Tools (or Xcode), running it, or `xcrun`, opens
// Apple's install dialog instead of doing anything. So whether git works is found out without ever running it.
const APPLE_GIT = "/usr/bin/git";
const XCODE_SELECT = "/usr/bin/xcode-select";

/** What `gitUsable` asks about. A test that can't change this Mac passes its own answers. */
export interface GitSeams {
  /** Where `bin` is on PATH, or null (proc's `which`). */
  which?: (bin: string) => string | null;
  /** The developer directory `xcode-select -p` prints, or null when that command fails (it exits 2 without the tools). */
  xcodeSelect?: () => string | null;
}

/** What `gitUsable()` found, for the process; null until it has looked. */
let usable: boolean | null = null;

/**
 * Whether git can be run on this Mac, found out without running `git` or `xcrun`, either of which opens Apple's install
 * dialog when the tools are missing:
 * - no `git` on PATH: no;
 * - a `git` anywhere but /usr/bin/git: yes;
 * - /usr/bin/git, Apple's stub on a Mac: yes only if `xcode-select -p` exits 0 and names a developer directory that has
 *   usr/bin/git, since the stub hands over to that one. (Elsewhere /usr/bin/git is a real git.)
 *
 * Under AVANZEL_TEST=1, AVANZEL_GIT_USABLE=0 says no: the tests' stand-in for a Mac without the tools, whichever this Mac has.
 * Called without `seams`, the answer is kept for the process (`resetGitUsable` clears it); with them it asks afresh, and
 * keeps nothing.
 */
export function gitUsable(seams?: GitSeams): boolean {
  if (seams) return detect(seams);
  usable ??= detect({});
  return usable;
}

/** Forget what `gitUsable()` found, so the next call looks again: after the tools were installed, say, or for a test. */
export function resetGitUsable(): void {
  usable = null;
}

function detect({ which: find = which, xcodeSelect = developerDir }: GitSeams): boolean {
  if (process.env.AVANZEL_TEST === "1" && process.env.AVANZEL_GIT_USABLE === "0") return false;
  const found = find("git");
  if (found === null) return false;
  if (found !== APPLE_GIT || process.platform !== "darwin") return true;
  const developer = xcodeSelect();
  return developer !== null && existsSync(join(developer, "usr", "bin", "git"));
}

/** `xcode-select -p`: the directory the stub hands over to, or null when there is none. It only asks; `--install` is what installs. */
function developerDir(): string | null {
  const asked = spawnSync(XCODE_SELECT, ["-p"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  const directory = asked.status === 0 ? asked.stdout.trim() : "";
  return directory === "" ? null : directory;
}

/**
 * Whether git can be run (`gitUsable`). `commitAll`, `revert`, `revertKeeping` and `subject` ask first and do nothing when it
 * can't, so on a Mac with only Apple's stub a library that has `.git` makes no commits (and its filings offer no Undo). A
 * caller of `initRepo`, which runs git, asks first too: `Vault.init` does.
 */
export function available(): boolean {
  return gitUsable();
}

export function isRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export async function initRepo(root: string): Promise<void> {
  const result = await git(root, ["init", "-q"]);
  if (result.code !== 0) throw new AvanzelError(`git init failed in ${root}: ${result.stderr.trim()}`);
}

/** Stage everything and commit: the new HEAD, or null when there is nothing to commit or git refuses. */
export async function commitAll(root: string, message: string): Promise<string | null> {
  if (!isRepo(root) || !available()) return null;
  await git(root, ["add", "-A"]);
  if (!(await git(root, ["status", "--porcelain"])).stdout.trim()) return null;
  return commitStaged(root, message);
}

/** `git revert` one commit as a new commit; false, with nothing left half-done, when it does not apply. */
export async function revert(root: string, sha: string): Promise<boolean> {
  if (!isRepo(root) || !available() || !SHA.test(sha)) return false;
  for (const identity of [[], FALLBACK_IDENTITY]) {
    if ((await git(root, [...identity, ...SAFE, "revert", "--no-edit", sha])).code === 0) return true;
    await rollback(root);
  }
  return false;
}

/**
 * Like `revert`, with one difference: a file the revert would delete is kept when `keep` names a
 * path for it (its own path, or another one to move it to). A symlink it would delete is never kept
 * (`keep` is not asked). Returns the new commit, or null — with nothing left half-done — when the
 * revert does not apply.
 */
export async function revertKeeping(
  root: string,
  sha: string,
  message: string,
  keep: (path: string) => string | null,
): Promise<string | null> {
  if (!isRepo(root) || !available() || !SHA.test(sha)) return null;
  if ((await git(root, [...SAFE, "revert", "--no-commit", sha])).code !== 0) {
    await rollback(root);
    return null;
  }
  try {
    // With -z, every deletion is two fields: `:<old mode> <new mode> <old id> <new id> D`, then its
    // path. Symlinks (old mode 120000) are left deleted. Should git fail to list them, nothing is
    // undone: an empty list would let the revert delete what `keep` would have kept.
    const listed = await check(git(root, ["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=D"]));
    const fields = listed.stdout.split("\0");
    const deleted = fields.flatMap((path, i) => (i % 2 === 1 && !fields[i - 1]?.startsWith(":120000 ") ? [path] : []));
    const targets = new Set<string>();
    const kept = deleted.flatMap((path) => {
      let target = keep(path);
      if (target === null) return [];
      if (targets.has(target)) target = path; // never move two files onto one path: the second stays put
      targets.add(target);
      return [{ path, target }];
    });
    if (kept.length) {
      await check(git(root, ["--literal-pathspecs", ...SAFE, "checkout", "HEAD", "--", ...kept.map((k) => k.path)]));
      const moved = kept.filter(({ path, target }) => target !== path);
      for (const { path, target } of moved) {
        mkdirSync(dirname(join(root, target)), { recursive: true });
        renameSync(join(root, path), join(root, target));
      }
      if (moved.length) {
        const paths = moved.flatMap(({ path, target }) => [path, target]);
        await check(git(root, ["--literal-pathspecs", "add", "-A", "--", ...paths]));
      }
    }
    const nothingStaged = (await git(root, ["diff", "--cached", "--quiet"])).code === 0;
    const commit = nothingStaged ? null : await commitStaged(root, message);
    if (commit === null) await rollback(root);
    return commit;
  } catch (error) {
    await rollback(root);
    throw error;
  }
}

/** The subject line of commit `sha`, or null when there is no such commit. */
export async function subject(root: string, sha: string): Promise<string | null> {
  if (!isRepo(root) || !available() || !SHA.test(sha)) return null;
  const result = await git(root, ["log", "-1", "--format=%s", sha]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function commitStaged(root: string, message: string): Promise<string | null> {
  const commit = [...SAFE, "commit", "-q", "--no-verify", "-m", message];
  if ((await git(root, commit)).code !== 0 && (await git(root, [...FALLBACK_IDENTITY, ...commit])).code !== 0) {
    return null;
  }
  const head = await git(root, ["rev-parse", "HEAD"]);
  return head.code === 0 ? head.stdout.trim() : null;
}

/** Put the index and the files a failed revert touched back as they were. */
async function rollback(root: string): Promise<void> {
  const inProgress = existsSync(join(root, ".git", "REVERT_HEAD")) || existsSync(join(root, ".git", "sequencer"));
  if (!inProgress || (await git(root, ["revert", "--abort"])).code !== 0) {
    await git(root, ["reset", "-q", "--merge"]);
  }
}

/** The finished git command, or an AvanzelError when it failed. */
async function check(pending: Promise<Completed>): Promise<Completed> {
  const result = await pending;
  if (result.code !== 0) throw new AvanzelError(`git failed: ${result.stderr.trim()}`);
  return result;
}

function git(root: string, args: string[]): Promise<Completed> {
  return run(["git", ...args], { cwd: root });
}
