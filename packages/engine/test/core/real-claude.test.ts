// The real Claude Code, opt-in because it spends one short prompt and one filing of the owner's subscription:
//   AVANZEL_TEST_REAL_CLAUDE=1 npm test -w @avanzel/engine -- real-claude
// It runs this Mac's own `claude`, signed in, from PATH.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings } from "../../src/core/config.ts";
import { harnesses, runHeadless, type Harness } from "../../src/core/harness.ts";
import { Librarian } from "../../src/core/librarian.ts";
import { insideLibrary, type FilingStep } from "../../src/core/steps.ts";
import { Vault } from "../../src/core/vault.ts";

describe.skipIf(!process.env.AVANZEL_TEST_REAL_CLAUDE)("the real Claude Code (AVANZEL_TEST_REAL_CLAUDE=1)", () => {
  const folders: string[] = [];
  const folder = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "avanzel-real-claude-"));
    folders.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("Claude Code itself refuses a write to raw/", async () => {
    // A bare folder without the library's rules: they would tell Claude never to touch raw/, and then it might not try.
    const root = folder();
    mkdirSync(join(root, "raw"));
    const claude = harnesses(defaultSettings()).claude as Harness;
    const prompt = "Create the file raw/hello.md containing the word hi, then reply done.";
    const result = await runHeadless(claude, prompt, root, { write: true, timeoutSeconds: 120 });
    expect(existsSync(join(root, "raw", "hello.md"))).toBe(false);
    expect(result.refused.map((path) => insideLibrary(root, path))).toContain("raw/hello.md");
  }, 180_000);

  it("a real Claude Code filing hands over its reads and writes", async () => {
    const vault = await Vault.init(folder(), { git: false });
    const librarian = new Librarian(vault, { ...loadSettings(vault.root), harness: "claude", timeoutSeconds: 300 });
    librarian.captureText("I want to launch my podcast about indie game development before the end of the year.");
    const steps: FilingStep[] = [];
    const [outcome] = await librarian.file(null, { steps: (step) => steps.push(step) });
    expect(steps.some((step) => step.kind === "read")).toBe(true);
    expect(steps.some((step) => step.kind === "wrote")).toBe(true);
    expect(outcome?.ok).toBe(true);
  }, 420_000);
});
