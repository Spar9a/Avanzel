import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachmentNamesIn, attachmentsIn, frontMatter, libraryPages, pagePrompt, pageText, sourcesOnlyOf, plainWords, withoutItem } from "../src/main/library-pages.ts";
import { inboxLine, pageDay, reviewOutcome, reviewState, sortPages, when } from "../src/renderer/panel/copy.ts";
import type { PanelReview } from "../src/shared/ipc.ts";

const PAGE = `---
title: Рабочий фикс — свет в графике
shelf: problems
status: open
created: 2026-11-06
updated: 2026-11-06
tags: [work, graphics, "lighting"]
sources: ["[[2026-11-06-063600]]"]
---
# Рабочий фикс — свет в графике

Короткая голосовая заметка о **рабочей** задаче: починить свет в [[graphics|графике]].
Подробностей нет.

## Next steps
- [ ] Уточнить, о каком проекте речь
- [x] Записать

## Related
`;

let dirs: string[] = [];
const library = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "avanzel-pages-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("front matter", () => {
  it("reads values, inline lists and block lists, without quotes", () => {
    const { fields, body } = frontMatter("---\na: 'one'\nb: [x, \"y, z\"]\nc:\n  - p\n  - q\n---\nBody");
    expect(fields).toEqual({ a: "one", b: ["x", "y, z"], c: ["p", "q"] });
    expect(body).toBe("Body");
  });

  it("leaves a page with none whole", () => {
    expect(frontMatter("# Title\n").fields).toEqual({});
  });
});

describe("page text", () => {
  it("takes the title, the first paragraph and the sections that have lines", () => {
    const words = pageText(frontMatter(PAGE).body);
    expect(words.heading).toBe("Рабочий фикс — свет в графике");
    expect(words.summary).toBe("Короткая голосовая заметка о рабочей задаче: починить свет в графике. Подробностей нет.");
    expect(words.sections).toEqual([{ heading: "Next steps", lines: ["☐ Уточнить, о каком проекте речь", "☑ Записать"] }]);
  });

  it("writes links as plain words", () => {
    expect(plainWords("See [[people/dana|Dana]], [[ideas/x]] and [the site](https://a.b)")).toBe("See Dana, x and the site");
  });
});

describe("pagePrompt", () => {
  it("is the page for an agent: what it is, the title and its fields, its words, and its files as full paths", () => {
    const root = library();
    mkdirSync(path.join(root, "raw", "attachments", "2026", "11"), { recursive: true });
    writeFileSync(path.join(root, "raw", "attachments", "2026", "11", "shot.png"), "png");
    const text = "---\ntitle: Fix the light\nshelf: problems\nstatus: open\ntags: [work, graphics]\n---\n# Fix the light\n\nSee [the shot](raw/attachments/2026/11/shot.png) and raw/attachments/2026/11/gone.mov.\n\n## Next steps\n- [ ] Ask Dana\n";
    const prompt = pagePrompt(root, "problems/fix-light.md", text);
    const shot = path.join(root, "raw/attachments/2026/11/shot.png");
    expect(prompt).toBe(
      [
        "Here is a note from my notes in Avanzel. Read it, look at the files it names, and help me with it.",
        "",
        "# Fix the light",
        "Shelf: problems. Status: open. Tags: work, graphics.",
        "",
        `See [the shot](${shot}) and raw/attachments/2026/11/gone.mov.\n\n## Next steps\n- [ ] Ask Dana`,
        "",
        "Files (on this Mac):",
        `- ${shot}`,
        "",
      ].join("\n"),
    );
  });

  it("names the shelf by its folder when the front matter doesn't, and leaves out what isn't there", () => {
    const prompt = pagePrompt(library(), "ideas/plain.md", "Just words.\n");
    expect(prompt).toBe("Here is a note from my notes in Avanzel. Read it, look at the files it names, and help me with it.\n\n# plain\nShelf: ideas.\n\nJust words.\n");
  });
});

describe("sourcesOnlyOf", () => {
  it("is the captures a page names in its sources, in the inbox or raw/, but those another page names too", () => {
    const root = library();
    mkdirSync(path.join(root, "inbox"));
    mkdirSync(path.join(root, "raw", "2026", "11"), { recursive: true });
    mkdirSync(path.join(root, "problems"));
    mkdirSync(path.join(root, "ideas"));
    writeFileSync(path.join(root, "raw", "2026", "11", "a.md"), "capture a");
    writeFileSync(path.join(root, "raw", "2026", "11", "shared.md"), "capture shared");
    writeFileSync(path.join(root, "inbox", "b.md"), "capture b");
    writeFileSync(path.join(root, "ideas", "other.md"), "---\nsources: [\"[[shared]]\"]\n---\n# Other\n");
    const text = "---\nsources: [\"[[a]]\", \"[[shared]]\", \"[[b]]\", \"[[missing]]\"]\n---\n# Fix\n";
    writeFileSync(path.join(root, "problems", "fix.md"), text);
    expect(sourcesOnlyOf(root, "problems/fix.md", text).map((file) => path.relative(root, file)).sort()).toEqual(["inbox/b.md", "raw/2026/11/a.md"]);
  });

  it("is none for a page that names no sources", () => {
    expect(sourcesOnlyOf(library(), "ideas/x.md", "# X\n")).toEqual([]);
  });
});

describe("library pages", () => {
  it("lists the shelves' pages, newest change first, with their shelf, status and tags", () => {
    const root = library();
    mkdirSync(path.join(root, "problems"));
    mkdirSync(path.join(root, "ideas"));
    mkdirSync(path.join(root, "inbox"));
    writeFileSync(path.join(root, "problems", "fix-light.md"), PAGE);
    writeFileSync(path.join(root, "ideas", "older.md"), "---\nupdated: 2026-10-01\n---\n# Older idea\n");
    writeFileSync(path.join(root, "inbox", "capture.md"), "# Not a page yet\n");
    const pages = libraryPages(root);
    expect(pages.map((p) => p.path)).toEqual(["problems/fix-light.md", "ideas/older.md"]);
    expect(pages[0]).toMatchObject({ title: "Рабочий фикс — свет в графике", shelf: "problems", status: "open", tags: ["work", "graphics", "lighting"], created: "2026-11-06" });
    expect(pages[1]).toMatchObject({ title: "Older idea", shelf: "ideas", status: null, tags: [] });
  });

  it("follows no link out of the library", () => {
    const root = library();
    const outside = library();
    writeFileSync(path.join(outside, "secret.md"), "# Secret\n");
    mkdirSync(path.join(root, "topics"));
    symlinkSync(path.join(outside, "secret.md"), path.join(root, "topics", "secret.md"));
    symlinkSync(outside, path.join(root, "people"));
    expect(libraryPages(root)).toEqual([]);
  });
});

describe("panel copy", () => {
  const now = new Date(2026, 10, 6, 7, 0);
  const review = (patch: Partial<PanelReview>): PanelReview => ({
    id: "evening-review", name: "Evening review", kind: "evening-review", enabled: true, next: null, lastRun: null, running: false, progress: null, outcome: null, ...patch,
  });

  it("words a page's day", () => {
    expect(pageDay("2026-11-06", now)).toBe("Today");
    expect(pageDay("2026-11-05", now)).toBe("Yesterday");
    expect(pageDay("2026-10-01", now)).toBe("1 Oct");
    expect(pageDay("2025-10-01", now)).toBe("1 Oct 2025");
  });

  it("words when a review runs and how it ended", () => {
    expect(when(new Date(2026, 10, 6, 21, 0).toISOString(), now)).toBe("today at 21:00");
    expect(reviewState(review({ next: new Date(2026, 10, 6, 21, 0).toISOString() }), now)).toBe("Next today at 21:00");
    expect(reviewState(review({ running: true, progress: "Filing 2 of 5" }), now)).toBe("Filing 2 of 5");
    expect(reviewState(review({ enabled: false }), now)).toBe("Off");
    const at = new Date(2026, 10, 6, 6, 10).toISOString();
    expect(reviewOutcome(review({ outcome: { at, title: "Evening review", body: "Nothing waited in the inbox." } }), now)).toBe("Last today at 06:10: Nothing waited in the inbox.");
    expect(reviewOutcome(review({ outcome: { at, title: "Evening review: 2 thoughts filed", body: "Claude Code sorted today's inbox." } }), now)).toBe(
      "Last today at 06:10: 2 thoughts filed. Claude Code sorted today's inbox.",
    );
  });

  it("sorts pages by change, by making, by title and by shelf", () => {
    const page = (path: string, title: string, shelf: string | null, created: string, updated: string) =>
      ({ path, title, shelf, status: null, tags: [], created, updated, summary: "", sections: [], attachments: [], attachmentNames: [] });
    const pages = [
      page("a", "Beta", "topics", "2026-11-01", "2026-11-06"),
      page("b", "Alpha", "goals", "2026-11-05", "2026-11-05"),
      page("c", "Gamma", null, "2026-10-01", "2026-11-04"),
    ];
    expect(sortPages(pages, "changed").map((p) => p.path)).toEqual(["a", "b", "c"]);
    expect(sortPages(pages, "made").map((p) => p.path)).toEqual(["b", "a", "c"]);
    expect(sortPages(pages, "title").map((p) => p.path)).toEqual(["b", "a", "c"]);
    expect(sortPages(pages, "shelf").map((p) => p.path)).toEqual(["b", "a", "c"]);
    expect(pages.map((p) => p.path)).toEqual(["a", "b", "c"]);
  });

  it("words the inbox", () => {
    expect(inboxLine(0)).toBe("The inbox is empty.");
    expect(inboxLine(1)).toBe("1 note waits in the inbox.");
    expect(inboxLine(3)).toBe("3 notes wait in the inbox.");
  });
});

describe("withoutItem", () => {
  const page = "# Fix\n\n## Next steps\n\n- [ ] Ask Dana\n  - which project\n- [x] Book\n\n## Log\n\n- [ ] Ask Dana\n";

  it("takes out the step the panel names, in its section only, with what is indented under it", () => {
    expect(withoutItem(page, "Next steps", "☐ Ask Dana")).toBe("# Fix\n\n## Next steps\n\n- [x] Book\n\n## Log\n\n- [ ] Ask Dana\n");
    expect(withoutItem(page, "Next steps", "☑ Book")).toBe("# Fix\n\n## Next steps\n\n- [ ] Ask Dana\n  - which project\n\n## Log\n\n- [ ] Ask Dana\n");
  });

  it("writes nothing for a line or a section the page hasn't", () => {
    expect(withoutItem(page, "Next steps", "☐ Something else")).toBeNull();
    expect(withoutItem(page, "Questions", "☐ Ask Dana")).toBeNull();
  });
});

describe("attachmentsIn", () => {
  it("names each file of raw/attachments a page mentions, once and in order, that is there", () => {
    const root = mkdtempSync(path.join(tmpdir(), "avanzel-att-"));
    mkdirSync(path.join(root, "raw/attachments/2026/11"), { recursive: true });
    writeFileSync(path.join(root, "raw/attachments/2026/11/a.mov"), "x");
    writeFileSync(path.join(root, "raw/attachments/2026/11/b.png"), "x");
    const text = "Videos raw/attachments/2026/11/a.mov, raw/attachments/2026/11/gone.mov and (raw/attachments/2026/11/b.png). Again raw/attachments/2026/11/a.mov.";
    expect(attachmentsIn(root, text)).toEqual(["raw/attachments/2026/11/a.mov", "raw/attachments/2026/11/b.png"]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("plainWords and files", () => {
  it("keeps a link to a file of raw/attachments as it is, and makes any other link its words", () => {
    expect(plainWords("Watch [the recording](raw/attachments/2026/11/a.mov) and [the site](https://example.com).")).toBe(
      "Watch [the recording](raw/attachments/2026/11/a.mov) and the site.",
    );
  });
});

describe("attachmentNamesIn", () => {
  it("reads the name a file had from where the page writes it beside its path, for a file that is there", () => {
    const root = mkdtempSync(path.join(tmpdir(), "avanzel-names-"));
    mkdirSync(path.join(root, "raw/attachments/2026/11"), { recursive: true });
    writeFileSync(path.join(root, "raw/attachments/2026/11/a.mov"), "x");
    const text = "Added raw/attachments/2026/11/a.mov («Запись экрана 2026-11-07 в 10.54.48.mov») and raw/attachments/2026/11/gone.mov (Old.mov).";
    expect(attachmentNamesIn(root, text)).toEqual([{ name: "Запись экрана 2026-11-07 в 10.54.48.mov", path: "raw/attachments/2026/11/a.mov" }]);
    rmSync(root, { recursive: true, force: true });
  });
});
