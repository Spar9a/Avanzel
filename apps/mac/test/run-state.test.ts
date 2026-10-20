import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunStateStore } from "../src/main/run-state.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-run-state-"));
const empty = { checked: {}, ran: {} };

describe("run state store", () => {
  it("keeps each library's state apart, in a file of the app's own", () => {
    const file = path.join(tmp(), "run-state.json");
    const store = new RunStateStore(file);
    store.set("/libs/a", { checked: { "evening-review": "2026-10-20T17:00:00.000Z" }, ran: {} });
    store.set("/libs/b", { checked: {}, ran: { "weekly-review": "2026-10-18T14:00:00.000Z" } });
    const again = new RunStateStore(file);
    expect(again.get("/libs/a")).toEqual({ checked: { "evening-review": "2026-10-20T17:00:00.000Z" }, ran: {} });
    expect(again.get("/libs/b")).toEqual({ checked: {}, ran: { "weekly-review": "2026-10-18T14:00:00.000Z" } });
    expect(again.get("/libs/c")).toEqual(empty);
  });

  it("carries a library's old state.json over once, and takes it out of the library", () => {
    const library = tmp();
    const legacy = path.join(library, ".avanzel", "state.json");
    mkdirSync(path.dirname(legacy));
    writeFileSync(legacy, JSON.stringify({ lastRun: { "evening-review": "2026-10-19T17:00:05.000Z" } })); // the oldest format, too
    const store = new RunStateStore(path.join(tmp(), "run-state.json"));
    const carried = { checked: { "evening-review": "2026-10-19T17:00:05.000Z" }, ran: { "evening-review": "2026-10-19T17:00:05.000Z" } };
    expect(store.get(library, legacy)).toEqual(carried);
    expect(existsSync(legacy)).toBe(false);
    writeFileSync(legacy, JSON.stringify({ checked: {}, ran: {} })); // e.g. an old copy of the app wrote it again
    expect(store.get(library, legacy)).toEqual(carried);
  });

  it("starts empty when its file is corrupt", () => {
    const file = path.join(tmp(), "run-state.json");
    writeFileSync(file, "{not json");
    const store = new RunStateStore(file);
    expect(store.get("/libs/a")).toEqual(empty);
    store.set("/libs/a", { checked: { x: "1" }, ran: {} });
    expect(new RunStateStore(file).get("/libs/a")).toEqual({ checked: { x: "1" }, ran: {} });
  });
});
