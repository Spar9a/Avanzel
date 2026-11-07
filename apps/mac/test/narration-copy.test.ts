import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { FilingStep } from "@avanzel/engine";
import { filedPages } from "../src/main/library-info.ts";
import { withStep, withWritten } from "../src/main/narration.ts";
import { filingLine, KEPT_LINE, rowLine, SAVED_LINE, SHOWN_ROWS, STILL_WORKING_MS } from "../src/renderer/common/narration.ts";
import type { FiledPage, NarrationRow } from "../src/shared/ipc.ts";

/** A row as main makes it from a library path: the title it was given, and the path's first folder for a shelf ("" at the root). */
const row = (kind: NarrationRow["kind"], path: string, title: string): NarrationRow => ({
  kind,
  path,
  title,
  shelf: path.includes("/") ? path.slice(0, path.indexOf("/")) : "",
});
const search: NarrationRow = { kind: "search", path: null, title: "", shelf: "" };

describe("rowLine: a read", () => {
  it("of a page in people/ says whose page it is", () => {
    expect(rowLine(row("read", "people/mark.md", "Mark"))).toBe("Reading Mark's note");
    expect(rowLine(row("read", "people/team/ana.md", "Ana"))).toBe("Reading Ana's note"); // a folder inside the shelf is still people/
  });

  it("of a file in people/ that isn't a page names the file", () => {
    expect(rowLine({ kind: "read", path: "people/mark.jpg", title: "mark.jpg", shelf: "people" })).toBe("Reading mark.jpg");
  });

  it("of any other page names the page", () => {
    expect(rowLine(row("read", "ideas/p.md", "Indie game dev podcast"))).toBe("Reading Indie game dev podcast");
    expect(rowLine(row("read", "topics/budget.pdf", "budget.pdf"))).toBe("Reading budget.pdf"); // not a page, but named all the same
    expect(rowLine(row("read", "projects/plan.md", "The plan"))).toBe("Reading The plan"); // a folder that is no shelf
    expect(rowLine(row("read", "notes.md", "Notes"))).toBe("Reading Notes"); // a file at the root
  });

  it("of the library's own files says what they are for", () => {
    expect(rowLine(row("read", "index.md", "index"))).toBe("Reading your library index");
    expect(rowLine(row("read", "log.md", "log"))).toBe("Reading the log");
    expect(rowLine(row("read", "AGENTS.md", "Avanzel library"))).toBe("Reading the library's rules");
  });

  it("of a file with one of those names in a folder is a page like any other", () => {
    expect(rowLine(row("read", "topics/index.md", "Topics"))).toBe("Reading Topics");
    expect(rowLine(row("read", "ideas/log.md", "Idea log"))).toBe("Reading Idea log");
  });
});

describe("rowLine: a search, a write and a removal", () => {
  it("a search is a search of the library", () => {
    expect(rowLine(search)).toBe("Searching your library");
  });

  it("a new note on a shelf is a page of that shelf's kind, each shelf with its own noun", () => {
    const shelves = ["goals", "ideas", "problems", "memories", "people", "topics"];
    expect(shelves.map((shelf) => rowLine(row("new", `${shelf}/p.md`, "Indie game dev podcast")))).toEqual([
      "New goal note: Indie game dev podcast",
      "New idea note: Indie game dev podcast",
      "New problem note: Indie game dev podcast",
      "New memory note: Indie game dev podcast",
      "New person note: Indie game dev podcast",
      "New topic note: Indie game dev podcast",
    ]);
    // The first folder of the path is the shelf: a deeper page is on it too.
    expect(rowLine(row("new", "topics/deep/er/p.md", "Deep"))).toBe("New topic note: Deep");
  });

  it("a new note anywhere else is only a page", () => {
    expect(rowLine(row("new", "projects/launch.md", "Launch"))).toBe("New note: Launch");
    expect(rowLine(row("new", "notes.md", "Notes"))).toBe("New note: Notes"); // at the root
    // A folder is a shelf by its exact name only, and never by a name every object has.
    expect(rowLine(row("new", "idea/p.md", "P"))).toBe("New note: P");
    expect(rowLine(row("new", "Ideas/p.md", "P"))).toBe("New note: P");
    expect(rowLine(row("new", "constructor/p.md", "P"))).toBe("New note: P");
    expect(rowLine(row("new", "toString/p.md", "P"))).toBe("New note: P");
  });

  it("a new file that isn't Markdown is a file, not a page", () => {
    expect(rowLine(row("new", "topics/data.json", "data.json"))).toBe("New file: data.json");
    expect(rowLine(row("new", "projects/budget.pdf", "budget.pdf"))).toBe("New file: budget.pdf"); // on no shelf
    expect(rowLine(row("new", "notes.txt", "notes.txt"))).toBe("New file: notes.txt"); // at the root
    // A file that was there already is only updated, as a page is.
    expect(rowLine(row("updated", "topics/data.json", "data.json"))).toBe("Updated: data.json");
  });

  it("an updated note says which", () => {
    expect(rowLine(row("updated", "people/mark.md", "Mark"))).toBe("Updated: Mark");
    expect(rowLine(row("updated", "ideas/p.md", "Indie game dev podcast"))).toBe("Updated: Indie game dev podcast");
    expect(rowLine(row("updated", "notes.md", "Notes"))).toBe("Updated: Notes");
  });

  it("the index and the log, written, say what was done to them, new or updated", () => {
    expect(rowLine(row("updated", "index.md", "index"))).toBe("Updated your library index");
    expect(rowLine(row("new", "index.md", "index"))).toBe("Updated your library index");
    expect(rowLine(row("updated", "log.md", "log"))).toBe("Added a line to the log");
    expect(rowLine(row("new", "log.md", "log"))).toBe("Added a line to the log");
  });

  it("the rules, written, and the index or log of a folder are pages like any other", () => {
    expect(rowLine(row("updated", "AGENTS.md", "Avanzel library"))).toBe("Updated: Avanzel library");
    expect(rowLine(row("updated", "topics/index.md", "Topics"))).toBe("Updated: Topics");
    expect(rowLine(row("new", "ideas/log.md", "Idea log"))).toBe("New idea note: Idea log");
  });

  it("a removed page is named by its file name", () => {
    expect(rowLine(row("removed", "ideas/old-plan.md", "old-plan"))).toBe("Removed: old-plan");
    expect(rowLine(row("removed", "index.md", "index"))).toBe("Removed: index");
  });

  it("a filing's steps read, one row each, as the Filing step shows them", () => {
    const titles: Record<string, string> = { "ideas/idea-1.md": "Call the vet on Monday", "people/mark.md": "Mark" };
    const page = (rel: string): FiledPage => ({ title: titles[rel] ?? posix.basename(rel, ".md"), shelf: rel.split("/")[0] ?? "", path: rel });
    const steps: FilingStep[] = [
      { kind: "read", path: "index.md" },
      { kind: "search" },
      { kind: "read", path: "people/mark.md" },
      { kind: "wrote", path: "ideas/idea-1.md", created: true },
      { kind: "wrote", path: "people/mark.md", created: false },
      { kind: "wrote", path: "index.md", created: false },
      { kind: "wrote", path: "log.md", created: false },
      { kind: "deleted", path: "ideas/old-plan.md" },
    ];
    const rows = steps.reduce<NarrationRow[]>((kept, step) => withStep(kept, step, page), []);
    expect(rows.map(rowLine)).toEqual([
      "Reading your library index",
      "Searching your library",
      "Reading Mark's note",
      "New idea note: Call the vet on Monday",
      "Updated: Mark",
      "Updated your library index",
      "Added a line to the log",
      "Removed: old-plan",
    ]);
  });
});

describe("the proof and the rows' words", () => {
  const everyRow: NarrationRow[] = [
    search,
    ...(["read", "new", "updated", "removed"] as const).flatMap((kind) =>
      [
        "goals/a.md",
        "ideas/a.md",
        "problems/a.md",
        "memories/a.md",
        "people/a.md",
        "topics/a.md",
        "topics/data.json",
        "projects/a.md",
        "a.md",
        "index.md",
        "log.md",
        "AGENTS.md",
      ].map((path) => row(kind, path, "Title")),
    ),
  ];

  it("the proof lines, and how many rows show", () => {
    expect(KEPT_LINE).toBe("Kept your exact words in raw/.");
    expect(SAVED_LINE).toBe("Saved a snapshot."); // the step goes on with how to put everything back: ⌘Z or Undo
    expect(SHOWN_ROWS).toBe(6);
  });

  it("no line says I, shouts, or runs three dots together", () => {
    for (const line of [...everyRow.map(rowLine), KEPT_LINE, SAVED_LINE]) {
      expect(line, line).not.toMatch(/\bI\b/);
      expect(line, line).not.toContain("!");
      expect(line, line).not.toContain("...");
      expect(line, line).toMatch(/^\p{Lu}/u); // sentence case
    }
  });

  it("a row has no closing period, and a proof line is a sentence", () => {
    for (const line of everyRow.map(rowLine)) expect(line, line).not.toMatch(/\.$/);
    for (const line of [KEPT_LINE, SAVED_LINE]) expect(line, line).toMatch(/\.$/);
  });
});

describe("filingLine: the capsule's filing card's one line of what is going on", () => {
  const now = 1_000_000;
  const read: NarrationRow = { kind: "read", path: "index.md", title: "index", shelf: "" };
  const made: NarrationRow = { kind: "new", path: "ideas/podcast.md", title: "Indie game dev podcast", shelf: "ideas" };
  const WAITING = "Waiting for another Avanzel run to finish…";
  /** A filing as the capsule is sent it: `over` changes some of it. */
  const filing = (over: Partial<Parameters<typeof filingLine>[0]> = {}) => ({ agent: "Claude Code", rows: [], stepAt: now, ...over });

  it("is the agent's newest step, in the words of a row", () => {
    expect(filingLine(filing({ rows: [read] }), now)).toBe("Reading your library index");
    expect(filingLine(filing({ rows: [read, made] }), now)).toBe("New idea note: Indie game dev podcast");
  });

  it("is nothing before the first step, while the agent has not been quiet long", () => {
    expect(filingLine(filing(), now)).toBeNull();
    expect(filingLine(filing({ stepAt: now - (STILL_WORKING_MS - 1) }), now)).toBeNull();
  });

  it("says the agent is still working once eight seconds pass with no step, at the eighth exactly", () => {
    expect(STILL_WORKING_MS).toBe(8_000);
    expect(filingLine(filing({ stepAt: now - STILL_WORKING_MS }), now)).toBe("Claude Code is still working…");
    expect(filingLine(filing({ stepAt: now - 60_000 }), now)).toBe("Claude Code is still working…");
    expect(filingLine(filing({ agent: "Codex", stepAt: now - 9_000 }), now)).toBe("Codex is still working…");
  });

  it("puts the quiet before the newest step: a step long ago is no news", () => {
    expect(filingLine(filing({ rows: [read, made], stepAt: now - 9_000 }), now)).toBe("Claude Code is still working…");
    expect(filingLine(filing({ rows: [read, made], stepAt: now - 7_999 }), now)).toBe("New idea note: Indie game dev podcast");
  });

  it("is taken back by a step, even one that adds no row: the quiet is measured from the newest step of any kind", () => {
    const quiet = filing({ rows: [read], stepAt: now - 9_000 });
    expect(filingLine(quiet, now)).toBe("Claude Code is still working…");
    expect(filingLine({ ...quiet, stepAt: now }, now)).toBe("Reading your library index");
  });

  it("says the run waits for another before anything else, however quiet it has been and whatever steps it has", () => {
    expect(filingLine(filing({ waiting: true }), now)).toBe(WAITING);
    expect(filingLine(filing({ waiting: true, stepAt: now - 60_000 }), now)).toBe(WAITING);
    expect(filingLine(filing({ waiting: true, rows: [read, made], stepAt: now - 9_000 }), now)).toBe(WAITING);
    expect(filingLine(filing({ waiting: false, rows: [read] }), now)).toBe("Reading your library index");
  });

  it("is written as the design rules ask: sentence case, the one-character ellipsis, no “!”, they and them for no one", () => {
    for (const line of [filingLine(filing({ waiting: true }), now), filingLine(filing({ stepAt: now - 9_000 }), now), filingLine(filing({ rows: [made] }), now)]) {
      expect(line).toMatch(/^\p{Lu}/u);
      expect(line).not.toContain("!");
      expect(line).not.toContain("...");
    }
  });
});

describe("the tabs' count while the filing runs", () => {
  const shelves = ["goals", "ideas", "problems", "memories", "people", "topics"];
  /** What a shelf's tab counts while the filing runs (Filing.tsx): the written pages whose first folder is the shelf. */
  const onShelf = (written: readonly string[], shelf: string) => written.filter((path) => path.startsWith(`${shelf}/`)).length;

  it("is what the tabs will count once the filing is filed", () => {
    // One filing, as its steps and as its outcome: the pages main lists as written while it runs, the pages once it is done.
    const steps: FilingStep[] = [
      { kind: "read", path: "index.md" },
      { kind: "read", path: "people/mark.md" },
      { kind: "wrote", path: "ideas/a.md", created: true },
      { kind: "wrote", path: "ideas/a.md", created: false }, // the page it just made, written again
      { kind: "wrote", path: "ideas/b.md", created: true },
      { kind: "wrote", path: "people/mark.md", created: false },
      { kind: "wrote", path: "goals/draft.md", created: true },
      { kind: "deleted", path: "goals/draft.md" }, // a page it made and then removed: the folder shows nothing of it
      { kind: "wrote", path: "topics/budget.pdf", created: true }, // a file that is no page
      { kind: "wrote", path: "projects/launch.md", created: true }, // a folder that is no shelf
      { kind: "wrote", path: "topics/deep/er/p.md", created: true }, // a folder inside a shelf
      { kind: "wrote", path: "index.md", created: false },
      { kind: "wrote", path: "log.md", created: false },
    ];
    const written = steps.reduce<string[]>((kept, step) => withWritten(kept, step), []);
    const removed = new Set(steps.flatMap((step) => (step.kind === "deleted" ? [step.path] : [])));
    const writes = steps.flatMap((step) => (step.kind === "wrote" && !removed.has(step.path) ? [step] : []));
    const created = [...new Set(writes.filter((step) => step.created).map((step) => step.path))];
    const modified = [...new Set(writes.filter((step) => !step.created && !created.includes(step.path)).map((step) => step.path))];
    // filedPages reads titles from a library that isn't there, and keeps the file name: only the paths matter here.
    const filed = filedPages("/no/such/library", { created, modified });
    for (const shelf of shelves) {
      expect(onShelf(written, shelf), shelf).toBe(filed.filter((p) => p.shelf === shelf).length);
    }
    expect(onShelf(written, "ideas")).toBe(2);
    expect(onShelf(written, "people")).toBe(1);
    expect(onShelf(written, "topics")).toBe(1);
    expect(onShelf(written, "goals")).toBe(0);
  });
});
