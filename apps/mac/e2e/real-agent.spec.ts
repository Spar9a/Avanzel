// Spends a little of the owner's agent subscription: AVANZEL_E2E_AGENT=claude (or codex, opencode, …).
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { call, capsuleKind, launch, snap, speechWav, windowFor } from "./helpers.ts";

const agent = process.env.AVANZEL_E2E_AGENT;
test.skip(!agent, "set AVANZEL_E2E_AGENT to a logged-in agent CLI");
test.setTimeout(420_000);

const inbox = (root: string) => readdirSync(path.join(root, "inbox")).filter((n) => !n.startsWith("."));
const pages = (root: string) =>
  ["goals", "ideas", "problems", "memories", "people", "topics"].flatMap((shelf) =>
    readdirSync(path.join(root, shelf)).filter((n) => n.endsWith(".md")).map((n) => `${shelf}/${n}`));

test("a spoken thought is filed by the real agent, and Undo takes it back", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "avz-real-"));
  const vault = await Vault.init(root, { git: true });
  saveSettings(vault.root, { ...loadSettings(vault.root), harness: agent!, timeoutSeconds: 300 });
  execFileSync("git", ["-C", root, "commit", "-qam", "test: use the real agent", "--no-verify"]);

  const app = await launch({
    AVANZEL_LIBRARY: root,
    AVANZEL_FAKE_AUDIO: speechWav("I want to launch my podcast about indie game development before the end of the year. My co-host Mark is busy until December."),
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filing");
  await expect.poll(() => capsuleKind(app), { timeout: 360_000, intervals: [2000] }).toBe("filed");
  await snap(capsule, "real-filed");
  expect(inbox(root)).toEqual([]);
  const filed = pages(root);
  expect(filed.length).toBeGreaterThan(0);
  console.log("filed pages:", filed.join(", "));

  await capsule.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("saved");
  await snap(capsule, "real-undone");
  expect(inbox(root)).toHaveLength(1);
  expect(pages(root)).toEqual([]);
  await app.close();
});
