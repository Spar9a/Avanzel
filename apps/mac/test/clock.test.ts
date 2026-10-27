import { describe, expect, it } from "vitest";
import { clock } from "../src/shared/clock.ts";

describe("clock", () => {
  it("shows whole seconds as minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7_000)).toBe("0:07");
    expect(clock(65_400)).toBe("1:05");
    expect(clock(723_000)).toBe("12:03");
  });

  it("rounds down, never up", () => {
    expect(clock(999)).toBe("0:00");
    expect(clock(1_000)).toBe("0:01");
    expect(clock(59_999)).toBe("0:59");
    expect(clock(60_000)).toBe("1:00");
  });

  it("is never negative, or anything but a time", () => {
    expect(clock(-5)).toBe("0:00");
    expect(clock(-70_000)).toBe("0:00");
    expect(clock(Number.NaN)).toBe("0:00");
    expect(clock(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("goes on in minutes past the hour", () => {
    expect(clock(3_600_000)).toBe("60:00");
  });
});
