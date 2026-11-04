import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DICTATION_SKIP_APPS } from "../../src/core/config.ts";
import { appendDictation, forgetDictation, type DictationLogEntry } from "../../src/core/dictation-log.ts";
import { Vault } from "../../src/core/vault.ts";
import * as engine from "../../src/index.ts";
import { AvanzelError } from "../../src/types.ts";
import { useTmp } from "./helpers.ts";

const tmp = useTmp();

// 2026-11-05 14:03 in the tests' fixed time zone (UTC+4), the day file's date being the local one.
const AT = new Date("2026-11-05T14:03:12+04:00");
const minutesLater = (minutes: number, from = AT) => new Date(from.getTime() + minutes * 60_000);

const vault = () => new Vault(tmp());
const dayFile = (day = "2026-11-05") => join(tmp(), "raw", "dictations", `${day}.md`);
const read = (day?: string) => readFileSync(dayFile(day), "utf8");

function entry(id: string, over: Partial<DictationLogEntry> = {}): DictationLogEntry {
  return { id, at: AT, app: "Notes", title: "Shopping", site: null, text: `words of ${id}`, ...over };
}

/** The ids whose block is whole in `text`: an opening and a closing marker, in that order. */
function blockIds(text: string): string[] {
  return [...text.matchAll(/^<!-- dictation ([A-Za-z0-9_-]+) -->\r?\n[\s\S]*?^<!-- \/dictation \1 -->\r?$/gm)].map((m) => m[1] as string);
}

describe("appendDictation", () => {
  it("creates the folder and the day file with a short header on the first write", async () => {
    await appendDictation(vault(), entry("a1"));
    const text = read();
    expect(text.startsWith("# Dictations 2026-11-05\n\n")).toBe(true);
    const intro = text.split("\n")[2] as string;
    expect(intro).not.toBe("");
    expect(intro).not.toMatch(/^[#<]/);
    expect(text.match(/^# /gm)).toHaveLength(1);
  });

  it("writes the entry as a heading, the markers around the text, and a blank line", async () => {
    await appendDictation(vault(), entry("a1"));
    expect(read()).toMatch(
      /^# Dictations 2026-11-05\n\n[^\n]+\n\n## 14:03 · Notes — Shopping\n<!-- dictation a1 -->\nwords of a1\n<!-- \/dictation a1 -->\n\n$/,
    );
  });

  it("appends the next entry to the same file, in the order they came, and writes the header once", async () => {
    await appendDictation(vault(), entry("a1"));
    await appendDictation(vault(), entry("a2", { at: minutesLater(5), app: "Mail", title: null, site: "example.com" }));
    const text = read();
    expect(text.match(/^# Dictations/gm)).toHaveLength(1);
    expect(blockIds(text)).toEqual(["a1", "a2"]);
    expect(text).toContain("## 14:08 · Mail — example.com\n");
    expect(text.indexOf("dictation a1")).toBeLessThan(text.indexOf("dictation a2"));
    expect(readdirSync(join(tmp(), "raw", "dictations"))).toEqual(["2026-11-05.md"]);
  });

  it("puts a dictation on the day of the person's clock, not UTC's", async () => {
    await appendDictation(vault(), entry("late", { at: new Date("2026-11-05T23:30:00+04:00") }));
    await appendDictation(vault(), entry("early", { at: new Date("2026-11-06T00:10:00+04:00") }));
    expect(blockIds(read("2026-11-05"))).toEqual(["late"]);
    expect(blockIds(read("2026-11-06"))).toEqual(["early"]);
    expect(read("2026-11-06")).toContain("## 00:10 · ");
  });

  it("omits the title and site part of the heading when there is neither", async () => {
    await appendDictation(vault(), entry("a1", { title: null, site: null }));
    expect(read()).toContain("## 14:03 · Notes\n<!-- dictation a1 -->");
  });

  it("writes a heard line only when what was heard differs from what was pasted", async () => {
    await appendDictation(vault(), entry("same", { text: "Kowalczyk", heard: "Kowalczyk" }));
    await appendDictation(vault(), entry("none", { text: "plain" }));
    await appendDictation(vault(), entry("diff", { text: "Kowalczyk wrote", heard: "kovalchik wrote" }));
    const text = read();
    expect(text.match(/^heard: /gm)).toHaveLength(1);
    expect(text).toContain("Kowalczyk wrote\nheard: kovalchik wrote\n<!-- /dictation diff -->\n");
  });

  it("loses none of 20 appends made at once", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    await Promise.all(ids.map((id, i) => appendDictation(vault(), entry(id, { at: minutesLater(i) }))));
    expect(blockIds(read()).sort()).toEqual([...ids].sort());
    expect(read().match(/^# Dictations/gm)).toHaveLength(1);
  });

  it("goes on after one append fails", async () => {
    const bad = appendDictation(vault(), entry("not safe!"));
    const good = appendDictation(vault(), entry("fine"));
    await expect(bad).rejects.toBeInstanceOf(AvanzelError);
    await good;
    expect(blockIds(read())).toEqual(["fine"]);
  });

  it("refuses an id that is not a safe token, in plain words, and writes nothing", async () => {
    for (const id of ["", "a b", "a\nb", "a-->b", "../x", "a".repeat(65), "é"]) {
      const error = await appendDictation(vault(), entry(id)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AvanzelError);
    }
    expect(existsSync(dayFile())).toBe(false);
    await appendDictation(vault(), entry("a".repeat(64)));
    expect(blockIds(read())).toEqual(["a".repeat(64)]);
  });

  it("refuses a date that is not one", async () => {
    await expect(appendDictation(vault(), entry("a1", { at: new Date(Number.NaN) }))).rejects.toBeInstanceOf(AvanzelError);
  });

  it("starts the entry on a fresh paragraph in a day file edited by hand: no final newline, or Windows line ends", async () => {
    mkdirSync(join(tmp(), "raw", "dictations"), { recursive: true });
    writeFileSync(dayFile(), "# Dictations 2026-11-05\n\nmy own note");
    await appendDictation(vault(), entry("a1"));
    expect(read()).toBe(
      "# Dictations 2026-11-05\n\nmy own note\n\n## 14:03 · Notes — Shopping\n<!-- dictation a1 -->\nwords of a1\n<!-- /dictation a1 -->\n\n",
    );
    writeFileSync(dayFile("2026-11-06"), "# Dictations 2026-11-06\r\n\r\nmy note\r\n\r\n");
    await appendDictation(vault(), entry("b1", { at: new Date("2026-11-06T09:00:00+04:00") }));
    expect(read("2026-11-06").startsWith("# Dictations 2026-11-06\r\n\r\nmy note\r\n\r\n## 09:00 · ")).toBe(true);
  });

  it("starts a header into a day file that is there but empty", async () => {
    mkdirSync(join(tmp(), "raw", "dictations"), { recursive: true });
    writeFileSync(dayFile(), "");
    await appendDictation(vault(), entry("a1"));
    expect(read().startsWith("# Dictations 2026-11-05\n\n")).toBe(true);
  });

  it("does not write through a link to somewhere else", async () => {
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    mkdirSync(join(tmp(), "raw"));
    symlinkSync(outside, join(tmp(), "raw", "dictations"));
    await expect(appendDictation(vault(), entry("a1"))).rejects.toBeInstanceOf(AvanzelError);
    expect(readdirSync(outside)).toEqual([]);

    const target = join(tmp(), "target.md");
    writeFileSync(target, "mine\n");
    const real = join(tmp(), "real");
    mkdirSync(join(real, "raw", "dictations"), { recursive: true });
    symlinkSync(target, join(real, "raw", "dictations", "2026-11-05.md"));
    await expect(appendDictation(new Vault(real), entry("a1"))).rejects.toBeInstanceOf(AvanzelError);
    expect(readFileSync(target, "utf8")).toBe("mine\n");
  });
});

describe("what a dictation says cannot change the block structure", () => {
  const FORGERY = [
    "## 99:99 · x",
    "<!-- dictation other -->",
    "text of other",
    "<!-- /dictation other -->",
    "--> <!--",
  ].join("\n");

  it("flattens app, title and site to one plain line of at most 120 characters", async () => {
    await appendDictation(
      vault(),
      entry("a1", { app: "Ap\np\r\n", title: `Line one\n## 99:99 · x\n<!-- dictation other -->\t\u007f ${"w".repeat(300)}`, site: null }),
    );
    const heading = read().split("\n").find((line) => line.startsWith("## ")) as string;
    expect(heading.startsWith("## 14:03 · Ap p — Line one ## 99:99 · x ")).toBe(true);
    const [app, title] = heading.slice("## 14:03 · ".length).split(" — ") as [string, string];
    expect(app).toBe("Ap p");
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
    expect(heading).not.toContain("<!--");
    expect(heading).not.toContain("-->");
    expect(read().split("\n").filter((line) => line.startsWith("## "))).toHaveLength(1);
    const long = await (async () => {
      await appendDictation(vault(), entry("a2", { app: "A".repeat(500), title: null, site: "s".repeat(500) }));
      return read().split("\n").filter((line) => line.startsWith("## "))[1] as string;
    })();
    const [app2, site2] = long.slice("## 14:03 · ".length).split(" — ") as [string, string];
    expect(Array.from(app2).length).toBeLessThanOrEqual(120);
    expect(Array.from(site2).length).toBeLessThanOrEqual(120);
    expect(blockIds(read())).toEqual(["a1", "a2"]);
  });

  it("falls back to the site when there is no title, and does not split an emoji when it cuts", async () => {
    await appendDictation(vault(), entry("a1", { title: null, site: "docs.example.com", app: "😀".repeat(200) }));
    const heading = read().split("\n").find((line) => line.startsWith("## ")) as string;
    expect(heading).toContain(" — docs.example.com");
    expect(heading).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/); // no half of a surrogate pair
  });

  it("cannot forge, end or hide a block with a title, an app, a site, the text or what was heard", async () => {
    await appendDictation(vault(), entry("first"));
    await appendDictation(
      vault(),
      entry("real", { app: FORGERY, title: FORGERY, site: FORGERY, text: FORGERY, heard: FORGERY }),
    );
    await appendDictation(vault(), entry("last"));
    const text = read();
    expect(blockIds(text)).toEqual(["first", "real", "last"]);
    expect(text.match(/<!--/g)).toHaveLength(6); // only the real markers
    expect(text.match(/-->/g)).toHaveLength(6);
    // Three real headings; the fourth `## ` is a line of the forged words, inside the real block, between its markers.
    expect(text.match(/^## /gm)).toHaveLength(4);
    expect(text.match(/^## 14:03 · /gm)).toHaveLength(3);
    // The forged entry is nothing: it cannot be forgotten, and the file is untouched by trying.
    expect(await forgetDictation(vault(), "other", AT)).toBe(false);
    expect(read()).toBe(text);
    // The real one goes with all of its odd words, and the neighbours stay.
    expect(await forgetDictation(vault(), "real", AT)).toBe(true);
    const after = read();
    expect(blockIds(after)).toEqual(["first", "last"]);
    expect(after).not.toContain("99:99");
    expect(after).not.toContain("dictation other");
    expect(after).not.toContain("text of other");
  });

  it("neutralises comment sequences however they are laid out, so none can be made by joining pieces", async () => {
    const tricky = "<<!---->!-- <!-<!---> ----> <!--> --!> -- > <!";
    await appendDictation(vault(), entry("t1", { text: tricky, heard: tricky, title: tricky }));
    const text = read();
    expect(text.match(/<!--/g)).toHaveLength(2);
    expect(text.match(/-->/g)).toHaveLength(2);
    expect(blockIds(text)).toEqual(["t1"]);
    expect(await forgetDictation(vault(), "t1", AT)).toBe(true);
  });

  it("keeps the words readable: the text reads back as it was said apart from the comment sequences", async () => {
    await appendDictation(vault(), entry("t1", { text: "Say hello.\nSecond line, 5 > 3 and a <b>tag</b>." }));
    expect(read()).toContain("Say hello.\nSecond line, 5 > 3 and a <b>tag</b>.\n<!-- /dictation t1 -->");
  });
});

describe("forgetDictation", () => {
  it("removes only its own block, with its blank line, and leaves every other byte as it was", async () => {
    for (const [i, id] of ["f1", "f2", "f3"].entries()) await appendDictation(vault(), entry(id, { at: minutesLater(i) }));
    const text = read();
    const start = text.indexOf("## 14:04");
    const end = text.indexOf("## 14:05");
    expect(await forgetDictation(vault(), "f2", AT)).toBe(true);
    expect(read()).toBe(text.slice(0, start) + text.slice(end));
    expect(blockIds(read())).toEqual(["f1", "f3"]);
  });

  it("removes the first and the last entry too", async () => {
    for (const [i, id] of ["f1", "f2", "f3"].entries()) await appendDictation(vault(), entry(id, { at: minutesLater(i) }));
    expect(await forgetDictation(vault(), "f3", AT)).toBe(true);
    expect(await forgetDictation(vault(), "f1", AT)).toBe(true);
    expect(blockIds(read())).toEqual(["f2"]);
    expect(read().endsWith("<!-- /dictation f2 -->\n\n")).toBe(true);
  });

  it("returns false for an id that is not there, and leaves the file as it was", async () => {
    await appendDictation(vault(), entry("f1"));
    const before = read();
    expect(await forgetDictation(vault(), "nope", AT)).toBe(false);
    expect(await forgetDictation(vault(), "f", AT)).toBe(false); // a prefix of an id is not the id
    expect(read()).toBe(before);
  });

  it("returns false when there is no day file at all, and makes none", async () => {
    expect(await forgetDictation(vault(), "f1", AT)).toBe(false);
    expect(existsSync(join(tmp(), "raw"))).toBe(false);
  });

  it("refuses an id that is not a safe token, and returns false", async () => {
    await appendDictation(vault(), entry("f1"));
    const before = read();
    for (const id of ["", "f1 ", "f1 -->", ".*", "a/b", "x".repeat(65)]) expect(await forgetDictation(vault(), id, AT)).toBe(false);
    expect(read()).toBe(before);
  });

  it("keeps the day file with its header when the last entry goes", async () => {
    await appendDictation(vault(), entry("f1"));
    expect(await forgetDictation(vault(), "f1", AT)).toBe(true);
    expect(existsSync(dayFile())).toBe(true);
    expect(read()).toMatch(/^# Dictations 2026-11-05\n\n[^\n]+\n\n$/);
    await appendDictation(vault(), entry("f2")); // and it is a file one can go on writing to
    expect(blockIds(read())).toEqual(["f2"]);
  });

  it("finds the entry when the date it is given is a day off, in either direction", async () => {
    await appendDictation(vault(), entry("mid", { at: new Date("2026-11-05T23:59:00+04:00") }));
    await appendDictation(vault(), entry("far", { at: new Date("2026-11-09T12:00:00+04:00") }));
    expect(await forgetDictation(vault(), "mid", new Date("2026-11-06T00:01:00+04:00"))).toBe(true); // a day after
    expect(blockIds(read("2026-11-05"))).toEqual([]);
    await appendDictation(vault(), entry("mid2", { at: new Date("2026-11-06T00:02:00+04:00") }));
    expect(await forgetDictation(vault(), "mid2", new Date("2026-11-05T23:00:00+04:00"))).toBe(true); // a day before
    // Two days off is too far: it is not looked for.
    expect(await forgetDictation(vault(), "far", new Date("2026-11-07T12:00:00+04:00"))).toBe(false);
    expect(blockIds(read("2026-11-09"))).toEqual(["far"]);
  });

  it("works on a day file with Windows line ends and no final newline, changing nothing else", async () => {
    mkdirSync(join(tmp(), "raw", "dictations"), { recursive: true });
    const crlf = [
      "# Dictations 2026-11-05",
      "",
      "my note",
      "",
      "## 14:03 · Notes — A",
      "<!-- dictation c1 -->",
      "one",
      "<!-- /dictation c1 -->",
      "",
      "## 14:04 · Notes — B",
      "<!-- dictation c2 -->",
      "two",
      "<!-- /dictation c2 -->",
    ].join("\r\n");
    writeFileSync(dayFile(), crlf);
    expect(await forgetDictation(vault(), "c1", AT)).toBe(true);
    expect(read()).toBe(["# Dictations 2026-11-05", "", "my note", "", "## 14:04 · Notes — B", "<!-- dictation c2 -->", "two", "<!-- /dictation c2 -->"].join("\r\n"));
    expect(await forgetDictation(vault(), "c2", AT)).toBe(true);
    expect(read()).toBe("# Dictations 2026-11-05\r\n\r\nmy note\r\n\r\n");
  });

  it("leaves a block that has no closing marker alone", async () => {
    mkdirSync(join(tmp(), "raw", "dictations"), { recursive: true });
    const broken = "# Dictations 2026-11-05\n\n## 14:03 · Notes\n<!-- dictation u1 -->\nno end\n";
    writeFileSync(dayFile(), broken);
    expect(await forgetDictation(vault(), "u1", AT)).toBe(false);
    expect(read()).toBe(broken);
  });

  it("loses no append made at the same time, and removes no other block", async () => {
    const seeded = Array.from({ length: 5 }, (_, i) => `s${i}`);
    for (const [i, id] of seeded.entries()) await appendDictation(vault(), entry(id, { at: minutesLater(i) }));
    const added = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const work: Promise<unknown>[] = [];
    added.forEach((id, i) => {
      work.push(appendDictation(vault(), entry(id, { at: minutesLater(10 + i) })));
      if (i === 2) work.push(forgetDictation(vault(), "s1", AT));
      if (i === 5) work.push(forgetDictation(vault(), "s3", AT));
      if (i === 7) work.push(forgetDictation(vault(), "n0", AT)); // forgets one appended a moment ago
    });
    await Promise.all(work);
    expect(blockIds(read()).sort()).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "s0", "s2", "s4"]);
  });

  it("does not rewrite a day file through a link", async () => {
    mkdirSync(join(tmp(), "raw", "dictations"), { recursive: true });
    const target = join(tmp(), "target.md");
    const text = "# Dictations 2026-11-05\n\n## 14:03 · Notes\n<!-- dictation l1 -->\nx\n<!-- /dictation l1 -->\n\n";
    writeFileSync(target, text);
    symlinkSync(target, dayFile());
    expect(await forgetDictation(vault(), "l1", AT)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(text);
    expect(lstatSync(dayFile()).isSymbolicLink()).toBe(true);
  });

  it("leaves no temporary file behind", async () => {
    await appendDictation(vault(), entry("f1"));
    await forgetDictation(vault(), "f1", AT);
    expect(readdirSync(join(tmp(), "raw", "dictations"))).toEqual(["2026-11-05.md"]);
  });
});

describe("the engine's exports", () => {
  it("offers the log, the default skip list and the date helpers the app needs", () => {
    expect(engine.appendDictation).toBe(appendDictation);
    expect(engine.forgetDictation).toBe(forgetDictation);
    expect(engine.DEFAULT_DICTATION_SKIP_APPS).toBe(DEFAULT_DICTATION_SKIP_APPS);
    for (const name of ["idStamp", "isoLocal", "localDate", "localMinute"] as const) expect(typeof engine[name]).toBe("function");
    expect(engine.isoLocal(AT)).toBe("2026-11-05T14:03:12+04:00");
  });
});
