// The processes running on this Mac, by name: what names the app that probably holds a taken shortcut, and which call
// apps are open.
import { execFile } from "node:child_process";

export interface RunningProcess {
  pid: number;
  ppid: number;
  command: string;
}

/** Each running process's name, as `ps -axco command` gives it; none when ps fails or takes more than 5 s. */
export function runningAppNames(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("ps", ["-axco", "command"], { timeout: 5_000 }, (error, stdout) => {
      if (error) return resolve([]);
      // The first line is the column's header, COMMAND.
      resolve(stdout.split("\n").slice(1).map((line) => line.trim()).filter(Boolean));
    });
  });
}

/** The lines of `ps -axco pid,ppid,command` as processes; the header and anything unreadable are left out. */
export function parseProcesses(text: string): RunningProcess[] {
  const processes: RunningProcess[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) processes.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! });
  }
  return processes;
}

/** Each running process with its pid, its parent's and its name; none when ps fails or takes more than 5 s. */
export function runningProcesses(): Promise<RunningProcess[]> {
  return new Promise((resolve) => {
    execFile("ps", ["-axco", "pid,ppid,command"], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? [] : parseProcesses(stdout));
    });
  });
}
