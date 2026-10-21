import { describe, expect, it } from "vitest";
import { cardDate, megabytes, stampDate } from "../src/renderer/setup/copy.ts";

describe("setup copy", () => {
  it("dates read as the card and the stamp print them", () => {
    const day = new Date(2026, 9, 21);
    expect(cardDate(day)).toBe("Wednesday 21 October");
    expect(stampDate(day)).toBe("21 Oct 2026");
    expect(megabytes(672_807_563)).toBe(673);
  });
});
