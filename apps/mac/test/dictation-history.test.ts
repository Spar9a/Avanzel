import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationHistory, type DictationEntry } from "../src/main/dictation-history.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "avanzel-dictations-"));
  file = path.join(dir, "dictations.jsonl");
});

afterEach(() => {
  vi.restoreAllMocks();
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const entry = (id: string, over: Partial<DictationEntry> = {}): DictationEntry => ({
  id,
  at: "2026-11-05T10:00:00.000+01:00",
  text: `words of ${id}`,
  app: "Notes",
  bundleId: "com.apple.Notes",
  title: "A note",
  site: null,
  seconds: 3.5,
  inserted: true,
  ...over,
});

describe("DictationHistory", () => {
  it("lists what was added, newest first by the time it was said", () => {
    const history = new DictationHistory(file);
    history.add(entry("a", { at: "2026-11-05T10:00:00.000+01:00" }));
    history.add(entry("c", { at: "2026-11-05T12:00:00.000+01:00" }));
    history.add(entry("b", { at: "2026-11-05T11:00:00.000+01:00" }));
    expect(history.list().map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("puts the later-added first when two share a time", () => {
    const history = new DictationHistory(file);
    history.add(entry("first"));
    history.add(entry("second"));
    history.add(entry("third"));
    expect(history.list().map((e) => e.id)).toEqual(["third", "second", "first"]);
  });

  it("orders by the moment, not by the text of the offset", () => {
    const history = new DictationHistory(file);
    history.add(entry("later", { at: "2026-11-05T10:30:00.000+00:00" }));
    history.add(entry("earlier", { at: "2026-11-05T11:00:00.000+02:00" }));
    expect(history.list().map((e) => e.id)).toEqual(["later", "earlier"]);
  });

  it("returns whole entries", () => {
    const history = new DictationHistory(file);
    const e = entry("a", { title: null, site: "example.com", inserted: false });
    history.add(e);
    expect(history.list()).toEqual([e]);
  });

  it("keeps what was heard when an entry has it", () => {
    const history = new DictationHistory(file);
    history.add(entry("a", { heard: "um so the raw words" }));
    history.add(entry("b"));
    const [b, a] = new DictationHistory(file).list();
    expect(a?.heard).toBe("um so the raw words");
    expect("heard" in (b as DictationEntry)).toBe(false);
  });

  it("keeps the library an entry was logged in, and reads an entry from before that field as it was", () => {
    const history = new DictationHistory(file);
    history.add(entry("a", { library: "/Users/someone/Avanzel" }));
    history.add(entry("b"));
    const [b, a] = new DictationHistory(file).list();
    expect(a?.library).toBe("/Users/someone/Avanzel");
    expect("library" in (b as DictationEntry)).toBe(false);
  });

  it("says whether an add reached the file", () => {
    expect(new DictationHistory(file).add(entry("a"))).toBe(true);
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "a file, not a folder");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(new DictationHistory(path.join(blocker, "dictations.jsonl")).add(entry("b"))).toBe(false);
    quiet.mockRestore();
  });

  it("makes the folder when it is missing, and the file private", () => {
    const nested = path.join(dir, "deep", "er", "dictations.jsonl");
    new DictationHistory(nested).add(entry("a"));
    expect(existsSync(nested)).toBe(true);
    expect(statSync(nested).mode & 0o777).toBe(0o600);
  });

  it("lists nothing when there is no file or the file is empty", () => {
    expect(new DictationHistory(file).list()).toEqual([]);
    expect(new DictationHistory(file).last()).toBeNull();
    writeFileSync(file, "");
    expect(new DictationHistory(file).list()).toEqual([]);
  });

  it("is seen whole by a fresh store on the same file", () => {
    new DictationHistory(file).add(entry("a"));
    new DictationHistory(file).add(entry("b"));
    expect(new DictationHistory(file).list().map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("keeps unicode and newlines in the text on one line each", () => {
    const history = new DictationHistory(file);
    const text = "first line\nsecond line\r\nПривіт, світе 🎙   end";
    history.add(entry("a", { text }));
    history.add(entry("b"));
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(history.list().find((e) => e.id === "a")?.text).toBe(text);
  });

  describe("last", () => {
    it("is the newest entry", () => {
      const history = new DictationHistory(file);
      history.add(entry("a", { at: "2026-11-05T10:00:00.000+01:00" }));
      history.add(entry("b", { at: "2026-11-05T10:05:00.000+01:00" }));
      expect(history.last()?.id).toBe("b");
    });

    it("is the later-added of two that share a time", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      history.add(entry("b"));
      expect(history.last()?.id).toBe("b");
    });
  });

  describe("a damaged file", () => {
    it("skips lines that are not JSON and entries missing a field or with a wrong type", () => {
      const good = entry("good");
      const { seconds: _seconds, ...noSeconds } = entry("no-seconds");
      writeFileSync(
        file,
        [
          "this is garbage",
          JSON.stringify(good),
          '{"id":"half","at":"2026',
          JSON.stringify(noSeconds),
          JSON.stringify({ ...entry("bad-inserted"), inserted: "yes" }),
          JSON.stringify({ ...entry("bad-title"), title: 5 }),
          JSON.stringify({ ...entry("bad-heard"), heard: 5 }),
          JSON.stringify({ ...entry("bad-library"), library: 5 }),
          JSON.stringify({ ...entry("bad-nan"), seconds: null }),
          "[1,2]",
          "null",
          "",
        ].join("\n"),
      );
      expect(new DictationHistory(file).list()).toEqual([good]);
    });

    it("starts a new entry on a fresh line after a partial one without a newline", () => {
      writeFileSync(file, `${JSON.stringify(entry("old"))}\n{"id":"cut","at":"2026-11-05`);
      const history = new DictationHistory(file);
      history.add(entry("new"));
      expect(history.list().map((e) => e.id)).toEqual(["new", "old"]);
      history.add(entry("newer"));
      expect(history.list().map((e) => e.id)).toEqual(["newer", "new", "old"]);
    });

    it("does not add a blank line when the file ends with one", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      history.add(entry("b"));
      expect(readFileSync(file, "utf8").split("\n")).toHaveLength(3);
    });
  });

  describe("remove", () => {
    it("returns the entry, and it is gone for a fresh store", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      history.add(entry("b"));
      expect(history.remove("a")).toEqual(entry("a"));
      expect(new DictationHistory(file).list().map((e) => e.id)).toEqual(["b"]);
    });

    it("returns null for an id it does not have, and leaves the file alone", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      const before = readFileSync(file, "utf8");
      expect(history.remove("nope")).toBeNull();
      expect(readFileSync(file, "utf8")).toBe(before);
    });

    it("returns null when there is no file", () => {
      expect(new DictationHistory(file).remove("a")).toBeNull();
      expect(existsSync(file)).toBe(false);
    });

    it("removes every copy of a repeated id and returns the first", () => {
      const history = new DictationHistory(file);
      history.add(entry("dup", { text: "one", at: "2026-11-05T10:00:00.000+01:00" }));
      history.add(entry("other"));
      history.add(entry("dup", { text: "two", at: "2026-11-05T11:00:00.000+01:00" }));
      expect(history.remove("dup")?.text).toBe("one");
      expect(history.list().map((e) => e.id)).toEqual(["other"]);
    });

    it("keeps the file private and leaves no temp file", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      history.add(entry("b"));
      history.remove("a");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual(["dictations.jsonl"]);
      expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(entry("b"))}\n`);
    });

    it("keeps the lines that are not entries, each on its own line", () => {
      writeFileSync(file, `garbage\n${JSON.stringify(entry("a"))}\n${JSON.stringify(entry("b"))}\n{"cut":`);
      expect(new DictationHistory(file).remove("a")?.id).toBe("a");
      expect(readFileSync(file, "utf8")).toBe(`garbage\n${JSON.stringify(entry("b"))}\n{"cut":\n`);
    });

    it("removes the last remaining entry to an empty list", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      history.remove("a");
      expect(history.list()).toEqual([]);
      expect(history.last()).toBeNull();
    });

    it("throws when the rewrite fails, so a forgotten dictation is never claimed forgotten, and leaves the entry", () => {
      const history = new DictationHistory(file);
      history.add(entry("a"));
      chmodSync(dir, 0o500);
      try {
        expect(() => history.remove("a")).toThrow();
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(history.list().map((e) => e.id)).toEqual(["a"]);
      expect(readdirSync(dir)).toEqual(["dictations.jsonl"]);
    });
  });

  describe("onChange", () => {
    it("is called after an entry is added and after one is removed, not when nothing changed", () => {
      const changed = vi.fn();
      const history = new DictationHistory(file, changed);
      history.add(entry("a"));
      expect(changed).toHaveBeenCalledTimes(1);
      history.remove("nobody");
      expect(changed).toHaveBeenCalledTimes(1);
      history.remove("a");
      expect(changed).toHaveBeenCalledTimes(2);
    });

    it("is not called for an add the disk refused, nor for a remove that threw, and its own failure costs nothing", () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const blocker = path.join(dir, "blocker");
      writeFileSync(blocker, "a file, not a folder");
      const refused = vi.fn();
      new DictationHistory(path.join(blocker, "dictations.jsonl"), refused).add(entry("a"));
      expect(refused).not.toHaveBeenCalled();
      const failing = new DictationHistory(file, () => {
        throw new Error("the pane is gone");
      });
      expect(() => failing.add(entry("b"))).not.toThrow();
      expect(failing.list().map((e) => e.id)).toEqual(["b"]);
      expect(() => failing.remove("b")).not.toThrow();
      quiet.mockRestore();
    });
  });

  describe("when the disk will not take it", () => {
    it("add logs and does not throw, and list is empty", () => {
      const locked = path.join(dir, "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o500);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const history = new DictationHistory(path.join(locked, "dictations.jsonl"));
        expect(() => history.add(entry("a"))).not.toThrow();
        expect(error).toHaveBeenCalledWith("dictation history", expect.anything());
        expect(history.list()).toEqual([]);
        expect(history.last()).toBeNull();
      } finally {
        chmodSync(locked, 0o700);
      }
    });

    it("add logs and does not throw when the folder cannot be made", () => {
      const blocker = path.join(dir, "blocker");
      writeFileSync(blocker, "a file, not a folder");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const history = new DictationHistory(path.join(blocker, "dictations.jsonl"));
      expect(() => history.add(entry("a"))).not.toThrow();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("list does not throw when the path is a folder", () => {
      mkdirSync(file);
      expect(new DictationHistory(file).list()).toEqual([]);
    });
  });
});
