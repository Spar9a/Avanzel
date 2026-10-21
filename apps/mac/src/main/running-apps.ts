// The processes running on this Mac, by name: what names the app that probably holds a taken shortcut.
import { execFile } from "node:child_process";

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
