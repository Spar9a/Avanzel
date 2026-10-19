import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { call, capsuleKind, launch, makeLibrary, read, screenshotFixture, snap, speechWav, windowFor } from "./helpers.ts";

const inbox = (root: string) => readdirSync(path.join(root, "inbox")).filter((n) => !n.startsWith("."));
const archived = (root: string) => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith(".md")) files.push(path.join(dir, entry.name));
    }
  };
  walk(path.join(root, "raw"));
  return files;
};

test("dictation is transcribed on the Mac, filed by the agent, and shows the pages", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("I want to launch my podcast about indie game development before the end of the year.") });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await snap(capsule, "1-listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await snap(capsule, "2-filing");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by fake")).toBeVisible();
  await snap(capsule, "3-filed");
  expect(inbox(library)).toEqual([]);
  const [capture] = archived(library);
  expect(readFileSync(capture!, "utf8")).toContain("podcast about indie game development");
  await app.close();
});

test("Edit changes the words before the agent sees them", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "a hygienic tool for regular users" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  const box = capsule.getByRole("textbox");
  await box.fill("an agentic tool for regular users");
  await snap(capsule, "4-editing");
  await box.press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [capture] = archived(library);
  const text = readFileSync(capture!, "utf8");
  expect(text).toContain("an agentic tool for regular users");
  expect(text).not.toContain("hygienic");
  await app.close();
});

test("an agent failure is shown and the note stays in the inbox", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "will not be filed", FAKE_AGENT_MODE: "fail" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  await expect(capsule.getByText("couldn't file this note")).toBeVisible();
  await snap(capsule, "5-error");
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a screen capture with a spoken comment waits in the inbox with its screenshot", async () => {
  const library = makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "This mic looks right for the podcast",
    AVANZEL_FAKE_SCREEN: screenshotFixture(),
    AVANZEL_FAKE_FRONT_APP: "Safari|Shure MV7+ Podcast Microphone|https://www.shure.com/mv7",
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await snap(capsule, "6-capture-listening");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await snap(capsule, "7-capture-saved");
  const [name] = inbox(library);
  const capture = read(library, `inbox/${name}`);
  expect(capture).toContain("source: screen");
  expect(capture).toContain("url: https://www.shure.com/mv7");
  expect(capture).toMatch(/attachments: \[?raw\/attachments\//);
  expect(capture).toContain("This mic looks right for the podcast");
  await app.close();
});

test("typing a thought files it", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  await snap(quick, "8-quick");
  await quick.getByRole("textbox", { name: "Type a thought" }).press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("asking shows the agent's answer", async () => {
  const library = makeLibrary();
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  await snap(ask, "9-ask");
  await app.close();
});

test("the evening review files the inbox and writes a digest", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "first thought");
  await call(app, "submitQuick", "second thought");
  await expect.poll(() => inbox(library).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => { await call(app, "idleForTests"); return inbox(library).length; }, { timeout: 60_000 }).toBe(0);
  const reviews = readdirSync(path.join(library, "reviews")).filter((n) => n.endsWith("-evening.md"));
  expect(reviews).toHaveLength(1);
  expect(read(library, `reviews/${reviews[0]}`)).toContain("# Evening review");
  await app.close();
});

test("settings show every pane", async () => {
  const library = makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  for (const pane of ["General", "Voice", "Agents", "Shadow tasks", "Tools & MCP", "Privacy"]) {
    await settings.getByRole("button", { name: pane, exact: true }).click();
    await expect(settings.getByRole("heading", { name: pane })).toBeVisible();
    await snap(settings, `settings-${pane.toLowerCase().replace(/[^a-z]+/g, "-")}`);
  }
  await app.close();
});

test("first launch without a library opens the welcome screen", async () => {
  const app = await launch({});
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("heading", { name: "Welcome to Avanzel" })).toBeVisible();
  await snap(settings, "settings-welcome");
  await app.close();
});
