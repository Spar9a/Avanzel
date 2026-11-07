import { describe, expect, it } from "vitest";
import { heardTrigger, withoutStopWord } from "../src/shared/trigger.ts";

describe("heardTrigger", () => {
  it("finds the word in what was heard, whatever its case and the marks around it", () => {
    expect(heardTrigger("Avanzel, record this.", "Avanzel")).toBe(true);
    expect(heardTrigger("ok AVANZEL", "avanzel")).toBe(true);
    expect(heardTrigger("Remember the milk", "Avanzel")).toBe(false);
  });

  it("takes a long word spelled nearly the same, as speech-to-text spells a name it doesn't know", () => {
    expect(heardTrigger("Avanzell", "Avanzel")).toBe(true);
    expect(heardTrigger("Avansel", "Avanzel")).toBe(true);
    expect(heardTrigger("Advance", "Avanzel")).toBe(false);
  });

  it("takes a short word only as it is", () => {
    expect(heardTrigger("hey Zel", "Zel")).toBe(true);
    expect(heardTrigger("hey Sel", "Zel")).toBe(false);
  });

  it("finds a phrase only with its words one after another", () => {
    expect(heardTrigger("hey there, Zel here", "hey Zel")).toBe(false);
    expect(heardTrigger("so, hey Zel", "hey Zel")).toBe(true);
  });

  it("takes words of any script, and accents off", () => {
    expect(heardTrigger("Привет, Зель!", "Зель")).toBe(true);
    expect(heardTrigger("Café", "cafe")).toBe(true);
  });

  it("never hears an empty trigger", () => {
    expect(heardTrigger("anything", "  ")).toBe(false);
  });
});

describe("withoutStopWord", () => {
  it("cuts the stop word said at the end, and the marks before it", () => {
    expect(withoutStopWord("Buy milk tomorrow. Avanzel stop.", "Avanzel stop")).toBe("Buy milk tomorrow.");
    expect(withoutStopWord("Купить молоко, Аванзель стоп", "Аванзель стоп")).toBe("Купить молоко");
  });

  it("cuts a couple of words after it too, and takes it spelled nearly the same", () => {
    expect(withoutStopWord("Call Anna. Avanzell stop, thanks.", "Avanzel stop")).toBe("Call Anna.");
  });

  it("leaves it where it is said earlier on, and leaves text without it as it is", () => {
    expect(withoutStopWord("Avanzel stop was said, then much more was said after it", "Avanzel stop")).toBe(
      "Avanzel stop was said, then much more was said after it",
    );
    expect(withoutStopWord("Just a thought.", "Avanzel stop")).toBe("Just a thought.");
    expect(withoutStopWord("Just a thought.", "")).toBe("Just a thought.");
  });
});
