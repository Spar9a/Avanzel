# Avanzel for Mac (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A menu-bar Mac app (Electron + TypeScript) that dictates, captures the screen with a spoken comment, transcribes locally with Parakeet, files through the owner's agent CLI, and runs an evening review — on a TypeScript port of the v0.1 engine.

**Architecture:** npm-workspaces monorepo. `packages/engine` = Node/TS port of v0.1 (`src/core/**`) + local speech (`src/voice/**`), shared interfaces in `src/types.ts`. `apps/mac` = Electron app: main process hosts the engine; React renderers for capsule, settings, quick-type and ask; esbuild bundles; electron-builder packages.

**Tech Stack:** Node 26, TypeScript 5, Electron (latest), React 19, esbuild, vitest, Playwright (Electron), onnxruntime-node 1.30, smol-toml, marked + DOMPurify, electron-builder.

**Spec:** `docs/superpowers/specs/2026-10-20-avanzel-mac-design.md` (v0.1 spec and Python sources are the behavioural reference: `src/avanzel/*.py`, `tests/*.py`).

## Global Constraints

- Library format identical to v0.1 (same folders, frontmatter, log line format, AGENTS.md rules); new: `raw/attachments/`, `tasks/` (both non-shelf folders), `reviews/YYYY-MM-DD-evening.md`.
- Every v0.1 guarantee holds in TS: atomic capture ids (hard-link publish), capture restore, protected paths undone after every agent run, noop-run not filed, log fallback, adopt hand-dropped inbox files, git commit per run with hooks disabled and identity fallback, Claude `--tools` + `--strict-mcp-config`, Cursor `--force` only when writing, CLAUDE*-session env stripped.
- Parakeet: int8 files from `istupakov/parakeet-tdt-0.6b-v3-onnx` + `nemo128.onnx`; CPU provider, `intraOpNumThreads: 4`, `logSeverityLevel: 3`; VAD above 25 s; output text identical to v0.1 for the same audio.
- No shell strings: every subprocess gets an argv array.
- macOS only (Apple Silicon first). Electron security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for renderers, typed preload bridge.
- Commits per task on branch `avanzel-mac` (owner asked to commit).

## Review Focus

1. Mic / screen permission denied or revoked — clear guidance, no crash, nothing half-saved (Task 6, 8 tests).
2. Agent CLI missing / logged out / slow while the capsule waits — capsule shows the error line, capture stays in the inbox (Task 2 `noop`/`fail` modes, Task 6 e2e).
3. Machine asleep at the scheduled time / app started after it — exactly one catch-up run (Task 9 `missedRunRunsOnce`).
4. Non-Latin (Cyrillic) dictation end to end — text intact, timestamp ids, digest readable (Task 2, Task 3 integration).
5. Shortcut already taken by another app — reported in Settings, app still usable from the menu (Task 5 test).

---

### Task 1: Workspace scaffold (owner: controller)

**Files:** root `package.json` (workspaces), `tsconfig.base.json`, `packages/engine/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/types.ts,templates/**}`, `apps/mac/{package.json,tsconfig.json,scripts/build.mjs,src/**}` skeleton, `.gitignore` additions.

**Produces:** `packages/engine/src/types.ts`:
```ts
export interface Transcript { text: string; engine: string; seconds: number | null }
export interface Transcriber { readonly engine: string; transcribe(audio: string | Float32Array, sampleRate?: number): Promise<Transcript> }
export interface VoiceOptions { backend: string; model: string; quantization: string; command: string[] }
```
`src/index.ts` re-exports `./types`, `./core/index`, `./voice/index`. All runtime deps installed up front (onnxruntime-node, smol-toml) so worktree tasks never edit package.json.

- [ ] Scaffold, `npm install`, `npm test -w @avanzel/engine` runs (0 tests), commit.

### Task 2: Engine core port (`packages/engine/src/core/**`, `test/core/**`) — subagent, worktree

**Interfaces (Produces, from `src/core/index.ts`):**
- `AvanzelError extends Error`.
- config: `Settings {harness, timeoutSeconds, autoCommit, models: Record<string,string>, harnesses: Record<string,CustomHarness>, voice: VoiceSettings}`; `VoiceSettings extends VoiceOptions {maxRecordSeconds}`; `defaultSettings()`, `loadSettings(vaultRoot)`, `saveSettings(vaultRoot, s)` (re-renders `config.toml` from the template), `resolveVault(explicit?, {cwd, env})`, `rememberVault(path, env?)`, `userConfigPath(env?)`. TOML keys exactly as v0.1 (`timeout_seconds`, `[voice] backend = "onnx-asr"`, …).
- vault: `SHELVES`, `AUDIO_EXTS`, `IMAGE_EXTS`, `slugify`, `isoLocal(date)`, `Vault` with `root inbox raw indexPath logPath metaDir logsDir`, `exists() require()`, `static init(root, {git})`, `newCapture(text, {source, audio?, attachments?, context?: Record<string,string>, transcriber?, now?}) => Capture {id,path,source}`, `newAudioPath(now, suffix='.wav')`, `newAttachmentPath(now, suffix)` (both claimed with exclusive create), `pending()`, `archivePath()`, `archive()`, `appendLog(op, details, now?)`, `logMentions(id)`, `shelfCounts()` (excludes `inbox raw reviews tasks`), `withLock(fn, onWait?)` (mkdir lock in `.avanzel/lock.d` with pid, stale when pid dead).
- changes, search: as v0.1 (`snapshot`, `diff`, `Changes{created,modified,deleted, pages, empty, without()}`, `search(root, query, limit)`).
- git: `available()`, `isRepo(root)`, `initRepo(root)`, `commitAll(root, message): Promise<string|null>` (returns new HEAD sha), `revert(root, sha): Promise<boolean>`.
- prompts: `filePrompt(rel, id, now, {attachments?, instructions?})`, `askPrompt(q, {save, now})`, `reviewPrompt(rel, now)`; templates use `${name}`.
- harness: `BUILTIN_ORDER`, `Harness {name, binary, readsOutputFile, experimental, available(), headlessArgv(prompt, vault, {write, model?, outputFile, images?}), interactiveArgv(vault, {model?})}`, `harnesses(settings)`, `installed(settings)`, `selectHarness(settings, requested?)`, `childEnv(env)`, `runHeadless(h, prompt, vault, {write, model?, timeoutSeconds, images?, signal?}) => RunResult {exitCode, output, stderr, seconds, ok}`. Images: codex `-i p`, opencode `-f p`, others none.
- librarian: `Librarian(vault, settings, {harnessName?, transcriber?, clock?})` with `captureText(text, source?)`, `captureAudio(path, {source, keepOriginal})`, `captureScreen({image, comment?, audio?, context})`, `file(only?, {progress?, instructions?}) => FileOutcome[]` (`FileOutcome {captureId, ok, changes, message, archivedTo, error, restored, guarded, commit}`), `ask(q, {save})`, `review()`, `eveningReview({instructions?, progress?}) => {outcomes, digestPath, commits}`, `undo(commits: string[])`.
- tasks: `ShadowTask {id, path, name, schedule, kind: 'evening-review'|'review'|'custom', agent, tools, enabled, instructions}`, `parseSchedule("daily 21:00" | "weekly sun 18:00")`, `formatSchedule`, `loadTasks(vault)`, `saveTask(vault, task)`, `ensureDefaultTasks(vault)`, `lastDue(schedule, now) => Date`, `nextRun(schedule, now) => Date`.
- skills: `skillTargets(home, {which?, only?})`, `installSkill(targets, {dryRun})`, `renderSkill()`.

- [ ] Port every v0.1 test in `tests/*.py` that applies (vault, git, changes, search, prompts, harness, librarian incl. fake agent modes, skills, config) to vitest under `test/core/` with a Node fake agent `test/fake-agent.mjs`; plus new tests: `capture_screen_writes_attachment_and_context`, `file_prompt_mentions_attachments`, `codex_and_opencode_receive_images`, `evening_review_files_all_and_writes_digest`, `undo_reverts_filing_commits`, `tasks_parse_and_due_times`, `missed_run_runs_once` (pure `lastDue` logic), `tasks_folder_is_not_a_shelf`. RED first, then implement, `npm test -w @avanzel/engine` green, commit.

### Task 3: Voice (`packages/engine/src/voice/**`, `test/voice/**`) — subagent, worktree

**Interfaces:** `readWav(path) => {samples: Float32Array, sampleRate}` (PCM 8/16/24/32, mixes to mono), `writeWav(path, samples, sampleRate=16000)`, `resampleLinear(samples, from, to)`, `MODELS` spec (`nemo-parakeet-tdt-0.6b-v3`, `-v2`; silero VAD), `locateModel(id, modelsDir)` (app dir, then HF cache snapshot), `downloadModel(id, modelsDir, {onProgress, signal})`, `ParakeetTranscriber.load(modelDir, {vadPath?})` implementing `Transcriber` (accepts a WAV path or 16 kHz samples), `segmentSpeech(samples, vadSession)` (Silero port of onnx-asr `vad.py` + `models/silero.py`), `CommandTranscriber(argv)`, `makeTranscriber(options: VoiceOptions, modelsDir) => Promise<Transcriber>`.

- [ ] Tests: WAV round-trip + 8/24-bit + stereo; resample length; detokenizer (Unicode word boundaries: EN punctuation, RU words); `merge_segments` cases ported from onnx-asr semantics; opt-in `AVANZEL_TEST_ASR=1` integration: `say` EN/RU + 40 s text through VAD, compared against v0.1 Python output strings. Implement from the spike (`/tmp/avz-spike/parakeet.mjs` copied into the brief). Commit.

### Task 4: App shell (controller)

`apps/mac/src/main/{index,store,library,ipc,notify}.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`: single-instance, `app.dock.hide()`, settings JSON in userData (`libraryPath, shortcuts, fileMode: 'now'|'evening', micId, onboarded`), library bootstrap (open or init `~/Avanzel` after consent in the welcome pane), filing queue around the engine lock, test hooks when `AVANZEL_TEST=1`.
- [ ] vitest: `store_defaults_and_migration`, `filing_queue_serialises`. Commit.

### Task 5: Tray + shortcuts (controller)

`tray.ts` pure `buildMenuModel(state)` + wiring; `shortcuts.ts` register/unregister with conflict reporting.
- [ ] vitest: `menu_shows_inbox_count_and_next_task`, `taken_shortcut_is_reported`. Commit.

### Task 6: Capsule (controller)

Window: `type: 'panel'`, frameless, transparent, `focusable: false`, `showInactive()`, all spaces + full-screen, bottom-centre of the work area. Renderer (React): states listening/transcribing/filing/filed/saved/error, waveform from AudioWorklet RMS, Edit (focusable + textarea), Undo/Open/Dismiss; Esc cancels. Recording: getUserMedia → AudioWorklet → 16 kHz Float32 → IPC. Main: WAV → transcribe → capture → file per `fileMode`.
- [ ] Playwright e2e (fake audio WAV, fake agent): `dictation_files_and_shows_pages`, `edit_changes_text_before_filing`, `agent_failure_shows_error_and_keeps_inbox`. Commit.

### Task 7: Screen capture (controller)

`capture.ts`: screenshot of the display under the cursor (`desktopCapturer`, or `AVANZEL_FAKE_SCREEN`), front app (`lsappinfo`), browser URL/title via AppleScript for Safari/Chrome/Arc/Brave/Edge, permission status/requests. ⌥⇧S flow: capture → capsule with thumbnail listening for comment → save to inbox (not filed).
- [ ] vitest: `front_app_parsing`, `browser_script_choice`; e2e: `screen_capture_saves_to_inbox_with_attachment`. Commit.

### Task 8: Settings, quick-type, ask windows (controller or subagent)

React panes per the approved mockups: General (library, launch at login), Voice (shortcuts, model status + download progress, microphone, file mode), Agents (detected, default, model per agent, test), Library (path, git, open), Shadow tasks (list, enable, time, instructions, run now), Tools & MCP (read-only "next phase" list), Privacy (permission status + open System Settings). Welcome state when no library. Quick-type (Spotlight-like input) and Ask (question → Markdown answer with [[links]] opening pages).
- [ ] e2e: `settings_renders_all_panes`, `quick_type_files`, `ask_shows_answer`. Commit.

### Task 9: Scheduler + evening review (controller)

`scheduler.ts`: minute timer + `powerMonitor` resume; state in `.avanzel/state.json`; runs evening review / review / custom; notification with Undo all / Open summary.
- [ ] vitest: `due_once_per_day`, `missedRunRunsOnce`; e2e: `run_now_evening_review_files_inbox_and_writes_digest`. Commit.

### Task 10: Package, verify, document (controller)

electron-builder (`mac dir`, `asarUnpack` onnxruntime, Info.plist `NSMicrophoneUsageDescription`, `NSAppleEventsUsageDescription`, `LSUIElement`), template tray icon, app icon; README section; real run: dictation filed by Claude Code via test hooks on the built app; final whole-branch review (fresh reviewer), fixes, commit.
