import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings, Vault } from "@avanzel/engine";
import {
  answerSources,
  bestAgent,
  flightTarget,
  libraryAgent,
  libraryFolder,
  looksLikeATest,
  suggestQuestion,
  tildePath,
  tooBroad,
  upHerePlace,
} from "../src/main/setup-model.ts";
import { agentWorks, type AgentStatus, type FiledPage, type SetupAgent } from "../src/shared/ipc.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-setup-"));

/** A page a filing wrote: `title` on `shelf`, or in another folder such as projects. */
const page = (shelf: string, title: string): FiledPage => ({ title, shelf, path: `${shelf}/${title.toLowerCase().replaceAll(" ", "-")}.md` });

/** An installed agent as setup lists it, with what its check found. */
const agent = (name: string, status: AgentStatus | null): SetupAgent => ({ name, label: name, freeCheck: true, status });
const signedIn: AgentStatus = { kind: "signed-in", seconds: 0.4 };
const signedOut: AgentStatus = { kind: "signed-out", detail: "" };
const checking: AgentStatus = { kind: "checking" };
const replied: AgentStatus = { kind: "replied", seconds: 1.6 };

describe("setup model", () => {
  it("tildePath shortens only the home folder itself", () => {
    expect(tildePath("/Users/a/Avanzel", "/Users/a")).toBe("~/Avanzel");
    expect(tildePath("/Users/ab/x", "/Users/a")).toBe("/Users/ab/x");
    expect(tildePath("/Volumes/x", "/Users/a")).toBe("/Volumes/x");
    expect(tildePath("/Users/a", "/Users/a")).toBe("~");
  });

  it("tooBroad refuses the home folder, the folders macOS makes in it, and the roots of disks", () => {
    const home = "/Users/a";
    const broad = ["/Users/a", "/Users/a/", "/Users/a/Documents", "/Users/a/Desktop", "/Users/a/Downloads", "/Users/a/Library",
      "/Users/a/Movies", "/Users/a/Music", "/Users/a/Pictures", "/Users/a/Public", "/Users/a/Applications", "/Users/a/documents",
      "/", "/Volumes", "/Volumes/Backup", "/Volumes/Backup/"];
    expect(broad.filter((place) => !tooBroad(place, home))).toEqual([]);
    const fine = ["/Users/a/Avanzel", "/Users/a/Documents/Avanzel", "/Users/a/Notes", "/Users/a/Documents/../Avanzel",
      "/Volumes/Backup/Avanzel", "/Users/ab", "/Users/ab/Documents", "/Users/a/Library/Mobile Documents/Avanzel"];
    expect(fine.filter((place) => tooBroad(place, home))).toEqual([]);
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

  it("libraryAgent reads the agent a library files with, and nothing from a config that doesn't load", async () => {
    const library = tmp();
    await Vault.init(library, { git: false });
    expect(libraryAgent(library)).toBe("auto");
    saveSettings(library, { ...loadSettings(library), harness: "codex" });
    expect(libraryAgent(library)).toBe("codex");
    writeFileSync(path.join(library, ".avanzel", "config.toml"), "harness = [\n");
    expect(libraryAgent(library)).toBeNull();
  });

  it("looksLikeATest knows a mic check from a thought", () => {
    const checks = ["Testing, testing.", "Test test one two three", "Hello?", "Can you hear me?", "Is this on?"];
    expect(checks.map(looksLikeATest)).toEqual([true, true, true, true, true]);
    const thoughts = ["Testing the podcast idea with Mark", "Hello, I want to run a marathon in spring", ""];
    expect(thoughts.map(looksLikeATest)).toEqual([false, false, false]);
  });

  it("looksLikeATest knows a mic check said with numbers, and stops at eight words", () => {
    const checks = ["Testing 1 2 3", "Testing, testing, 123.", "Is this thing on?", "Can you hear me now?"];
    expect(checks.map(looksLikeATest)).toEqual([true, true, true, true]);
    expect(looksLikeATest("One two three, one two three, one two.")).toBe(true); // eight words
    expect(looksLikeATest("One two three, one two three, one two three.")).toBe(false); // nine
  });
});

describe("the question setup suggests (Review Focus 5)", () => {
  it("suggestQuestion asks about a person first", () => {
    expect(suggestQuestion([page("ideas", "Indie game dev podcast"), page("people", "Mark")])).toBe("What am I doing with Mark?");
  });

  it("suggestQuestion falls back to the first page", () => {
    expect(suggestQuestion([page("projects", "Launch plan")])).toBe("What did I say about Launch plan?"); // off the shelves too
    expect(suggestQuestion([])).toBeNull();
  });
});

describe("answerSources", () => {
  it("answerSources turns links into words and keeps their names", () => {
    expect(answerSources("You want [[Mark]] to co-host [[indie-game-dev-podcast|your podcast]].\n\n**Next:** fix the hum. [[Mark]]")).toEqual({
      paragraphs: ["You want Mark to co-host your podcast.", "Next: fix the hum. Mark"],
      names: ["Mark", "indie-game-dev-podcast"],
    });
  });

  it("answerSources reads a link to a heading by its label or its page, and drops Markdown's heading marks", () => {
    expect(answerSources("## The plan\n  See [[run-a-marathon#Training|the training plan]] and [[mark#Notes]].  \n#\n** **")).toEqual({
      paragraphs: ["The plan", "See the training plan and mark."],
      names: ["run-a-marathon", "mark"],
    });
  });
});

describe("agentWorks", () => {
  it("an agent works once its check says it is signed in, or it replied", () => {
    const statuses: (AgentStatus | null)[] = [signedIn, replied, signedOut, checking, { kind: "timeout" }, { kind: "failed", detail: "" }, null];
    expect(statuses.map(agentWorks)).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("bestAgent", () => {
  it("Claude Code first when it works", () => {
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedIn)])).toBe("claude");
    expect(bestAgent([agent("codex", signedIn), agent("claude", replied)])).toBe("claude"); // wherever it is listed
  });

  it("else the first that works", () => {
    expect(bestAgent([agent("claude", signedOut), agent("codex", signedIn)])).toBe("codex");
    expect(bestAgent([agent("claude", checking), agent("codex", replied)])).toBe("codex");
    expect(bestAgent([agent("claude", { kind: "timeout" }), agent("opencode", replied), agent("codex", signedIn)])).toBe("opencode");
  });

  it("when none works, the agent whose problem the person can fix, Claude Code first, so Found says how at once", () => {
    const failed: AgentStatus = { kind: "failed", detail: "Error: boom" };
    expect(bestAgent([agent("claude", signedOut), agent("codex", failed)])).toBe("claude");
    expect(bestAgent([agent("codex", signedOut), agent("claude", { kind: "timeout" })])).toBe("claude"); // wherever it is listed
    expect(bestAgent([agent("claude", failed)])).toBe("claude");
    expect(bestAgent([agent("opencode", failed), agent("codex", signedOut)])).toBe("opencode"); // else the first
    expect(bestAgent([agent("claude", signedOut), agent("codex", signedOut)], "codex")).toBe("codex"); // a library's own first
  });

  it("never an agent whose check hasn't said: none while a check is under way, and none without a problem to show", () => {
    expect(bestAgent([agent("claude", null), agent("codex", signedOut)])).toBe("codex"); // Claude Code's sign-in couldn't be read
    expect(bestAgent([agent("claude", checking), agent("codex", signedOut)])).toBeNull(); // until Claude Code's check ends
    expect(bestAgent([agent("claude", null), agent("codex", checking), agent("opencode", signedOut)])).toBeNull();
    expect(bestAgent([agent("claude", null), agent("opencode", null)])).toBeNull();
    expect(bestAgent([])).toBeNull();
  });

  it("a library's own agent first when it works, so a library brought from another Mac keeps it", () => {
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedIn)], "codex")).toBe("codex");
    expect(bestAgent([agent("claude", signedIn), agent("opencode", replied)], "opencode")).toBe("opencode");
  });

  it("else the best one: the library's agent doesn't work here, isn't known to yet, isn't installed, or is Automatic", () => {
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedOut)], "codex")).toBe("claude");
    expect(bestAgent([agent("claude", signedIn), agent("codex", checking)], "codex")).toBe("claude");
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedIn)], "gemini")).toBe("claude");
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedIn)], "auto")).toBe("claude");
    expect(bestAgent([agent("codex", signedIn)], null)).toBe("codex");
  });
});

describe("the flight into the menu bar", () => {
  it("flightTarget centres a 24 px square on the icon, and has none without one", () => {
    expect(flightTarget({ x: 1000, y: 2, width: 30, height: 22 })).toEqual({ x: 1003, y: 1, width: 24, height: 24 });
    expect(flightTarget({ x: 0, y: 0, width: 0, height: 0 })).toBeNull(); // macOS isn't showing the icon
  });

  it("upHerePlace puts the tail under the icon and keeps the bubble on the display", () => {
    const work = { x: 0, y: 25, width: 1440, height: 875 };
    const size = { width: 320, height: 200 };
    expect(upHerePlace({ x: 1000, y: 0, width: 24, height: 24 }, work, size)).toEqual({ x: 734, y: 25 });
    // An icon near the display's right edge: the window stays on the display, its tail no longer under the icon.
    expect(upHerePlace({ x: 1420, y: 0, width: 20, height: 24 }, work, size).x).toBe(1120);
  });
});
