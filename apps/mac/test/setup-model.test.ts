import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Changes, loadSettings, saveSettings, Vault } from "@avanzel/engine";
import {
  afterStop,
  answerSources,
  bestAgent,
  flightTarget,
  libraryAgent,
  libraryFolder,
  looksLikeATest,
  suggestQuestion,
  suggestQuestions,
  tildePath,
  tooBroad,
  unrecordedEdits,
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

  it("tooBroad sees through ~, links and aliases of the startup disk to the place on disk", () => {
    // A home of its own, under the system's temporary folder: /var/folders/…, which is /private/var/folders/… on disk.
    const home = tmp();
    mkdirSync(path.join(home, "Documents"));
    const links = tmp();
    const docs = path.join(links, "docs");
    symlinkSync(path.join(home, "Documents"), docs); // a link to the home folder's Documents
    const disk = path.join(links, "Macintosh HD");
    symlinkSync("/", disk); // an alias of the startup disk, as /Volumes/Macintosh HD is
    const real = realpathSync(home);
    const broad = ["~", "~/", "~/Documents", "~/documents", docs, `${docs}/`, disk, path.join(disk, real), path.join(disk, real, "Documents"), path.join(real, "Documents")];
    expect(broad.filter((place) => !tooBroad(place, home))).toEqual([]);
    // A folder inside is a library's place like any other: made yet or not, and reached by a link or not.
    mkdirSync(path.join(home, "Notes"));
    const fine = ["~/Avanzel", "~/Notes", path.join(docs, "Avanzel"), path.join(home, "Documents", "Avanzel"), path.join(disk, real, "Avanzel")];
    expect(fine.filter((place) => tooBroad(place, home))).toEqual([]);
  });

  it("tooBroad says why: one of the system's own folders, or a place that holds far more than notes", () => {
    const home = "/Users/a";
    // macOS's and Unix's own folders, and the startup disk's root: nothing can be made there, or it isn't kept.
    for (const place of ["/Applications", "/Library", "/System", "/Users", "/Users/Shared", "/usr", "/bin", "/etc", "/var", "/tmp", "/private", "/cores", "/"]) {
      expect(tooBroad(place, home), place).toBe("system");
    }
    // The home folder, the folders macOS makes in it, /Volumes and another disk: a folder inside will do.
    for (const place of ["/Users/a", "/Users/a/Documents", "/Users/a/Library", "/Users/a/Applications", "/Volumes", "/Volumes/Backup"]) {
      expect(tooBroad(place, home), place).toBe("broad");
    }
    for (const place of ["/Users/a/Avanzel", "/Applications/Avanzel", "/Volumes/Backup/Avanzel"]) expect(tooBroad(place, home), place).toBeNull();
  });

  it("tooBroad refuses the folders macOS and Unix keep for themselves, each as a folder", () => {
    const home = "/Users/a";
    const system = ["/Applications", "/Library", "/System", "/Users", "/Users/Shared", "/private", "/usr", "/opt", "/bin", "/sbin", "/etc",
      "/var", "/tmp", "/cores"];
    expect(system.filter((place) => !tooBroad(place, home))).toEqual([]);
    expect(system.filter((place) => !tooBroad(`${place}/`, home))).toEqual([]);
    expect(system.filter((place) => !tooBroad(place.toLowerCase(), home))).toEqual([]); // names whatever their case
    expect(system.filter((place) => !tooBroad(place.replace(/^\/(.)/, (_, first: string) => `/${first.toUpperCase()}`), home))).toEqual([]);
    // Not by name prefix, nor by what lies inside: a folder in one of them is a library's place like any other, and so is one
    // whose name only starts like theirs.
    const fine = ["/Applications/Avanzel", "/Library/Avanzel", "/Users/Shared/Avanzel", "/usr/local/Avanzel", "/opt/Avanzel",
      "/private/tmp/Avanzel", "/tmp/Avanzel", "/var/Avanzel", "/Users/ab", "/Applications2", "/Libraryx", "/System2/Avanzel", "/usr2", "/optional"];
    expect(fine.filter((place) => tooBroad(place, home))).toEqual([]);
  });

  it.runIf(existsSync("/private/tmp") && existsSync("/private/var"))("tooBroad compares the system's folders as they are on disk: /tmp is /private/tmp and /var is /private/var", () => {
    const home = tmp();
    expect(realpathSync("/tmp")).toBe("/private/tmp");
    for (const place of ["/tmp", "/private/tmp", "/var", "/private/var", "/etc", "/private/etc"]) expect(tooBroad(place, home), place).toBe("system");
    // The system's temporary folder is where this test made `home` (/var/folders/…/T/…): a place like any other.
    expect(tooBroad(home, "/Users/a")).toBeNull();
    expect(tooBroad(path.join(home, "Avanzel"), "/Users/a")).toBeNull();
  });

  it.runIf(existsSync("/System/Volumes/Data"))("tooBroad takes a folder on the data volume for the one at the root: exactly when that one is refused", () => {
    const home = "/Users/a";
    const data = "/System/Volumes/Data";
    // The system's own folders, reached through the data volume.
    for (const place of ["/Applications", "/Library", "/Users", "/Users/Shared", "/private/tmp", "/opt", "/"]) {
      expect(tooBroad(path.join(data, place), home), place).toBe("system");
    }
    // The home folder and the folders macOS makes in it: /System/Volumes/Data/Users/<me> is the home folder, whatever its case.
    for (const place of ["/Users/a", "/Users/a/", "/Users/a/Documents", "/Users/a/documents", "/Users/a/Library", "/Users/a/Applications"]) {
      expect(tooBroad(path.join(data, place), home), place).toBe("broad");
    }
    // A folder in them is a place like any other, as it is at the root.
    for (const place of ["/Applications/Avanzel", "/Users/a/Avanzel", "/Users/a/Library-notes", "/Users/a/Applications/notes", "/Users/ab", "/Users/ab/Documents"]) {
      expect(tooBroad(path.join(data, place), home), place).toBeNull();
    }
    // The home folder of the person running this, found there too.
    const mine = realpathSync(homedir());
    expect(tooBroad(path.join(data, mine), homedir())).toBe("broad");
    expect(tooBroad(path.join(data, mine, "Documents"), homedir())).toBe("broad");
    expect(tooBroad(path.join(data, mine, "Avanzel"), homedir())).toBeNull();
  });

  it("tooBroad doesn't refuse ~/Library-notes or ~/Applications/notes, whose names only resemble a folder macOS makes", () => {
    const home = tmp();
    expect(["~/Library-notes", "~/Applications/notes", "~/Documents2", "~/Documents/Avanzel", "~/Library/Avanzel"].filter((place) => tooBroad(place, home))).toEqual([]);
    expect(["~/Library", "~/Applications", "~/Documents"].filter((place) => !tooBroad(place, home))).toEqual([]);
  });

  it.runIf(existsSync("/Volumes/Macintosh HD"))("tooBroad knows this Mac's /Volumes/Macintosh HD is its startup disk", () => {
    const home = tmp();
    expect(tooBroad("/Volumes/Macintosh HD", home)).toBe("system"); // the startup disk's root
    expect(tooBroad(path.join("/Volumes/Macintosh HD", realpathSync(home), "Documents"), home)).toBe("broad");
    expect(tooBroad(path.join("/Volumes/Macintosh HD", realpathSync(home), "Avanzel"), home)).toBeNull();
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

  it("unrecordedEdits counts the files a stopped run changed that no commit holds", () => {
    const changes = new Changes(["goals/half.md", "ideas/new.md"], ["index.md"], ["log.md"]);
    expect(unrecordedEdits({ commit: null, changes })).toBe(4); // no git, or automatic commits off: nothing can take them back
    expect(unrecordedEdits({ commit: null, changes: new Changes([], [], []) })).toBe(0); // it changed nothing
    expect(unrecordedEdits({ commit: "9f2c1d0e", changes })).toBe(0); // a commit holds them: taking it back is `partial`'s
    expect(unrecordedEdits(undefined)).toBe(0); // Cancel came before the run had its turn
  });

  it("afterStop lets a filing that finished with no commit to take back stand, and takes everything else back", () => {
    // Stop came after the agent had finished, before the result was shown. Nothing records such a filing (no git, or automatic
    // commits off), so there is nothing to take back: the capture is archived and the pages are written, and it is filed.
    expect(afterStop({ ok: true, commit: null })).toBe("filed");
    expect(afterStop({ ok: true, commit: "9f2c1d0e" })).toBe("take-back"); // a commit holds it: taking it back puts the words in the inbox
    expect(afterStop({ ok: false, commit: null })).toBe("take-back"); // the run was stopped, or failed on its own: it filed nothing
    expect(afterStop({ ok: false, commit: "9f2c1d0e" })).toBe("take-back"); // ... leaving a commit of its leftovers
    expect(afterStop(undefined)).toBe("take-back"); // no run: Stop came before its turn, or the lock wait ended with the run stopped
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
    expect(suggestQuestion([page("projects", "Launch plan")])).toBe("What did I say about “Launch plan”?"); // off the shelves too
    expect(suggestQuestion([])).toBeNull();
  });

  it("suggestQuestions asks one question about each page, in their order", () => {
    expect(suggestQuestions([page("ideas", "Plant tulips in October"), page("people", "Maya"), page("projects", "Launch plan")])).toEqual([
      "What did I say about “Plant tulips in October”?",
      "What am I doing with Maya?",
      "What did I say about “Launch plan”?",
    ]);
  });

  it("suggestQuestions asks each question once, and none without pages", () => {
    // Two pages of one title (the second named maya-2 by the filing) ask one question.
    const maya = (file: string): FiledPage => ({ title: "Maya", shelf: "people", path: `people/${file}.md` });
    expect(suggestQuestions([maya("maya"), maya("maya-2")])).toEqual(["What am I doing with Maya?"]);
    expect(suggestQuestions([])).toEqual([]);
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
