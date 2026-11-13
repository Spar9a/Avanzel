import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeUndoRecord, UndoRecordStore, type FilingReceipt } from "../src/main/undo-records.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-undo-records-"));
const none = { filing: null, evening: [], receipt: null, shelf: null };

// Commits as git prints them: 40 hex digits (SHA-1), or 64 (SHA-256).
const A = "a".repeat(40);
const B1 = "b".repeat(40);
const B2 = "b".repeat(39) + "c";
const E = "e".repeat(40);
const LONG = "0123456789abcdef".repeat(4);

/** A whole receipt: a filing that wrote a new page and changed another, whose words the engine put back. */
const RECEIPT: FilingReceipt = {
  commit: A,
  text: "Plant tulips in October",
  agent: "Claude Code",
  seconds: 23.4,
  pages: [
    { title: "Tulips for October", shelf: "ideas", path: "ideas/tulips.md", created: true },
    { title: "Garden plan", shelf: "projects", path: "projects/garden.md" },
  ],
  noted: false,
  restored: true,
  filedAt: 1_792_000_000_000,
  suggestion: null,
};

/** A shelf the filing suggested, as the card asks about it. */
const ASK = { folder: "projects-x", name: "Projects X", definition: "Work with a goal and a deadline.", agentMade: false };

const onDisk = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));

describe("undo record store", () => {
  it("keeps each library's records apart, in a file of the app's own, under the library's resolved path", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A });
    store.patch("/libs/b/../b", { evening: [B1, B2] });
    expect(Object.keys(onDisk(file)).sort()).toEqual(["/libs/a", "/libs/b"]);
    const again = new UndoRecordStore(file);
    expect(again.get("/libs/a")).toEqual({ filing: A, evening: [], receipt: null, shelf: null });
    expect(again.get("/libs/b")).toEqual({ filing: null, evening: [B1, B2], receipt: null, shelf: null });
    expect(again.get("/libs/b/./")).toEqual({ filing: null, evening: [B1, B2], receipt: null, shelf: null }); // however the library's path is spelled
    expect(again.get("/libs/c")).toEqual(none);
  });

  it("a patch changes only what it names", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A });
    store.patch("/libs/a", { evening: [B1, B2] });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [B1, B2], receipt: null, shelf: null });
    store.patch("/libs/a", { filing: null });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: null, evening: [B1, B2], receipt: null, shelf: null });
    store.patch("/libs/a", { filing: E });
    store.patch("/libs/a", { evening: [] });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: E, evening: [], receipt: null, shelf: null });
    store.patch("/libs/a", { filing: undefined }); // naming nothing is naming nothing
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: E, evening: [], receipt: null, shelf: null });
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
    expect(onDisk(file)).toEqual({ "/libs/a": { filing: A, evening: [B1], receipt: null, shelf: null } });
    expect(readFileSync(file, "utf8")).not.toBe(held);
  });

  it("starts empty when its file is missing or corrupt, and a patch then writes a good file", () => {
    const file = path.join(tmp(), "undo-records.json");
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual(none); // no file yet
    writeFileSync(file, "{not json");
    const store = new UndoRecordStore(file);
    expect(store.get("/libs/a")).toEqual(none);
    store.patch("/libs/a", { filing: A });
    expect(onDisk(file)).toEqual({ "/libs/a": { filing: A, evening: [], receipt: null, shelf: null } });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [], receipt: null, shelf: null });
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
    expect(store.get("/libs/b")).toEqual({ filing: A, evening: [], receipt: null, shelf: null });
    expect(store.get("/libs/c")).toEqual({ filing: LONG, evening: [], receipt: null, shelf: null });
    expect(store.get("/libs/d")).toEqual(none);
    expect(store.get("/libs/e")).toEqual(none);
    expect(store.get("/libs/f")).toEqual({ filing: A, evening: [], receipt: null, shelf: null });
    expect(store.get("/libs/g")).toEqual(none);
  });

  it("keeps a library's receipt, and drops one that isn't whole", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    // A whole receipt round-trips equal, in the same file as the commits, under the library's path.
    store.patch("/libs/a", { filing: A, receipt: RECEIPT, shelf: null });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [], receipt: RECEIPT, shelf: null });
    expect(onDisk(file)).toEqual({ "/libs/a": { filing: A, evening: [], receipt: RECEIPT, shelf: null } });
    // A filing that left no commit (no git, or auto_commit off) has a receipt all the same; one that only noted its capture has no page.
    const noCommit: FilingReceipt = { ...RECEIPT, commit: null, noted: true, restored: false, pages: [] };
    store.patch("/libs/b", { receipt: noCommit, shelf: null });
    expect(new UndoRecordStore(file).get("/libs/b")).toEqual({ filing: null, evening: [], receipt: noCommit, shelf: null });
    // A receipt is kept only whole. Whatever else is wrong with it, the record's commits are kept as they are.
    const broken: [string, unknown][] = [
      ["seconds that are words", { ...RECEIPT, seconds: "23" }],
      ["seconds that are negative", { ...RECEIPT, seconds: -1 }],
      ["seconds that are not a number at all", { ...RECEIPT, seconds: null }],
      ["a page without a path", { ...RECEIPT, pages: [{ title: "Tulips", shelf: "ideas" }] }],
      ["a page that is a string", { ...RECEIPT, pages: ["ideas/tulips.md"] }],
      ["a page whose created is no boolean", { ...RECEIPT, pages: [{ title: "Tulips", shelf: "ideas", path: "ideas/tulips.md", created: "yes" }] }],
      ["pages that are no list", { ...RECEIPT, pages: "none" }],
      ["a day before 1970", { ...RECEIPT, filedAt: -1 }],
      ["a day that is a date's text", { ...RECEIPT, filedAt: "2026-10-28" }],
      ["a commit that is a name", { ...RECEIPT, commit: "HEAD" }],
      ["a commit that is an abbreviation", { ...RECEIPT, commit: "a".repeat(39) }],
      ["no commit field at all", { ...RECEIPT, commit: undefined }],
      ["words that are no string", { ...RECEIPT, text: 7 }],
      ["an agent that is no string", { ...RECEIPT, agent: null }],
      ["noted that is no boolean", { ...RECEIPT, noted: "no" }],
      ["no restored field", { ...RECEIPT, restored: undefined }],
      ["a list", [RECEIPT]],
      ["a string", "Filed"],
    ];
    for (const [what, receipt] of broken) {
      writeFileSync(file, JSON.stringify({ "/libs/a": { filing: A, evening: [B1], receipt, shelf: null } }));
      expect(new UndoRecordStore(file).get("/libs/a"), what).toEqual({ filing: A, evening: [B1], receipt: null, shelf: null });
    }
    // An unknown field of a whole receipt goes, as a record's does; the page's too.
    writeFileSync(file, JSON.stringify({ "/libs/a": { receipt: { ...RECEIPT, surprise: true, pages: [{ ...RECEIPT.pages[1], surprise: 1 }] } } }));
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: null, evening: [], receipt: { ...RECEIPT, pages: [RECEIPT.pages[1]] }, shelf: null });
  });

  it("keeps the own shelf's name a receipt's page carries, so a reprint draws its chip as the card did, and drops one that is no string", () => {
    const file = path.join(tmp(), "undo-records.json");
    const own = { title: "Acme", shelf: "projects", path: "projects/acme.md", created: true, shelfName: "Client projects" };
    writeFileSync(file, JSON.stringify({ "/libs/a": { receipt: { ...RECEIPT, pages: [own, { ...own, path: "projects/b.md", shelfName: 3 }] } } }));
    expect(new UndoRecordStore(file).get("/libs/a").receipt?.pages).toEqual([own, { title: "Acme", shelf: "projects", path: "projects/b.md", created: true }]);
  });

  it("changes a receipt without touching the commits, and keeps a library for its receipt alone", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    store.patch("/libs/a", { filing: A, evening: [B1, B2], receipt: RECEIPT, shelf: null });
    store.patch("/libs/a", { receipt: null, shelf: null });
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: A, evening: [B1, B2], receipt: null, shelf: null });
    store.patch("/libs/a", { receipt: RECEIPT, shelf: null });
    store.patch("/libs/a", { filing: null, evening: [] }); // no Undo left, and the receipt is: the library stays in the file (F2)
    expect(Object.keys(onDisk(file))).toEqual(["/libs/a"]);
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: null, evening: [], receipt: RECEIPT, shelf: null });
    store.patch("/libs/a", { receipt: null, shelf: null }); // and with the receipt gone it has nothing: the library goes
    expect(onDisk(file)).toEqual({});
    // A receipt of one library is no other's, and a patch that names the same receipt writes nothing.
    store.patch("/libs/a", { receipt: RECEIPT, shelf: null });
    const held = readFileSync(file, "utf8");
    store.patch("/libs/a", { receipt: { ...RECEIPT, pages: RECEIPT.pages.map((page) => ({ ...page })) } });
    store.patch("/libs/b", { receipt: null, shelf: null });
    expect(readFileSync(file, "utf8")).toBe(held);
    expect(new UndoRecordStore(file).get("/libs/b")).toEqual(none);
    store.patch("/libs/a", { receipt: { ...RECEIPT, seconds: 24 } }); // a change of the receipt is a change
    expect(readFileSync(file, "utf8")).not.toBe(held);
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
    expect(normalizeUndoRecord({ filing: A, evening: [B1, B2] })).toEqual({ filing: A, evening: [B1, B2], receipt: null, shelf: null });
    expect(normalizeUndoRecord({ filing: A.toUpperCase(), evening: [E.toUpperCase()] })).toEqual({ filing: A.toUpperCase(), evening: [E.toUpperCase()], receipt: null, shelf: null });
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

  it("hands out a receipt of its own too, and reads one that is not whole as none", () => {
    const given = { ...RECEIPT, pages: RECEIPT.pages.map((page) => ({ ...page })) };
    const record = normalizeUndoRecord({ filing: null, evening: [], receipt: given });
    given.pages.push({ title: "Later", shelf: "ideas", path: "ideas/later.md" });
    given.pages[0]!.title = "Changed";
    expect(record.receipt).toEqual(RECEIPT);
    expect(normalizeUndoRecord({ receipt: { ...RECEIPT, filedAt: -1 } }).receipt).toBeNull();
    expect(normalizeUndoRecord({ receipt: null, shelf: null }).receipt).toBeNull();
    expect(normalizeUndoRecord({ filing: A }).receipt).toBeNull(); // a record from before receipts had none
  });

  it("reads a receipt's shelf suggestion: none when it is missing, kept when whole, dropped (not the receipt) when broken", () => {
    const { suggestion: _, ...before } = RECEIPT;
    expect(normalizeUndoRecord({ receipt: before }).receipt).toEqual({ ...RECEIPT, suggestion: null }); // a receipt from before suggestions
    expect(normalizeUndoRecord({ receipt: { ...RECEIPT, suggestion: ASK } }).receipt).toEqual({ ...RECEIPT, suggestion: ASK });
    expect(normalizeUndoRecord({ receipt: { ...RECEIPT, suggestion: { ...ASK, surprise: 1 } } }).receipt).toEqual({ ...RECEIPT, suggestion: ASK });
    const agentMade = { ...ASK, definition: "", agentMade: true };
    expect(normalizeUndoRecord({ receipt: { ...RECEIPT, suggestion: agentMade } }).receipt).toEqual({ ...RECEIPT, suggestion: agentMade });
    const broken: [string, unknown][] = [
      ["no folder", { name: ASK.name, definition: ASK.definition, agentMade: false }],
      ["a folder that is no string", { ...ASK, folder: 3 }],
      ["no name", { ...ASK, name: undefined }],
      ["a definition that is no string", { ...ASK, definition: null }],
      ["agentMade that is no boolean", { ...ASK, agentMade: "no" }],
      ["a string", "projects"],
      ["a list", [ASK]],
    ];
    for (const [what, suggestion] of broken) {
      expect(normalizeUndoRecord({ filing: A, receipt: { ...RECEIPT, suggestion } }), what).toEqual({ filing: A, evening: [], receipt: { ...RECEIPT, suggestion: null }, shelf: null });
    }
  });

  it("reads the last Make shelf: none when it is missing or broken, its suggestion none when that isn't whole", () => {
    const pending = { folder: "projects", name: "Projects", definition: "Work with a goal.", agentMade: false, pages: [{ path: "ideas/launch.md", captureId: "c1" }] };
    const shelf = { commit: A, name: "Projects", pending };
    expect(normalizeUndoRecord({ filing: A }).shelf).toBeNull(); // a record from before shelves
    expect(normalizeUndoRecord({ filing: A, shelf }).shelf).toEqual(shelf);
    expect(normalizeUndoRecord({ filing: A, shelf: { ...shelf, pending: null } }).shelf).toEqual({ ...shelf, pending: null }); // made in Settings from a draft gone meanwhile
    expect(normalizeUndoRecord({ filing: A, shelf: { ...shelf, surprise: 1 } }).shelf).toEqual(shelf);
    expect(normalizeUndoRecord({ filing: A, shelf: { ...shelf, pending: "projects" } }).shelf).toEqual({ ...shelf, pending: null });
    for (const broken of [{ ...shelf, commit: "HEAD" }, { ...shelf, commit: undefined }, { ...shelf, name: 3 }, "projects", [shelf]]) {
      expect(normalizeUndoRecord({ filing: A, shelf: broken }), JSON.stringify(broken)).toEqual({ filing: A, evening: [], receipt: null, shelf: null });
    }
  });

  it("keeps a library for its made shelf alone, until a patch clears it", () => {
    const file = path.join(tmp(), "undo-records.json");
    const store = new UndoRecordStore(file);
    const shelf = { commit: A, name: "Projects", pending: null };
    store.patch("/libs/a", { filing: A, receipt: null, shelf });
    store.patch("/libs/a", { filing: null }); // its Undo was asked for: the marker stays for the take-back to read
    expect(new UndoRecordStore(file).get("/libs/a")).toEqual({ filing: null, evening: [], receipt: null, shelf });
    store.patch("/libs/a", { shelf: null });
    expect(onDisk(file)).toEqual({});
  });
});
