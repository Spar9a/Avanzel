// Runs only against the packaged app: AVANZEL_E2E_PACKAGED=<path to Contents/MacOS/Avanzel>.
import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { call, capsuleKind, launch, makeLibrary, speechWav, windowFor } from "./helpers.ts";

test.skip(!process.env.AVANZEL_E2E_PACKAGED, "set AVANZEL_E2E_PACKAGED to the built app's executable");

test("the packaged app transcribes locally and files with the agent", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("Remember to call Anna about the trip on Friday.") });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(capsule.getByText(/^Filed by fake in \d+ s$/)).toBeVisible();
  expect(readdirSync(path.join(library, "inbox")).filter((n) => !n.startsWith("."))).toEqual([]);
  await app.close();
});
