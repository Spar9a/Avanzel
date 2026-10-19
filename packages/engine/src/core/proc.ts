// Other programs run from an argv array, never through a shell.

import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The executable `binary` resolves to on PATH (like `shutil.which`), or null. */
export function which(binary: string, path = process.env.PATH ?? ""): string | null {
  const candidates = binary.includes("/")
    ? [binary]
    : path
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, binary));
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // not there, or not executable
    }
  }
  return null;
}

export interface Completed {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a short command to completion (stdin closed) and collect its output. */
export function run(argv: readonly string[], { cwd }: { cwd: string }): Promise<Completed> {
  const [file = "", ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}
