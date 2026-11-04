import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendDictation, Vault } from "@avanzel/engine";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import { DayFileNotUpdated } from "../src/main/dictation-rows.ts";
import { forgetKept, forgetLogged, logDictation, logEntryOf } from "../src/main/library-log.ts";

const label = (root: string) => `label of ${root}`;

const library = async () => Vault.init(mkdtempSync(path.join(tmpdir(), "avz-log-")), { git: false });

const AT = "2026-11-05T14:03:12+04:00";
const entry = (over: Partial<DictationEntry> = {}): DictationEntry => ({
  id: "3f2b6c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b",
  at: AT,
  text: "Ship it on Friday",
  heard: "ship it on friday",
  app: "Slack",
  bundleId: "com.tinyspeck.slackmacgap",
  title: "#launch",
  site: null,
  seconds: 2,
  inserted: true,
  ...over,
});

const dayFile = (vault: Vault, day = "2026-11-05") => path.join(vault.root, "raw", "dictations", `${day}.md`);

const locked: string[] = [];
afterEach(() => {
  for (const folder of locked.splice(0)) chmodSync(folder, 0o755);
  vi.restoreAllMocks();
});

describe("logEntryOf", () => {
  it("is the history's entry as the engine's day file takes it: the time as a Date, the app's name, the window and site, the words and what was heard", () => {
    expect(logEntryOf(entry())).toEqual({
      id: "3f2b6c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b",
      at: new Date(AT),
      app: "Slack",
      title: "#launch",
      site: null,
      text: "Ship it on Friday",
      heard: "ship it on friday",
    });
    expect(logEntryOf(entry({ heard: undefined, site: "example.com", title: null }))).toEqual({
      id: "3f2b6c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b",
      at: new Date(AT),
      app: "Slack",
      title: null,
      site: "example.com",
      text: "Ship it on Friday",
    });
  });
});

describe("logDictation", () => {
  it("appends the entry to the day file, with its app and window", async () => {
    const vault = await library();
    await logDictation(vault, entry());
    const text = readFileSync(dayFile(vault), "utf8");
    // A title's leading # is written escaped, so it can't read as a heading of its own.
    expect(text).toMatch(/^## \d\d:\d\d · Slack — \\#launch$/m);
    expect(text).toContain("<!-- dictation 3f2b6c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b -->\nShip it on Friday\n");
  });

  it("never rejects: a day file that can't be written is logged, without the words, and the dictation goes on", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const vault = await library();
    writeFileSync(path.join(vault.root, "raw", "dictations"), "a file where the folder should be");
    await expect(logDictation(vault, entry())).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    expect(JSON.stringify(quiet.mock.calls)).not.toContain("Ship it on Friday");
  });
});

describe("forgetLogged", () => {
  it("removes the entry from its day file", async () => {
    const vault = await library();
    await logDictation(vault, entry());
    await logDictation(vault, entry({ id: "other-id", text: "Keep this one" }));
    await forgetLogged(vault, entry());
    const text = readFileSync(dayFile(vault), "utf8");
    expect(text).not.toContain("Ship it on Friday");
    expect(text).toContain("Keep this one");
  });

  it("is no failure when the entry was never in the library: the log was off, or it was a day with no file", async () => {
    const vault = await library();
    await expect(forgetLogged(vault, entry())).resolves.toBeUndefined();
    await appendDictation(vault, logEntryOf(entry({ id: "someone-else" })));
    await expect(forgetLogged(vault, entry())).resolves.toBeUndefined();
  });

  it("fails when the day file can't be rewritten, so the person is told", async () => {
    const vault = await library();
    await logDictation(vault, entry());
    const folder = path.dirname(dayFile(vault));
    chmodSync(folder, 0o555);
    locked.push(folder);
    await expect(forgetLogged(vault, entry())).rejects.toThrow();
  });

  it("fails when the words may be there but couldn't be taken out: a day file that names the id, or one that is no plain file", async () => {
    const vault = await library();
    mkdirSync(path.dirname(dayFile(vault)), { recursive: true });
    // A block whose closing marker was edited away by hand: the engine leaves it alone.
    writeFileSync(dayFile(vault), `# Dictations 2026-11-05\n\n<!-- dictation ${entry().id} -->\nShip it on Friday\n`);
    await expect(forgetLogged(vault, entry())).rejects.toThrow();
    rmSync(dayFile(vault));
    mkdirSync(dayFile(vault));
    await expect(forgetLogged(vault, entry())).rejects.toThrow();
  });

  it("forgets from the library the entry was kept in, though another library is open, or none", async () => {
    const first = await library();
    const second = await library();
    const kept = entry({ library: first.root });
    await logDictation(first, kept);
    await logDictation(second, entry({ id: "in-the-second" }));
    const secondBefore = readFileSync(dayFile(second), "utf8");
    await forgetKept(second, kept, label);
    expect(readFileSync(dayFile(first), "utf8")).not.toContain("Ship it on Friday");
    expect(readFileSync(dayFile(second), "utf8")).toBe(secondBefore);

    const third = entry({ id: "third", library: first.root });
    await logDictation(first, third);
    await forgetKept(null, third, label);
    expect(readFileSync(dayFile(first), "utf8")).not.toContain("third");
  });

  it("names the library it was kept in when that library can't be reached, or its day file can't be rewritten", async () => {
    const first = await library();
    const open = await library();
    const kept = entry({ library: first.root });
    await logDictation(first, kept);
    const folder = path.dirname(dayFile(first));
    chmodSync(folder, 0o555);
    locked.push(folder);
    const unwritable = await forgetKept(open, kept, label).catch((error: unknown) => error);
    expect(unwritable).toBeInstanceOf(DayFileNotUpdated);
    expect((unwritable as DayFileNotUpdated).library).toBe(`label of ${first.root}`);
    chmodSync(folder, 0o755);
    locked.pop();

    rmSync(first.root, { recursive: true, force: true });
    const gone = await forgetKept(open, kept, label).catch((error: unknown) => error);
    expect(gone).toBeInstanceOf(DayFileNotUpdated);
    expect((gone as DayFileNotUpdated).library).toBe(`label of ${first.root}`);
  });

  it("forgets an entry from before the field (no library) in the open library, as before, and does nothing with none open", async () => {
    const open = await library();
    await logDictation(open, entry());
    await forgetKept(open, entry(), label);
    expect(readFileSync(dayFile(open), "utf8")).not.toContain("Ship it on Friday");
    await expect(forgetKept(null, entry(), label)).resolves.toBeUndefined();
    // The open library's own failure names no other library.
    await logDictation(open, entry({ id: "again", library: open.root }));
    chmodSync(path.dirname(dayFile(open)), 0o555);
    locked.push(path.dirname(dayFile(open)));
    const failed = await forgetKept(open, entry({ id: "again", library: open.root }), label).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(DayFileNotUpdated);
  });

  it("looks a day either side, as the engine does, for an entry whose clock and file disagree", async () => {
    const vault = await library();
    mkdirSync(path.dirname(dayFile(vault)), { recursive: true });
    writeFileSync(dayFile(vault, "2026-11-06"), `# Dictations 2026-11-06\n\n<!-- dictation ${entry().id} -->\nno end\n`);
    await expect(forgetLogged(vault, entry())).rejects.toThrow();
  });
});
