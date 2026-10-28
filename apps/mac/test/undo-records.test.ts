import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeUndoRecord, UndoRecordStore } from "../src/main/undo-records.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-undo-records-"));
const none = { filing: null, evening: [] };

// Commits as git prints them: 40 hex digits (SHA-1), or 64 (SHA-256).
const A = "a".repeat(40);
const B1 = "b".repeat(40);
const B2 = "b".repeat(39) + "c";
const E = "e".repeat(40);
const LONG = "0123456789abcdef".repeat(4);

const onDisk = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));

describe("undo record store", () => {
  it("keeps each library's records apart, in a file of the app's own, under the library's resolved path", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A });
    store.patch("/libs/b/../b", { evening: [B1, B2] });
    expect(Object.keys(onDisk(file)).sort()).toEqual(["/libs/a", "/libs/b"]);
    const again = new UndoRecordStore(file);
    expect(again.get("/libs/a")).toEqual({ filing: A, evening: [] });
    expect(again.get("/libs/b")).toEqual({ filing: null, evening: [B1, B2] });
    expect(again.get("/libs/b/./")).toEqual({ filing: null, evening: [B1, B2] }); // however the library's path is spelled
    expect(again.get("/libs/c")).toEqual(none);
  });

  it("a patch changes only what it names", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A });
    store.patch("/libs/a", { evening: [B1, B2] });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [B1, B2] });
    store.patch("/libs/a", { filing: null });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: null, evening: [B1, B2] });
    store.patch("/libs/a", { filing: E });
    store.patch("/libs/a", { evening: [] });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: E, evening: [] });
    store.patch("/libs/a", { filing: undefined }); // naming nothing is naming nothing
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: E, evening: [] });
  });

  it("takes a library out of the file once it has nothing to undo, and leaves the others be", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A, evening: [B1] });
    store.patch("/libs/b", { filing: E });
    store.patch("/libs/a", { filing: null });
    expect(Object.keys(onDisk(file)).sort()).toEqual(["/libs/a", "/libs/b"]); // its review's commits are left
    store.patch("/libs/a", { evening: [] });
    expect(Object.keys(onDisk(file))).toEqual(["/libs/b"]);
    store.patch("/libs/b", { filing: null });
    expect(onDisk(file)).toEqual({});
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual(none);
  });

  it("writes nothing when a patch changes nothing", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: null }); // there is no record to take out
    store.patch("/libs/a", { evening: [] });
    expect(existsSync(file)).toBe(false);
    // A file in a shape the store never writes (one line), so that a write shows as a different text.
    const held = JSON.stringify({ "/libs/a": { filing: A, evening: [B1, B2] } });
    writeFileSync(file, held);
    store.patch("/libs/a", { filing: A }); // what the file held already
    store.patch("/libs/a", { evening: [B1, B2] });
    store.patch("/libs/a", { filing: A, evening: [B1, B2] });
    store.patch("/libs/a", {});
    store.patch("/libs/b", { filing: null }); // another library with nothing to take out
    expect(readFileSync(file, "utf8")).toBe(held);
    store.patch("/libs/a", { evening: [B1] }); // a change of the list is a change
    expect(onDisk(file)).toEqual({ "/libs/a": { filing: A, evening: [B1] } });
    expect(readFileSync(file, "utf8")).not.toBe(held);
  });

  it("starts empty when its file is missing or corrupt, and a patch then writes a good file", () => {
    const file = path.join(tmp(), "undo-records.json");
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual(none); // no file yet
    writeFileSync(file, "{not json");
    const store = new UndoRecordStore(file);
    expect(store.get("/libs/a")).toEqual(none);
    store.patch("/libs/a", { filing: A });
    expect(onDisk(file)).toEqual({ "/libs/a": { filing: A, evening: [] } });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [] });
    for (const wrong of ["[]", "null", '"HEAD"', "7"]) {
      writeFileSync(file, wrong); // valid JSON, and no record of anything
      expect(new UndoRecordStore(file).get("/libs/a")).toEqual(none);
    }
  });

  it("drops what isn't a commit", () => {
    const file = path.join(tmp(), "undo-records.json");
    writeFileSync(
      file,
      JSON.stringify({
        "/libs/a": { filing: "HEAD", evening: [E, 42] }, // neither is a commit
        "/libs/b": { filing: A, evening: [] },
        "/libs/c": { filing: LONG, evening: [] },
        "/libs/d": { filing: "a".repeat(39), evening: [] }, // an abbreviation names no commit for sure
        "/libs/e": { filing: "g".repeat(40), evening: [E, "main"] },
        "/libs/f": { filing: A, evening: "later", surprise: true }, // an unknown field goes
        "/libs/g": ["a list is no record"],
      }),
    );
    const store = new UndoRecordStore(file);
    expect(store.get("/libs/a")).toEqual(none);
    expect(store.get("/libs/b")).toEqual({ filing: A, evening: [] });
    expect(store.get("/libs/c")).toEqual({ filing: LONG, evening: [] });
    expect(store.get("/libs/d")).toEqual(none);
    expect(store.get("/libs/e")).toEqual(none);
    expect(store.get("/libs/f")).toEqual({ filing: A, evening: [] });
    expect(store.get("/libs/g")).toEqual(none);
  });

  it("never throws when it can't write: the Undo goes on without its record", () => {
    const blocker = path.join(tmp(), "in-the-way");
    writeFileSync(blocker, "a file where the records' folder should be");
    const store = new UndoRecordStore(path.join(blocker, "undo-records.json"));
    const problems = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => store.patch("/libs/a", { filing: A })).not.toThrow();
      expect(problems).toHaveBeenCalledTimes(1);
      expect(problems.mock.calls[0]?.[0]).toBe("undo records");
      expect(store.get("/libs/a")).toEqual(none); // nothing can ever have been written there
    } finally {
      problems.mockRestore();
    }
  });
});

describe("normalizeUndoRecord", () => {
  it("reads a good record as it is, and anything else as none", () => {
    expect(normalizeUndoRecord({ filing: A, evening: [B1, B2] })).toEqual({ filing: A, evening: [B1, B2] });
    expect(normalizeUndoRecord({ filing: A.toUpperCase(), evening: [E.toUpperCase()] })).toEqual({ filing: A.toUpperCase(), evening: [E.toUpperCase()] });
    for (const raw of [undefined, null, 7, "HEAD", [], [A], {}, { filing: 7 }, { evening: null }, { evening: [E, ""] }]) {
      expect(normalizeUndoRecord(raw), JSON.stringify(raw)).toEqual(none);
    }
  });

  it("hands out a list of its own: what it was given can change without changing the record", () => {
    const given = [B1, B2];
    const record = normalizeUndoRecord({ filing: null, evening: given });
    given.push(E);
    expect(record.evening).toEqual([B1, B2]);
  });
});
