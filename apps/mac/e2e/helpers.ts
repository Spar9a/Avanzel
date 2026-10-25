import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { MODELS, Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import { encodePng } from "../src/main/png.ts";
import type { SetupSnapshot } from "../src/shared/ipc.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const appDir = path.resolve(here, "..");
const repo = path.resolve(appDir, "..", "..");
const fakeAgent = path.join(repo, "packages", "engine", "test", "fake-agent.mjs");
export const shots = path.join(appDir, "test-results", "shots");

/** A library made by the engine itself, with the fake agent as its harness. */
export async function makeLibrary({ git = false }: { git?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-"));
  const vault = await Vault.init(root, { git });
  const settings = loadSettings(vault.root);
  saveSettings(vault.root, {
    ...settings,
    harness: "fake",
    timeoutSeconds: 30,
    harnesses: { fake: { name: "fake", headless: [process.execPath, fakeAgent, "{prompt}"], interactive: [] } },
  });
  return root;
}

/** What `say` made for each `${voice}\n${text}` in this process: the suite says few texts, and `say` takes about 0.8 s a call. */
const spoken = new Map<string, string>();

/**
 * A new WAV file of `voice` saying `text`. `say` speaks each voice and text once per process; the file it made stays here,
 * and every call (the first too) hands out a copy of it in its own folder, so a test may delete or move its file.
 */
export function speechWav(text: string, voice = "Samantha"): string {
  const key = `${voice}\n${text}`;
  let made = spoken.get(key);
  if (made === undefined) {
    made = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-wav-")), "speech.wav");
    execFileSync("say", ["-v", voice, "-o", made, "--data-format=LEI16@16000", text]);
    spoken.set(key, made);
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-wav-")), "speech.wav");
  copyFileSync(made, file);
  return file;
}

/** A small screenshot with a window on it, or (`blank`) the black picture macOS hands an app it doesn't let see the screen. */
export function screenshotFixture({ blank = false }: { blank?: boolean } = {}): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-png-")), "screen.png");
  const width = 320;
  const height = 200;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (blank) rgba.set([0, 0, 0, 255], i);
      else rgba.set(y < 24 ? [226, 226, 230, 255] : x > 30 && x < 120 && y > 50 && y < 170 ? [44, 44, 48, 255] : [244, 244, 246, 255], i);
    }
  }
  writeFileSync(file, encodePng(width, height, rgba));
  return file;
}

/** How the stand-ins for Claude Code and Codex answer, by binary: signed in, and a short reply to anything else. */
export const SIGNED_IN: Readonly<Record<string, string>> = {
  claude: `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else echo ready; fi`,
  codex: `if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT" >&2; else echo ready; fi`, // Codex answers on stderr
};

/** A `claude` that is installed but not signed in: its sign-in command says so and exits 1, as Claude Code's does. */
export const SIGNED_OUT_CLAUDE = `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; else echo ready; fi`;

/** A `codex` that is installed but not signed in: its sign-in command says so on stderr and exits 1, as Codex's does. */
export const SIGNED_OUT_CODEX = `if [ "$1 $2" = "login status" ]; then echo "Not logged in" >&2; exit 1; else echo ready; fi`;

/** A `claude` whose sign-in command prints nothing a check understands, as an older Claude Code may. */
export const UNREADABLE_CLAUDE = `if [ "$1 $2" = "auth status" ]; then echo "unknown command: auth"; exit 1; else echo ready; fi`;

/** `env` as the assignments that go in front of a stand-in's exec, so they steer that stand-in alone. */
const steering = (env: Record<string, string>) => Object.entries(env).map(([name, value]) => `${name}='${value}' `).join("");

/**
 * A `claude` for agentStubs that files: signed in, and any other call runs the engine's fake agent with the prompt,
 * which Claude Code's argv puts after -p. The FAKE_AGENT_* variables a test launches with steer it; so do `env`'s, which
 * steer this stand-in alone (say `{ FAKE_AGENT_MODE: "limit" }`): they go in front of its exec, so the agents of one
 * launch can each act differently.
 */
export function filingClaude(env: Record<string, string> = {}): string {
  return `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else ${steering(env)}exec '${process.execPath}' '${fakeAgent}' "$2"; fi`;
}

/**
 * A `claude` for agentStubs that isn't signed in: its sign-in command says so and exits 1, as Claude Code's does, and any
 * other call fails asking to sign in ("not logged in"). A test signs it in, as the person would in Terminal, with
 * answerAs(dir, "claude", filingClaude()). `env` steers this stand-in alone, as filingClaude's does. With `readable` false
 * its sign-in command says nothing a check understands, as an older Claude Code's may (UNREADABLE_CLAUDE), so only a
 * question put to the model could tell whether it is signed in.
 */
export function signedOutClaude(env: Record<string, string> = {}, { readable = true } = {}): string {
  const failing = steering({ FAKE_AGENT_MODE: "fail", ...env });
  const status = readable ? `echo '{"loggedIn": false}'` : `echo "unknown command: auth"`;
  return `if [ "$1 $2" = "auth status" ]; then ${status}; exit 1; else ${failing}exec '${process.execPath}' '${fakeAgent}' "$2"; fi`;
}

/**
 * A `codex` for agentStubs that files: signed in, and any other call runs the engine's fake agent with all of Codex's argv
 * (`exec … -o <file> <prompt>`), which makes it answer as Codex does, in the -o file. `env` steers this stand-in alone, as
 * filingClaude's does.
 */
export function filingCodex(env: Record<string, string> = {}): string {
  return `if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT" >&2; else ${steering(env)}exec '${process.execPath}' '${fakeAgent}' "$@"; fi`;
}

/**
 * A new folder of stand-ins for Claude Code and Codex: shell scripts answering as SIGNED_IN does, except for the
 * `answers` given (script bodies, by binary). Each one notes how it was called, "claude auth status", in calls.log
 * beside it (see agentCalls).
 */
export function agentStubs(answers: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-agents-"));
  for (const [name, body] of Object.entries({ ...SIGNED_IN, ...answers })) answerAs(dir, name, body);
  return dir;
}

/**
 * Makes stand-in `name` in the agentStubs folder `dir` answer with `body` (a script body) from its next call on, still
 * noting each call in calls.log: as when the person signs the agent in, in Terminal, while Avanzel runs.
 */
export function answerAs(dir: string, name: string, body: string): void {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> '${path.join(dir, "calls.log")}'\n${body}\n`);
  chmodSync(file, 0o755);
}

/** This process's PATH with new agentStubs(answers) first: what launch() gives the app unless the test passes a PATH. */
export const agentPath = (answers: Record<string, string> = {}) => `${agentStubs(answers)}:${process.env.PATH ?? ""}`;

/**
 * The launch variables of a Mac whose only agents are the stand-ins in `bin`, a folder of agentStubs' or answerAs' making:
 * main keeps PATH as it is given (AVANZEL_EXACT_PATH), and only the system folders follow `bin`. A test whose outcome
 * depends on which agents are installed launches with these, or it finds this Mac's own Claude Code, Codex, OpenCode and
 * Cursor Agent, and offers or runs them.
 */
export const onlyAgentsIn = (bin: string): Record<string, string> => ({
  AVANZEL_EXACT_PATH: "1",
  PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
});

/**
 * How the app has called the stand-ins so far, oldest first. They are the first folder on its PATH: with AVANZEL_TEST
 * set, the app keeps the PATH it was given ahead of what widenedPath adds, so no test reaches this Mac's own CLIs.
 */
export async function agentCalls(app: ElectronApplication): Promise<string[]> {
  const [first = ""] = (await app.evaluate(() => process.env.PATH ?? "")).split(":");
  const log = path.join(first, "calls.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

export async function launch(env: Record<string, string>, switches: string[] = []): Promise<ElectronApplication> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined)) as Record<string, string>;
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const packaged = process.env.AVANZEL_E2E_PACKAGED;
  return electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: packaged ? switches : [appDir, ...switches],
    cwd: appDir,
    // Nothing listens on port 9, so a speech model download fails at once unless the test passes a fakeModelHub's url.
    // The shortcuts register with a stand-in that holds none for real and finds none taken unless the test lists them,
    // so no test depends on which shortcuts this Mac's other apps hold. Stand-ins for Claude Code and Codex come first
    // on PATH, so no test runs this Mac's own (whose prompts cost the owner's quota); a test may pass its own PATH.
    env: {
      ...clean,
      AVANZEL_TEST: "1",
      AVANZEL_USER_DATA: userData,
      AVANZEL_MODELS_URL: "http://127.0.0.1:9",
      AVANZEL_FAKE_TAKEN_SHORTCUTS: "",
      PATH: agentPath(),
      ...env,
    },
  });
}

/** Servers `fakeModelHub` started that `closeModelHubs` hasn't closed yet. */
const modelHubs = new Set<Server>();

/**
 * A local stand-in for huggingface.co, to pass as AVANZEL_MODELS_URL: it serves `/<repo>/resolve/<revision>/<file>`
 * for the real MODELS and keeps every path asked for in `requests`. "stall" answers 200 with the file's pinned
 * content-length, sends 64 KB and holds the connection, so the download stays in progress; "trickle" does the same,
 * then sends 16 KB more every 100 ms, so its progress keeps moving; "missing" answers 404, so it fails. A spec that
 * uses it runs `test.afterEach(closeModelHubs)`, which closes it when the test ends.
 */
export async function fakeModelHub(mode: "stall" | "trickle" | "missing"): Promise<{ url: string; requests: string[] }> {
  const sizes = new Map<string, number>();
  for (const { repo, revision, digests } of Object.values(MODELS)) {
    for (const [name, { size }] of Object.entries(digests)) sizes.set(`/${repo}/resolve/${revision}/${name}`, size);
  }
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    const size = sizes.get(url);
    if (mode === "missing" || size === undefined) {
      res.writeHead(404).end("Entry not found");
      return;
    }
    res.writeHead(200, { "content-length": size, "content-type": "application/octet-stream" });
    // 64 KB, or all but the last byte of a smaller file: the connection stays open until the hub closes.
    let sent = Math.min(64 * 1024, size - 1);
    res.write(Buffer.alloc(sent));
    if (mode !== "trickle") return;
    const more = setInterval(() => {
      const next = Math.min(16 * 1024, size - 1 - sent);
      if (next <= 0 || res.destroyed) return clearInterval(more);
      sent += next;
      res.write(Buffer.alloc(next));
    }, 100);
    res.on("close", () => clearInterval(more));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  modelHubs.add(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

/** Closes every `fakeModelHub` and the downloads it holds; for `test.afterEach`. */
export function closeModelHubs(): void {
  for (const server of modelHubs) {
    server.closeAllConnections();
    server.close();
  }
  modelHubs.clear();
}

/** A new, empty Hugging Face cache to pass as HF_HUB_CACHE, so the app never finds this Mac's own copy of a model. */
export function emptyHfCache(): string {
  return mkdtempSync(path.join(tmpdir(), "avz-e2e-hf-"));
}

/**
 * A first run: a new HOME (setup's ~/Avanzel and the remembered library stay in it), an empty Hugging Face cache,
 * and exactly agentStubs(answers) plus the system folders on PATH, so no agent of this Mac's own is found.
 */
export function firstRun(answers: Record<string, string> = {}): { env: Record<string, string>; home: string } {
  const home = mkdtempSync(path.join(tmpdir(), "avz-e2e-home-"));
  return {
    home,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      HF_HUB_CACHE: emptyHfCache(),
      AVANZEL_EXACT_PATH: "1",
      // The first-thought step waits this long for a press of the shortcut: no test sees its nudge unless it asks.
      AVANZEL_PRESS_WAIT_MS: "60000",
      PATH: `${agentStubs(answers)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
  };
}

/**
 * A first run on a Mac with no agent: firstRun()'s env with PATH set to `bin`, a new empty folder, plus the system
 * folders. A test installs an agent by putting a stand-in into `bin`.
 */
export function noAgents(): { env: Record<string, string>; bin: string } {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  return { bin, env: { ...firstRun().env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` } };
}

/**
 * A complete snapshot of model `id` in the Hugging Face cache `hub`, laid out as huggingface_hub does, with refs/main
 * naming its pinned revision: each int8 file is as long as MODELS pins it but holds nothing (a hole, so no disk space).
 */
export function hfSnapshot(hub: string, id: string): void {
  const { repo, revision, files, digests } = MODELS[id]!;
  const base = path.join(hub, `models--${repo.replaceAll("/", "--")}`);
  const snapshot = path.join(base, "snapshots", revision);
  mkdirSync(path.join(base, "blobs"), { recursive: true });
  mkdirSync(path.join(base, "refs"), { recursive: true });
  mkdirSync(snapshot, { recursive: true });
  writeFileSync(path.join(base, "refs", "main"), revision);
  for (const name of files.int8!) {
    const { size, sha256 } = digests[name]!;
    const blob = path.join(base, "blobs", sha256);
    writeFileSync(blob, "");
    truncateSync(blob, size);
    symlinkSync(path.join("..", "..", "blobs", sha256), path.join(snapshot, name));
  }
}

type Controller = Record<string, (...args: unknown[]) => unknown>;

export async function call(app: ElectronApplication, method: string, ...args: unknown[]): Promise<unknown> {
  await expect.poll(() => app.evaluate(() => !!(globalThis as { __avanzel?: unknown }).__avanzel), { timeout: 20_000 }).toBe(true);
  return app.evaluate(
    async (_electron, [name, params]) => {
      const controller = (globalThis as unknown as { __avanzel: Controller }).__avanzel;
      const result = await controller[name as string]!(...(params as unknown[]));
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    },
    [method, args] as const,
  );
}

export async function capsuleKind(app: ElectronApplication): Promise<string> {
  const state = (await call(app, "capsuleStateForTests")) as { kind: string };
  return state.kind;
}

/** The titles under "Recently filed" in the menu bar menu. */
export async function recentlyFiled(app: ElectronApplication): Promise<string[]> {
  const menu = (await call(app, "menuForTests")) as MenuItemModel[];
  return menu.flatMap((item) => (item.type === "item" && item.action.startsWith("open:") ? [item.label] : []));
}

export async function windowFor(app: ElectronApplication, name: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes(`/renderer/${name}/`)), { timeout: 15_000 }).toBe(true);
  return app.windows().find((w) => w.url().includes(`/renderer/${name}/`))!;
}

/** Whether a window of renderer `name` (say "quick") is on screen. */
export const shown = (app: ElectronApplication, name: string) =>
  app.evaluate(({ BrowserWindow }, page) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes(`/renderer/${page}/`) && w.isVisible()), name);

/** Opens Settings (showSettings) and moves to `pane` on its toolbar; returns the window once that pane's heading shows. */
export async function openSettings(app: ElectronApplication, pane = "General"): Promise<Page> {
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: pane, exact: true }).click();
  await expect(settings.getByRole("heading", { name: pane, exact: true })).toBeVisible();
  return settings;
}

/**
 * Stands in for the folder picker: it answers that `dir` was chosen, and keeps how it was asked (the title of the window
 * it is a sheet on, and its options) for `pickerAsked`.
 */
export async function stubPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const [parent, options] = args.length > 1 ? args : [null, args[0]];
      (globalThis as { pickerAsked?: unknown }).pickerAsked = { sheetOn: (parent as { getTitle(): string } | null)?.getTitle() ?? null, options };
      return { canceled: false, filePaths: [chosen] };
    };
  }, dir);
}

export const pickerAsked = (app: ElectronApplication) => app.evaluate(() => (globalThis as { pickerAsked?: unknown }).pickerAsked ?? null);

/**
 * From now on, the native menus Settings pops up record their items and pick the one labelled `choice`, or close
 * without a pick when it is null. Each call starts a new record. The stand-in keeps the order a real menu has on macOS:
 * a picked item's click runs first, then the menu's close callback. No test opens a real native menu, which would hold
 * it until it timed out, so every test that clicks a Choose… button calls this first.
 */
export async function answerMenus(app: ElectronApplication, choice: string | null): Promise<void> {
  await app.evaluate(({ Menu }, pick) => {
    const shown: { label: string; checked: boolean }[][] = [];
    (globalThis as { shownMenus?: typeof shown }).shownMenus = shown;
    Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
      shown.push(this.items.map((item) => ({ label: item.label, checked: item.checked })));
      this.items.find((item) => item.label === pick)?.click();
      options?.callback?.();
    };
  }, choice);
}

/**
 * What answerMenus' stand-in was asked to show since it was set, oldest first. A menu opens after an IPC round trip, so
 * a test reads this only once `await expect.poll(() => shownMenus(app)).toHaveLength(n)` has passed.
 */
export async function shownMenus(app: ElectronApplication): Promise<{ label: string; checked: boolean }[][]> {
  return app.evaluate(() => (globalThis as { shownMenus?: { label: string; checked: boolean }[][] }).shownMenus ?? []);
}

/**
 * From now on, what Avanzel would open in this Mac's own apps (a page, the library) is noted for `openedWith`
 * instead, so no test opens anything here.
 */
export async function stubOpening(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedWith?: string[] }).openedWith = opened;
    shell.openPath = async (file: string) => {
      opened.push(file);
      return "";
    };
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

export const openedWith = (app: ElectronApplication) => app.evaluate(() => (globalThis as { openedWith?: string[] }).openedWith ?? []);

/**
 * A first run from Hello to the first-thought step, as a person goes: Set me up, then Looks good once setup has chosen
 * Claude Code (its stand-in reads as signed in), which makes the library at ~/Avanzel. Returns the setup window.
 */
export async function throughFound(app: ElectronApplication): Promise<Page> {
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => ((await call(app, "setupSnapshot")) as SetupSnapshot).agent, { timeout: 20_000 }).toBe("claude");
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: "What's on your mind this week?" })).toBeVisible({ timeout: 20_000 });
  return setup;
}

/** On the first-thought step, the person types `words` instead of saying them, and files them. */
export async function typeFirstThought(setup: Page, words: string): Promise<void> {
  await setup.getByRole("button", { name: "Type it instead" }).click();
  await setup.getByRole("textbox", { name: "Your thought" }).fill(words);
  await setup.getByRole("button", { name: "File it", exact: true }).click();
}

/**
 * A first run from Hello to the last step, as a person goes: throughFound, a typed thought filed, Continue to Ask, then
 * Skip. The app's `claude` must file and write a page (filingClaude), so Continue goes on to Ask. Returns the setup
 * window, on "You're all set.".
 */
export async function toDone(app: ElectronApplication): Promise<Page> {
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect(setup.getByRole("heading", { name: "You're all set." })).toBeVisible();
  return setup;
}

/**
 * A picture of `page` for people to look at, in test-results/shots. Run with `AVANZEL_E2E_SHOTS=1` to collect them; without
 * it, this returns at once: no test asserts on a picture, and each costs about half a second.
 */
export async function snap(page: Page, name: string): Promise<void> {
  if (process.env.AVANZEL_E2E_SHOTS !== "1") return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(350); // let the appear animation finish
  try {
    await page.screenshot({ path: path.join(shots, `${name}.png`), omitBackground: true, timeout: 5_000 });
  } catch (error) {
    // A picture for people, not an assertion: a hung frame is a warning, not a failed test.
    console.warn(`snap ${name}: ${String(error).split("\n")[0]}`);
  }
}

export function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

export function exists(root: string, rel: string): boolean {
  return existsSync(path.join(root, rel));
}

/** Every file under `rel` (none when it is missing), relative to it, hidden ones left out. */
export function filesUnder(root: string, rel: string): string[] {
  const dir = path.join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => !name.split("/").some((part) => part.startsWith(".")) && statSync(path.join(dir, name)).isFile())
    .sort();
}

/** A scratch file path for the fake agent's FAKE_AGENT_ONCE (its first run stalls, later ones file). */
export function onceMarker(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-once-")), "stalled");
}

export function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/** Whether process `pid` is still running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
