// realFoldersTo when another process makes a folder on the way at the same moment (two recordings
// starting a new month). The race is staged without timing: mkdirSync is wrapped, and its next call
// first lets "the other process" put something at the path, so the real mkdir meets EEXIST.
import { mkdirSync, readdirSync, symlinkSync, type MakeDirectoryOptions, type Mode, type PathLike } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { realFoldersTo } from "../../src/core/inside.ts";
import { useTmp } from "./helpers.ts";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, mkdirSync: vi.fn(fs.mkdirSync) };
});

const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
const tmp = useTmp();
let root: string;

beforeEach(() => {
  root = join(tmp(), "lib");
  actual.mkdirSync(join(root, "raw"), { recursive: true });
});

/** The next mkdirSync finds its path taken: `makeFirst` (the other process) got there just before. */
function raceNextMkdir(makeFirst: (path: string) => void): void {
  vi.mocked(mkdirSync).mockImplementationOnce((path: PathLike, options?: Mode | MakeDirectoryOptions | null) => {
    makeFirst(String(path));
    return actual.mkdirSync(path, options);
  });
}

describe("realFoldersTo", () => {
  it("takes a folder another process made between its check and its mkdir", () => {
    raceNextMkdir((path) => actual.mkdirSync(path));
    expect(realFoldersTo(root, "raw/audio/2026/10/x.wav", true)).toBe(true);
    expect(readdirSync(join(root, "raw/audio/2026"))).toEqual(["10"]);
  });

  it("still refuses a link another process put there between its check and its mkdir", () => {
    const outside = join(tmp(), "outside");
    actual.mkdirSync(outside);
    raceNextMkdir((path) => symlinkSync(outside, path));
    expect(realFoldersTo(root, "raw/audio/2026/10/x.wav", true)).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });
});
