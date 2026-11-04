// Microphone and Screen Recording permission status, requests, and the System Settings panes.
import { shell, systemPreferences } from "electron";
import type { PermissionStatus } from "../shared/ipc.ts";

const STATUSES: readonly string[] = ["granted", "denied", "not-determined", "restricted", "unknown"];

/** Tests only: what the stand-in for macOS's microphone prompt answered (AVANZEL_FAKE_MIC_ANSWER), once it has asked. */
let fakeMicAnswer: "granted" | "denied" | null = null;

/**
 * Tests only: AVANZEL_FAKE_PERMISSIONS="microphone:denied,screen:denied" stands in for macOS; what it doesn't name is
 * granted. The microphone's answer to its prompt, once given, is its status from then on.
 */
function faked(kind: "microphone" | "screen"): PermissionStatus {
  if (kind === "microphone" && fakeMicAnswer) return fakeMicAnswer;
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

/**
 * Whether Avanzel may use the microphone, asking macOS when it hasn't asked yet. Tests never bring up the system prompt:
 * AVANZEL_FAKE_MIC_ANSWER ("granted" or "denied") is its answer, as macOS gives one only while the microphone is
 * "not-determined". Without it, nothing answers, and Avanzel may not.
 */
export async function requestMicrophone(): Promise<boolean> {
  if (permissionStatus("microphone") === "granted") return true;
  if (process.env.AVANZEL_TEST === "1") {
    const answer = process.env.AVANZEL_FAKE_MIC_ANSWER;
    if (permissionStatus("microphone") === "not-determined" && (answer === "granted" || answer === "denied")) fakeMicAnswer = answer;
    return permissionStatus("microphone") === "granted";
  }
  return systemPreferences.askForMediaAccess("microphone");
}

const PRIVACY_ANCHORS = {
  microphone: "Privacy_Microphone",
  screen: "Privacy_ScreenCapture",
  "input-monitoring": "Privacy_ListenEvent",
  accessibility: "Privacy_Accessibility",
} as const;

export function openPrivacyPane(kind: keyof typeof PRIVACY_ANCHORS): void {
  const anchor = PRIVACY_ANCHORS[kind];
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}
