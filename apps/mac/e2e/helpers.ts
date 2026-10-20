import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export async function launch(env: Record<string, string>, switches: string[] = []): Promise<ElectronApplication> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined)) as Record<string, string>;
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const packaged = process.env.AVANZEL_E2E_PACKAGED;
  return electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: packaged ? switches : [appDir, ...switches],
    cwd: appDir,
    env: { ...clean, AVANZEL_TEST: "1", AVANZEL_USER_DATA: userData, ...env },
  });
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
  await page.screenshot({ path: path.join(shots, `${name}.png`), omitBackground: true });
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
