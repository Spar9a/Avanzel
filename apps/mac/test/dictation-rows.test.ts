import { describe, expect, it, vi } from "vitest";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import { deleteDictationResult, forgetDictation, pageOf, PREVIEW_CHARACTERS, previewOf, rowOf } from "../src/main/dictation-rows.ts";
import { DAY_FILE_NOT_UPDATED, DELETE_FAILED_BODY, DICTATION_PAGE } from "../src/shared/ipc.ts";

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
  it("removes the entry, then has the hook drop it elsewhere, and waits for it", async () => {
    const removed = entry();
    const history = { remove: vi.fn(() => removed) };
    let done = false;
    const onForget = vi.fn(async () => {
      await Promise.resolve();
      done = true;
    });
    expect(await forgetDictation(history, "a", onForget)).toEqual({ entry: removed, elsewhere: true });
    expect(history.remove).toHaveBeenCalledWith("a");
    expect(onForget).toHaveBeenCalledWith(removed);
    expect(done).toBe(true);
  });

  it("does not call the hook when there was no such entry", async () => {
    const onForget = vi.fn();
    expect(await forgetDictation({ remove: () => null }, "gone", onForget)).toEqual({ entry: null, elsewhere: true });
    expect(onForget).not.toHaveBeenCalled();
  });

  it("does not call the hook when the history could not be rewritten, and lets the error out", async () => {
    const onForget = vi.fn();
    const history = {
      remove: () => {
        throw new Error("EACCES");
      },
    };
    await expect(forgetDictation(history, "a", onForget)).rejects.toThrow("EACCES");
    expect(onForget).not.toHaveBeenCalled();
  });

  it("keeps the entry gone when the hook fails, at once or later, and says the words may still be elsewhere", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const removed = entry();
    const throwing = vi.fn(() => {
      throw new Error("day file locked");
    });
    expect(await forgetDictation({ remove: () => removed }, "a", throwing)).toEqual({ entry: removed, elsewhere: false });
    const rejecting = vi.fn(async () => {
      throw new Error("day file locked");
    });
    expect(await forgetDictation({ remove: () => removed }, "a", rejecting)).toEqual({ entry: removed, elsewhere: false });
    // Logged without the words, or the system's message, which can name a path.
    expect(JSON.stringify(quiet.mock.calls)).not.toContain(removed.text);
    expect(JSON.stringify(quiet.mock.calls)).not.toContain("day file locked");
    quiet.mockRestore();
  });

  it("works with no hook", async () => {
    const removed = entry();
    expect(await forgetDictation({ remove: () => removed }, "a", undefined)).toEqual({ entry: removed, elsewhere: true });
  });
});

describe("deleteDictationResult", () => {
  it("is ok when the dictation went, and when it was already gone", async () => {
    expect(await deleteDictationResult(async () => ({ entry: entry(), elsewhere: true }))).toEqual({ ok: true });
    expect(await deleteDictationResult(async () => ({ entry: null, elsewhere: true }))).toEqual({ ok: true });
  });

  it("says what is safe and offers one fix when the history could not be rewritten, without the system's own words", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await deleteDictationResult(async () => {
      throw new Error("EACCES: permission denied, open '/Users/x/dictations.jsonl.tmp'");
    });
    expect(result).toEqual({ ok: false, message: DELETE_FAILED_BODY });
    expect(DELETE_FAILED_BODY).toBe("It is still in the history. Try deleting it again.");
    expect(JSON.stringify(result)).not.toContain("EACCES");
    quiet.mockRestore();
  });

  it("tells the person when the words left the history but the library's day file couldn't be updated", async () => {
    const result = await deleteDictationResult(async () => ({ entry: entry(), elsewhere: false }));
    expect(result).toEqual({ ok: false, title: DAY_FILE_NOT_UPDATED.title, message: DAY_FILE_NOT_UPDATED.body });
    expect(DAY_FILE_NOT_UPDATED).toEqual({
      title: "That dictation may still be in the library.",
      body:
        "The words are deleted from the history, but the day file in the library couldn't be updated. They may still be in " +
        "raw/dictations. Open that day's file in the library and remove them.",
    });
  });
});
