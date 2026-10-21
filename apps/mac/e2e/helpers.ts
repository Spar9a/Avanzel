import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { MODELS, Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/main/png.ts";

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

export function speechWav(text: string, voice = "Samantha"): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-wav-")), "speech.wav");
  execFileSync("say", ["-v", voice, "-o", file, "--data-format=LEI16@16000", text]);
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
const SIGNED_IN: Readonly<Record<string, string>> = {
  claude: `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else echo ready; fi`,
  codex: `if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT" >&2; else echo ready; fi`, // Codex answers on stderr
};

/**
 * A new folder of stand-ins for Claude Code and Codex: shell scripts answering as SIGNED_IN does, except for the
 * `answers` given (script bodies, by binary). Each one notes how it was called, "claude auth status", in calls.log
 * beside it (see agentCalls).
 */
export function agentStubs(answers: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-agents-"));
  const log = path.join(dir, "calls.log");
  for (const [name, body] of Object.entries({ ...SIGNED_IN, ...answers })) {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> '${log}'\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

/** This process's PATH with new agentStubs(answers) first: what launch() gives the app unless the test passes a PATH. */
export const agentPath = (answers: Record<string, string> = {}) => `${agentStubs(answers)}:${process.env.PATH ?? ""}`;

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
 * content-length, sends 64 KB and holds the connection, so the download stays in progress; "missing" answers 404, so
 * it fails. A spec that uses it runs `test.afterEach(closeModelHubs)`, which closes it when the test ends.
 */
export async function fakeModelHub(mode: "stall" | "missing"): Promise<{ url: string; requests: string[] }> {
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
    // 64 KB, or all but the last byte of a smaller file, and no more: the connection stays open until the hub closes.
    res.write(Buffer.alloc(Math.min(64 * 1024, size - 1)));
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

export async function windowFor(app: ElectronApplication, name: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes(`/renderer/${name}/`)), { timeout: 15_000 }).toBe(true);
  return app.windows().find((w) => w.url().includes(`/renderer/${name}/`))!;
}

export async function snap(page: Page, name: string): Promise<void> {
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
