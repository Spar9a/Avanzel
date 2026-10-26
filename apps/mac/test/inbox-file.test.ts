import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freePath, moveInto, writeInto } from "../src/main/inbox-file.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-inbox-file-"));
/** What a folder holds, by name. */
const names = (folder: string) => readdirSync(folder).sort();
const put = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

describe("freePath", () => {
  it("is the name in the folder when nothing has it, whether or not the folder exists", () => {
    const folder = path.join(tmp(), "inbox");
    expect(freePath(folder, "memo.wav")).toBe(path.join(folder, "memo.wav"));
    mkdirSync(folder);
    expect(freePath(folder, "memo.wav")).toBe(path.join(folder, "memo.wav"));
  });

  it("counts up before the extension while the names are taken", () => {
    const folder = tmp();
    put(path.join(folder, "memo.wav"), "one");
    expect(freePath(folder, "memo.wav")).toBe(path.join(folder, "memo-2.wav"));
    put(path.join(folder, "memo-2.wav"), "two");
    expect(freePath(folder, "memo.wav")).toBe(path.join(folder, "memo-3.wav"));
  });

  it("keeps the other dots of a name, and a name that has no extension", () => {
    const folder = tmp();
    put(path.join(folder, "voice.2026.wav"), "one");
    put(path.join(folder, "notes"), "two");
    expect(freePath(folder, "voice.2026.wav")).toBe(path.join(folder, "voice.2026-2.wav"));
    expect(freePath(folder, "notes")).toBe(path.join(folder, "notes-2"));
  });

  it("takes a folder, and a link with nothing at its end, for names that are taken", () => {
    const folder = tmp();
    mkdirSync(path.join(folder, "memo.wav"));
    symlinkSync(path.join(tmp(), "gone.wav"), path.join(folder, "memo-2.wav"));
    expect(freePath(folder, "memo.wav")).toBe(path.join(folder, "memo-3.wav"));
  });
});

describe("moveInto", () => {
  it("renames the file into the folder under its own name: the same file, not a copy", () => {
    const from = put(path.join(tmp(), "raw", "audio", "2026-10-26-143012.wav"), "sound");
    const was = statSync(from);
    const inbox = path.join(tmp(), "inbox");
    const moved = moveInto(inbox, from);
    expect(moved).toBe(path.join(inbox, "2026-10-26-143012.wav"));
    expect(existsSync(from)).toBe(false);
    const now = statSync(moved);
    expect([now.dev, now.ino]).toEqual([was.dev, was.ino]); // a copy would be a file of its own
    expect(now.nlink).toBe(1);
    expect(readFileSync(moved, "utf8")).toBe("sound");
  });

  it("makes the folder when it is missing", () => {
    const from = put(path.join(tmp(), "memo.wav"), "sound");
    const inbox = path.join(tmp(), "library", "inbox");
    expect(readFileSync(moveInto(inbox, from), "utf8")).toBe("sound");
    expect(names(inbox)).toEqual(["memo.wav"]);
  });

  it("never moves over a file: the next free name is taken, and the file that has the name is left as it is", () => {
    const inbox = tmp();
    put(path.join(inbox, "memo.wav"), "someone else's");
    put(path.join(inbox, "memo-2.wav"), "someone else's, too");
    const moved = moveInto(inbox, put(path.join(tmp(), "memo.wav"), "sound"));
    expect(moved).toBe(path.join(inbox, "memo-3.wav"));
    expect(readFileSync(moved, "utf8")).toBe("sound");
    expect(readFileSync(path.join(inbox, "memo.wav"), "utf8")).toBe("someone else's");
    expect(readFileSync(path.join(inbox, "memo-2.wav"), "utf8")).toBe("someone else's, too");
  });

  it("never moves over a link with nothing at its end: the link stays, and nothing is made where it leads", () => {
    const inbox = tmp();
    const target = path.join(tmp(), "gone.wav");
    symlinkSync(target, path.join(inbox, "memo.wav"));
    const moved = moveInto(inbox, put(path.join(tmp(), "memo.wav"), "sound"));
    expect(moved).toBe(path.join(inbox, "memo-2.wav"));
    expect(lstatSync(path.join(inbox, "memo.wav")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(inbox, "memo.wav"))).toBe(target);
    expect(existsSync(target)).toBe(false);
  });

  it("never moves over a link to a file either: the link stays, and so does the file it leads to", () => {
    const inbox = tmp();
    const theirs = put(path.join(tmp(), "theirs.wav"), "someone else's");
    symlinkSync(theirs, path.join(inbox, "memo.wav"));
    const moved = moveInto(inbox, put(path.join(tmp(), "memo.wav"), "sound"));
    expect(moved).toBe(path.join(inbox, "memo-2.wav"));
    expect(readlinkSync(path.join(inbox, "memo.wav"))).toBe(theirs);
    expect(readFileSync(theirs, "utf8")).toBe("someone else's");
  });

  it("throws, and leaves the file where it was, when the folder can't take it", () => {
    const inbox = tmp();
    const from = put(path.join(tmp(), "memo.wav"), "sound");
    chmodSync(inbox, 0o555);
    try {
      expect(() => moveInto(inbox, from)).toThrow(/EACCES/);
    } finally {
      chmodSync(inbox, 0o755);
    }
    expect(readFileSync(from, "utf8")).toBe("sound");
    expect(names(inbox)).toEqual([]);
  });
});

describe("writeInto", () => {
  it("hands the write the path it has chosen, in a folder it makes, and returns that path", () => {
    const inbox = path.join(tmp(), "library", "inbox");
    let given = "";
    const written = writeInto(inbox, "2026-10-26-143012.wav", (file) => {
      given = file;
      writeFileSync(file, "sound");
    });
    expect(written).toBe(path.join(inbox, "2026-10-26-143012.wav"));
    expect(given).toBe(written);
    expect(readFileSync(written, "utf8")).toBe("sound");
  });

  it("never writes over a file: the next free name is taken, and the file that has the name is left as it is", () => {
    const inbox = tmp();
    put(path.join(inbox, "memo.wav"), "someone else's");
    const written = writeInto(inbox, "memo.wav", (file) => writeFileSync(file, "sound"));
    expect(written).toBe(path.join(inbox, "memo-2.wav"));
    expect(readFileSync(path.join(inbox, "memo.wav"), "utf8")).toBe("someone else's");
    expect(readFileSync(written, "utf8")).toBe("sound");
  });

  it("never writes through a link: with nothing at its end, or to a file, the link stays and what it leads to is left as it is", () => {
    const inbox = tmp();
    const gone = path.join(tmp(), "gone.wav");
    const theirs = put(path.join(tmp(), "theirs.wav"), "someone else's");
    symlinkSync(gone, path.join(inbox, "memo.wav"));
    symlinkSync(theirs, path.join(inbox, "memo-2.wav"));
    const written = writeInto(inbox, "memo.wav", (file) => writeFileSync(file, "sound"));
    expect(written).toBe(path.join(inbox, "memo-3.wav"));
    expect(readFileSync(written, "utf8")).toBe("sound");
    expect(existsSync(gone)).toBe(false);
    expect(readFileSync(theirs, "utf8")).toBe("someone else's");
    expect(lstatSync(path.join(inbox, "memo.wav")).isSymbolicLink()).toBe(true);
    expect(lstatSync(path.join(inbox, "memo-2.wav")).isSymbolicLink()).toBe(true);
  });

  it("removes the partial file a failed write leaves, and throws what the write threw", () => {
    const inbox = tmp();
    put(path.join(inbox, "other.wav"), "someone else's");
    expect(() =>
      writeInto(inbox, "memo.wav", (file) => {
        writeFileSync(file, "RIFF, and then the disk is");
        throw new Error("no space left on device");
      }),
    ).toThrow("no space left on device");
    expect(names(inbox)).toEqual(["other.wav"]);
    expect(readFileSync(path.join(inbox, "other.wav"), "utf8")).toBe("someone else's");
  });

  it("tells what the write threw, even when the partial file it left can't be removed", () => {
    const inbox = tmp();
    try {
      expect(() =>
        writeInto(inbox, "memo.wav", (file) => {
          writeFileSync(file, "RIFF, and then the disk is");
          chmodSync(inbox, 0o555); // nothing can be removed from the folder now
          throw new Error("no space left on device");
        }),
      ).toThrow("no space left on device");
    } finally {
      chmodSync(inbox, 0o755);
    }
    expect(names(inbox)).toEqual(["memo.wav"]);
  });

  it("leaves the folder as it was when the write fails before it makes the file", () => {
    const inbox = tmp();
    expect(() =>
      writeInto(inbox, "memo.wav", () => {
        throw new Error("permission denied");
      }),
    ).toThrow("permission denied");
    expect(names(inbox)).toEqual([]);
  });
});
