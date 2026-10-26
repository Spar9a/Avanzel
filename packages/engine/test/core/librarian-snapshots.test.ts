// How often the librarian walks the library: a filing takes one snapshot before the run and one right after it. The folder
// watch of an agent that doesn't report its own steps ends with that second snapshot, and the outcome's changes are read
// from it, so the watch doesn't take one of its own. Staged by counting the calls of `snapshot`, which is wrapped, not
// replaced.
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot } from "../../src/core/changes.ts";
import { defaultSettings } from "../../src/core/config.ts";
import { Librarian } from "../../src/core/librarian.ts";
import type { FilingStep } from "../../src/core/steps.ts";
import { Vault } from "../../src/core/vault.ts";
import { FAKE_AGENT, NOW, binScripts } from "./helpers.ts";
import { fakeSettings, only, tmp } from "./librarian-fixtures.ts";

vi.mock("../../src/core/changes.ts", async (importOriginal) => {
  const changes = await importOriginal<typeof import("../../src/core/changes.ts")>();
  return { ...changes, snapshot: vi.fn(changes.snapshot) };
});

let vault: Vault;
let librarian: Librarian;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
  librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
});

/** What `run` gives, and how many snapshots it took to get it. */
async function counting<T>(run: () => Promise<T>): Promise<{ value: T; taken: number }> {
  vi.mocked(snapshot).mockClear();
  const value = await run();
  return { value, taken: vi.mocked(snapshot).mock.calls.length };
}

describe("the snapshots of a run", () => {
  it("a filing takes one after the run, which the watch of the folder and the changes share", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const steps: FilingStep[] = [];
    const { value: outcome, taken } = await counting(() =>
      only(librarian.file(null, { steps: (step) => void steps.push(step) })),
    );
    expect(taken).toBe(2); // before the run, and right after it
    expect(outcome).toMatchObject({ ok: true, changes: { pages: [`ideas/idea-${capture.id}.md`] } });
    // The watch told what the snapshot says, as it did when it took one of its own.
    expect(steps).toHaveLength(3);
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
    expect(steps).toContainEqual({ kind: "wrote", path: "index.md", created: false });
    expect(steps).toContainEqual({ kind: "wrote", path: "log.md", created: false });
  });

  it("a filing that is not narrated takes the same two", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const { value: outcome, taken } = await counting(() => only(librarian.file()));
    expect(taken).toBe(2);
    expect(outcome).toMatchObject({ ok: true, changes: { created: [`ideas/idea-${capture.id}.md`], modified: ["index.md", "log.md"] } });
  });

  it("a Claude Code filing, which tells its own steps, takes the same two", async () => {
    // A stand-in `claude`, and nothing else, on PATH runs the fake agent, which prints what Claude Code prints.
    vi.stubEnv("PATH", binScripts(tmp(), { claude: `exec '${process.execPath}' '${FAKE_AGENT}' "$2"` }));
    vi.stubEnv("FAKE_AGENT_STREAM", "claude");
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "claude", timeoutSeconds: 30 }, { clock: () => NOW });
    const capture = librarian.captureText("Build a tiny greenhouse");
    const steps: FilingStep[] = [];
    const { value: outcome, taken } = await counting(() =>
      only(librarian.file(null, { steps: (step) => void steps.push(step) })),
    );
    expect(taken).toBe(2);
    expect(outcome).toMatchObject({ ok: true, changes: { created: [`ideas/idea-${capture.id}.md`], modified: ["index.md", "log.md"] } });
    expect(steps).toContainEqual({ kind: "wrote", path: `ideas/idea-${capture.id}.md`, created: true });
  });

  it("an ask and a review take their own two, before the run and after the guard", async () => {
    expect((await counting(() => librarian.ask("What are my goals?"))).taken).toBe(2);
    expect((await counting(() => librarian.review())).taken).toBe(2);
  });
});
