import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { FilingStep } from "@avanzel/engine";
import { filedPages } from "../src/main/library-info.ts";
import { withStep } from "../src/main/narration.ts";
import { KEPT_LINE, pagesWritten, rowLine, SAVED_LINE, SHOWN_ROWS } from "../src/renderer/common/narration.ts";
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
    expect(rowLine(row("read", "people/mark.md", "Mark"))).toBe("Reading Mark's page");
    expect(rowLine(row("read", "people/team/ana.md", "Ana"))).toBe("Reading Ana's page"); // a folder inside the shelf is still people/
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

  it("a new page on a shelf is a page of that shelf's kind, each shelf with its own noun", () => {
    const shelves = ["goals", "ideas", "problems", "memories", "people", "topics"];
    expect(shelves.map((shelf) => rowLine(row("new", `${shelf}/p.md`, "Indie game dev podcast")))).toEqual([
      "New goal page: Indie game dev podcast",
      "New idea page: Indie game dev podcast",
      "New problem page: Indie game dev podcast",
      "New memory page: Indie game dev podcast",
      "New person page: Indie game dev podcast",
      "New topic page: Indie game dev podcast",
    ]);
    // The first folder of the path is the shelf: a deeper page is on it too.
    expect(rowLine(row("new", "topics/deep/er/p.md", "Deep"))).toBe("New topic page: Deep");
  });

  it("a new page anywhere else is only a page", () => {
    expect(rowLine(row("new", "projects/launch.md", "Launch"))).toBe("New page: Launch");
    expect(rowLine(row("new", "notes.md", "Notes"))).toBe("New page: Notes"); // at the root
    // A folder is a shelf by its exact name only, and never by a name every object has.
    expect(rowLine(row("new", "idea/p.md", "P"))).toBe("New page: P");
    expect(rowLine(row("new", "Ideas/p.md", "P"))).toBe("New page: P");
    expect(rowLine(row("new", "constructor/p.md", "P"))).toBe("New page: P");
    expect(rowLine(row("new", "toString/p.md", "P"))).toBe("New page: P");
  });

  it("an updated page says which", () => {
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
    expect(rowLine(row("new", "ideas/log.md", "Idea log"))).toBe("New idea page: Idea log");
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
      "Reading Mark's page",
      "New idea page: Call the vet on Monday",
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
    expect(SAVED_LINE).toBe("Saved a snapshot you can undo.");
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

describe("pagesWritten", () => {
  it("counts the pages written on a shelf, the new and the updated, not the ones only read", () => {
    const rows = [
      row("read", "ideas/seen.md", "Seen"),
      row("new", "ideas/a.md", "A"),
      row("updated", "ideas/b.md", "B"),
      row("new", "people/mark.md", "Mark"),
    ];
    expect(pagesWritten(rows, "ideas")).toBe(2);
    expect(pagesWritten(rows, "people")).toBe(1);
    expect(pagesWritten(rows, "goals")).toBe(0);
    expect(pagesWritten([], "ideas")).toBe(0);
  });

  it("counts a path once, however many rows name it", () => {
    const rows = [row("updated", "ideas/a.md", "A"), row("new", "ideas/a.md", "A"), row("new", "ideas/b.md", "B")];
    expect(pagesWritten(rows, "ideas")).toBe(2);
  });

  it("counts a search, a removal, a root file, another folder and a file that is no page for no tab", () => {
    const rows = [
      search,
      row("removed", "goals/old.md", "old"),
      row("updated", "index.md", "index"),
      row("new", "projects/launch.md", "Launch"),
      row("new", "topics/data.json", "data.json"),
      row("updated", "topics/budget.pdf", "budget.pdf"),
    ];
    for (const shelf of ["goals", "ideas", "problems", "memories", "people", "topics"]) expect(pagesWritten(rows, shelf), shelf).toBe(0);
  });

  it("counts a page in a folder inside the shelf for the shelf", () => {
    expect(pagesWritten([row("new", "topics/deep/er/p.md", "P")], "topics")).toBe(1);
  });

  it("is what the tabs will count once the filing is filed", () => {
    // One filing, as its steps and as its outcome: the rows while it runs, the pages once it is done.
    const steps: FilingStep[] = [
      { kind: "read", path: "index.md" },
      { kind: "read", path: "people/mark.md" },
      { kind: "wrote", path: "ideas/a.md", created: true },
      { kind: "wrote", path: "ideas/a.md", created: false }, // the page it just made, written again
      { kind: "wrote", path: "ideas/b.md", created: true },
      { kind: "wrote", path: "people/mark.md", created: false },
      { kind: "wrote", path: "topics/budget.pdf", created: true }, // a file that is no page
      { kind: "wrote", path: "projects/launch.md", created: true }, // a folder that is no shelf
      { kind: "wrote", path: "index.md", created: false },
      { kind: "wrote", path: "log.md", created: false },
    ];
    const page = (rel: string): FiledPage => ({ title: posix.basename(rel, ".md"), shelf: rel.split("/")[0] ?? "", path: rel });
    const rows = steps.reduce<NarrationRow[]>((kept, step) => withStep(kept, step, page), []);
    const written = steps.flatMap((step) => (step.kind === "wrote" ? [step] : []));
    const created = [...new Set(written.filter((step) => step.created).map((step) => step.path))];
    const modified = [...new Set(written.filter((step) => !step.created && !created.includes(step.path)).map((step) => step.path))];
    // filedPages reads titles from a library that isn't there, and keeps the file name: only the paths matter here.
    const filed = filedPages("/no/such/library", { created, modified });
    for (const shelf of ["goals", "ideas", "problems", "memories", "people", "topics"]) {
      expect(pagesWritten(rows, shelf), shelf).toBe(filed.filter((p) => p.shelf === shelf).length);
    }
    expect(pagesWritten(rows, "ideas")).toBe(2);
    expect(pagesWritten(rows, "people")).toBe(1);
    expect(pagesWritten(rows, "topics")).toBe(0);
  });
});
