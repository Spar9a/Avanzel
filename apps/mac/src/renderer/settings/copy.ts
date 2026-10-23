// Settings' words that are made from values: the name of each pane on the toolbar, the library's line, a message ended
// as a sentence, and the microphone's name.
import { SHELVES } from "@avanzel/ui";
import type { PickOption, SettingsPane } from "../../shared/ipc.ts";

/** Each pane's name on the toolbar, which is also its heading. The scheduled reviews' pane keeps its id, "tasks". */
export const PANE_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  voice: "Voice",
  agents: "Agents",
  tasks: "Reviews",
  privacy: "Privacy",
};

/** The library row's description, from LibraryInfo.shelves (the six shelves count; others don't) and isGit. */
export function libraryLine(shelves: Readonly<Record<string, number>>, isGit: boolean): string {
  const pages = SHELVES.reduce((sum, shelf) => sum + (shelves[shelf] ?? 0), 0);
  const filled = pages === 0 ? "Your first thought will fill a shelf." : `${pages} ${pages === 1 ? "page" : "pages"} on six shelves.`;
  const undo = isGit ? "Every change is a commit you can undo." : "This folder has no git history, so changes can't be undone.";
  return `${filled} ${undo}`;
}

/** `text` ending as a sentence: a full stop added, unless it ends in ".", "?" or "…". */
export function asSentence(text: string): string {
  return /[.?…]$/.test(text) ? text : `${text}.`;
}

/** An audio input the page can list: what enumerateDevices gives for one, less the "default" entry. */
export interface InputDevice { deviceId: string; label: string }

/** The device's own name, or its place in the list when it has none. */
function deviceName(device: InputDevice, index: number): string {
  return device.label || `Microphone ${index + 1}`;
}

/**
 * The microphone in use, by name: "System default" for none chosen, the device's name (or "Microphone 2" by its place
 * in the list, when it has none), or "Microphone not connected" for a chosen one the list doesn't hold. `devices` is
 * null until the page has listed them, and a chosen microphone is then only "Microphone": it has no name to give yet,
 * and can't be called missing before anyone has looked.
 */
export function microphoneName(id: string | null, devices: readonly InputDevice[] | null): string {
  if (id === null) return "System default";
  if (devices === null) return "Microphone";
  const place = devices.findIndex((device) => device.deviceId === id);
  return place === -1 ? "Microphone not connected" : deviceName(devices[place]!, place);
}

/**
 * Choose…'s menu for the microphone: "System default" (value ""), then each device, named as microphoneName names it,
 * with the one in use checked. A chosen microphone that isn't connected leaves everything unchecked. Before the devices
 * are listed (`devices` null), the menu holds System default alone.
 */
export function microphoneOptions(id: string | null, devices: readonly InputDevice[] | null): PickOption[] {
  return [
    { label: "System default", value: "", checked: id === null },
    ...(devices ?? []).map((device, place) => ({ label: deviceName(device, place), value: device.deviceId, checked: device.deviceId === id })),
  ];
}
