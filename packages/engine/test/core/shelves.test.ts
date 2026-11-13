import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SHELVES,
  cleanDefinition,
  folderProblem,
  MAX_OWN_SHELVES,
  sameShelf,
  suggestFolder,
} from "../../src/core/shelves.ts";

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
