import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fold, logBullets, pageMeta, tagCounts } from "../../src/core/pages.ts";
import { useTmp, write } from "./helpers.ts";

const tmp = useTmp();

const PAGE = `---
title: Run a marathon
shelf: goals
status: active
created: 2026-10-20
updated: 2026-10-20
tags: [health, running]
aliases: [Sasha, "Alexander P."]
sources: ["[[2026-10-20-140312-i-want-to-run-a]]"]
---
# Run a marathon

What it is and where it stands now, in two to five sentences. Rewrite this as things change.

## Next steps
- [ ] Find a beginner training plan

## Log
- 2026-10-20 — Wants to run a marathon next spring; worried about knee pain. ([[2026-10-20-140312-i-want-to-run-a]])

## Related
- [[knee-pain]]
`;

describe("fold", () => {
  it("lowercases and treats ё as е", () => {
    expect(fold("Ёлка ПРОЕКТ")).toBe("елка проект");
  });
});

describe("pageMeta", () => {
  it("reads the fields a page carries", () => {
    expect(pageMeta(PAGE)).toEqual({
      title: "Run a marathon",
      shelf: "goals",
      status: "active",
      updated: "2026-10-20",
      tags: ["health", "running"],
      aliases: ["Sasha", "Alexander P."],
      source: null,
      agent: null,
    });
  });

  it("gives empty values for a page without front matter", () => {
    expect(pageMeta("# Just a heading\n")).toEqual({
      title: null,
      shelf: null,
      status: null,
      updated: null,
      tags: [],
      aliases: [],
      source: null,
      agent: null,
    });
  });

  it("reads the source and agent of an agent's note", () => {
    const meta = pageMeta("---\nsource: agent\nagent: claude-code\ntags: [a]\n---\nText\n");
    expect(meta.source).toBe("agent");
    expect(meta.agent).toBe("claude-code");
  });
});

describe("logBullets", () => {
  it("returns the dated bullets under Log with the capture they cite", () => {
    expect(logBullets(PAGE)).toEqual([
      {
        date: "2026-10-20",
        text: "Wants to run a marathon next spring; worried about knee pain. ([[2026-10-20-140312-i-want-to-run-a]])",
        captureId: "2026-10-20-140312-i-want-to-run-a",
      },
    ]);
  });

  it("ignores bullets outside the Log section and bullets that cite nothing", () => {
    const text = "# T\n\n- 2026-01-01 — before the log\n\n## Log\n- 2026-02-02 — no link\n- not dated\n\n## Related\n- 2026-03-03 — after\n";
    expect(logBullets(text)).toEqual([{ date: "2026-02-02", text: "no link", captureId: null }]);
  });
});

describe("tagCounts", () => {
  it("counts tags over shelf pages, most used first, ties A to Z", () => {
    write(tmp(), "goals/a.md", "---\ntags: [work, health]\n---\n# A\n");
    write(tmp(), "ideas/b.md", "---\ntags: [work, zebra]\n---\n# B\n");
    write(tmp(), "topics/c.md", "---\ntags: [work, health, apple]\n---\n# C\n");
    write(tmp(), "inbox/d.md", "---\ntags: [work]\n---\nnote\n");
    write(tmp(), "reviews/e.md", "---\ntags: [work]\n---\nreview\n");
    write(tmp(), "index.md", "---\ntags: [work]\n---\n");
    expect(tagCounts(tmp())).toEqual([
      { tag: "work", count: 3 },
      { tag: "health", count: 2 },
      { tag: "apple", count: 1 },
      { tag: "zebra", count: 1 },
    ]);
  });

  it("does not follow a symlinked page", () => {
    write(tmp(), "goals/real.md", "---\ntags: [one]\n---\n");
    write(tmp(), "outside.md", "---\ntags: [secret]\n---\n");
    symlinkSync(join(tmp(), "outside.md"), join(tmp(), "goals/link.md"));
    expect(tagCounts(tmp())).toEqual([{ tag: "one", count: 1 }]);
  });
});
