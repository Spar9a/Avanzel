// Settings → Agents lists every agent, says whether each installed one can work, lets the person choose which one files,
// and names the model of the one in use. The library's agent is the fake one: a custom harness with no sign-in command,
// so its check is one short prompt, which runs only when Check is clicked. Claude Code and Codex are launch()'s
// stand-ins, which read as signed in when the pane opens.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, writeWav } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { agentCalls, agentPath, alive, call, capsuleKind, filesUnder, launch, makeLibrary, noAgents, openSettings, SIGNED_OUT_CLAUDE, snap, UNREADABLE_CLAUDE, windowFor } from "./helpers.ts";

/** Opens Settings → Agents and returns the fake agent's row, a group named for its agent. */
const fakeAgentRow = async (app: ElectronApplication) => (await openSettings(app, "Agents")).getByRole("group", { name: "fake" });

/** What the agent's last check found, as the controller keeps it (null: not checked, or the check couldn't tell). */
const statusOf = async (app: ElectronApplication, name: string) =>
  ((await call(app, "snapshot")) as SettingsSnapshot).harnesses.find((h) => h.name === name)?.status ?? null;

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
  // Nobody has asked about this agent yet, so its status isn't announced: it has no live region until Check.
  await expect(row.getByText("Installed", { exact: true })).toBeVisible();
  await expect(row.getByRole("status")).toHaveCount(0);
  await row.getByRole("button", { name: "Check", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText(/^Replied in \d+\.\d s$/, { timeout: 20_000 });
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

test("a problem is red only for the agent in use; a failure loses its Error label and ends as a sentence, and a sign-in command's no is the hint alone", async () => {
  // The fake agent, the library's, fails as Codex does: "ERROR: the model is not supported with this account".
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_MODE: "fail-noisy", PATH: agentPath({ claude: SIGNED_OUT_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  const claude = settings.getByRole("group", { name: "Claude Code" }).getByText("Not signed in.", { exact: false });
  await expect(claude).toHaveText("Not signed in. Run claude once in Terminal and sign in.", { timeout: 20_000 });
  await expect(claude).toHaveAttribute("data-tone", "secondary"); // Claude Code isn't the agent in use
  const fake = settings.getByRole("group", { name: "fake" });
  await fake.getByRole("button", { name: "Check", exact: true }).click();
  const failure = fake.getByText("The model is not supported with this account.");
  await expect(failure).toHaveText("The model is not supported with this account.", { timeout: 20_000 });
  await expect(failure).toHaveAttribute("data-tone", "danger");
  await app.close();
});

test("Use Codex makes Codex the agent that files, Use automatic hands the choice back, and the agent in use names its model", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  const fake = settings.getByRole("group", { name: "fake", exact: true });
  const codex = settings.getByRole("group", { name: "Codex", exact: true });
  const automatic = settings.getByRole("group", { name: "Choose automatically", exact: true });
  // The library's own agent is the one chosen, and so the one in use: it names its model, which saves on Return.
  await expect(fake.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(automatic.getByRole("button", { name: "Use automatic" })).toBeVisible();
  const model = settings.getByRole("textbox", { name: "fake model" });
  await model.fill("small");
  await model.press("Enter");
  await expect.poll(() => loadSettings(library).models).toEqual({ fake: "small" });

  // Use Codex files with Codex from now on. Its row is chosen, the fake agent's offers to be, and Codex has the model group.
  await codex.getByRole("button", { name: "Use Codex" }).click();
  await expect.poll(() => loadSettings(library).harness).toBe("codex");
  await expect(codex.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(fake.getByRole("img", { name: "Chosen" })).toHaveCount(0);
  await expect(fake.getByRole("button", { name: "Use fake" })).toBeVisible();
  await expect(codex.getByRole("button", { name: "Use Codex" })).toHaveCount(0);
  await expect(settings.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Codex model" })).toHaveValue("");
  await expect(settings.getByRole("textbox", { name: "fake model" })).toHaveCount(0);
  expect(loadSettings(library).models).toEqual({ fake: "small" }); // the fake agent's model is kept

  // Use automatic hands the choice back: the last row is chosen, no agent's is, and the agent in use is the one Automatic
  // picks, which is Claude Code's stand-in.
  await automatic.getByRole("button", { name: "Use automatic" }).click();
  await expect.poll(() => loadSettings(library).harness).toBe("auto");
  await expect(automatic.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(automatic.getByRole("button", { name: "Use automatic" })).toHaveCount(0);
  await expect(codex.getByRole("img", { name: "Chosen" })).toHaveCount(0);
  await expect(codex.getByRole("button", { name: "Use Codex" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Claude Code", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Claude Code model" })).toBeVisible();
  await app.close();
});

test("the model starts from the one saved, saves when the focus leaves the field, and an emptied field drops it", async () => {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), models: { fake: "tiny", codex: "big" } });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  const model = settings.getByRole("textbox", { name: "fake model" });
  await expect(model).toHaveValue("tiny");
  // The row says what an empty field means, so the field draws no placeholder: its ink reads under AA in dark.
  await expect(
    settings.getByText("A smaller model often files just as well and costs less. Leave it empty to use the agent's own default.", { exact: true }),
  ).toBeVisible();
  await expect(model).not.toHaveAttribute("placeholder");
  await model.fill("small");
  await model.press("Tab"); // the focus leaves the field, which saves it, with the other agents' models kept
  await expect.poll(() => loadSettings(library).models).toEqual({ fake: "small", codex: "big" });
  await model.fill("");
  await model.press("Tab");
  await expect.poll(() => loadSettings(library).models).toEqual({ codex: "big" });
  await expect(model).toHaveValue("");
  await expect(model).not.toHaveAttribute("placeholder");
  await app.close();
});

test("an agent's name stays on one line at the window's least width, beside the longest status", async () => {
  // Claude Code is signed out and isn't the agent chosen: its row holds the longest status, "Best results", Use and Check.
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), PATH: agentPath({ claude: SIGNED_OUT_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  const least = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))!;
    const [width = 0] = win.getMinimumSize();
    win.setSize(width, 500); // short enough that the pane scrolls
    return width;
  });
  await expect.poll(() => settings.evaluate(() => window.innerWidth)).toBe(least);
  // Whether a scrolling pane gives 15 px of every row to a classic scrollbar depends on how this Mac shows scrollbars.
  // Make it the narrower case, whatever the setting.
  await settings.addStyleTag({ content: "main::-webkit-scrollbar { width: 15px; }" });
  const claude = settings.getByRole("group", { name: "Claude Code", exact: true });
  await expect(claude.getByText("Not signed in.", { exact: false })).toBeVisible({ timeout: 20_000 });
  // The pane scrolls and the page doesn't. A field's hidden label is placed against the page unless the pane holds it, so
  // one below the pane's fold stretched the page: a second scrollbar, which took another 15 px from every row.
  expect(await settings.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), "the page doesn't scroll").toBeLessThanOrEqual(0);
  // Every name is on one line, as short Codex's is: not wrapped at its space, and not broken letter by letter.
  const height = async (name: string) => {
    const box = await settings.getByText(name, { exact: true }).boundingBox();
    expect(box, `${name}'s row is on the page`).not.toBeNull();
    return box!.height;
  };
  const oneLine = await height("Codex");
  expect(oneLine).toBeGreaterThan(0);
  for (const name of ["Claude Code", "Codex", "OpenCode", "Cursor Agent", "Gemini CLI"]) {
    expect(await height(name), `${name} is on one line`).toBeLessThan(oneLine * 1.5);
  }
  await app.close();
});

test("with no agent installed, every row says so, and Claude Code and Codex offer their install commands", async () => {
  const library = await makeLibrary();
  // The library's own agent is Claude Code, which this Mac doesn't have: it stays chosen, and its "Not installed" is a problem.
  saveSettings(library, { ...loadSettings(library), harness: "claude", harnesses: {} });
  const emptyBin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_EXACT_PATH: "1", PATH: `${emptyBin}:/usr/bin:/bin:/usr/sbin:/sbin` });
  const settings = await openSettings(app, "Agents");
  const row = (name: string) => settings.getByRole("group", { name, exact: true });
  for (const name of ["Claude Code", "Codex", "OpenCode", "Cursor Agent", "Gemini CLI"]) {
    await expect(row(name).getByText("Not installed", { exact: true })).toBeVisible();
    await expect(row(name).getByRole("button", { name: /^(Use|Check)/ })).toHaveCount(0); // nothing to use or check
  }
  await expect(row("Claude Code").getByText("Not installed", { exact: true })).toHaveAttribute("data-tone", "danger"); // the agent in use
  await expect(row("Codex").getByText("Not installed", { exact: true })).toHaveAttribute("data-tone", "secondary");
  await expect(row("Claude Code").getByRole("img", { name: "Chosen" })).toBeVisible(); // chosen, installed or not
  await expect(settings.getByRole("img", { name: "Chosen" })).toHaveCount(1);
  await expect(settings.getByText("Best results", { exact: true })).toHaveCount(1);
  await expect(settings.getByText("Experimental", { exact: true })).toHaveCount(1); // Gemini CLI's description
  await snap(settings, "settings-agents-none");

  // Only Claude Code and Codex have an install command. Main copies the one it holds for the agent, and the button says so for 2 s.
  await expect(settings.getByRole("button", { name: "Copy install command" })).toHaveCount(2);
  await expect(row("OpenCode").getByRole("button")).toHaveCount(0);
  await row("Claude Code").getByRole("button", { name: "Copy install command" }).click();
  await expect(row("Claude Code").getByRole("button", { name: "Copied" })).toBeVisible();
  await expect.poll(() => call(app, "copiedForTests")).toEqual(["curl -fsSL https://claude.ai/install.sh | bash"]);
  await expect(row("Codex").getByRole("button", { name: "Copy install command" })).toBeVisible();
  await expect(row("Claude Code").getByRole("button", { name: "Copy install command" })).toBeVisible({ timeout: 10_000 });
  await app.close();
});

test("the free checks read launch()'s stand-ins for Claude Code and Codex, and ask them nothing", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Agents");
  for (const name of ["Claude Code", "Codex"]) {
    await expect(settings.getByRole("group", { name }).getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  }
  // Nobody asked for these reads, so VoiceOver isn't told of them: no row's status is a live region.
  await expect(settings.getByRole("status")).toHaveCount(0);
  // The stand-ins are first on the app's PATH, ahead of what widenedPath adds, so this Mac's own CLIs never ran.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  await app.close();
});

test("a free check that can't read the sign-in leaves the agent unchecked, and Check then asks its one question", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), PATH: agentPath({ claude: UNREADABLE_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  await expect(settings.getByRole("group", { name: "Codex" }).getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  const claude = settings.getByRole("group", { name: "Claude Code" });
  await expect.poll(() => agentCalls(app), { timeout: 20_000 }).toContain("claude auth status");
  await expect(claude.getByText("Installed", { exact: true })).toBeVisible();
  await expect(claude.getByRole("button", { name: "Check", exact: true })).toBeVisible();
  expect(await statusOf(app, "claude")).toBeNull();
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude"))).toEqual(["claude auth status"]); // no prompt
  await claude.getByRole("button", { name: "Check", exact: true }).click();
  await expect(claude.getByRole("status")).toHaveText(/^Replied in \d+\.\d s$/, { timeout: 20_000 });
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

// An error card's "Open Settings" opens the pane where the problem is fixed, not always General. Each pane is a radio on
// the window's toolbar.
const paneRadio = (settings: Page, name: string) => settings.getByRole("radio", { name, exact: true });

test("Open Settings on a filing with no agent to run opens Settings → Agents", async () => {
  // The library picks its agent by itself, and this Mac has none: exactly the system folders and an empty one are on PATH.
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "auto" });
  const app = await launch({ AVANZEL_LIBRARY: library, ...noAgents().env });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  const thought = quick.getByRole("textbox", { name: "Type a thought" });
  await thought.fill("Plant tulips in October");
  await thought.press("Enter");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByRole("alert")).toContainText("Avanzel needs an AI agent to do the filing.", { timeout: 60_000 });
  await expect(
    capsule.getByText("Your note is safe in the inbox. Claude Code works best, and Settings → Agents has its install command.", { exact: true }),
  ).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "error", action: "open-settings:agents", actionLabel: "Open Settings" });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings"); // a new window: it opens on the pane its address names
  await expect(paneRadio(settings, "Agents")).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("Open Settings moves a Settings window that is open to the pane, and a pane that doesn't exist means General", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  await call(app, "showSettings", "no-such-pane"); // an address that names a pane the page doesn't have
  const settings = await windowFor(app, "settings");
  await expect(paneRadio(settings, "General")).toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings:voice");
  await expect(paneRadio(settings, "Voice")).toHaveAttribute("aria-checked", "true");
  await expect(paneRadio(settings, "General")).not.toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings:no-such-pane");
  await expect(paneRadio(settings, "General")).toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(paneRadio(settings, "Privacy")).toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings:tools"); // a pane Settings had once: its toolbar has no place for it
  await expect(paneRadio(settings, "General")).toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings:tasks"); // the scheduled reviews' pane, named Reviews
  await expect(paneRadio(settings, "Reviews")).toHaveAttribute("aria-checked", "true");
  await call(app, "openSettingsFor", "open-settings"); // an action that names no pane
  await expect(paneRadio(settings, "General")).toHaveAttribute("aria-checked", "true");
  // The open window gets settings:show-pane with whatever pane it is asked for; one it doesn't have means General.
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(paneRadio(settings, "Privacy")).toHaveAttribute("aria-checked", "true");
  await call(app, "showSettings", "no-such-pane");
  await expect(paneRadio(settings, "General")).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByRole("heading", { name: "General" })).toBeVisible();
  await app.close();
});

/** Dictates once with `audio` standing in for the microphone, then waits for the error card it ends in. */
async function dictateUntilCard(audio: string, error: string | RegExp): Promise<{ app: ElectronApplication; capsule: Page }> {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: audio, AVANZEL_FAKE_TRANSCRIPT: "unused" });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(error)).toBeVisible({ timeout: 30_000 });
  return { app, capsule };
}

/** Dictates once with `audio` standing in for the microphone, then clicks Open Settings on the error card it ends in. */
async function openSettingsAfterDictating(audio: string, error: string | RegExp): Promise<{ app: ElectronApplication; settings: Page }> {
  const { app, capsule } = await dictateUntilCard(audio, error);
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  return { app, settings: await windowFor(app, "settings") };
}

const scratchDir = () => mkdtempSync(path.join(tmpdir(), "avz-e2e-audio-"));

test("a recording too short to hold speech says nothing was heard or saved, and Choose microphone opens Settings → Voice", async () => {
  const blip = path.join(scratchDir(), "blip.wav");
  writeWav(blip, new Float32Array(1600)); // 0.1 s: under 0.3 s Avanzel doesn't try to transcribe
  const { app, capsule } = await dictateUntilCard(blip, "Nothing was heard.");
  // What happened, what is safe, and the one fix, which names what to do: the microphone is chosen in Voice.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "Nothing was heard.",
    detail: "Is the right microphone selected? Nothing was saved.",
    action: "open-settings:voice",
    actionLabel: "Choose microphone",
  });
  await expect(capsule.getByText("Is the right microphone selected? Nothing was saved.", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Open Settings", exact: true })).toHaveCount(0);
  await capsule.getByRole("button", { name: "Choose microphone", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(paneRadio(settings, "Voice")).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("Open Settings on a recording that can't be read opens Settings → Voice", async () => {
  const notAudio = path.join(scratchDir(), "speech.wav");
  writeFileSync(notAudio, "this is not a recording");
  const { app, settings } = await openSettingsAfterDictating(notAudio, /is not a PCM WAV file/);
  await expect(paneRadio(settings, "Voice")).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("a microphone that didn't start says why and that nothing was recorded, and Open Settings opens Settings → Voice", async () => {
  const library = await makeLibrary();
  const blip = path.join(scratchDir(), "blip.wav");
  writeWav(blip, new Float32Array(1600));
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: blip, AVANZEL_FAKE_TRANSCRIPT: "unused" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate"); // a recording starts, the fake audio standing in for the microphone
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // The capsule's page couldn't start the microphone, and reports why in the words getUserMedia gave.
  await call(app, "micError", "Requested device not found");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "The microphone didn't start.",
    detail: "Requested device not found. Nothing was recorded. Check the microphone in Settings → Voice.",
    action: "open-settings:voice",
    actionLabel: "Open Settings",
  });
  await expect(capsule.getByText("The microphone didn't start.")).toBeVisible();
  await expect(capsule.getByText("Requested device not found. Nothing was recorded. Check the microphone in Settings → Voice.", { exact: true })).toBeVisible();
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  // A microphone that gives no reason leaves the body with what is true, and no stray space before it.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "micError", "");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "The microphone didn't start.",
    detail: "Nothing was recorded. Check the microphone in Settings → Voice.",
  });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(paneRadio(settings, "Voice")).toHaveAttribute("aria-checked", "true");
  // The old way out, System Settings, is not what the card opens any more.
  expect(await call(app, "openedForTests")).toEqual([]);
  await app.close();
});
