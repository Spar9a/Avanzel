import { expect, test } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readWav } from "../../../packages/engine/src/index.ts";
import { call, capsuleKind, launch, makeLibrary } from "./helpers.ts";

const wavsUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? wavsUnder(path.join(dir, entry.name)) : entry.name.endsWith(".wav") ? [path.join(dir, entry.name)] : [],
  );

// The real recording path: getUserMedia, the 16 kHz AudioContext, the capture worklet and the IPC
// hand-off, fed by Chromium's fake capture device (a beep every second; no microphone, no TCC
// prompt). The transcript is faked, so this checks the audio the app keeps, not the words.
test("the capsule records the microphone through the audio worklet", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_TRANSCRIPT: "Call Mark about the podcast microphones." }, [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ]);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [wav] = wavsUnder(path.join(library, "raw", "audio"));
  expect(wav && statSync(wav).size).toBeGreaterThan(0);
  const { samples, sampleRate } = readWav(wav!);
  expect(sampleRate).toBe(16000);
  expect(samples.length / sampleRate).toBeGreaterThan(2);
  expect(samples.length / sampleRate).toBeLessThan(5);
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  expect(rms).toBeGreaterThan(0.02);
  await app.close();
});
