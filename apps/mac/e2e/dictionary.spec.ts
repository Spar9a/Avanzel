// Settings → Voice's Dictionary: the names and terms a thought's words are corrected to, kept in the library's config.toml,
// and what the speech model heard kept beside the corrected words.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSettings } from "../../../packages/engine/src/index.ts";
import { holdTheQueue, letTheQueueGo } from "./capsule-helpers.ts";
import { call, capsuleKind, filesUnder, launch, makeLibrary, openSettings, read, snap, speechWav, windowFor } from "./helpers.ts";

const configOf = (library: string) => readFileSync(path.join(library, ".avanzel", "config.toml"), "utf8");

/** The Dictionary group of Settings → Voice: the panel under its label (a Group is a section headed by its label). */
const dictionaryGroup = (settings: Page) =>
  settings.locator("section", { has: settings.getByRole("heading", { name: "Dictionary", exact: true }) });

test("the Dictionary saves its lines when the field is left, and a spoken thought is corrected to them, keeping what was heard", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "We tried a local model through Alema",
  });
  const settings = await openSettings(app, "Voice");
  const group = dictionaryGroup(settings);
  await expect(group.getByText("Names and terms", { exact: true })).toBeVisible();
  await expect(
    group.getByText(
      "One per line. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an equals sign: Ollama = Alema, Polymer. Short names such as Priya need that equals entry to be corrected.",
      { exact: true },
    ),
  ).toBeVisible();
  const field = group.getByRole("textbox", { name: "Dictionary" });
  await expect(field).toHaveValue("");
  await field.fill("Ollama = Alema\n\n  Kowalczyk  ");
  await field.press("Tab"); // the focus leaves the field, which saves it
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
  await expect(field).toHaveValue("Ollama = Alema\nKowalczyk"); // the lines main kept: the blank one dropped, the spaces tidied
  expect(configOf(library)).toContain('dictionary = [\n  "Ollama = Alema",\n  "Kowalczyk",\n]');
  await snap(settings, "settings-voice-dictionary");

  // Another pane and back: the field starts from the library's lines.
  await settings.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: "General", exact: true }).click();
  await settings.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: "Voice", exact: true }).click();
  await expect(dictionaryGroup(settings).getByRole("textbox", { name: "Dictionary" })).toHaveValue(
    "Ollama = Alema\nKowalczyk",
  );

  // A thought, kept in the inbox for the evening review, so its capture is there to read.
  await call(app, "setApp", { fileMode: "evening" });
  await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => filesUnder(library, "inbox").filter((rel) => rel.endsWith(".md")), { timeout: 30_000 }).toHaveLength(1);
  const [capture] = filesUnder(library, "inbox").filter((rel) => rel.endsWith(".md"));
  const text = read(library, path.join("inbox", capture!));
  expect(text).toMatch(/^heard: We tried a local model through Alema$/m);
  expect(text).toContain("---\n\nWe tried a local model through Ollama\n");
  await app.close();
});

test("lines typed while an earlier save still waits its turn stay in the field, and leaving it saves them too", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const field = dictionaryGroup(settings).getByRole("textbox", { name: "Dictionary" });
  await holdTheQueue(app); // as a filing run would: the save waits its turn
  await field.fill("Ollama = Alema");
  await field.press("Tab"); // the save of the first line is sent, and waits
  await field.fill("Ollama = Alema\nKowalczyk"); // the field again, with a second line, while it waits
  await letTheQueueGo(app);
  await call(app, "idleForTests"); // the first save is done in main ...
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema"]);
  await settings.waitForTimeout(300); // ... and its reply has reached the window, which must not put the field back to it
  await expect(field).toHaveValue("Ollama = Alema\nKowalczyk");
  await field.press("Tab");
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
  await app.close();
});

test("a dictionary too long to keep is not saved, and the window says why", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const field = dictionaryGroup(settings).getByRole("textbox", { name: "Dictionary" });
  const lines = Array.from({ length: 501 }, (_, i) => `Term${i}`).join("\n");
  await field.fill(lines);
  await field.press("Tab");
  await expect(settings.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
  await expect(
    settings.getByText(
      "The dictionary has 501 lines, and 500 is the most it can hold. Remove the lines you use least. The setting keeps its old value.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(field).toHaveValue(lines); // the draft stays as typed, to be shortened
  expect(loadSettings(library).voice.dictionary).toEqual([]);
  await app.close();
});
