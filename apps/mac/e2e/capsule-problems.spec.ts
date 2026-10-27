// The cards a failed filing ends in (what happened, what is safe, the one fix), the button that files the note again, and the waits and
// watches that file a note stopped by a usage limit or a missing sign-in once that is over. Moved out of filing.spec.ts as they were.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import {
  correctedWordsProblem,
  filingProblem,
  stopFailedProblem,
  voiceSettingsProblem,
  type AgentFailure,
  type Problem,
} from "../src/shared/problems.ts";
import {
  agentCalls,
  agentStubs,
  answerAs,
  call,
  capsuleKind,
  filesUnder,
  filingClaude,
  filingCodex,
  launch,
  limitedClaude,
  limitedClaudeFor,
  limitedCodexFor,
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  resetReported,
  SIGNED_IN,
  signedOutClaude,
  snap,
  speechWav,
  stubPicker,
  tomorrowAtNine,
  windowFor,
} from "./helpers.ts";
import {
  archived,
  cardNote,
  claudeLibrary,
  type ClaudeLibraryOptions,
  dictate,
  expectProblem,
  filingSends,
  inbox,
  notified,
  sleep,
  watchFilingStates,
} from "./capsule-helpers.ts";
import { failingClaude } from "./setup-helpers.ts";

// ---- The card a failed filing ends in: what happened, what is safe, and the one fix ----
//
// Each of these files with Claude Code, whose stand-in `claude` acts as the test made it (filingClaude), on a Mac whose only
// agents are the stand-ins in the test's folder (onlyAgentsIn): which other agents are installed decides the card.

/** `claudeLibrary`, dictated to, and waited for until the capsule shows the card the filing failed with. */
async function failedWithClaude(bin: string, options?: ClaudeLibraryOptions) {
  const opened = await claudeLibrary(bin, options);
  await dictate(opened.app);
  await expect.poll(() => capsuleKind(opened.app), { timeout: 60_000 }).toBe("error");
  return opened;
}

/** A usage-limit wait, as the app keeps it with its library: the note, the agent that was stopped, and the epoch ms it files at. */
type Wait = { capture: string; agent: string; until: number };

/** The usage-limit waits the app keeps for `library`, read from its run state (run-state.json in its user data folder). */
async function waitsOf(app: ElectronApplication, library: string): Promise<Wait[]> {
  const file = path.join(await app.evaluate(() => process.env.AVANZEL_USER_DATA ?? ""), "run-state.json");
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, { waiting?: Wait[] }>;
  return state[path.resolve(library)]?.waiting ?? [];
}

test("a usage limit names its reset and offers another agent", async () => {
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: limitedClaude() }));
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.";
  // The one fix is the best other agent, here Codex's stand-in: the notice's button names it, and Hide stays beside it.
  await expectProblem(capsule, { title: "Claude Code has hit its usage limit.", lines: [body], fix: "File it with Codex now" });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: body,
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await snap(capsule, "5-error-limit");
  // The note stays in the inbox, the card remembers which note it is about, and offering Codex ran nothing of Codex's.
  const [note] = inbox(library);
  expect(note).toBeDefined();
  expect(await cardNote(app)).toBe(note);
  expect((await agentCalls(app)).filter((line) => line.startsWith("codex"))).toEqual([]);
  // The card shown again, as its page reloads, is the same card: the note stays with it. It goes when the card does.
  await capsule.reload();
  await expect(capsule.getByRole("alert")).toContainText("Claude Code has hit its usage limit.");
  expect(await cardNote(app)).toBe(note);
  // Hide puts it away, and the note's card goes with it.
  await capsule.getByRole("button", { name: "Hide", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(await cardNote(app)).toBeNull();
  await app.close();
});

test("a usage limit with no other agent offers no fix", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  answerAs(bin, "claude", limitedClaude()); // the only agent on this Mac
  const { library, app, capsule } = await failedWithClaude(bin);
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.";
  await expectProblem(capsule, { title: "Claude Code has hit its usage limit.", lines: [body] }); // no other agent to offer: Hide alone
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: "Claude Code has hit its usage limit.", detail: body });
  expect(inbox(library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]); // a card with no button still remembers its note
  await app.close();
});

test("a sign-in failure opens Terminal", async () => {
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) })); // "not logged in"
  const body = "Run claude once in Terminal and sign in, and your note will be filed straight away.";
  // The command is in the code face, as the windows set it, and the state names it for the page to set.
  await expectProblem(capsule, { title: "Claude Code isn't signed in on this Mac.", lines: [body], fix: "Open Terminal", command: "claude" });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code isn't signed in on this Mac.",
    detail: body,
    command: "claude",
    action: "open-terminal",
    actionLabel: "Open Terminal",
  });
  await snap(capsule, "5-error-signin");
  expect(await call(app, "openedForTests")).toEqual([]);
  await capsule.getByRole("button", { name: "Open Terminal", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]); // Terminal itself stays shut under test
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a timeout says how long it had", async () => {
  // The stand-in echoes a long prompt and then never finishes, so the run is stopped at the library's limit.
  const { app, capsule } = await failedWithClaude(agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "slow-noisy" }) }), { timeoutSeconds: 2 });
  const body = "Your note is safe in the inbox; the evening review will try again.";
  await expectProblem(capsule, { title: "Claude Code took longer than 2 s and was stopped.", lines: [body], fix: "Try again" });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code took longer than 2 s and was stopped.",
    detail: body,
    action: "refile:claude",
    actionLabel: "Try again",
  });
  await app.close();
});

/** An agent's line of 280 characters that is none of a limit, a sign-in or a timeout: the engine allows 300. */
const LONG_LINE = `Error: ${"the agent went on about what it could not do and why it could not do it, ".repeat(4)}and then it stopped`.slice(0, 280);
const SAFE_LATER = "Your note is safe in the inbox; the evening review will try again.";

test("a long line of the agent's is shortened on the card, so the sentence that says what is safe is in view", async () => {
  // The panel is 300 px tall: left whole, a line of the agent's this long would push the safe sentence and the buttons out of it.
  const { library, app, capsule } = await failedWithClaude(agentStubs({ claude: failingClaude(LONG_LINE) }));
  const state = (await call(app, "capsuleStateForTests")) as { kind: string; message: string; detail: string };
  expect(state.message).toBe("Claude Code couldn't file this note.");
  expect(state.detail.endsWith(SAFE_LATER)).toBe(true);
  const line = state.detail.slice(0, state.detail.length - SAFE_LATER.length).trimEnd();
  expect(Array.from(line).length).toBeLessThanOrEqual(100);
  expect(line.endsWith("…")).toBe(true);
  expect(line.startsWith("The agent went on about what it could not do")).toBe(true);
  // The notice shows all of its body, the safe sentence last, with its buttons, inside the panel.
  await expectProblem(capsule, { title: "Claude Code couldn't file this note.", lines: [`${line} ${SAFE_LATER}`], fix: "Try again" });
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a long line of the agent's is shortened in the notification too, when the card is gone", async () => {
  // The stand-in takes a moment, so the person can close the card before the run fails.
  const slowlyFailing = `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else sleep 2; echo '${LONG_LINE}' >&2; exit 1; fi`;
  const { library, app } = await claudeLibrary(agentStubs({ claude: slowlyFailing }));
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "dismiss");
  await expect.poll(() => call(app, "notificationsForTests"), { timeout: 30_000 }).toHaveLength(1);
  const [note] = (await call(app, "notificationsForTests")) as { title: string; body: string }[];
  expect(note!.title).toBe("Claude Code couldn't file this note.");
  expect(note!.body.endsWith(SAFE_LATER)).toBe(true);
  const line = note!.body.slice(0, note!.body.length - SAFE_LATER.length).trimEnd();
  expect(Array.from(line).length).toBeLessThanOrEqual(100);
  expect(line.endsWith("…")).toBe(true);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("the longest problems the capsule tells fit the panel with their buttons, and a command is in the code face", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  const now = new Date();
  const failure: AgentFailure = { kind: "other", agent: "Claude Code", command: "claude", resetsAt: null, seconds: 900, line: LONG_LINE };
  const recording = "raw/audio/2026/10/2026-10-27-101500.wav";
  const worst: Problem[] = [
    // The agent's line cut at 100 characters, then the words kept aside, then the partial edits with no history to undo them from.
    filingProblem(failure, now, { lineMax: 100, where: ".avanzel/logs/2026-10-27-101500-plant-tulips-in-october.original.md", partial: "uncommitted" }),
    // Avanzel's own line, told whole, under the longest title there is.
    voiceSettingsProblem(
      "/Users/ana/Documents/Notes and thoughts/Avanzel/.avanzel/config.toml: invalid TOML at line 2, column 17: incomplete key-value declaration, expected a value",
    ),
    // A sign-in, whose command is set in code.
    filingProblem({ ...failure, kind: "signin" }, now),
    // A system error with two long paths, cut before the first, and the line that says where the recording is.
    stopFailedProblem(
      "EACCES: permission denied, rename '/Users/ana/Documents/Notes and thoughts/Avanzel/raw/audio/2026/10/2026-10-27-101500.wav' -> '/Users/ana/Documents/Notes and thoughts/Avanzel/inbox/2026-10-27-101500.wav'",
      recording,
      100,
    ),
    // Two lines of body, the reason and what keeps the words.
    correctedWordsProblem("EACCES: permission denied, rename '/Users/ana/Documents/Notes and thoughts/Avanzel/inbox/2026-10-27-101500-plant-tulips.md'", true, 100),
  ];
  for (const problem of worst) {
    await call(app, "setCapsule", {
      kind: "error",
      message: problem.title,
      detail: problem.body,
      ...(problem.command ? { command: problem.command } : {}),
      action: "refile:codex",
      actionLabel: "File it with Codex now", // the longest label a fix has
    });
    const alert = await expectProblem(capsule, {
      title: problem.title,
      lines: problem.body.split("\n"),
      fix: "File it with Codex now",
      ...(problem.command ? { command: problem.command } : {}),
    });
    // The panel keeps a 16 px margin under the notice: it is nowhere near its edge.
    const box = (await alert.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual((await capsule.evaluate(() => innerHeight)) - 16 + 0.5);
  }
  await app.close();
});

test("a library whose evening review is off promises no review", async () => {
  // A plain-text agent's limit names no reset, so the card has no moment to promise. With the evening review off it has no
  // one to promise either: it says only that the note is safe.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "limit" }) });
  const { app, capsule } = await failedWithClaude(bin, { eveningReview: false });
  await expectProblem(capsule, { title: "Claude Code has hit its usage limit.", lines: ["Your note is safe in the inbox."], fix: "File it with Codex now" });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "Your note is safe in the inbox.",
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await app.close();
});

test("a library whose own agent is gone says so", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  answerAs(bin, "codex", SIGNED_IN.codex!); // this Mac has Codex, but the library's agent is Claude Code
  const { library, app, capsule } = await failedWithClaude(bin);
  const body = "Your note is safe in the inbox. Settings → Agents can choose another agent, or has its install command.";
  await expectProblem(capsule, { title: "Claude Code isn't installed on this Mac any more.", lines: [body], fix: "Open Settings" });
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code isn't installed on this Mac any more.",
    detail: body,
    action: "open-settings:agents",
    actionLabel: "Open Settings",
  });
  expect(inbox(library)).toHaveLength(1);
  await capsule.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Agents", exact: true })).toHaveAttribute("aria-checked", "true");
  await app.close();
});

test("a library whose settings can't be read says so, and not that no agent is installed", async () => {
  // Claude Code is installed, and the library's own settings file is what is wrong: the card says that, in the file's words.
  const library = await makeLibrary();
  writeFileSync(path.join(library, ".avanzel", "config.toml"), 'harness = "claude"\ntimeout_seconds =\n');
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const capsule = await windowFor(app, "capsule");
  await call(app, "submitQuick", "Plant tulips in October"); // typed: recording reads the settings too
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // No agent can be named, so Avanzel couldn't file it; and no agent can be retried, and the file is mended by hand: Hide alone.
  const state = (await call(app, "capsuleStateForTests")) as { message: string; detail: string };
  expect(state).toEqual({
    kind: "error",
    message: "Avanzel couldn't file this note.",
    detail: expect.stringMatching(/config\.toml: invalid TOML at line 2, column \d+: .+\. Your note is safe in the inbox; the evening review will try again\.$/),
  });
  await expect(capsule.getByText("needs an AI agent")).toHaveCount(0);
  await snap(capsule, "5-error-settings");
  await expectProblem(capsule, {
    title: "Avanzel couldn't file this note.",
    lines: [/config\.toml: invalid TOML at line 2, column \d+: .+\. Your note is safe in the inbox; the evening review will try again\.$/],
  });
  expect(inbox(library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  await app.close();
});

test("a failure whose card is gone notifies with the same words", async () => {
  // The stand-in takes a moment, so the person can close the card before the run fails.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail", FAKE_AGENT_DELAY_MS: "2000" }) });
  const { library, app } = await claudeLibrary(bin);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "dismiss");
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 30_000 })
    .toEqual([
      {
        title: "Claude Code isn't signed in on this Mac.",
        body: "Run claude once in Terminal and sign in, and your note will be filed straight away.",
      },
    ]);
  expect(await capsuleKind(app)).toBe("hidden"); // the failure doesn't bring the closed card back
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

// ---- The card's one button files the note again ----
//
// File it with … now and Try again file the note the card is about at once, as any note is filed: the capsule shows the
// filing, and the agent is the one the button names.

/** How many filing runs `agent`'s stand-in was asked for in `calls` (agentCalls): Claude Code's are `claude -p …`, Codex's `codex exec …`. */
const filingRuns = (calls: readonly string[], agent: "claude" | "codex") =>
  calls.filter((line) => line.startsWith(agent === "claude" ? "claude -p " : "codex exec ")).length;

test("File it with Codex now files the note with Codex", async () => {
  // Claude Code is at its limit. The Codex stand-in takes a moment, so the filing can be seen before it ends, even when the
  // machine is busy.
  const resetsAt = tomorrowAtNine();
  const bin = agentStubs({ claude: limitedClaude(resetsAt), codex: filingCodex({ FAKE_AGENT_DELAY_MS: "4000" }) });
  const { library, app, capsule } = await failedWithClaude(bin);
  const [note] = inbox(library);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1); // the run that hit the limit
  // The limit's wait is kept for the note: a minute after the reset, unless the test shortens that.
  expect(await waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: resetsAt * 1000 + 60_000 }]);

  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  // The note is filed as any is: the capsule shows the filing, with Codex, the note's words and how it was captured.
  await expect.poll(() => capsuleKind(app)).toBe("filing");
  await expect(capsule.getByText("Filing with Codex…")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "filing",
    agent: "Codex",
    text: "Plant tulips in October",
    transcribedIn: expect.any(Number), // a spoken note, as it was
  });
  // A second click on the button, which can reach main before the page has drawn that filing, files nothing more.
  await call(app, "openSettingsFor", "refile:codex");
  expect(await capsuleKind(app)).toBe("filing");

  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", agent: "Codex" });
  // The note left the inbox for the archive, and Codex wrote its page.
  expect(inbox(library)).toEqual([]);
  expect(archived(library).map((file) => path.basename(file))).toEqual([note]);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  // Codex was asked once, though the button was pressed twice, and Claude Code was not asked again.
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(1);
  expect(filingRuns(calls, "claude")).toBe(1);
  // The note is filed, so the wait for Claude Code's reset has nothing left to file: were the filing undone, it must not come back.
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("Try again files the note with the same agent", async () => {
  // Claude Code's first run hangs and is stopped at the library's 2 s; its next run files. Codex is installed too.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() }) });
  const { library, app, capsule } = await failedWithClaude(bin, { timeoutSeconds: 2 });
  await expect(capsule.getByRole("alert")).toContainText("Claude Code took longer than 2 s and was stopped.");
  const [note] = inbox(library);

  await capsule.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Claude Code")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "claude")).toBe(2); // the run that was stopped, and this one
  expect(filingRuns(calls, "codex")).toBe(0);
  await app.close();
});

/**
 * Presses a failure card's button, as its page does when clicked (`openSettingsFor`), and reads the capsule's state and whether
 * anything is queued in that same turn of main. What the button does at once is all this sees: a filing that is queued shows
 * its card (`filing`) and is queued by then, while a note that is found gone from the inbox closes the card and queues nothing.
 */
async function pressAtOnce(app: ElectronApplication, action: string): Promise<{ kind: string; busy: boolean }> {
  return app.evaluate((_electron, pressed) => {
    const controller = (globalThis as unknown as {
      __avanzel: { openSettingsFor(action: string): void; capsuleStateForTests(): { kind: string }; busy(): boolean };
    }).__avanzel;
    controller.openSettingsFor(pressed);
    return { kind: controller.capsuleStateForTests().kind, busy: controller.busy() };
  }, action);
}

test("a note filed meanwhile isn't filed twice", async () => {
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app } = await failedWithClaude(bin);
  // The evening review, or another Avanzel, files the note while its card is up: it is in the archive now.
  const [note] = inbox(library);
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));

  // The button finds the note gone and only closes the card: at once, with no filing queued to find that out later.
  expect(await pressAtOnce(app, "refile:codex")).toEqual({ kind: "hidden", busy: false });
  await call(app, "idleForTests");
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(0);
  expect(filingRuns(calls, "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  await app.close();
});

test("a limit card left up while another library opens stops promising the filing, and offers nothing that would file there", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) };
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await failedWithClaude(bin, { env });
  await expect(capsule.getByText("It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.", { exact: true })).toBeVisible();
  const [note] = inbox(library);
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");

  // The card is still up, for a note that waits in the first library's inbox and isn't in the new library's. Its wait is the
  // first library's, and files only while that library is open: the card says only what is so now, in the words of a limit
  // that nothing waits for. File it with Codex now would file a note of the open library, so it goes; Hide puts the card away.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.",
  });
  await expectProblem(capsule, {
    title: "Claude Code has hit its usage limit.",
    lines: ["It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again."],
  });
  expect(await cardNote(app)).toBe(note);
  expect(await waitsOf(app, library)).toHaveLength(1); // kept with the first library, for when it opens again
  // A press of the old button that was already on its way closes the card at once and queues nothing: a filing queued for it
  // would try that note in the new library, and fail.
  expect(await pressAtOnce(app, "refile:codex")).toEqual({ kind: "hidden", busy: false });
  await call(app, "idleForTests");
  expect(inbox(library)).toHaveLength(1);
  expect(archived(other)).toEqual([]);
  await app.close();
});

test("a note whose library is switched while it is filed is promised nothing that waits, and offered nothing that would file there", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) };
  // Claude Code's filing waits until the test lets it go (`gate`), then hits its usage limit, until tomorrow.
  const gate = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-gate-")), "go");
  const held = `while [ "$1 $2" != "auth status" ] && [ ! -e '${gate}' ]; do /bin/sleep 0.1; done; ${limitedClaude()}`;
  const bin = agentStubs({ claude: held, codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin, { env });
  // The other library's evening review is off: the card speaks of the note's own library, whose review is on.
  const other = await makeLibrary();
  const review = path.join(other, "tasks", "evening-review.md");
  writeFileSync(review, readFileSync(review, "utf8").replace("enabled: true", "enabled: false"));
  await dictate(app);
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 30_000 }).toBe(1); // it runs
  await stubPicker(app, other);
  await call(app, "chooseLibrary");
  expect(await capsuleKind(app)).toBe("filing"); // the first library's filing goes on
  writeFileSync(gate, "");

  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // The app keeps no wait for a note of a library that isn't open, so the card names the reset and promises only the note's
  // own evening review. File it with Codex now, which files a note of the open library, isn't offered.
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.",
  });
  await expectProblem(capsule, {
    title: "Claude Code has hit its usage limit.",
    lines: ["It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again."],
  });
  expect(await waitsOf(app, library)).toEqual([]);
  expect(await waitsOf(app, other)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a usage limit whose wait can't be kept names the reset, and promises only the evening review", async () => {
  const bin = agentStubs({ claude: limitedClaude(), codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin);
  // Started, its first look at the reviews written. From here on the app can't write its run state: each write goes through
  // run-state.json.tmp beside it, which is made read-only.
  await call(app, "capsuleStateForTests");
  const partial = path.join(await app.evaluate(() => process.env.AVANZEL_USER_DATA ?? ""), "run-state.json.tmp");
  writeFileSync(partial, "");
  chmodSync(partial, 0o444);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // No wait could be kept for the reset: the card names it, and promises only the evening review. The note is in the open
  // library, so File it with Codex now still files it.
  const body = "It resets tomorrow at 09:00. Your note is safe in the inbox; the evening review will try again.";
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: body,
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  await expectProblem(capsule, { title: "Claude Code has hit its usage limit.", lines: [body], fix: "File it with Codex now" });
  expect(await waitsOf(app, library)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

// ---- A note stopped by a usage limit or a missing sign-in files itself once that's over ----
//
// The cards promise it ("will be filed then", "will be filed straight away"), so the app does it. A usage limit's reset is a
// wait, kept with the library so that a restart doesn't lose it; a missing sign-in is a watch of the agent's free sign-in
// check, kept in memory. Either one files the note in the background: no card of its own, and a notification says how it
// went. A card that still shows the note when a background filing ends is updated, not left promising what is not so. The
// tests shorten what takes minutes: the time after a reset before filing (AVANZEL_RESET_MARGIN_MS), and the sign-in watch's
// poll and length (AVANZEL_SIGNIN_POLL_MS, AVANZEL_SIGNIN_WATCH_MS). Each one launches on a Mac whose only agents are the
// stand-ins in its own folder (`claudeLibrary`), and a limit's reset is worked out by the stand-in when it first hits the
// limit (`limitedClaudeFor`), so that a slow launch or failure can't land after it. That stand-in hits the limit on its first
// run only, unless told more, and files on the runs after: a test that is slow under load can't miss the reset.

/** Waits until `epochMs` has passed. */
const sleepUntil = (epochMs: number) => sleep(Math.max(0, epochMs - Date.now()));

/** The launch variable that makes a wait file at the reset itself, not a minute after. */
const AT_THE_RESET = { AVANZEL_RESET_MARGIN_MS: "0" };

/** The agents whose sign-in the app is watching, and how many notes wait on each. */
const watches = (app: ElectronApplication) => call(app, "signInWatchesForTests") as Promise<{ agent: string; notes: number }[]>;

/** How many times the stand-in `claude` was asked for its sign-in, which is all the watch asks of it. */
const signInReads = (calls: readonly string[]) => calls.filter((line) => line === "claude auth status").length;

/**
 * `claudeLibrary` with a Claude Code that hits its usage limit, which resets `seconds` after its first run (`limitedClaudeFor`),
 * dictated to; it waits for the card of the failure. `limits` is how many of its runs hit the limit (the first only, unless
 * given; Infinity for all): it files on the runs after. `resetsAt` is the reset the stand-in gave, in epoch seconds.
 */
async function limitedFor(bin: string, seconds: number, { limits = 1, ...options }: ClaudeLibraryOptions & { limits?: number } = {}) {
  const opened = await claudeLibrary(bin, options);
  answerAs(bin, "claude", limitedClaudeFor(bin, seconds, "", limits));
  await dictate(opened.app);
  await expect.poll(() => capsuleKind(opened.app), { timeout: 60_000 }).toBe("error");
  return { ...opened, resetsAt: resetReported(bin, "claude") };
}

/** Dictates another note, and waits until the claude run it started (the `runs`th) has failed and its card shows. */
async function failAnother(app: ElectronApplication, runs: number): Promise<void> {
  await dictate(app);
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 30_000 }).toBe(runs);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
}

test("a note stopped by a usage limit is filed after the reset", async () => {
  const bin = agentStubs();
  const { library, app, capsule, resetsAt } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  await watchFilingStates(app);
  const [note] = inbox(library);
  // The card promises it, and the app keeps the promise: a wait for the reset, kept with the library, with the agent that was stopped.
  await expect(capsule.getByText(/^It resets (at|tomorrow at) \d\d:\d\d\. Your note is safe in the inbox and will be filed then\.$/)).toBeVisible();
  expect(await waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: resetsAt * 1000 }]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);

  // Claude Code works again by the reset (its stand-in limits only its first run): the note is filed then, in the background.
  const seen = new Set<string>();
  await expect
    .poll(async () => (seen.add(await capsuleKind(app)), inbox(library)), { timeout: 15_000, intervals: [100] })
    .toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000); // not before the reset
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(seen.has("filing")).toBe(false); // it showed no card of its own
  expect(await filingSends(app)).toEqual([]); // and none of its steps, or anything else of it, was sent to the capsule's page
  // The card of the failure, which promised the filing, goes now that the note is filed.
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note!, ".md")}.md`]);
  expect(archived(library).map((file) => path.basename(file))).toEqual([note]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("two notes waiting for one reset are each filed once", async () => {
  const bin = agentStubs();
  const { library, app } = await claudeLibrary(bin, { env: AT_THE_RESET });
  // The second note meets the reset the first one did; the runs after those two file.
  answerAs(bin, "claude", limitedClaudeFor(bin, 9, "", 2));
  await failAnother(app, 1);
  await failAnother(app, 2);
  const resetsAt = resetReported(bin, "claude");
  expect(inbox(library)).toHaveLength(2);
  // A wait for each note, both for that reset; in the order the notes failed in, which their names (the same second, a "-2") needn't follow.
  const waits = inbox(library).map((note) => ({ capture: path.join(library, "inbox", note), agent: "claude", until: resetsAt * 1000 }));
  const kept = await waitsOf(app, library);
  expect(kept).toHaveLength(2);
  expect(kept).toEqual(expect.arrayContaining(waits));

  await expect.poll(() => inbox(library), { timeout: 25_000 }).toEqual([]);
  await expect.poll(async () => (await notified(app, "Filed by Claude Code")).length).toBe(2);
  await call(app, "idleForTests");
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(archived(library)).toHaveLength(2);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(4); // the two that hit the limit, and one run each that filed
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a wait survives a restart", async () => {
  const bin = agentStubs();
  const first = await claudeLibrary(bin, { env: AT_THE_RESET });
  const userData = await first.app.evaluate(() => process.env.AVANZEL_USER_DATA ?? "");
  answerAs(bin, "claude", limitedClaudeFor(bin, 7));
  await dictate(first.app);
  await expect.poll(() => capsuleKind(first.app), { timeout: 60_000 }).toBe("error");
  const resetsAt = resetReported(bin, "claude");
  await first.app.close();
  expect(inbox(first.library)).toHaveLength(1);

  // Avanzel opens again with the same app data, and Claude Code works by now (its stand-in limits only its first run); the reset
  // has not come yet, or has just come.
  const app = await launch({ AVANZEL_LIBRARY: first.library, AVANZEL_USER_DATA: userData, ...onlyAgentsIn(bin), ...AT_THE_RESET });
  await expect.poll(() => inbox(first.library), { timeout: 30_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000); // it waited for the reset, whenever the app came back
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(await waitsOf(app, first.library)).toEqual([]);
  await app.close();
});

test("a wait that came due while Avanzel was closed is filed when it opens", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude" });
  const note = new Vault(library).newCapture("Plant tulips in October", { source: "text" }).path;
  // A wait for the note, and one for a note that is not in the inbox: that one has nothing to file.
  const gone = path.join(library, "inbox", "2026-10-25-100000-already-filed.md");
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const past = Date.now() - 60_000;
  writeFileSync(
    path.join(userData, "run-state.json"),
    JSON.stringify({ [library]: { checked: {}, ran: {}, waiting: [{ capture: gone, agent: "claude", until: past }, { capture: note, agent: "claude", until: past + 1 }] } }),
  );
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_USER_DATA: userData, ...onlyAgentsIn(bin) });
  await expect.poll(() => inbox(library), { timeout: 30_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([`idea-${path.basename(note, ".md")}.md`]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a reset already past arms no wait", async () => {
  const bin = agentStubs();
  const { library, app, capsule } = await claudeLibrary(bin, { env: AT_THE_RESET });
  answerAs(bin, "claude", limitedClaude(Math.floor(Date.now() / 1000) - 60)); // the limit reset a minute ago
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // The card has no moment to promise, and the app keeps no wait.
  await expect(capsule.getByText("Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  expect(await waitsOf(app, library)).toEqual([]);
  // Claude Code files now. Were a wait armed, its time would be past, and it would file the note at once.
  answerAs(bin, "claude", filingClaude());
  await sleep(3_000);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);
  await app.close();
});

test("a limit still reported after its reset files the note once more, and no more", async () => {
  const bin = agentStubs({ codex: filingCodex() });
  // Claude Code stays at its limit and keeps saying that it reset at the same time.
  const { library, app, capsule } = await limitedFor(bin, 5, { env: AT_THE_RESET, limits: Infinity });
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the wait's run
  // That reset has passed, so there is nothing new to wait for. The card that promised the filing, which still shows the note,
  // says so in its place and offers the fix as any failure does: there is no notification besides.
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 20_000 }).toEqual({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: "Your note is safe in the inbox; the evening review will try again.",
    action: "refile:codex",
    actionLabel: "File it with Codex now",
  });
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await sleep(2_500);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2); // and no more
  expect(inbox(library)).toHaveLength(1);
  // The card is a real one: its button files the note.
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a limit still reported after its reset tells a note whose card is gone by notification", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET, limits: Infinity }); // it stays at its limit
  await call(app, "dismiss"); // the person closes the card that promised the filing
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the wait's run
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 20_000 })
    .toEqual([{ title: "Claude Code has hit its usage limit.", body: "Your note is safe in the inbox; the evening review will try again." }]);
  expect(await capsuleKind(app)).toBe("hidden"); // nothing is put up for a note whose card was closed
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a note that meets the limit again waits for the next reset", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  answerAs(bin, "claude", limitedClaudeFor(bin, 5, "-next")); // by the first reset the limit has not lifted: it lifts 5 s after it is hit again
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 20_000 }).toBe(2); // the first wait's run
  const next = resetReported(bin, "claude", "-next");
  // That run hit the limit again, with a later reset: a wait of its own. The card that was up, which still shows the note,
  // says so (there is no notification besides).
  const [note] = inbox(library);
  await expect.poll(() => waitsOf(app, library)).toEqual([{ capture: path.join(library, "inbox", note!), agent: "claude", until: next * 1000 }]);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "error",
    message: "Claude Code has hit its usage limit.",
    detail: expect.stringMatching(/^It resets (at|tomorrow at) \d\d:\d\d\. Your note is safe in the inbox and will be filed then\.$/),
  });
  expect(await call(app, "notificationsForTests")).toEqual([]);

  // By the next reset it works again (that stand-in too limits only its first run).
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(next * 1000);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(3);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a wait files the note with the agent that was stopped, not the library's", async () => {
  // Claude Code, the library's agent, is at its limit until tomorrow. Codex is at its limit too, but only for a few seconds.
  const tomorrow = tomorrowAtNine();
  const bin = agentStubs({ claude: limitedClaude(tomorrow), codex: filingCodex() });
  const { library, app, capsule } = await claudeLibrary(bin, { env: AT_THE_RESET });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  const [note] = inbox(library);
  answerAs(bin, "codex", limitedCodexFor(bin, 6));
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await expect(capsule.getByRole("alert")).toContainText("Codex has hit its usage limit.");
  const capture = path.join(library, "inbox", note!);
  const resetsAt = resetReported(bin, "codex");
  expect(await waitsOf(app, library)).toEqual([
    { capture, agent: "claude", until: tomorrow * 1000 },
    { capture, agent: "codex", until: resetsAt * 1000 },
  ]);

  // Codex works again by its reset (its stand-in limits only its first run); Claude Code still does not.
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  expect(Date.now()).toBeGreaterThanOrEqual(resetsAt * 1000);
  await expect.poll(() => notified(app, "Filed by Codex")).toEqual([expect.objectContaining({ title: "Filed by Codex" })]);
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "codex")).toBe(2); // the run that hit the limit, and the wait's
  expect(filingRuns(calls, "claude")).toBe(1); // never asked again
  // The note is filed, so Claude Code's wait for it goes too: filed again from there, an undone filing would come back.
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a note the evening review files has no wait left, and its card goes", async () => {
  const bin = agentStubs();
  const { library, app } = await claudeLibrary(bin);
  answerAs(bin, "claude", limitedClaude()); // until tomorrow: the wait is a long one
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  expect(await waitsOf(app, library)).toHaveLength(1);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  // The evening review files the note, with Claude Code working again. Were it put back in the inbox (Undo), the wait must not file it.
  // The card, which promised that the note would be filed, has nothing more to say.
  answerAs(bin, "claude", filingClaude());
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(inbox(library)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await cardNote(app)).toBeNull();
  await app.close();
});

test("a wait that comes due while the note's editor is open files nothing", async () => {
  // Claude Code is at its limit for a few seconds. The person files the note with Codex at once, and opens the editor on it.
  const bin = agentStubs({ codex: filingCodex({ FAKE_AGENT_DELAY_MS: "3000" }) });
  const { library, app, capsule, resetsAt } = await limitedFor(bin, 6, { env: AT_THE_RESET });
  await capsule.getByRole("button", { name: "File it with Codex now", exact: true }).click();
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");

  // The reset comes with the editor open, and Claude Code would work again (its stand-in limits only its first run): the words
  // are the person's to file, not the wait's.
  await sleepUntil(resetsAt * 1000 + 2_000);
  await call(app, "idleForTests");
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  expect(await notified(app, "Filed by Claude Code")).toEqual([]);
  expect(await capsuleKind(app)).toBe("editing");
  expect(await waitsOf(app, library)).toEqual([]); // the wait ended

  // The person's own edit still files the note, with Codex, as it would have.
  await capsule.getByRole("textbox").press("Escape");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by Codex")).toBeVisible();
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a note filed meanwhile isn't filed again when its wait ends", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET });
  // The evening review, or Try again, files the note before the reset: it is in the archive now. Claude Code would work by the
  // reset (its stand-in limits only its first run).
  const [note] = inbox(library);
  renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));

  await expect.poll(() => waitsOf(app, library), { timeout: 15_000 }).toEqual([]); // the wait ended, and had nothing to file
  await call(app, "idleForTests");
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await call(app, "notificationsForTests")).toEqual([]);
  await app.close();
});

test("a wait of another library waits until that library opens again", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")), ...AT_THE_RESET };
  const bin = agentStubs();
  const { library, app, resetsAt } = await limitedFor(bin, 5, { env });
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");

  // The reset comes while the other library is open: the note is in the first one's inbox, and nothing files it, though Claude
  // Code would work again (its stand-in limits only its first run).
  await sleepUntil(resetsAt * 1000 + 2_000);
  expect(inbox(library)).toHaveLength(1);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(archived(other)).toEqual([]);
  expect(await waitsOf(app, library)).toHaveLength(1); // still the first library's, for when it opens

  // It opens again, and its wait, which is due, files the note.
  await stubPicker(app, library);
  await call(app, "chooseLibrary");
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(archived(other)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

test("a note stopped by a sign-in is filed once Claude Code is signed in", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app, capsule } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "500" } });
  await expect(capsule.getByRole("alert")).toContainText("Claude Code isn't signed in on this Mac.");
  expect(inbox(library)).toHaveLength(1);
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 1 }]);

  // The person signs in, in Terminal. The next look at the sign-in sees it, and the note is filed in the background.
  answerAs(bin, "claude", filingClaude());
  await expect.poll(() => inbox(library), { timeout: 10_000 }).toEqual([]);
  await expect.poll(() => notified(app, "Filed by Claude Code")).toEqual([expect.objectContaining({ title: "Filed by Claude Code" })]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden"); // the card that promised it goes
  expect(await watches(app)).toEqual([]); // and the watch has ended
  // The watch only read the sign-in, which costs nothing: besides the run that failed and the one that filed, no question was asked.
  const calls = await agentCalls(app);
  expect(filingRuns(calls, "claude")).toBe(2);
  expect(signInReads(calls)).toBeGreaterThan(0);
  expect(calls.filter((line) => /^claude (?!-p |auth status$)/.test(line))).toEqual([]);
  await app.close();
});

/** What the card of a note says once no watch will file it: the words for an agent whose sign-in is to be mended by hand, with Terminal still offered. */
const UNWATCHED_CARD = {
  kind: "error",
  message: "Claude Code isn't signed in on this Mac.",
  detail: "Sign in to Claude Code in Terminal. Your note is safe in the inbox; the evening review will try again.",
  action: "open-terminal",
  actionLabel: "Open Terminal",
};

test("the sign-in watch ends after its length, and its card stops promising the filing", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300", AVANZEL_SIGNIN_WATCH_MS: "1500" } });
  await expect.poll(() => watches(app), { timeout: 15_000 }).toEqual([]); // it gives up
  const reads = signInReads(await agentCalls(app));
  expect(reads).toBeGreaterThan(1); // it looked more than once
  // The card, which said the note would be filed straight away, still shows it: now it says only that it is safe, and keeps its button.
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  expect(await cardNote(app)).toBe(inbox(library)[0]);

  // Signed in at last, too late: it no longer looks, and the note waits for the evening review.
  answerAs(bin, "claude", filingClaude());
  await sleep(1_500);
  expect(signInReads(await agentCalls(app))).toBe(reads);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a sign-in the watch can't read ends the watch at its first look, and its card stops promising; the model is never asked", async () => {
  // This Claude Code's sign-in command says nothing a check understands: only a question put to the model could tell, and
  // that costs the person's usage. The watch doesn't ask it, so it can never see the agent signed in: it ends at once rather
  // than look for its whole length (a minute here), and the card that said "straight away" says only that the note is safe.
  const bin = agentStubs({ claude: signedOutClaude({}, { readable: false }) });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300", AVANZEL_SIGNIN_WATCH_MS: "60000" } });
  await expect.poll(() => watches(app), { timeout: 15_000 }).toEqual([]);
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  expect(await cardNote(app)).toBe(inbox(library)[0]);
  await sleep(1_500); // a watch still going would look again every 300 ms
  const calls = await agentCalls(app);
  expect(signInReads(calls)).toBe(1);
  expect(filingRuns(calls, "claude")).toBe(1); // the run that failed: no question, and no filing either
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("notes waiting on one agent's sign-in share one watch", async () => {
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await claudeLibrary(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "500" } });
  await failAnother(app, 1);
  await failAnother(app, 2);
  expect(inbox(library)).toHaveLength(2);
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 2 }]);

  answerAs(bin, "claude", filingClaude());
  await expect.poll(() => inbox(library), { timeout: 20_000 }).toEqual([]);
  await expect.poll(async () => (await notified(app, "Filed by Claude Code")).length).toBe(2);
  await call(app, "idleForTests");
  expect(filesUnder(library, "ideas")).toHaveLength(2);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(4); // the two that failed, and one run each that filed
  expect(await watches(app)).toEqual([]);
  await app.close();
});

test("a note the watch refiled that can't sign in again starts no new watch, and its card says so", async () => {
  // Claude Code's sign-in command says it is signed in, but its runs say they aren't: the watch files the note once more,
  // finds the same thing, and leaves it to the evening review. The card that promised "straight away", which still shows the
  // note, says that in its place; there is no notification besides.
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) });
  const { library, app } = await failedWithClaude(bin, { env: { AVANZEL_SIGNIN_POLL_MS: "300" } });
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 15_000 }).toBe(2); // the watch's run
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toEqual(UNWATCHED_CARD);
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await watches(app)).toEqual([]);
  await sleep(1_500); // a new watch would look again in 300 ms, and file the note once more
  expect(filingRuns(await agentCalls(app), "claude")).toBe(2);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a note the watch refiled that can't sign in again tells a card that is gone by notification, and promises no review if it is off", async () => {
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) });
  // The library's evening review is off, so the words end at "safe in the inbox". The watch looks after 1.5 s; the card is closed before.
  const { library, app } = await failedWithClaude(bin, { eveningReview: false, env: { AVANZEL_SIGNIN_POLL_MS: "1500" } });
  await call(app, "dismiss");
  await expect.poll(async () => filingRuns(await agentCalls(app), "claude"), { timeout: 15_000 }).toBe(2); // the watch's run
  await expect
    .poll(() => call(app, "notificationsForTests"), { timeout: 15_000 })
    .toEqual([{ title: "Claude Code isn't signed in on this Mac.", body: "Sign in to Claude Code in Terminal. Your note is safe in the inbox." }]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await watches(app)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("opening another library ends the sign-in watch, and its card stops promising the filing", async () => {
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")), AVANZEL_SIGNIN_POLL_MS: "500" };
  const bin = agentStubs({ claude: signedOutClaude() });
  const { library, app } = await failedWithClaude(bin, { env });
  expect(await watches(app)).toEqual([{ agent: "claude", notes: 1 }]);
  const other = await makeLibrary();
  await stubPicker(app, other);
  await call(app, "chooseLibrary");
  expect(await watches(app)).toEqual([]); // its note is in a library that is closed now
  expect(await call(app, "capsuleStateForTests")).toEqual(UNWATCHED_CARD);
  // Signed in at last: nothing files that note from here.
  answerAs(bin, "claude", filingClaude());
  await sleep(1_500);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a sign-in failure of another agent starts no watch and no wait", async () => {
  // The library's own agent is the engine's fake one, which says it isn't signed in; only Claude Code and Codex are watched.
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", FAKE_AGENT_MODE: "fail" });
  const capsule = await windowFor(app, "capsule");
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  await expect(capsule.getByText("Sign in to fake in Terminal. Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  expect(await watches(app)).toEqual([]);
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});

// ---- A note that left the inbox while its run waited for the library ----

test("a note another Avanzel filed while the run waited for the library isn't reported as a failure", async () => {
  const bin = agentStubs({ claude: filingClaude() });
  const { library, app } = await claudeLibrary(bin);
  // Another Avanzel has the library, so the filing waits for it ...
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await dictate(app);
    await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "filing", waiting: true });
    // ... and files the note itself, then lets the library go.
    const [note] = inbox(library);
    renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));
  } finally {
    letGo();
    await held;
  }
  // The note is filed: the filing card just goes, with no "stopped without filing" card or notification in its place.
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const kind = await capsuleKind(app);
      seen.add(kind);
      return kind;
    }, { timeout: 30_000, intervals: [50] })
    .toBe("hidden");
  expect(seen.has("error")).toBe(false);
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(0);
  await app.close();
});

test("a wait whose note another Avanzel filed meanwhile files nothing and says nothing", async () => {
  const bin = agentStubs();
  const { library, app } = await limitedFor(bin, 5, { env: AT_THE_RESET }); // Claude Code works by the reset
  const [note] = inbox(library);
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    // At the reset the wait queues its filing, which waits for the library; then the other Avanzel files the note.
    await expect.poll(() => call(app, "busy"), { timeout: 15_000 }).toBe(true);
    renameSync(path.join(library, "inbox", note!), path.join(library, "raw", note!));
  } finally {
    letGo();
    await held;
  }
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(filingRuns(await agentCalls(app), "claude")).toBe(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden"); // the card of the failure, which promised the filing, goes: the note is filed
  expect(await waitsOf(app, library)).toEqual([]);
  await app.close();
});
