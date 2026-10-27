import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "../../src/core/git.ts";
import { which } from "../../src/core/proc.ts";
import { AUDIO_EXTS, Vault } from "../../src/core/vault.ts";
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

  // Recordings stay on this machine. The library's .gitignore keeps raw/audio/ out of git, but audio that waits in the inbox (a
  // voice memo dropped there, or a recording the capsule's Stop kept) is not under raw/, and `commitAll` stages everything. So the
  // repository's own exclude file lists the inbox's audio, which covers a library made before this, and the owner's own git use.
  describe("audio waiting in the inbox", () => {
    const excludeFile = (root: string) => join(root, ".git", "info", "exclude");
    const tracked = (root: string) => gitOut(root, "ls-files").split("\n").filter(Boolean);
    const inHistory = (root: string) => gitOut(root, "log", "--all", "--name-only", "--format=").split("\n").filter(Boolean);

    /** A repository that matches names as they are written, as on a volume that tells cases apart. */
    async function caseSensitiveRepo(): Promise<string> {
      gitIdentity();
      const root = repo();
      await git.initRepo(root);
      gitOut(root, "config", "core.ignorecase", "false");
      return root;
    }

    it("is never committed, in any of the audio types or either case, and the notes beside it are", async () => {
      const root = await caseSensitiveRepo();
      write(root, "inbox/A note.md", "words");
      write(root, "inbox/Another note.txt", "more words");
      for (const ext of AUDIO_EXTS) {
        write(root, `inbox/memo${ext}`, "sound");
        write(root, `inbox/LOUD${ext.toUpperCase()}`, "SOUND");
      }
      expect(await git.commitAll(root, "first")).toMatch(/^[0-9a-f]{40}$/);
      expect(tracked(root)).toEqual(["inbox/A note.md", "inbox/Another note.txt"]);
      expect(inHistory(root)).toEqual(["inbox/A note.md", "inbox/Another note.txt"]);
      expect(gitOut(root, "status", "--porcelain")).toBe(""); // the recordings are not even listed as new
      for (const ext of AUDIO_EXTS) {
        expect(readFileSync(join(root, `inbox/memo${ext}`), "utf8")).toBe("sound"); // and they are where they were
        expect(readFileSync(join(root, `inbox/LOUD${ext.toUpperCase()}`), "utf8")).toBe("SOUND");
      }
    });

    it("is kept out only at the top of the inbox, which is all the library's queue lists", async () => {
      const root = await caseSensitiveRepo();
      write(root, "inbox/memo.wav", "sound");
      write(root, "inbox/folder/inside.wav", "sound");
      write(root, "ideas/clip.wav", "sound");
      await git.commitAll(root, "first");
      expect(tracked(root)).toEqual(["ideas/clip.wav", "inbox/folder/inside.wav"]);
    });

    it("is kept out from the moment the repository is made, for the owner's own git too", async () => {
      const root = await caseSensitiveRepo();
      write(root, "inbox/memo.wav", "sound");
      write(root, "inbox/note.md", "words");
      gitOut(root, "add", "-A"); // the owner, with no commit of Avanzel's yet
      expect(tracked(root)).toEqual(["inbox/note.md"]);
    });

    it("lists its patterns once, adds them to what the exclude file holds, and leaves a complete file as it is", async () => {
      const root = await caseSensitiveRepo();
      // The owner's own lines, the last without a newline: kept, and not run into the first pattern.
      writeFileSync(excludeFile(root), "# mine\nscratch/\n*.tmp");
      write(root, "inbox/memo.wav", "sound");
      write(root, "a.md", "a");
      await git.commitAll(root, "first");
      const once = readFileSync(excludeFile(root), "utf8");
      const lines = once.split("\n");
      expect(lines.slice(0, 3)).toEqual(["# mine", "scratch/", "*.tmp"]);
      expect(lines).toContain("inbox/*.[wW][aA][vV]");
      expect(lines.at(-1)).toBe(""); // ends with a newline
      const named = lines.filter(Boolean);
      expect(new Set(named).size).toBe(named.length); // no line twice
      write(root, "b.md", "b");
      await git.commitAll(root, "second");
      await git.commitAll(root, "nothing changed");
      expect(readFileSync(excludeFile(root), "utf8")).toBe(once);
    });

    it("puts back a pattern the owner deleted, and only that one", async () => {
      const root = await caseSensitiveRepo();
      write(root, "a.md", "a");
      await git.commitAll(root, "first");
      const complete = readFileSync(excludeFile(root), "utf8");
      writeFileSync(excludeFile(root), complete.replace("inbox/*.[wW][aA][vV]\n", ""));
      write(root, "inbox/memo.wav", "sound");
      write(root, "b.md", "b");
      await git.commitAll(root, "second");
      const lines = readFileSync(excludeFile(root), "utf8").split("\n");
      expect(lines.filter((line) => line === "inbox/*.[wW][aA][vV]")).toHaveLength(1);
      expect(lines.filter((line) => line.startsWith("# Avanzel"))).toHaveLength(1);
      expect(tracked(root)).toEqual(["a.md", "b.md"]);
    });

    it("makes the folder of the exclude file when it is missing", async () => {
      const root = await caseSensitiveRepo();
      rmSync(join(root, ".git", "info"), { recursive: true });
      write(root, "inbox/memo.wav", "sound");
      write(root, "a.md", "a");
      expect(await git.commitAll(root, "first")).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(excludeFile(root))).toBe(true);
      expect(tracked(root)).toEqual(["a.md"]);
    });

    it("makes no commit, and stages nothing, when the audio can't be kept out", async () => {
      const root = await caseSensitiveRepo();
      writeFileSync(excludeFile(root), "# mine\n");
      chmodSync(excludeFile(root), 0o444); // a file git can read and Avanzel can't write
      write(root, "inbox/memo.wav", "sound");
      write(root, "a.md", "a");
      expect(await git.commitAll(root, "first")).toBeNull();
      expect(gitOut(root, "diff", "--cached", "--name-only")).toBe("");
      expect(() => gitOut(root, "rev-parse", "--verify", "-q", "HEAD")).toThrow(); // still no commit at all
      expect(readFileSync(excludeFile(root), "utf8")).toBe("# mine\n");
    });

    it("leaves another repository's exclude file alone when the library's .git holds no repository", async () => {
      // git takes a .git that is no repository for none, and looks in the folders above: it must find the library's own, or nothing.
      gitIdentity();
      const parent = repo();
      await git.initRepo(parent);
      const before = readFileSync(excludeFile(parent), "utf8");
      const library = join(parent, "library");
      mkdirSync(join(library, ".git"), { recursive: true });
      write(library, "inbox/memo.wav", "sound");
      write(library, "a.md", "a");
      expect(await git.commitAll(library, "first")).toBeNull();
      expect(gitOut(parent, "ls-files")).toBe("");
      expect(gitOut(parent, "diff", "--cached", "--name-only")).toBe("");
      expect(readFileSync(excludeFile(parent), "utf8")).toBe(before);
    });

    // A library that was a repository before Avanzel opened it (an Obsidian vault, say) gets the lines at Avanzel's first commit, and
    // with auto_commit off never: a sync tool of the owner's could commit a recording meanwhile. So the app writes them as it opens one.
    describe("keepInboxAudioOut, as a library opens", () => {
      it("writes the lines into a repository Avanzel didn't make, and a second call adds nothing", async () => {
        gitIdentity();
        const root = repo();
        gitOut(root, "init", "-q"); // the owner's own repository, which no commit of Avanzel's has touched
        gitOut(root, "config", "core.ignorecase", "false");
        const had = existsSync(excludeFile(root)) ? readFileSync(excludeFile(root), "utf8") : "";
        expect(had).not.toContain("inbox/*.[wW][aA][vV]");
        expect(await git.keepInboxAudioOut(root)).toBeNull();
        const once = readFileSync(excludeFile(root), "utf8");
        expect(once.startsWith(had)).toBe(true); // the owner's lines stay as they were
        // The same lines a repository Avanzel makes gets, one for each audio type.
        const made = join(tmp(), "made");
        mkdirSync(made);
        await git.initRepo(made);
        const avanzels = readFileSync(excludeFile(made), "utf8").split("\n").filter((line) => line.startsWith("inbox/"));
        expect(avanzels).toHaveLength(AUDIO_EXTS.size);
        expect(avanzels).toContain("inbox/*.[wW][aA][vV]");
        expect(once.split("\n").filter((line) => line.startsWith("inbox/"))).toEqual(avanzels);
        expect(await git.keepInboxAudioOut(root)).toBeNull();
        expect(readFileSync(excludeFile(root), "utf8")).toBe(once);
        // The owner's own git, or a sync tool's, now passes a recording in the inbox over, and the note beside it is still seen.
        write(root, "inbox/memo.wav", "sound");
        write(root, "inbox/note.md", "words");
        gitOut(root, "add", "-A");
        expect(tracked(root)).toEqual(["inbox/note.md"]);
      });

      it("runs no git for a folder that isn't a repository, nor for one where only Apple's stub could run it", async () => {
        const calls = join(tmp(), "calls.log");
        vi.stubEnv("PATH", binScripts(tmp(), { git: `echo "$*" >> '${calls}'`, xcrun: `echo xcrun >> '${calls}'` }));
        git.resetGitUsable();
        const folder = repo(); // no .git in it
        expect(await git.keepInboxAudioOut(folder)).toBeNull();
        expect(existsSync(calls)).toBe(false);
        // A .git, on a Mac whose git is Apple's stub, which opens the tools' install dialog when run: AVANZEL_GIT_USABLE=0 plays it.
        mkdirSync(join(folder, ".git"));
        vi.stubEnv("AVANZEL_TEST", "1");
        vi.stubEnv("AVANZEL_GIT_USABLE", "0");
        git.resetGitUsable();
        expect(await git.keepInboxAudioOut(folder)).toBeNull();
        expect(existsSync(calls)).toBe(false);
      });

      it("says in a few words why the lines can't be written, at each of its refusals, and writes nothing then", async () => {
        gitIdentity();
        // git finds no repository: the .git holds none, and no folder above is one.
        const hollow = join(tmp(), "hollow");
        mkdirSync(join(hollow, ".git"), { recursive: true });
        expect(await git.keepInboxAudioOut(hollow)).toMatch(/^git can't say where the exclude file is: fatal: not a git repository/);
        // git finds a repository, but the folder above's: the library's .git holds none.
        const parent = join(tmp(), "parent");
        mkdirSync(parent);
        await git.initRepo(parent);
        const before = readFileSync(excludeFile(parent), "utf8");
        const library = join(parent, "library");
        mkdirSync(join(library, ".git"), { recursive: true });
        expect(await git.keepInboxAudioOut(library)).toBe(`git finds the repository at ${parent}, which isn't the library's own`);
        expect(readFileSync(excludeFile(parent), "utf8")).toBe(before);
        // The exclude file can't be written.
        const root = repo();
        gitOut(root, "init", "-q");
        writeFileSync(excludeFile(root), "# mine\n");
        chmodSync(excludeFile(root), 0o444);
        expect(await git.keepInboxAudioOut(root)).toMatch(/^the exclude file can't be read or written: EACCES: permission denied/);
        expect(readFileSync(excludeFile(root), "utf8")).toBe("# mine\n");
      });
    });
  });
});
