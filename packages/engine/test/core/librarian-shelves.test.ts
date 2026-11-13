import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "../../src/core/config.ts";
import * as git from "../../src/core/git.ts";
import { Librarian, type ShelfResult } from "../../src/core/librarian.ts";
import { Vault } from "../../src/core/vault.ts";
import { NOW, envHome, gitIdentity, write } from "./helpers.ts";
import { fakeSettings, read, tmp } from "./librarian-fixtures.ts";

const PROJECTS = { folder: "projects", name: "Projects", definition: "Work | with a goal." };

describe.skipIf(!git.available())("shelf operations", () => {
  let vault: Vault;
  let librarian: Librarian;

  const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: vault.root, encoding: "utf8" });
  const subjects = () => gitOut("log", "--format=%s").split("\n").filter(Boolean);
  const rejection = async (run: Promise<unknown>): Promise<Error> => {
    try {
      await run;
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected a refusal");
  };

  /** A page filed on the ideas shelf, with its line in the index. */
  const filePage = (name = "acme") => {
    write(vault.root, `ideas/${name}.md`, `---\ntitle: ${name}\nshelf: ideas\ncreated: 2026-10-20\n---\n# ${name}\n\nBody.\n`);
    const index = read(vault.indexPath);
    write(vault.root, "index.md", index.replace("## Ideas\n", `## Ideas\n\n- [[${name}]] — about ${name}\n`));
  };

  beforeEach(async () => {
    envHome(tmp());
    gitIdentity();
    vault = await Vault.init(join(tmp(), "lib"), { git: true });
    librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
  });

  it("makes a shelf as one commit: folder, settings, AGENTS.md section, index heading, moved page, log line", async () => {
    filePage();
    const result = await librarian.makeShelf(PROJECTS, ["ideas/acme.md"]);
    expect(result.commit).not.toBeNull();
    expect(result.moved).toEqual(["ideas/acme.md"]);
    expect(result.notMoved).toEqual([]);

    expect(existsSync(join(vault.root, "ideas/acme.md"))).toBe(false);
    expect(read(join(vault.root, "projects/acme.md"))).toBe(
      "---\ntitle: acme\nshelf: projects\ncreated: 2026-10-20\n---\n# acme\n\nBody.\n",
    );
    const index = read(vault.indexPath);
    expect(index).toContain("## Projects\n");
    expect(index.slice(index.indexOf("## Projects"))).toContain("- [[acme]] — about acme");
    expect(index.slice(0, index.indexOf("## Projects"))).not.toContain("[[acme]]");
    const agents = read(join(vault.root, "AGENTS.md"));
    expect(agents).toContain("| `projects/` | Work with a goal. |");
    expect(loadSettings(vault.root).shelves).toEqual([{ folder: "projects", name: "Projects", definition: "Work with a goal." }]);
    expect(read(vault.logPath).trimEnd().split("\n").at(-1)).toMatch(/\| shelf \| projects → \[\[acme\]\]$/);

    expect(subjects()[0]).toBe("avanzel: make shelf projects");
    expect(subjects()[1]).toBe("avanzel: owner's changes before make shelf projects");
    expect(gitOut("status", "--porcelain")).toBe("");
    expect(librarian.settings.shelves).toEqual(loadSettings(vault.root).shelves);
  });

  it("logs just the folder when no page moves", async () => {
    await librarian.makeShelf(PROJECTS);
    expect(read(vault.logPath).trimEnd().split("\n").at(-1)).toMatch(/\| shelf \| projects$/);
    expect(existsSync(join(vault.root, "projects"))).toBe(true);
    expect(read(vault.indexPath)).toContain("## Projects");
  });

  it("is undone as a whole by Undo", async () => {
    filePage();
    const before = {
      index: read(vault.indexPath),
      agents: read(join(vault.root, "AGENTS.md")),
      config: read(join(vault.root, ".avanzel/config.toml")),
      page: read(join(vault.root, "ideas/acme.md")),
    };
    const result = await librarian.makeShelf(PROJECTS, ["ideas/acme.md"]);
    expect(await librarian.undo([result.commit ?? ""])).toBe(1);
    expect(read(join(vault.root, "ideas/acme.md"))).toBe(before.page);
    expect(existsSync(join(vault.root, "projects/acme.md"))).toBe(false);
    expect(read(vault.indexPath)).toBe(before.index);
    expect(read(join(vault.root, "AGENTS.md"))).toBe(before.agents);
    expect(read(join(vault.root, ".avanzel/config.toml"))).toBe(before.config);
    expect(loadSettings(vault.root).shelves).toEqual([]);
  });

  it("refuses a shelf that is the same as one of the owner's (case and a trailing s ignored)", async () => {
    await librarian.makeShelf(PROJECTS);
    const error = await rejection(librarian.makeShelf({ folder: "project", name: "Project", definition: "Again." }));
    expect(error.name).toBe("AvanzelError");
    expect(error.message).toBe("A shelf called Projects already exists. Choose another name.");
    expect(loadSettings(vault.root).shelves).toHaveLength(1);
    // The name alone is enough, whatever the folder.
    const byName = await rejection(librarian.makeShelf({ folder: "work", name: "projects", definition: "Again." }));
    expect(byName.message).toContain("already exists");
  });

  it("refuses a folder, a name or a definition that breaks the rules, and changes nothing", async () => {
    const head = gitOut("rev-parse", "HEAD");
    expect((await rejection(librarian.makeShelf({ ...PROJECTS, folder: "ideas" }))).message).toContain("own shelves");
    expect((await rejection(librarian.makeShelf({ ...PROJECTS, name: "  " }))).name).toBe("AvanzelError");
    expect((await rejection(librarian.makeShelf({ ...PROJECTS, name: "A|B" }))).name).toBe("AvanzelError");
    expect((await rejection(librarian.makeShelf({ ...PROJECTS, name: "x".repeat(41) }))).name).toBe("AvanzelError");
    const empty = await rejection(librarian.makeShelf({ ...PROJECTS, definition: " | `<>` " }));
    expect(empty.message).toBe("Say what belongs on the shelf, then save it.");
    expect(gitOut("rev-parse", "HEAD")).toBe(head);
    expect(loadSettings(vault.root).shelves).toEqual([]);
    expect(existsSync(join(vault.root, "projects"))).toBe(false);
  });

  it("keeps a page that is already in the new folder where it is and says which page did not move", async () => {
    filePage();
    write(vault.root, "projects/acme.md", "# Hand-made acme\n");
    const result = await librarian.makeShelf(PROJECTS, ["ideas/acme.md"]);
    expect(result.moved).toEqual([]);
    expect(result.notMoved).toEqual(["ideas/acme.md"]);
    expect(read(join(vault.root, "projects/acme.md"))).toBe("# Hand-made acme\n");
    expect(existsSync(join(vault.root, "ideas/acme.md"))).toBe(true);
    expect(loadSettings(vault.root).shelves).toHaveLength(1);
    expect(read(vault.logPath).trimEnd().split("\n").at(-1)).toMatch(/\| shelf \| projects$/);
  });

  it("adopts a folder that already exists, without moving or removing anything in it", async () => {
    write(vault.root, "projects/made-by-hand.md", "# By hand\n");
    write(vault.root, "projects/notes.txt", "plain\n");
    const result = await librarian.makeShelf(PROJECTS);
    expect(result.commit).not.toBeNull();
    expect(read(join(vault.root, "projects/made-by-hand.md"))).toBe("# By hand\n");
    expect(read(join(vault.root, "projects/notes.txt"))).toBe("plain\n");
    expect(loadSettings(vault.root).shelves.map((shelf) => shelf.folder)).toEqual(["projects"]);
  });

  it("adds shelf: to a page that has none, and a front matter block to one with none", async () => {
    write(vault.root, "ideas/a.md", "---\ntitle: A\n---\n# A\n");
    write(vault.root, "ideas/b.md", "# B\n");
    write(vault.root, "index.md", `${read(vault.indexPath)}\n- [[a]] — A\n- [[b]] — B\n`);
    const result = await librarian.makeShelf(PROJECTS, ["ideas/a.md", "ideas/b.md"]);
    expect(result.moved).toEqual(["ideas/a.md", "ideas/b.md"]);
    expect(read(join(vault.root, "projects/a.md"))).toBe("---\ntitle: A\nshelf: projects\n---\n# A\n");
    expect(read(join(vault.root, "projects/b.md"))).toBe("---\nshelf: projects\n---\n# B\n");
  });

  it("does not move a page that is not a shelf page, is missing, or is a link", async () => {
    write(vault.root, "inbox/capture.md", "words\n");
    write(vault.root, "outside.md", "x\n");
    symlinkSync(join(tmp(), "elsewhere.md"), join(vault.root, "ideas/link.md"));
    write(tmp(), "elsewhere.md", "x\n");
    const pages = ["inbox/capture.md", "ideas/missing.md", "ideas/link.md", "../escape.md", "outside.md"];
    const result = await librarian.makeShelf(PROJECTS, pages);
    expect(result.moved).toEqual([]);
    expect(result.notMoved).toEqual(pages);
    expect(read(join(vault.root, "inbox/capture.md"))).toBe("words\n");
  });

  it("waits for the library lock", async () => {
    let released = false;
    const held = vault.withLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      released = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const made = librarian.makeShelf(PROJECTS).then((result) => {
      expect(released).toBe(true);
      return result;
    });
    await held;
    expect((await made).commit).not.toBeNull();
  });

  describe("editShelf", () => {
    it("renames the shelf, its index heading and its section, in one commit", async () => {
      await librarian.makeShelf(PROJECTS);
      const result = await librarian.editShelf("projects", { name: "Work", definition: "What I do | `now`." });
      expect(result.commit).not.toBeNull();
      expect(subjects()[0]).toBe("avanzel: edit shelf projects");
      expect(loadSettings(vault.root).shelves).toEqual([{ folder: "projects", name: "Work", definition: "What I do now." }]);
      const index = read(vault.indexPath);
      expect(index).toContain("## Work");
      expect(index).not.toContain("## Projects");
      expect(read(join(vault.root, "AGENTS.md"))).toContain("| `projects/` | What I do now. |");
      expect(librarian.settings.shelves[0]?.name).toBe("Work");
    });

    it("changes only the definition when the name stays", async () => {
      await librarian.makeShelf(PROJECTS);
      const index = read(vault.indexPath);
      await librarian.editShelf("projects", { definition: "Something else." });
      expect(read(vault.indexPath)).toBe(index);
      expect(loadSettings(vault.root).shelves[0]?.definition).toBe("Something else.");
    });

    it("refuses an unknown shelf, an empty definition and another shelf's name", async () => {
      await librarian.makeShelf(PROJECTS);
      await librarian.makeShelf({ folder: "work", name: "Work", definition: "Jobs." });
      expect((await rejection(librarian.editShelf("nope", { name: "X" }))).name).toBe("AvanzelError");
      expect((await rejection(librarian.editShelf("work", { definition: "|" }))).message).toBe(
        "Say what belongs on the shelf, then save it.",
      );
      expect((await rejection(librarian.editShelf("work", { name: "Project" }))).message).toBe(
        "A shelf called Projects already exists. Choose another name.",
      );
    });
  });

  describe("removeShelf", () => {
    it("refuses while the shelf still has pages", async () => {
      await librarian.makeShelf(PROJECTS);
      write(vault.root, "projects/acme.md", "# Acme\n");
      const error = await rejection(librarian.removeShelf("projects"));
      expect(error.name).toBe("AvanzelError");
      expect(error.message).toBe("The Projects shelf still has pages, so it was kept. Move or remove its pages first.");
      expect(existsSync(join(vault.root, "projects/acme.md"))).toBe(true);
      expect(loadSettings(vault.root).shelves).toHaveLength(1);
    });

    it("removes an empty shelf: folder, entry, empty heading and section row, in one commit", async () => {
      await librarian.makeShelf(PROJECTS);
      const result = await librarian.removeShelf("projects");
      expect(result.commit).not.toBeNull();
      expect(subjects()[0]).toBe("avanzel: remove shelf projects");
      expect(existsSync(join(vault.root, "projects"))).toBe(false);
      expect(loadSettings(vault.root).shelves).toEqual([]);
      expect(read(vault.indexPath)).not.toContain("## Projects");
      expect(read(join(vault.root, "AGENTS.md"))).not.toContain("projects/");
      expect(librarian.settings.shelves).toEqual([]);
    });

    it("keeps an index heading that still has lines, and a folder that holds files that aren't pages", async () => {
      await librarian.makeShelf(PROJECTS);
      write(vault.root, "index.md", `${read(vault.indexPath)}\n- [[loose]] — a line of the owner's\n`);
      write(vault.root, "projects/diagram.png", "png");
      await librarian.removeShelf("projects");
      expect(read(vault.indexPath)).toContain("## Projects");
      expect(read(vault.indexPath)).toContain("[[loose]]");
      expect(read(join(vault.root, "projects/diagram.png"))).toBe("png");
      expect(loadSettings(vault.root).shelves).toEqual([]);
    });

    it("refuses a folder that is not one of the owner's shelves", async () => {
      expect((await rejection(librarian.removeShelf("ideas"))).name).toBe("AvanzelError");
      expect(existsSync(join(vault.root, "ideas"))).toBe(true);
    });
  });

  describe("declineShelf", () => {
    it("moves the agent's pages to topics/, removes the empty folder and remembers the folder", async () => {
      write(vault.root, "side-quests/x.md", "---\ntitle: X\nshelf: side-quests\n---\n# X\n");
      write(vault.root, "index.md", `${read(vault.indexPath)}\n\n## Side-quests\n\n- [[x]] — X\n`);
      const result = await librarian.declineShelf("side-quests", ["side-quests/x.md"]);
      expect(result.commit).not.toBeNull();
      expect(result.moved).toEqual(["side-quests/x.md"]);
      expect(subjects()[0]).toBe("avanzel: decline shelf side-quests");
      expect(read(join(vault.root, "topics/x.md"))).toBe("---\ntitle: X\nshelf: topics\n---\n# X\n");
      expect(existsSync(join(vault.root, "side-quests"))).toBe(false);
      expect(loadSettings(vault.root).declinedShelves).toEqual(["side-quests"]);
      const index = read(vault.indexPath);
      expect(index.slice(index.indexOf("## Topics"))).toContain("[[x]] — X");
      expect(librarian.settings.declinedShelves).toEqual(["side-quests"]);
    });

    it("does not list a folder twice, and keeps a folder that still holds something", async () => {
      write(vault.root, "side-quests/x.md", "# X\n");
      write(vault.root, "side-quests/mine.md", "# Mine\n");
      await librarian.declineShelf("side-quests", ["side-quests/x.md"]);
      await librarian.declineShelf("side-quests");
      expect(loadSettings(vault.root).declinedShelves).toEqual(["side-quests"]);
      expect(readdirSync(join(vault.root, "side-quests"))).toEqual(["mine.md"]);
    });

    it("leaves a page in place when topics/ already has one of that name", async () => {
      write(vault.root, "side-quests/x.md", "# X\n");
      write(vault.root, "topics/x.md", "# Other\n");
      const result = await librarian.declineShelf("side-quests", ["side-quests/x.md"]);
      expect(result.notMoved).toEqual(["side-quests/x.md"]);
      expect(read(join(vault.root, "side-quests/x.md"))).toBe("# X\n");
      expect(read(join(vault.root, "topics/x.md"))).toBe("# Other\n");
    });

    it("refuses a built-in shelf, one of the owner's, or a path", async () => {
      await librarian.makeShelf(PROJECTS);
      for (const folder of ["ideas", "projects", "../x", "a/b", ".git", "inbox"]) {
        expect((await rejection(librarian.declineShelf(folder))).name).toBe("AvanzelError");
      }
      expect(loadSettings(vault.root).declinedShelves).toEqual([]);
    });
  });

  it("works from the settings on disk, not a copy made at construction", async () => {
    const stale = new Librarian(vault, fakeSettings(), { clock: () => NOW });
    await librarian.makeShelf(PROJECTS);
    await stale.makeShelf({ folder: "work", name: "Work", definition: "Jobs." });
    expect(loadSettings(vault.root).shelves.map((shelf) => shelf.folder)).toEqual(["projects", "work"]);
    expect(stale.settings.shelves.map((shelf) => shelf.folder)).toEqual(["projects", "work"]);
    expect(stale.settings.harness).toBe("fake"); // the rest of its settings is untouched
  });

  it("makes and keeps its shelf with auto-commit off, returning no commit", async () => {
    librarian = new Librarian(vault, fakeSettings({ autoCommit: false }), { clock: () => NOW });
    const result = await librarian.makeShelf(PROJECTS);
    expect(result.commit).toBeNull();
    expect(loadSettings(vault.root).shelves).toHaveLength(1);
  });
});

describe("shelf operations without git", () => {
  it("make, edit and remove work in a library with no git", async () => {
    const vault = await Vault.init(join(tmp(), "plain"), { git: false });
    const librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
    const made: ShelfResult = await librarian.makeShelf(PROJECTS);
    expect(made).toEqual({ commit: null, moved: [], notMoved: [] });
    await librarian.editShelf("projects", { name: "Work" });
    await librarian.removeShelf("projects");
    expect(readFileSync(vault.indexPath, "utf8")).not.toContain("## Work");
  });
});
