import { describe, expect, it } from "vitest";
import { filedLine, formatWhen, reviewProgress, speechProblemOf, waitingLine, type MenuTask } from "../src/main/menu-model.ts";
import { downloadFailedProblem, TYPED_THOUGHTS_SAVED, TYPING_WORKS_MEANWHILE, voiceSettingsProblem } from "../src/shared/problems.ts";

const now = new Date(2026, 9, 20, 14, 3); // Tue 20 Oct 2026, 14:03 local

describe("what the panel says of the day and the reviews", () => {
  describe("filedLine and waitingLine", () => {
    const evening = (at: Date | null, name = "Evening review"): MenuTask => ({ id: "evening-review", name, kind: "evening-review", at, enabled: true, running: false });

    it("counts", () => {
      expect(filedLine(0)).toBe("Nothing filed today");
      expect(filedLine(1)).toBe("1 thought filed today");
      expect(filedLine(3)).toBe("3 thoughts filed today");
    });

    it("says what waits, then names the review and when, each only when there is one", () => {
      expect(waitingLine(0, undefined, now)).toBeUndefined();
      expect(waitingLine(2, undefined, now)).toBe("2 in the inbox");
      expect(waitingLine(0, evening(new Date(2026, 9, 20, 21, 0)), now)).toBe("Evening review at 21:00");
      expect(waitingLine(2, evening(new Date(2026, 9, 21, 21, 0)), now)).toBe("2 in the inbox · Evening review tomorrow at 21:00");
      expect(waitingLine(1, evening(new Date(2026, 9, 20, 21, 5), "Nightly sweep"), now)).toBe("1 in the inbox · Nightly sweep at 21:05");
    });

    it("names no review that has no time", () => {
      expect(waitingLine(0, evening(null), now)).toBeUndefined();
    });
  });

  describe("reviewProgress", () => {
    it("says what the review is doing and how far, capitalised like the other details (Running…, Off, 21:00)", () => {
      expect(reviewProgress(1, 2)).toBe("Filing 1 of 2");
      expect(reviewProgress(5, 5)).toBe("Filing 5 of 5");
      expect(reviewProgress(1, 1)).toBe("Filing 1 of 1");
    });

    it("never lets the total fall short of the count: a capture that arrives meanwhile raises it", () => {
      expect(reviewProgress(3, 2)).toBe("Filing 3 of 3");
      expect(reviewProgress(1, 0)).toBe("Filing 1 of 1");
    });
  });

  it("formats times relative to today", () => {
    expect(formatWhen(new Date(2026, 9, 20, 21, 0), now)).toBe("21:00");
    expect(formatWhen(new Date(2026, 9, 21, 9, 5), now)).toBe("Tomorrow 09:05");
    expect(formatWhen(new Date(2026, 9, 19, 23, 59), now)).toBe("Yesterday 23:59");
    expect(formatWhen(new Date(2026, 9, 25, 18, 0), now)).toBe("Sun 18:00");
    expect(formatWhen(new Date(2026, 10, 2, 18, 0), now)).toBe("2 Nov 18:00");
    expect(formatWhen(new Date(2026, 9, 12, 8, 0), now)).toBe("12 Oct 08:00");
  });
});

describe("speechProblemOf", () => {
  it("names a download that didn't finish with the capsule's own title, and says what is safe and where to try again", () => {
    const kept = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: the connection dropped", resumable: true });
    expect(kept).toEqual({
      title: "The speech model didn't finish downloading.",
      sublabel: "Typing works meanwhile. Try again in Settings → Voice.",
    });
    // Whether part of the download was kept is for Settings → Voice to say, beside its Try again: the panel says the same either way.
    const gone = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: what arrived was damaged", resumable: false });
    expect(gone).toEqual(kept);
    // The title and what is safe are the card's and Settings → Voice's own: one builder, wherever the problem is told.
    for (const resumable of [true, false]) {
      const told = downloadFailedProblem("anything", resumable);
      expect(told.title).toBe(kept?.title);
      expect(told.body).toContain(`${TYPING_WORKS_MEANWHILE}, and Try again`);
      expect(kept?.sublabel.startsWith(`${TYPING_WORKS_MEANWHILE}. `)).toBe(true);
    }
  });

  it("names voice settings Avanzel can't use with the capsule's own title, and says what is safe and where they are fixed", () => {
    const problem = speechProblemOf({ kind: "error", cause: "settings", message: "Speech model 'parakeet-v9' is not supported", resumable: false });
    expect(problem).toEqual({
      title: "Avanzel can't use the voice settings in this library's config file.",
      sublabel: "Typed thoughts are still saved to the inbox. Fix the config file.",
    });
    const told = voiceSettingsProblem("anything");
    expect(problem?.title).toBe(told.title);
    expect(told.body).toContain(TYPED_THOUGHTS_SAVED);
    expect(problem?.sublabel.startsWith(`${TYPED_THOUGHTS_SAVED} `)).toBe(true);
  });

  it("leaves what Try again does, whether it continues or starts over, to Settings → Voice", () => {
    for (const resumable of [true, false]) {
      const download = speechProblemOf({ kind: "error", cause: "download", message: "x", resumable });
      expect(download?.sublabel, `resumable ${resumable}`).not.toMatch(/continues|starts the download|downloads it again/);
    }
  });

  it("is nothing while the model is ready, on its way, or still to be fetched", () => {
    expect(speechProblemOf({ kind: "ready", dir: "/models/parakeet" })).toBeNull();
    expect(speechProblemOf({ kind: "missing", bytes: 673_000_000 })).toBeNull();
    expect(speechProblemOf({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).toBeNull();
  });

  it("says nothing the copy rules forbid: sentence case, no exclamation mark, never Letter", () => {
    for (const cause of ["download", "settings"] as const) {
      const problem = speechProblemOf({ kind: "error", cause, message: "x", resumable: true });
      for (const line of [problem?.title ?? "", problem?.sublabel ?? ""]) {
        expect(line).toMatch(/^[A-Z]/);
        expect(line).toMatch(/\.$/);
        expect(line).not.toMatch(/!|oops|letter/i);
      }
    }
  });
});
