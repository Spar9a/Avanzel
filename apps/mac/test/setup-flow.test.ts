import { describe, expect, it } from "vitest";
import type { PermissionStatus } from "../src/shared/ipc.ts";
import { afterAsk, afterFound, beforeThink } from "../src/renderer/setup/flow.ts";

const permissions = (microphone: PermissionStatus, screen: PermissionStatus) => ({ microphone, screen });

describe("setup's permission steps", () => {
  it("shows the microphone step until macOS has allowed the microphone", () => {
    for (const status of ["not-determined", "denied", "restricted", "unknown"] as const) {
      expect(afterFound(permissions(status, "granted"))).toBe("microphone");
      expect(beforeThink(permissions(status, "granted"))).toBe("microphone");
    }
    expect(afterFound(permissions("granted", "denied"))).toBe("think");
    expect(beforeThink(permissions("granted", "denied"))).toBe("found");
  });

  it("shows the screen step until macOS has allowed Screen Recording", () => {
    for (const status of ["not-determined", "denied", "restricted", "unknown"] as const) {
      expect(afterAsk(permissions("granted", status))).toBe("screen");
    }
    expect(afterAsk(permissions("denied", "granted"))).toBe("done");
  });
});
