// What the harness tests share: the settings a test starts from, a built-in harness by name, and a custom harness that
// runs a Node script. Each test file makes its own temp folder (useTmp), since its hooks belong to its own run.
import { defaultSettings, type CustomHarness, type Settings } from "../../src/core/config.ts";
import { Harness, harnesses } from "../../src/core/harness.ts";

export function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...defaultSettings(), ...overrides };
}

export function builtin(name: string): Harness {
  const harness = harnesses(defaultSettings())[name];
  if (!harness) throw new Error(`no harness ${name}`);
  return harness;
}

/** A custom harness running a Node script; the prompt arrives as process.argv[1]. */
export function script(code: string, name = "js"): Harness {
  const spec: CustomHarness = { name, headless: [process.execPath, "-e", code, "{prompt}"], interactive: [] };
  return harnesses(settingsWith({ harnesses: { [name]: spec } }))[name] as Harness;
}
