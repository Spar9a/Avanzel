// Watching a library while an agent works: each file it writes or removes is reported once, as it happens, and a step
// names only a path inside the library. Real files in a temporary library. What should happen is awaited with
// `vi.waitFor` (3 s at most). A fixed wait is for asserting that nothing happened, or for the 100 ms a watch is given
// to start.
import { appendFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshot, type Snapshot } from "../../src/core/changes.ts";
import { insideLibrary, stepPath, type FilingStep } from "../../src/core/steps.ts";
import { watchWrites } from "../../src/core/watch.ts";
import { useTmp, write } from "./helpers.ts";

const tmp = useTmp();
const WITHIN = { timeout: 3000 };

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A fresh library folder (its path is a real one: `useTmp` resolves symlinks). */
function library(): string {
  const root = join(tmp(), "lib");
  mkdirSync(root);
  return root;
}

const running: Array<() => void> = [];

afterEach(() => {
  for (const stop of running.splice(0)) stop();
});

/** Starts watching `root`, collecting its steps. Every watch is stopped when the test is over, whatever happened. */
function watching(root: string, before: Snapshot = snapshot(root)) {
  const steps: FilingStep[] = [];
  const stop = watchWrites(root, before, (step) => steps.push(step));
  running.push(stop);
  return { steps, stop };
}

describe("watchWrites", () => {
  it("reports a new file, a changed file and a removed one", async () => {
    const root = library();
    write(root, "ideas/a.md", "a");
    write(root, "ideas/b.md", "b");
    const { steps, stop } = watching(root);
    await pause(100);
    write(root, "ideas/new.md", "new");
    appendFileSync(join(root, "ideas/a.md"), " and more");
    rmSync(join(root, "ideas/b.md"));
    await vi.waitFor(() => {
      expect(steps).toContainEqual({ kind: "wrote", path: "ideas/new.md", created: true });
      expect(steps).toContainEqual({ kind: "wrote", path: "ideas/a.md", created: false });
      expect(steps).toContainEqual({ kind: "deleted", path: "ideas/b.md" });
    }, WITHIN);
    stop();
    expect(steps).toHaveLength(3); // stop() reports none of them again
  });

  it("says nothing about dot folders, inbox/ or raw/", async () => {
    const root = library();
    const { steps, stop } = watching(root);
    for (const rel of [".git/x", ".avanzel/y", "inbox/z.md", "raw/2026/q.md"]) write(root, rel, "x");
    await pause(600);
    expect(steps).toEqual([]);
    stop();
    expect(steps).toEqual([]); // stop() looks at the folder too, and says nothing either
  });

  it("says nothing about a new folder", async () => {
    const root = library();
    const { steps, stop } = watching(root);
    mkdirSync(join(root, "ideas/sub"), { recursive: true });
    await pause(600);
    expect(steps).toEqual([]);
    stop();
    expect(steps).toEqual([]);
  });

  it("reports a file once, however often it changes", async () => {
    const root = library();
    const { steps, stop } = watching(root);
    await pause(100);
    for (let draft = 0; draft < 5; draft++) {
      write(root, "ideas/c.md", `draft ${draft}`);
      await pause(30);
    }
    await vi.waitFor(() => expect(steps).toHaveLength(1), WITHIN);
    await pause(400); // no second step follows
    stop();
    expect(steps).toEqual([{ kind: "wrote", path: "ideas/c.md", created: true }]);
  });

  it("reports, at stop, every change the watch hadn't reported yet, and nothing after", async () => {
    const root = library();
    const { steps, stop } = watching(root);
    write(root, "ideas/d.md", "d");
    stop(); // at once: no event can have arrived, and the 150 ms a path waits for hasn't passed
    expect(steps).toEqual([{ kind: "wrote", path: "ideas/d.md", created: true }]);
    write(root, "ideas/e.md", "e");
    await pause(500);
    expect(steps).toEqual([{ kind: "wrote", path: "ideas/d.md", created: true }]);
    stop(); // a second stop() changes nothing
    expect(steps).toHaveLength(1);
  });

  it("closes the watcher when it stops", async () => {
    // Node lists a watch that is open among its active resources, so a watcher left open can be seen without a mock.
    const open = () => process.getActiveResourcesInfo().filter((resource) => resource === "FSEventWrap").length;
    await vi.waitFor(() => expect(open()).toBe(0), WITHIN); // earlier tests' watchers finish closing
    const { stop } = watching(library());
    expect(open()).toBe(1);
    stop();
    await vi.waitFor(() => expect(open()).toBe(0), WITHIN);
  });

  it("passes over a write made just before the watch started", async () => {
    const root = library();
    write(root, "ideas/f.md", "f");
    const { steps, stop } = watching(root); // `before` is taken at once, and the watch starts after it
    await pause(600);
    stop();
    expect(steps).toEqual([]);
  });

  it("reports a later change to a file it passed over", async () => {
    const root = library();
    write(root, "ideas/f.md", "f");
    const { steps } = watching(root);
    await pause(100); // the watch is given a moment to start, as in every other test that writes while it runs
    // The canary's event comes after the replay of f.md's, so by the time its step arrives, f.md has been judged.
    write(root, "ideas/canary.md", "c");
    await vi.waitFor(() => expect(steps).toEqual([{ kind: "wrote", path: "ideas/canary.md", created: true }]), WITHIN);
    appendFileSync(join(root, "ideas/f.md"), " and more");
    await vi.waitFor(() => expect(steps).toContainEqual({ kind: "wrote", path: "ideas/f.md", created: false }), WITHIN);
    expect(steps).toHaveLength(2);
  });

  it("goes on when the listener throws", async () => {
    const root = library();
    const heard: string[] = [];
    const stop = watchWrites(root, snapshot(root), (step) => {
      heard.push(step.kind === "wrote" ? step.path : step.kind);
      throw new Error("the listener failed");
    });
    running.push(stop);
    await pause(100);
    write(root, "ideas/g.md", "g");
    await vi.waitFor(() => expect(heard).toEqual(["ideas/g.md"]), WITHIN); // the throw happened in a timer callback
    write(root, "ideas/h.md", "h");
    expect(() => stop()).not.toThrow();
    expect(heard).toEqual(["ideas/g.md", "ideas/h.md"]);
  });

  it("still reports at stop when the library can't be watched", () => {
    const root = library();
    write(root, "ideas/a.md", "a");
    const before = snapshot(root);
    rmSync(root, { recursive: true });
    const steps: FilingStep[] = [];
    let stop = () => {};
    expect(() => {
      stop = watchWrites(root, before, (step) => steps.push(step)); // fs.watch throws: there is nothing to watch
    }).not.toThrow();
    stop();
    expect(steps).toEqual([{ kind: "deleted", path: "ideas/a.md" }]);
  });
});

describe("insideLibrary", () => {
  it("gives a path relative to the library, or null when it is outside or is the library itself", () => {
    const root = library();
    expect(insideLibrary(root, join(root, "ideas/x.md"))).toBe("ideas/x.md");
    expect(insideLibrary(root, "ideas/x.md")).toBe("ideas/x.md");
    expect(insideLibrary(root, "./ideas//x.md")).toBe("ideas/x.md");
    expect(insideLibrary(root, `${root}/ideas/../raw/x.md`)).toBe("raw/x.md"); // ".." is settled before it is judged
    expect(insideLibrary(root, "ideas/../../x.md")).toBeNull();
    expect(insideLibrary(root, `${root}-other/x.md`)).toBeNull(); // a neighbour whose name starts with the library's
    expect(insideLibrary(root, root)).toBeNull();
    expect(insideLibrary(root, `${root}/`)).toBeNull();
  });

  it("a root reached through a symlink gives library paths", () => {
    const real = library();
    const link = join(tmp(), "link");
    symlinkSync(real, link);
    expect(insideLibrary(link, join(real, "ideas/x.md"))).toBe("ideas/x.md");
    expect(insideLibrary(link, `${link}/ideas/x.md`)).toBe("ideas/x.md");
    expect(insideLibrary(link, "ideas/x.md")).toBe("ideas/x.md");
    expect(insideLibrary(link, real)).toBeNull();
    expect(insideLibrary(link, join(tmp(), "elsewhere/x.md"))).toBeNull();
  });

  it("a root written in another letter case still gives library paths", ({ skip }) => {
    // Claude Code gives its paths as the disk spells them, whatever case the library's path was written in.
    const real = library();
    const upperRoot = real.toUpperCase();
    skip(!existsSync(upperRoot), "this volume tells letter case apart");
    expect(insideLibrary(upperRoot, join(real, "ideas/x.md"))).toBe("ideas/x.md");
  });
});

describe("stepPath", () => {
  it("a step names only paths inside the library", () => {
    const root = library();
    expect(stepPath(root, join(root, "ideas/x.md"))).toBe("ideas/x.md");
    expect(stepPath(root, "ideas/x.md")).toBe("ideas/x.md");
    for (const path of [
      "/elsewhere/x.md",
      "../x.md",
      root,
      ".git/config",
      "ideas/.draft.md",
      "inbox/x.md",
      "raw/2026/10/x.md",
    ]) {
      expect(stepPath(root, path), path).toBeNull();
    }
  });

  it("matches inbox/ and raw/ in any letter case, as the library's disk does", () => {
    const root = library();
    expect(stepPath(root, "RAW/2026/x.md")).toBeNull();
    expect(stepPath(root, "Inbox/x.md")).toBeNull();
    expect(stepPath(root, join(root, "Raw/2026/10/x.md"))).toBeNull();
    expect(stepPath(root, "ideas/Raw/x.md")).toBe("ideas/Raw/x.md"); // only the first segment names a source folder
    expect(stepPath(root, "Rawness/x.md")).toBe("Rawness/x.md"); // and the whole segment
  });

  it("judges a path once its '..' is settled", () => {
    const root = library();
    expect(stepPath(root, "ideas/../raw/2026/q.md")).toBeNull();
    expect(stepPath(root, join(root, "ideas/../inbox/x.md"))).toBeNull();
    expect(stepPath(root, "ideas/../.git/config")).toBeNull();
    expect(stepPath(root, "inbox/../ideas/x.md")).toBe("ideas/x.md");
  });

  it("follows the library through a symlinked root too", () => {
    const real = library();
    const link = join(tmp(), "link");
    symlinkSync(real, link);
    expect(stepPath(link, join(real, "ideas/x.md"))).toBe("ideas/x.md");
    expect(stepPath(link, join(real, "raw/x.md"))).toBeNull();
    expect(stepPath(link, join(real, ".git/config"))).toBeNull();
  });
});
