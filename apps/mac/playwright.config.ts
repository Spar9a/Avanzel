import { defineConfig } from "@playwright/test";

// Two projects. `quiet` is the default: every spec except those tagged @desktop, three at a time, because the
// quiet stage keeps windows from taking focus. `desktop` holds the tests that need the Mac's real focus, one at a
// time, and runs only when named: `playwright test --project desktop` (npm run e2e:desktop).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "test-results",
  projects: [
    { name: "quiet", grepInvert: /@desktop/, fullyParallel: false, workers: 3 },
    { name: "desktop", grep: /@desktop/, workers: 1 },
  ],
});
