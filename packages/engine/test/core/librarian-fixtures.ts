// What the librarian tests share. `tmp` is made here because recordRuns needs the temp folder of the test that runs it.
// Each file keeps its own `vault` and `librarian`, which its beforeEach assigns anew and its tests reassign.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { defaultSettings, type Settings } from "../../src/core/config.ts";
import type { FileOutcome } from "../../src/core/librarian.ts";
import { FAKE_AGENT, useTmp } from "./helpers.ts";

export const tmp = useTmp();

export const read = (path: string) => readFileSync(path, "utf8");

export const mode = (name: string) => vi.stubEnv("FAKE_AGENT_MODE", name);

export function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export function fakeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(),
    harness: "fake",
    timeoutSeconds: 30,
    harnesses: { fake: { name: "fake", headless: [process.execPath, FAKE_AGENT, "{prompt}"], interactive: [] } },
    ...overrides,
  };
}

export async function only(pending: Promise<FileOutcome[]>): Promise<FileOutcome> {
  const outcomes = await pending;
  expect(outcomes).toHaveLength(1);
  return outcomes[0] as FileOutcome;
}

/** Everything the fake agent was run with (FAKE_AGENT_RECORD), oldest first. */
export function recordRuns(): () => Array<{ argv: string[]; images: string[]; prompt: string }> {
  const record = join(tmp(), "runs.jsonl");
  vi.stubEnv("FAKE_AGENT_RECORD", record);
  return () => (existsSync(record) ? read(record).trim().split("\n").map((line) => JSON.parse(line)) : []);
}
