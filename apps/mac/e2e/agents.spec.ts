// Settings → Agents says whether each installed agent can work. The library's agent is the fake one: a custom
// harness with no sign-in command, so its check is one short prompt, which runs only when Check is clicked. Claude
// Code and Codex are launch()'s stand-ins, which read as signed in when the pane opens.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, writeWav } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { agentCalls, agentPath, alive, call, launch, makeLibrary, windowFor } from "./helpers.ts";

/** Opens Settings → Agents and returns it. */
async function agentsPane(app: ElectronApplication): Promise<Page> {
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  return settings;
}

/** Opens Settings → Agents and returns the fake agent's row, a group named for its agent. */
const fakeAgentRow = async (app: ElectronApplication) => (await agentsPane(app)).getByRole("group", { name: "fake" });

/** What the agent's last check found, as the controller keeps it (null: not checked, or the check couldn't tell). */
const statusOf = async (app: ElectronApplication, name: string) =>
  ((await call(app, "snapshot")) as SettingsSnapshot).harnesses.find((h) => h.name === name)?.status ?? null;

/** The answer of a `claude` whose `auth status` prints nothing a check understands, as an older Claude Code may. */
const UNREADABLE_CLAUDE = `if [ "$1 $2" = "auth status" ]; then echo "unknown command: auth"; exit 1; else echo ready; fi`;

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

test("an agent whose reply asks to sign in says how, then what it said", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail-signin" });
  const row = await fakeAgentRow(app);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  // The fake agent draws a logged-out Cursor Agent's banner: its line ends in "Press any key to sign in...".
  await expect(row.getByText(/^Not signed in\. Sign in to fake in Terminal\. .*Press any key to sign in\.\.\.$/)).toBeVisible({ timeout: 20_000 });
  await app.close();
});

test("a problem is red only for the agent in use; a failure loses its Error label, and a sign-in command's no is the hint alone", async () => {
  const signedOut = `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; else echo ready; fi`;
  // The fake agent, the library's, fails as Codex does: "ERROR: the model is not supported with this account".
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_MODE: "fail-noisy", PATH: agentPath({ claude: signedOut }) });
  const settings = await agentsPane(app);
  const claude = settings.getByRole("group", { name: "Claude Code" }).getByText("Not signed in.", { exact: false });
  await expect(claude).toHaveText("Not signed in. Run claude once in Terminal and sign in.", { timeout: 20_000 });
  await expect(claude).toHaveAttribute("data-tone", "secondary"); // Claude Code isn't the agent in use
  const fake = settings.getByRole("group", { name: "fake" });
  await fake.getByRole("button", { name: "Check", exact: true }).click();
  const failure = fake.getByText("The model is not supported with this account");
  await expect(failure).toHaveText("The model is not supported with this account", { timeout: 20_000 });
  await expect(failure).toHaveAttribute("data-tone", "danger");
  await app.close();
});

test("the free checks read launch()'s stand-ins for Claude Code and Codex, and ask them nothing", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await agentsPane(app);
  for (const name of ["Claude Code", "Codex"]) {
    await expect(settings.getByRole("group", { name }).getByRole("status")).toHaveText("Signed in", { timeout: 20_000 });
  }
  // The stand-ins are first on the app's PATH, ahead of what widenedPath adds, so this Mac's own CLIs never ran.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  await app.close();
});

test("a free check that can't read the sign-in leaves the agent unchecked, and Check then asks its one question", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), PATH: agentPath({ claude: UNREADABLE_CLAUDE }) });
  const settings = await agentsPane(app);
  await expect(settings.getByRole("group", { name: "Codex" }).getByRole("status")).toHaveText("Signed in", { timeout: 20_000 });
  const claude = settings.getByRole("group", { name: "Claude Code" });
  await expect.poll(() => agentCalls(app), { timeout: 20_000 }).toContain("claude auth status");
  await expect(claude.getByRole("status")).toHaveText("Installed");
  await expect(claude.getByRole("button", { name: "Check", exact: true })).toBeVisible();
  expect(await statusOf(app, "claude")).toBeNull();
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude"))).toEqual(["claude auth status"]); // no prompt
  await claude.getByRole("button", { name: "Check", exact: true }).click();
  await expect(claude.getByText(/^Replied in \d+\.\d s$/)).toBeVisible({ timeout: 20_000 });
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude -p"))).toHaveLength(1);
  await app.close();
});

// The agent runs detached, in a process group of its own, and the check's 15 s timeout lives in Avanzel: an agent
// that hangs would outlive the app unless quitting stops it.
test("quitting while an agent check hangs stops the agent", async () => {
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "60000" });
  const row = await fakeAgentRow(app);
  const check = row.getByRole("button", { name: "Check", exact: true });
  await check.click();
  await expect(row.getByRole("status")).toHaveText("Checking…");
  // Busy, not disabled: the button keeps the focus while it checks.
  await expect(check).toHaveAttribute("aria-busy", "true");
  await expect(check).toBeFocused();
  const pid = await firstAgentPid(record);
  expect(alive(pid)).toBe(true);
  await app.close(); // app.quit(), with no filing to wait for
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
});

test("a plain quit stops the agent checks, and none starts after it", async () => {
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_RECORD: record });
  await call(app, "stopAgentChecks"); // what quitting runs when nothing is busy
  await call(app, "checkAgent", "fake");
  expect(await checksRunning(app)).toBe(0);
  expect(await statusOf(app, "fake")).toBeNull();
  expect(existsSync(record)).toBe(false); // the fake agent never ran
  await app.close();
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

// An error card's "Open Settings" opens the pane where the problem is fixed, not always General.
const paneButton = (settings: Page, name: string) => settings.getByRole("button", { name, exact: true });

test("Open Settings on a failed filing opens Settings → Agents", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_MODE: "fail" });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  const thought = quick.getByRole("textbox", { name: "Type a thought" });
  await thought.fill("Plant tulips in October");
  await thought.press("Enter");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("couldn't file this note")).toBeVisible({ timeout: 60_000 });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings"); // a new window: it opens on the pane its address names
  await expect(paneButton(settings, "Agents")).toHaveAttribute("aria-current", "page");
  await app.close();
});

test("Open Settings moves a Settings window that is open to the pane, and a pane that doesn't exist means General", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  await call(app, "showSettings", "no-such-pane"); // an address that names a pane the page doesn't have
  const settings = await windowFor(app, "settings");
  await expect(paneButton(settings, "General")).toHaveAttribute("aria-current", "page");
  await call(app, "openSettingsFor", "open-settings:voice");
  await expect(paneButton(settings, "Voice")).toHaveAttribute("aria-current", "page");
  await expect(paneButton(settings, "General")).not.toHaveAttribute("aria-current", "page");
  await call(app, "openSettingsFor", "open-settings:no-such-pane");
  await expect(paneButton(settings, "General")).toHaveAttribute("aria-current", "page");
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(paneButton(settings, "Privacy")).toHaveAttribute("aria-current", "page");
  await call(app, "openSettingsFor", "open-settings"); // an action that names no pane
  await expect(paneButton(settings, "General")).toHaveAttribute("aria-current", "page");
  await app.close();
});

test("Open Settings with no library opens Settings → General", async () => {
  const app = await launch({}); // the first launch opens Settings by itself
  const settings = await windowFor(app, "settings");
  await paneButton(settings, "Voice").click();
  await call(app, "toggleDictate");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("Set up your library first")).toBeVisible();
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  await expect(paneButton(settings, "General")).toHaveAttribute("aria-current", "page");
  await app.close();
});

/** Dictates once with `audio` standing in for the microphone, then clicks Open Settings on the error card it ends in. */
async function openSettingsAfterDictating(audio: string, error: string | RegExp): Promise<{ app: ElectronApplication; settings: Page }> {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: audio, AVANZEL_FAKE_TRANSCRIPT: "unused" });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(error)).toBeVisible({ timeout: 30_000 });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  return { app, settings: await windowFor(app, "settings") };
}

const scratchDir = () => mkdtempSync(path.join(tmpdir(), "avz-e2e-audio-"));

test("Open Settings on a recording too short to hold speech opens Settings → Voice", async () => {
  const blip = path.join(scratchDir(), "blip.wav");
  writeWav(blip, new Float32Array(1600)); // 0.1 s: under 0.3 s Avanzel doesn't try to transcribe
  const { app, settings } = await openSettingsAfterDictating(blip, "No speech recognized");
  await expect(paneButton(settings, "Voice")).toHaveAttribute("aria-current", "page");
  await app.close();
});

test("Open Settings on a recording that can't be read opens Settings → Voice", async () => {
  const notAudio = path.join(scratchDir(), "speech.wav");
  writeFileSync(notAudio, "this is not a recording");
  const { app, settings } = await openSettingsAfterDictating(notAudio, /is not a PCM WAV file/);
  await expect(paneButton(settings, "Voice")).toHaveAttribute("aria-current", "page");
  await app.close();
});
