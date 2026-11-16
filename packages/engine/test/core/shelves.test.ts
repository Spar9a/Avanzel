import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentMadeFolders,
  BUILT_IN_DEFINITIONS,
  BUILT_IN_SHELVES,
  checkedSuggestion,
  cleanDefinition,
  folderProblem,
  parseSuggestion,
  sameShelf,
  SHELF_SECTION_END,
  SHELF_SECTION_START,
  STYLE_SECTION_START,
  suggestFolder,
  withIndexHeading,
  withIndexHeadingRenamed,
  withIndexLineMoved,
  withoutEmptyIndexHeading,
  withShelfSection,
  withStyleSection,
  writeShelfSection,
  writeStyleSection,
  type OwnShelf,
} from "../../src/core/shelves.ts";
import { template } from "../../src/core/templates.ts";
import { useTmp } from "./helpers.ts";

describe("folderProblem", () => {
  it("accepts a folder named as the owner likes: any language, capitals, spaces, dashes and underscores", () => {
    for (const folder of [
      "projects", "side-quests-2", "a".repeat(40), "Projects", "my projects", "проекты", "Мои проекты", "Ёлка и йод", "x_y",
      "a--b", "-a", "2024 Поездки", "日記", "Café", "п".repeat(40),
    ]) {
      expect(folderProblem(folder, []), folder).toBeNull();
    }
  });

  it.each([
    ["a".repeat(41), "41 characters"],
    ["п".repeat(41), "41 Cyrillic characters"],
    ["", "empty"],
    [" projects", "a leading space"],
    ["projects ", "a trailing space"],
    ["a/b", "a slash"],
    ["a\\b", "a backslash"],
    ["a:b", "a colon"],
    ["a|b", "the table separator"],
    ["a`b", "a backtick"],
    ["[[a]]", "wikilink brackets"],
    ["a#b", "a hash"],
    ["a^b", "a caret"],
    ['a"b', "a double quote"],
    ["a*b", "an asterisk"],
    ["a?b", "a question mark"],
    ["a<b>", "angle brackets"],
    ["a\nb", "a line break"],
    ["a\u2028b", "a line separator"],
    ["a\tb", "a tab"],
    ["ideas", "a built-in shelf"],
    ["Ideas", "a built-in shelf in another case"],
    ["meetings", "meetings, which is built in"],
    ["inbox", "a special folder"],
    ["Raw", "a special folder in another case"],
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

  it("takes a folder as taken in any case and either Unicode form", () => {
    expect(folderProblem("Проекты", ["проекты"])).toContain("already exists");
    // "й" written as one character and as "и" with its mark: macOS may keep a folder's name either way.
    expect(folderProblem("мой", ["мой"])).toContain("already exists");
  });
});

describe("BUILT_IN_SHELVES", () => {
  it("is the six shelves and meetings", () => {
    expect(BUILT_IN_SHELVES).toEqual(["goals", "ideas", "problems", "memories", "people", "topics", "meetings"]);
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

  it("keeps the letters of any language, and drops only the accents of Latin ones", () => {
    expect(suggestFolder("Проекты")).toBe("проекты");
    expect(suggestFolder("Мои  проекты, 2024!")).toBe("мои-проекты-2024");
    expect(suggestFolder("Йога и ёлки")).toBe("йога-и-ёлки");
    expect(suggestFolder("Café à Paris")).toBe("cafe-a-paris");
    expect(suggestFolder("a b c d e f g h")).toBe("a-b-c-d-e");
    expect([...suggestFolder("п".repeat(60))]).toHaveLength(40);
  });

  it("is empty when the name has no letters or digits, and what it suggests passes the folder rule", () => {
    expect(suggestFolder("💡 !!")).toBe("");
    for (const name of ["Проекты", "My Projects", "Café à Paris", "Мои проекты 2024", "日記 帳"]) {
      expect(folderProblem(suggestFolder(name), []), name).toBeNull();
    }
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

  it("writes each shelf's map under the table, a line of it to an item, made safe as a definition is", () => {
    const map = "- Stoicism/: one folder per thinker\n\nDiary/: by `year` | <!-- /avanzel:shelves --> [[x]]";
    const text = withShelfSection("# Rules\n", [projects, { folder: "Philosophy", name: "Philosophy", definition: "Thinkers.", map }]);
    expect(text).toContain(
      "| `Philosophy/` | Thinkers. |\n\nHow the subfolders of these shelves are used:\n\n" +
        "- `Philosophy/`\n  - Stoicism/: one folder per thinker\n  - Diary/: by year !-- / -- x\n\n" +
        SHELF_SECTION_END,
    );
    expect(pairs(text)).toBe(1);
    expect(withShelfSection("# Rules\n", [projects])).not.toContain("How the subfolders");
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

describe("index headings", () => {
  const index = "# Index\n\nIntro.\n\n## Ideas\n\n- [[acme]] — Acme\n- [[beta]] — Beta\n\n## Topics\n";

  it("adds a heading after the last block, once", () => {
    const added = withIndexHeading(index, "Projects");
    expect(added).toBe(`${index}\n## Projects\n`);
    expect(withIndexHeading(added, "projects")).toBe(added);
    expect(withIndexHeading("", "Projects")).toBe("## Projects\n");
  });

  it("moves a line to the end of the block under a heading, adding the heading when missing", () => {
    const moved = withIndexLineMoved(withIndexHeading(index, "Projects"), "acme", "Projects");
    expect(moved).toBe("# Index\n\nIntro.\n\n## Ideas\n\n- [[beta]] — Beta\n\n## Topics\n\n## Projects\n\n- [[acme]] — Acme\n");
    expect(withIndexLineMoved(moved, "beta", "Projects")).toContain("- [[acme]] — Acme\n- [[beta]] — Beta\n");
    expect(withIndexLineMoved(index, "acme", "Topics")).toBe(
      "# Index\n\nIntro.\n\n## Ideas\n\n- [[beta]] — Beta\n\n## Topics\n\n- [[acme]] — Acme\n",
    );
    expect(withIndexLineMoved(index, "missing", "Topics")).toBe(index);
  });

  it("renames a heading, unless the new name is a heading already", () => {
    expect(withIndexHeadingRenamed(index, "Ideas", "Sparks")).toContain("## Sparks\n");
    expect(withIndexHeadingRenamed(index, "Ideas", "Topics")).toBe(index);
    expect(withIndexHeadingRenamed(index, "Nope", "Sparks")).toBe(index);
  });

  it("removes an empty heading and the blank lines after it, and nothing else", () => {
    const withEmpty = `${index}\n## Projects\n\n## People\n\n- [[ann]] — Ann\n`;
    expect(withoutEmptyIndexHeading(withEmpty, "Projects")).toBe(`${index}\n## People\n\n- [[ann]] — Ann\n`);
    expect(withoutEmptyIndexHeading(withEmpty, "People")).toBe(withEmpty);
    expect(withoutEmptyIndexHeading(withEmpty, "Ideas")).toBe(withEmpty);
  });
});

describe("withStyleSection", () => {
  const agentsMd = template("AGENTS.md");

  it("puts the style right after the shelves section, and rewrites it in place", () => {
    const once = withStyleSection(agentsMd, "Dates as 16.11.2026.");
    expect(once.indexOf(STYLE_SECTION_START)).toBeGreaterThan(once.indexOf(SHELF_SECTION_END));
    expect(once).toContain("## How this library is written\n\nDates as 16.11.2026.");
    expect(withStyleSection(once, "New style.").split(STYLE_SECTION_START)).toHaveLength(2);
    expect(withStyleSection(once, "New style.")).not.toContain("16.11.2026");
  });

  it("removes the section for an empty style, leaving the rest byte for byte", () => {
    expect(withStyleSection(withStyleSection(agentsMd, "x"), "")).toBe(agentsMd);
  });

  it("goes at the end of an AGENTS.md of the owner's own without shelf markers", () => {
    expect(withStyleSection("# Mine\n", "x")).toMatch(/^# Mine\n\n<!-- avanzel:style -->/);
  });

  it("does not let a removed marker join its neighbours into a new one", () => {
    for (const kind of ["style", "shelves"]) {
      const joined = withStyleSection("# Mine\n", `x <!-- avanzel:<!-- avanzel:${kind} -->${kind} --> y`);
      expect(joined).not.toContain(`<!-- avanzel:shelves -->`);
      expect(joined.split(STYLE_SECTION_START)).toHaveLength(2);
      expect(joined.split("<!-- /avanzel:style -->")).toHaveLength(2);
      expect(joined).not.toMatch(new RegExp(`<!--\\s*avanzel:${kind}\\s*-->[\\s\\S]*<!--\\s*avanzel:${kind}\\s*-->`));
      expect(withStyleSection(joined, "")).toBe("# Mine\n");
    }
  });

  it("changes nothing when there is no style and no section", () => {
    expect(withStyleSection("# Mine\n", "")).toBe("# Mine\n");
  });
});

describe("writeStyleSection", () => {
  const tmp = useTmp();

  it("writes the style into AGENTS.md and keeps the rest", () => {
    writeFileSync(join(tmp(), "AGENTS.md"), "# Mine\n");
    writeStyleSection(tmp(), "Dates as 16.11.2026.");
    expect(readFileSync(join(tmp(), "AGENTS.md"), "utf8")).toBe(withStyleSection("# Mine\n", "Dates as 16.11.2026."));
  });

  it("replaces a symlink instead of following it", () => {
    const outside = join(tmp(), "outside.md");
    writeFileSync(outside, "outside text");
    mkdirSync(join(tmp(), "lib"));
    symlinkSync(outside, join(tmp(), "lib", "AGENTS.md"));
    writeStyleSection(join(tmp(), "lib"), "x");
    expect(readFileSync(outside, "utf8")).toBe("outside text");
    expect(readFileSync(join(tmp(), "lib", "AGENTS.md"), "utf8")).toBe(withStyleSection("", "x"));
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

describe("BUILT_IN_DEFINITIONS", () => {
  it("holds what AGENTS.md's table says each built-in shelf holds", () => {
    const table = template("AGENTS.md");
    expect(Object.keys(BUILT_IN_DEFINITIONS).sort()).toEqual([...BUILT_IN_SHELVES].sort());
    for (const folder of BUILT_IN_SHELVES) {
      expect(table).toContain(`| \`${folder}/\` | ${BUILT_IN_DEFINITIONS[folder]} |`);
    }
  });
});

describe("parseSuggestion", () => {
  const line = "New shelf: projects | Projects | Work. | ideas/a.md";
  const parsed = { folder: "projects", name: "Projects", definition: "Work.", page: "ideas/a.md" };

  it("reads the four parts of the line", () => {
    expect(parseSuggestion(`Filed.\n${line}`)).toEqual(parsed);
  });

  it("takes the last well-formed line", () => {
    expect(parseSuggestion(`${line}\nNew shelf: trips | Trips | Journeys. | ideas/b.md`)).toEqual({
      folder: "trips",
      name: "Trips",
      definition: "Journeys.",
      page: "ideas/b.md",
    });
    expect(parseSuggestion(`${line}\nNew shelf: broken`)).toEqual(parsed);
  });

  it("ignores a line inside a fenced block", () => {
    expect(parseSuggestion(`Here:\n\`\`\`\n${line}\n\`\`\`\nFiled.`)).toBeNull();
    expect(parseSuggestion(`\`\`\`text\n${line}\n\`\`\`\n${line.replace("projects", "trips")}`)?.folder).toBe("trips");
  });

  it("accepts surrounding space and a full stop after the path", () => {
    expect(parseSuggestion(`  ${line}.  `)).toEqual(parsed);
  });

  it("is null when the line is malformed", () => {
    expect(parseSuggestion("Filed.")).toBeNull();
    expect(parseSuggestion("New shelf: projects | Projects | ideas/a.md")).toBeNull(); // three parts
    expect(parseSuggestion(`${line} | extra`)).toBeNull(); // five parts
    expect(parseSuggestion("New shelf: projects |  | Work. | ideas/a.md")).toBeNull();
    expect(parseSuggestion("New shelf: ")).toBeNull();
  });
});

describe("checkedSuggestion", () => {
  const parsed = { folder: "projects", name: "Projects", definition: "Work with a goal.", page: "ideas/a.md" };
  const state = {
    created: ["ideas/a.md"],
    own: [] as OwnShelf[],
    declined: [] as string[],
    pending: [] as Array<{ folder: string; name: string; definition: string }>,
    onDisk: ["goals", "ideas", "inbox"],
  };

  it("keeps a good suggestion, with its page", () => {
    expect(checkedSuggestion(parsed, state)).toEqual({
      folder: "projects",
      name: "Projects",
      definition: "Work with a goal.",
      pages: ["ideas/a.md"],
      agentMade: false,
    });
    expect(checkedSuggestion(null, state)).toBeNull();
  });

  it("cleans the name and the definition", () => {
    const checked = checkedSuggestion({ ...parsed, name: " My|  Projects ", definition: "Work <b>with</b>\n`a` goal. [[x]]" }, state);
    expect(checked?.name).toBe("My Projects");
    expect(checked?.definition).toBe("Work bwith/b a goal. x");
  });

  it("drops a folder that breaks the folder rules, or is a built-in or special folder", () => {
    for (const folder of ["a/b", "x:y", "goals", "Ideas", "meetings", "inbox", ".hidden", "", "a".repeat(41)]) {
      expect(checkedSuggestion({ ...parsed, folder }, state), folder).toBeNull();
    }
  });

  it("keeps a folder named in another language, with capitals and spaces", () => {
    expect(checkedSuggestion({ ...parsed, folder: "Мои проекты", name: "Мои проекты" }, state)?.folder).toBe("Мои проекты");
  });

  it("drops a folder, name or definition that is empty after trimming, however it matches", () => {
    expect(checkedSuggestion({ ...parsed, name: "   " }, state)).toBeNull();
    expect(checkedSuggestion({ ...parsed, name: "|" }, state)).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "  " }, state)).toBeNull();
    expect(checkedSuggestion({ ...parsed, definition: "<>" }, state)).toBeNull();
    expect(checkedSuggestion({ ...parsed, name: "  ", folder: "x" }, { ...state, declined: ["", "y"] })).toBeNull();
  });

  it("drops a folder that is on disk already", () => {
    expect(checkedSuggestion(parsed, { ...state, onDisk: ["projects"] })).toBeNull();
    expect(checkedSuggestion(parsed, { ...state, onDisk: ["Projects"] })).toBeNull();
  });

  it("drops one that was declined, the same shelf as one declined, or the same as an own or built-in shelf", () => {
    expect(checkedSuggestion(parsed, { ...state, declined: ["projects"] })).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "project" }, { ...state, declined: ["projects"] })).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "work", name: "Projects" }, { ...state, declined: ["project"] })).toBeNull();
    const own = [{ folder: "work", name: "Work", definition: "Jobs." }];
    expect(checkedSuggestion({ ...parsed, folder: "jobs", name: "Works" }, { ...state, own })).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "works", name: "Jobs" }, { ...state, own })).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "idea", name: "Notions" }, state)).toBeNull();
    expect(checkedSuggestion({ ...parsed, folder: "notions", name: "Memories" }, state)).toBeNull();
  });

  it("drops a page that this run did not create", () => {
    expect(checkedSuggestion(parsed, { ...state, created: [] })).toBeNull();
    expect(checkedSuggestion({ ...parsed, page: "people/ann.md" }, state)).toBeNull();
  });

  it("drops a page path that is not a shelf page", () => {
    for (const page of ["goals/", "goals", "log.md", "inbox/x.md", "raw/x.md", "meetings/x.md", "ideas/x.txt", "ideas/sub/x.md", "projects/x.md"]) {
      expect(checkedSuggestion({ ...parsed, page }, { ...state, created: [page] }), page).toBeNull();
    }
  });

  it("takes a page of an own shelf", () => {
    const own = [{ folder: "work", name: "Work", definition: "Jobs." }];
    expect(checkedSuggestion({ ...parsed, page: "work/a.md" }, { ...state, own, created: ["work/a.md"] })?.pages).toEqual(["work/a.md"]);
  });

  it("joins a pending shelf that has no definition yet, taking this suggestion's", () => {
    const pending = [{ folder: "projects", name: "Projects", definition: "" }];
    expect(checkedSuggestion({ ...parsed, folder: "project" }, { ...state, pending })).toEqual({
      folder: "projects",
      name: "Projects",
      definition: "Work with a goal.",
      pages: ["ideas/a.md"],
      agentMade: false,
    });
  });

  it("joins a pending suggestion that is the same shelf, with this page", () => {
    const pending = [{ folder: "projects", name: "Projects", definition: "Mine." }];
    expect(checkedSuggestion({ ...parsed, folder: "project", name: "Project" }, { ...state, pending })).toEqual({
      folder: "projects",
      name: "Projects",
      definition: "Mine.",
      pages: ["ideas/a.md"],
      agentMade: false,
    });
    // by name alone, and when the pending folder is already on disk (the agent made it)
    expect(checkedSuggestion({ ...parsed, folder: "plans" }, { ...state, pending, onDisk: [...state.onDisk, "projects"] })?.folder).toBe("projects");
    // a page that is not this run's is still dropped
    expect(checkedSuggestion({ ...parsed, folder: "project" }, { ...state, pending, created: [] })).toBeNull();
  });
});

describe("agentMadeFolders", () => {
  const known = [...BUILT_IN_SHELVES, "work", "inbox", "raw", "reviews", "tasks"];

  it("maps each unknown top-level folder to its created pages", () => {
    expect(agentMadeFolders(["projects/a.md", "ideas/b.md", "meetings/c.md"], known)).toEqual(new Map([["projects", ["projects/a.md"]]]));
    expect(agentMadeFolders(["trips/a.md", "projects/b.md", "trips/c.md", "work/d.md", "raw/x.md"], known)).toEqual(
      new Map([
        ["trips", ["trips/a.md", "trips/c.md"]],
        ["projects", ["projects/b.md"]],
      ]),
    );
  });

  it("counts only pages inside a folder", () => {
    expect(agentMadeFolders(["index.md", "notes.md", "trips/map.png", "trips/sub/deep.md"], known)).toEqual(
      new Map([["trips", ["trips/sub/deep.md"]]]),
    );
  });
});
