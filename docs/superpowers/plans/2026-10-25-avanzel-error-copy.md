# Avanzel Phase 1e, "every problem says what happened, what's safe, and one fix" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every problem a person meets in Avanzel says what happened, what is safe, and offers the one thing that fixes it, in the words of §7 of the UX doc. Where §7's words promise something ("will be filed then", "resumes"), the app does it. The first-run gaps parked in 1a and the leftovers of 1f's final review are closed. Before that, the e2e suite gets faster, so each task's gate takes minutes, not a quarter of an hour.

**Architecture:**
- **The engine classifies a failed agent run.** `classifyFailure(result)` sorts it into a usage limit (with its reset time when known), a sign-in, a timeout or anything else. It reads the run's last lines, never the prompt an agent may echo. A missing agent is a `NoAgentError`, which names the library's own agent when that one is gone. Claude Code's `rate_limit_event` is read, no longer ignored.
- **One source of problem copy.** `apps/mac/src/shared/problems.ts` turns a failure into a title and a body. Main uses it for the capsule's card and the notifications, and setup's and Ask's renderers use the same functions. `ownLine` moves there from setup's copy, which re-exports it.
- **The capsule card's one fix.** The capsule is a legacy window that 1c rebuilds, so it gets no new elements. Its one optional button now takes its label and action from main (`actionLabel`, `CardAction`). New actions: open Terminal, and file the note again with an agent (`refile:<agent>`).
- **What the copy promises, main does:**
  - a note stopped by a usage limit is filed when the limit resets;
  - a note stopped by a missing sign-in is filed once a free check sees the agent signed in;
  - a speech-model download continues from where it stopped, when part of it was kept.

  Only the capsule and the notifications promise the two waits. Setup's window doesn't start them, so its copy says "try again" instead (`after: "retry"`).
- **The first-run gaps:**
  - git that is only Apple's stub counts as no git, for a new library and for one that already has `.git`;
  - a remembered library that is missing at launch is named, in Settings;
  - system folders are too broad for a library;
  - a cancelled filing in a library without git doesn't say "nothing else changed".

**Tech Stack:**
- TypeScript (ESM, `.ts` import suffixes) and Node ≥ 22.
- Electron 44.9 with React 19 renderers bundled by esbuild (`apps/mac/scripts/build.mjs`), and `@avanzel/ui`.
- Vitest, and Playwright for Electron (`workers: 1`).

**Spec:** `reports/Avanzel UX and first-run design.md`. It is untracked and lives only in the main checkout: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`.
- **The sections used:**
  - §7, the problem table and the empty states;
  - §5.2, the first-run paths;
  - §6.5, the menu's Recently filed;
  - §10, accessibility.
- **The test-speed review,** whose quick wins Tasks 1 and 2 take: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/archive/test-speed-review.md` (§3.3 and §4).
- **1f's final review,** for the leftovers in Task 11: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/archive/ledgers/1f-final-review.md` (M2, M3, M6, the Privacy refresh, and the IPC senders).
- **The UI contract** is `packages/ui/DESIGN.md`.

## Where this plan sits

Four parts are done on main (3da9beb):
- Phase 0;
- 1a, the setup window;
- 1b, the narration and the filing guard;
- 1f, Settings, Quick and Ask on `@avanzel/ui`.

The release comes after the product plan's Phase 5. Of Phase 1, three sub-plans are left:
- **1c, the capsule,** waits on the owner's verdicts on the stand-in components.
- **1d, the menu bar and sounds,** waits on art and sound files.
- **1e** needs neither, so it comes first.

**Not in 1e:**
- **The capsule's new card, stamp, chips and narration, and any second button on its cards (1c).** §7 pairs fixes ("File it with Codex now / Wait until 15:00"). The legacy capsule holds one, so each card gets the better fix, and the pair waits for 1c.
- **Record now, transcribe later.** Nothing records while the speech model is missing, so the download-failed card says typing works, not "your recording is safe". 1c can add it.
- **"Watch a sample filing"** for a Mac with no agent.
- **"Show history"** for a refused Undo. Nothing in the app can show git's history.
- **The menu bar's status line,** "3 thoughts filed today. Letter at 21:00." (1d).
- **The evening review's own problem notifications.** `notFiled` and "… didn't run" (`apps/mac/src/main/controller.ts:117-122`, `:2108-2109`) still pass the agent's line through.

## Global Constraints

### Scope

- **In:**
  - Tasks 1–2, the test-speed quick wins:
    - `setup.spec.ts` split into section files;
    - the two slow engine test files split;
    - a test-only quit wait;
    - cached test speech;
    - screenshots only when asked.
  - Tasks 3–7: agent problems, from the engine's classification to every window's copy, plus the refile, limit-reset and sign-in behaviour.
  - Tasks 8–9: voice, permission and download problems, with a resuming download, and the empty states.
  - Task 10: the first-run gaps.
  - Task 11: 1f's leftovers in Settings.
  - Task 12: the whole-branch check.
- **Out:** everything under "Not in 1e" above.
- **No change in `packages/ui`.** There are no new components, variants, tokens, gallery entries or screenshots. The design checks' baseline (the capsule's two files) must not rise. In `apps/mac/src/renderer/capsule/main.tsx`, change strings and props only; add no element.

### The UI rules (from DESIGN.md, as in 1f)

- **Windows arrange `@avanzel/ui` components.** No raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`–`<h6>`. No `style`, and no `className` on components. Window CSS only lays out, with `var(--av-space-N)`.
- **One primary per moment.** A Notice's fix is its primary. A second action is `secondary` or `quiet`.
  - `quiet` is for dismissing. Actions such as "Install git", "Set up a new library" and "Quit and reopen" are `secondary`.
  - The capsule's legacy error card keeps OK as its primary until 1c.
- **Status is announced only when the person asked,** as in 1f's D5. A problem that appears by itself is a `Notice` with `tone="error"` (it has `role="alert"`). Nothing new ticks inside a live region.
- **Interface files are changed with the Edit and Write tools.** The design guard refuses shell writes to `.tsx`, `.css` and `.html` under `apps/*/src/renderer`.

### Behaviour every task keeps

- **No test runs a real agent, downloads a model, or touches the person's config.**
  - Library-choosing tests set `XDG_CONFIG_HOME`.
  - The fake agent and the shell stand-ins (`apps/mac/e2e/helpers.ts`: `agentStubs`, `answerAs`, `filingClaude`) play every agent.
  - **A test whose outcome depends on which agents are installed uses an exact PATH.** It launches with `AVANZEL_EXACT_PATH: "1"` and PATH set to `${stubs}:/usr/bin:/bin:/usr/sbin:/sbin`, as `firstRun()` does (`helpers.ts:198-212`). Without it, main widens PATH (`apps/mac/src/main/index.ts:14-16`) and finds this Mac's real `claude`, `codex`, `opencode` and `cursor-agent`.
- **Electron objects are reached at call time** (`shell`, `clipboard`, `dialog`, `app`, `Menu`), so the e2e tests can stub them on the live objects. A new call to `shell.openPath`, `clipboard.writeText` or `app.relaunch`, or a new spawned process, gets a ForTests record, as `openedForTests` and `copiedForTests` do.
- **A failed note stays in `inbox/`,** as today (`packages/engine/src/core/librarian.ts:322`). Nothing in 1e moves or deletes a person's words.
- **Names stay:**
  - the IPC channel names (new channels are added, none renamed);
  - the window titles;
  - the e2e helper names other specs import.
- **The setup window's behaviour is unchanged,** except its problem copy (Tasks 7 and 10), and Found's git lines and Install git (Task 10).

### Copy

The rules:
- sentence case;
- verbs first on buttons;
- no "!", and the one-character "…";
- they/them;
- "Claude Code", "Codex" and so on as display names.
- A command appears in code font only where the person types it. `Problem.command` marks it: windows set it in code font, and the capsule and notifications, which take strings, show it plain.
- No title starts with "your agent". A failure names its agent; when there is none to name, it uses the no-agent copy.
- Units are written "15 min" and "45 s". Times are 24-hour "15:00", as the app already shows them.

A problem is three parts:
- the title says what happened;
- the body says what is safe, and anything the person needs to know;
- one fix.

In the table, `{…}` is a value.

| Where | Title | Body | Fix |
|---|---|---|---|
| Filing: usage limit, reset known | "{Claude Code} has hit its usage limit." | "It resets {at 15:00}. Your note is safe in the inbox and will be filed then." | "File it with {Codex} now", when another agent is installed; else none |
| Filing: usage limit, reset unknown | same | "Your note is safe in the inbox; the evening review will try again." | same |
| Filing: not signed in (Claude Code, Codex) | "{Claude Code} isn't signed in on this Mac." | "Run `{claude}` once in Terminal and sign in, and your note will be filed straight away." (Codex: "Run `codex login` in Terminal, and your note will be filed straight away.") | "Open Terminal" |
| Filing: not signed in (others) | "{OpenCode} isn't signed in on this Mac." | "Sign in to {OpenCode} in Terminal. Your note is safe in the inbox; the evening review will try again." | "Open Terminal" |
| Filing: timeout | "{Claude Code} took longer than {15 min} and was stopped." | "Your note is safe in the inbox; the evening review will try again." | "Try again" |
| Filing: the library's agent is gone (a `NoAgentError` that names it) | "{Claude Code} isn't installed on this Mac any more." | "Your note is safe in the inbox. Settings → Agents can choose another agent, or has its install command." | "Open Settings" (Agents) |
| Filing: no agent installed (a `NoAgentError` that names none) | "Avanzel needs an AI agent to do the filing." | "Your note is safe in the inbox. Claude Code works best, and Settings → Agents has its install command." | "Open Settings" (Agents) |
| Filing: anything else | "{Claude Code} couldn't file this note." | "{the agent's line, through ownLine} Your note is safe in the inbox; the evening review will try again." | "Try again" |
| Filing: partial edits, with a commit | | append " {Claude Code}'s partial edits are kept as their own commit in the library's history." | |
| Filing: partial edits, no commit | | append " Its partial edits stay in the library, outside its history, so they can't be undone." | |
| Filing: words kept aside | | "Your note is safe in the inbox" becomes "Your words are kept in {path}, and the inbox holds the agent's version" | |
| Any row that ends with the evening review, while the library's evening review is off | | the body ends at "Your note is safe in the inbox.", with no promise | |
| Setup's filing (`after: "retry"`): usage limit, reset known | same as filing | "It resets {at 15:00}. Your note is safe in the inbox; try again then." | setup's own buttons |
| Setup's filing (`after: "retry"`): not signed in | same as filing | "Run `{claude}` once in Terminal and sign in, then try again. Your note is safe in the inbox." (Codex: "Run `codex login` in Terminal, then try again. Your note is safe in the inbox."; others: "Sign in to {OpenCode} in Terminal, then try again. Your note is safe in the inbox.") | setup's own buttons |
| Corrected words not saved yet (after Edit; not an agent's failure) | "Your corrected words weren't saved yet." | today's: "{the error's last lines} Your corrected words are saved to your inbox when you quit; the original note is still there." (the last clause only while it is) | none (OK) |
| `resetPhrase` | | "at 15:00" the same day; "tomorrow at 09:00"; "on Monday at 09:00" 2–6 days ahead; else "on 3 November at 09:00" | |
| Ask: usage limit | "{Claude Code} has hit its usage limit." | "Your library hasn't changed. It resets {at 15:00}." (reset unknown: "Your library hasn't changed.") | "Ask again" |
| Ask: not signed in | "{Claude Code} isn't signed in on this Mac." | "Your library hasn't changed. Run `{claude}` once in Terminal and sign in, then ask again." (Codex: "Your library hasn't changed. Run `codex login` in Terminal, then ask again."; others: "Your library hasn't changed. Sign in to {OpenCode} in Terminal, then ask again.") | "Open Terminal" (primary, through `window.avanzel.setup.openTerminal()`), "Ask again" (secondary) |
| Ask: timeout | "{Claude Code} took longer than {15 min} and was stopped." | "Your library hasn't changed." | "Ask again" |
| Ask: the library's agent is gone | "{Claude Code} isn't installed on this Mac any more." | "Your library hasn't changed. Settings → Agents can choose another agent, or has its install command." | "Open Settings" (Agents, through `window.avanzel.capsule.openSettingsFor("open-settings:agents")`) |
| Ask: no agent installed | "Avanzel needs an AI agent to answer." | "Claude Code works best, and Settings → Agents has its install command." | "Open Settings" (Agents, through `window.avanzel.capsule.openSettingsFor("open-settings:agents")`) |
| Ask: anything else | "{Claude Code} couldn't answer." | "Your library hasn't changed. {ownLine(line)}" | "Ask again" |
| Ask: the run changed files | | "Your library hasn't changed." becomes "{Claude Code} changed {3 files} while answering; they're left as they are." For one: "{Claude Code} changed 1 file while answering; it's left as it is." | |
| Undo refused | "This one can't be undone automatically." | "Usually a later change touched the same lines. The library's history keeps both versions." | none (OK) |
| Undo refused, after Edit | "The agent's first try can't be taken back automatically." | same body, then " The note waits in your inbox for the evening review." while it is there | none |
| No speech heard | "Nothing was heard." | "Is the right microphone selected? Nothing was saved." | "Choose microphone" (Settings → Voice) |
| Microphone denied (capsule) | "Avanzel can't hear you yet." | "Allow it in System Settings, under Microphone." | "Open System Settings" |
| Microphone didn't start | "The microphone didn't start." | "{ownLine(reason)} Nothing was recorded. Check the microphone in Settings → Voice." | "Open Settings" (Voice) |
| Screen not allowed (capsule) | "Avanzel can't see the screen yet." | "Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel." | "Open System Settings" |
| Privacy: screen row, not granted | | the note stays | "Open System Settings" (secondary) and "Quit and reopen" (secondary) |
| Download failed (capsule, Voice) | "The speech model didn't finish downloading." | when part of it was kept: "{ownLine(reason)} Typing works meanwhile, and Try again continues where it stopped."; otherwise "{ownLine(reason)} Typing works meanwhile, and Try again downloads it again." The reason names the file and why, without the URL. | "Try again" |
| Menu: Recently filed, empty | | an enabled item under the "Recently filed" header whose action is `dictate`, so clicking it starts a recording: "Nothing filed yet. Press {⌥Space} and say hello." When there is no dictate shortcut: "Nothing filed yet. Record a thought and say hello." | |
| Ask: library with no pages | | the empty line becomes "Your shelves are empty. Say something first, then ask about it." | |
| Found: git missing | | the new-library line becomes "A new library: Markdown files. This Mac has no git yet, so changes can't be undone." The has-files line becomes "This folder has files already. I'll add the shelves and an AGENTS.md for your agent. This Mac has no git yet, so changes can't be undone." | "Install git" (secondary) |
| Settings: library missing at launch | "Avanzel can't find your library at {~/Avanzel}." | "Choose it again once it's back, or choose another folder." | "Choose a folder…" (primary), "Set up a new library" (secondary), which opens setup with `~/Avanzel` as the suggested place |
| Menu: library missing at launch | the top item is "Set up Avanzel…", sublabel "Can't find your library at {~/Avanzel}.", opening Settings | | |
| Setup: cancel, no commit but changed files | | "Your words are back in the inbox. The agent's partial edits stay as they are, because nothing recorded them." | |
| General: auto-commit off | | the library line ends "Automatic commits are off in this library's settings, so changes can't be undone from Avanzel." A library without git keeps its no-git line. | |
| Voice: speech row, English-only model | | "Turns your voice into English text on this Mac. Nothing is sent anywhere." | |
| Voice: speech row, command backend | | "Turns your voice into text with the command in this library's settings." | |
| Settings: a change that failed | "That change wasn't saved." | "{ownLine(remoteMessage(reason))}" | none; it goes with the next change or pane |

### Process

- **One commit per task.** The subject is `area: a sentence saying what now happens`, with a bulleted body and no trailers.
- **Each task's gate:**
  - from the worktree root: `npm test -w @avanzel/mac`, `npm test -w @avanzel/engine` when the engine changed, `npm run typecheck`, and `npm run design:check`;
  - from `apps/mac`: `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test <the specs the task names>`.
- **After Task 1,** the setup tests live in section files, so tasks name those, not one 2,800-line file.
- **The full e2e suite runs only in Tasks 2 and 12.**

### Owner items

These need the owner's approval, or are the owner's choice:
1. **Pairs of fixes.** §7 pairs some fixes. The capsule holds one, so each card gets one until 1c:
   - usage limit: File it with Codex now (no "Wait"; waiting is automatic);
   - not signed in: Open Terminal (no "Use another agent");
   - microphone denied: Open System Settings (no "Type instead").
2. **"Watch a sample filing"** isn't built.
3. **"Show history"** for a refused Undo isn't built.
4. **Record now, transcribe later** isn't built, so the download-failed copy doesn't say "Your recording is safe".
5. **The sign-in watch lasts 30 minutes.** After that, the evening review files the note.
6. **The usage-limit shapes are unconfirmed.** Claude Code's `rate_limit_event` statuses and message formats at a real limit have never been seen on this Mac. The classifier accepts every shape listed in Task 3. A real limit would confirm them.
7. **Apple's Command Line Tools dialog** wasn't seen. This Mac has Xcode.
8. **From 1f, still open:** whether ⌃ or ⌥ plus one letter should be refused as a shortcut.

## Review Focus

1. **A failure whose card is gone.** The person dismissed the card, or another capture took the capsule. The notification carries the same title and body, and the limit-reset and sign-in waits still file the note. Task 6 pins it.
2. **Two notes waiting for the same limit reset.** Both are filed once each after the reset. A note filed meanwhile (by the evening review, or by hand) isn't filed twice, because a wait files a note only while it is still in `inbox/`. A reset already past arms no wait, so a refile can't loop. Task 6 pins it.
3. **The app restarts while a note waits for a limit reset.** The wait survives the restart, from the app's run state, and files the note after the reset. Task 6 pins it.
4. **A resumed download.**
   - A server that ignores Range (200 instead of 206) restarts the file from zero.
   - A resumed file is still checked by size and SHA-256. One with the wrong SHA-256, or more bytes than pinned, is discarded, not kept for the next try; a short one is kept and resumed.
   - A kept part already at full length is checked on this Mac and never asked for again, so a 416 can't stall it.

   Task 8 pins all three.
5. **Folders near the too-broad list.** A folder whose name only resembles a system folder (`~/Library-notes`, `~/Applications/notes`) isn't refused. The home folder reached as `/System/Volumes/Data/Users/<me>` is. Task 10 pins both.

---

### Task 1: The setup tests live in section files, and the two slow engine test files split

**Files:**
- Create:
  - `apps/mac/e2e/setup-helpers.ts`;
  - `apps/mac/e2e/setup-hello-found.spec.ts`;
  - `apps/mac/e2e/setup-think.spec.ts`;
  - `apps/mac/e2e/setup-filing.spec.ts`;
  - `apps/mac/e2e/setup-spoken.spec.ts`;
  - `apps/mac/e2e/setup-filed-ask.spec.ts`;
  - `apps/mac/e2e/setup-ending.spec.ts`.
- Delete: `apps/mac/e2e/setup.spec.ts`.
- Create, in `packages/engine/test/core/`, three files for each of the two, grouping their top-level `describe` blocks:
  - `harness-run.test.ts`: runHeadless;
  - `harness-claude.test.ts`: runHeadless with Claude Code;
  - `harness-check.test.ts`: argv, selectHarness, errorLine, asksToSignIn, childEnv, signIn, checkAgent;
  - `librarian-file.test.ts`: file, failures report the line that matters, captureAudio, captureScreen;
  - `librarian-runs.test.ts`: the steps of a filing, ask, review, eveningReview;
  - `librarian-git.test.ts`: with git;
  - `harness-fixtures.ts` and `librarian-fixtures.ts` for what the files share.
- Delete: `packages/engine/test/core/harness.test.ts` and `librarian.test.ts`.
- Modify:
  - `apps/mac/e2e/contrast.spec.ts` and any other spec that imports from `setup.spec.ts`;
  - the test-speed table in `README.md`, if one names `setup.spec.ts`;
  - the known-flake lines in the plan files are left alone, as history.

**Interfaces:**
- **Produces:** the six setup spec files, and `setup-helpers.ts`, which exports every helper used by more than one section:
  - `windowsTitled`, `setupSnap`, `settingsSnap`, `closeSetup`, `pressShortcut`, `reachFor`;
  - `THINK`, `INSTRUCTION`, `NUDGE`;
  - `callsTo`, `sideways`;
  - `watchCapsule`, `sentToCapsule`;
  - `dockShown`;
  - `CODEX_INSTALL`;
  - `inbox`, `zel`, `live`;
  - `failingClaude`;
  - `tabs`;
  - `filedFirstThought`.

  Helpers one section uses stay in its file: `FILED`, `KEPT` and `SAVED` in setup-filed-ask, and `stubLoginItems` and `loginItemCalls` in setup-ending.

  Later tasks name these files in their gates.
- **Produces:** the six engine test files named under Files. Later tasks add their tests to them by name.

The sections, by the line numbers of today's `setup.spec.ts`:

| File | Lines | Tests |
|---|---|---|
| `setup-hello-found` | 149–834, and the test at about 2731 | 33 |
| `setup-think` | 835–1100 | 8 |
| `setup-filing` | 1101–1475 | 13 |
| `setup-spoken` | 1476–1880 | 16 |
| `setup-filed-ask` | 1881–2313 | 15 |
| `setup-ending` | 2314–end, less the test at about 2731 | 13 |

- [ ] **Step 1: Count before moving.**
  - From `apps/mac`, run `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/setup.spec.ts --list | tail -1`. Expected: "Total: 98 tests in 1 file".
  - From the root, run `npm test -w @avanzel/engine 2>&1 | grep -E "Tests +[0-9]"` and note the count: 484 passed, 10 skipped.
- [ ] **Step 2: Move, don't edit.**
  - Cut each section's tests into its file, with the imports it uses.
  - Move each helper used by two or more sections into `setup-helpers.ts`, and leave single-section helpers in their file.
  - Every file that calls `fakeModelHub` keeps `test.afterEach(closeModelHubs)`.
  - "a download in progress reaches the setup window at most once a second" (today at about 2731) goes to setup-hello-found, beside Found's download tests. "a development run saves opening at login…" (about 2766) is Done's, and stays in setup-ending.
  - Rename no test.
- [ ] **Step 3: Split the engine's two files** into the six files named under Files, moving the shared fixtures into `harness-fixtures.ts` and `librarian-fixtures.ts` beside them.
- [ ] **Step 4: Check the counts.**
  - `npx playwright test e2e/setup-*.spec.ts --list | tail -1` gives "Total: 98 tests in 6 files".
  - The engine counts equal Step 1's.
  - `grep -rn "setup.spec" apps/mac packages README.md` finds only historical plan text.
- [ ] **Step 5: Run.**
  - From the root: `npm test -w @avanzel/engine` and `npm run typecheck`.
  - From `apps/mac`: `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/setup-*.spec.ts e2e/contrast.spec.ts`.
  - Expected: 98 + 3 passed. Re-run a known flake once (see global.md, `.superpowers/sdd/2026-10-25-avanzel-error-copy/global.md`).
- [ ] **Step 6: Commit** as `e2e: the setup tests live in one file per step, and the engine's slowest test files split`.

### Task 2: The e2e suite stops waiting on fixed timers

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts` (the quit wait);
  - `apps/mac/e2e/helpers.ts` (`speechWav`, `snap`);
  - the specs with the four quit-wait tests (`filing.spec.ts`, and any other that waits for a quit with the lock held);
  - `README.md` (where it describes running the e2e suite, if it does).

**Interfaces:**
- **Produces:**
  - `AVANZEL_QUIT_WAIT_MS`, read only when `AVANZEL_TEST=1`, beside `AVANZEL_AUDIO_TIMEOUT_MS`;
  - `speechWav(text, voice?)`, which now returns a cached file per text and voice;
  - `snap(page, name)`, which writes only with `AVANZEL_E2E_SHOTS=1`.

- [ ] **Step 1: Measure.**
  - From `apps/mac`: `npm run build`, then `time env -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line 2>&1 | tail -3`.
  - Note the wall time and the counts: 220 passed, 2 skipped. 1f's last full run took 10.9 min.
- [ ] **Step 2: The quit wait.**
  - Make the controller's `QUIT_WAIT_MS` a function that returns `Number(process.env.AVANZEL_QUIT_WAIT_MS)` when `AVANZEL_TEST === "1"` and the value is a positive number. Otherwise it returns today's constant. Mirror how `AVANZEL_AUDIO_TIMEOUT_MS` is read (`controller.ts`, near line 103).
  - In three of the four quit-wait tests, launch with `AVANZEL_QUIT_WAIT_MS: "2000"` (`quitWhileHeld` takes the extra env). "a second Edit on a refiled note keeps its words when the quit wait runs out" keeps the real 10 s, so the real wait stays covered.
  - Keep each test's assertion that the wait ran out before `quitWhileHeld` let go. The lock is held until after the quit, so it still does.
- [ ] **Step 3: Cached speech.**
  - `speechWav` keeps a `Map` from `${voice}\n${text}` to the file it made. On a hit, it copies that file to a new temp path, because tests may delete or move the one they get.
  - The test-speed review counted 52 calls for 5 texts.
- [ ] **Step 4: Screenshots only when asked.**
  - `snap()` returns at once unless `process.env.AVANZEL_E2E_SHOTS === "1"`.
  - Add one line to the e2e README or helper doc comment: run with `AVANZEL_E2E_SHOTS=1` to collect `test-results/shots/`.
- [ ] **Step 5: Run the whole suite again** with the same command as Step 1.
  - Expected: the same 220 passed and 2 skipped.
  - The wall time is lower; the review estimated about −90 s, less the 8 s the real quit wait keeps.
  - Write both times in the commit body.
  - If a test fails twice, it is this task's to fix.
- [ ] **Step 6: Commit** as `e2e: quit waits, spoken test words and screenshots no longer cost fixed seconds`.

### Task 3: The engine says why an agent run failed

**Files:**
- Modify:
  - `packages/engine/src/core/claude-stream.ts` (keep the last `rate_limit_event`);
  - `packages/engine/src/core/harness.ts` (`RunResult.rateLimit`, `classifyFailure`, `NoAgentError`). `selectHarness` throws `NoAgentError` at `:252`, `:258` and `:261`, and so does the "Could not start" path at `:473`, for ENOENT only; other spawn errors stay `AvanzelError`;
  - `packages/engine/src/core/librarian.ts` (`FileOutcome.failure`; `#fileQueue`'s catch lets a `NoAgentError` through);
  - `packages/engine/test/fake-agent.mjs` (a `limit` mode).
- Test:
  - `packages/engine/test/core/claude-stream.test.ts`;
  - `packages/engine/test/core/harness-check.test.ts` (classifyFailure, selectHarness), `harness-run.test.ts` (a binary that isn't there) and `harness-claude.test.ts` (rateLimit on a run);
  - `packages/engine/test/core/librarian-file.test.ts`.

**Interfaces:**
- **Produces** (`harness.ts`):
  ```ts
  export interface RateLimit { status: string; resetsAt: number | null } // resetsAt in epoch ms
  // RunResult gains: rateLimit: RateLimit | null   (Claude Code's stream only; null for every other agent)
  export type RunFailureKind = "limit" | "signin" | "timeout" | "other";
  export interface RunFailure { kind: RunFailureKind; resetsAt: number | null; line: string }
  export function classifyFailure(result: RunResult): RunFailure;
  export class NoAgentError extends AvanzelError {
    readonly agent: string | null; // the library's harness that isn't there ("claude"), or null when none is installed
  }
  ```
- **Produces** (`librarian.ts`): `FileOutcome.failure: RunFailure | null`.
  - It is null on success, and in the outcomes that `#fileQueue`'s catches build (`librarian.ts:255`, `:268`, `:276`).
  - A run that exited 0 but that `#notFiled` refused (a symlinked inbox, "finished without filing anything", an archive problem) gets `{ kind: "other", resetsAt: null, line: errorLine(error) }`, from `#notFiled`'s message, never from the agent's reply.
  - `#fileQueue`'s catch around `#fileOne` (`librarian.ts:273-277`) rethrows a `NoAgentError`, so `file` rejects with it, as it already does when `selectHarness` throws at `:272`.
- **Fake agent:** `FAKE_AGENT_MODE=limit` with `FAKE_AGENT_RESETS_AT=<epoch seconds>`.
  - **In stream mode:** it prints a `rate_limit_event` with `{"status":"rejected","resetsAt":<s>,"rateLimitType":"five_hour"}` in the shape of `test/fixtures/claude-filing.jsonl:1`. Then it prints a result event with `is_error: true` and `result: "Claude AI usage limit reached|<s>"`, and exits 1.
  - **Without the stream:** it prints "You've hit your usage limit. Try again at 3:05 PM." on stderr and exits 1.
  - It sits after the stream's init event and before the task dispatch, so asks hit it too. Without `FAKE_AGENT_RESETS_AT`, the event has no `resetsAt`. The header comment's list of modes gains `limit`.

**The rules for `classifyFailure`**, first match wins. They read the last 5 non-empty lines of stderr and output, never the whole text: Codex echoes the prompt to stderr, and the prompt holds the capture's slug or the question.
1. **`limit`:**
   - `result.rateLimit?.status` is `"rejected"`;
   - or those lines match `/usage limit|rate limit|limit reached|hit your limit|quota|too many requests|\b429\b/i`.

   `resetsAt` is the first that applies:
   - `rateLimit.resetsAt`, at any status;
   - a `|(\d{10})` suffix in those lines, in epoch seconds, × 1000;
   - otherwise null.

   A "try again at 3:05 PM" time isn't parsed, because its date and zone are unknown.
2. **`timeout`:** `exitCode === 124`, the harness's own timeout code (`harness.ts:315`).
3. **`signin`:** `asksToSignIn(errorLine(text))`, as `checkAgent` reads a failed check (`harness.ts:378-380`).
4. **`other`.**

`line` is `errorLine(text)` in every case.

- [ ] **Step 1: Write the failing tests.**
  - **claude-stream:** a `rate_limit_event` line followed by a failed result gives `rateLimit` `{status: "rejected", resetsAt: 1792532400000}`. The `allowed` fixture line gives `{status: "allowed", …}`.
  - **harness-check:** `classifyFailure` cases:
    - rejected with resetsAt → `{kind: "limit", resetsAt: 1792532400000}`;
    - the text "Claude AI usage limit reached|1792532400" with no rateLimit → limit with resetsAt;
    - Codex's "You've hit your usage limit. Try again at 3:05 PM." → limit, resetsAt null;
    - exit 124 → timeout;
    - "agent crashed: not logged in" → signin;
    - "boom" → other;
    - forty echoed prompt lines, the first two holding "fix-the-429-error" and "how do I log in", then "ERROR: boom" → other.
  - **harness-check:** `selectHarness` with no agent on PATH throws `NoAgentError` with `agent` null. With the library's harness (`claude`) not on PATH, and with an unknown harness, it throws `NoAgentError` naming it. The messages are unchanged.
  - **harness-run:** `runHeadless` of a binary that isn't there rejects with `NoAgentError` naming the harness.
  - **harness-claude:** a stand-in printing the limit events gives `rateLimit` `{status: "rejected", resetsAt: …}` on the `RunResult`.
  - **librarian-file:**
    - a filing with `FAKE_AGENT_MODE=limit` gives `outcome.ok === false` and `outcome.failure.kind === "limit"`, and the note stays in `inbox/`;
    - a symlinked inbox's tamper filing gives `failure` `{kind: "other", line: <the blocked message>}`;
    - with the harness picked first (`librarian.harness`) and its binary removed after, `file` rejects with `NoAgentError`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/engine -- claude-stream harness librarian`. Expected: the new cases fail, because `rateLimit`, `classifyFailure` and `NoAgentError` don't exist yet.
- [ ] **Step 3: Implement** the interfaces above.
  - `ClaudeStream` keeps the last `rate_limit_event`'s `status` and `resetsAt`. The event may carry them at the top level or under `rate_limit_info`; read both.
  - Its result goes into `RunResult` where the stream's reply and refused paths already do.
  - The librarian sets `failure` where it builds a failed `FileOutcome`, as the Produces list says, and its catch lets a `NoAgentError` through.
- [ ] **Step 4: Run** the same command, then `npm test -w @avanzel/engine` and `npm run typecheck`. Expected: everything passes.
- [ ] **Step 5: Commit** as `engine: a failed agent run says whether it hit a usage limit, needs a sign-in, or ran out of time`.

### Task 4: The capsule's failure card says what happened, what's safe, and offers one fix

**Files:**
- Create:
  - `apps/mac/src/shared/problems.ts`;
  - `apps/mac/test/problems.test.ts`.
- Modify:
  - `apps/mac/src/shared/ipc.ts` (`CardAction`; the error state's `action` and `actionLabel`);
  - `apps/mac/src/renderer/capsule/main.tsx` (the action button's label only);
  - `apps/mac/src/main/controller.ts`:
    - `filingFailed`;
    - `runFiling` (files with the job's harness, and passes the caught error itself);
    - the handler behind the capsule's action (`openSettingsFor`);
    - `open-terminal`;
    - the notification;
  - `apps/mac/src/main/jobs.ts` (`FilingJob.harness`);
  - `apps/mac/src/main/setup.ts` (`openTerminal` moves to a shared main helper; setup calls it);
  - `apps/mac/src/renderer/setup/copy.ts`: `ownLine` moves to `shared/problems.ts`, and setup's copy re-exports it. So `ask/copy.ts`, `settings/panes/Agents.tsx`, `setup/steps/Found.tsx` and `setup/steps/Ask.tsx` keep importing it from there.
- Test: `apps/mac/test/problems.test.ts`, `apps/mac/e2e/filing.spec.ts`, `apps/mac/e2e/app.spec.ts` and `apps/mac/e2e/agents.spec.ts`.

**Interfaces:**
- **Consumes:** `RunFailure`, `NoAgentError` and `FileOutcome.failure` from Task 3.
- **Produces** (`shared/problems.ts`):
  ```ts
  export type FailureKind = "limit" | "signin" | "timeout" | "gone" | "missing" | "other"; // gone: the library's own agent isn't installed any more; missing: none is
  export interface AgentFailure {
    kind: FailureKind;
    agent: string;            // display name, "Claude Code"
    command: string | null;   // "claude" | "codex" for the sign-in line; null for other agents
    resetsAt: number | null;  // epoch ms
    seconds: number;          // the run's time limit, for timeouts
    line: string;             // the agent's line, as errorLine gives it
  }
  export interface Problem { title: string; body: string; command?: string } // command: the part of body the person types, set in code font by windows
  export function ownLine(line: string): string;           // moved from renderer/setup/copy.ts, unchanged
  export function resetPhrase(resetsAt: number, now: Date): string;
  export function duration(seconds: number): string;       // "45 s", "15 min"
  export function filingProblem(
    f: AgentFailure,
    now: Date,
    o?: {
      where?: string;
      partial?: "commit" | "uncommitted" | null;
      after?: "wait" | "retry";  // "wait" (default): the capsule and notifications promise the wait or the watch; "retry": setup says "try again"
      eveningReview?: boolean;   // false: the rows that end with the evening review end at "Your note is safe in the inbox."
    },
  ): Problem;
  ```
- **Produces** (`shared/ipc.ts`):
  ```ts
  export type CardAction = "open-microphone-settings" | "open-screen-settings" | `open-settings:${SettingsPane}` | "open-terminal" | `refile:${string}`;
  // the capsule state's error member gains: action?: CardAction; actionLabel?: string
  ```
- **Produces** (`jobs.ts`): `FilingJob.harness: string`, the harness name the job files with ("claude").
- **Produces** (main): `openTerminal(opened: string[]): void` in a main module both `setup.ts` and `controller.ts` import. Under AVANZEL_TEST=1 it records into the `opened` array that `openedForTests` reads, as setup's does today.

- [ ] **Step 1: Write the failing unit tests** in `problems.test.ts`:
  - every row of the Copy table's "Filing:" lines, with `now` fixed at 2026-10-25 10:00 local, including:
    - the gone and missing rows;
    - setup's `after: "retry"` rows;
    - `eveningReview: false`, which ends the evening-review rows at "Your note is safe in the inbox.";
    - the sign-in rows' `command` ("claude", "codex login");
  - `resetPhrase`:
    - same day 15:00 → "at 15:00";
    - next day 09:00 → "tomorrow at 09:00";
    - three days on → "on Wednesday at 09:00";
    - seven days on → "on 1 November at 09:00";
    - ten days on → "on 4 November at 09:00";
  - `duration(45)` → "45 s", `duration(900)` → "15 min", `duration(90)` → "2 min";
  - the partial and where variants;
  - `ownLine`'s existing cases, moved from `setup-copy.test.ts`.
- [ ] **Step 2: Write the failing e2e tests** in `filing.spec.ts`.
  - **How each new test is set up:**
    - It switches the library to Claude Code: `saveSettings(library, { ...loadSettings(library), harness: "claude" })`, since `makeLibrary` makes it `fake`.
    - It launches with an exact PATH (see "Behaviour every task keeps").
    - Each agent's fake mode goes in its stand-in's body, never the launch env. `filingClaude(env?)` takes optional `FAKE_AGENT_*` values and prefixes them to its `exec`; its name stays.
  - **"a usage limit names its reset and offers another agent".**
    - Use `filingClaude({ FAKE_AGENT_STREAM: "claude", FAKE_AGENT_MODE: "limit", FAKE_AGENT_RESETS_AT: <tomorrow at 09:00> })`.
    - Use the `codex` stand-in `agentStubs` makes.
    - The card reads "Claude Code has hit its usage limit." and "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.".
    - Its one button reads "File it with Codex now".
  - **"a usage limit with no other agent offers no fix".** The exact PATH's folder holds only the `claude` stand-in, made with `answerAs` in a new folder, so no other agent is installed. The card has OK and no other button.
  - **"a sign-in failure opens Terminal".**
    - `filingClaude({ FAKE_AGENT_MODE: "fail" })` gives "agent crashed: not logged in".
    - The card reads "Claude Code isn't signed in on this Mac.", and the button "Open Terminal".
    - Clicking it records Terminal in `openedForTests`.
  - **"a timeout says how long it had".**
    - Use `filingClaude({ FAKE_AGENT_MODE: "slow-noisy" })` with the library's `timeout_seconds` at 2.
    - The card reads "Claude Code took longer than 2 s and was stopped.", and the button "Try again".
  - **"a library whose own agent is gone says so".**
    - The harness is `claude`, and the exact PATH's folder holds only a `codex` stand-in.
    - The card reads "Claude Code isn't installed on this Mac any more." and "Your note is safe in the inbox. Settings → Agents can choose another agent, or has its install command."
    - Open Settings opens Settings → Agents.
  - **"any other failure keeps the agent's own line".** These existing tests move to the new copy:
    - `filing.spec.ts` "a failed filing says its partial edits are kept as their own commit" (messy) keeps its partial-edit sentence;
    - `filing.spec.ts` "when a symlinked inbox keeps the agent's rewrite…" (tamper) shows the blocked line, then the words-kept-aside sentence;
    - `app.spec.ts` "an agent failure is shown and the note stays in the inbox": mode `fail` is now a sign-in card, "fake isn't signed in on this Mac.";
    - `agents.spec.ts` "Open Settings on a failed filing opens Settings → Agents" becomes the no-agent case. The library is set to `auto` with an exact PATH holding no agent, the card reads "Avanzel needs an AI agent to do the filing.", and Open Settings opens Agents.
  - **"corrected words that can't be saved yet…"** (existing, `filing.spec.ts`) reads the title "Your corrected words weren't saved yet." and has OK only.
  - **"a failure whose card is gone notifies with the same words".** Dismiss the card, or start another capture, before the run fails. `notificationsForTests` holds the title and body.
- [ ] **Step 3: Run** `npm test -w @avanzel/mac -- problems`, then build and run `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/filing.spec.ts e2e/agents.spec.ts`. Expected: the new cases fail.
- [ ] **Step 4: Implement.**
  - `runFiling` files with `this.librarian(job.harness)`. Its catch passes the caught error itself to `filingFailed`, not its message (`controller.ts:970-973`).
  - `filingFailed` builds an `AgentFailure`:
    - `kind`:
      - from `outcome.failure`;
      - for a `NoAgentError`, `gone` when it names an agent and `missing` when it doesn't;
      - for an outcome whose `failure` is null, `other`, with `line: errorLine(outcome.error)`.
    - `agent`: `job.agent`, or `harnessName(error.agent)` for a `NoAgentError` that names one. No title starts with "your agent".
    - `command` from `job.harness` (claude → "claude", codex → "codex").
    - `seconds` from the library's `timeoutSeconds`.
  - It calls `filingProblem`, and passes:
    - `partial: outcome.commit ? "commit" : outcome.changes.empty ? null : "uncommitted"`;
    - `eveningReview`: whether the library's evening-review task is on (`safeTasks`).
  - **The fix:**
    - limit: `refile:<first other installed agent>`, labelled "File it with {Name} now". The order is the engine's `BUILTIN_ORDER` (`harness.ts:19`), skipping the failed one, any not `available()`, and any whose `agentChecks` entry is `signed-out`.
    - signin: `open-terminal`, "Open Terminal".
    - timeout and other: `refile:<same agent>`, "Try again".
    - gone and missing: `open-settings:agents`, "Open Settings".
  - **The corrected-words case** (`controller.ts:1076`) isn't an agent's failure. Its card is "Your corrected words weren't saved yet." with today's body, and OK only, so nothing files the misheard capture.
  - Remember the failed job's capture path with the card, for Task 5.
  - When the card no longer shows that job, `notify(title, body)` is called.
  - **`openSettingsFor`** handles `open-terminal` and `refile:` before its fallback. `refile:` does nothing until Task 5. An unknown action still opens General, as `agents.spec.ts:298` pins.
  - **Capsule:** the action button's label is `state.actionLabel ?? "Open Settings"`. Change nothing else in the file: OK stays the card's primary until 1c. The label is an expression, so the baseline holds: `use-components` stays at 10, and no copy finding is added.
- [ ] **Step 5: Run** the unit tests, `npm run typecheck` and `npm run design:check`. Expected: the baseline is unchanged. Then build and run `e2e/filing.spec.ts e2e/app.spec.ts e2e/agents.spec.ts e2e/contrast.spec.ts e2e/setup-filing.spec.ts`. Expected: all pass, with the new tests green. `refile` buttons do nothing until Task 5; no test clicks them yet.
- [ ] **Step 6: Commit** as `mac: a failed filing's card says what happened and what's safe, and offers the one fix`.

### Task 5: "File it with … now" and "Try again" file the note again at once

**Files:**
- Modify: `apps/mac/src/main/controller.ts` (the `refile:<agent>` action, handled by `fileAgainWith`).
- Test: `apps/mac/e2e/filing.spec.ts`.

**Interfaces:**
- **Consumes:** the card's remembered capture path, and `CardAction`'s `refile:<agent>` (Task 4).
- **Produces:** `fileAgainWith(capturePath: string, harness: string): void`, a private controller method behind the `refile:<agent>` action. It queues an ordinary filing job for that capture whose `harness` is that agent, so it files with `librarian(harness)`. The capsule shows its filing as usual. The name `refile` is taken by Edit's own method (`controller.ts:1052`).

- [ ] **Step 1: Write the failing e2e tests.** They are set up as in Task 4: harness `claude`, an exact PATH, and each agent's mode in its stand-in's body.
  - **"File it with Codex now files the note with Codex".**
    - `claude` hits the limit, and a `codex` stand-in files. Write a `filingCodex()` helper beside `filingClaude` that runs the fake agent with Codex's argv.
    - Clicking the button shows the capsule filing, then filed, with "Codex".
    - The note leaves `inbox/`, and Claude Code isn't called again (`agentCalls`).
  - **"Try again files the note with the same agent".**
    - A run fails once (`slow-once` with the library's `timeout_seconds` at 2, or a stand-in whose second run files).
    - Try again files it.
  - **"a note filed meanwhile isn't filed twice".** Move the note out of `inbox/` before clicking. Nothing runs, and the card closes.
- [ ] **Step 2: Run** `e2e/filing.spec.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement `fileAgainWith`.**
  - If the capture is no longer in `inbox/`, dismiss the card and do nothing.
  - Otherwise queue it as a normal job whose `harness` is the agent. `runFiling` files it with `this.librarian(job.harness)` (verified: `private async librarian(harnessName?: string)`, `controller.ts:329`).
- [ ] **Step 4: Run** `e2e/filing.spec.ts e2e/app.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: File it with another agent, or Try again, files the note at once`.

### Task 6: A note stopped by a usage limit or a missing sign-in files itself once that's over

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`;
  - `apps/mac/src/main/schedule.ts`: `RunState` gains `waiting`, `normalizeRunState` parses it, and `markChecked` and `markRan` keep it. Today they rebuild `{checked, ran}` only, and `tick()` and `runTask` write them back (`controller.ts:2029`, `:2053`);
  - `apps/mac/src/main/run-state.ts` (persist the limit waits, through `RunState`).
- Test:
  - `apps/mac/test/run-state.test.ts` (its expectations gain `waiting: []`);
  - `apps/mac/test/schedule.test.ts`;
  - `apps/mac/e2e/filing.spec.ts`.

**Interfaces:**
- **Consumes:** `AgentFailure` (Task 4) and the free sign-in checks the controller already runs (`runAgentCheck`/`agentChecks`).
- **Produces:**
  - `RunState.waiting: { capture: string; agent: string; until: number }[]` (`schedule.ts`), the limit waits, persisted in the app's run state. `agent` is the harness name ("claude"), which `librarian(agent)` takes;
  - a private `watchSignIn(agent: string, capture: string)`.
  - **Test-only variables,** read only under `AVANZEL_TEST=1`:
    - `AVANZEL_RESET_MARGIN_MS`, the time after a reset before filing; the default is 60000;
    - `AVANZEL_SIGNIN_POLL_MS`, the default is 10000;
    - `AVANZEL_SIGNIN_WATCH_MS`, the default is 1800000.

**The behaviour:**
- **After a limit failure with a known reset that is later than now:**
  - add `{capture, agent, until: resetsAt + margin}` to `waiting`;
  - set a timer for `until`, clamped to 2^31−1 ms and re-armed when it fires early (`harness.ts:40`, `MAX_TIMER_MS`);
  - when the timer fires, file each entry whose capture is still in `inbox/`, with its agent, as a background job, then drop it:
    - there is no capsule card, and the capture joins `queuedToFile`, so the evening review leaves it to the job;
    - a notification gives the filed or failed result, as for a filing whose card is gone;
    - a capsule card that still shows that capture's failure hides once it is filed.
  - A reset already past arms no wait. A refile from a wait that hits the limit again arms a new wait only for a later `resetsAt`, so a refile can't loop.
- **At start, and when another library opens (`useLibrary`):** re-arm the timers for that library's entries, and file any that are already due.
- **After a sign-in failure for Claude Code or Codex:**
  - poll that agent's free sign-in check every poll interval, for up to the watch length. Poll with `runAgentCheck(name, harness, false, status)`, as `rereadSignIns` does (`controller.ts:1795-1804`). That check never prompts the model, since a prompt costs quota. `checkAgents()` won't do: it skips agents already checked in this app run (`controller.ts:1778-1785`);
  - the first time it reads signed in, file the capture as a background job, then stop.
  - Several notes waiting on one agent share one watch.
  - A capture the watch refiled that fails with a sign-in again starts no new watch.
- A sign-in failure for any other agent starts no watch; its copy says so.

- [ ] **Step 1: Write the failing tests.** The e2e tests are set up as in Task 4: harness `claude`, an exact PATH, and each agent's mode in its stand-in's body.
  - **unit, `run-state.test.ts`:** `waiting` round-trips through the store, and a malformed entry is dropped on load.
  - **unit, `schedule.test.ts`:** `markChecked` and `markRan` keep `waiting`, and `normalizeRunState` keeps good entries and drops malformed ones.
  - **e2e, "a note stopped by a usage limit is filed after the reset":**
    - use `filingClaude({ FAKE_AGENT_STREAM: "claude", FAKE_AGENT_MODE: "limit", FAKE_AGENT_RESETS_AT: <3 s ahead> })` and `AVANZEL_RESET_MARGIN_MS: "0"`;
    - after the failure, flip the stand-in to filing (`answerAs(dir, "claude", filingClaude())`);
    - expect the note to leave `inbox/` within 15 s, and `notificationsForTests` to hold "Filed by Claude Code".
  - **e2e, "two notes waiting for one reset are each filed once".**
  - **e2e, "a wait survives a restart":**
    - fail with the reset 6 s ahead, then close the app;
    - relaunch with `AVANZEL_USER_DATA` set to the first launch's user data, with the stand-in filing;
    - the note is filed after the reset.
  - **e2e, "a reset already past arms no wait":** `FAKE_AGENT_RESETS_AT` is 60 s ago. Within 5 s of the failure, `claude` has been asked to file once only (`agentCalls`), and the note is still in `inbox/`.
  - **e2e, "a note stopped by a sign-in is filed once Claude Code is signed in":**
    - `auth status` says `{"loggedIn": false}`, and the run fails with "not logged in";
    - set `AVANZEL_SIGNIN_POLL_MS: "500"`;
    - flip the stand-in to `filingClaude()`;
    - the note is filed within 10 s.
- [ ] **Step 2: Run** `npm test -w @avanzel/mac -- run-state schedule` and `e2e/filing.spec.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the behaviour above. A wait files a note only while it is still in `inbox/`, so a note the evening review or Try again filed meanwhile isn't filed twice.
- [ ] **Step 4: Run** the unit tests and `e2e/filing.spec.ts e2e/app.spec.ts e2e/library.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: a note stopped by a usage limit or a sign-in files itself once that's over`.

### Task 7: Setup, Ask and Undo speak the same way about problems

**Files:**
- Modify:
  - `apps/mac/src/main/setup.ts`:
    - `failed` takes an `AgentFailure` (null for NOTE_GONE) and the partial;
    - `askInSetup` fills the failed answer's `failure` and `changedFiles`;
    - `SetupHost.answer`'s type follows `answerQuestion`;
  - `apps/mac/src/shared/ipc.ts`:
    - the setup failed state carries `failure: AgentFailure | null` and `partial`. It keeps `line`, which stays NOTE_GONE when the note left the inbox before any run (`controller.ts:956`, `:980`); `failure` is null then;
    - `AskResult` replaces `changed: boolean` with `changedFiles: number` and gains `failure: AgentFailure | null`;
    - `SetupAnswer`'s failed state gains `failure: AgentFailure | null` and `changedFiles: number`;
  - `apps/mac/src/renderer/setup/copy.ts` and `steps/Filing.tsx`:
    - the failure Notice's title and body come from `filingProblem` with `after: "retry"` and `eveningReview: snap.eveningReview?.enabled ?? false`, and its `command` is set in code font (`Text variant="code"`);
    - the NOTE_GONE branch stays as it is, title and body (`Filing.tsx:34`, `:86`, `:245`);
    - its buttons stay as they are: Open Terminal and Try again for a sign-in, Try again otherwise;
  - `apps/mac/src/renderer/setup/steps/Ask.tsx` and `apps/mac/src/renderer/ask/copy.ts`, `main.tsx`: the Copy table's "Ask:" rows. The Ask window adds no channel: Open Terminal calls `window.avanzel.setup.openTerminal()`, and Open Settings calls `window.avanzel.capsule.openSettingsFor("open-settings:agents")`;
  - `apps/mac/src/main/controller.ts`:
    - `filingFailed` builds the `AgentFailure` before its setup branch (`controller.ts:1003`), and hands it and the partial to `setup.failed`;
    - `answerQuestion` classifies with `classifyFailure` and counts `changes` (created, modified and deleted). It maps a `NoAgentError` to gone or missing, naming the agent from the error;
    - the Undo-refused cards.
- Test:
  - `apps/mac/test/setup-copy.test.ts`, `ask-copy.test.ts`, `problems.test.ts`;
  - `apps/mac/e2e/setup-filing.spec.ts`, `setup-filed-ask.spec.ts`, `app.spec.ts`.

**Interfaces:**
- **Consumes:** `AgentFailure`, `filingProblem`, `ownLine`, `resetPhrase` and `duration` (Task 4), and `classifyFailure` and `NoAgentError` (Task 3).
- **Produces:**
  - `askProblem(f: AgentFailure, changedFiles: number, now: Date): Problem & { terminal: boolean; settings: boolean }` in `shared/problems.ts`:
    - `terminal` means the Notice offers Open Terminal first;
    - `settings` means its fix is Open Settings (Agents), for gone and missing.
  - `undoRefused: Problem` and `takeBackRefused: Problem` constants.

- [ ] **Step 1: Write the failing tests:**
  - unit tests for `askProblem`, every "Ask:" row:
    - Codex and other agents' sign-in, an unknown reset, gone and missing;
    - `changedFiles` 1 → "changed 1 file while answering; it's left as it is";
    - `changedFiles` 3 → "changed 3 files while answering; they're left as they are";
  - setup copy cases, with `after: "retry"`:
    - the limit failure: "It resets at 15:00. Your note is safe in the inbox; try again then.";
    - the sign-in: "…, then try again. Your note is safe in the inbox.";
    - partial edits in a failure;
  - **e2e, Ask window:**
    - a limit (stream stand-in, `limit` mode, the reset tomorrow at 09:00) shows the limit title and "It resets tomorrow at 09:00.";
    - a sign-in failure's primary is Open Terminal and records Terminal, and Ask again is secondary;
    - on a library whose agent is gone, Open Settings opens Settings → Agents;
    - `app.spec.ts` "a failed answer names the agent that couldn't answer…" reads the AskResult, not the window. It asserts `changedFiles: 1` for its slow-messy run, and `changedFiles: 0` for the other two;
    - `app.spec.ts` "a failed answer says so in the window, says the library hasn't changed, and Ask again asks it again" runs mode `fail`, now a sign-in. It checks the sign-in Notice. Its D1 checks (Ask again as the primary, the focus on the field after it) move to a neutral failure, mode `fail-noisy`;
  - **e2e, setup's filing:**
    - a limit shows "It resets … Your note is safe in the inbox; try again then.";
    - "another failure shows its own line" and "a recording started on Filing keeps the capsule through Try again" use `failingClaude("Error: usage limit reached")`, now a limit. They switch to "Error: boom", and the limit gets its own case;
    - "a filing that asks to sign in names it and offers Open Terminal" reads the new sign-in body, with `claude` still set as code;
    - "a filing that waits for the library…" keeps its NOTE_GONE Notice unchanged;
  - **e2e, setup's Ask:** "an answer that fails says why, and the suggestion asks again" uses `failingAnswers("Error: usage limit reached")`, now a limit. It switches to "Error: boom", and a limit case checks the limit title;
  - **e2e, Undo:**
    - the existing refused-undo test in `app.spec.ts` (about 258) reads the new title and body;
    - setup's (about 2023) keeps its title, which is already §7's, and reads the new body.
- [ ] **Step 2: Run** the unit tests, then build and run `e2e/app.spec.ts e2e/setup-filing.spec.ts e2e/setup-filed-ask.spec.ts`. Expected: the new assertions fail.
- [ ] **Step 3: Implement** with the interfaces above. Ask's newest failed turn keeps D1's rules: one primary, focus on the field after Ask again, and Stop unchanged.
- [ ] **Step 4: Run** the same tests, then `npm run typecheck` and `npm run design:check`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: setup, Ask and Undo say what happened and what's safe, in the same words as the capsule`.

### Task 8: A speech-model download continues where it stopped, and its failure says why

**Files:**
- Modify:
  - `packages/engine/src/voice/models.ts`: the file download keeps a `.part`, resumes with Range, checks a full-length part on this Mac, and clears stale parts; it adds `DownloadError`;
  - `packages/engine/test/voice/models.test.ts`: `fakeHub` serves Range, truncates only its first response, and records the Range header; the restart-from-zero tests become resume tests;
  - `apps/mac/src/shared/ipc.ts`: `model-failed` gains `reason: string` and `resumable: boolean`, and the model's `error` status gains `resumable`;
  - `apps/mac/src/main/controller.ts`;
  - `apps/mac/src/renderer/capsule/main.tsx` (strings only);
  - `apps/mac/src/renderer/settings/panes/Voice.tsx` and `copy.ts`;
  - `apps/mac/e2e/contrast.spec.ts`: its typed `model-failed` state (`:177`) gets a reason and `resumable`, or typecheck fails.
- Test:
  - `packages/engine/test/voice/models.test.ts`;
  - `apps/mac/e2e/models.spec.ts`.

**Interfaces:**
- **Produces:** the existing `downloadModelFiles` signature, unchanged. Its behaviour:
  - **A kept part, checked before any request:**
    - longer than the pinned size: deleted;
    - at the pinned size: hashed on this Mac, then renamed into place if it matches, or deleted and fetched from zero if not;
    - shorter: kept, and resumed.
  - **A failure:** a network error or a short body keeps the `.part`. A wrong SHA-256, or more bytes than pinned, deletes it. An abort (`signal`) keeps nothing, as today.
  - **The next try** asks for `Range: bytes=<size>-`.
    - On **206**, it hashes the kept bytes first, then appends.
    - On **200**, it starts the file again from zero.
    - On **416**, it deletes the part and starts again.
  - Size and SHA-256 are checked on the whole file, as today.
  - **Stale parts:** when a download starts, it deletes the `.part` files in the model folders that the current plan doesn't fetch.
- **Produces:** `DownloadError`, an `AvanzelError` the download rejects with. Its `resumable` says a part was kept for the next try. Its message names the file and why, without the URL.

- [ ] **Step 1: Write the failing engine tests:**
  - **"a broken download continues from the kept bytes".** `fakeHub` mode `truncate` cuts the first response at half. The second try sends `Range: bytes=<half>-`, gets 206, and ends with the right SHA-256. The hub saw two requests, the second with Range.
  - **"a server that ignores Range starts the file again".** The hub always answers 200, and the result is still correct.
  - **"a kept part with wrong bytes is thrown away".** Write a `.part` of the right length but wrong content. It is hashed on this Mac with no request for it, then deleted, and the file is fetched from zero; the result is correct.
  - **"a kept part already complete is renamed into place without a request".**
  - **"a 416 deletes the part and starts again".**
  - **"stale parts of files the plan doesn't fetch are deleted".**
  - **"a failure says whether a part was kept, and names no URL".** A 404 gives `resumable: false`; a dropped connection gives `true`.
  - Update the old tests that pinned "no partial file left":
    - about 513–522: a longer part is still deleted, then fetched;
    - about 548–558: a short body now keeps its part;
    - about 560–567: a dropped connection now keeps its part;
    - about 569–584: an abort still keeps nothing.
- [ ] **Step 2: Write the failing e2e test** in `models.spec.ts`:
  - **"a failed download says why, in the capsule and in Voice".**
    - The capsule's failed card reads "The speech model didn't finish downloading." with `ownLine` of the reason, then "Typing works meanwhile, and Try again downloads it again.". A 404 keeps no part.
    - Settings → Voice's Notice shows the same reason, which has no URL.
    - Update the existing strings at models.spec.ts about 168–202.
- [ ] **Step 3: Run** `npm test -w @avanzel/engine -- models`, then build and run `e2e/models.spec.ts`. Expected: the new cases fail.
- [ ] **Step 4: Implement.**
  - Keep the `.part` on a network error or a short body. Delete it on a wrong SHA-256, more bytes than pinned, or a 416.
  - On resume, stream the kept bytes through the hash before appending.
  - Main passes the stored reason and `resumable` (`controller.ts`, where the download error is kept, about line 1962) into the `model-failed` state and the snapshot.
- [ ] **Step 5: Run** `npm test -w @avanzel/engine`, `npm test -w @avanzel/mac` and `npm run typecheck`, then `e2e/models.spec.ts e2e/setup-hello-found.spec.ts e2e/setup-spoken.spec.ts e2e/contrast.spec.ts`. Expected: all pass.
- [ ] **Step 6: Commit** as `engine: a speech-model download continues where it stopped, and its failure says why`.

### Task 9: The capsule's voice and screen problems, Privacy's restart, and the empty states

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`:
    - the no-speech, microphone-denied, microphone-didn't-start and screen cards (about lines 616, 653, 743, 817);
    - a new `relaunch` IPC handler;
    - a fresh snapshot to the Settings window when it gets the focus;
  - `apps/mac/src/main/ipc.ts` and `apps/mac/src/preload/index.ts` (`settings.relaunch()`, `ask.libraryPages()`);
  - `apps/mac/src/shared/ipc.ts` (`AvanzelBridge` gains `settings.relaunch()` and `ask.libraryPages()`, which the preload's `bridge` must match);
  - `apps/mac/src/renderer/settings/panes/Privacy.tsx` (Quit and reopen, secondary);
  - `apps/mac/src/main/menu-model.ts` (the empty Recently filed line);
  - `apps/mac/src/renderer/ask/main.tsx` and `copy.ts` (the empty-library line).
- Test:
  - `apps/mac/test/menu-model.test.ts`;
  - `apps/mac/e2e/permissions.spec.ts`, `agents.spec.ts` (no speech, about line 338), `app.spec.ts` and `settings.spec.ts`.

**Interfaces:**
- **Produces:**
  - `relaunchedForTests`, beside `openedForTests`. `settings.relaunch()` calls `app.relaunch()` and then `app.quit()`; under `AVANZEL_TEST=1` it only records. As quitting does, it first stops a filing in progress; the note stays in the inbox.
  - `ask.libraryPages(): Promise<number>`: the pages on the six shelves (`vault.shelfCounts()`), as Settings' library line counts them.

- [ ] **Step 1: Write the failing tests:**
  - **menu-model:** with a ready library and no recent pages, the items include the "Recently filed" header and an enabled item whose action is `dictate`, reading "Nothing filed yet. Press ⌥Space and say hello.". With no dictate shortcut, it reads "Nothing filed yet. Record a thought and say hello.".
  - **e2e:**
    - the capsule cards read the Copy table's rows, with their buttons "Choose microphone", "Open System Settings" and "Open Settings". Clicking "Choose microphone" opens Settings on Voice;
    - Privacy's screen row, not granted, has "Quit and reopen", which records one relaunch;
    - **Privacy follows System Settings:** change `AVANZEL_FAKE_PERMISSIONS` from `microphone:denied` to granted, then emit `focus` on the Settings BrowserWindow in main, as setup's tests do around old line 405. The row reads Allowed;
    - Ask, opened on a library with no pages, shows "Your shelves are empty. Say something first, then ask about it.".
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
  - Each capsule card gets its `actionLabel`, and its existing action where one fits:
    - "Choose microphone" → `open-settings:voice`;
    - "Open System Settings" → `open-microphone-settings` or `open-screen-settings`;
    - "Open Settings" on the microphone-didn't-start card → `open-settings:voice`, replacing today's `open-microphone-settings` (`controller.ts:745`).
  - Main sends the Settings window a fresh snapshot when it gets the focus (`settingsWindow.on("focus", …)`), as setup re-reads sign-ins on focus (`setup.ts:281`). The shell already draws `settings:changed`.
- [ ] **Step 4: Run** `npm test -w @avanzel/mac`, then build and run `e2e/permissions.spec.ts e2e/agents.spec.ts e2e/app.spec.ts e2e/settings.spec.ts e2e/contrast.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: voice and screen problems say what to do, Privacy can reopen Avanzel, and empty places invite a first thought`.

### Task 10: The first-run gaps are closed

**Files:**
- Modify:
  - `packages/engine/src/core/git.ts`: `gitUsable` and `resetGitUsable`. `available()` uses the same detection, so a library that has `.git`, on a Mac without the tools, runs no git;
  - `packages/engine/src/core/vault.ts` (`init` asks `gitUsable` when `git: true`);
  - `apps/mac/src/main/setup.ts`: `show` takes the suggested place, the cancelled state gets `leftovers`, and `installGit`;
  - `apps/mac/src/main/setup-model.ts` (`tooBroad`);
  - `apps/mac/src/shared/ipc.ts`: `SetupSnapshot.gitUsable`, setup's cancelled state `leftovers: number`, and `AvanzelBridge.setup.installGit()`;
  - `apps/mac/src/preload/index.ts` and `apps/mac/src/main/ipc.ts` (`setup:install-git`);
  - `apps/mac/src/renderer/setup/steps/Found.tsx`, `copy.ts`, `steps/Filing.tsx`;
  - `apps/mac/src/main/controller.ts`:
    - `openLibrary`, `showHome` and the menu input for a missing library at launch;
    - `chooseLibrary` refuses too-broad folders, before its confirm box and before `Vault.init`;
    - `openSetupFromSettings` opens setup with `~/Avanzel` as the suggested place when the remembered library is missing;
    - a `spawned` record and `spawnedForTests()`, beside `openedForTests` (`controller.ts:2173`);
  - `apps/mac/src/renderer/settings/parts.tsx` (the missing-library Notice's "Set up a new library", secondary);
  - `apps/mac/src/main/menu-model.ts`.
- Test:
  - `packages/engine/test/core/git.test.ts` (or the vault test);
  - `apps/mac/test/setup-model.test.ts`, `setup-copy.test.ts`, `menu-model.test.ts`;
  - `apps/mac/e2e/setup-hello-found.spec.ts`, `setup-filing.spec.ts`, `library.spec.ts`.

**Interfaces:**
- **Produces:**
  - `gitUsable(seams?: { which?: (bin: string) => string | null; xcodeSelect?: () => string | null }): boolean` in `git.ts`. The app calls it as `git.gitUsable()`, since the engine exports `git.ts` as `git`.
    - Under `AVANZEL_TEST=1`, `AVANZEL_GIT_USABLE=0` makes it false: the test override, beside the real check.
    - It is false when no `git` is on PATH.
    - When the `git` found is `/usr/bin/git`, it is true only if `xcode-select -p` exits 0 and `<that dir>/usr/bin/git` exists. `xcodeSelect` gives that dir, or null when the command fails.
    - It never runs `git` or `xcrun`, which would bring up Apple's install dialog.
    - Called without seams, it is cached for the process. `resetGitUsable()` clears the cache, for tests and for setup's window focus.
  - `available()` returns `gitUsable()`. So `commitAll`, `revert`, `revertKeeping` and `subject` run no git on a Mac with only the stub. A library that has `.git` then makes no commits, and its filed card offers no Undo, as for a library without git.
  - `setup.installGit()` (channel `setup:install-git`) runs `xcode-select --install`. Under `AVANZEL_TEST=1` it records that in `spawnedForTests()` instead.
  - `setup.show(place?: string)`: a new session suggests `place` instead of the stored library path.
  - `tooBroad(target, home)` also refuses:
    - `/Applications`, `/Library`, `/System`, `/Users`, `/Users/Shared`;
    - `/private`, `/usr`, `/opt`, `/bin`, `/sbin`, `/etc`, `/var`, `/tmp`, `/cores`;
    - `/System/Volumes/Data/X`, exactly when X is refused, with `/System/Volumes/Data/Users/<me>` and its home folders taken as the home folder's.

    These are refused as folders, not by name prefix, so `~/Library-notes` is still fine. Each listed folder is compared through `onDisk()` too (`setup-model.ts:28-41`), so `/tmp` and `/var` match `/private/tmp` and `/private/var`.

- [ ] **Step 1: Write the failing tests:**
  - **engine `gitUsable`.** The test can't create `/usr/bin/git`, so cover the `/usr/bin/git` branch with a unit seam: a `which` and an `xcode-select` passed in, `gitUsable({ which, xcodeSelect })` where the defaults are the real ones.
    - PATH without git → false;
    - git at `/usr/bin/git` and `xcode-select -p` exiting 2 → false;
    - git at `/usr/bin/git` and a developer dir that has `usr/bin/git` → true;
    - git elsewhere → true.
  - **engine `available()`:** under `AVANZEL_TEST=1` with `AVANZEL_GIT_USABLE=0`, after `resetGitUsable()`, `available()` is false. `commitAll` on a library that has `.git` then returns null and makes no commit.
  - **setup-model:** `tooBroad` is true for each new folder, for `/tmp` (on disk `/private/tmp`), for `/System/Volumes/Data/Applications` and for `/System/Volumes/Data/Users/<me>`. It is false for `~/Library-notes` and `~/Applications/notes`.
  - **setup-copy:**
    - Found's two no-git lines, new library and has-files;
    - the cancelled line with `leftovers: 2` and no commit.
  - **e2e, setup-hello-found:**
    - with `AVANZEL_GIT_USABLE=0`, Found shows the no-git line and "Install git" (secondary), which records `xcode-select --install` in `spawnedForTests`;
    - Looks good makes a library without git and goes on.
  - **e2e, library.spec, "a remembered library that is missing at launch is named in Settings":**
    - launch with `AVANZEL_LIBRARY` pointing at a folder that doesn't exist;
    - Settings, not setup, opens on General with "Avanzel can't find your library at …";
    - the menu's top item has that sublabel;
    - "Set up a new library" opens setup with `~/Avanzel` as the suggested place.
  - **e2e, library.spec:** with the picker stubbed to `/Applications`, `call(app, "chooseLibrary")` rejects with the too-broad line before any confirm box, and the library stays as it was. Settings shows the refusal in Task 11, which builds the Notice for it.
  - **e2e, setup-filing:** a cancel in a library without git, after the agent changed a page (`slow-messy`), reads the no-history line.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
  - `openLibrary` notes a remembered library that is missing, and `showHome` then opens Settings, not setup.
  - Setup passes `git: git.gitUsable()` to `Vault.init`. Without a usable git, `Vault.init` must not run `git` at all.
  - `chooseLibrary` refuses a too-broad folder with `tooBroadLine`, before its confirm box (`controller.ts:1630-1638`) and before `Vault.init`.
- [ ] **Step 4: Run** `npm test -w @avanzel/engine`, `npm test -w @avanzel/mac`, typecheck, and design:check. Then build and run `e2e/setup-hello-found.spec.ts e2e/setup-filing.spec.ts e2e/library.spec.ts e2e/settings.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: setup knows a Mac without git, names a missing library, and keeps a library out of system folders`.

### Task 11: Settings says only what's true of the library, and never fails silently

**Files:**
- Modify:
  - `apps/mac/src/shared/ipc.ts` (`LibraryInfo.autoCommit`; `SettingsSnapshot.voice: { backend: "onnx-asr" | "command"; model: string }`, the engine's backend names, `config.ts:49`, `voice/index.ts:39`);
  - `apps/mac/src/main/controller.ts` (fill them; bind `settings:pick` to the Settings window and `ask:cancel` to the Ask window);
  - `apps/mac/src/main/ipc.ts`;
  - `apps/mac/src/renderer/settings/copy.ts` (`libraryLine`, `speechModelLine`);
  - `apps/mac/src/renderer/settings/main.tsx` (the shell's `problem` and `attempt`);
  - `parts.tsx` and `panes/*.tsx` (calls go through `attempt`);
  - `panes/Reviews.tsx` (the save failure lives in `useReviewEdits`).
- Test:
  - `apps/mac/test/settings-copy.test.ts`;
  - `apps/mac/e2e/settings.spec.ts`, `library.spec.ts`, `models.spec.ts`;
  - `apps/mac/test/popup.test.ts`, or an e2e for the sender check.

**Interfaces:**
- **Produces:**
  - `libraryLine(shelves, isGit, autoCommit)`. A library without git keeps its no-git sentence; the auto-commit sentence is for git libraries;
  - `speechModelLine(voice)`;
  - `attempt<T>(run: () => Promise<T>): Promise<T | undefined>` in the Settings shell.
    - A rejection sets the shell's `problem` to `ownLine(remoteMessage(error))`, so Electron's "Error invoking remote method…" prefix goes (`settings/copy.ts:180-187`).
    - The problem clears on the next successful change or pane switch.

- [ ] **Step 1: Write the failing tests:**
  - settings-copy cases for the auto-commit-off line and the two new speech lines;
  - **e2e:**
    - a library whose `.avanzel/config.toml` has `auto_commit = false` shows the new line;
    - a library with the v2 model shows the English-only line;
    - a library with `backend = "command"` shows the command line;
    - **"a change that fails says so":** make the library's `.avanzel/` read-only and change the agent's model. The pane shows "That change wasn't saved." with the reason, and the next successful change clears it;
    - **"a review's failed save survives a pane switch":** library.spec's chmod test, switching to General and back;
    - **"Turn on the evening review that fails says so":** settings.spec, with `tasks/` read-only;
    - **"a too-broad folder says so"** (moved from Task 10): library.spec, Settings → Change… on `/Applications` (stubbed picker). The pane shows "That change wasn't saved." with the too-broad line, and no confirm box opens;
  - **sender check:** `settings:pick` sent from the Ask window's page does nothing (no menu shown, `shownMenus` empty), and `ask:cancel` from Settings gives up no question.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
  - Route every Settings call that can reject through `attempt`. 1f's final review M6 names only two of them, so here they all are:
    - `parts.tsx:22`;
    - `General.tsx:37`, `:53`, `:62`, `:75`;
    - `Voice.tsx:33`, `:117`, `:147`;
    - `Agents.tsx:118`, `:147`, `:155`, `:181`;
    - `Reviews.tsx:95`, `:293`, `:340`;
    - `Privacy.tsx:36`.
  - Compare `event.sender` with the window's `webContents`, for `settings:pick` and `ask:cancel` only. Keep the cross-window calls that are on purpose working:
    - setup's `settings.checkAgent`;
    - Settings' `setup.copy`;
    - setup's `ask.openPage`;
    - Done's `settings.setApp` and `saveTask`;
    - setup's `settings.downloadModel` (`renderer/setup/frame.tsx:74`) and `settings.openPrivacy` (`steps/Think.tsx:255`);
    - setup's `capsule.openSettingsFor` (`steps/Think.tsx:305`);
    - the Ask window's `setup.openTerminal()` and `capsule.openSettingsFor("open-settings:agents")` (Task 7).
- [ ] **Step 4: Run** `npm test -w @avanzel/mac`, typecheck and design:check, then build and run `e2e/settings.spec.ts e2e/library.spec.ts e2e/models.spec.ts e2e/agents.spec.ts e2e/app.spec.ts e2e/setup-ending.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: Settings says only what's true of the library, and a change that fails says so`.

### Task 12: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check`, and `npm run ui:e2e` (no `--update-snapshots`).
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`: `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`. Expected: no failures. Re-run a known flake once, and report the wall time beside Task 2's.
- [ ] **Step 3: Take the problem screenshots** with `AVANZEL_E2E_SHOTS=1`, or the throwaway shots spec kept in the flight pack (`archive/1f-work/zz-1f-shots.spec.ts.txt`). Shoot every card and Notice from the Copy table that a test reaches, in light and dark, into the flight pack's `shots/1e/`.
- [ ] **Step 4: Run the `design-reviewer` agent** on the changed windows: setup, Ask, Settings, and the capsule's strings.
- [ ] **Step 5:** Fix what they find in one commit, `mac: the problems read as one voice across the windows`, if anything is found.
