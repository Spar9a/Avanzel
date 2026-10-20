// Settings → Agents says whether each installed agent can work. The library's agent is the fake one: a custom
// harness with no sign-in command, so its check is one short prompt, which runs only when Check is clicked. This
// Mac's own Claude Code and Codex read their sign-in when the pane opens; nothing here depends on what they say.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { alive, call, launch, makeLibrary, windowFor } from "./helpers.ts";

/** Opens Settings → Agents and returns the fake agent's row. */
async function fakeAgentRow(app: ElectronApplication) {
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  return settings.locator(".grow").filter({ has: settings.getByRole("textbox", { name: "fake model" }) });
}

const recordFile = () => path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-record-")), "runs.jsonl");

/** The process of the fake agent's first run, once it has started (FAKE_AGENT_RECORD). */
async function firstAgentPid(record: string): Promise<number> {
  await expect.poll(() => existsSync(record), { timeout: 15_000 }).toBe(true);
  return (JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number }).pid;
}

/** How many agent checks the controller has going on. */
const checksRunning = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __avanzel: { runningChecks: Set<unknown> } }).__avanzel.runningChecks.size);

test("Settings → Agents checks the fake agent with one prompt and shows how long it took", async () => {
  const library = await makeLibrary();
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  const row = await fakeAgentRow(app);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  await expect(row.getByText(/Replied in \d+\.\d s/)).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole("button", { name: "Check again" })).toBeEnabled();
  // Opening the pane asked the fake agent nothing; Check asked it once.
  const prompts = readFileSync(record, "utf8").trim().split("\n").map((line) => (JSON.parse(line) as { prompt: string }).prompt);
  expect(prompts).toEqual(["Reply with the single word: ready."]);
  await app.close();
});

test("an agent that isn't signed in says how to sign in", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail-signin" });
  const row = await fakeAgentRow(app);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  await expect(row.getByText(/^Not signed in\. Sign in to fake in Terminal\.$/)).toBeVisible({ timeout: 20_000 });
  await app.close();
});

// The agent runs detached, in a process group of its own, and the check's 15 s timeout lives in Avanzel: an agent
// that hangs would outlive the app unless quitting stops it.
test("quitting while an agent check hangs stops the agent", async () => {
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "60000" });
  const row = await fakeAgentRow(app);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  await expect(row.getByText("Checking…")).toBeVisible();
  const pid = await firstAgentPid(record);
  expect(alive(pid)).toBe(true);
  await app.close(); // app.quit(), with no filing to wait for
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
});

test("a check stopped for quitting leaves no result, and no check starts while Avanzel quits", async () => {
  const library = await makeLibrary();
  const settings = loadSettings(library);
  // A second fake agent, which nothing checks by itself: it has no sign-in command.
  saveSettings(library, { ...settings, harnesses: { ...settings.harnesses, other: { ...settings.harnesses.fake!, name: "other" } } });
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "60000" });
  const row = await fakeAgentRow(app);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  const pid = await firstAgentPid(record);
  await call(app, "stopForQuit"); // what quitting runs while a filing is under way
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  await expect.poll(() => checksRunning(app)).toBe(0); // the engine has answered: "fake was cancelled"
  const { harnesses } = (await call(app, "snapshot")) as SettingsSnapshot;
  expect(harnesses.find((h) => h.name === "fake")?.status?.kind).not.toBe("failed");
  await call(app, "checkAgent", "other");
  expect(await checksRunning(app)).toBe(0);
  await app.close();
});
