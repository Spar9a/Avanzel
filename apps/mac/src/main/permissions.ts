// Microphone and Screen Recording permission status, requests, and the System Settings panes.
import { shell, systemPreferences } from "electron";
import type { PermissionStatus } from "../shared/ipc.ts";

const STATUSES: readonly string[] = ["granted", "denied", "not-determined", "restricted", "unknown"];

/** Tests only: AVANZEL_FAKE_PERMISSIONS="microphone:denied,screen:denied" stands in for macOS; what it doesn't name is granted. */
function faked(kind: "microphone" | "screen"): PermissionStatus {
  for (const entry of (process.env.AVANZEL_FAKE_PERMISSIONS ?? "").split(",")) {
    const [name, status = ""] = entry.trim().split(":");
    if (name === kind && STATUSES.includes(status)) return status as PermissionStatus;
  }
  return "granted";
}

/** Screen Recording is only ever "granted" or "denied" here: Electron can't tell "never asked" from "denied". */
export function permissionStatus(kind: "microphone" | "screen"): PermissionStatus {
  if (process.env.AVANZEL_TEST === "1") return faked(kind);
  const status = systemPreferences.getMediaAccessStatus(kind);
  return status === "granted" || status === "denied" || status === "not-determined" || status === "restricted" ? status : "unknown";
}

export async function requestMicrophone(): Promise<boolean> {
  if (permissionStatus("microphone") === "granted") return true;
  if (process.env.AVANZEL_TEST === "1") return false; // tests never bring up the system prompt
  return systemPreferences.askForMediaAccess("microphone");
}

export function openPrivacyPane(kind: "microphone" | "screen"): void {
  const anchor = kind === "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture";
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}
