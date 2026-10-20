// Releasing the library lock when its owner file can't be read for a moment (too many open files,
// say). Staged without timing: readFileSync is wrapped, and the next reads of the lock's owner file
// fail; the lock moved aside to be removed is read as usual.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vault } from "../../src/core/vault.ts";
import { useTmp } from "./helpers.ts";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
const tmp = useTmp();
let vault: Vault;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
});

afterEach(() => {
  vi.mocked(readFileSync).mockImplementation(actual.readFileSync);
});

const owner = () => join(vault.lockDir, "owner");

/** The next `times` reads of the lock's owner file fail with EMFILE, as when the process is out of file descriptors. */
function failOwnerReads(times: number): void {
  let left = times;
  const read = actual.readFileSync as (...args: unknown[]) => unknown;
  vi.mocked(readFileSync).mockImplementation(((path: unknown, ...rest: unknown[]) => {
    if (left > 0 && String(path) === owner()) {
      left -= 1;
      throw Object.assign(new Error(`EMFILE: too many open files, open '${String(path)}'`), { code: "EMFILE" });
    }
    return read(path, ...rest);
  }) as typeof readFileSync);
}

describe("releasing the lock", () => {
  it("removes this process's own lock when reading whose it is fails for a moment", async () => {
    await vault.withLock(() => failOwnerReads(1));
    expect(existsSync(vault.lockDir)).toBe(false);
    const onWait = vi.fn();
    expect(await vault.withLock(() => "ran", onWait)).toBe("ran"); // the next run takes it at once
    expect(onWait).not.toHaveBeenCalled();
  });

  it("still leaves a lock that someone else holds by then", async () => {
    const theirs = `${process.pid} ${Math.round(Date.now() / 1000 - uptime())} ${Math.round(Date.now() / 1000 - process.uptime())} ${randomUUID()}\n`;
    await vault.withLock(() => {
      rmSync(vault.lockDir, { recursive: true });
      mkdirSync(vault.lockDir);
      writeFileSync(owner(), theirs);
      failOwnerReads(2);
    });
    expect(actual.readFileSync(owner(), "utf8")).toBe(theirs);
  });

  it("leaves the lock when whose it is can't be read at all (a waiter takes such a lock over as ownerless)", async () => {
    await vault.withLock(() => failOwnerReads(Number.POSITIVE_INFINITY));
    expect(existsSync(owner())).toBe(true);
  });
});
