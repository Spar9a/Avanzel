// Shared fixtures for the core tests. Importing this module pins the time zone, so the expected
// timestamps below never depend on the machine running the tests.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, vi } from "vitest";

process.env.TZ = "Asia/Dubai"; // UTC+4 all year: NOW renders as 2026-10-20T14:03:12+04:00

/** The v0.1 tests' NOW: 2026-10-20 14:03:12 local time (+04:00). */
export const NOW = new Date("2026-10-20T14:03:12+04:00");

export const FAKE_AGENT = fileURLToPath(new URL("../fake-agent.mjs", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A fresh temp folder per test (realpath'd, so it matches what child processes see as their cwd). */
export function useTmp(): () => string {
  let dir = "";
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "avanzel-test-")));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}

/** Isolate HOME and the user config dir so tests never touch the real ~/Avanzel or ~/.gitconfig. */
export function envHome(tmp: string): string {
  const home = join(tmp, "home");
  mkdirSync(home, { recursive: true });
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  vi.stubEnv("AVANZEL_VAULT", undefined);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  return home;
}

export function gitIdentity(): void {
  for (const key of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) vi.stubEnv(key, "Avanzel Test");
  for (const key of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) vi.stubEnv(key, "test@example.com");
}

/** The error `fn` throws (fails the test when it throws nothing). */
export function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected an error, but nothing was thrown");
}

export function write(root: string, rel: string, text: string): string {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** Executable shell scripts in `<tmp>/bin`, e.g. stand-ins for agent CLIs on PATH. */
export function binScripts(tmp: string, scripts: Record<string, string>): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
    chmodSync(path, 0o755);
  }
  return bin;
}
