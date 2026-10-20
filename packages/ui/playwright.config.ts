import { defineConfig } from "@playwright/test";

// The gallery in Chrome with Reduce Motion on, so every animation sits at its last frame and each
// screenshot is the same on every run. Screenshots live in e2e/gallery.spec.ts-snapshots/; only the
// owner updates them (npm run ui:approve).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  retries: 1, // a one-off rendering hiccup must not send an agent back for a change it didn't make
  reporter: [["list"]],
  outputDir: "test-results",
  // Tight on purpose: a shade of grey changing is a design change. Screenshots are taken on macOS
  // (they carry a -darwin suffix), where font rendering is the same from run to run.
  expect: { toHaveScreenshot: { threshold: 0.02, maxDiffPixelRatio: 0.0005, animations: "disabled" } },
  use: {
    channel: "chrome",
    viewport: { width: 760, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
});
