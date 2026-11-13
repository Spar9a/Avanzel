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

  it("finds the test runner among this process's ancestors only when it is one", () => {
    expect(launchedBy("/no/such/Avanzel", process.pid)).toBe(false);
  });
});
