import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "../../src/core/git.ts";
import { Librarian } from "../../src/core/librarian.ts";
import { Vault } from "../../src/core/vault.ts";
import { NOW, envHome, gitIdentity, write } from "./helpers.ts";
import { fakeSettings, lstatOrNull, mode, only, read, tmp } from "./librarian-fixtures.ts";

let vault: Vault;
let librarian: Librarian;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
  librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
});

describe.skipIf(!git.available())("with git", () => {
  let versioned: Vault;

  const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: versioned.root, encoding: "utf8" });
  const subjects = () => gitOut("log", "--format=%s").split("\n").filter(Boolean);
  const head = () => gitOut("rev-parse", "HEAD").trim();

  beforeEach(async () => {
    envHome(tmp());
    gitIdentity();
    versioned = await Vault.init(join(tmp(), "versioned"), { git: true });
    librarian = new Librarian(versioned, fakeSettings(), { clock: () => NOW });
  });

  it("commits each filing and returns the commit", async () => {
    const capture = librarian.captureText("Commit me");
    const outcome = await only(librarian.file());
    // What was pending (here: the capture itself) is committed first, on its own, as the owner's.
    expect(subjects()).toEqual([
      `avanzel: file ${capture.id}`,
      `avanzel: owner's changes before file ${capture.id}`,
      "avanzel: new library",
    ]);
    expect(outcome.commit).toBe(head());
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("never commits a recording that waits in the inbox, neither with the owner's changes before a filing nor with the filing", async () => {
    // A voice memo dropped there, or a recording the capsule's Stop kept; and a volume that tells cases apart.
    gitOut("config", "core.ignorecase", "false");
    write(versioned.root, "inbox/Voice memo.WAV", "sound");
    write(versioned.root, "inbox/memo.m4a", "sound");
    const capture = librarian.captureText("Commit me, not the recordings");
    const outcome = await only(librarian.file([capture.path]));
    expect(outcome.ok).toBe(true);
    expect(subjects()).toEqual([
      `avanzel: file ${capture.id}`,
      `avanzel: owner's changes before file ${capture.id}`,
      "avanzel: new library",
    ]);
    expect(gitOut("log", "--all", "--name-only", "--format=").split("\n").filter((name) => /\.(wav|m4a)$/i.test(name))).toEqual([]);
    expect(gitOut("ls-files").split("\n").filter(Boolean).some((name) => name.startsWith("inbox/"))).toBe(false);
    expect(gitOut("status", "--porcelain")).toBe("");
    expect(read(join(versioned.root, "inbox", "Voice memo.WAV"))).toBe("sound"); // waiting where it was, for the evening review
    expect(read(join(versioned.root, "inbox", "memo.m4a"))).toBe("sound");
  });

  it("keeps what the owner wrote before a filing when the filing is undone", async () => {
    write(versioned.root, "goals/mine.md", "# My own goal\n");
    appendFileSync(versioned.indexPath, "- [[mine]] — my own goal\n");
    const index = read(versioned.indexPath);
    librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file());
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(read(join(versioned.root, "goals", "mine.md"))).toBe("# My own goal\n");
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("keeps what the owner wrote before an evening review when all of it is undone", async () => {
    write(versioned.root, "goals/mine.md", "# My own goal\n");
    appendFileSync(versioned.indexPath, "- [[mine]] — my own goal\n");
    const index = read(versioned.indexPath);
    librarian.captureText("one");
    librarian.captureText("two");
    const review = await librarian.eveningReview();
    expect(review.commits).toHaveLength(3);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(read(join(versioned.root, "goals", "mine.md"))).toBe("# My own goal\n");
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("never runs a git hook an agent planted", async () => {
    mode("arm");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(existsSync(join(versioned.root, ".git", "hooks", "post-commit"))).toBe(false);
    expect(existsSync(join(versioned.root, "HOOK_RAN"))).toBe(false);
    expect(subjects()[0]?.startsWith("avanzel: file ")).toBe(true);
  });

  it("hands out what a failed run left behind as its own commit, so undoing the review takes it back", async () => {
    mode("messy"); // the failing run rewrites goals/run.md first
    write(versioned.root, "goals/run.md", "# Run\n");
    const stuck = librarian.captureText("An unfileable thought");
    const fine = librarian.captureText("Build a greenhouse");
    const review = await librarian.eveningReview();
    const [failed, filed] = review.outcomes;
    expect([failed?.captureId, failed?.ok, filed?.captureId, filed?.ok]).toEqual([stuck.id, false, fine.id, true]);
    expect(failed?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(review.commits).toEqual([failed?.commit, filed?.commit, head()]);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(read(join(versioned.root, "goals", "run.md"))).toBe("# Run\n");
  });

  it("undoes all of a review even when a failed run edited between two filings", async () => {
    mode("messy"); // the failing run adds a line to index.md
    librarian.captureText("a first thought");
    librarian.captureText("b unfileable thought");
    librarian.captureText("c third thought");
    const index = read(versioned.indexPath);
    const review = await librarian.eveningReview();
    expect(review.outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(review.commits).toHaveLength(4);
    expect(await librarian.undo(review.commits)).toBe(4);
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("hands out a cancelled run's leftovers too, and still writes the digest", async () => {
    mode("slow-messy");
    librarian.captureText("Takes forever");
    const controller = new AbortController();
    const reviewing = librarian.eveningReview({ signal: controller.signal });
    const half = join(versioned.root, "goals", "half.md");
    await vi.waitFor(() => expect(existsSync(half)).toBe(true), { timeout: 10_000 }); // it has left something behind
    controller.abort();
    const review = await reviewing;
    const [cancelled] = review.outcomes;
    expect(cancelled?.ok).toBe(false);
    expect(cancelled?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(review.digestPath).not.toBeNull();
    expect(review.commits).toEqual([cancelled?.commit, head()]);
    expect(await librarian.undo(review.commits)).toBe(2);
    expect(existsSync(join(versioned.root, "goals", "half.md"))).toBe(false);
  });

  it("a folder the agent leaves at the archive path fails only that capture", async () => {
    mode("folder-at-archive");
    const blocked = librarian.captureText("blocked-archive notes");
    const plain = librarian.captureText("plain notes");
    const review = await librarian.eveningReview();
    const [stuck, filed] = review.outcomes;
    expect([stuck?.captureId, stuck?.ok, filed?.captureId, filed?.ok]).toEqual([blocked.id, false, plain.id, true]);
    const problem = `The agent left a folder at raw/2026/10/${blocked.id}.md, so the note could not be archived.`;
    expect(stuck?.error).toBe(problem);
    expect(stuck?.commit).toMatch(/^[0-9a-f]{40}$/);
    const leftovers = gitOut("show", "--name-only", "--format=%s", stuck?.commit ?? "");
    expect(leftovers).toContain(`avanzel: leftovers of failed filing ${blocked.id}`);
    expect(leftovers).toContain(`ideas/idea-${blocked.id}.md`); // what the run did is kept, and can be undone
    expect(review.commits).toEqual([stuck?.commit, filed?.commit, head()]);
    expect(read(review.digestPath ?? "")).toContain(`- [[${blocked.id}]]: ${problem} (still in the inbox)\n`);
    expect(versioned.pending()).toEqual([blocked.path]);
  });

  it("the next review files it under a fresh id", async () => {
    mode("folder-at-archive");
    const blocked = librarian.captureText("blocked-archive notes");
    await librarian.eveningReview();
    mode("ok");
    const review = await librarian.eveningReview();
    const [outcome] = review.outcomes;
    expect(review.outcomes).toHaveLength(1);
    expect(outcome?.ok).toBe(true);
    expect(outcome?.captureId).not.toBe(blocked.id);
    expect(read(outcome?.archivedTo ?? "")).toContain("blocked-archive notes"); // the owner's words
    const folder = join(versioned.raw, "2026", "10", `${blocked.id}.md`);
    expect(lstatSync(folder).isDirectory()).toBe(true); // the old name is still taken by the agent's folder
    expect(versioned.pending()).toEqual([]);
  });

  it("makes no commit for a failed run that changed nothing", async () => {
    mode("fail");
    const capture = librarian.captureText("Something to keep");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.commit).toBeNull();
    expect(subjects()).toEqual([`avanzel: owner's changes before file ${capture.id}`, "avanzel: new library"]);
  });

  it("does not hand git a half-made .git when an agent deletes the repository", async () => {
    // git would take a .git holding only config and hooks for no repository, and commit in a folder above.
    mode("drop-git");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.commit).toBeNull();
    expect(existsSync(join(versioned.root, ".git"))).toBe(false);
    expect(outcome.guarded).toContain(".git/config");
  });

  it("leaves committing to the owner when auto_commit is off", async () => {
    librarian = new Librarian(versioned, fakeSettings({ autoCommit: false }), { clock: () => NOW });
    librarian.captureText("Do not commit me");
    const outcome = await only(librarian.file());
    expect(outcome.commit).toBeNull();
    expect(subjects()).toEqual(["avanzel: new library"]);
  });

  it("a saved answer is one commit, which the outcome hands out, and Undo takes it back", async () => {
    const outcome = await librarian.ask("Summarize my ideas", { save: true, answer: "You want a greenhouse." });
    expect(outcome.commit).toBe(head());
    expect(subjects()).toEqual(["avanzel: save answer to “Summarize my ideas”", "avanzel: new library"]);
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(existsSync(join(versioned.root, "topics", "answer.md"))).toBe(false);
    expect(read(versioned.logPath)).not.toContain("| ask |");
  });

  it("a save stopped part way hands out what it left as its own commit", async () => {
    mode("slow-messy");
    const controller = new AbortController();
    const saving = librarian.ask("Summarize my ideas", { save: true, answer: "You want a greenhouse.", signal: controller.signal });
    const half = join(versioned.root, "goals", "half.md");
    await vi.waitFor(() => expect(existsSync(half)).toBe(true), { timeout: 10_000 }); // it has left something behind
    controller.abort();
    const outcome = await saving;
    expect(outcome.result.ok).toBe(false);
    expect(outcome.commit).toBe(head());
    expect(subjects()[0]).toBe("avanzel: leftovers of an answer that was not saved");
  });

  it("a read-only ask, and a save that changed nothing, hand out no commit", async () => {
    expect((await librarian.ask("What are my goals?")).commit).toBeNull();
    mode("fail");
    expect((await librarian.ask("Summarize my ideas", { save: true, answer: "You want a greenhouse." })).commit).toBeNull();
    expect(subjects()).toEqual(["avanzel: new library"]);
  });

  it("a review hands out its commit", async () => {
    expect((await librarian.review()).commit).toBe(head());
  });

  it("a review stopped part way hands out what it left as its own commit", async () => {
    mode("slow-messy");
    const controller = new AbortController();
    const reviewing = librarian.review({ signal: controller.signal });
    const half = join(versioned.root, "goals", "half.md");
    await vi.waitFor(() => expect(existsSync(half)).toBe(true), { timeout: 10_000 }); // it has left something behind
    controller.abort();
    const outcome = await reviewing;
    expect(outcome.result.ok).toBe(false);
    expect(outcome.commit).toBe(head());
    expect(subjects()[0]).toBe("avanzel: leftovers of failed review 2026-10-20");
  });

  it("returns every commit of an evening review, the digest last", async () => {
    const one = librarian.captureText("one");
    const two = librarian.captureText("two");
    const review = await librarian.eveningReview();
    expect(subjects().slice(0, 3)).toEqual(["avanzel: evening review 2026-10-20", `avanzel: file ${two.id}`, `avanzel: file ${one.id}`]);
    expect(review.commits).toEqual(gitOut("log", "-3", "--format=%H").trim().split("\n").reverse());
    expect(review.outcomes.map((outcome) => outcome.commit)).toEqual(review.commits.slice(0, 2));
    // the owner's pending changes went into a commit of their own, which is never handed out for undo
    expect(subjects()[3]).toBe(`avanzel: owner's changes before file ${one.id}`);
    expect(review.commits).not.toContain(gitOut("log", "-1", "--skip=3", "--format=%H").trim());
  });

  it("undoes a filing: pages reverted, the capture back in the inbox, waiting captures kept (undo_reverts_filing_commits)", async () => {
    const waiting = librarian.captureText("Waiting for the evening");
    const capture = librarian.captureText("Build a tiny greenhouse");
    const original = read(capture.path);
    const index = read(versioned.indexPath);
    const log = read(versioned.logPath);
    const outcome = await only(librarian.file([capture.path]));
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(existsSync(join(versioned.root, "ideas", `idea-${capture.id}.md`))).toBe(false);
    expect(existsSync(outcome.archivedTo ?? "")).toBe(false);
    expect(read(versioned.indexPath)).toBe(index);
    expect(read(versioned.logPath)).toBe(log);
    expect(versioned.pending()).toEqual([capture.path, waiting.path]);
    expect(read(capture.path)).toBe(original);
    expect(read(waiting.path)).toContain("Waiting for the evening");
    expect(subjects()[0]).toBe(`avanzel: undo file ${capture.id}`);
    expect(gitOut("status", "--porcelain")).toBe("");
    expect(existsSync(join(versioned.root, ".git", "REVERT_HEAD"))).toBe(false);
  });

  it("undoes a whole evening review, screenshots included", async () => {
    const index = read(versioned.indexPath);
    const log = read(versioned.logPath);
    const shot = librarian.captureScreen({ image: write(tmp(), "shot.png", "PNG"), comment: "Pricing table" });
    const note = librarian.captureText("Call Anna");
    const originals = new Map([shot, note].map((capture) => [capture.path, read(capture.path)]));
    const review = await librarian.eveningReview();
    expect(review.commits).toHaveLength(3);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(versioned.pending()).toEqual([...originals.keys()].sort());
    for (const [path, text] of originals) expect(read(path)).toBe(text);
    expect(read(join(versioned.raw, "attachments", "2026", "10", "2026-10-20-140312.png"))).toBe("PNG");
    expect(existsSync(review.digestPath ?? "")).toBe(false);
    expect(read(versioned.indexPath)).toBe(index);
    expect(read(versioned.logPath)).toBe(log);
    expect(gitOut("status", "--porcelain")).toBe("");
    // and the library works as before: the same captures file again
    expect((await librarian.file()).map((outcome) => outcome.ok)).toEqual([true, true]);
  });

  it("Undo removes a link a run committed under raw/", async () => {
    // Committed straight with git: a library from before the guard removed such links may hold one.
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(versioned.raw, "2026"));
    const screenshot = write(versioned.root, "raw/attachments/2026/10/2026-10-20-140312.png", "PNG");
    const commit = await git.commitAll(versioned.root, "avanzel: file 2026-10-20-140312-harmless-words");
    expect(await librarian.undo([commit ?? ""])).toBe(1);
    expect(lstatOrNull(join(versioned.raw, "2026"))).toBeNull();
    expect(read(screenshot)).toBe("PNG");
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("leaves the library alone when a filing can no longer be undone cleanly", async () => {
    const first = await only(librarian.file([librarian.captureText("first thought").path]));
    await librarian.file([librarian.captureText("second thought").path]); // its log line now follows the first's
    const before = head();
    expect(await librarian.undo([first.commit ?? ""])).toBe(0);
    expect(head()).toBe(before);
    expect(gitOut("status", "--porcelain")).toBe("");
  });
});
