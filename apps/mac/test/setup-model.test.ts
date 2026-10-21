import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Vault } from "@avanzel/engine";
import { libraryFolder, tildePath } from "../src/main/setup-model.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-setup-"));

describe("setup model", () => {
  it("tildePath shortens only the home folder itself", () => {
    expect(tildePath("/Users/a/Avanzel", "/Users/a")).toBe("~/Avanzel");
    expect(tildePath("/Users/ab/x", "/Users/a")).toBe("/Users/ab/x");
    expect(tildePath("/Volumes/x", "/Users/a")).toBe("/Volumes/x");
    expect(tildePath("/Users/a", "/Users/a")).toBe("~");
  });

  it("libraryFolder tells missing, empty, has-files and library apart", async () => {
    const missing = path.join(tmp(), "Avanzel");
    const empty = tmp();
    const onlyDsStore = tmp();
    writeFileSync(path.join(onlyDsStore, ".DS_Store"), "");
    const notes = tmp();
    writeFileSync(path.join(notes, "notes.md"), "# Notes\n");
    const file = path.join(tmp(), "Avanzel");
    writeFileSync(file, "a file where the folder would go");
    const library = tmp();
    await Vault.init(library, { git: false });
    expect([missing, empty, onlyDsStore, notes, file, library].map((target) => libraryFolder(target))).toEqual([
      "missing", "empty", "empty", "has-files", "has-files", "library",
    ]);
  });
});
