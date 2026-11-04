// Where a screenshot came from: the front app (lsappinfo needs no permission) and, for browsers,
// the tab's address and title (AppleScript; macOS asks once per browser).
import { execFile } from "node:child_process";
import type { ScreenContext } from "../shared/ipc.ts";

const CHROMIUM = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
  // Chrome's Canary and Dev builds answer AppleScript as Chrome does, so a dictation in their private windows is not kept either.
  "com.google.Chrome.canary",
  "com.google.Chrome.dev",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "org.chromium.Chromium",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
]);

export function parseLsappinfo(output: string): { name?: string; bundleId?: string } {
  const name = /"LSDisplayName"="([^"]*)"/.exec(output)?.[1];
  const bundleId = /"CFBundleIdentifier"="([^"]*)"/.exec(output)?.[1];
  return { ...(name ? { name } : {}), ...(bundleId ? { bundleId } : {}) };
}

/**
 * The AppleScript that asks a browser for its front tab's address and title, or null for an app that is no browser it can ask. With
 * `mode`, a Chromium browser is asked in the same call for its front window's mode first ("normal", or "incognito" for a private
 * window), so the mode and the address are of the same window. Safari has no way to say whether its window is private.
 */
export function browserScript(bundleId: string, { mode = false }: { mode?: boolean } = {}): string | null {
  if (bundleId === "com.apple.Safari") {
    return [
      `tell application id "${bundleId}"`,
      `  if (count of windows) is 0 then return ""`,
      `  set t to current tab of front window`,
      `  return (URL of t) & linefeed & (name of t)`,
      `end tell`,
    ].join("\n");
  }
  if (CHROMIUM.has(bundleId)) {
    return [
      `tell application id "${bundleId}"`,
      `  if (count of windows) is 0 then return ""`,
      `  set t to active tab of front window`,
      mode ? `  return (mode of front window) & linefeed & (URL of t) & linefeed & (title of t)` : `  return (URL of t) & linefeed & (title of t)`,
      `end tell`,
    ].join("\n");
  }
  return null;
}

/**
 * What `browserScript(…, { mode: true })` printed, as the dictation's privacy rule reads it: the address, and for a Chromium browser
 * whether its window is private. A Chromium answer whose mode is missing or one Avanzel doesn't know throws: a window that can't be
 * told from a private one must be taken as one could be, by the caller, never as a normal one.
 */
export function parseBrowserWindow(output: string, kind: "chromium" | "safari"): { address?: string; privateWindow?: boolean } {
  const lines = output.split("\n").map((line) => line.trim());
  if (kind === "safari") {
    const address = lines[0];
    return address ? { address } : {};
  }
  const [mode, address] = lines;
  if (mode !== "normal" && mode !== "incognito") throw new Error(`The browser's window mode couldn't be read: "${mode ?? ""}".`);
  return { ...(address ? { address } : {}), privateWindow: mode === "incognito" };
}

/** Like `run`, but a command that fails or runs past its time rejects, for a caller that must not take silence for an answer. */
const runOrThrow: Run = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

/**
 * The front window of the browser `bundleId`, for a dictation that went there: its address, and whether it is private where that can
 * be asked (`parseBrowserWindow`). Null for an app that is no browser Avanzel can ask. Rejects when the browser couldn't be asked (it
 * refused, macOS hasn't allowed Avanzel to ask it, or it didn't answer in time), so the caller keeps nothing rather than guess.
 */
export async function browserWindow(bundleId: string, exec: Run = runOrThrow): Promise<{ address?: string; privateWindow?: boolean } | null> {
  const script = browserScript(bundleId, { mode: true });
  if (!script) return null;
  return parseBrowserWindow(await exec("osascript", ["-e", script], 2500), CHROMIUM.has(bundleId) ? "chromium" : "safari");
}

export function parseBrowserResult(output: string): { url?: string; title?: string } {
  const [url, ...rest] = output.trim().split("\n");
  const title = rest.join(" ").trim();
  return { ...(url ? { url: url.trim() } : {}), ...(title ? { title } : {}) };
}

type Run = (file: string, args: string[], timeoutMs: number) => Promise<string>;

const run: Run = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => resolve(error ? "" : stdout));
  });

export async function frontContext(exec: Run = run): Promise<ScreenContext & { bundleId?: string }> {
  const asn = (await exec("lsappinfo", ["front"], 1500)).trim();
  if (!asn) return {};
  const [nameOut, idOut] = await Promise.all([
    exec("lsappinfo", ["info", "-only", "name", asn], 1500),
    exec("lsappinfo", ["info", "-only", "bundleid", asn], 1500),
  ]);
  const { name } = parseLsappinfo(nameOut);
  const { bundleId } = parseLsappinfo(idOut);
  const context: ScreenContext & { bundleId?: string } = { ...(name ? { app: name } : {}), ...(bundleId ? { bundleId } : {}) };
  const script = bundleId ? browserScript(bundleId) : null;
  if (script) Object.assign(context, parseBrowserResult(await exec("osascript", ["-e", script], 2500)));
  return context;
}
