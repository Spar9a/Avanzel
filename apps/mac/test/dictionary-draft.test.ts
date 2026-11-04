import { describe, expect, it } from "vitest";
import { failed, followSnapshot, saved, sent, startDraft, toSend, typed } from "../src/renderer/settings/dictionary-draft.ts";

const LIB = "/Users/someone/Avanzel";

describe("the Dictionary field's draft", () => {
  it("starts from the library's lines and sends nothing until it is edited", () => {
    const start = startDraft(LIB, "Ollama = Alema");
    expect(start.draft).toBe("Ollama = Alema");
    expect(toSend(start)).toBeNull();
    expect(toSend(typed(start, "Ollama = Alema\nKowalczyk"))).toBe("Ollama = Alema\nKowalczyk");
  });

  it("follows a new snapshot when it was not edited since the last one", () => {
    const start = startDraft(LIB, "");
    const next = followSnapshot(start, LIB, "Kowalczyk");
    expect(next.draft).toBe("Kowalczyk");
    expect(toSend(next)).toBeNull();
    expect(followSnapshot(next, LIB, "Kowalczyk")).toBe(next); // the same snapshot changes nothing
  });

  it("keeps an edited draft when a new snapshot comes", () => {
    const edited = typed(startDraft(LIB, ""), "Priya = pre a");
    const next = followSnapshot(edited, LIB, "Kowalczyk");
    expect(next.draft).toBe("Priya = pre a");
    expect(toSend(next)).toBe("Priya = pre a");
  });

  it("sends a draft once while its save is on its way", () => {
    const edited = typed(startDraft(LIB, ""), "Ollama = Alema");
    const sending = sent(edited, "Ollama = Alema");
    expect(toSend(sending)).toBeNull();
    expect(toSend(failed(sending, "Ollama = Alema"))).toBe("Ollama = Alema"); // refused: leaving the field tries again
  });

  it("shows the lines main kept once the save lands, unless more was typed meanwhile", () => {
    const sending = sent(typed(startDraft(LIB, ""), "Ollama = Alema\n\n"), "Ollama = Alema\n\n");
    const landed = followSnapshot(saved(sending, "Ollama = Alema\n\n", "Ollama = Alema"), LIB, "Ollama = Alema");
    expect(landed.draft).toBe("Ollama = Alema");
    expect(toSend(landed)).toBeNull();

    const more = typed(sending, "Ollama = Alema\nKowalczyk");
    const kept = followSnapshot(saved(more, "Ollama = Alema\n\n", "Ollama = Alema"), LIB, "Ollama = Alema");
    expect(kept.draft).toBe("Ollama = Alema\nKowalczyk");
    expect(toSend(kept)).toBe("Ollama = Alema\nKowalczyk");
  });

  it("lands the same whether the snapshot push or the save's reply comes first", () => {
    const sending = sent(typed(startDraft(LIB, ""), "  Kowalczyk "), "  Kowalczyk ");
    const pushFirst = saved(followSnapshot(sending, LIB, "Kowalczyk"), "  Kowalczyk ", "Kowalczyk");
    const replyFirst = followSnapshot(saved(sending, "  Kowalczyk ", "Kowalczyk"), LIB, "Kowalczyk");
    expect(pushFirst).toEqual(replyFirst);
    expect(pushFirst.draft).toBe("Kowalczyk");
    expect(toSend(pushFirst)).toBeNull();
  });

  it("after the old snapshot is shown again, moves to the saved lines and never sends the old ones back", () => {
    // The pane came back while the save waited, from the snapshot before it: the draft is the old text, unedited.
    const back = startDraft(LIB, "Ollama = Alema");
    const landed = followSnapshot(back, LIB, "Ollama = Alema\nKowalczyk");
    expect(landed.draft).toBe("Ollama = Alema\nKowalczyk");
    expect(toSend(landed)).toBeNull(); // focusing and leaving the field saves nothing
  });

  it("starts again from another library's lines", () => {
    const edited = sent(typed(startDraft(LIB, "Ollama"), "Ollama\nZel"), "Ollama\nZel");
    const other = followSnapshot(edited, "/Volumes/Work/Notes", "Kubernetes");
    expect(other).toEqual(startDraft("/Volumes/Work/Notes", "Kubernetes"));
  });
});
