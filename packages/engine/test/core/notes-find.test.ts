import { describe, expect, it } from "vitest";
import { entryPattern, findNotes, stem } from "../../src/core/notes-find.ts";
import { useTmp, write } from "./helpers.ts";

describe("stem", () => {
  it("brings Russian word forms to one stem", () => {
    expect(new Set(["проект", "проекта", "проектом", "проекты", "проектами"].map(stem)).size).toBe(1);
    expect(stem("Ёлки")).toBe(stem("елка"));
  });
  it("brings English plurals and -ing forms together, and leaves short words whole", () => {
    expect(stem("letters")).toBe(stem("letter"));
    expect(stem("reading")).toBe(stem("read"));
    expect(stem("dog")).toBe("dog");
  });
});

describe("findNotes", () => {
  const tmp = useTmp();
  function library(): string {
    const root = tmp();
    write(root, "Philosophy/Stoicism/Seneca.md", "# Seneca\n\n## Letters\nПисьма Сенеки к Луцилию.\n\n- В письма Сенеки он пишет о времени\n");
    write(root, "Philosophy/Concepts/Virtue.md", "# Virtue\n\nДобродетель.\n");
    write(root, "ideas/x.md", "Сенека\n");
    return root;
  }

  it("finds a note at any depth of the given folders by a word in another form, best first", () => {
    const found = findNotes(library(), "Сенека пишет о письмах", { folders: ["Philosophy"] });
    expect(found[0]!.path).toBe("Philosophy/Stoicism/Seneca.md");
    expect(found.map((note) => note.path)).not.toContain("ideas/x.md");
    expect(found.map((note) => note.path)).not.toContain("Philosophy/Concepts/Virtue.md");
    expect(found[0]!.outline).toEqual(["# Seneca", "## Letters"]);
  });
  it("gives each note its outline and short passages, never the whole note", () => {
    const root = library();
    const big = "# Big\n\n" + "## Раздел\nСенека ".repeat(20_000);
    write(root, "Philosophy/Big.md", big);
    const note = findNotes(root, "Сенека", { folders: ["Philosophy"], limit: 10 }).find((n) => n.path === "Philosophy/Big.md")!;
    expect(note.passages.length).toBeLessThanOrEqual(3);
    expect(note.passages.every((p) => [...p].length <= 300)).toBe(true);
    expect(note.outline.length).toBeLessThanOrEqual(30);
  });
  it("matches a folder named in decomposed Unicode on disk", () => {
    const root = tmp();
    write(root, "Мой заметки/a.md", "Сенека");
    expect(findNotes(root, "Сенека", { folders: ["Мой заметки"] })).toHaveLength(1);
    write(root, "Мой other/b.md", "Сенека");
    expect(findNotes(root, "Сенека", { folders: ["Мой other"] })).toHaveLength(1);
  });
  it("skips front matter in passages, counts a name or title match extra, and honours the limit", () => {
    const root = tmp();
    write(root, "S/Seneca.md", "---\ntitle: Seneca\nnote: seneca secret\n---\nA line about seneca here.\nOther line.\n");
    write(root, "S/b.md", "seneca once\n");
    write(root, "S/c.md", "seneca once\n");
    const found = findNotes(root, "seneca", { folders: ["S"], limit: 2 });
    expect(found).toHaveLength(2);
    expect(found[0]!.path).toBe("S/Seneca.md");
    expect(found[0]!.passages).toEqual(["A line about seneca here."]);
    expect(found[1]!.path).toBe("S/b.md");
  });
});

describe("entryPattern", () => {
  const NOW = new Date("2026-11-16T10:00:00+04:00");
  it("sees dated headings added at the end, and writes today the same way", () => {
    const p = entryPattern("# Diary\n\n## 01.11.2026\nfirst\n\n## 05.11.2026\nsecond\n", NOW)!;
    expect(p).toMatchObject({ dateFormat: "dd.mm.yyyy", today: "## 16.11.2026", where: "end" });
    expect(p.entries.at(-1)).toBe("## 05.11.2026\nsecond");
  });
  it("sees dated bullets under a Log heading", () => {
    const p = entryPattern("# X\n\n## Log\n- 2026-11-01 — a\n- 2026-11-05 — b\n\n## Notes\ntext\n", NOW)!;
    expect(p).toMatchObject({ dateFormat: "yyyy-mm-dd", today: "- 2026-11-16 — a", where: { under: "## Log" } });
    expect(p.entries).toEqual(["- 2026-11-01 — a", "- 2026-11-05 — b"]);
  });
  it("sees newest-first notes", () => {
    expect(entryPattern("## 05.11.2026\nb\n## 01.11.2026\na\n", NOW)?.where).toBe("top");
  });
  it("reads Windows line ends as any others", () => {
    expect(entryPattern("## 01.11.2026\r\na\r\n## 05.11.2026\r\nb\r\n", NOW)?.entries.at(-1)).toBe("## 05.11.2026\nb");
  });
  it("has no pattern for a note without dated entries", () => {
    expect(entryPattern("# Seneca\n\nLong text with no dates.\n", NOW)).toBeNull();
  });
  it("shows only the newest three entries, each cut short, and knows the short year format", () => {
    const text = [1, 2, 3, 4].map((day) => `## 0${day}.11.26\n${"я".repeat(500)}\n`).join("\n");
    const p = entryPattern(text, NOW)!;
    expect(p.dateFormat).toBe("dd.mm.yy");
    expect(p.today).toBe("## 16.11.26");
    expect(p.entries).toHaveLength(3);
    expect(p.entries[0]!.startsWith("## 02.11.26")).toBe(true);
    expect([...p.entries[0]!].length).toBe(400);
  });
  it("ignores dates in front matter, code blocks and impossible dates", () => {
    expect(entryPattern("---\n- 2026-11-01\n---\n```\n## 2026-11-02\n```\n## v2026-99-99\n", NOW)).toBeNull();
  });
});
