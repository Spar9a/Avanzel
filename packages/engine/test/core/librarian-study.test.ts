import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../../src/core/config.ts";
import * as git from "../../src/core/git.ts";
import { Librarian, type StudyProgress } from "../../src/core/librarian.ts";
import { readLearnedNotes } from "../../src/core/old-notes.ts";
import { Vault } from "../../src/core/vault.ts";
import { AvanzelError } from "../../src/types.ts";
import { NOW, envHome, gitIdentity, write } from "./helpers.ts";
import { fakeSettings, mode, recordRuns, tmp } from "./librarian-fixtures.ts";

const STOPPED = "The study was stopped. What it learned so far is kept, and Learn this library goes on from there.";

describe.skipIf(!git.available())("studying the library", () => {
  let vault: Vault;
  let librarian: Librarian;

  const gitOut = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const studied = (runs: ReturnType<ReturnType<typeof recordRuns>>) => runs.filter((r) => r.prompt.startsWith("Avanzel task: study-folder"));

  const settingsWith = (overrides: Parameters<typeof fakeSettings>[0]) => {
    librarian = new Librarian(vault, fakeSettings(overrides), { clock: () => NOW });
  };

  beforeEach(async () => {
    envHome(tmp());
    gitIdentity();
    vault = await Vault.init(join(tmp(), "lib"), { git: true });
    write(vault.root, "Philosophy/Stoicism/Seneca.md", "# Seneca\n\nLetters.\n");
    write(vault.root, "Philosophy/Stoicism/Epictetus.md", "# Epictetus\n");
    write(vault.root, "Philosophy/Plato.md", "# Plato\n");
    write(vault.root, "Philosophy/Kant.md", "# Kant\n");
    write(vault.root, "Philosophy/Hume.md", "# Hume\n");
    write(vault.root, "Рецепты/борщ.md", "# Борщ\n");
    write(vault.root, "Рецепты/плов.md", "# Плов\n");
    write(vault.root, "Note.md", "A loose note.\n");
    gitOut(vault.root, "add", "-A");
    gitOut(vault.root, "commit", "-m", "the owner's notes");
    settingsWith({});
  });

  it("studies each folder once, read-only, and saves a proposal", async () => {
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(proposal.shelves.map((s) => s.folder)).toEqual(["Philosophy", "Рецепты"]);
    expect(proposal.shelves[0]).toMatchObject({ name: "Philosophy", studied: true, hasDefinition: false, map: "one folder per thinker" });
    expect(proposal.style).toBe("Dates as dd.mm.yyyy.");
    expect(studied(runs()).filter((r) => r.prompt.includes("Path:"))).toHaveLength(3); // two folders and the loose notes
    expect(runs().filter((r) => r.prompt.startsWith("Avanzel task: study-combine"))).toHaveLength(1);
    expect(gitOut(vault.root, "status", "--porcelain")).toBe(""); // the owner's folders unchanged, nothing committed
    expect(gitOut(vault.root, "log", "--format=%s").split("\n").filter(Boolean)[0]).toBe("the owner's notes");
    expect(librarian.studyProposal()).toEqual(proposal);
    expect(librarian.studyResumable()).toBe(false);
  });

  it("previews the study without writing anything", async () => {
    expect(await librarian.previewStudy()).toEqual({ folders: 2, notes: 8, steps: 4 });
    expect(existsSync(join(vault.root, ".avanzel", "study"))).toBe(false);
  });

  it("tells its progress before each step", async () => {
    const seen: StudyProgress[] = [];
    await librarian.study({ progress: (p) => seen.push(p) });
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3]);
    expect(seen[0]).toMatchObject({ steps: 4, current: "Philosophy" });
    expect(seen[3]).toMatchObject({ steps: 4, current: "" });
  });

  it("stops after the step in flight and goes on from the next one", async () => {
    const abort = new AbortController();
    await expect(librarian.study({ signal: abort.signal, progress: (p) => p.done === 1 && abort.abort() })).rejects.toThrow(
      "The study was stopped.",
    );
    expect(librarian.studyResumable()).toBe(true);
    expect(librarian.studyProposal()).toBeNull();
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(runs().filter((r) => r.prompt.includes("Philosophy/"))).toHaveLength(0); // not studied again
    expect(proposal.shelves.every((s) => s.studied)).toBe(true);
  });

  it("says the stop in words the owner can read, and keeps a step the stop cut short for next time", async () => {
    vi.stubEnv("FAKE_AGENT_DELAY_MS", "800");
    vi.stubEnv("FAKE_AGENT_DELAY_TASK", "study-folder");
    const abort = new AbortController();
    const pending = librarian.study({ signal: abort.signal });
    setTimeout(() => abort.abort(), 200);
    const error = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AvanzelError);
    expect((error as Error).message).toBe(STOPPED);
    expect(existsSync(join(vault.root, ".avanzel", "study", "steps", "0.json"))).toBe(false);
    expect(librarian.studyResumable()).toBe(true);
  });

  it("asks again once for an answer it can't read, then marks the folder not studied", async () => {
    vi.stubEnv("FAKE_AGENT_FOLDER", "Рецепты");
    mode("study-garbled");
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(proposal.shelves.find((s) => s.folder === "Рецепты")).toMatchObject({ studied: false });
    expect(proposal.shelves.find((s) => s.folder === "Philosophy")).toMatchObject({ studied: true });
    expect(runs().filter((r) => r.prompt.includes('Path: "Рецепты"'))).toHaveLength(2);
  });

  const reason = async (pending: Promise<unknown>) =>
    pending.then(
      () => "",
      (e: unknown) => (e instanceof AvanzelError ? e.message : `not an AvanzelError: ${String(e)}`),
    );
  const savedStep = (n: number) => existsSync(join(vault.root, ".avanzel", "study", "steps", `${n}.json`));

  it("pauses when a run fails, saves nothing for that step, and runs it again next time", async () => {
    mode("fail-noisy");
    const runs = recordRuns();
    expect(await reason(librarian.study())).toBe(
      "The study paused because the agent stopped before it answered. What it learned so far is kept, and Learn this library goes on from there.",
    );
    expect(runs()).toHaveLength(2); // asked again once
    expect(savedStep(0)).toBe(false);
    expect(librarian.studyResumable()).toBe(true);
    expect(librarian.studyProposal()).toBeNull();

    mode("ok");
    const proposal = await librarian.study();
    expect(runs().filter((r) => r.prompt.includes('Path: "Philosophy"'))).toHaveLength(3); // twice failed, then studied
    expect(proposal.shelves.every((s) => s.studied)).toBe(true);
  });

  it("pauses when the combine run fails, and saves no proposal from it", async () => {
    const seen: number[] = [];
    const pending = librarian.study({
      progress: (p) => {
        seen.push(p.done);
        if (p.done === 3) mode("fail-noisy"); // the combine step
      },
    });
    expect(await reason(pending)).toContain("The study paused because");
    expect([0, 1, 2].map(savedStep)).toEqual([true, true, true]);
    expect(librarian.studyProposal()).toBeNull();
    expect(librarian.studyResumable()).toBe(true);

    mode("ok");
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(studied(runs())).toHaveLength(0); // only the combine step is asked again
    expect(runs().filter((r) => r.prompt.startsWith("Avanzel task: study-combine"))).toHaveLength(1);
    expect(proposal.style).toBe("Dates as dd.mm.yyyy.");
  });

  it.each([
    ["limit", "the agent has reached its usage limit"],
    ["fail-signin", "the agent is not signed in"],
  ])("pauses at once on %s, without saving the step", async (agentMode, why) => {
    mode(agentMode);
    const runs = recordRuns();
    expect(await reason(librarian.study())).toBe(
      `The study paused because ${why}. What it learned so far is kept, and Learn this library goes on from there.`,
    );
    expect(runs()).toHaveLength(1); // it would fail every step: not asked again
    expect(savedStep(0)).toBe(false);
    expect(librarian.studyResumable()).toBe(true);
  });

  it("builds the proposal from each folder's purpose when the combine reply can't be read twice", async () => {
    vi.stubEnv("FAKE_AGENT_FOLDER", "combine");
    mode("study-garbled");
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(runs().filter((r) => r.prompt.startsWith("Avanzel task: study-combine"))).toHaveLength(2);
    expect(proposal.style).toBe("");
    expect(proposal.shelves[0]).toMatchObject({ folder: "Philosophy", definition: "Notes about Philosophy.", studied: true });
  });

  it("skips a folder deleted since the study stopped", async () => {
    const abort = new AbortController();
    await expect(librarian.study({ signal: abort.signal, progress: (p) => p.done === 1 && abort.abort() })).rejects.toThrow();
    rmSync(join(vault.root, "Рецепты"), { recursive: true });
    const runs = recordRuns();
    const proposal = await librarian.study();
    expect(proposal.shelves.map((s) => s.folder)).toEqual(["Philosophy", "Рецепты"]);
    expect(proposal.shelves[1]).toMatchObject({ studied: false });
    expect(runs().filter((r) => r.prompt.includes("Рецепты/"))).toHaveLength(0);
    expect(runs().filter((r) => r.prompt.includes('Path: "Рецепты"'))).toHaveLength(0);
  });

  it("starts over when asked to, and answers from the saved proposal when it has one", async () => {
    const first = await librarian.study();
    const runs = recordRuns();
    expect(await librarian.study()).toEqual(first);
    expect(runs()).toHaveLength(0);
    await librarian.study({ fresh: true });
    expect(studied(runs())).toHaveLength(3);
  });

  it("discards what it saved", async () => {
    await librarian.study();
    await librarian.discardStudy();
    expect(existsSync(join(vault.root, ".avanzel", "study"))).toBe(false);
    expect(librarian.studyProposal()).toBeNull();
    expect(librarian.studyResumable()).toBe(false);
  });

  it("proposes no new definition for a folder that already is a shelf, and keeps the current style beside the new one", async () => {
    settingsWith({
      shelves: [{ folder: "Philosophy", name: "Thinking", definition: "What I think about." }],
      houseStyle: "Old style.",
    });
    const proposal = await librarian.study();
    expect(proposal.shelves[0]).toMatchObject({ folder: "Philosophy", name: "Thinking", definition: "What I think about.", hasDefinition: true });
    expect(proposal.shelves[1]).toMatchObject({ folder: "Рецепты", definition: "Notes about Рецепты.", hasDefinition: false });
    expect(proposal.style).toBe("Dates as dd.mm.yyyy.");
    expect(proposal.currentStyle).toBe("Old style.");
  });

  it("gives the combine step the owner's own instructions and the current style, each cut to 4,000 characters", async () => {
    settingsWith({ houseStyle: "S".repeat(5000) });
    write(vault.root, "AGENTS.md", `Always write in Russian. ${"x".repeat(6000)}\n\n${readFileSync(join(vault.root, "AGENTS.md"), "utf8")}`);
    write(vault.root, "CLAUDE.md", "Dates first.\n");
    const runs = recordRuns();
    await librarian.study();
    const combine = runs().find((r) => r.prompt.startsWith("Avanzel task: study-combine"))?.prompt ?? "";
    expect(combine).toContain("Always write in Russian.");
    expect(combine).not.toContain("x".repeat(4001));
    expect(combine).toContain("S".repeat(4000));
    expect(combine).not.toContain("S".repeat(4001));
    expect(combine).not.toContain("Your shelves"); // Avanzel's own sections are not the owner's instructions
  });

  it("does not give Avanzel's own template as the owner's instructions", async () => {
    const runs = recordRuns();
    await librarian.study();
    const combine = runs().find((r) => r.prompt.startsWith("Avanzel task: study-combine"))?.prompt ?? "";
    expect(combine).toContain("<instructions>\n(none)\n</instructions>");
  });

  it("lets a filing take the library between steps", async () => {
    vi.stubEnv("FAKE_AGENT_DELAY_MS", "400");
    vi.stubEnv("FAKE_AGENT_DELAY_TASK", "study-folder");
    const seen: number[] = [];
    const pending = librarian.study({ progress: (p) => seen.push(p.done) });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const capture = librarian.captureText("Buy olive oil");
    const [outcome] = await librarian.file();
    expect(outcome?.captureId).toBe(capture.id);
    expect(outcome?.ok).toBe(true);
    expect(seen.length).toBeLessThan(4); // the study was still going when the filing was done
    await pending;
    expect(readdirSync(join(vault.root, ".avanzel", "study")).includes("proposal.json")).toBe(true);
  });

  describe("applying a study", () => {
    const PHILOSOPHY = { folder: "Philosophy", name: "Philosophy", definition: "Ideas of thinkers.", map: "Stoicism/: one folder per thinker", fileHere: true };
    const RECIPES = { folder: "Рецепты", name: "Рецепты", definition: "Dishes.", map: "", fileHere: false };

    it("makes each chosen folder a shelf with its map, leaves out the rest, writes the style, and is one commit", async () => {
      const result = await librarian.applyStudy({ style: "Dates as dd.mm.yyyy.", shelves: [PHILOSOPHY, RECIPES] });
      const settings = loadSettings(vault.root);
      expect(settings.shelves).toEqual([
        { folder: "Philosophy", name: "Philosophy", definition: "Ideas of thinkers.", map: "Stoicism/: one folder per thinker", learnedAt: "2026-10-20" },
      ]);
      expect(settings.excludedFolders).toEqual(["Рецепты"]);
      expect(settings.houseStyle).toBe("Dates as dd.mm.yyyy.");
      expect(readFileSync(join(vault.root, "AGENTS.md"), "utf8")).toContain("## How this library is written\n\nDates as dd.mm.yyyy.");
      expect(readFileSync(join(vault.root, "AGENTS.md"), "utf8")).toContain("| `Philosophy/` | Ideas of thinkers. |");
      expect(readFileSync(vault.indexPath, "utf8")).toContain("## Philosophy\n");
      expect([...readLearnedNotes(vault.root)].sort()).toEqual([
        "Philosophy/Hume.md",
        "Philosophy/Kant.md",
        "Philosophy/Plato.md",
        "Philosophy/Stoicism/Epictetus.md",
        "Philosophy/Stoicism/Seneca.md",
      ]);
      expect(existsSync(join(vault.root, ".avanzel/study"))).toBe(false);
      expect(gitOut(vault.root, "log", "-1", "--format=%s").trim()).toBe("avanzel: learn this library");
      expect(gitOut(vault.root, "status", "--porcelain")).toBe("");
      expect(librarian.settings.houseStyle).toBe("Dates as dd.mm.yyyy.");
      expect(librarian.settings.excludedFolders).toEqual(["Рецепты"]);
      await librarian.undo([result.commit!]);
      expect(loadSettings(vault.root)).toMatchObject({ shelves: [], excludedFolders: [], houseStyle: "" });
      expect(librarian.settings).toMatchObject({ shelves: [], excludedFolders: [], houseStyle: "" });
      expect(readLearnedNotes(vault.root).size).toBe(0);
    });

    it("removes a study that was in progress", async () => {
      await librarian.study();
      expect(existsSync(join(vault.root, ".avanzel/study/proposal.json"))).toBe(true);
      await librarian.applyStudy({ style: "", shelves: [PHILOSOPHY] });
      expect(existsSync(join(vault.root, ".avanzel/study"))).toBe(false);
      expect(gitOut(vault.root, "status", "--porcelain")).toBe("");
    });

    it("applies with autoCommit off, writing everything and committing nothing", async () => {
      librarian = new Librarian(vault, fakeSettings({ autoCommit: false }), { clock: () => NOW });
      const before = gitOut(vault.root, "log", "--format=%H");
      const result = await librarian.applyStudy({ style: "Dates as dd.mm.yyyy.", shelves: [PHILOSOPHY, RECIPES] });
      expect(result.commit).toBeNull();
      expect(gitOut(vault.root, "log", "--format=%H")).toBe(before);
      expect(loadSettings(vault.root).shelves.map((s) => s.folder)).toEqual(["Philosophy"]);
      expect(readLearnedNotes(vault.root).has("Philosophy/Stoicism/Seneca.md")).toBe(true);
      expect(readFileSync(join(vault.root, "AGENTS.md"), "utf8")).toContain("Dates as dd.mm.yyyy.");
    });

    it("writes no style section into an AGENTS.md of the owner's own, and keeps the style in settings", async () => {
      writeFileSync(join(vault.root, "AGENTS.md"), "# My own rules\n\nBe brief.\n");
      const result = await librarian.applyStudy({ style: "Dates as dd.mm.yyyy.", shelves: [RECIPES] });
      expect(readFileSync(join(vault.root, "AGENTS.md"), "utf8")).toBe("# My own rules\n\nBe brief.\n");
      expect(loadSettings(vault.root).houseStyle).toBe("Dates as dd.mm.yyyy.");
      expect(result.commit).not.toBeNull(); // an exclusion and a style are a change worth a commit
    });

    it("writes no style section into an owner's AGENTS.md even when a shelf is made", async () => {
      writeFileSync(join(vault.root, "AGENTS.md"), "# My own rules\n\nBe brief.\n");
      await librarian.applyStudy({ style: "Dates as dd.mm.yyyy.", shelves: [PHILOSOPHY] });
      const agents = readFileSync(join(vault.root, "AGENTS.md"), "utf8");
      expect(agents).toContain("| `Philosophy/` | Ideas of thinkers. |");
      expect(agents).not.toContain("avanzel:style");
      expect(agents).not.toContain("Dates as dd.mm.yyyy.");
      expect(loadSettings(vault.root).houseStyle).toBe("Dates as dd.mm.yyyy.");
    });

    it("keeps a learned shelf's map and day when it is renamed", async () => {
      await librarian.applyStudy({ style: "", shelves: [PHILOSOPHY] });
      await librarian.editShelf("Philosophy", { name: "Thinkers", definition: "People who thought." });
      expect(loadSettings(vault.root).shelves).toEqual([
        { folder: "Philosophy", name: "Thinkers", definition: "People who thought.", map: "Stoicism/: one folder per thinker", learnedAt: "2026-10-20" },
      ]);
    });

    it("gives an existing own shelf its map and leaves its name and definition", async () => {
      await librarian.makeShelf({ folder: "Philosophy", name: "Thinkers", definition: "My own words." });
      await librarian.applyStudy({ style: "", shelves: [{ ...PHILOSOPHY, name: "Philosophy", definition: "Other." }] });
      expect(loadSettings(vault.root).shelves).toEqual([
        { folder: "Philosophy", name: "Thinkers", definition: "My own words.", map: "Stoicism/: one folder per thinker" },
      ]);
      expect(readLearnedNotes(vault.root).size).toBe(0); // a shelf that was there before is not newly learned
    });

    it("refuses a folder the folder rules refuse, in their own words, and changes nothing", async () => {
      const bad = { ...PHILOSOPHY, folder: "Not | allowed", name: "Bad" };
      await expect(librarian.applyStudy({ style: "x", shelves: [PHILOSOPHY, bad] })).rejects.toThrow(AvanzelError);
      expect(loadSettings(vault.root)).toMatchObject({ shelves: [], excludedFolders: [], houseStyle: "" });
      expect(gitOut(vault.root, "status", "--porcelain")).toBe("");
    });

    it("refuses two shelves with the same name", async () => {
      const twin = { ...PHILOSOPHY, folder: "Рецепты", fileHere: true };
      await expect(librarian.applyStudy({ style: "", shelves: [PHILOSOPHY, twin] })).rejects.toThrow("already exists");
    });
  });

  describe("setting the house style", () => {
    const agents = () => readFileSync(join(vault.root, "AGENTS.md"), "utf8");

    it("sets the style in settings and AGENTS.md as one commit, which undo takes back", async () => {
      await librarian.setHouseStyle("Dates as dd.mm.yyyy.");
      const shelvesBefore = loadSettings(vault.root).shelves;
      const result = await librarian.setHouseStyle("  Short paragraphs.\n");
      expect(loadSettings(vault.root).houseStyle).toBe("Short paragraphs.");
      expect(librarian.settings.houseStyle).toBe("Short paragraphs.");
      expect(agents()).toContain("## How this library is written\n\nShort paragraphs.");
      expect(agents()).not.toContain("Dates as dd.mm.yyyy.");
      expect(loadSettings(vault.root).shelves).toEqual(shelvesBefore);
      expect(gitOut(vault.root, "log", "-1", "--format=%s").trim()).toBe("avanzel: set the house style");
      expect(gitOut(vault.root, "status", "--porcelain")).toBe("");
      expect(await librarian.undo([result.commit!])).toBe(1);
      expect(loadSettings(vault.root).houseStyle).toBe("Dates as dd.mm.yyyy.");
      expect(agents()).toContain("Dates as dd.mm.yyyy.");
    });

    it("removes the style with an empty one", async () => {
      await librarian.setHouseStyle("Dates as dd.mm.yyyy.");
      await librarian.setHouseStyle("");
      expect(loadSettings(vault.root).houseStyle).toBe("");
      expect(agents()).not.toContain("avanzel:style");
      expect(agents()).not.toContain("Dates as dd.mm.yyyy.");
    });

    it("refuses a style longer than AGENTS.md should carry, and changes nothing", async () => {
      const before = gitOut(vault.root, "log", "--format=%H");
      await expect(librarian.setHouseStyle("я".repeat(4001))).rejects.toThrow(
        "The house style can be at most 4000 characters, and this one has 4001. Shorten it.",
      );
      await expect(librarian.setHouseStyle("я".repeat(4000))).resolves.toBeDefined(); // characters are counted as a person sees them
      expect(gitOut(vault.root, "log", "--format=%H").split("\n").length).toBe(before.split("\n").length + 1);
    });

    it("writes no style section into an AGENTS.md of the owner's own, and keeps the style in settings", async () => {
      writeFileSync(join(vault.root, "AGENTS.md"), "# My own rules\n\nBe brief.\n");
      await librarian.setHouseStyle("Dates as dd.mm.yyyy.");
      expect(agents()).toBe("# My own rules\n\nBe brief.\n");
      expect(loadSettings(vault.root).houseStyle).toBe("Dates as dd.mm.yyyy.");
    });

    it("leaves a study in progress alone", async () => {
      const controller = new AbortController();
      const progress = vi.fn((p: StudyProgress) => {
        if (p.done === 1) controller.abort();
      });
      await expect(librarian.study({ signal: controller.signal, progress })).rejects.toThrow(STOPPED);
      expect(librarian.studyResumable()).toBe(true);
      await librarian.setHouseStyle("Dates as dd.mm.yyyy.");
      expect(librarian.studyResumable()).toBe(true);
      expect(existsSync(join(vault.root, ".avanzel/study/plan.json"))).toBe(true);
    });
  });
});
