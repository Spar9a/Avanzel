// How the librarian walks the library around a run, and in what order: a filing takes one snapshot before the run and one
// right after it, then the watch of the folder (of an agent that doesn't report its own steps) stops with that second
// snapshot, and only then does the guard put anything back. The outcome's changes are read from the second snapshot too,
// so the watch doesn't take one of its own. Staged by recording the calls of `snapshot`, of the watch's stop and of the
// guard, which are wrapped, not replaced.
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../src/core/changes.ts";
import { defaultSettings } from "../../src/core/config.ts";
import { Librarian } from "../../src/core/librarian.ts";
import type { FilingStep } from "../../src/core/steps.ts";
import { Vault } from "../../src/core/vault.ts";
import { FAKE_AGENT, NOW, binScripts } from "./helpers.ts";
import { fakeSettings, only, tmp } from "./librarian-fixtures.ts";

const calls = vi.hoisted(() => ({
  /** What the librarian did, as far as these tests care: "snapshot", "stop" (of the watch) and "guard", in order. */
  order: [] as string[],
  /** How many snapshots have been taken, and which one (counting from 1) fails; 0 for none. */
  snapshots: 0,
  failAt: 0,
}));

vi.mock("../../src/core/changes.ts", async (importOriginal) => {
  const changes = await importOriginal<typeof import("../../src/core/changes.ts")>();
  return {
    ...changes,
    snapshot: vi.fn((root: string) => {
      calls.order.push("snapshot");
      calls.snapshots += 1;
      if (calls.snapshots === calls.failAt) throw new Error("the disk failed");
      return changes.snapshot(root);
    }),
  };
});

vi.mock("../../src/core/guard.ts", async (importOriginal) => {
  const guard = await importOriginal<typeof import("../../src/core/guard.ts")>();
  return {
    ...guard,
    undoProtected: vi.fn((...args: Parameters<typeof guard.undoProtected>) => {
      calls.order.push("guard");
      return guard.undoProtected(...args);
    }),
  };
});

vi.mock("../../src/core/watch.ts", async (importOriginal) => {
  const watch = await importOriginal<typeof import("../../src/core/watch.ts")>();
  return {
    ...watch,
    watchWrites: vi.fn((...args: Parameters<typeof watch.watchWrites>) => {
      const stop = watch.watchWrites(...args);
      return (after?: Snapshot) => {
        calls.order.push("stop");
        stop(after);
      };
    }),
  };
});

let vault: Vault;
let librarian: Librarian;

beforeEach(async () => {
  calls.order.length = 0;
  calls.snapshots = 0;
  calls.failAt = 0;
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
  librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
});

/** What `run` gives, and what the librarian did while it ran, in order. */
async function recorded<T>(run: () => Promise<T>): Promise<{ value: T; order: string[] }> {
  calls.order.length = 0;
  const value = await run();
  return { value, order: [...calls.order] };
}

describe("the snapshots of a run", () => {
  it("a filing takes one after the run, which the watch of the folder stops with, before the guard", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const steps: FilingStep[] = [];
    const { value: outcome, order } = await recorded(() =>
      only(librarian.file(null, { steps: (step) => void steps.push(step) })),
    );
    // Before the run, right after it, the watch's stop, the guard: and the stop takes no snapshot of its own.
    expect(order).toEqual(["snapshot", "snapshot", "stop", "guard"]);
    expect(outcome).toMatchObject({ ok: true, changes: { pages: [`ideas/idea-${capture.id}.md`] } });
    // The watch told what the snapshot says, as it did when it took one of its own.
    expect(steps).toHaveLength(3);
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
    expect(steps).toContainEqual({ kind: "wrote", path: "index.md", created: false });
    expect(steps).toContainEqual({ kind: "wrote", path: "log.md", created: false });
  });

  it("a filing that is not narrated takes the same two, and no watch is stopped", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { value: outcome, order } = await recorded(() => only(librarian.file()));
    expect(order).toEqual(["snapshot", "snapshot", "guard"]);
    expect(outcome).toMatchObject({ ok: true, changes: { created: [`ideas/idea-${capture.id}.md`], modified: ["index.md", "log.md"] } });
  });

  it("a Claude Code filing, which tells its own steps, takes the same two", async () => {
    // A stand-in `claude`, and nothing else, on PATH runs the fake agent, which prints what Claude Code prints.
    vi.stubEnv("PATH", binScripts(tmp(), { claude: `exec '${process.execPath}' '${FAKE_AGENT}' "$2"` }));
    vi.stubEnv("FAKE_AGENT_STREAM", "claude");
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "claude", timeoutSeconds: 30 }, { clock: () => NOW });
    const capture = librarian.captureText("Build a tiny greenhouse");
    const steps: FilingStep[] = [];
    const { value: outcome, order } = await recorded(() =>
      only(librarian.file(null, { steps: (step) => void steps.push(step) })),
    );
    expect(order).toEqual(["snapshot", "snapshot", "guard"]);
    expect(outcome).toMatchObject({ ok: true, changes: { created: [`ideas/idea-${capture.id}.md`], modified: ["index.md", "log.md"] } });
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
  });

  it("an ask and a review take their own two: before the run, and after the guard", async () => {
    expect((await recorded(() => librarian.ask("What are my goals?"))).order).toEqual(["snapshot", "guard", "snapshot"]);
    expect((await recorded(() => librarian.review())).order).toEqual(["snapshot", "guard", "snapshot"]);
  });

  it("a snapshot that fails after the run still stops the watch, and the guard still runs", async () => {
    librarian.captureText("Build a tiny greenhouse");
    calls.failAt = 2; // the one right after the run
    const { value: outcome, order } = await recorded(() => only(librarian.file(null, { steps: () => {} })));
    expect(outcome).toMatchObject({ ok: false, error: "the disk failed" });
    expect(order.slice(0, 3)).toEqual(["snapshot", "snapshot", "stop"]); // the stop has no snapshot to be given
    expect(order.at(-1)).toBe("guard");
  });
});
