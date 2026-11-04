// The day files of dictations (`raw/dictations/YYYY-MM-DD.md`) are the owner's words kept for the evening review's reading, not
// captures and not pages: nothing else in the engine that walks the library may take one for either. Each test builds the same
// library twice, with and without a day file, and compares what the engine sees.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appendDictation } from "../../src/core/dictation-log.ts";
import * as git from "../../src/core/git.ts";
import { Librarian } from "../../src/core/librarian.ts";
import { search } from "../../src/core/search.ts";
import { Vault } from "../../src/core/vault.ts";
import { NOW, envHome, gitIdentity } from "./helpers.ts";
import { fakeSettings, only, read, recordRuns, tmp } from "./librarian-fixtures.ts";

// Words no capture says, so a search or a prompt that found the day file would show them.
const SAID = "zanzibarian marmalade protocol";
const DAY_FILE = "raw/dictations/2026-10-20.md";

async function libraryAt(name: string, { git: withGit = false, dayFile }: { git?: boolean; dayFile: boolean }): Promise<Vault> {
  const vault = await Vault.init(join(tmp(), name), { git: withGit });
  if (dayFile) {
    await appendDictation(vault, { id: "d1", at: NOW, app: "Slack", title: "#general", site: null, text: SAID });
    await appendDictation(vault, { id: "d2", at: new Date(NOW.getTime() + 60_000), app: "Terminal", title: "zsh", site: null, text: `${SAID} again` });
  }
  return vault;
}

describe("a library with a day file of dictations", () => {
  let plain: Vault;
  let logged: Vault;

  beforeEach(async () => {
    plain = await libraryAt("plain", { dayFile: false });
    logged = await libraryAt("logged", { dayFile: true });
    for (const vault of [plain, logged]) new Librarian(vault, fakeSettings(), { clock: () => NOW }).captureText("Build a tiny greenhouse");
  });

  it("has the same captures waiting and the same shelves as one without", () => {
    const names = (vault: Vault) => vault.pending().map((path) => vault.relativePath(path));
    expect(names(logged)).toEqual(names(plain));
    expect(names(logged)).toHaveLength(1);
    expect(logged.shelfCounts()).toEqual(plain.shelfCounts());
  });

  it("is not searched as pages are", () => {
    expect(search(logged.root, SAID)).toEqual([]);
    expect(search(logged.root, "zanzibarian")).toEqual([]);
  });

  it("files only the inbox's capture in the evening review, tells no agent of the day file, and leaves the day file as it was", async () => {
    const before = read(join(logged.root, DAY_FILE));
    const runs = recordRuns();
    const review = await new Librarian(logged, fakeSettings(), { clock: () => NOW }).eveningReview();
    const plainReview = await new Librarian(plain, fakeSettings(), { clock: () => NOW }).eveningReview();
    expect(review.outcomes.map((outcome) => outcome.captureId)).toEqual(plainReview.outcomes.map((outcome) => outcome.captureId));
    expect(review.outcomes).toHaveLength(1);
    expect(review.outcomes[0]?.ok).toBe(true);
    // Each library's runs get the same prompt, but for the library's own path.
    const prompts = runs().map((run) => run.prompt);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("zanzibarian");
      expect(prompt).not.toContain("raw/dictations");
    }
    const half = prompts.length / 2;
    expect(prompts.slice(0, half).map((prompt) => prompt.replaceAll(logged.root, "<library>"))).toEqual(
      prompts.slice(half).map((prompt) => prompt.replaceAll(plain.root, "<library>")),
    );
    expect(read(join(logged.root, DAY_FILE))).toBe(before);
    expect(logged.pending()).toEqual([]);
  });
});

describe.skipIf(!git.available())("a day file in a library with git", () => {
  beforeEach(() => {
    envHome(tmp());
    gitIdentity();
  });

  it("is never committed, and survives the undo of a filing as it was", async () => {
    const vault = await libraryAt("versioned", { git: true, dayFile: true });
    const librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
    const before = read(join(vault.root, DAY_FILE));
    librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: vault.root, encoding: "utf8" });
    expect(gitOut("log", "--all", "--name-only", "--format=").split("\n").filter((name) => name.startsWith("raw/dictations"))).toEqual([]);
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(existsSync(join(vault.root, DAY_FILE))).toBe(true);
    expect(read(join(vault.root, DAY_FILE))).toBe(before);
    expect(vault.pending()).toHaveLength(1);
  });
});
