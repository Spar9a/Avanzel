// Microphone and Screen Recording permission status, requests, and the System Settings panes.
import { shell, systemPreferences } from "electron";
import type { PermissionStatus } from "../shared/ipc.ts";

export function permissionStatus(kind: "microphone" | "screen"): PermissionStatus {
  if (process.env.AVANZEL_TEST === "1") return "granted";
  const status = systemPreferences.getMediaAccessStatus(kind);
  return status === "granted" || status === "denied" || status === "not-determined" || status === "restricted" ? status : "unknown";
}

export async function requestMicrophone(): Promise<boolean> {
  if (permissionStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
}

export function openPrivacyPane(kind: "microphone" | "screen"): void {
  const anchor = kind === "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture";
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}
