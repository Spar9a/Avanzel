// Settings → Agents says whether each installed agent can work. The library's agent is the fake one: a custom
// harness with no sign-in command, so its check is one short prompt, which runs only when Check is clicked. This
// Mac's own Claude Code and Codex read their sign-in when the pane opens; nothing here depends on what they say.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { call, launch, makeLibrary, windowFor } from "./helpers.ts";

/** Opens Settings → Agents and returns the fake agent's row. */
async function fakeAgentRow(app: ElectronApplication) {
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  return settings.locator(".grow").filter({ has: settings.getByRole("textbox", { name: "fake model" }) });
}

test("Settings → Agents checks the fake agent with one prompt and shows how long it took", async () => {
  const library = await makeLibrary();
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-record-")), "runs.jsonl");
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
