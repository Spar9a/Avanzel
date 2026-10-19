import { describe, expect, it } from "vitest";
import { loginShellPath, widenedPath } from "../src/main/shell-path.ts";

describe("PATH for an app opened from Finder", () => {
  it("puts the login shell's PATH first, keeps what we had, adds the usual install places, without duplicates", () => {
    expect(widenedPath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin:/Users/me/.local/bin", "/Users/me").split(":")).toEqual([
      "/opt/homebrew/bin", "/usr/bin", "/Users/me/.local/bin", "/bin",
      "/usr/local/bin", "/Users/me/.opencode/bin", "/Users/me/.bun/bin", "/Users/me/.cargo/bin", "/Users/me/.npm-global/bin",
    ]);
  });

  it("still widens PATH when the shell can't be asked", () => {
    expect(widenedPath("/usr/bin:/bin", null, "/Users/me")).toContain("/opt/homebrew/bin");
  });

  it("reads PATH out of noisy login-shell output", () => {
    const run = () => "Welcome back!\n__AVZ__/opt/homebrew/bin:/usr/bin__AVZ__";
    expect(loginShellPath("/bin/zsh", run)).toBe("/opt/homebrew/bin:/usr/bin");
    expect(loginShellPath("/bin/zsh", () => { throw new Error("timeout"); })).toBeNull();
  });
});
