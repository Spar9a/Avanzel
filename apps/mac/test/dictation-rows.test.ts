import { describe, expect, it, vi } from "vitest";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import { deleteDictationResult, forgetDictation, pageOf, PREVIEW_CHARACTERS, previewOf, rowOf } from "../src/main/dictation-rows.ts";
import { DELETE_FAILED_BODY, DICTATION_PAGE } from "../src/shared/ipc.ts";

const entry = (over: Partial<DictationEntry> = {}): DictationEntry => ({
  id: "a",
  at: "2026-11-05T10:00:00.000+01:00",
  text: "Call Kowalczyk back about the invoice.",
  heard: "call kowalczyk back about the invoice",
  app: "Slack",
  bundleId: "com.tinyspeck.slackmacgap",
  title: "#general",
  site: null,
  seconds: 4,
  inserted: true,
  ...over,
});

describe("previewOf", () => {
  it("keeps a text that fits whole, at exactly the limit too", () => {
    expect(previewOf("short")).toBe("short");
    const exact = "a".repeat(PREVIEW_CHARACTERS);
    expect(previewOf(exact)).toBe(exact);
  });

  it("cuts a longer text to its first 400 characters and ends it with an ellipsis", () => {
    const cut = previewOf("a".repeat(PREVIEW_CHARACTERS + 1));
    expect(cut).toBe(`${"a".repeat(PREVIEW_CHARACTERS)}…`);
  });

  it("does not leave a space before the ellipsis, and does not split a character made of two code units", () => {
    expect(previewOf(`${"a".repeat(PREVIEW_CHARACTERS - 1)} b`)).toBe(`${"a".repeat(PREVIEW_CHARACTERS - 1)}…`);
    const emoji = "𝒜".repeat(PREVIEW_CHARACTERS + 5);
    expect(previewOf(emoji)).toBe(`${"𝒜".repeat(PREVIEW_CHARACTERS)}…`);
  });
});

describe("rowOf", () => {
  it("hands the pane what it shows and nothing it doesn't", () => {
    expect(rowOf(entry())).toEqual({
      id: "a",
      at: "2026-11-05T10:00:00.000+01:00",
      preview: "Call Kowalczyk back about the invoice.",
      app: "Slack",
      title: "#general",
      site: null,
      inserted: true,
    });
  });

  it("previews a long text, so the whole of it stays in main for Copy", () => {
    const long = "word ".repeat(200).trim();
    const row = rowOf(entry({ text: long }));
    expect(row.preview.endsWith("…")).toBe(true);
    expect(row.preview.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + 1);
    expect(JSON.stringify(row)).not.toContain("heard");
  });
});

describe("pageOf", () => {
  const many = (count: number): DictationEntry[] => Array.from({ length: count }, (_, i) => entry({ id: `e${i}`, text: `words ${i}` }));

  it("lists the first page of a long history, and reports how many there are in all", () => {
    const page = pageOf(many(250));
    expect(DICTATION_PAGE).toBe(100);
    expect(page.rows).toHaveLength(100);
    expect(page.total).toBe(250);
    // The newest first: the entries come in the history's order, and the page keeps its head.
    expect(page.rows[0]!.id).toBe("e0");
    expect(page.rows[99]!.id).toBe("e99");
  });

  it("gives as many as were asked for, 100 more at a time", () => {
    expect(pageOf(many(250), 200).rows).toHaveLength(200);
    expect(pageOf(many(250), 200).total).toBe(250);
    expect(pageOf(many(250), 7).rows.map((row) => row.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
  });

  it("gives them all when the limit is above the total, with the total as it is", () => {
    const page = pageOf(many(5), 1000);
    expect(page.rows).toHaveLength(5);
    expect(page.total).toBe(5);
    expect(pageOf(many(105), 200)).toMatchObject({ total: 105, rows: expect.arrayContaining([expect.objectContaining({ id: "e104" })]) });
  });

  it("takes a limit that is 0, negative, fractional, not a number or missing for the first page", () => {
    for (const limit of [undefined, 0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const page = pageOf(many(150), limit);
      expect(page.rows, String(limit)).toHaveLength(100);
      expect(page.total, String(limit)).toBe(150);
    }
  });

  it("is empty, with a total of 0, for an empty history", () => {
    expect(pageOf([], 100)).toEqual({ rows: [], total: 0 });
    expect(pageOf([])).toEqual({ rows: [], total: 0 });
  });

  it("makes rows only of the page, with each text cut to its preview", () => {
    const page = pageOf([entry({ text: "x".repeat(1000) }), ...many(3)], 1);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.preview.length).toBe(PREVIEW_CHARACTERS + 1);
  });
});

describe("forgetDictation", () => {
  it("removes the entry, then tells the hook about it", () => {
    const removed = entry();
    const history = { remove: vi.fn(() => removed) };
    const onForget = vi.fn();
    expect(forgetDictation(history, "a", onForget)).toBe(removed);
    expect(history.remove).toHaveBeenCalledWith("a");
    expect(onForget).toHaveBeenCalledWith(removed);
  });

  it("does not call the hook when there was no such entry", () => {
    const onForget = vi.fn();
    expect(forgetDictation({ remove: () => null }, "gone", onForget)).toBeNull();
    expect(onForget).not.toHaveBeenCalled();
  });

  it("does not call the hook when the history could not be rewritten, and lets the error out", () => {
    const onForget = vi.fn();
    const history = {
      remove: () => {
        throw new Error("EACCES");
      },
    };
    expect(() => forgetDictation(history, "a", onForget)).toThrow("EACCES");
    expect(onForget).not.toHaveBeenCalled();
  });

  it("keeps the entry gone when the hook fails: the person's delete worked", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const removed = entry();
    const onForget = vi.fn(() => {
      throw new Error("day file locked");
    });
    expect(forgetDictation({ remove: () => removed }, "a", onForget)).toBe(removed);
    quiet.mockRestore();
  });

  it("works with no hook", () => {
    const removed = entry();
    expect(forgetDictation({ remove: () => removed }, "a", undefined)).toBe(removed);
  });
});

describe("deleteDictationResult", () => {
  it("is ok when the dictation went, and when it was already gone", () => {
    expect(deleteDictationResult(() => entry())).toEqual({ ok: true });
    expect(deleteDictationResult(() => null)).toEqual({ ok: true });
  });

  it("says what is safe and offers one fix when the history could not be rewritten, without the system's own words", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = deleteDictationResult(() => {
      throw new Error("EACCES: permission denied, open '/Users/x/dictations.jsonl.tmp'");
    });
    expect(result).toEqual({ ok: false, message: DELETE_FAILED_BODY });
    expect(DELETE_FAILED_BODY).toBe("It is still in the history. Try deleting it again.");
    expect(JSON.stringify(result)).not.toContain("EACCES");
    quiet.mockRestore();
  });
});
