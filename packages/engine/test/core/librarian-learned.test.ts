import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "../../src/core/git.ts";
import { Librarian } from "../../src/core/librarian.ts";
import { Vault } from "../../src/core/vault.ts";
import { NOW, envHome, gitIdentity, write } from "./helpers.ts";
import { fakeSettings, mode, recordRuns, tmp } from "./librarian-fixtures.ts";

const SENECA = "---\ntitle: Seneca\n---\n# Seneca\n\n## 01.11.2026\nСенека пишет о письмах к Луцилию.\n\n## 02.11.2026\nЕщё о письмах.\n";
const PHILOSOPHY = { folder: "Philosophy", name: "Philosophy", definition: "Ideas of thinkers.", map: "Stoicism/: one folder per thinker", fileHere: true };
const DIARY = { folder: "Diary", name: "Diary", definition: "Days.", map: "one note per year", fileHere: true };
const RECIPES = { folder: "Recipes", name: "Recipes", definition: "Dishes.", map: "", fileHere: false };

describe.skipIf(!git.available())("filing in a learned library", () => {
  let vault: Vault;
  let librarian: Librarian;

  const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: vault.root, encoding: "utf8" });
  const capture = (words = "Сенека о письмах") => vault.newCapture(words, { source: "text", now: NOW });
  const NOT_FILED = "only changed notes it may not rewrite, so they were put back as they were. The thought stays in the inbox for the next filing.";
  const HINT =
    "These shelves were learned from the library: Philosophy/, Diary/. Their notes are not all in index.md: search them by name and text before you create a page.";

  beforeEach(async () => {
    envHome(tmp());
    gitIdentity();
    vault = await Vault.init(join(tmp(), "lib"), { git: true });
    write(vault.root, "Philosophy/Stoicism/Seneca.md", SENECA);
    write(vault.root, "Diary/2026.md", "# 2026\n\nПрогулка у моря.\n");
    write(vault.root, "Recipes/borscht.md", "# Borscht\n\nСвёкла, письма.\n");
    gitOut("add", "-A");
    gitOut("commit", "-m", "the owner's notes");
    librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
  });

  describe("after a study was applied", () => {
    beforeEach(async () => {
      await librarian.applyStudy({ style: "Dates as dd.mm.yyyy.", shelves: [PHILOSOPHY, DIARY, RECIPES] });
    });

    it("finds the old note by its words and adds the thought to it, keeping every old line", async () => {
      mode("add-to-found");
      const runs = recordRuns();
      capture();
      const [outcome] = await librarian.file();
      expect(outcome!.ok).toBe(true);
      expect(outcome!.keptOld).toEqual([]);
      expect(outcome!.newFolders).toEqual([]);
      expect(readFileSync(join(vault.root, "Philosophy/Stoicism/Seneca.md"), "utf8")).toMatch(
        /## 01\.11\.2026[\s\S]*## 20\.10\.2026\nСенека о письмах/,
      );
      const prompt = runs()[0]!.prompt;
      expect(prompt).toContain("<house-style>\nDates as dd.mm.yyyy.\n</house-style>");
      expect(prompt).toContain("<found-notes>\n- path: Philosophy/Stoicism/Seneca.md\n");
      expect(prompt).not.toContain("Recipes/borscht.md"); // an excluded folder is never searched
      expect(prompt).toContain("- Philosophy/: Ideas of thinkers.\n  map: Stoicism/: one folder per thinker\n");
      expect(prompt).toContain("- Diary/: Days.\n</shelves>"); // notes were found, none of them on this shelf: no map for it
      expect(prompt).toContain(HINT);
    });

    it("gives the map that a later study gave a hand-made shelf in every filing, notes found or not", async () => {
      await librarian.makeShelf({ folder: "projects", name: "Projects", definition: "Work." });
      await librarian.applyStudy({
        style: "Dates as dd.mm.yyyy.",
        shelves: [{ folder: "projects", name: "Projects", definition: "Work.", map: "one folder per client", fileHere: true }],
      });
      expect(librarian.settings.shelves.find((shelf) => shelf.folder === "projects")).toEqual({
        folder: "projects",
        name: "Projects",
        definition: "Work.",
        map: "one folder per client",
      });
      mode("add-to-found");
      const runs = recordRuns();
      capture();
      await librarian.file();
      capture("Купить хлеба");
      mode("ok");
      await librarian.file();
      const [found, nothing] = runs().map((run) => run.prompt);
      for (const prompt of [found!, nothing!]) expect(prompt).toContain("- projects/: Work.\n  map: one folder per client\n");
      expect(found).toContain("<found-notes>");
      expect(found).toContain("- Diary/: Days.\n- projects/"); // a learned shelf with no note found still gets no map
      expect(nothing).not.toContain("<found-notes>");
    });

    it("tells the agent to search the learned shelves and gives their maps when no note was found", async () => {
      const runs = recordRuns();
      capture("Купить хлеба");
      const [outcome] = await librarian.file();
      expect(outcome!.ok).toBe(true);
      const prompt = runs()[0]!.prompt;
      expect(prompt).not.toContain("<found-notes>");
      expect(prompt).toContain(HINT);
      expect(prompt).toContain("may only be added to: never change, move or delete a line that is already in it.");
      expect(prompt).toContain("- Philosophy/: Ideas of thinkers.\n  map: Stoicism/: one folder per thinker\n");
      expect(prompt).toContain("- Diary/: Days.\n  map: one note per year\n");
    });

    it("puts an old note back when the run rewrote it, and says so", async () => {
      mode("rewrite-found");
      const made = capture();
      const [outcome] = await librarian.file();
      expect(outcome!.ok).toBe(false); // the thought is on no shelf: it stays in the inbox for the next filing
      expect(outcome!.error).toContain(NOT_FILED);
      expect(outcome!.archivedTo).toBeNull();
      expect(existsSync(made.path)).toBe(true);
      expect(outcome!.keptOld).toEqual(["Philosophy/Stoicism/Seneca.md"]);
      expect(outcome!.keptOut).toEqual([]);
      expect(outcome!.changes.modified).not.toContain("Philosophy/Stoicism/Seneca.md");
      expect(readFileSync(join(vault.root, "Philosophy/Stoicism/Seneca.md"), "utf8")).toBe(SENECA);
      expect(gitOut("status", "--porcelain")).toBe("");
    });

    it("names a subfolder it made in a learned shelf, and Undo takes the folder away with the page", async () => {
      mode("new-subfolder");
      vi.stubEnv("FAKE_AGENT_FOLDER", "Philosophy/Stoicism/Epictetus");
      capture();
      const [outcome] = await librarian.file();
      expect(outcome!.ok).toBe(true);
      expect(outcome!.newFolders).toEqual(["Philosophy/Stoicism/Epictetus"]);
      await librarian.undo([outcome!.commit!]);
      expect(existsSync(join(vault.root, "Philosophy/Stoicism/Epictetus"))).toBe(false);
      expect(existsSync(join(vault.root, "Philosophy/Stoicism"))).toBe(true);
      expect(existsSync(join(vault.root, "Philosophy"))).toBe(true);
    });

    it("takes away, on Undo, a subfolder left with only Finder's files, but never the shelf's own folder", async () => {
      mode("new-subfolder");
      vi.stubEnv("FAKE_AGENT_FOLDER", "Philosophy/Cynics");
      capture();
      const [first] = await librarian.file();
      write(vault.root, "Philosophy/Cynics/.DS_Store", "");
      await librarian.undo([first!.commit!]);
      expect(existsSync(join(vault.root, "Philosophy/Cynics"))).toBe(false);
      expect(existsSync(join(vault.root, "Philosophy"))).toBe(true);
    });

    it("names no folder that was already there", async () => {
      mode("new-subfolder");
      vi.stubEnv("FAKE_AGENT_FOLDER", "Philosophy/Stoicism");
      capture();
      const [outcome] = await librarian.file();
      expect(outcome!.ok).toBe(true);
      expect(outcome!.newFolders).toEqual([]);
    });

    it("puts back anything the run wrote in an excluded folder", async () => {
      mode("new-subfolder");
      vi.stubEnv("FAKE_AGENT_FOLDER", "Recipes/soups");
      const made = capture();
      const [outcome] = await librarian.file();
      const page = `Recipes/soups/idea-${made.id}.md`;
      expect(outcome!.ok).toBe(false);
      expect(outcome!.error).toContain(NOT_FILED);
      expect(existsSync(made.path)).toBe(true);
      // A page the run made in a folder the owner left out was taken away, not kept as it was: it isn't one of their old notes.
      expect(outcome!.keptOld).toEqual([]);
      expect(outcome!.keptOut).toEqual([page]);
      expect(outcome!.newFolders).toEqual([]);
      expect(outcome!.changes.created).not.toContain(page);
      expect(existsSync(join(vault.root, page))).toBe(false);
      expect(readFileSync(join(vault.root, "Recipes/borscht.md"), "utf8")).toBe("# Borscht\n\nСвёкла, письма.\n");
    });

    it("puts an old note back after a review that rewrote it", async () => {
      mode("rewrite-note");
      vi.stubEnv("FAKE_AGENT_PAGE", "Philosophy/Stoicism/Seneca.md");
      const runs = recordRuns();
      const reviewed = await librarian.review();
      expect(reviewed.result.ok).toBe(true);
      expect(readFileSync(join(vault.root, "Philosophy/Stoicism/Seneca.md"), "utf8")).toBe(SENECA);
      expect(reviewed.changes.modified).not.toContain("Philosophy/Stoicism/Seneca.md");
      expect(runs()[0]!.prompt).toContain("On a shelf learned from the library (learned on 2026-10-20)");
    });

    it("puts an old note back after a saved answer that rewrote it", async () => {
      mode("rewrite-note");
      vi.stubEnv("FAKE_AGENT_PAGE", "Philosophy/Stoicism/Seneca.md");
      const runs = recordRuns();
      const asked = await librarian.ask("Что писал Сенека?", { save: true });
      expect(asked.result.ok).toBe(true);
      expect(asked.commit).not.toBeNull();
      expect(readFileSync(join(vault.root, "Philosophy/Stoicism/Seneca.md"), "utf8")).toBe(SENECA);
      expect(asked.changes.modified).not.toContain("Philosophy/Stoicism/Seneca.md");
      expect(asked.changes.created).toContain("topics/answer.md");
      expect(runs()[0]!.prompt).toContain("A note that was the owner's before may only be added to");
      expect(gitOut("status", "--porcelain")).toBe("");
    });
  });

  it("files as before in a library that learned nothing: no found notes, no style in the prompt", async () => {
    librarian = new Librarian(vault, fakeSettings({ shelves: [{ folder: "Philosophy", name: "Philosophy", definition: "Thinkers.", map: "Stoicism/" }] }), {
      clock: () => NOW,
    });
    const runs = recordRuns();
    capture();
    const [outcome] = await librarian.file();
    expect(outcome!.ok).toBe(true);
    expect(outcome!.keptOld).toEqual([]);
    expect(outcome!.newFolders).toEqual([]);
    const prompt = runs()[0]!.prompt;
    expect(prompt).not.toContain("<found-notes>");
    expect(prompt).not.toContain("<house-style>");
    expect(prompt).not.toContain("learned from the library");
    expect(prompt).toContain("- Philosophy/: Thinkers.\n  map: Stoicism/\n"); // a shelf's map is given whether or not it was learned
  });
});
