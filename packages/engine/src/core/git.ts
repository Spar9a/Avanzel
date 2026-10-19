// Version the library with git so every agent edit is reviewable and undoable.

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

export function available(): boolean {
  return which("git") !== null;
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
 * path for it (its own path, or another one to move it to). Returns the new commit, or null — with
 * nothing left half-done — when the revert does not apply.
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
    const deleted = (await git(root, ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=D", "-z"])).stdout
      .split("\0")
      .filter(Boolean);
    const kept = deleted.flatMap((path) => {
      const target = keep(path);
      return target === null ? [] : [{ path, target }];
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

async function check(pending: Promise<Completed>): Promise<void> {
  const result = await pending;
  if (result.code !== 0) throw new AvanzelError(`git failed: ${result.stderr.trim()}`);
}

function git(root: string, args: string[]): Promise<Completed> {
  return run(["git", ...args], { cwd: root });
}
