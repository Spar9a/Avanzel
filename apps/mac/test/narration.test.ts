import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { FilingStep } from "@avanzel/engine";
import { MAX_ROWS, rowPage, withStep } from "../src/main/narration.ts";
import type { FiledPage, NarrationRow } from "../src/shared/ipc.ts";

// The titles pageInfo would find for the pages these tests name; any other page has its file name for a title. Its shelf
// is the first segment of its path, as pageInfo has it, even for a file at the library's root.
const TITLES: Record<string, string> = {
  "people/mark.md": "Mark",
  "ideas/x.md": "An idea",
  "ideas/old-plan.md": "A plan, as its page titled it",
};
const page = (rel: string): FiledPage => ({ title: TITLES[rel] ?? posix.basename(rel, ".md"), shelf: rel.split("/")[0] ?? "", path: rel });

const search: FilingStep = { kind: "search" };
const read = (path: string): FilingStep => ({ kind: "read", path });
const wrote = (path: string, created = false): FilingStep => ({ kind: "wrote", path, created });
const deleted = (path: string): FilingStep => ({ kind: "deleted", path });

/** The rows after each step in turn, from none. */
const rowsAfter = (...steps: FilingStep[]) => steps.reduce<NarrationRow[]>((rows, step) => withStep(rows, step, page), []);
const kinds = (rows: readonly NarrationRow[]) => rows.map((row) => row.kind);

describe("withStep", () => {
  it("a page read and then updated is two rows", () => {
    const rows = rowsAfter(read("people/mark.md"), wrote("people/mark.md"));
    expect(kinds(rows)).toEqual(["read", "updated"]);
    expect(rows.map((row) => row.title)).toEqual(["Mark", "Mark"]);
  });

  it("a read row has the page's path, title and shelf", () => {
    expect(rowsAfter(read("people/mark.md"))).toEqual([{ kind: "read", path: "people/mark.md", title: "Mark", shelf: "people" }]);
  });

  it("a page already in the rows, in any way, is not read again", () => {
    expect(kinds(rowsAfter(read("people/mark.md"), read("people/mark.md")))).toEqual(["read"]);
    expect(kinds(rowsAfter(wrote("ideas/x.md", true), read("ideas/x.md")))).toEqual(["new"]);
    expect(kinds(rowsAfter(wrote("people/mark.md"), read("people/mark.md")))).toEqual(["updated"]);
    expect(kinds(rowsAfter(deleted("ideas/old-plan.md"), read("ideas/old-plan.md")))).toEqual(["removed"]);
  });

  it("a new page stays one row however often it's written", () => {
    const rows = rowsAfter(wrote("ideas/x.md", true), wrote("ideas/x.md", true), wrote("ideas/x.md", true));
    expect(rows).toEqual([{ kind: "new", path: "ideas/x.md", title: "An idea", shelf: "ideas" }]);
  });

  it("a page that is new or already updated is not updated again", () => {
    expect(kinds(rowsAfter(wrote("ideas/x.md", true), wrote("ideas/x.md")))).toEqual(["new"]);
    expect(kinds(rowsAfter(wrote("people/mark.md"), wrote("people/mark.md")))).toEqual(["updated"]);
    // Reading it first doesn't count: it was only read, so its update is a row of its own.
    expect(kinds(rowsAfter(read("people/mark.md"), wrote("people/mark.md"), wrote("people/mark.md")))).toEqual(["read", "updated"]);
  });

  it("a run of searches is one row, and a search after a read is another", () => {
    expect(kinds(rowsAfter(search, search, read("people/mark.md"), search))).toEqual(["search", "read", "search"]);
  });

  it("a search has no path, title or shelf", () => {
    expect(rowsAfter(search)).toEqual([{ kind: "search", path: null, title: "", shelf: "" }]);
  });

  it("keeps the newest fifty", () => {
    const rows = rowsAfter(...Array.from({ length: 60 }, (_, n) => read(`ideas/page-${n + 1}.md`)));
    expect(rows).toHaveLength(MAX_ROWS);
    expect(MAX_ROWS).toBe(50);
    expect(rows[0]?.path).toBe("ideas/page-11.md");
    expect(rows.at(-1)?.path).toBe("ideas/page-60.md");
  });

  it("a step that adds no row leaves the full rows as they were", () => {
    const full = rowsAfter(...Array.from({ length: MAX_ROWS }, (_, n) => read(`ideas/page-${n + 1}.md`)));
    expect(withStep(full, read("ideas/page-50.md"), page)).toEqual(full);
  });

  it("a removed page is named by its file name", () => {
    expect(rowsAfter(deleted("ideas/old-plan.md"))).toEqual([{ kind: "removed", path: "ideas/old-plan.md", title: "old-plan", shelf: "ideas" }]);
  });

  it("a page removed again is not another row", () => {
    expect(kinds(rowsAfter(deleted("ideas/old-plan.md"), deleted("ideas/old-plan.md")))).toEqual(["removed"]);
  });

  it("root files have no shelf", () => {
    expect(rowsAfter(wrote("index.md"))).toEqual([{ kind: "updated", path: "index.md", title: "index", shelf: "" }]);
    expect(rowsAfter(deleted("log.md"))[0]?.shelf).toBe("");
    // A page in a folder inside a shelf is still on that shelf.
    expect(rowsAfter(read("topics/deep/er/page.md"))[0]?.shelf).toBe("topics");
  });

  it("leaves the rows it is given as they were", () => {
    const before = rowsAfter(read("people/mark.md"));
    const copy = structuredClone(before);
    const after = withStep(before, wrote("ideas/x.md", true), page);
    expect(before).toEqual(copy);
    expect(after).not.toBe(before);
    expect(kinds(after)).toEqual(["read", "new"]);
  });
});

describe("rowPage", () => {
  // The lookup a library gives for a page it opens; asked to open anything but Markdown, it throws.
  const opensOnlyMarkdown = (_root: string, rel: string): FiledPage => {
    if (!rel.endsWith(".md")) throw new Error(`${rel} was opened`);
    return page(rel);
  };
  const rowsFor = (...steps: FilingStep[]) =>
    steps.reduce<NarrationRow[]>((rows, step) => withStep(rows, step, (rel) => rowPage("/library", rel, opensOnlyMarkdown)), []);

  it("a file that isn't Markdown is named by its file name, unread", () => {
    expect(rowsFor(read("topics/budget.pdf"))).toEqual([{ kind: "read", path: "topics/budget.pdf", title: "budget.pdf", shelf: "topics" }]);
    // Written, it is named the same way, and at the library's root it has no shelf.
    expect(rowsFor(wrote("topics/data.json", true), wrote("notes.txt"))).toEqual([
      { kind: "new", path: "topics/data.json", title: "data.json", shelf: "topics" },
      { kind: "updated", path: "notes.txt", title: "notes.txt", shelf: "" },
    ]);
  });

  it("a Markdown page is opened for its title", () => {
    expect(rowsFor(read("people/mark.md"))).toEqual([{ kind: "read", path: "people/mark.md", title: "Mark", shelf: "people" }]);
  });

  it("is pageInfo by default: a page is titled from its file, and a file that isn't one is not titled from what is in it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "avz-narration-"));
    mkdirSync(path.join(root, "topics"));
    writeFileSync(path.join(root, "topics", "plan.md"), "# The plan\n");
    writeFileSync(path.join(root, "topics", "budget.pdf"), "# A line that looks like a title\n");
    expect(rowPage(root, "topics/plan.md").title).toBe("The plan");
    expect(rowPage(root, "topics/budget.pdf").title).toBe("budget.pdf");
  });
});
