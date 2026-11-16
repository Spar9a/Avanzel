import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diff, snapshot, visibleFiles } from "../../src/core/changes.ts";
import {
  LEARNED_NOTES,
  addLearnedNotes,
  captureKept,
  keepsOldLines,
  keptPaths,
  readLearnedNotes,
  restoreKept,
} from "../../src/core/old-notes.ts";
import { Vault } from "../../src/core/vault.ts";
import { useTmp, write } from "./helpers.ts";

describe("keepsOldLines", () => {
  it("keeps old lines when text is added at the end, the top or in between", () => {
    expect(keepsOldLines("a\nb\n", "a\nnew\nb\nmore\n")).toBe(true);
    expect(keepsOldLines("a\nb\n", "top\na\nb\n")).toBe(true);
    expect(keepsOldLines("a\nb\n", "a\nb\nc")).toBe(true);
    expect(keepsOldLines("a\r\nb\r\n", "a\nb\nc\n")).toBe(true);
    expect(keepsOldLines("", "anything\n")).toBe(true);
  });
  it("sees a changed or deleted old line", () => {
    expect(keepsOldLines("a\nb\n", "a\nB\n")).toBe(false);
    expect(keepsOldLines("a\nb\n", "a\n")).toBe(false);
    expect(keepsOldLines("a\nb\n", "b\na\n")).toBe(false);
  });
});

describe("the list of learned notes", () => {
  const tmp = useTmp();

  it("is empty when the file is missing or unreadable", () => {
    expect(readLearnedNotes(tmp()).size).toBe(0);
    write(tmp(), LEARNED_NOTES, "{ not json");
    expect(readLearnedNotes(tmp()).size).toBe(0);
    write(tmp(), LEARNED_NOTES, JSON.stringify({ version: 2, notes: ["a.md"] }));
    expect(readLearnedNotes(tmp()).size).toBe(0);
  });

  it("adds notes to what is there, in NFC, sorted, and writes it whole", () => {
    addLearnedNotes(tmp(), ["B/b.md", "Café/a.md".normalize("NFD")]);
    addLearnedNotes(tmp(), ["A/a.md", "B/b.md"]);
    expect([...readLearnedNotes(tmp())].sort()).toEqual(["A/a.md", "B/b.md", "Café/a.md".normalize("NFC")]);
    expect(JSON.parse(readFileSync(join(tmp(), LEARNED_NOTES), "utf8"))).toEqual({
      version: 1,
      notes: ["A/a.md", "B/b.md", "Café/a.md".normalize("NFC")],
    });
  });
});

describe("keeping the owner's old notes", () => {
  const tmp = useTmp();
  const run = (root: string, kept: ReturnType<typeof captureKept>, act: () => void) => {
    const before = snapshot(root);
    act();
    return restoreKept(root, kept, diff(before, snapshot(root)));
  };
  const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

  it("puts back an old note that was rewritten or deleted, and leaves one that was only added to", () => {
    const root = tmp();
    write(root, "Shelf/rewritten.md", "one\ntwo\n");
    write(root, "Shelf/deleted.md", "keep me\n");
    write(root, "Shelf/added.md", "x\ny\n");
    write(root, "Shelf/new-to-me.md", "not learned\n");
    const learned = new Set(["Shelf/rewritten.md", "Shelf/deleted.md", "Shelf/added.md"]);
    const kept = captureKept(root, learned, [], visibleFiles(root));
    const put = run(root, kept, () => {
      writeFileSync(join(root, "Shelf/rewritten.md"), "ONE\ntwo\n");
      rmSync(join(root, "Shelf/deleted.md"));
      writeFileSync(join(root, "Shelf/added.md"), "x\nnote\ny\nmore\n");
      writeFileSync(join(root, "Shelf/new-to-me.md"), "changed freely\n");
    });
    expect(put).toEqual({ old: ["Shelf/deleted.md", "Shelf/rewritten.md"], out: [] });
    expect(read(root, "Shelf/rewritten.md")).toBe("one\ntwo\n");
    expect(read(root, "Shelf/deleted.md")).toBe("keep me\n");
    expect(read(root, "Shelf/added.md")).toBe("x\nnote\ny\nmore\n");
    expect(read(root, "Shelf/new-to-me.md")).toBe("changed freely\n");
  });

  it("puts back everything in an excluded folder, removing what was made there", () => {
    const root = tmp();
    write(root, "Рецепты/борщ.md", "свекла\n");
    write(root, "Рецепты/суп/плов.md", "рис\n");
    write(root, "Other/x.md", "x\n");
    const kept = captureKept(root, new Set(), ["рецепты"], visibleFiles(root));
    const put = run(root, kept, () => {
      writeFileSync(join(root, "Рецепты/борщ.md"), "свекла\nи сметана\n"); // even an addition
      rmSync(join(root, "Рецепты/суп/плов.md"));
      write(root, "Рецепты/новый.md", "made by the run\n");
      write(root, "Other/y.md", "outside\n");
    });
    expect(put).toEqual({ old: [], out: ["Рецепты/борщ.md", "Рецепты/новый.md", "Рецепты/суп/плов.md"] });
    expect(read(root, "Рецепты/борщ.md")).toBe("свекла\n");
    expect(read(root, "Рецепты/суп/плов.md")).toBe("рис\n");
    expect(existsSync(join(root, "Рецепты/новый.md"))).toBe(false);
    expect(existsSync(join(root, "Other/y.md"))).toBe(true);
  });

  it("tells the learned notes it put back apart from what it put back or took away in an excluded folder", () => {
    const root = tmp();
    write(root, "Shelf/old.md", "one\n");
    write(root, "Рецепты/борщ.md", "свекла\n");
    const kept = captureKept(root, new Set(["Shelf/old.md"]), ["Рецепты"], visibleFiles(root));
    const put = run(root, kept, () => {
      writeFileSync(join(root, "Shelf/old.md"), "rewritten\n");
      writeFileSync(join(root, "Рецепты/борщ.md"), "changed\n");
      write(root, "Рецепты/новый.md", "made by the run\n");
    });
    expect(put).toEqual({ old: ["Shelf/old.md"], out: ["Рецепты/борщ.md", "Рецепты/новый.md"] });
    expect(keptPaths(put)).toEqual(["Shelf/old.md", "Рецепты/борщ.md", "Рецепты/новый.md"]);
  });

  it("matches an excluded folder kept in decomposed Unicode on disk", () => {
    const root = tmp();
    const onDisk = "Café".normalize("NFD");
    write(root, `${onDisk}/menu.md`, "tea\n");
    write(root, `${onDisk}/old.md`, "coffee\n");
    const kept = captureKept(root, new Set([`${"Café".normalize("NFC")}/old.md`]), ["Café".normalize("NFC")], visibleFiles(root));
    const put = run(root, kept, () => {
      writeFileSync(join(root, `${onDisk}/menu.md`), "changed\n");
      rmSync(join(root, `${onDisk}/old.md`));
    });
    // A learned note inside an excluded folder is told as what was put back there.
    expect(put.old).toEqual([]);
    expect(put.out).toHaveLength(2);
    expect(read(root, `${onDisk}/menu.md`)).toBe("tea\n");
    expect(read(root, `${onDisk}/old.md`)).toBe("coffee\n");
  });

  it("finds a learned note whose name is decomposed on disk and puts it back", () => {
    const root = tmp();
    const onDisk = "Café/ñ.md".normalize("NFD");
    write(root, onDisk, "one\n");
    const kept = captureKept(root, new Set(["Café/ñ.md".normalize("NFC")]), [], visibleFiles(root));
    const put = run(root, kept, () => writeFileSync(join(root, onDisk), "two\n"));
    expect(put).toEqual({ old: [onDisk], out: [] });
    expect(read(root, onDisk)).toBe("one\n");
  });

  it("puts back a learned note that was moved away and one replaced by a folder", () => {
    const root = tmp();
    write(root, "S/a.md", "a\n");
    write(root, "S/b.md", "b\n");
    const kept = captureKept(root, new Set(["S/a.md", "S/b.md"]), [], visibleFiles(root));
    run(root, kept, () => {
      renameSync(join(root, "S/a.md"), join(root, "S/a2.md"));
      rmSync(join(root, "S/b.md"));
      mkdirSync(join(root, "S/b.md"));
    });
    expect(read(root, "S/a.md")).toBe("a\n");
    expect(read(root, "S/b.md")).toBe("b\n");
  });

  it("reads only Markdown under an excluded folder, removing what was created there but not restoring other kinds", () => {
    const root = tmp();
    write(root, "Рецепты/борщ.md", "свекла\n");
    write(root, "Рецепты/photo.png", "png-bytes");
    const kept = captureKept(root, new Set(), ["Рецепты"], visibleFiles(root));
    expect([...kept.files.keys()]).toEqual(["Рецепты/борщ.md"]);
    const put = run(root, kept, () => {
      rmSync(join(root, "Рецепты/борщ.md"));
      writeFileSync(join(root, "Рецепты/photo.png"), "changed");
      write(root, "Рецепты/new.png", "made");
    });
    expect(put).toEqual({ old: [], out: ["Рецепты/new.png", "Рецепты/борщ.md"] });
    expect(read(root, "Рецепты/photo.png")).toBe("changed");
    expect(existsSync(join(root, "Рецепты/new.png"))).toBe(false);
  });

  it("puts back an excluded folder that was replaced by a file, and reports what it really did", () => {
    const root = tmp();
    write(root, "Рецепты/борщ.md", "свекла\n");
    write(root, "Рецепты/суп/плов.md", "рис\n");
    const kept = captureKept(root, new Set(), ["Рецепты"], visibleFiles(root));
    const put = run(root, kept, () => {
      rmSync(join(root, "Рецепты"), { recursive: true });
      writeFileSync(join(root, "Рецепты"), "a file now");
    });
    expect(put).toEqual({ old: [], out: ["Рецепты", "Рецепты/борщ.md", "Рецепты/суп/плов.md"] });
    expect(read(root, "Рецепты/борщ.md")).toBe("свекла\n");
    expect(read(root, "Рецепты/суп/плов.md")).toBe("рис\n");
  });

  it("puts back an excluded folder that was replaced by a link elsewhere", () => {
    const root = tmp();
    const elsewhere = join(tmp(), "elsewhere");
    mkdirSync(elsewhere);
    write(root, "Рецепты/борщ.md", "свекла\n");
    const kept = captureKept(root, new Set(), ["Рецепты"], visibleFiles(root));
    const put = run(root, kept, () => {
      rmSync(join(root, "Рецепты"), { recursive: true });
      symlinkSync(elsewhere, join(root, "Рецепты"));
    });
    expect(put).toEqual({ old: [], out: ["Рецепты/борщ.md"] });
    expect(read(root, "Рецепты/борщ.md")).toBe("свекла\n");
    expect(existsSync(join(elsewhere, "борщ.md"))).toBe(false); // nothing was written through the link
  });

  it("puts back a learned note whose shelf folder became a file", () => {
    const root = tmp();
    write(root, "S/a.md", "a\n");
    const kept = captureKept(root, new Set(["S/a.md"]), [], visibleFiles(root));
    const put = run(root, kept, () => {
      rmSync(join(root, "S"), { recursive: true });
      writeFileSync(join(root, "S"), "a file now");
    });
    expect(put).toEqual({ old: ["S/a.md"], out: [] });
    expect(read(root, "S/a.md")).toBe("a\n");
  });

  it("restores from what it read before, with no git in the library", async () => {
    const lib = await Vault.init(join(tmp(), "lib"), { git: false });
    write(lib.root, "Shelf/old.md", "first\nsecond\n");
    const kept = captureKept(lib.root, new Set(["Shelf/old.md"]), [], visibleFiles(lib.root));
    const put = run(lib.root, kept, () => writeFileSync(join(lib.root, "Shelf/old.md"), "second\n"));
    expect(put).toEqual({ old: ["Shelf/old.md"], out: [] });
    expect(read(lib.root, "Shelf/old.md")).toBe("first\nsecond\n");
  });
});
