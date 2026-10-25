import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "../../src/core/git.ts";
import { which } from "../../src/core/proc.ts";
import { Vault } from "../../src/core/vault.ts";
import { binScripts, envHome, gitIdentity, useTmp, write } from "./helpers.ts";

const tmp = useTmp();

// Whether git is usable is kept for the process: a test that changes the answer doesn't leave it for the next one.
afterEach(() => {
  git.resetGitUsable();
});

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const subjects = (root: string) => gitOut(root, "log", "--format=%s").split("\n").filter(Boolean);

function repo(): string {
  const root = join(tmp(), "repo");
  mkdirSync(root);
  return root;
}

// On a Mac without Apple's Command Line Tools, /usr/bin/git is a stub: running it opens Apple's install dialog. So git is
// "usable" without ever being run to find out. The test can't put a file at /usr/bin/git, so the check takes the two
// things it asks about (where git is, and what xcode-select -p says) as seams.
describe("gitUsable", () => {
  const onMac = process.platform === "darwin";

  /** A developer folder as `xcode-select -p` names one: with a git at usr/bin/git, or without. */
  function developerDir(withGit: boolean): string {
    const dir = join(tmp(), "Developer");
    if (withGit) write(dir, "usr/bin/git", "#!/bin/sh\n");
    else mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("is false when there is no git on PATH, and asks xcode-select nothing", () => {
    const xcodeSelect = vi.fn(() => developerDir(true));
    expect(git.gitUsable({ which: () => null, xcodeSelect })).toBe(false);
    expect(xcodeSelect).not.toHaveBeenCalled();
  });

  it.runIf(onMac)("is false for Apple's stub at /usr/bin/git when xcode-select -p fails, as it does without the tools", () => {
    const xcodeSelect = vi.fn(() => null); // exit 2: "unable to get active developer directory"
    expect(git.gitUsable({ which: () => "/usr/bin/git", xcodeSelect })).toBe(false);
    expect(xcodeSelect).toHaveBeenCalledOnce();
  });

  it.runIf(onMac)("is false for the stub when the developer folder xcode-select names has no usr/bin/git", () => {
    expect(git.gitUsable({ which: () => "/usr/bin/git", xcodeSelect: () => developerDir(false) })).toBe(false);
  });

  it.runIf(onMac)("is true for /usr/bin/git when xcode-select names a developer folder that has usr/bin/git", () => {
    expect(git.gitUsable({ which: () => "/usr/bin/git", xcodeSelect: () => developerDir(true) })).toBe(true);
  });

  it("is true for a git anywhere else, without asking xcode-select", () => {
    const xcodeSelect = vi.fn(() => null);
    for (const found of ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git"]) {
      expect(git.gitUsable({ which: () => found, xcodeSelect })).toBe(true);
    }
    expect(xcodeSelect).not.toHaveBeenCalled();
  });

  it("takes /usr/bin/git for a real git away from a Mac, where there is no Apple stub", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const xcodeSelect = vi.fn(() => null);
      expect(git.gitUsable({ which: () => "/usr/bin/git", xcodeSelect })).toBe(true);
      expect(xcodeSelect).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("never runs git or xcrun to find out, since either brings up Apple's install dialog", () => {
    const calls = join(tmp(), "calls.log");
    vi.stubEnv("PATH", binScripts(tmp(), { git: `echo git >> '${calls}'`, xcrun: `echo xcrun >> '${calls}'`, "xcode-select": `echo xcode-select >> '${calls}'` }));
    git.resetGitUsable();
    expect(git.gitUsable()).toBe(true);
    expect(git.available()).toBe(true);
    expect(existsSync(calls)).toBe(false);
  });

  it("is cached for the process when called without seams, until resetGitUsable() clears it", () => {
    vi.stubEnv("PATH", binScripts(tmp(), { git: "exit 0" }));
    git.resetGitUsable();
    expect(git.gitUsable()).toBe(true);
    vi.stubEnv("PATH", join(tmp(), "nowhere")); // git is gone from PATH, but the answer is kept
    expect(git.gitUsable()).toBe(true);
    expect(git.available()).toBe(true);
    // Called with seams it asks afresh, and leaves what is kept alone.
    expect(git.gitUsable({ which: () => null })).toBe(false);
    expect(git.gitUsable()).toBe(true);
    git.resetGitUsable();
    expect(git.gitUsable()).toBe(false);
    expect(git.available()).toBe(false);
  });

  it("AVANZEL_GIT_USABLE=0 says no git is usable, in a test run only (AVANZEL_TEST=1)", () => {
    vi.stubEnv("PATH", binScripts(tmp(), { git: "exit 0" }));
    vi.stubEnv("AVANZEL_GIT_USABLE", "0");
    vi.stubEnv("AVANZEL_TEST", undefined);
    git.resetGitUsable();
    expect(git.gitUsable()).toBe(true); // outside a test run the variable means nothing
    vi.stubEnv("AVANZEL_TEST", "1");
    git.resetGitUsable();
    expect(git.gitUsable()).toBe(false);
    expect(git.available()).toBe(false);
  });
});

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

  it("runs no git at all while none is usable: a library with .git makes no commits, and a new one gets no repository", async () => {
    gitIdentity();
    const root = repo();
    await git.initRepo(root);
    write(root, "a.md", "a");
    const first = (await git.commitAll(root, "first")) ?? "";
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    // A git that notes every call stands first on PATH. While git is usable it is called, which shows the note works...
    const calls = join(tmp(), "calls.log");
    const real = which("git");
    const bin = binScripts(tmp(), { git: `echo "$*" >> '${calls}'\nexec '${real}' "$@"` });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    git.resetGitUsable();
    write(root, "b.md", "b");
    expect(await git.commitAll(root, "second")).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(calls)).toBe(true);
    rmSync(calls);
    // ...and from here on this Mac has no usable git (the test override), so none may be.
    vi.stubEnv("AVANZEL_TEST", "1");
    vi.stubEnv("AVANZEL_GIT_USABLE", "0");
    git.resetGitUsable();
    expect(git.available()).toBe(false);

    write(root, "c.md", "c");
    expect(await git.commitAll(root, "third")).toBeNull();
    expect(await git.revert(root, first)).toBe(false);
    expect(await git.revertKeeping(root, first, "undo first", (path) => path)).toBeNull();
    expect(await git.subject(root, first)).toBeNull();
    const vault = await Vault.init(join(tmp(), "lib"), { git: true });
    expect(existsSync(join(vault.root, ".avanzel"))).toBe(true); // the library is made all the same
    expect(git.isRepo(vault.root)).toBe(false);
    expect(existsSync(calls)).toBe(false); // not one git ran, so none could have opened Apple's dialog

    // The history is as it was; git itself, outside the test override, says so.
    vi.stubEnv("AVANZEL_GIT_USABLE", undefined);
    expect(subjects(root)).toEqual(["second", "first"]);
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

  it("undoes nothing, rather than dropping a file it was asked to keep, when git can't list what a revert deletes", async () => {
    gitIdentity();
    const root = repo();
    await git.initRepo(root);
    write(root, "index.md", "# Index\n");
    await git.commitAll(root, "base");
    write(root, "raw/2026/10/note.md", "the owner's words\n");
    const added = await git.commitAll(root, "add the note");
    // A git whose `diff --cached --raw` fails (a damaged index, say) and that runs as usual otherwise.
    const real = which("git");
    const bin = binScripts(tmp(), { git: `case "$*" in *"diff --cached --raw"*) echo "fatal: index file corrupt" >&2; exit 128;; esac\nexec '${real}' "$@"` });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);

    await expect(git.revertKeeping(root, added ?? "", "undo the note", (path) => path)).rejects.toThrow(/git failed: fatal: index file corrupt/);
    expect(readFileSync(join(root, "raw/2026/10/note.md"), "utf8")).toBe("the owner's words\n");
    expect(subjects(root)).toEqual(["add the note", "base"]);
    expect(gitOut(root, "status", "--porcelain")).toBe("");
  });
});
