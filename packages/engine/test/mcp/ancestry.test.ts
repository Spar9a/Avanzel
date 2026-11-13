import { describe, expect, it } from "vitest";
import { launchedBy, psParentOf, type ParentOf } from "../../src/mcp/ancestry.ts";

/** A process table: pid → its parent and executable. */
function table(rows: Record<number, [number, string]>): { parentOf: ParentOf; asked: number[] } {
  const asked: number[] = [];
  const parentOf: ParentOf = (pid) => {
    asked.push(pid);
    const row = rows[pid];
    return row ? { ppid: row[0], path: row[1] } : null;
  };
  return { parentOf, asked };
}

describe("launchedBy", () => {
  it("is true when an ancestor runs the executable", () => {
    const { parentOf } = table({
      50: [40, "/usr/local/bin/claude"],
      40: [30, "/bin/zsh"],
      30: [1, "/A/Avanzel"],
    });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(true);
  });

  it("does not count the process itself, only its ancestors", () => {
    const { parentOf } = table({
      50: [40, "/A/Avanzel"],
      40: [1, "/bin/zsh"],
    });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(false);
  });

  it("is false when no ancestor runs it", () => {
    const { parentOf } = table({
      50: [40, "/usr/local/bin/claude"],
      40: [30, "/bin/zsh"],
      30: [1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"],
    });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(false);
  });

  it("stops at pid 1 without asking about it", () => {
    const { parentOf, asked } = table({
      50: [40, "/usr/local/bin/claude"],
      40: [1, "/bin/zsh"],
      1: [0, "/A/Avanzel"],
    });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(false);
    expect(asked).toEqual([50, 40]);
  });

  it("stops at a loop in the table", () => {
    const { parentOf, asked } = table({
      50: [40, "/usr/local/bin/claude"],
      40: [30, "/bin/zsh"],
      30: [40, "/bin/sh"],
    });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(false);
    expect(asked.length).toBeLessThan(6);
  });

  it("stops when a parent can't be looked up", () => {
    const { parentOf } = table({ 50: [40, "/usr/local/bin/claude"] });
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe(false);
  });

  it("is unknown, not false, when the process table can't be read", () => {
    const broken: ParentOf = () => {
      throw new Error("spawn /bin/ps ENOENT");
    };
    expect(launchedBy("/A/Avanzel", 50, broken)).toBe("unknown");
    const { parentOf } = table({});
    expect(launchedBy("/A/Avanzel", 50, parentOf)).toBe("unknown"); // the process itself isn't found
    let calls = 0;
    const failsLater: ParentOf = (pid) => {
      calls += 1;
      if (calls > 1) throw new Error("ps timed out");
      return { ppid: pid - 10, path: "/usr/local/bin/claude" };
    };
    expect(launchedBy("/A/Avanzel", 50, failsLater)).toBe("unknown");
  });

  it("walks at most 64 steps", () => {
    let asked = 0;
    const endless: ParentOf = (pid) => {
      asked += 1;
      return { ppid: pid + 1, path: "/bin/sh" };
    };
    expect(launchedBy("/A/Avanzel", 2, endless)).toBe(false);
    expect(asked).toBeLessThanOrEqual(65);
  });
});

describe("psParentOf", () => {
  it("gives this process's parent and the executable's path", () => {
    const found = psParentOf(process.pid);
    expect(found?.ppid).toBe(process.ppid);
    expect(found?.path).toMatch(/node/);
  });

  it("is null for a pid that runs nothing", () => {
    expect(psParentOf(999_999)).toBeNull();
  });

  it("throws when ps can't be run, rather than saying no such process", () => {
    expect(() => psParentOf(process.pid, "/no/such/ps")).toThrow();
  });

  it("runs /bin/ps, whatever PATH says", () => {
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      expect(psParentOf(process.pid)?.ppid).toBe(process.ppid);
    } finally {
      process.env.PATH = path;
    }
  });

  it("finds the test runner among this process's ancestors only when it is one", () => {
    expect(launchedBy("/no/such/Avanzel", process.pid)).toBe(false);
  });
});
