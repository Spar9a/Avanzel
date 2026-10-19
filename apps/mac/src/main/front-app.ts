// Where a screenshot came from: the front app (lsappinfo needs no permission) and, for browsers,
// the tab's address and title (AppleScript; macOS asks once per browser).
import { execFile } from "node:child_process";
import type { ScreenContext } from "../shared/ipc.ts";

const CHROMIUM = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
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

export function browserScript(bundleId: string): string | null {
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
      `  return (URL of t) & linefeed & (title of t)`,
      `end tell`,
    ].join("\n");
  }
  return null;
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
