import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, Vault } from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import { frontmatterFields, splitFrontmatter } from "../../../packages/engine/src/core/frontmatter.ts";
import { cleanDictionary, fakeCallTranscriber, fakeTranscript, patchedSettings } from "../src/main/dictionary-settings.ts";

const library = async () => (await Vault.init(mkdtempSync(path.join(tmpdir(), "avz-dict-")), { git: false })).root;
const configText = (root: string) => readFileSync(path.join(root, ".avanzel", "config.toml"), "utf8");

describe("saving the dictionary (setLibrarySettings)", () => {
  it("writes [voice] dictionary, keeps the other keys and dictionary_sound_alike, and reads back the same lines", async () => {
    const root = await library();
    const before = loadSettings(root);
    saveSettings(root, { ...before, harness: "codex", models: { codex: "small" }, voice: { ...before.voice, dictionarySoundAlike: false } });
    saveSettings(root, patchedSettings(loadSettings(root), { dictionary: ["Ollama = Alema", "Kowalczyk"] }));
    const text = configText(root);
    expect(text).toMatch(/\[voice\][\s\S]*dictionary = \[\n {2}"Ollama = Alema",\n {2}"Kowalczyk",\n\]/);
    expect(text).toContain("dictionary_sound_alike = false");
    const after = loadSettings(root);
    expect(after.voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
    expect(after.voice.dictionarySoundAlike).toBe(false);
    expect(after.harness).toBe("codex");
    expect(after.models).toEqual({ codex: "small" });
    expect(after.voice.model).toBe(before.voice.model);
  });

  it("leaves the dictionary as it was when the patch has none", async () => {
    const root = await library();
    saveSettings(root, patchedSettings(loadSettings(root), { dictionary: ["Avanzel"] }));
    saveSettings(root, patchedSettings(loadSettings(root), { harness: "claude" }));
    expect(loadSettings(root).voice.dictionary).toEqual(["Avanzel"]);
    expect(loadSettings(root).harness).toBe("claude");
  });

  it("stores blank lines dropped, whitespace collapsed and repeated lines once", async () => {
    const root = await library();
    const typed = ["", "  Ollama   =  Alema ", "Kowalczyk", "\t", "Kowalczyk", "Ollama = Alema", "Priya = pre a", ""];
    saveSettings(root, patchedSettings(loadSettings(root), { dictionary: typed }));
    expect(loadSettings(root).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk", "Priya = pre a"]);
  });
});

describe("cleanDictionary", () => {
  it("keeps two lines for one term apart: each is short enough, and both are used", () => {
    expect(cleanDictionary(["Ollama = Alema", "Ollama = Polymer"])).toEqual(["Ollama = Alema", "Ollama = Polymer"]);
  });

  it("drops a line with no term, which the dictionary could not use", () => {
    expect(cleanDictionary(["= foo", "Ollama = Alema", "  =  bar, baz", "=", "Kowalczyk"])).toEqual(["Ollama = Alema", "Kowalczyk"]);
  });

  it("refuses more lines than the dictionary holds, in plain words", () => {
    const typed = Array.from({ length: 501 }, (_, i) => `Term${i}`);
    expect(() => cleanDictionary(typed)).toThrow(
      "The dictionary has 501 lines, and 500 is the most it can hold. Remove the lines you use least.",
    );
    expect(() => cleanDictionary([...typed.slice(0, 500), "", "Term0"])).not.toThrow(); // blank and repeated lines don't count
  });

  it("refuses a line longer than it takes, naming the line as the field shows it", () => {
    const long = `Ollama = ${"Alema, ".repeat(30)}Polymer`;
    expect(() => cleanDictionary(["Avanzel", "", long])).toThrow(
      `Line 3 of the dictionary is ${long.length} characters, and 200 is the most. Shorten it, or put some of its heard-as words on a second line for the same term.`,
    );
  });
});

describe("the stand-in for the speech model (AVANZEL_FAKE_TRANSCRIPT)", () => {
  const voice = { dictionary: ["Ollama = Alema", "Kowalczyk"], dictionarySoundAlike: true };

  it("hears its words through the dictionary, keeping what it heard", () => {
    expect(fakeTranscript("We tried a local model through Alema", voice)).toEqual({
      text: "We tried a local model through Ollama",
      engine: "fake",
      heard: "We tried a local model through Alema",
    });
  });

  it("has no heard when nothing changed", () => {
    expect(fakeTranscript("A plain thought", voice)).toEqual({ text: "A plain thought", engine: "fake" });
    expect(fakeTranscript("We tried Alema", { dictionary: [], dictionarySoundAlike: true })).toEqual({ text: "We tried Alema", engine: "fake" });
  });

  it("follows dictionary_sound_alike: off, only heard-as entries correct", () => {
    expect(fakeTranscript("signed by Mr Kowalkzik", { ...voice, dictionarySoundAlike: false }).text).toBe("signed by Mr Kowalkzik");
    expect(fakeTranscript("signed by Mr Kowalkzik", voice).text).toBe("signed by Mr Kowalczyk");
  });

  it("gives a voice capture `heard:` in its front matter and the corrected words as its body; an unchanged one has no `heard:`", async () => {
    const vault = new Vault(await library());
    const corrected = fakeTranscript("We tried a local model through Alema", voice);
    const capture = vault.newCapture(corrected.text, { source: "voice", transcriber: corrected.engine, context: { heard: corrected.heard } });
    const text = readFileSync(capture.path, "utf8");
    expect(text).toMatch(/^heard: We tried a local model through Alema$/m);
    expect(text).toContain("---\n\nWe tried a local model through Ollama\n");
    const plain = fakeTranscript("A plain thought", voice);
    const unchanged = vault.newCapture(plain.text, { source: "voice", transcriber: plain.engine, context: { heard: plain.heard } });
    expect(readFileSync(unchanged.path, "utf8")).not.toContain("heard:");
  });

  it("hears each side of a call through the heard-as entries only, as the real call transcriber does", async () => {
    const both = { dictionary: ["Dmitri", "Ollama = Alema"], dictionarySoundAlike: true };
    const calls = fakeCallTranscriber("Dimitri will cover Alema", both);
    expect(calls.engine).toBe("fake");
    expect(await calls.transcribe(new Float32Array(32000))).toMatchObject({ text: "Dimitri will cover Ollama", engine: "fake", seconds: 2 });
    expect((await fakeCallTranscriber("Dimitri will cover", both).transcribe("call.wav")).text).toBe("Dimitri will cover");
    const named = fakeCallTranscriber("Dimitri will cover", { dictionary: ["Dmitri = Dimitri"], dictionarySoundAlike: true });
    expect((await named.transcribe("call.wav")).text).toBe("Dmitri will cover");
  });

  it("keeps a `heard:` with quotes, a colon, a leading quote and a line break as one front-matter line that reads back the same", async () => {
    const vault = new Vault(await library());
    const heard = `"Alema" said: it's 'fine'\nand # then more`;
    const capture = vault.newCapture("We tried Ollama", { source: "voice", context: { heard } });
    const [block, body] = splitFrontmatter(readFileSync(capture.path, "utf8"));
    expect(block.split("\n").filter((line) => line.startsWith("heard:"))).toHaveLength(1);
    expect(frontmatterFields(block).get("heard")).toBe(heard);
    expect(frontmatterFields(block).get("source")).toBe("voice"); // the fields after it are intact
    expect(body.trim()).toBe("We tried Ollama");
  });
});
