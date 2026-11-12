// Settings → Voice's Dictionary: the names and terms a thought's words are corrected to, kept in the library's config.toml,
// and what the speech model heard kept beside the corrected words.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { holdTheQueue, letTheQueueGo } from "./capsule-helpers.ts";
import { addTo, call, capsuleKind, closeList, filesUnder, launch, listButton, listed, makeLibrary, openSettings, read, snap, speechWav, windowFor, toolbarItem } from "./helpers.ts";

const configOf = (library: string) => readFileSync(path.join(library, ".avanzel", "config.toml"), "utf8");

/** The Dictionary group of Settings → Voice: the panel under its label (a Group is a section headed by its label). */
const dictionaryGroup = (settings: Page) =>
  settings.locator("section", { has: settings.getByRole("heading", { name: "Dictionary", exact: true }) });

/**
 * Every reply main has sent Settings by now has been drawn: a round trip to main from the page comes back after any reply
 * main sent before it (one channel, in order), and a frame later React has drawn what those replies set.
 */
async function repliesDrawn(settings: Page): Promise<void> {
  await settings.evaluate(async () => {
    await (window as unknown as { avanzel: { settings: { get(): Promise<unknown> } } }).avanzel.settings.get();
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });
}

test("the Dictionary saves each term as it is added, and a spoken thought is corrected to them, keeping what was heard", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "We tried a local model through Alema",
  });
  const settings = await openSettings(app, "Voice");
  const group = dictionaryGroup(settings);
  await expect(
    group.getByText(
      "Add one at a time. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an equals sign: Ollama = Alema, Polymer. Short names such as Priya, and names with accents, are corrected only with an equals entry. The names are also given to your filing agent.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(group.getByRole("button", { name: "Dictionary: Empty", exact: true })).toBeVisible();
  // Each term is saved as it is added, its spaces tidied; one already there isn't added twice.
  await addTo(group, "Dictionary", "Ollama = Alema");
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema"]);
  await addTo(group, "Dictionary", "  Kowalczyk  ");
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
  await addTo(group, "Dictionary", "kowalczyk");
  expect(await listed(group, "Dictionary")).toEqual(["Ollama = Alema", "Kowalczyk"]);
  expect(configOf(library)).toContain('dictionary = [\n  "Ollama = Alema",\n  "Kowalczyk",\n]');
  await snap(settings, "settings-voice-dictionary");
  await closeList(group, "Dictionary");
  await expect(group.getByRole("button", { name: "Dictionary: 2 terms", exact: true })).toBeVisible();

  // Another pane and back: the list is the library's.
  await toolbarItem(settings, "General").click();
  await toolbarItem(settings, "Voice").click();
  expect(await listed(dictionaryGroup(settings), "Dictionary")).toEqual(["Ollama = Alema", "Kowalczyk"]);

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

test("a term added while an earlier save still waits its turn stays in the list, and is saved too", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const group = dictionaryGroup(settings);
  await holdTheQueue(app); // as a filing run would: the save waits its turn
  await addTo(group, "Dictionary", "Ollama = Alema"); // the save of the first term is sent, and waits
  await addTo(group, "Dictionary", "Kowalczyk"); // a second term, while it waits
  await letTheQueueGo(app);
  await call(app, "idleForTests");
  await repliesDrawn(settings); // the first save's reply has reached Settings, which must not put the list back to it
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
  expect(await listed(group, "Dictionary")).toEqual(["Ollama = Alema", "Kowalczyk"]);
  await app.close();
});

test("a save that waits while the person goes to another pane and back lands in the list", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  await holdTheQueue(app); // as a filing run would: the save waits its turn
  await addTo(dictionaryGroup(settings), "Dictionary", "Ollama = Alema");
  await addTo(dictionaryGroup(settings), "Dictionary", "  Kowalczyk ");
  await closeList(dictionaryGroup(settings), "Dictionary");
  await toolbarItem(settings, "General").click();
  await toolbarItem(settings, "Voice").click();
  await letTheQueueGo(app);
  await call(app, "idleForTests");
  await expect.poll(() => loadSettings(library).voice.dictionary).toEqual(["Ollama = Alema", "Kowalczyk"]);
  await repliesDrawn(settings);
  expect(await listed(dictionaryGroup(settings), "Dictionary")).toEqual(["Ollama = Alema", "Kowalczyk"]); // the terms main kept
  expect(configOf(library)).toContain('dictionary = [\n  "Ollama = Alema",\n  "Kowalczyk",\n]');
  await app.close();
});

test("a dictionary too long to keep is not saved, and Settings says why", async () => {
  const library = await makeLibrary();
  const full = Array.from({ length: 500 }, (_, i) => `Term${i}`);
  const settingsOf = loadSettings(library);
  saveSettings(library, { ...settingsOf, voice: { ...settingsOf.voice, dictionary: full } });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const group = dictionaryGroup(settings);
  await expect(listButton(group, "Dictionary")).toHaveAccessibleName("Dictionary: 500 terms");
  await addTo(group, "Dictionary", "Term500");
  await expect(settings.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
  await expect(
    settings.getByText(
      "The dictionary has 501 lines, and 500 is the most it can hold. Remove the lines you use least. The setting keeps its old value.",
      { exact: true },
    ),
  ).toBeVisible();
  // The list stays as it was made, to be shortened; the library keeps its 500.
  await expect(listButton(group, "Dictionary")).toHaveAccessibleName("Dictionary: 501 terms");
  expect(loadSettings(library).voice.dictionary).toEqual(full);
  await app.close();
});
