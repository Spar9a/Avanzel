// The apps a call can be in, and which of them run now. avanzel-calltap taps the sound of the pids it is given, and an
// app plays through its helper processes as much as its main one, so an app is its main process and all that descend from it.
import { runningProcesses, type RunningProcess } from "./running-apps.ts";

export interface CallApp {
  name: string;
  /** The app's main process and its children. */
  pids: number[];
}

/** Process names (as `ps -c` shows them) of the apps a call can be in; the order is the order people are offered them. */
export const CALL_APPS: readonly string[] = [
  "zoom.us",
  "Microsoft Teams",
  "Slack",
  "FaceTime",
  "Discord",
  "Webex",
  "Google Chrome",
  "Safari",
  "Arc",
  "Microsoft Edge",
  "Firefox",
];

/** The call apps among `processes`, in CALL_APPS order. */
export function callAppsIn(processes: readonly RunningProcess[]): CallApp[] {
  const apps: CallApp[] = [];
  for (const name of CALL_APPS) {
    const pids = processes.filter((process) => process.command === name).map((process) => process.pid);
    // Children come after their parent in pid order, but not always: walk until nothing new joins.
    for (let i = 0; i < pids.length; i++) {
      for (const child of processes) if (child.ppid === pids[i] && !pids.includes(child.pid)) pids.push(child.pid);
    }
    if (pids.length > 0) apps.push({ name, pids: pids.sort((a, b) => a - b) });
  }
  return apps;
}

/** The call apps running now. */
export async function runningCallApps(): Promise<CallApp[]> {
  return callAppsIn(await runningProcesses());
}
