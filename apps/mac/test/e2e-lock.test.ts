// The build refuses while a suite runs, and the dist folder can be moved with AVANZEL_DIST.
import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { distDir, holdLock, runningMessage, suiteRunning } from "../scripts/e2e-lock.mjs";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "av-lock-"));

describe("e2e lock", () => {
  it("dist is apps/mac/dist unless AVANZEL_DIST says otherwise", () => {
    expect(distDir("/app", {})).toBe(path.join("/app", "dist"));
    expect(distDir("/app", { AVANZEL_DIST: "/tmp/other" })).toBe("/tmp/other");
    expect(distDir("/app", { AVANZEL_DIST: "relative/out" })).toBe(path.resolve("relative/out"));
  });

  it("a held lock says a suite is running, and releasing it clears that", () => {
    const root = tmp();
    expect(suiteRunning(root)).toBe(false);
    const release = holdLock(root);
    expect(suiteRunning(root)).toBe(true);
    release();
    expect(suiteRunning(root)).toBe(false);
  });

  it("a lock left by a process that is gone does not block a build", () => {
    const root = tmp();
    const release = holdLock(root, 2_147_483_646); // no such pid
    expect(suiteRunning(root)).toBe(false);
    release();
  });

  it("the refusal is one sentence", () => {
    expect(runningMessage()).toMatch(/^[^.\n]+\.$/);
    expect(existsSync(tmp())).toBe(true);
  });
});
