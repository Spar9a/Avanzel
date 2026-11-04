// The two setup steps that ask for permissions: the microphone before the first thought, and Screen Recording after Ask.
// Each shows only while macOS hasn't allowed its permission (AVANZEL_FAKE_PERMISSIONS stands in for macOS, and
// AVANZEL_FAKE_MIC_ANSWER for the answer to its prompt). With the Mac's own default in tests, both granted, neither shows,
// which every other setup test relies on. Every test launches as a first run (firstRun).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { call, closeModelHubs, filingClaude, firstRun, launch, snap, throughFound, typeFirstThought, windowFor } from "./helpers.ts";

test.afterEach(closeModelHubs);

const MICROPHONE = "Can I hear you?";
const SCREEN = "Can I see your screen?";
const THINK = "What's on your mind this week?";
const ASK = "Ask me about it.";
const DONE = "You're all set.";

/** A first run on a Mac whose permissions are `permissions`, with an agent that files. */
function run(permissions: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...firstRun({ claude: filingClaude() }).env, AVANZEL_FAKE_PERMISSIONS: permissions, ...extra };
}

/** Hello, Set me up, then Looks good: the window is on whatever follows Found. */
async function pastFound(app: ElectronApplication): Promise<Page> {
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => ((await call(app, "setupSnapshot")) as { agent: string | null }).agent, { timeout: 20_000 }).toBe("claude");
  await setup.getByRole("button", { name: "Looks good" }).click();
  return setup;
}

/** From the first thought, typed, through Ask's Skip: the window is on whatever follows Ask. */
async function pastAsk(setup: Page): Promise<void> {
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: ASK })).toBeVisible();
  await setup.getByRole("button", { name: "Skip" }).click();
}

test("an allowed microphone and Screen Recording have no steps", async () => {
  const app = await launch(run("microphone:granted,screen:granted"));
  const setup = await pastFound(app);
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByRole("heading", { name: MICROPHONE })).toHaveCount(0);
  await pastAsk(setup);
  await expect(setup.getByRole("heading", { name: DONE })).toBeVisible();
  await expect(setup.getByRole("heading", { name: SCREEN })).toHaveCount(0);
  await app.close();
});

test("the microphone step asks behind one Continue, and a grant goes on to the first thought", async () => {
  const app = await launch(run("microphone:not-determined", { AVANZEL_FAKE_MIC_ANSWER: "granted" }));
  const setup = await pastFound(app);
  await expect(setup.getByRole("heading", { name: MICROPHONE })).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByText(/^Next, macOS asks about the microphone\./)).toBeVisible();
  await expect(setup.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0); // the step is the question
  await snap(setup, "setup-microphone");
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  // The first thought's own primer isn't needed any more: macOS has answered.
  await expect(setup.getByRole("dialog")).toHaveCount(0);
  await app.close();
});

test("Skip on the microphone step leaves the asking to the first press", async () => {
  const app = await launch(run("microphone:not-determined", { AVANZEL_FAKE_MIC_ANSWER: "granted" }));
  const setup = await pastFound(app);
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible();
  // Back from there lands on the microphone step again, as long as it isn't allowed.
  await setup.getByRole("button", { name: "Back" }).click();
  await expect(setup.getByRole("heading", { name: MICROPHONE })).toBeVisible();
  await app.close();
});

test("a microphone turned down says where to allow it, and Skip goes on to typing", async () => {
  const app = await launch(run("microphone:denied"));
  const setup = await pastFound(app);
  await expect(setup.getByRole("heading", { name: MICROPHONE })).toBeVisible({ timeout: 20_000 });
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Avanzel can't hear you yet.", { exact: true })).toBeVisible();
  await expect(notice.getByText("Allow it in System Settings, under Microphone. Until then, you can type your thoughts.", { exact: true })).toBeVisible();
  await snap(setup, "setup-microphone-denied");
  await setup.getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Microphone"]);
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Type it instead" })).toBeVisible();
  await app.close();
});

test("the screen step opens Screen Recording, and starting Avanzel reopens it once so macOS applies the grant", async () => {
  const app = await launch(run("screen:denied"));
  const setup = await pastFound(app);
  await pastAsk(setup);
  await expect(setup.getByRole("heading", { name: SCREEN })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Open System Settings" })).toHaveAttribute("data-variant", "primary");
  await snap(setup, "setup-screen");
  await setup.getByRole("button", { name: "Open System Settings" }).first().click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Screen Recording"]);
  await expect(setup.getByText("Turn on Avanzel under Screen Recording.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await snap(setup, "setup-screen-opened");
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: DONE })).toBeVisible();
  await expect(setup.getByText("I'll reopen once you start, so macOS applies screen recording.", { exact: true })).toBeVisible();
  expect(await call(app, "relaunchedForTests")).toBe(0);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => call(app, "relaunchedForTests")).toBe(1);
  await app.close();
});

test("Skip on the screen step goes on without reopening anything", async () => {
  const app = await launch(run("screen:denied"));
  const setup = await pastFound(app);
  await pastAsk(setup);
  await expect(setup.getByRole("heading", { name: SCREEN })).toBeVisible();
  await expect(setup.getByText("Skip, and you can allow it later in Settings, under Privacy.", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect(setup.getByRole("heading", { name: DONE })).toBeVisible();
  await expect(setup.getByText(/^I'll reopen once/)).toHaveCount(0);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => setup.isClosed(), { timeout: 10_000 }).toBe(true);
  expect(await call(app, "relaunchedForTests")).toBe(0);
  await app.close();
});

// throughFound skips the microphone step for the tests that are about what follows it.
test("throughFound reaches the first thought on a Mac that hasn't allowed the microphone", async () => {
  const app = await launch(run("microphone:not-determined"));
  const setup = await throughFound(app);
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible();
  await app.close();
});
