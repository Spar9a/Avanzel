import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SHELVES,
  cleanDefinition,
  folderProblem,
  MAX_OWN_SHELVES,
  sameShelf,
  SHELF_SECTION_END,
  SHELF_SECTION_START,
  suggestFolder,
  withShelfSection,
  writeShelfSection,
  type OwnShelf,
} from "../../src/core/shelves.ts";
import { template } from "../../src/core/templates.ts";
import { useTmp } from "./helpers.ts";

describe("folderProblem", () => {
  it("accepts a lowercase kebab-case folder", () => {
    expect(folderProblem("projects", [])).toBeNull();
    expect(folderProblem("side-quests-2", [])).toBeNull();
    expect(folderProblem("a".repeat(40), [])).toBeNull();
  });

  it.each([
    ["Projects", "capital letters"],
    ["-a", "a leading dash"],
    ["a--b", "a double dash"],
    ["a-", "a trailing dash"],
    ["a".repeat(41), "41 characters"],
    ["", "empty"],
    ["my projects", "a space"],
    ["проекты", "non-Latin letters"],
    ["ideas", "a built-in shelf"],
    ["meetings", "meetings, which is built in"],
    ["inbox", "a special folder"],
    ["raw", "a special folder"],
    [".x", "a leading dot"],
  ])("refuses %j (%s)", (folder) => {
    const problem = folderProblem(folder, []);
    expect(typeof problem).toBe("string");
    expect(problem).not.toBe("");
  });

  it("says a folder already taken exists, and offers a fix", () => {
    const problem = folderProblem("projects", ["projects"]);
    expect(problem).toContain("already exists");
    expect(problem).toContain("Choose another folder name");
  });

  it("does not refuse a folder that is not one of the taken ones", () => {
    expect(folderProblem("projects", ["other"])).toBeNull();
  });
});

describe("BUILT_IN_SHELVES", () => {
  it("is the six shelves and meetings", () => {
    expect(BUILT_IN_SHELVES).toEqual(["goals", "ideas", "problems", "memories", "people", "topics", "meetings"]);
    expect(MAX_OWN_SHELVES).toBe(20);
  });
});

describe("cleanDefinition", () => {
  it("collapses to one line and drops forbidden characters and strings", () => {
    expect(cleanDefinition("Work | with\n`a` <goal> [[x]] avanzel:shelves")).toBe("Work with a goal x");
  });

  it("does not let a removal join its neighbours into a forbidden string", () => {
    expect(cleanDefinition("a avanzel:sh|elves b")).toBe("a b");
    expect(cleanDefinition("a [|[x]|] b")).toBe("a x b");
  });

  it("cuts to 300 code points without splitting one", () => {
    expect([...cleanDefinition("é".repeat(400))]).toHaveLength(300);
    expect(cleanDefinition("😀".repeat(400))).toBe("😀".repeat(300));
  });

  it("trims, and leaves a plain sentence alone", () => {
    expect(cleanDefinition("  Work with a goal.  ")).toBe("Work with a goal.");
  });
});

describe("sameShelf", () => {
  it("matches folders or names ignoring case and one trailing s", () => {
    expect(sameShelf("Projects", "project")).toBe(true);
    expect(sameShelf("side-quests", "Side-quest")).toBe(true);
    expect(sameShelf(" Ideas ", "ideas")).toBe(true);
  });

  it("keeps different shelves apart", () => {
    expect(sameShelf("ideas", "idea-box")).toBe(false);
    expect(sameShelf("goals", "people")).toBe(false);
  });
});

describe("suggestFolder", () => {
  it("makes a page-style slug from the name", () => {
    expect(suggestFolder("My Projects")).toBe("my-projects");
  });

  it("is empty when the name has no Latin letters", () => {
    expect(suggestFolder("Проекты")).toBe("");
  });
});

describe("withShelfSection", () => {
  const projects: OwnShelf = { folder: "projects", name: "Projects", definition: "Work with a goal." };
  const agentsMd = template("AGENTS.md");
  const pairs = (text: string) => text.split(SHELF_SECTION_START).length - 1;

  it("puts the section right before ## Pages in the template, and again gives the same text", () => {
    // The template ships the empty section; take it out to see where a section goes when there is none.
    const bare = agentsMd.replace(/<!-- avanzel:shelves -->[\s\S]*?<!-- \/avanzel:shelves -->\n\n/, "");
    expect(bare).not.toContain(SHELF_SECTION_START);
    const once = withShelfSection(bare, [projects]);
    const pagesAt = bare.indexOf("## Pages");
    expect(once.slice(0, once.indexOf(SHELF_SECTION_START))).toBe(bare.slice(0, pagesAt));
    expect(once.slice(once.indexOf(SHELF_SECTION_END) + SHELF_SECTION_END.length)).toBe(`\n\n${bare.slice(pagesAt)}`);
    expect(withShelfSection(once, [projects])).toBe(once);
    expect(withShelfSection(agentsMd, [projects])).toBe(once);
  });

  it("writes one row per shelf in a Path and Holds table", () => {
    const text = withShelfSection("# Rules\n", [projects, { folder: "trips", name: "Trips", definition: "Places to go." }]);
    expect(text).toContain("## Your shelves");
    expect(text).toContain("| Path | Holds |\n|---|---|\n");
    expect(text).toContain("| `projects/` | Work with a goal. |\n| `trips/` | Places to go. |\n");
  });

  it("says none yet with no shelves, and the template ships that empty section", () => {
    const none = withShelfSection("# Rules\n", []);
    expect(none).toContain("## Your shelves");
    expect(none).toContain("None yet. The owner adds them in Avanzel's Settings.");
    expect(none).not.toContain("| Path |");
    expect(withShelfSection(agentsMd, [])).toBe(agentsMd);
  });

  it("rewrites the section in place and keeps the owner's line after the end marker", () => {
    const first = withShelfSection("Intro.\n\n## Pages\n", [projects]);
    const edited = first.replace(SHELF_SECTION_END, `${SHELF_SECTION_END}\nOwner note.`);
    const next = withShelfSection(edited, [{ ...projects, definition: "Work with a deadline." }]);
    expect(next).toContain("Work with a deadline.");
    expect(next).not.toContain("Work with a goal.");
    expect(next).toContain(`${SHELF_SECTION_END}\nOwner note.\n\n## Pages`);
    expect(pairs(next)).toBe(1);
  });

  it("keeps the first pair and drops later ones, with every other byte", () => {
    const section = withShelfSection("", [projects]).trimEnd();
    const input = `Top.\n\n${section}\n\nMiddle.\n\n${section}\n\nEnd.\n`;
    const out = withShelfSection(input, [projects]);
    expect(pairs(out)).toBe(1);
    expect(out).toBe(`Top.\n\n${section}\n\nMiddle.\n\nEnd.\n`);
  });

  it("appends the section after one blank line when there is no ## Pages", () => {
    const section = withShelfSection("", [projects]);
    expect(withShelfSection("Just rules.", [projects])).toBe(`Just rules.\n\n${section}`);
    expect(withShelfSection("Just rules.\n", [projects])).toBe(`Just rules.\n\n${section}`);
    expect(withShelfSection("Just rules.\n\n", [projects])).toBe(`Just rules.\n\n${section}`);
    expect(section.startsWith(SHELF_SECTION_START)).toBe(true);
  });

  it("writes the table row exactly", () => {
    expect(withShelfSection("", [projects])).toContain("\n| `projects/` | Work with a goal. |\n");
  });

  it("makes a shelf that holds a pipe or a line break one clean cell", () => {
    const rough: OwnShelf = { folder: "pro|jects\n", name: "x", definition: "a | b\nc" };
    const rows = withShelfSection("", [rough])
      .split("\n")
      .filter((line) => line.startsWith("| `"));
    expect(rows).toEqual(["| `projects/` | a b c |"]);
  });

  it("keeps a $ in a definition as it is", () => {
    const out = withShelfSection("## Pages\n", [{ ...projects, definition: "Costs in $& and $1." }]);
    expect(out).toContain("| Costs in $& and $1. |");
  });

  it("leaves a lone marker alone and adds one section", () => {
    const input = `Mine.\n${SHELF_SECTION_START}\nrest\n`;
    const out = withShelfSection(input, [projects]);
    expect(out.startsWith(input)).toBe(true);
    expect(out).toContain("| `projects/` |");
    expect(withShelfSection(out, [projects])).toBe(out);
  });
});

describe("writeShelfSection", () => {
  const tmp = useTmp();
  const projects: OwnShelf = { folder: "projects", name: "Projects", definition: "Work with a goal." };

  it("adds the section to the file and keeps the rest", () => {
    writeFileSync(join(tmp(), "AGENTS.md"), "# Mine\n\n## Pages\nx\n");
    writeShelfSection(tmp(), [projects]);
    expect(readFileSync(join(tmp(), "AGENTS.md"), "utf8")).toBe(withShelfSection("# Mine\n\n## Pages\nx\n", [projects]));
  });

  it("starts from nothing when there is no AGENTS.md", () => {
    writeShelfSection(tmp(), [projects]);
    expect(readFileSync(join(tmp(), "AGENTS.md"), "utf8")).toBe(withShelfSection("", [projects]));
  });

  it("replaces a symlink instead of following it, and starts from nothing", () => {
    const outside = join(tmp(), "outside.md");
    writeFileSync(outside, "outside text");
    mkdirSync(join(tmp(), "lib"));
    symlinkSync(outside, join(tmp(), "lib", "AGENTS.md"));
    writeShelfSection(join(tmp(), "lib"), [projects]);
    expect(readFileSync(outside, "utf8")).toBe("outside text");
    expect(readFileSync(join(tmp(), "lib", "AGENTS.md"), "utf8")).toBe(withShelfSection("", [projects]));
  });
});
