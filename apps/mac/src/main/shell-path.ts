// Apps opened from Finder get PATH=/usr/bin:/bin:/usr/sbin:/sbin, which hides Homebrew, ~/.local/bin
// and with them every agent CLI and ffmpeg. Ask the login shell once and add the usual places.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

type Run = (file: string, args: string[], options: object) => string | Buffer;

export function loginShellPath(shell = process.env.SHELL || "/bin/zsh", run: Run = execFileSync): string | null {
  try {
    const out = String(run(shell, ["-ilc", 'printf "__AVZ__%s__AVZ__" "$PATH"'], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    }));
    return /__AVZ__(.*)__AVZ__/s.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function widenedPath(current: string, fromShell: string | null, home = homedir()): string {
  const usual = ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.opencode/bin`, `${home}/.bun/bin`, `${home}/.cargo/bin`, `${home}/.npm-global/bin`];
  const parts = [...(fromShell ?? "").split(":"), ...current.split(":"), ...usual].filter(Boolean);
  return [...new Set(parts)].join(":");
}
