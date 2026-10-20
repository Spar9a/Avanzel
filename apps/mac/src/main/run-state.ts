// When each shadow task was last checked for being due, and last ran: per library, in the app's own
// data folder. It is about this Mac, not the library, so it never shows up in the library's history.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeRunState, type RunState } from "./schedule.ts";

export class RunStateStore {
  constructor(private readonly file: string) {}

  /** The state for `library`. One kept in the library itself (`legacy`, by older builds) is carried over once and removed there. */
  get(library: string, legacy?: string): RunState {
    const known = this.load()[path.resolve(library)];
    if (known !== undefined || !legacy) return normalizeRunState(known ?? {});
    let carried: RunState;
    try {
      carried = normalizeRunState(JSON.parse(readFileSync(legacy, "utf8")));
    } catch {
      return normalizeRunState({});
    }
    this.set(library, carried);
    try {
      rmSync(legacy, { force: true });
    } catch {
      // a read-only library keeps its old copy; it is not read again
    }
    return carried;
  }

  set(library: string, state: RunState): void {
    const all = { ...this.load(), [path.resolve(library)]: state };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const partial = `${this.file}.tmp`;
    writeFileSync(partial, `${JSON.stringify(all, null, 2)}\n`);
    renameSync(partial, this.file);
  }

  private load(): Record<string, unknown> {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
