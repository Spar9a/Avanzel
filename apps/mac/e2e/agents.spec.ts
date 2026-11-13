// Settings → Agents lists every agent, says whether each installed one can work, lets the person choose which one files,
// and names the model of the one in use. The library's agent is the fake one: a custom harness with no sign-in command,
// so its check is one short prompt, which runs only when Check agents is clicked. Claude Code and Codex are launch()'s
// stand-ins, which read as signed in when the pane opens.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, writeWav } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import {
  agentCalls,
  agentPath,
  agentStubs,
  alive,
  call,
  capsuleKind,
  filesUnder,
  launch,
  makeLibrary,
  noAgents,
  onlyAgentsIn,
  openSettings,
  paneOf,
  settingsRow,
  SIGNED_OUT_CLAUDE,
  snap,
  toolbarItem,
  UNREADABLE_CLAUDE,
  windowFor,
} from "./helpers.ts";
import { expectProblem } from "./capsule-helpers.ts";
import { sentToCapsule, watchCapsule } from "./setup-helpers.ts";

/** The one button that checks every installed agent. */
const checkAgents = (settings: Page) => settings.getByRole("button", { name: "Check agents", exact: true });

/**
 * The group of agents that file, "Who files your thoughts", whole. "Your other agents" below it has rows named Claude Code, Codex and
 * OpenCode too, in the page while folded away.
 */
const whoFiles = (settings: Page) => settings.locator("section", { has: settings.getByRole("heading", { name: "Who files your thoughts", exact: true }) });

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
  const settings = await openSettings(app, "Agents");
  const row = settingsRow(settings, "fake");
  // Nobody has asked about this agent yet, so its status isn't announced: it has no live region until Check agents.
  await expect(row.getByText("Installed", { exact: true })).toBeVisible();
  await expect(row.getByRole("status")).toHaveCount(0);
  await checkAgents(settings).click();
  await expect(row.getByRole("status")).toHaveText(/^fake.*Replied in \d+\.\d s$/, { timeout: 20_000 }); // by the agent's name
  await expect(checkAgents(settings)).toBeEnabled();
  // Opening the pane asked the fake agent nothing; Check agents asked it once.
  const prompts = readFileSync(record, "utf8").trim().split("\n").map((line) => (JSON.parse(line) as { prompt: string }).prompt);
  expect(prompts).toEqual(["Reply with the single word: ready."]);
  await app.close();
});

test("an agent whose reply asks to sign in says how, then what it said", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail-signin" });
  const settings = await openSettings(app, "Agents");
  const row = settingsRow(settings, "fake");
  await checkAgents(settings).click();
  // The fake agent draws a logged-out Cursor Agent's banner: its line ends in "Press any key to sign in...".
  await expect(row.getByText(/^Not signed in\. Sign in to fake in Terminal\. .*Press any key to sign in\.\.\.$/)).toBeVisible({ timeout: 20_000 });
  await app.close();
});

test("a problem is red only for the agent in use; a failure loses its Error label and ends as a sentence, and a sign-in command's no is the hint alone", async () => {
  // The fake agent, the library's, fails as Codex does: "ERROR: the model is not supported with this account".
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_MODE: "fail-noisy", PATH: agentPath({ claude: SIGNED_OUT_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  const claude = settingsRow(settings, "Claude Code").getByText("Not signed in.", { exact: false });
  await expect(claude).toHaveText("Not signed in. Run claude once in Terminal and sign in.", { timeout: 20_000 });
  await expect(claude).toHaveAttribute("data-tone", "secondary"); // Claude Code isn't the agent in use
  const fake = settingsRow(settings, "fake");
  await checkAgents(settings).click();
  const failure = fake.getByText("The model is not supported with this account.");
  await expect(failure).toHaveText("The model is not supported with this account.", { timeout: 20_000 });
  await expect(failure).toHaveAttribute("data-tone", "danger");
  await app.close();
});

test("Use on Codex's row makes Codex the agent that files, Use on the last row hands the choice back, and the agent in use names its model", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  const fake = settings.getByRole("group", { name: "fake", exact: true });
  const codex = settings.getByRole("group", { name: "Codex", exact: true });
  const automatic = settings.getByRole("group", { name: "Choose automatically", exact: true });
  // The library's own agent is the one chosen, and so the one in use: it names its model, which saves on Return.
  await expect(fake.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(automatic.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  const model = settings.getByRole("textbox", { name: "fake model" });
  await model.fill("small");
  await model.press("Enter");
  await expect.poll(() => loadSettings(library).models).toEqual({ fake: "small" });

  // Use, on Codex's row, files with Codex from now on. Its row is chosen, the fake agent's offers to be, and Codex has the model group.
  await codex.getByRole("button", { name: "Use", exact: true }).click();
  await expect.poll(() => loadSettings(library).harness).toBe("codex");
  await expect(codex.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(fake.getByRole("img", { name: "Chosen" })).toHaveCount(0);
  await expect(fake.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  await expect(codex.getByRole("button", { name: "Use", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Codex model" })).toHaveValue("");
  await expect(settings.getByRole("textbox", { name: "fake model" })).toHaveCount(0);
  expect(loadSettings(library).models).toEqual({ fake: "small" }); // the fake agent's model is kept

  // Use, on the last row, hands the choice back: the last row is chosen, no agent's is, and the agent in use is the one Automatic
  // picks, which is Claude Code's stand-in.
  await automatic.getByRole("button", { name: "Use", exact: true }).click();
  await expect.poll(() => loadSettings(library).harness).toBe("auto");
  await expect(automatic.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(automatic.getByRole("button", { name: "Use", exact: true })).toHaveCount(0);
  await expect(codex.getByRole("img", { name: "Chosen" })).toHaveCount(0);
  await expect(codex.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Claude Code", exact: true })).toBeVisible();
  // Claude Code's model is chosen from a list, which starts on the agent's own default: a pop-up button that says so, and no field.
  const claudeModel = settings.getByRole("button", { name: "Claude Code model: Agent's default", exact: true });
  await expect(claudeModel).toBeVisible();
  await expect(claudeModel).toHaveAttribute("aria-haspopup", "listbox");
  await expect(settings.getByRole("textbox", { name: "Claude Code model" })).toHaveCount(0);
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

test("Codex's model is chosen from the models Codex lists, and one saved that it doesn't list is shown as it was typed", async () => {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "codex", models: { codex: "typed-model" } });
  const codexHome = mkdtempSync(path.join(tmpdir(), "avz-e2e-codex-list-"));
  writeFileSync(
    path.join(codexHome, "models_cache.json"),
    JSON.stringify({
      models: [
        { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
        { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list" },
      ],
    }),
  );
  const app = await launch({ AVANZEL_LIBRARY: library, CODEX_HOME: codexHome });
  const settings = await openSettings(app, "Agents");
  // Codex lists its models, so its model is a choice button on the saved one, and there is no field.
  const model = settings.getByRole("button", { name: "Codex model: typed-model", exact: true });
  await expect(model).toBeVisible();
  await expect(model).toHaveAttribute("aria-haspopup", "listbox");
  await expect(settings.getByRole("textbox", { name: "Codex model" })).toHaveCount(0);
  const listed = ((await call(app, "snapshot")) as SettingsSnapshot).harnesses.find((h) => h.name === "codex")?.models;
  expect(listed).toEqual([{ value: "gpt-6-luna", label: "GPT-6-Luna" }]);
  await app.close();
});

test("a private model is turned on with its server's address and model, saved as they are typed, and says why the agent in use can't run it", async () => {
  const library = await makeLibrary();
  // Only the stand-ins for Claude Code and Codex are installed: this Mac's own pi or OpenCode would move the library to it.
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const settings = await openSettings(app, "Agents");
  const toggle = settings.getByRole("switch", { name: "Use a private model" });
  await expect(toggle).not.toBeChecked();
  // Off, its rows are folded away and the agent's own model field is there.
  const rows = settings.locator(".av-group-reveal").first();
  await expect(rows).toHaveAttribute("inert", ""); // folded away: its fields can't be reached
  await expect(settings.getByRole("textbox", { name: "fake model" })).toBeVisible();
  await toggle.click();
  await expect(rows).not.toHaveAttribute("inert", "");
  await expect.poll(() => loadSettings(library).private.enabled).toBe(true);
  const address = settings.getByRole("textbox", { name: "Server address" });
  await address.fill(" http://127.0.0.1:8765/v1 ");
  await address.press("Enter");
  const name = settings.getByRole("textbox", { name: "Private model name" });
  await name.fill("mlx-community/Qwen3.5-4B-MLX-4bit");
  await name.press("Tab"); // the focus leaves the field, which saves it
  await expect
    .poll(() => loadSettings(library).private)
    .toEqual({ enabled: true, source: "own", hostedModel: "qwen3.5-4b", baseUrl: "http://127.0.0.1:8765/v1", model: "mlx-community/Qwen3.5-4B-MLX-4bit", api: "chat", contextWindow: 65_536, keyEnv: "" });
  // The agent's own model is replaced by the private one, so its field is gone. The fake agent doesn't speak the server, and pi and
  // OpenCode aren't installed here, so the window says what is wrong and what is safe, and what to install.
  await expect(settings.getByRole("textbox", { name: "fake model" })).toHaveCount(0);
  await expect(settings.getByText("A server that speaks OpenAI chat completions works with pi or opencode.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Filing stops until this is fixed, and nothing is sent to any other server.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Install pi or OpenCode to use this model.", { exact: true })).toBeVisible();
  // Off again, the agent's own model field is back and the private settings are kept.
  await toggle.click();
  await expect.poll(() => loadSettings(library).private.enabled).toBe(false);
  await expect(settings.getByRole("textbox", { name: "fake model" })).toBeVisible();
  expect(loadSettings(library).private.model).toBe("mlx-community/Qwen3.5-4B-MLX-4bit");
  await app.close();
});

test("turning a private model on moves the library to an installed agent that speaks the server, and then nothing is wrong", async () => {
  const library = await makeLibrary();
  saveSettings(library, {
    ...loadSettings(library),
    private: { enabled: false, source: "own", hostedModel: "qwen3.5-4b", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", api: "messages", contextWindow: 65_536, keyEnv: "" },
  });
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const settings = await openSettings(app, "Agents");
  await settings.getByRole("switch", { name: "Use a private model" }).click();
  // Claude Code speaks Anthropic Messages and its stand-in is installed, so it becomes the agent that files.
  await expect.poll(() => loadSettings(library).harness).toBe("claude");
  expect(loadSettings(library).private.enabled).toBe(true);
  await expect(settingsRow(settings, "Claude Code").getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Private model agent: Claude Code", exact: true })).toBeVisible();
  await expect(settings.getByText("Filing stops until this is fixed", { exact: false })).toHaveCount(0);
  // Claude Code's own model list is gone: the model is the server's.
  await expect(settings.getByRole("button", { name: /^Claude Code model/ })).toHaveCount(0);
  await app.close();
});

/** A stand-in for llama-server that answers /health and wants its key (a Bearer token) on /v1/models. */
const STAND_IN_SERVER = `#!${process.execPath}
const fs = require("node:fs");
const http = require("node:http");
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
const key = fs.readFileSync(get("--api-key-file"), "utf8");
http.createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
  if (req.headers.authorization !== "Bearer " + key) { res.statusCode = 401; return res.end("no"); }
  res.end(JSON.stringify({ models: [get("--alias")] }));
}).listen(Number(get("--port")), "127.0.0.1");
`;

/** The server's tarball and the model's file, as GitHub and Hugging Face would give them, and the file the app reads to use them. */
async function hostedStand(): Promise<{ env: Record<string, string>; close: () => void }> {
  const weights = "pretend weights ".repeat(64);
  const src = mkdtempSync(path.join(tmpdir(), "avz-e2e-hosted-"));
  mkdirSync(path.join(src, "llama-t1"));
  writeFileSync(path.join(src, "llama-t1", "llama-server"), STAND_IN_SERVER, { mode: 0o755 });
  execFileSync("/usr/bin/tar", ["-czf", path.join(src, "e.tgz"), "-C", src, "llama-t1"]);
  const tar = readFileSync(path.join(src, "e.tgz"));
  const server = createServer((req, res) => {
    if (req.url === "/e.tgz") return void res.end(tar);
    if (req.url?.endsWith("/tiny.gguf")) return void res.end(weights);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
  const stub = path.join(src, "stub.json");
  writeFileSync(
    stub,
    JSON.stringify({
      modelsUrl: base,
      idleMs: 1500,
      engine: { tag: "t1", url: `${base}/e.tgz`, size: tar.length, sha256: sha(tar) },
      model: { file: { repo: "test/tiny", revision: "abc", name: "tiny.gguf", size: Buffer.byteLength(weights), sha256: sha(weights) } },
    }),
  );
  return { env: { AVANZEL_HOSTED_STUB: stub }, close: () => server.close() };
}

test("a model Avanzel hosts is downloaded in Settings, chosen, run by its own server for the agent, and stopped when nothing needs it", async () => {
  const stand = await hostedStand();
  const seen = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-seen-")), "claude.txt");
  const library = await makeLibrary();
  // Only stand-ins for Claude Code and Codex are installed. This Claude Code notes where its run was pointed.
  const app = await launch({
    AVANZEL_LIBRARY: library,
    ...stand.env,
    ...onlyAgentsIn(agentStubs({ claude: `echo "$ANTHROPIC_BASE_URL $ANTHROPIC_AUTH_TOKEN" >> '${seen}'; echo ready` })),
  });
  const settings = await openSettings(app, "Agents");
  await settings.getByRole("switch", { name: "Use a private model" }).click();
  const row = settingsRow(settings, "Qwen3.5-4B on this Mac");
  await expect(row).toBeVisible();
  await expect(row.getByText("Apache 2.0", { exact: true })).toBeVisible();
  await expect(row.getByText(/Runs on this Mac only, and works offline\./)).toBeVisible();

  // Download fetches the server and the model, and ends with Remove download.
  await row.getByRole("button", { name: /^Download/ }).click();
  await expect(row.getByRole("button", { name: "Remove download", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText(/It starts when a note is filed, and stops after ten idle minutes\./)).toBeVisible();

  // Use makes it the model, moves the library to an installed agent that can run it, and folds the server's own rows away.
  await row.getByRole("button", { name: "Use", exact: true }).click();
  await expect.poll(() => loadSettings(library).private.source).toBe("hosted");
  await expect.poll(() => loadSettings(library).harness).toBe("claude");
  await expect(row.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(settings.locator(".av-group-reveal .av-group-reveal")).toHaveAttribute("inert", "");
  await expect(settings.getByText("Filing stops until this is fixed", { exact: false })).toHaveCount(0);

  // A run starts the server on this Mac, with a key of its own, and the agent is pointed at it.
  // A check already under way is left to finish, so the one this asks for waits for the sign-in read the pane started as it opened.
  await expect.poll(async () => (await statusOf(app, "claude"))?.kind, { timeout: 20_000 }).not.toBe("checking");
  await call(app, "checkAgent", "claude");
  // (Its own sign-in read, before the private model was on, noted a blank line first.)
  await expect.poll(() => (existsSync(seen) ? readFileSync(seen, "utf8") : ""), { timeout: 20_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+ avz-/m);
  const [base, key] = readFileSync(seen, "utf8").trim().split("\n").at(-1)!.split(" ") as [string, string];
  expect((await fetch(`${base}/v1/models`)).status).toBe(401);
  expect((await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
  // Nothing holds it once the run is over, so it stops after its idle time.
  await expect.poll(() => fetch(`${base}/health`).then(() => "up", () => "down"), { timeout: 15_000 }).toBe("down");

  // Remove download takes the model and the server away.
  await row.getByRole("button", { name: "Remove download", exact: true }).click();
  await expect(row.getByRole("button", { name: /^Download/ })).toBeVisible();
  await expect(settings.getByText("Qwen3.5-4B isn't downloaded yet.", { exact: true })).toBeVisible();
  await app.close();
  stand.close();
});

test("the private model's key is generated or pasted, kept by the app and never in the library, copied to give the server, and removed", async () => {
  const library = await makeLibrary();
  saveSettings(library, {
    ...loadSettings(library),
    private: { enabled: true, source: "own", hostedModel: "qwen3.5-4b", baseUrl: "http://127.0.0.1:8765/v1", model: "m", api: "chat", contextWindow: 65_536, keyEnv: "" },
  });
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const settings = await openSettings(app, "Agents");
  const userData = await app.evaluate(({ app: electron }) => electron.getPath("userData"));
  const keyFile = path.join(userData, "private-key.bin");
  const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const generate = settings.getByRole("button", { name: "Generate", exact: true });
  await expect(generate).toBeVisible();
  await expect(settings.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);

  // Generate keeps a new key, and the buttons become Copy and Remove. The key is in the app's data and not in the library.
  await generate.click();
  await expect(settings.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
  const generated = readFileSync(keyFile, "utf8");
  expect(generated).toMatch(/^avz-[A-Za-z0-9_-]{43}$/);
  expect(readFileSync(path.join(library, ".avanzel", "config.toml"), "utf8")).not.toContain(generated);
  expect(((await call(app, "snapshot")) as SettingsSnapshot).library?.privateKeySaved).toBe(true);
  expect(JSON.stringify(await call(app, "snapshot"))).not.toContain(generated); // a window never gets the key back

  // Copy puts it on the clipboard, for the server's own settings.
  await settings.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(clipboardText).toBe(generated);

  // Remove forgets it.
  await settings.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(generate).toBeVisible();
  expect(existsSync(keyFile)).toBe(false);

  // Paste takes the clipboard's text as the key, when it is one. A text with spaces in it isn't, and nothing is kept.
  await app.evaluate(({ clipboard }) => clipboard.writeText("two words here"));
  await settings.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(settings.getByText(/isn't a key/)).toBeVisible();
  expect(existsSync(keyFile)).toBe(false);
  await app.evaluate(({ clipboard }) => clipboard.writeText("  my-server-key-123\n"));
  await settings.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  expect(readFileSync(keyFile, "utf8")).toBe("my-server-key-123");
  await app.close();
});

test("an agent's name stays on one line beside its controls, with its status under it, in a pane that scrolls", async () => {
  // Claude Code is signed out and isn't the agent chosen: its row holds the longest status, "Best results" and Use.
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), PATH: agentPath({ claude: SIGNED_OUT_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  await app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/panel/"))!;
    panel.setSize(panel.getSize()[0]!, 400); // short enough that the pane scrolls
  });
  await expect.poll(() => settings.evaluate(() => window.innerHeight)).toBe(400);
  // Whether a scrolling pane gives 15 px of every row to a classic scrollbar depends on how this Mac shows scrollbars.
  // Make it the narrower case, whatever the setting.
  await settings.addStyleTag({ content: "main::-webkit-scrollbar { width: 15px; }" });
  await expect(settingsRow(settings, "Claude Code").getByText("Not signed in.", { exact: false })).toBeVisible({ timeout: 20_000 });
  // The pane scrolls and the page doesn't. A field's hidden label is placed against the page unless the pane holds it, so
  // one below the pane's fold stretched the page: a second scrollbar, which took another 15 px from every row.
  expect(await settings.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), "the page doesn't scroll").toBeLessThanOrEqual(0);
  // Every name is on one line, as short Codex's is: not wrapped at its space, and not broken letter by letter.
  const height = async (name: string) => {
    const box = await whoFiles(settings).getByText(name, { exact: true }).boundingBox();
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
  const row = (name: string) => whoFiles(settings).locator(".av-group-row", { has: settings.getByText(name, { exact: true }) });
  for (const name of ["Claude Code", "Codex", "OpenCode", "Cursor Agent", "Gemini CLI"]) {
    await expect(row(name).getByText(/^(Experimental\. )?Not installed$/)).toBeVisible();
    await expect(row(name).getByRole("button", { name: /^Use/ })).toHaveCount(0); // nothing to use
  }
  await expect(checkAgents(settings)).toHaveCount(0); // nothing to check
  await expect(row("Claude Code").getByText("Not installed", { exact: true })).toHaveAttribute("data-tone", "danger"); // the agent in use
  await expect(row("Codex").getByText("Not installed", { exact: true })).toHaveAttribute("data-tone", "secondary");
  await expect(row("Claude Code").getByRole("img", { name: "Chosen" })).toBeVisible(); // chosen, installed or not
  await expect(settings.getByRole("img", { name: "Chosen" })).toHaveCount(1);
  await expect(settings.getByText("Best results", { exact: true })).toHaveCount(1);
  await expect(settings.getByText(/^Experimental\. /)).toHaveCount(2); // Gemini CLI's and pi's descriptions
  await snap(settings, "settings-agents-none");

  // Only Claude Code and Codex have an install command. Main copies the one it holds for the agent, and the button says so for 2 s.
  await expect(settings.getByRole("button", { name: "Copy install command" })).toHaveCount(2);
  await expect(row("OpenCode").getByRole("button")).toHaveCount(0);
  await expect(row("OpenCode").getByRole("group")).toHaveCount(0); // nothing to choose or press: no empty group to hear
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
    await expect(settingsRow(settings, name).getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  }
  // Nobody asked for these reads, so VoiceOver isn't told of them: no row's status is a live region.
  await expect(settings.getByRole("status")).toHaveCount(0);
  // The stand-ins are first on the app's PATH, ahead of what widenedPath adds, so this Mac's own CLIs never ran.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  await app.close();
});

test("a free check that can't read the sign-in leaves the agent unchecked, and Check agents then asks its one question", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), PATH: agentPath({ claude: UNREADABLE_CLAUDE }) });
  const settings = await openSettings(app, "Agents");
  await expect(settingsRow(settings, "Codex").getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  const claude = settingsRow(settings, "Claude Code");
  await expect.poll(() => agentCalls(app), { timeout: 20_000 }).toContain("claude auth status");
  await expect(claude.getByText("Installed", { exact: true })).toBeVisible();
  await expect(checkAgents(settings)).toBeVisible();
  expect(await statusOf(app, "claude")).toBeNull();
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude"))).toEqual(["claude auth status"]); // no prompt
  await checkAgents(settings).click();
  await expect(claude.getByRole("status")).toHaveText(/^Claude Code.*Replied in \d+\.\d s$/, { timeout: 20_000 });
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude -p"))).toHaveLength(1);
  await app.close();
});

// The agent runs detached, in a process group of its own, and the check's 15 s timeout lives in Avanzel: an agent
// that hangs would outlive the app unless quitting stops it.
test("quitting while an agent check hangs stops the agent", async () => {
  const record = recordFile();
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), FAKE_AGENT_RECORD: record, FAKE_AGENT_DELAY_MS: "60000" });
  const settings = await openSettings(app, "Agents");
  const row = settingsRow(settings, "fake");
  const check = checkAgents(settings);
  await check.click();
  await expect(row.getByRole("status")).toContainText("Checking…");
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
  await checkAgents(await openSettings(app, "Agents")).click();
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

// An error card's "Open Settings" opens the pane where the problem is fixed, not always General. Each pane is an item on
// the window's toolbar, marked as the page in view.

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
  await expectProblem(capsule, {
    title: "Avanzel needs an AI agent to do the filing.",
    lines: ["Your note is safe in the inbox. Claude Code works best, and Settings → Agents has its install command."],
    fix: "Open Settings",
  });
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "error", action: "open-settings:agents", actionLabel: "Open Settings" });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "panel"); // a new window: it opens on the pane its address names
  await expect(toolbarItem(settings, "Agents")).toHaveAttribute("aria-selected", "true");
  await app.close();
});

test("Open Settings moves a Settings window that is open to the pane, and a pane that doesn't exist means General", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  await call(app, "showSettings", "no-such-pane"); // an address that names a pane the page doesn't have
  const settings = await windowFor(app, "panel");
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "true");
  await call(app, "openSettingsFor", "open-settings:voice");
  await expect(toolbarItem(settings, "Voice")).toHaveAttribute("aria-selected", "true");
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "false");
  await call(app, "openSettingsFor", "open-settings:no-such-pane");
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "true");
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(toolbarItem(settings, "Privacy")).toHaveAttribute("aria-selected", "true");
  await call(app, "openSettingsFor", "open-settings:tools"); // a pane Settings had once: its toolbar has no place for it
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "true");
  await call(app, "openSettingsFor", "open-settings:tasks"); // the scheduled reviews' pane, named Reviews
  await expect(toolbarItem(settings, "Reviews")).toHaveAttribute("aria-selected", "true");
  await call(app, "openSettingsFor", "open-settings"); // an action that names no pane
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "true");
  // The open window gets settings:show-pane with whatever pane it is asked for; one it doesn't have means General.
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(toolbarItem(settings, "Privacy")).toHaveAttribute("aria-selected", "true");
  await call(app, "showSettings", "no-such-pane");
  await expect(toolbarItem(settings, "General")).toHaveAttribute("aria-selected", "true");
  await app.close();
});

/** Dictates once with `audio` standing in for the microphone, heard as `transcript`, then waits for the error card it ends in. */
async function dictateUntilCard(audio: string, error: string | RegExp, transcript = "unused"): Promise<{ app: ElectronApplication; capsule: Page }> {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: audio, AVANZEL_FAKE_TRANSCRIPT: transcript });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(error)).toBeVisible({ timeout: 30_000 });
  return { app, capsule };
}

const scratchDir = () => mkdtempSync(path.join(tmpdir(), "avz-e2e-audio-"));

test("a recording the microphone gave nothing to says nothing was heard or saved, and Choose microphone opens Settings → Voice", async () => {
  const blip = path.join(scratchDir(), "blip.wav");
  writeWav(blip, new Float32Array(1600)); // 0.1 s of digital silence: no input at all, however short
  const { app, capsule } = await dictateUntilCard(blip, "Nothing was heard.");
  // What happened, what is safe, and the one fix, which names what to do: the microphone is chosen in Voice.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "Nothing was heard.",
    detail: "Is the right microphone selected? Nothing was saved.",
    action: "open-settings:voice",
    actionLabel: "Choose microphone",
  });
  await expectProblem(capsule, { title: "Nothing was heard.", lines: ["Is the right microphone selected? Nothing was saved."], fix: "Choose microphone" });
  await capsule.getByRole("button", { name: "Choose microphone", exact: true }).click();
  const settings = await windowFor(app, "panel");
  await expect(toolbarItem(settings, "Voice")).toHaveAttribute("aria-selected", "true");
  await app.close();
});

/** `seconds` of steady, quiet sound: a microphone that hears a room, and no words in it. */
function roomTone(seconds: number): string {
  const file = path.join(scratchDir(), "room.wav");
  writeWav(file, new Float32Array(Math.round(seconds * 16000)).fill(0.01));
  return file;
}

test("a short recording with no words in it just goes: a press and a change of mind needs no card", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: roomTone(1), AVANZEL_FAKE_TRANSCRIPT: "" });
  await windowFor(app, "capsule");
  await watchCapsule(app);
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => sentToCapsule(app), { timeout: 30_000 }).toEqual(expect.arrayContaining(["transcribing", "hidden"]));
  expect(await sentToCapsule(app)).not.toContain("error");
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("a recording past five seconds with no words in it says nothing was heard", async () => {
  const { app, capsule } = await dictateUntilCard(roomTone(6), "Nothing was heard.", "");
  await expectProblem(capsule, { title: "Nothing was heard.", lines: ["Is the right microphone selected? Nothing was saved."], fix: "Choose microphone" });
  await app.close();
});

test("a recording that can't be read says it couldn't be turned into words, why, and that nothing was saved", async () => {
  const notAudio = path.join(scratchDir(), "speech.wav");
  writeFileSync(notAudio, "this is not a recording");
  const { app, capsule } = await dictateUntilCard(notAudio, /is not a PCM WAV file/);
  // The file never reached the library, so there is no recording to say where it is; and no fix: the next recording is the way on.
  // The reason is Avanzel's own, told whole, as a sentence: with a capital, as any line of a card is.
  const why = /^Speech\.wav is not a PCM WAV file \(.+\)\. Nothing was saved\.$/;
  await expectProblem(capsule, { title: "The recording couldn't be turned into words.", lines: [why] });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "The recording couldn't be turned into words.",
    detail: expect.stringMatching(why),
  });
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
  await expectProblem(capsule, {
    title: "The microphone didn't start.",
    lines: ["Requested device not found. Nothing was recorded. Check the microphone in Settings → Voice."],
    fix: "Open Settings",
  });
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
  await expectProblem(capsule, {
    title: "The microphone didn't start.",
    lines: ["Nothing was recorded. Check the microphone in Settings → Voice."],
    fix: "Open Settings",
  });
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "panel");
  await expect(toolbarItem(settings, "Voice")).toHaveAttribute("aria-selected", "true");
  // The old way out, System Settings, is not what the card opens any more.
  expect(await call(app, "openedForTests")).toEqual([]);
  await app.close();
});

/** Settings → Agents' "Your other agents", whole: the switch and the rows it reveals. */
const otherAgents = (settings: Page) => settings.locator("section", { has: settings.getByRole("heading", { name: "Your other agents", exact: true }) });

/** A row of "Your other agents", by its client's name. */
const clientRow = (settings: Page, name: string) => otherAgents(settings).locator(".av-group-row", { has: settings.getByText(name, { exact: true }) });

/** What the app keeps in its settings file. */
const appSettings = async (app: ElectronApplication) =>
  JSON.parse(readFileSync(path.join((await app.evaluate(() => process.env.AVANZEL_USER_DATA)) ?? "", "settings.json"), "utf8")) as Record<string, unknown>;

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "Codex", "OpenCode", "Gemini CLI"];

test("Your other agents: the switch lets them in, Copy setup gives Cursor its snippet, and Add to Claude Code adds Avanzel", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Agents");
  const toggle = settings.getByRole("switch", { name: "Let your other agents use this library" });
  await expect(toggle).not.toBeChecked();
  // Off: the clients' rows are folded away, out of reach, with nothing to press.
  const reveal = otherAgents(settings).locator(".av-group-reveal");
  await expect(reveal).toHaveAttribute("inert", "");
  await expect(otherAgents(settings).getByRole("button").and(settings.locator(":not([inert] *)"))).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(reveal).not.toHaveAttribute("inert", "");
  for (const name of CLIENTS) await expect(clientRow(settings, name)).toBeVisible();
  await expect(clientRow(settings, "Cursor").getByText("Paste this into ~/.cursor/mcp.json.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await appSettings(app)).agentAccess).toBe(true);
  // Main copies the snippet it makes for Cursor: the dev app's launch, with --mcp. The button says so for 2 s.
  await clientRow(settings, "Cursor").getByRole("button", { name: "Copy setup" }).click();
  await expect(clientRow(settings, "Cursor").getByRole("button", { name: "Copied" })).toBeVisible();
  await expect.poll(() => call(app, "copiedForTests")).toHaveLength(1);
  const [snippet] = (await call(app, "copiedForTests")) as string[];
  const server = (JSON.parse(snippet!) as { mcpServers: { avanzel: { type: string; args: string[] } } }).mcpServers.avanzel;
  expect(server.type).toBe("stdio");
  expect(server.args.at(-1)).toBe("--mcp");

  // The stand-in claude takes `mcp add` and says it added the server.
  await clientRow(settings, "Claude Code").getByRole("button", { name: "Add to Claude Code" }).click();
  await expect(clientRow(settings, "Claude Code").getByRole("button", { name: "Added" })).toBeVisible();
  expect((await agentCalls(app)).filter((line) => line.startsWith("claude mcp add"))).toEqual([
    expect.stringMatching(/^claude mcp add avanzel --scope user -- \S+ .*--mcp$/),
  ]);
  await expect(settings.getByText("Avanzel couldn't be added to Claude Code.")).toHaveCount(0);

  // Privacy says what connected agents can read, and where it goes.
  await toolbarItem(settings, "Privacy").click();
  await expect(paneOf(settings, "Privacy").getByText(/unfiled captures and call notes included, and what they read goes to their providers\.$/)).toBeVisible();
  await toolbarItem(settings, "Agents").click();

  // Off again: the rows fold away, and the file says so.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(reveal).toHaveAttribute("inert", "");
  await expect.poll(async () => (await appSettings(app)).agentAccess).toBe(false);
  await app.close();
});

test("Add to Claude Code that fails says why, that the library is safe, and offers the command to copy", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_CLAUDE_MCP_FAIL: "1" });
  const settings = await openSettings(app, "Agents");
  await settings.getByRole("switch", { name: "Let your other agents use this library" }).click();
  await clientRow(settings, "Claude Code").getByRole("button", { name: "Add to Claude Code" }).click();
  const notice = settings.getByRole("group", { name: "Avanzel couldn't be added to Claude Code." });
  await expect(settings.getByText("Avanzel couldn't be added to Claude Code.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Config file is not writable. Nothing in your library changed.", { exact: true })).toBeVisible();
  await expect(clientRow(settings, "Claude Code").getByRole("button", { name: "Add to Claude Code" })).toBeVisible(); // not added
  await notice.getByRole("button", { name: "Copy setup" }).click();
  await expect(notice.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect.poll(() => call(app, "copiedForTests")).toEqual([expect.stringMatching(/^claude mcp add avanzel --scope user -- \S+ .*--mcp$/)]);
  await app.close();
});

test("Add to Claude Code on a Mac without Claude Code says it isn't installed", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), ...onlyAgentsIn(bin) });
  const settings = await openSettings(app, "Agents");
  await settings.getByRole("switch", { name: "Let your other agents use this library" }).click();
  await clientRow(settings, "Claude Code").getByRole("button", { name: "Add to Claude Code" }).click();
  await expect(settings.getByText("Claude Code isn't installed on this Mac. Nothing in your library changed.", { exact: true })).toBeVisible();
  await app.close();
});
