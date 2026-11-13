import { describe, expect, it } from "vitest";
import { BUILT_IN_SHELVES } from "../../src/core/shelves.ts";
import { REMEMBER_RULES, serverInstructions, WRITING_RULES } from "../../src/mcp/instructions.ts";

const STATE = { shelves: [...BUILT_IN_SHELVES, "work-notes"], pages: 42, waiting: 3, eveningReviewOn: true };

describe("serverInstructions", () => {
  it("names the shelves, the page count, the waiting notes and the review", () => {
    const text = serverInstructions(STATE);
    for (const shelf of STATE.shelves) expect(text).toContain(shelf);
    expect(text).toContain("42 pages");
    expect(text).toContain("3 notes from agents");
    expect(text).toContain("evening review is on");
    expect(serverInstructions({ ...STATE, eveningReviewOn: false })).toContain("evening review is off");
  });

  it("carries the writing rules", () => {
    const text = serverInstructions(STATE);
    expect(text).toContain(WRITING_RULES);
    expect(WRITING_RULES).toMatch(/search/i);
    expect(WRITING_RULES).toMatch(/one line/);
    expect(WRITING_RULES).toMatch(/ask before every/i);
    expect(WRITING_RULES).toMatch(/secrets/);
    expect(WRITING_RULES).toMatch(/supersedes/);
  });

  it("stays within about 150 words", () => {
    expect(serverInstructions(STATE).length).toBeLessThanOrEqual(1_100);
  });

  it("stays within its size when the owner has many shelves", () => {
    const shelves = [...BUILT_IN_SHELVES, ...Array.from({ length: 20 }, (_, i) => `a-rather-long-shelf-folder-name-${i}`)];
    const text = serverInstructions({ ...STATE, shelves });
    expect(text.length).toBeLessThanOrEqual(1_100);
    expect(text).toContain("library_overview");
  });

  it("counts the shelves when even the first name is too long to list", () => {
    const text = serverInstructions({ ...STATE, shelves: ["x".repeat(300), "goals"] });
    expect(text).toContain("Shelves: 2 (library_overview lists them).");
    expect(text.length).toBeLessThanOrEqual(1_100);
  });

  it("speaks of one page and one note in the singular", () => {
    const text = serverInstructions({ ...STATE, pages: 1, waiting: 1 });
    expect(text).toContain("1 page");
    expect(text).not.toContain("1 pages");
    expect(text).toContain("1 note from agents");
  });

  it("has a short form of the rules for the remember tool", () => {
    expect(REMEMBER_RULES.length).toBeLessThan(WRITING_RULES.length);
    expect(REMEMBER_RULES).toMatch(/search/i);
  });
});
