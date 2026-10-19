import { describe, expect, it, vi } from "vitest";
import { idStamp, isoLocal, localDate, localMinute } from "../../src/core/dates.ts";
import { NOW } from "./helpers.ts";

describe("local dates", () => {
  it("formats ids, log stamps and ISO times in local time", () => {
    expect(isoLocal(NOW)).toBe("2026-10-20T14:03:12+04:00");
    expect(idStamp(NOW)).toBe("2026-10-20-140312");
    expect(localMinute(NOW)).toBe("2026-10-20 14:03");
    expect(localDate(NOW)).toBe("2026-10-20");
  });

  it.each([
    ["UTC", "2026-10-20T10:03:12+00:00"],
    ["America/St_Johns", "2026-10-20T07:33:12-02:30"],
    ["Asia/Kolkata", "2026-10-20T15:33:12+05:30"],
  ])("writes the zone offset in %s", (zone, expected) => {
    vi.stubEnv("TZ", zone);
    expect(isoLocal(NOW)).toBe(expected);
  });
});
