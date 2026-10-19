import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "../../src/core/git.ts";
import { Vault } from "../../src/core/vault.ts";
import { envHome, gitIdentity, useTmp, write } from "./helpers.ts";

const tmp = useTmp();

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const subjects = (root: string) => gitOut(root, "log", "--format=%s").split("\n").filter(Boolean);

function repo(): string {
  const root = join(tmp(), "repo");
  mkdirSync(root);
  return root;
}

describe.skipIf(!git.available())("git", () => {
  beforeEach(() => {
    envHome(tmp());
  });

  it("commits everything and returns the new HEAD, or null when nothing changed", async () => {
    gitIdentity();
    const root = repo();
    await git.initRepo(root);
    expect(git.isRepo(root)).toBe(true);
    write(root, "a.md", "a");
    const sha = await git.commitAll(root, "first");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).toBe(gitOut(root, "rev-parse", "HEAD").trim());
    expect(await git.commitAll(root, "nothing changed")).toBeNull();
    expect(subjects(root)).toEqual(["first"]);
  });

  it("does nothing outside a repository", async () => {
    expect(git.isRepo(tmp())).toBe(false);
    expect(await git.commitAll(tmp(), "x")).toBeNull();
  });

  it("makes the first commit when a library is created", async () => {
    gitIdentity();
    const vault = await Vault.init(join(tmp(), "lib"), { git: true });
    expect(git.isRepo(vault.root)).toBe(true);
    expect(subjects(vault.root)).toEqual(["avanzel: new library"]);
    expect(gitOut(vault.root, "status", "--porcelain")).toBe("");
  });

  it("authors the commit as Avanzel when git has no identity", async () => {
    for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) {
      vi.stubEnv(key, undefined);
    }
    const noIdentity = join(tmp(), "gitconfig");
    writeFileSync(noIdentity, "[user]\n\tuseConfigOnly = true\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", noIdentity);
    const root = repo();
    await git.initRepo(root);
    write(root, "a.md", "a");
    expect(await git.commitAll(root, "first")).toMatch(/^[0-9a-f]{40}$/);
    expect(gitOut(root, "log", "--format=%an <%ae>").trim()).toBe("Avanzel <avanzel@localhost>");

    write(root, "a.md", "b");
    const second = await git.commitAll(root, "second");
    expect(await git.revert(root, second ?? "")).toBe(true);
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("a");
  });

  it("never runs hooks", async () => {
    gitIdentity();
    const root = repo();
    await git.initRepo(root);
    write(root, ".git/hooks/pre-commit", '#!/bin/sh\ntouch "$PWD/HOOK_RAN"\nexit 1\n');
    execFileSync("chmod", ["+x", join(root, ".git/hooks/pre-commit")]);
    write(root, "a.md", "a");
    expect(await git.commitAll(root, "first")).not.toBeNull();
    expect(existsSync(join(root, "HOOK_RAN"))).toBe(false);
  });

  it("reverts a commit, and leaves no half-done revert behind when it cannot", async () => {
    gitIdentity();
    const root = repo();
    await git.initRepo(root);
    write(root, "log.md", "a\n");
    await git.commitAll(root, "base");
    write(root, "log.md", "a\nb\n");
    const addB = await git.commitAll(root, "add b");
    write(root, "log.md", "a\nb\nc\n");
    const addC = await git.commitAll(root, "add c");

    // Reverting "add b" now conflicts with "add c" on the neighbouring line.
    expect(await git.revert(root, addB ?? "")).toBe(false);
    expect(gitOut(root, "status", "--porcelain")).toBe("");
    expect(existsSync(join(root, ".git", "REVERT_HEAD"))).toBe(false);
    expect(readFileSync(join(root, "log.md"), "utf8")).toBe("a\nb\nc\n");

    expect(await git.revert(root, addC ?? "")).toBe(true);
    expect(readFileSync(join(root, "log.md"), "utf8")).toBe("a\nb\n");
    expect(subjects(root)[0]).toBe('Revert "add c"');
    expect(await git.revert(root, "0".repeat(40))).toBe(false);
  });
});
