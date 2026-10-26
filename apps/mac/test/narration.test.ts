import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { posix } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilingStep } from "@avanzel/engine";
import { MAX_ROWS, rowPage, STEP_MS, stepThrottle, withStep, withWritten } from "../src/main/narration.ts";
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

/** The pages written after each step in turn, from none. */
const writtenAfter = (...steps: FilingStep[]) => steps.reduce<string[]>((written, step) => withWritten(written, step), []);

describe("withWritten", () => {
  it("lists the pages written, new or updated, in the order they were first written", () => {
    expect(writtenAfter(wrote("ideas/x.md", true), wrote("people/mark.md"), wrote("index.md"))).toEqual(["ideas/x.md", "people/mark.md", "index.md"]);
  });

  it("a page only read, or searched for, is not written", () => {
    expect(writtenAfter(read("people/mark.md"), search, wrote("ideas/x.md", true), read("ideas/y.md"))).toEqual(["ideas/x.md"]);
  });

  it("a page written twice counts once", () => {
    expect(writtenAfter(wrote("ideas/x.md", true), wrote("ideas/x.md"), wrote("ideas/x.md", true))).toEqual(["ideas/x.md"]);
    expect(writtenAfter(wrote("people/mark.md"), wrote("people/mark.md"))).toEqual(["people/mark.md"]);
  });

  it("a removed page stops counting", () => {
    expect(writtenAfter(wrote("ideas/x.md", true), wrote("people/mark.md"), deleted("ideas/x.md"))).toEqual(["people/mark.md"]);
    // Written again after it was removed, it counts again; a removal of a page that was never written changes nothing.
    expect(writtenAfter(wrote("ideas/x.md", true), deleted("ideas/x.md"), wrote("ideas/x.md", true))).toEqual(["ideas/x.md"]);
    expect(writtenAfter(wrote("ideas/x.md", true), deleted("ideas/other.md"))).toEqual(["ideas/x.md"]);
  });

  it("only Markdown paths count", () => {
    expect(writtenAfter(wrote("topics/data.json", true), wrote("topics/budget.pdf"), wrote("notes.txt"), wrote("ideas/x.md", true))).toEqual([
      "ideas/x.md",
    ]);
  });

  it("keeps more than fifty", () => {
    // The rows keep the newest fifty, so by the sixtieth write the first page's row has gone by; its page still counts.
    const steps = Array.from({ length: 60 }, (_, n) => wrote(`ideas/page-${n + 1}.md`, true));
    expect(rowsAfter(...steps)).toHaveLength(MAX_ROWS);
    const written = writtenAfter(...steps);
    expect(written).toHaveLength(60);
    expect(written[0]).toBe("ideas/page-1.md");
    expect(written.at(-1)).toBe("ideas/page-60.md");
  });

  it("leaves the list it is given as it was", () => {
    const before = ["ideas/x.md"];
    const after = withWritten(before, wrote("people/mark.md"));
    expect(before).toEqual(["ideas/x.md"]);
    expect(after).toEqual(["ideas/x.md", "people/mark.md"]);
    expect(withWritten(before, deleted("ideas/x.md"))).toEqual([]);
    expect(before).toEqual(["ideas/x.md"]);
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

// How often a filing's steps reach a window: setup's, and the capsule's. A burst of steps is a few updates rather than one each,
// and the newest is never more than STEP_MS behind.
describe("stepThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is 250 ms", () => {
    expect(STEP_MS).toBe(250);
  });

  it("sends the first step at once", () => {
    const send = vi.fn();
    stepThrottle(send)();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a burst of steps as two updates: the first at once, and the rest together STEP_MS after it", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    for (let n = 0; n < 100; n++) step();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STEP_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * STEP_MS);
    expect(send).toHaveBeenCalledTimes(2); // nothing waits any more
  });

  it("waits only for what is left of STEP_MS since the last send", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    step();
    vi.advanceTimersByTime(200);
    step(); // 200 ms after the send: it waits 50 ms more
    vi.advanceTimersByTime(49);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends a step at once when STEP_MS has passed since the last send", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    step();
    vi.advanceTimersByTime(STEP_MS);
    step();
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(STEP_MS * 4);
    step();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends no more than once every STEP_MS, and never leaves the newest step unsent for longer", () => {
    const sentAt: number[] = [];
    const step = stepThrottle(() => sentAt.push(performance.now()));
    const start = performance.now();
    for (let at = 0; at <= 2_000; at += 10) {
      step();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(STEP_MS);
    for (let n = 1; n < sentAt.length; n++) expect(sentAt[n]! - sentAt[n - 1]!).toBeGreaterThanOrEqual(STEP_MS);
    expect(sentAt.length).toBeLessThanOrEqual(2_000 / STEP_MS + 2);
    // The last step came 2 s in; the send that carries it came within STEP_MS of it.
    expect(sentAt.at(-1)! - start).toBeLessThanOrEqual(2_010 + STEP_MS);
    expect(sentAt.at(-1)! - start).toBeGreaterThanOrEqual(2_000);
  });

  it("cancel drops the send that waits; a step long after the last send is sent at once as usual", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    step();
    step(); // waits
    step.cancel();
    vi.advanceTimersByTime(10 * STEP_MS);
    expect(send).toHaveBeenCalledTimes(1);
    step();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancel keeps the time of the last send: a step right after it still waits", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    step();
    step.cancel(); // nothing waits
    vi.advanceTimersByTime(100);
    step();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STEP_MS - 100);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancel with nothing waiting does nothing", () => {
    const send = vi.fn();
    const step = stepThrottle(send);
    step.cancel();
    step();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a send that throws at the first step throws to the step, and the next step still waits its turn", () => {
    const send = vi.fn(() => {
      throw new Error("the window is gone");
    });
    const step = stepThrottle(send);
    expect(() => step()).toThrow("the window is gone");
    step(); // right after the send that threw: it waits
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a send that throws once a wait has ended is noted, not thrown where no one can catch it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const send = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => {
        throw new Error("the window is gone");
      });
      const step = stepThrottle(send);
      step();
      step(); // waits
      expect(() => vi.advanceTimersByTime(STEP_MS)).not.toThrow();
      expect(send).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith("narration", expect.objectContaining({ message: "the window is gone" }));
    } finally {
      warn.mockRestore();
    }
  });

  it("throttles each filing apart: one's wait isn't another's", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stepFirst = stepThrottle(first);
    const stepSecond = stepThrottle(second);
    stepFirst();
    stepFirst(); // waits
    stepSecond(); // its own first step: at once
    expect(second).toHaveBeenCalledTimes(1);
    stepFirst.cancel();
    vi.advanceTimersByTime(STEP_MS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
