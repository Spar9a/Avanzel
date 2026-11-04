// Which step comes next, and which one Back goes to, now that two steps ask for permissions. A permission macOS has
// allowed needs no step, so each of them shows only while its permission isn't "granted".
import type { SetupSnapshot, SetupStep } from "../../shared/ipc.ts";

type Permissions = SetupSnapshot["permissions"];

/** After Found: the microphone step, unless the microphone is allowed. */
export const afterFound = (permissions: Permissions): SetupStep => (permissions.microphone === "granted" ? "think" : "microphone");

/** Back from the first-thought step: the microphone step, unless it was left out. */
export const beforeThink = (permissions: Permissions): SetupStep => (permissions.microphone === "granted" ? "found" : "microphone");

/** After Ask: the screen step, unless Screen Recording is allowed. */
export const afterAsk = (permissions: Permissions): SetupStep => (permissions.screen === "granted" ? "done" : "screen");
