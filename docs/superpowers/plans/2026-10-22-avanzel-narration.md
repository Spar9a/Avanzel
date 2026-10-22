# Avanzel first run, Phase 1b: narration that is always true, and the filing guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the first filing, setup shows what the agent really does, as it does it.
- Each page the agent reads, creates or updates becomes a row.
- The shelf tabs count the pages as they are written.
- The filing ends with its proof.

Every Claude Code filing, not only setup's, can no longer change the person's words or the library's settings. Such a write is refused before it happens, with a reason the agent reads. The engine hands each filing's steps to the app: to setup now, and to the capsule in 1c.

**Architecture:**
- **Engine: steps.**
  - `collect()` hands each stdout line over as it arrives.
  - Claude Code runs with `--output-format stream-json --verbose`. `ClaudeStream` turns its tool calls into steps and keeps the final reply, so `RunResult.output` stays plain text.
  - Every other agent is watched through the library folder (`watchWrites`), which sees writes but not reads.
  - The librarian passes both kinds to a new `FileOptions.steps`, as library-relative `FilingStep`s. It lists the writes Claude Code was refused in `FileOutcome.refused`.
- **Engine: guard.**
  - Every Claude Code write run gets `--settings` with deny rules and a `PreToolUse` hook, both for the same paths.
  - Deny rules hold in every permission mode, `--bare` included. The hook adds the reason the agent reads.
  - The hook is a small Node program, written into the run's own temp folder. The app's own binary runs it as Node (`ELECTRON_RUN_AS_NODE=1`). Nothing is installed in the library or anywhere else on the Mac.
- **App.**
  - First, the setup session moves out of `controller.ts` into `setup.ts`, behind a `SetupHost` that the controller implements.
  - Then setup's filing collects steps as `NarrationRow`s (`main/narration.ts`), which the setup snapshot carries.
  - The setup window turns the rows into words (`renderer/common/narration.ts`, which 1c reuses for the capsule).

**Tech Stack:**
- TypeScript (ESM, `.ts` import suffixes) and Node ≥ 22.
- Electron 44.9 with React 19 renderers bundled by esbuild, and `@avanzel/ui`.
- Vitest, and Playwright for Electron.

The owner's Mac has Claude Code 2.1.296. The stream-json shapes below come from its real output, a run captured on 2026-10-20.

**Spec:** §6.2, "Narration that is always true", in `reports/Avanzel UX and first-run design.md`. That file is untracked and lives only in the main checkout: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`.
- **Also used:**
  - §5.2 step 4, the filing show;
  - §6.1, the capsule's Filing row, which moves to 1c;
  - §10, accessibility and calm;
  - §11, Phase 1, "Narration and the guard hook";
  - §13.7.
- **The prototype** is `reports/Avanzel UX prototypes/first-run.html`, lines 628–642. It shows how the rows feel. It predates the design system, so don't copy its code.
- **The UI contract** is `packages/ui/DESIGN.md`.
- **Phase 1a's plan,** `docs/superpowers/plans/2026-10-21-avanzel-setup-window.md`, built the Filing step that this plan fills.

## Where this plan sits: the product plan, revisited

Two parts are done on main: Phase 0 (7deda48), and Phase 1's setup window, 1a (9c0c276).

This plan is 1b, "Narration and the guard hook" in §11. Checking §11 against what 0 and 1a built changed the plan in these ways:

- **It starts with a move.** 1a's final review asked for the setup session to leave `controller.ts` before more goes in. That file was 1,769 lines before 1a and 3,043 after. Task 1 makes the move without changing behaviour.
- **The guard is a deny rule plus the hook.**
  - Claude Code skips hooks passed with `--settings` under `--bare`, and Anthropic says `--bare` will become the default for `-p`.
  - Deny rules from `--settings` hold in every mode.
  - The hook stays for its reason, which the agent reads.
- **Only Claude Code is stopped before it writes.** Guarding the others would mean writing into the library or into the person's own config:
  - Codex hooks need a trusted project, and a trusted hash for each hook.
  - Gemini CLI reads hooks only from settings files.

  These agents keep today's protection: whatever they change is put back after the run.
- **Other agents are narrated from the folder.** That shows their writes, not their reads. Codex's `--json` events could add reads later.
- **Rows say only what files show.** The prototype's "Linked Mark to the podcast" and "Added a to-do…" would need reading the agent's edits, so they aren't planned.
- **The narration shows in setup only, for now.**
  - The capsule's filing card is still legacy markup. It sits outside `@avanzel/ui`'s glass, so new lines in it would be dark on dark in light mode.
  - 1c rebuilds that card on `Hud`. The capsule's live line, its time and an estimate learned from this Mac's own filings go in once, there.
  - The quiet-spell line goes with them. §6.2 says "Claude Code is reading your library"; 1c should say only that the work goes on ("{agent} is still working…"), because the agent may be thinking rather than reading.
- **The tabs count, the cards don't fly yet.** During the filing, setup's shelf tabs count the pages written so far (§5.2 step 4). The mini-cards flying into the tabs remain the owner's component, from 1a's owner items.
- **Moved to later sub-plans:**
  - **to 1c:** the capsule's live line, time, estimate, Cancel and proof lines, and terse mode. The capsule card is where one line versus a list is decided, and setup's list runs before Settings exist;
  - **to 1d:** the evening review's progress, and the menu bar title while a filing runs with the capsule hidden.

**After 1b, this plan proposes 1e before 1c and 1d.**
- **1e: the §7 copy, plus the first-run gaps 1a parked.** It needs no new component and no asset, and it fixes most of what can break a first run:
  - a remembered library that is missing;
  - a Mac without the Command Line Tools;
  - folders too broad to be a library;
  - Cancel's copy in libraries without git.

  Claude Code's stream also carries `rate_limit_event.resetsAt`, so "It resets at 15:00" doesn't have to be guessed from text.
- **1c: the capsule's card, stamp, chips, Auto chip, hint, Unsure and Nothing new,** and now its narration too. It waits on the owner's verdict on 1a's four stand-ins and on its own new pieces, such as chips marked new or updated, and Undo's countdown ring.
- **1d: the menu bar's Zel face and sounds.** It needs recorded sounds and an approved face.

The owner's review of 1a joins 1e. If something in it is urgent, it comes first as a short plan of its own.

## Global Constraints

### Scope

- **In:**
  - the setup session's move out of `controller.ts`;
  - live steps, from Claude Code's stream-json and, for other agents, from the folder;
  - in setup's Filing step: the rows, the tab counts and the proof lines;
  - the Claude Code write guard, which is deny rules plus the hook;
  - `FileOutcome.refused`;
  - the README's Mac app agents table and its guarantees.
- **Out:**
  - **the capsule (1c):** its live line, time, estimate, Cancel and receipt, and terse mode;
  - **the menu bar (1d):** the evening review's progress, and the title while a filing runs hidden;
  - **§7's copy (1e);**
  - **guards for other agents** (Phase 4's hook plumbing);
  - **which settings sources a filing loads** (owner item 3);
  - **live words while talking** (Phase 3);
  - **the mini-card flight** (the owner's component).

### The UI rules (from DESIGN.md)

- **Windows arrange; they don't paint.** Changed window code arranges `@avanzel/ui` components only.
  - No raw elements.
  - No `style`, and no `className` on components.
  - Window CSS only arranges.
- **Nothing changes in `packages/ui`.** Don't add components, variants, tokens or gallery screenshots there. The rows are a stand-in, a `Stack` of `Text` (owner item 1).
- **Narration never says "I".** Rows aren't Zel speaking.
- **The rows are never announced.**
  - Setup's live region wraps only the step's heading (`Filing.tsx:42`), so the heading announces the start and the end.
  - The rows sit outside it, and stay outside it.
- **Rows appear without motion.** The step's one orchestrated moment is still the FILED stamp.

### Behaviour every task keeps

- **No test runs a real agent or sends a prompt.**
  - The opt-in tests in Task 5's `real-claude.test.ts` are the owner's to run.
  - 1a's rules for `launch()` and `firstRun()` still hold: a dead model port, stand-in `claude` and `codex`, and a temporary `HOME`.
- **A step never names:**
  - the capture;
  - anything under `inbox/` or `raw/`;
  - a dot path, meaning any segment that starts with `.`;
  - a path outside the library.

  "Inside the library" means under the root as given or under its real path. On macOS, `/var/folders/…` is really `/private/var/folders/…`, and the agent works from the real one.
- **Narration is best effort.** An error while parsing, watching or reading a title is caught and logged at most with `console.warn`. It never fails a filing. The receipt and the outcome come from the run's diff, as today.
- **A filing's result is unchanged for every agent.** The outcome, the commits and the error line are the same as today.
- **Steps reach setup at most once per 250 ms (`STEP_MS`).**
  - The newest step is always sent within 250 ms, as a trailing update.
  - When a delayed update fires, it first checks that the same filing is still running. If not, it is dropped.
  - It sends only `setup:changed`. It never sends the Settings snapshot and never rebuilds the menu.
  - The filed and failed updates are never held back.

### Copy

Sentence case, no "!", and the one-character "…". Rows have no closing period; the proof lines are sentences.

| Where | Text |
|---|---|
| A read of a page in `people/` | "Reading {title}'s page" |
| A read of any other page | "Reading {title}" |
| A read of `index.md` / `log.md` / `AGENTS.md` | "Reading your library index" / "Reading the log" / "Reading the library's rules" |
| Glob or Grep (one row for a run of them) | "Searching your library" |
| A new page on a shelf | "New {noun} page: {title}", with the nouns goals → goal, ideas → idea, problems → problem, memories → memory, people → person, topics → topic |
| A new page anywhere else | "New page: {title}" |
| An updated page | "Updated: {title}" |
| `index.md` written / `log.md` written | "Updated your library index" / "Added a line to the log" |
| A file removed | "Removed: {title}", where the title is the file name without `.md` |
| The shelf tabs during the filing | Each tab counts the pages written on its shelf so far, the same count it shows once filed |
| Setup's filed state, the proof | "Kept your exact words in raw/." always, then "Saved a snapshot you can undo." when there is a commit and no refused undo. These replace 1a's "Your exact words are kept." |

`{title}` is the page's frontmatter `title:`, else its first `# ` heading, else its file name without `.md` (`pageInfo` in `apps/mac/src/main/library-info.ts`). Setup's working line doesn't change: "{agent} is working: N s of about 15".

During execution, the snapshot line and the ⌘Z hint became one line, "Saved a snapshot. Press ⌘Z or Undo to put everything back.", so `SAVED_LINE` is "Saved a snapshot." (ruling F2 of the final checks).

### Process

- Electron e2e runs with `ELECTRON_RUN_AS_NODE` unset. From `apps/mac`, run `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/<spec>.ts`.
- No new npm dependencies.
- **Stand-in agents in engine tests** start Node as `'${process.execPath}'` and sleep with `/bin/sleep`. Their PATH can be only the stub folder (`harness.test.ts:373`).
- **Commits:** one per task.
  - The subject reads `area: a sentence saying what now happens`, where the area is `mac` or `engine`.
  - The body is wrapped near 78 columns, with bullets saying what changed and why, and no trailers.
- **Each task's gate:**
  - `npm test -w @avanzel/mac`;
  - `npm test -w @avanzel/engine`, when the engine changed;
  - `npm run typecheck`, whose scope includes `apps/mac/e2e`;
  - `npm run design:check`;
  - the e2e specs the task names.
- **Known flakes** that fail the same way on `main`:
  - `microphone.spec.ts:15`;
  - `recording.spec.ts:36`;
  - the engine's "stops an agent that runs too long";
  - an Electron quit hang in about 2.4% of runs.

### Owner items

1. **A narration list in `@avanzel/ui`:** rows that arrive one at a time, with the newest in full ink. The stand-in is a `Stack` of `Text variant="footnote"`.
2. **One opt-in run:** `AVANZEL_TEST_REAL_CLAUDE=1 npm test -w @avanzel/engine -- real-claude`. It spends one short prompt and one filing:
   - the guard refuses a real write to `raw/`;
   - a real filing hands over its reads and writes.

   The owner's own first run with the packaged build shows the rows with the real agent.
3. **Which settings a filing loads.**
   - A filing reads the library's own `.claude/settings.json`. Hooks in it run in every filing, even when the folder was synced from elsewhere.
   - `--setting-sources user` would stop that, but it would also ignore settings someone keeps there on purpose.
   - The owner decides. This plan changes nothing here.
4. **`--bare`.** Anthropic says it will become the default for `-p`. Then:
   - the hook stops running, though the deny rules still hold;
   - Claude Code stops reading OAuth logins, so subscription users' filings fail until Avanzel passes whatever opt-out Anthropic offers.

   Worth watching Claude Code's changelog.

## Review Focus

1. **A Claude Code whose output isn't stream-json:** an older version that rejects a flag, a crash before streaming, or a sign-in message. The person sees the same error line as today, and setup's sign-in Notice still shows for a signed-out Claude Code. Pinned by Task 2's tests "a Claude Code that prints plain text is read as before" and "a failed result fails the run and puts its words on stderr".
2. **A library reached through a symlink.** Every library under `/var/folders` is one, and so is one moved behind a link. Steps and refused paths still come out relative to the library. Pinned by Task 3's "a root reached through a symlink gives library paths", and by Task 7's e2e, which runs in such a library.
3. **The agent exits right after its last write.** This is the usual case, and the watcher may not have had the event yet. `stop()` reports it anyway, from a fresh snapshot. Pinned by Task 3's "reports, at stop, every change the watch hadn't reported yet, and nothing after".
4. **A library path with spaces, a quote or brackets,** such as `~/My Notes [Kate's]`. The hook command still runs, and the deny rules still name the folder. Pinned by Task 5's "works for a library with spaces, a quote and brackets in its path".
5. **A symlink inside the library that leads into `raw/` or out of the library.** The hook follows it and refuses. Pinned by Task 5's "follows a symlink before deciding".

---

### Task 1: Setup lives in its own module, and the controller hands it what it needs

This is a move, not a rewrite. Behaviour doesn't change, and the e2e specs don't change.

**Files:**
- Create: `apps/mac/src/main/jobs.ts`.
  - It holds what setup and the controller share: `Recording`, `FilingJob`, `Correction`, `HARNESS_NAMES` with `harnessName`, `errorMessage` and `lastLines`.
  - Each moves verbatim from where it sits in `controller.ts:147–297`. The rest of that range stays, except `SetupSession`, which goes to `setup.ts`.
- Create: `apps/mac/src/main/setup.ts`, holding `SetupHost` and `class Setup`. It takes:
  - `SetupSession`, now private to this module;
  - the setup fields (`setup`, `upHereWindow`, `setupProgressAt`);
  - every setup method (`controller.ts:1767–2572`);
  - the "up here" bubble (`2574–2628`);
  - the constants only setup uses (`AGENT_POLL_MS`, `PRESS_WAIT_MS`, `SETUP_PROGRESS_MS`, `TERMINAL`).
- Modify: `apps/mac/src/main/controller.ts`. Remove what moved, implement `SetupHost`, and make `readonly setup: Setup` public.
- Modify: `apps/mac/src/main/ipc.ts`. The `setup:*` and `up-here:*` channels call `controller.setup.<method>`.

**Interfaces:**
- **Produces `SetupHost`:** everything setup reads from or calls on the controller, as methods, each with the signature of the controller member it wraps. Start from this list and add what the code needs:
  - **Reads:** `vault()`, `model()`, `settings()`, `hears()`, `recording()`, `capsuleKind()`, `agentCheck(name)`, `libraryProblem()`, `shortcutProblems()`, `takenShortcuts()`, `trayBounds()`, `quitting()`.
  - **Calls:**
    - `broadcast()`, the controller's fan-out, which calls `Setup.publish()` among others;
    - `downloadModel()`, `checkAgents()`, `runAgentCheck(name, harness, prompt, again?)` and `rereadSignIns()`. The setup window's focus handler calls the last one;
    - `useLibrary(target, fromSetup)`, which setup always calls with `true`. That keeps the capsule's taken-shortcut notice from showing during setup;
    - `setLibrarySettings(patch)`, `changeApp(patch)` and `useShortcut(…)`;
    - `startRecording()` and `hideCapsule()`;
    - `file(job)` (enqueue `runFiling`), `takeBack(job)` and `revert(commit)`;
    - `answer(question, abort, progress)`, `agentName()`, `newCapture(text, meta)`;
    - `openQuick()`, `showSettings()`, `toggleDictate()`, `obsidianInstalled()`;
    - the task info `setupSnapshot` reads.
  - **Shared objects:** `firstRun: FirstRunLog`, `queuedToFile: Set<string>`, `noticed: NoticedShortcuts`, and the test recorders `opened` and `copied`.
- **Produces `class Setup`,** made once in the controller's constructor:
  - **State:** `isOpen()`, `show()`, `snapshot(): SetupSnapshot`, `publish()` and `publishProgress()`.
  - **Readers for `rereadSignIns`,** which stays in the controller: `begun()` and `installed()`.
  - **Recording hooks:** `takesPress()`, `press()`, `notePress()`, `moveThought(recording)`, `lost(…)` and `heard(recording, capturePath, text, transcribedIn)`.
  - **Filing hooks:** `owns(job)`, `waiting(job, waiting)`, `filed(job, outcome, pages)` and `failed(job, line)`.
  - **Other hooks:** `shortcutChanged()`, `agentChecked(name)` and `holds(capturePath)`.
  - **Actions:** every IPC action, and the bubble's.
  - Task 6 adds `stepped(job)`.
- **Keeps** every controller member that an e2e spec reaches by name, through `call(app, name)` or `__avanzel.<field>`:
  - as one-line delegates: `setupSnapshot`, `enterSetupStep`, `chooseSetupAgent`, `createSetupLibrary`, `typeSetupThought`, `askInSetup` and `setupStepForTests`;
  - where they are: `menuAction`, `setCapsule`, `rereading` and `runningChecks`.

- [ ] **Step 1: Move the shared types into `jobs.ts`.** The controller imports them from there. Run `npm run typecheck`. Expected: 0 errors.
- [ ] **Step 2: Move setup and the bubble into `Setup`.**
  - **Keep the code as it is.** It keeps its logic, its order and its comments. Only `this.` references to the controller become `this.host.`.
  - **Stale sessions.** Where the controller checked `this.setup === session` after an await, `Setup` checks `this.session === session`. `noPressArrived` keeps its check on the timer's identity.
  - **Timers.** `end()` (once `endSetup`) still clears `pollTimer` and `pressTimer`.
  - **Electron objects.** Reach them at call time, never through bound copies, because e2e tests stub them on the live objects. That covers:
    - `dialog.showOpenDialog`;
    - the window's `webContents.send`, `setBounds` and `close`;
    - `systemPreferences.getAnimationSettings`;
    - `app.setLoginItemSettings`.
  - **Order.** `finish()` still marks `finished` and `firstRun.finished` before the flight. `takeThought` still enters the Filing step before it sets `job` and `filing`.
  - **What stays in the controller,** because more than setup uses it: `showHome`, the agent checks (`rereading` included), `answerQuestion`, the recording state machine and the filing queue.
- [ ] **Step 3: Route the controller's calls into setup.** Each of these goes through `this.setup`:

  | In the controller | Calls on `this.setup` |
  |---|---|
  | `showHome`, `start`, `readyToListen`, `openQuick`, `openAsk`, `openLibraryFolder` | `isOpen()`, `show()` |
  | `menuAction`'s "set up" | `show()` |
  | `recordingFailed` | `lost` |
  | `pressDictate` | `notePress` |
  | `toggleDictate` | `takesPress`, `press` |
  | `stopRecording`, `cancelRecording` | `moveThought` |
  | `afterCapture` | `heard` |
  | `filingProgress` | `waiting` |
  | `runFiling` | `owns`, `filed`, `failed` |
  | `filingFailed` | `failed` |
  | `broadcast` | `publish` |
  | `broadcastProgress` | `publishProgress` |
  | `changeApp` | `shortcutChanged` |
  | `checkAgents` | `agentChecked` |
  | `rereadSignIns` | `begun`, `installed` |
  | `leftAlone` | `holds` |
- [ ] **Step 4: Check.**
  - `npm run typecheck` gives 0 errors.
  - `npm test -w @avanzel/mac` passes.
  - `wc -l apps/mac/src/main/controller.ts` gives at most 2,300.
  - From `apps/mac`, `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test` gives 172 passed and 2 skipped, as on `main` at 9c0c276. Only the known flakes may differ.
  - `git diff --stat main -- apps/mac/e2e` prints nothing.
- [ ] **Step 5: Commit.** Subject: `mac: setup lives in its own module, and the controller hands it what it needs`.

### Task 2: Claude Code hands over each tool call as it happens, and its reply stays plain text

**Files:**
- Create: `packages/engine/src/core/claude-stream.ts`, `packages/engine/test/fixtures/claude-filing.jsonl` and `packages/engine/test/core/claude-stream.test.ts`.
- Modify: `packages/engine/src/core/harness.ts`. The changes are to `HarnessSpec`, `Harness`, Claude's `headless`, `HeadlessOptions`, `RunOptions`, `RunResult`, `runHeadless` and `collect`.
- Modify: `packages/engine/src/core/index.ts` (export `claude-stream.ts`) and `packages/engine/test/core/harness.test.ts`.

**Interfaces:**
- Produces:
```ts
// claude-stream.ts
/** One thing a Claude Code run did, with the path as the agent gave it (absolute). */
export type ToolStep = { kind: "read"; path: string } | { kind: "search" } | { kind: "wrote"; path: string };
/** Reads `claude -p --output-format stream-json --verbose` one stdout line at a time. */
export class ClaudeStream {
  constructor(onStep: (step: ToolStep) => void);
  line(text: string): void;
  /** The result event's `result`; with no result event, the lines that weren't JSON, joined with "\n". */
  get reply(): string;
  /** The result event's `is_error`. */
  get failed(): boolean;
  /** `permission_denials[].tool_input.file_path` (or `notebook_path`), as given. */
  get refused(): string[];
}
// harness.ts
interface HarnessSpec { /* … */ streams?: boolean }            // and Harness.streams; true for the built-in claude only
interface HeadlessOptions { /* … */ settings?: string | null } // claude puts "--settings", settings before "--model"; Task 5 fills it
interface RunOptions { /* … */ onStep?: (step: ToolStep) => void }
interface RunResult { /* … */ refused: string[] }              // [] for agents that don't stream
```
- **Claude's argv.**
  - **Write runs:** `["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--tools", tools, "--allowedTools", tools, "--strict-mcp-config", "--permission-mode", "acceptEdits", ...opt("--settings", settings), ...opt("--model", model)]`.
  - **Read runs:** the same, without the permission mode and the settings.
  - `-p` refuses stream-json without `--verbose`.
- **How events become steps:**
  - A `tool_use` named `Read` gives `read(input.file_path)` at once.
  - A `tool_use` named `Glob` or `Grep` gives `search` at once.
  - A `Write` or `Edit` gives `wrote(input.file_path)`, and a `NotebookEdit` gives `wrote(input.notebook_path)`. Each comes only when its `tool_result` (matched by `tool_use_id`) arrives without `is_error`.
  - Every other event or block is ignored: `thinking`, `text`, `rate_limit_event`, `system/*` (hook events included) and `stream_event`.
  - A line that isn't a JSON object is kept for `reply`.
  - If `onStep` throws, the error is caught and the stream goes on.
- **`runHeadless`, when `harness.streams`:**
  - the stdout lines feed a `ClaudeStream`;
  - `output` is `stream.reply`, and `refused` is `stream.refused`;
  - if `stream.failed`, an exit code of 0 becomes 1, and `stream.reply` is appended to `stderr`.

  Other agents run as today, with `refused: []`. A timeout or a cancel keeps its code and message.
- **`collect(argv, cwd, timeoutMs, signal, onLine?)`:**
  - passes each complete stdout line to `onLine` as it arrives, decoding UTF-8 across chunk boundaries and taking `\n` or `\r\n` as line ends;
  - passes the last unterminated line at close;
  - still collects stdout whole.

- [ ] **Step 1: Write the fixture.** Its shapes are copied from Claude Code 2.1.296's real output, with fields trimmed. Save it as `packages/engine/test/fixtures/claude-filing.jsonl`:
```jsonl
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1792532400,"rateLimitType":"five_hour"},"session_id":"s1"}
{"type":"system","subtype":"init","cwd":"/lib","session_id":"s1","tools":["Read","Write","Edit","Glob","Grep"],"permissionMode":"acceptEdits","claude_code_version":"2.1.296"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"x"}]},"parent_tool_use_id":null,"session_id":"s1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/lib/index.md"}}]},"parent_tool_use_id":null,"session_id":"s1"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":"# Index"}]},"session_id":"s1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Grep","input":{"pattern":"Mark","path":"/lib"}}]},"session_id":"s1"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t2","type":"tool_result","content":"people/mark.md"}]},"session_id":"s1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Write","input":{"file_path":"/lib/ideas/podcast.md","content":"# Podcast"}}]},"session_id":"s1"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t3","type":"tool_result","content":"File created successfully at: /lib/ideas/podcast.md"}]},"session_id":"s1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t4","name":"Edit","input":{"file_path":"/lib/raw/2026/10/x.md","old_string":"a","new_string":"b","replace_all":false}}]},"session_id":"s1"}
{"type":"system","subtype":"hook_response","hook_name":"PreToolUse:Edit","hook_event":"PreToolUse","exit_code":0,"outcome":"success","session_id":"s1"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"PreToolUse:Edit hook error: This file keeps the owner's own words…","is_error":true,"tool_use_id":"t4"}]},"session_id":"s1"}
{"type":"result","subtype":"success","is_error":false,"result":"Filed into [[podcast]].","num_turns":5,"permission_denials":[{"tool_name":"Edit","tool_use_id":"t4","tool_input":{"file_path":"/lib/raw/2026/10/x.md"}}],"terminal_reason":"completed","session_id":"s1"}
```
- [ ] **Step 2: Write the failing tests.**
  - **`claude-stream.test.ts`:**
    - "turns Claude Code's tool calls into steps": feed every fixture line. The steps equal `[{kind:"read",path:"/lib/index.md"},{kind:"search"},{kind:"wrote",path:"/lib/ideas/podcast.md"}]`, without the refused Edit.
    - "takes the reply from the result event": `reply === "Filed into [[podcast]]."` and `failed === false`.
    - "lists the writes Claude Code refused": `refused` equals `["/lib/raw/2026/10/x.md"]`.
    - "keeps lines that aren't JSON as the reply when no result came": feed `Not logged in · Please run /login`. That line is the `reply`, and there are no steps.
    - "says a run failed when its result does": a result with `is_error: true` and `result: "Credit balance is too low"` gives `failed === true`, with that text as the `reply`.
    - "a step listener that throws doesn't stop the stream": every fixture step still arrives.
  - **`harness.test.ts`:**
    - Update both Claude argv pins to the new argv.
    - "a streaming run hands over each step before the agent exits": a stand-in `claude` (`binScripts`) prints the Read `tool_use` line, runs `/bin/sleep 1`, then prints a result line. The step arrives at least 800 ms before `runHeadless` resolves.
    - "Claude Code's reply is the result's text": `output === "Filed."` for a result whose `result` is "Filed.".
    - "a failed result fails the run and puts its words on stderr": the stand-in prints a result with `is_error: true` and `result: "Not logged in · Please run /login"`, then exits 0. The run has `ok === false` and `exitCode === 1`, and `errorLine(stderr)` is "Not logged in · Please run /login".
    - "a Claude Code that prints plain text is read as before": the stand-in prints `Not logged in · Please run /login` and exits 1. That line is the `output`, `ok` is false and `refused` is `[]`.
    - "a line split across two writes is one step": the stand-in prints half a `tool_use` line, runs `/bin/sleep 0.2`, then prints the rest. Exactly one step arrives.
    - "the agent check understands Claude Code's stream": the stand-in prints an init line and a result whose `result` is "ready". `checkAgent` reports it working.
- [ ] **Step 3: Run them.** `npm test -w @avanzel/engine -- claude-stream harness`. Expected: FAIL. `ClaudeStream` doesn't exist yet, and the argv pins differ.
- [ ] **Step 4: Implement** `ClaudeStream`, the argv, `streams`, `onStep`, `refused` and `collect`'s `onLine`.
- [ ] **Step 5: Run them again.** `npm test -w @avanzel/engine`. Expected: PASS, apart from the known flake.
- [ ] **Step 6: Commit.** Subject: `engine: Claude Code's runs hand over each tool call as it happens, and its reply stays plain text`.

### Task 3: Other agents' writes are seen while they run

**Files:**
- Create: `packages/engine/src/core/steps.ts`, `packages/engine/src/core/watch.ts` and `packages/engine/test/core/watch.test.ts`.
- Modify: `packages/engine/src/core/index.ts`, to export `steps.ts`.

**Interfaces:**
- Produces:
```ts
// steps.ts
/** One thing an agent did during a filing, as a path inside the library. */
export type FilingStep =
  | { kind: "read"; path: string }
  | { kind: "search" }
  | { kind: "wrote"; path: string; created: boolean } // created: the path wasn't in the snapshot taken before the run
  | { kind: "deleted"; path: string };
/** `path` (absolute, or relative to the library) relative to the library: under `root` as given or under its real path
    (realpathSync, remembered per root). Null when it is outside, or is the library itself. */
export function insideLibrary(root: string, path: string): string | null;
/** insideLibrary, and also null for a dot path or a path under inbox/ or raw/: the paths a step may name. */
export function stepPath(root: string, path: string): string | null;
// watch.ts
/** Reports each file a run writes or removes, once, while it runs. stop() reports what is left, then ends the watch. */
export function watchWrites(root: string, before: Snapshot, onStep: (step: FilingStep) => void): () => void;
```
- **How the watch works:**
  - It uses `fs.watch(root, { recursive: true })`. A path is judged 150 ms after its last event:
    - **A file now:** it reports `wrote` if the file is new (`created: !before.has(rel)`), or if its `size:mtimeNs` differs from `before`. macOS replays a write made just before the watch started, and this check passes over it.
    - **Gone, and in `before`:** it reports `deleted`.
  - Each path is reported once, and the first judgement wins.
  - Paths that `stepPath` rejects are ignored, and so are folders.
  - An error from the watcher ends the watch silently.
- **`stop()`:**
  - It takes a fresh `snapshot(root)` and diffs it against `before`.
  - It reports every changed path the watch hadn't reported yet (through `stepPath`), then closes the watcher. Events reach `fs.watch` late, so the agent's last write may not have arrived yet.
  - Nothing is reported after `stop()` returns.

- [ ] **Step 1: Write the failing tests** in `watch.test.ts`. They use real files in a temporary library, and `vi.waitFor` with a 3 s limit.
  - "reports a new file, a changed file and a removed one":
    - Before the watch, `ideas/a.md` and `ideas/b.md` exist, and `before` is taken.
    - After a 100 ms pause, write `ideas/new.md`, append to `ideas/a.md` and remove `ideas/b.md`.
    - The steps contain `{kind:"wrote",path:"ideas/new.md",created:true}`, `{kind:"wrote",path:"ideas/a.md",created:false}` and `{kind:"deleted",path:"ideas/b.md"}`.
  - "says nothing about dot folders, inbox/ or raw/": write `.git/x`, `.avanzel/y`, `inbox/z.md` and `raw/2026/q.md`. Wait 600 ms, then `stop()`. There are no steps.
  - "reports a file once, however often it changes": write `ideas/c.md` five times, 30 ms apart. Exactly one step arrives.
  - "reports, at stop, every change the watch hadn't reported yet, and nothing after":
    - Write `ideas/d.md`, then call `stop()` at once. The step for `d` is reported.
    - Write `ideas/e.md` afterwards. After 500 ms there is no step for it.
  - "passes over a write made just before the watch started": write `ideas/f.md`, take `before`, then start the watch. After 600 ms and `stop()`, there is no step for `f`.
  - "a root reached through a symlink gives library paths": with `link` pointing at the real library, both `insideLibrary(link, <realpath>/ideas/x.md)` and `insideLibrary(link, link + "/ideas/x.md")` give `ideas/x.md`.
  - "a step names only paths inside the library", for `stepPath`:
    - `<root>/ideas/x.md` and `ideas/x.md` give `ideas/x.md`.
    - These give null: `/elsewhere/x.md`, `../x.md`, the root itself, `.git/config`, `ideas/.draft.md`, `inbox/x.md` and `raw/2026/10/x.md`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/engine -- watch`. Expected: FAIL, because the modules don't exist.
- [ ] **Step 3: Implement** `steps.ts` and `watch.ts`.
- [ ] **Step 4: Run them again.** `npm test -w @avanzel/engine -- watch`. Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `engine: a run's writes are seen while any agent works, not only after it ends`.

### Task 4: The librarian narrates each filing, and says which writes Claude Code was refused

**Files:**
- Modify: `packages/engine/src/core/librarian.ts`. The changes are to `FileOptions`, `FileOutcome`, `outcome()`, `#fileQueue`, `#fileOne` and `#run`.
- Modify: `packages/engine/test/fake-agent.mjs` and `packages/engine/test/core/librarian.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 2: `RunOptions.onStep`, `RunResult.refused`, `Harness.streams` and `ToolStep`;
  - from Task 3: `FilingStep`, `insideLibrary`, `stepPath` and `watchWrites`.
- **Produces:**
  - `FileOptions.steps?: (step: FilingStep) => void`.
  - `FileOutcome.refused: string[]`. `outcome()` defaults it to `[]`. Each path is `insideLibrary(root, path) ?? path`.
- **`#run`.** `#fileOne` passes `before` and `steps` into it, only when `steps` is given. Asks and the review's digest pass neither.
  - **A streaming harness:** each `ToolStep` becomes a `FilingStep`.
    - Reads and writes go through `stepPath`, and are dropped when it returns null.
    - A write gets `created: !before.has(rel)`.
    - A search passes as it is.
  - **Any other harness:** `watchWrites(root, before, steps)` starts just before `runHeadless`. It stops right after `runHeadless` returns or throws, before `undoProtected` runs. So the guard's own restorations, such as AGENTS.md or `tasks/` put back, are never narrated.
  - **`eveningReview`** threads the caller's `steps` through as `file()` does. The app passes none.
- **New modes in `fake-agent.mjs`,** each documented in its header comment:
  - `FAKE_AGENT_STREAM=claude` prints Claude Code's stream-json, in the fixture's shapes, for what the fake agent does:
    - an init line;
    - a Read of the capture, then of `index.md`;
    - a Write of the idea page;
    - an Edit of `index.md`, and of `log.md` when it logs.

    Its reply is the closing `result` event. Every path is absolute, built from `process.cwd()`.
  - `FAKE_AGENT_STEP_MS=<ms>` waits that long before each file it reads or writes, and before its reply, with the stream or without it.
  - `FAKE_AGENT_REFUSE=<rel>` works in stream mode. The agent also reports a Write of `<rel>` that was refused, without writing it. The refusal is a `tool_result` with `is_error` and "PreToolUse:Write hook error: …", and the path is listed in `permission_denials`.
  - `FAKE_AGENT_READS=<n>` works in stream mode. Before filing, the agent reports `n` Reads of `ideas/seen-<i>.md`, back to back.

- [ ] **Step 1: Write the failing tests** in `librarian.test.ts`.
  - **"a filing tells each file the agent writes while it runs."** It uses the custom `fake` harness, which is watched through the folder, with `FAKE_AGENT_STEP_MS=150`.
    - The steps contain `{kind:"wrote",path:`ideas/idea-${id}.md`,created:true}`, `{kind:"wrote",path:"index.md",created:false}` and `{kind:"wrote",path:"log.md",created:false}`.
    - The outcome is ok, and its `changes.pages` still lists the idea page.
  - **"a Claude Code filing tells what it reads and writes from its own events."**
    - A stand-in `claude` on PATH runs `exec '${process.execPath}' '${FAKE_AGENT}' "$2"` with `FAKE_AGENT_STREAM=claude`. The library's harness is `claude`.
    - The steps, in order, are:
      1. `{kind:"read",path:"index.md"}`;
      2. the idea page as `wrote`, with `created: true`;
      3. `index.md` as `wrote`, with `created: false`;
      4. `log.md` as `wrote`, with `created: false`.
    - `outcome.message` is `` `Filed into [[idea-${id}]].` ``.
  - **"steps never name the capture or raw/."** In that run, no step's path starts with `inbox/` or `raw/`; the Read of the capture is dropped.
  - **"the outcome lists what Claude Code was refused."** With `FAKE_AGENT_REFUSE=raw/2026/10/x.md`, `outcome.refused` equals `["raw/2026/10/x.md"]`, and `outcome.ok` is true.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/engine -- librarian`. Expected: FAIL, because `steps` is ignored and `refused` is undefined.
- [ ] **Step 3: Implement** the librarian changes and the fake agent's new modes.
- [ ] **Step 4: Run all the engine tests.** `npm test -w @avanzel/engine`. Expected: PASS, including every filing test that existed before.
- [ ] **Step 5: Commit.** Subject: `engine: a filing hands over each step the agent takes, and says which writes Claude Code was refused`.

### Task 5: Claude Code is refused writes to the person's words and the library's settings

**Files:**
- Create: `packages/engine/src/core/guard-hook.ts`, `packages/engine/test/core/guard-hook.test.ts`, and `packages/engine/test/core/real-claude.test.ts` (opt-in).
- Modify:
  - `packages/engine/src/core/harness.ts`: `HarnessSpec.guard` and `Harness.guard`, true for the built-in claude only, and `runHeadless`;
  - `packages/engine/src/core/index.ts`: export `guard-hook.ts`;
  - `packages/engine/test/core/harness.test.ts`;
  - `apps/mac/test/build-config.test.ts`;
  - `README.md`: the Mac app's agents and guarantees;
  - `apps/mac/src/main/controller.ts`: the test hook `guardForTests`;
  - `apps/mac/e2e/filing.spec.ts`.

**Interfaces:**
- Consumes: from Task 2, `HeadlessOptions.settings`.
- Produces:
```ts
// guard-hook.ts
/** What no writing agent run may change, as library paths, each with the reason Claude Code reads when it tries. */
export const KEEP_OUT: readonly { path: string; reason: string }[];
/** Writes the hook's program and its rules into `dir`; returns the shell command Claude Code runs for it. */
export function installHook(dir: string, root: string, interpreter: string = process.execPath): string;
/** The `--settings` JSON for a write run: deny rules for KEEP_OUT, and the PreToolUse hook. */
export function guardSettings(root: string, hookCommand: string): string;
```
- **`KEEP_OUT`,** with the reasons word for word. The agent reads them; they aren't UI copy.

  | Paths | Reason |
  |---|---|
  | `inbox`, `raw` | "This file keeps the owner's own words exactly as they said them, and Avanzel archives the capture itself. Leave inbox/ and raw/ as they are, and file into pages on the shelves." |
  | `tasks` | "tasks/ holds the owner's scheduled instructions, and only the owner changes them." |
  | `.avanzel`, `.git`, `AGENTS.md`, `CLAUDE.md`, `opencode.json`, `.mcp.json`, `.agents`, `.claude`, `.codex`, `.cursor`, `.gemini`, `.opencode` | "This is part of how the library is set up, and only its owner changes it. Write pages, index.md and log.md instead." |
  | anywhere outside the library | "This run may only write inside the library, {root}." |

  `log.md`, `index.md`, `reviews/` and the shelves stay writable. The evening review writes its report into `reviews/`.
- **The hook program.** `installHook` writes it as `guard-hook.mjs`, with its rules beside it as `guard-rules.json`: `{ root: realpath(root), rules: KEEP_OUT, outside }`. The program imports only `node:fs` and `node:path`. It:
  1. Reads stdin to the end and parses it. On any failure, it exits 0 and prints nothing.
  2. Takes `tool_input.file_path ?? tool_input.notebook_path`. If that isn't a string, it exits 0.
  3. Resolves the path against `input.cwd`, or against the root when `cwd` is missing. It then follows links: it takes the realpath of the deepest part that exists, and appends the rest.
  4. Takes the result relative to the real root.
     - If it is outside (`..`, starting with `../`, or absolute), the program denies with the outside reason.
     - Otherwise it compares in lower case. A rule matches when `rel === p` or `rel` starts with `p + "/"`, and the program denies with that rule's reason.
  5. Denies by printing `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}` and exiting 0. Anything else exits 0 and prints nothing.
- **The command:** `ELECTRON_RUN_AS_NODE=1 '<interpreter>' '<dir>/guard-hook.mjs' '<dir>/guard-rules.json'`.
  - Each path is single-quoted, and a `'` inside it is written as `'\''`.
  - In the app, `process.execPath` is Avanzel's own binary, and the variable makes it run as Node. The app's own `index.ts` deletes that variable at startup, so only the hook ever gets it. In tests, `process.execPath` is Node itself.
- **The settings JSON:**
  ```json
  {"permissions":{"deny":[…]},"hooks":{"PreToolUse":[{"matcher":"Write|Edit|NotebookEdit","hooks":[{"type":"command","command":"<command>","timeout":10}]}]}}
  ```
  - Nothing else goes in it, because `-p` silently ignores a settings value that fails validation.
  - For each `KEEP_OUT` path, the deny list has `Edit(//<root>/<p>)` and `Edit(//<root>/<p>/**)`. `Edit` rules also cover Write and NotebookEdit.
  - `<root>` is the absolute root without its leading `/`, with `\`, `*`, `?`, `[` and `]` escaped by a backslash.
  - When the root's realpath differs from the root as given, the rules come in both forms.
- **In `runHeadless`,** when `write && harness.guard`: `settings = guardSettings(vault, installHook(tmp, vault))`, passed to `headlessArgv`. The run's temp folder is removed afterwards, as today.
- **`guardForTests(root: string, filePath: string): string`.** The controller's test hook, read only with `AVANZEL_TEST=1`.
  - It installs the hook in a fresh temp folder with `process.execPath`, which under e2e is Electron's binary.
  - It runs the command through `/bin/sh -c`, with `{"tool_name":"Write","tool_input":{"file_path":filePath},"cwd":root}` on stdin.
  - It returns stdout.

- [ ] **Step 1: Write the failing tests.**
  - **`guard-hook.test.ts`** runs each command with `spawnSync("/bin/sh", ["-c", command], { input })` in a temporary library.
    - "refuses a write to the owner's words, with the reason": a Write to `<root>/raw/2026/10/x.md` returns a deny whose reason contains "own words".
    - "refuses the library's settings": `.avanzel/config.toml`, `AGENTS.md`, `.claude/settings.json` and `tasks/weekly.md` are each denied.
    - "lets pages, the index, the log and reviews through": `ideas/a.md`, `index.md`, `log.md` and `reviews/2026-10-22-evening.md` each print nothing and exit 0.
    - "refuses a write outside the library": `/tmp/elsewhere.md` is denied, with the root named in the reason.
    - "follows a symlink before deciding": with `ideas/link` pointing at `<root>/raw`, a Write to `<root>/ideas/link/x.md` is denied.
    - "takes a relative path from the agent's folder": `raw/x.md`, with `cwd` the root, is denied.
    - "matches in any letter case": `<root>/RAW/x.md` is denied.
    - "stays quiet about input it doesn't understand": stdin `not json`, and stdin `{"tool_input":{}}`, each print nothing and exit 0.
    - "works for a library with spaces, a quote and brackets in its path": a root named `My Notes [Kate's]` is still denied `raw/x.md`.
    - "denies the same paths to Edit, for the root and its real path", checked on the parsed `guardSettings`:
      - the deny list contains `` `Edit(//${root.slice(1)}/raw/**)` ``;
      - a root reached through a symlink has rules in both forms;
      - brackets in the root are escaped (`\[`);
      - the hook entry has matcher `Write|Edit|NotebookEdit` and timeout 10.
  - **`harness.test.ts`:**
    - "Claude Code's write runs carry the guard; reads and other agents don't". A stand-in `claude` records its argv:
      - a write run has `--settings`, whose JSON parses and has a non-empty `permissions.deny`;
      - a read run has no `--settings`;
      - a Codex write run has none.
    - "the hook works during the run and is gone after":
      - The stand-in `claude` is `#!/bin/sh` that runs `exec '${process.execPath}' -e '…'`.
      - It reads its own `--settings`, runs the hook command with a Write of `<vault>/raw/x.md` on stdin, and prints `{"type":"result","is_error":false,"result":<the hook's stdout, as a JSON string>}`.
      - The `output` contains `"permissionDecision":"deny"`, and the hook's script path is gone once `runHeadless` returns.
  - **`build-config.test.ts`:** "the build keeps Electron's run-as-node fuse, which the filing guard needs". `electron-builder.yml` has no `electronFuses` key.
  - **`filing.spec.ts`:** "the filing guard's hook runs with Avanzel's own binary as Node". `call(app, "guardForTests", library, <library>/raw/2026/x.md)` contains `"permissionDecision":"deny"`, and `<library>/ideas/a.md` gives `""`.
  - **`real-claude.test.ts`,** inside `describe.skipIf(!process.env.AVANZEL_TEST_REAL_CLAUDE)`:
    - "Claude Code itself refuses a write to raw/":
      - Use a bare temporary folder holding only an empty `raw/`, with no AGENTS.md. A library's rules would tell Claude never to touch `raw/`, and then it might not try.
      - Call `runHeadless` with the built-in `claude`, the prompt "Create the file raw/hello.md containing the word hi, then reply done.", `write: true` and `timeoutSeconds: 120`.
      - `raw/hello.md` doesn't exist afterwards, and `result.refused` names it.
    - "a real Claude Code filing hands over its reads and writes":
      - Use a temporary `Vault.init` library, with the harness set to `claude`.
      - `librarian.file` with `steps` files a capture.
      - At least one `read` step and one `wrote` step arrive, and the outcome is ok.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/engine -- guard-hook harness` and `npm test -w @avanzel/mac -- build-config`. Expected: FAIL, because `guard-hook.ts` doesn't exist.
- [ ] **Step 3: Implement** `guard-hook.ts`, `guard`, the `runHeadless` change and `guardForTests`.
- [ ] **Step 4: Update the README.** The README also documents the Python command line, which still runs `--output-format text` with no guard (`src/avanzel/harness.py`). So both changes say "In the Mac app":
  - **The agents table's Claude Code row** shows the Mac app's command: `claude -p … --output-format stream-json --verbose --tools Read,Write,Edit,Glob,Grep --permission-mode acceptEdits --strict-mcp-config --settings <guard>`.
  - **A new first bullet in the guarantees list** says: in the Mac app, a Claude Code write to `inbox/`, `raw/`, `tasks/`, the files listed below or anywhere outside the library is refused before it happens, and the agent is told why. The put-back bullets stay, since every agent still gets them.
- [ ] **Step 5: Run the checks.** `npm test -w @avanzel/engine` and `npm test -w @avanzel/mac`. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/filing.spec.ts`. Expected: PASS, with `real-claude` skipped.
- [ ] **Step 6: Commit.** Subject: `engine: Claude Code is refused writes to the owner's words and the library's settings before they happen`.

### Task 6: Setup's filing collects the agent's steps as rows

**Files:**
- Create: `apps/mac/src/main/narration.ts` and `apps/mac/test/narration.test.ts`.
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/main/jobs.ts`, `apps/mac/src/main/controller.ts`, `apps/mac/src/main/setup.ts` and `apps/mac/e2e/setup.spec.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 4: `FileOptions.steps` and `FilingStep`;
  - from Task 1: `Setup.owns`.
- **Produces:**
```ts
// shared/ipc.ts
export interface NarrationRow {
  kind: "read" | "search" | "new" | "updated" | "removed";
  path: string | null; // the library path; null for a search
  title: string;       // pageInfo's title; for "removed", the file name without .md; "" for a search
  shelf: string;       // the first folder of a path inside a folder; "" for a root file or a search
}
// SetupFiling "running" gains: rows: NarrationRow[]
// main/narration.ts
export const MAX_ROWS = 50;
/** The rows after one more step, kept to the newest MAX_ROWS. */
export function withStep(rows: readonly NarrationRow[], step: FilingStep, page: (rel: string) => FiledPage): NarrationRow[];
// main/setup.ts
stepped(job: FilingJob): void; // sends the running filing's rows, throttled
```
- **`withStep` rules:**
  - A `read` adds a "read" row, unless the path already has a row of any kind.
  - A `search` adds a "search" row, unless the newest row is already a search.
  - A `wrote` with `created` adds a "new" row, unless the path already has a "new" row.
  - A `wrote` without `created` adds an "updated" row, unless the path already has a "new" or "updated" row.
  - A `deleted` adds a "removed" row, once.
- **The controller:**
  - `FilingJob` gains `rows: NarrationRow[]`, starting as `[]`.
  - `runFiling` passes `steps` to `file()` only when `this.setup.owns(job)`.
  - `filingStep(job, step)` sets `job.rows = withStep(job.rows, step, (rel) => pageInfo(root, rel))`, then calls `this.setup.stepped(job)` if setup still owns the job.
- **`Setup.stepped`:**
  - It sends at most one update per `STEP_MS = 250`, trailing.
  - It sends only `setup:changed`, the way `publishProgress` does.
  - Before sending, it checks that `this.session?.job === job` and that the filing is still `running`. Otherwise the update is dropped.
  - The running snapshot's `rows` is `job.rows`.

- [ ] **Step 1: Write the failing tests.**
  - **`narration.test.ts`,** with a `page` stub:
    - "a page read and then updated is two rows": a read of `people/mark.md`, then a write to it without `created`, give kinds `["read","updated"]` and titles `["Mark","Mark"]`.
    - "a new page stays one row however often it's written": three created writes to `ideas/x.md` give one "new" row.
    - "a run of searches is one row, and a search after a read is another": `[search, search, read a, search]` gives kinds `["search","read","search"]`.
    - "keeps the newest fifty": 60 reads of different paths leave 50 rows, and the first is read number 11.
    - "a removed page is named by its file name": deleting `ideas/old-plan.md` gives title "old-plan".
    - "root files have no shelf": writing `index.md` gives `shelf: ""`.
  - **`setup.spec.ts`:** "setup's snapshot carries each step while the first thought is filed".
    - Run `firstRun({ claude: filingClaude() })` with `FAKE_AGENT_STREAM: "claude"` and `FAKE_AGENT_STEP_MS: "1000"`.
    - Go through Found and type "Call the vet on Monday" the way the typed-thought tests at `setup.spec.ts:1044–1321` do.
    - Poll `call(app, "setupSnapshot")` with `intervals: [50]` until `filing.kind === "running"` and `filing.rows` has a row with `kind: "new"`, `title: "Call the vet on Monday"` and `shelf: "ideas"`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- narration`. Expected: FAIL.
- [ ] **Step 3: Implement** the type, `withStep`, `stepped` and the controller's wiring.
- [ ] **Step 4: Run the checks.** `npm test -w @avanzel/mac` and `npm run typecheck`. Then, from `apps/mac`, `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/setup.spec.ts e2e/filing.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `mac: setup's first filing collects each step the agent takes as it happens`.

### Task 7: Setup's Filing step shows each step as a row, counts the pages on the tabs, and ends with its proof

**Files:**
- Create: `apps/mac/src/renderer/common/narration.ts` and `apps/mac/test/narration-copy.test.ts`.
- Modify:
  - `apps/mac/src/renderer/setup/steps/Filing.tsx`;
  - `apps/mac/src/shared/ipc.ts` and `apps/mac/src/main/setup.ts`, where `SetupFiling`'s "filed" state loses `restored`;
  - `apps/mac/e2e/setup.spec.ts`.

**Interfaces:**
- Consumes: from Task 6, `NarrationRow`, and `SetupFiling`'s "running" state with `rows`.
- Produces (1c reuses `rowLine` for the capsule):
```ts
// renderer/common/narration.ts
export const SHOWN_ROWS = 6;
export const KEPT_LINE = "Kept your exact words in raw/.";
export const SAVED_LINE = "Saved a snapshot you can undo.";
export function rowLine(row: NarrationRow): string;
```
- **The working state.**
  - Under the existing row with the working line and Cancel, add a `Stack gap={4}` with one `Text variant="footnote"` for each of `rows.slice(-SHOWN_ROWS)`.
  - The newest row has the default tone, and the others `tone="secondary"`.
  - No icons, and no animation.
  - Each key is the row's kind and path, plus its index for a search.
- **The tabs (`FilingStage`).**
  - While the filing runs, each tab counts the distinct paths on its shelf among the "new" and "updated" rows.
  - Once filed, the tabs count the filed pages, as today. The two counts agree.
- **The filed state.**
  - Remove the `restored` line.
  - Between `<Receipt>` and `<Actions>`, add `Text variant="footnote" tone="secondary"` lines: `KEPT_LINE` always, then `SAVED_LINE` when `filing.canUndo && !filing.undoRefused`.

- [ ] **Step 1: Write the failing tests.**
  - **`narration-copy.test.ts`** checks each row of the Copy table. For example:
    - `rowLine({kind:"read",path:"people/mark.md",title:"Mark",shelf:"people"})` is "Reading Mark's page".
    - `rowLine({kind:"new",path:"ideas/p.md",title:"Indie game dev podcast",shelf:"ideas"})` is "New idea page: Indie game dev podcast".
    - Each of the six shelves gets its own noun, and `projects/` gives "New page: …".
    - `index.md`, `log.md` and `AGENTS.md` read as in the table.
    - A search is "Searching your library", and a removed page "Removed: old-plan".
    - "no line says I or ends with !": every line goes through the check.
  - **`setup.spec.ts`:**
    - "the first filing shows each step the agent takes, as it takes it".
      - Run `firstRun({ claude: filingClaude() })` with `FAKE_AGENT_STREAM: "claude"` and `FAKE_AGENT_STEP_MS: "1000"`, and file "Call the vet on Monday".
      - While the heading still reads "Watch me file it.", these become visible in turn:
        1. "Reading your library index";
        2. "New idea page: Call the vet on Monday";
        3. "Updated your library index";
        4. "Added a line to the log".
      - Then the "All filed." heading shows.
    - "the shelf tabs count the pages while the filing runs". In the same setup, once "New idea page: …" shows and the heading still reads "Watch me file it.", the stage has a count labelled "1 new" (`getByLabel`).
    - "the first filing ends with its proof". After "All filed.", "Kept your exact words in raw/." and "Saved a snapshot you can undo." are visible. Setup's library has git.
    - "a hundred quick steps reach the setup window as a few updates".
      - Use `FAKE_AGENT_STREAM: "claude"` and `FAKE_AGENT_READS: "100"`.
      - Count the window's `setup:changed` sends during the filing, the way the download throttle test at `setup.spec.ts:2539` does.
      - There are at most 20.
    - "the steps aren't announced". From a row's text, `el.closest('[aria-live],[role="status"],[role="log"]')` is null. Components take no aria or data props, so the test reaches the container from the text.
    - **Updated tests:**
      - `setup.spec.ts:1748` and `:1811` now expect `KEPT_LINE`, both when the agent left the words alone and when it tampered with them.
      - The whole-text regex at `setup.spec.ts:1750–1752` now ends `…OctoberIdeasKept your exact words in raw/\.Saved a snapshot you can undo\.UndoOpen the page$`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- narration-copy`. Expected: FAIL.
- [ ] **Step 3: Implement** `common/narration.ts`, the rows, the tabs and the proof, and remove `restored`.
- [ ] **Step 4: Run the checks.** `npm test -w @avanzel/mac`, `npm run typecheck` and `npm run design:check`. Then, from `apps/mac`, `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/setup.spec.ts e2e/contrast.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `mac: setup's first filing shows each step the agent takes, counts its pages, and ends with what was kept and saved`.

### Task 8: The whole branch, checked

- [ ] **Step 1: Run every check.** From the worktree root: `npm test`, `npm run typecheck`, `npm run design:check` and `npm run ui:e2e`. Then, from `apps/mac`, run the whole e2e suite: `env -u ELECTRON_RUN_AS_NODE npm run e2e`. Expected: all pass, apart from the known flakes. The gallery screenshots are unchanged, since `packages/ui` wasn't touched.
- [ ] **Step 2: Run the `design-reviewer` agent** on the window changes, `apps/mac/src/renderer/setup/steps/Filing.tsx` and `apps/mac/src/renderer/common/narration.ts`. Fix what it reports against DESIGN.md.
- [ ] **Step 3: Commit the fixes** from Steps 1 and 2, if there are any, as one commit with a subject in the Process form.
- [ ] **Step 4: Report:**
  - the rows' stand-in (owner item 1);
  - that the opt-in run hasn't been done (owner item 2);
  - owner items 3 and 4;
  - that no gallery section changed;
  - the line counts of `controller.ts` and `setup.ts`.
