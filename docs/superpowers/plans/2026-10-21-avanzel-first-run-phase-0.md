# Avanzel first run, Phase 0: make the first run possible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Mac's first dictation works: both speech models download as soon as there is a library and show as progress, agents are checked for real, a shortcut another app holds is caught with two free ones offered, and "Open Settings" lands on the pane that fixes the problem.

**Architecture:** The engine learns which models a voice setup needs and fetches them in one download with one progress figure; it also learns to check an agent (its own sign-in command where it has one, else one tiny read-only prompt). The Mac app's controller uses both, and its windows show the new states with `@avanzel/ui` components only. The capsule and Settings stay legacy windows otherwise; Phase 1 moves them fully onto the system.

**Tech Stack:** TypeScript (ESM, `.ts` import suffixes), Node ≥ 22, Electron 44 with React 19 renderers bundled by esbuild, `@avanzel/ui`, Vitest, Playwright for Electron.

**Spec:** §11 "Phase 0", with the copy from §5.2 and §7, of `reports/Avanzel UX and first-run design.md`. That file is untracked and lives only in the main checkout: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`. The UI contract is `packages/ui/DESIGN.md`.

## Global Constraints

- **Windows arrange, `@avanzel/ui` paints** (DESIGN.md). New UI uses components imported from `"@avanzel/ui"` and nothing deeper; window CSS may only arrange. No raw `<button>`, `<input>`, `<select>`, `<svg>` or headings in new markup, no `style`, no `className` on components.
- **No new components, patterns, tokens or gallery screenshots in `packages/ui`.** Those need the owner's approval (`npm run ui:approve`). Compose existing components in the window instead.
- `npm run design:check` passes after every task. The capsule and Settings are on `packages/ui/checks/baseline.json`; edits may not add problems.
- **Copy rules** (DESIGN.md "Copy"): sentence case, no "!", the one-character ellipsis "…", units as "412 of 673 MB" and "6 s", no "I" (that is for setup and letters, which Phase 0 doesn't touch), they/them.
- **Exact copy:**

  | Where | Text |
  |---|---|
  | Capsule, models downloading | headline "The speech model is still downloading"; progress label "Downloading the speech model"; footnote "{received} of {total} MB. Typing works now."; buttons "Hide", "Type instead" |
  | Capsule, download failed | title "The speech model didn't finish downloading."; body "Typing works in the meantime. Settings → Voice shows what went wrong."; buttons "Hide", "Type instead", "Try again" |
  | Settings → Voice, models missing | button "Download ({n} MB)", n = `Math.round(bytes / 1e6)` |
  | Shortcut taken (Settings row) | "{⌥Space} is used by another app, probably {Alfred}. Pick another shortcut." or, with no likely app, "{⌥Space} is used by another app. Pick another shortcut." |
  | Capsule, shortcut taken | title "{⌥Space} is used by another app, probably {Alfred}." (or "… another app."); body "Pick another shortcut. {Record a thought} is still in the menu bar."; buttons "Hide", then "Use {⌃⌥R}", "Use {⌃⇧Space}" (the best last, primary); with no free one, "Open Settings" |
  | Settings → Voice, shortcut taken | buttons "Use {⌃⇧Space}", "Use {⌃⌥R}" |
  | Settings → Agents | "Checking…", "Signed in", "Replied in {1.6} s", "Not signed in. Run `claude` once in Terminal and sign in." (Claude Code), "Not signed in. Run `codex login` in Terminal." (Codex), "Not signed in. Sign in to {name} in Terminal." (others), "Didn't reply within 15 s.", the failure's `errorLine()`; buttons "Check", "Check again"; the group note gains "Checking Claude Code or Codex reads their sign-in; other agents are asked one short question." |

- Role names for the shortcut body: dictate "Record a thought", capture "Capture screen with a comment", type "Type a thought", ask "Ask your library" (the menu's labels).
- **Never read or keep anything from `claude auth status` but `loggedIn`.** The JSON also holds the account's email and organisation.
- **The e2e tests must never download real models.** `launch()` points `AVANZEL_MODELS_URL` at a dead local port unless the test passes its own server.
- Electron e2e runs with `ELECTRON_RUN_AS_NODE` unset: from `apps/mac`, `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/<spec>.ts`.
- No new npm dependencies.
- **Commits:** one per task, subject `area: a sentence saying what now happens` (areas used here: `engine`, `voice`, `mac`), body wrapped near 78 columns with bullets saying what changed and why, no trailers.
- **Each task's gate:** `npm test -w <workspace>` for what it touched, `npm run typecheck`, `npm run design:check`, and the e2e specs it names.

## Review Focus

1. **Parakeet already in the Hugging Face cache, Silero missing** (anyone who used onnx-asr before): the status is "missing" with about 2 MB, only Silero is fetched, and the status turns ready. Nothing re-downloads 670 MB. Pinned by Task 2's test "a cached Parakeet leaves only Silero to fetch".
2. **A library whose `[voice]` backend is "command"** needs no models: the status is ready and nothing downloads. Pinned by Task 2's test "a command backend needs no models".
3. **A download that fails at launch with nobody watching** must not pop the capsule up or retry in a loop. Settings → Voice shows the error with Try again, and pressing the shortcut shows the failure notice. Pinned by Task 3's test "a failed download waits quietly, then offers Try again".
4. **An older Claude Code whose `auth status` prints no JSON** falls back to the prompt and is never reported as signed out. Pinned by Task 5's test "falls back to a prompt when the status command says nothing it understands".
5. **Every alternative shortcut is taken too:** the notice still says what happened and offers Open Settings (Voice), never an empty row of buttons. Pinned by Task 8's test "with no free shortcut the notice offers Open Settings".

---

### Task 1: A documentation screenshot never fails an e2e test

`snap()` takes pictures for people, not assertions, but a hung Electron frame once failed "typing a thought files it" after 30 s (it passed 4/4 on rerun).

**Files:**
- Modify: `apps/mac/e2e/helpers.ts:89-93` (`snap`)

- [ ] **Step 1:** In `snap(page, name)`, pass `timeout: 5_000` to `page.screenshot` and catch its failure, logging `snap <name>: <first line of the error>` with `console.warn`. The 350 ms wait stays.
- [ ] **Step 2:** Run `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/app.spec.ts` from `apps/mac`. Expected: all pass.
- [ ] **Step 3:** Commit: `mac: a documentation screenshot that times out no longer fails its e2e test`.

### Task 2: The engine knows which models a voice setup needs and fetches them together

**Files:**
- Modify: `packages/engine/src/voice/models.ts` (new `missingModels`, `downloadSize`, `downloadModels`, `downloadModelsFiles`; `downloadModelFiles` becomes a one-job `downloadModelsFiles`)
- Modify: `packages/engine/src/voice/index.ts` (new `speechModels`; export the new functions)
- Test: `packages/engine/test/voice/models.test.ts`, `packages/engine/test/voice/transcriber.test.ts`

**Interfaces:**
- Produces:
  - `speechModels(options: VoiceOptions): string[]` (index.ts): `[]` for backend "command"; `[options.model, VAD_MODEL]` for "onnx-asr". It validates exactly as `makeTranscriber` does (same AvanzelError messages for an unknown backend, model or quantization); move that validation into one private function both use.
  - `missingModels(ids: readonly string[], modelsDir: string, quantization = "int8"): string[]`: the ids `locateModel` finds no complete copy of, in the given order.
  - `downloadSize(ids: readonly string[], modelsDir: string, quantization = "int8"): number`: the pinned sizes of the files a download would fetch. That is every file of each id that is neither in `<modelsDir>/<id>/` at its pinned size nor in a Hugging Face cache snapshot at its pinned size. It has no side effects.
  - `downloadModelsFiles(jobs: readonly { model: ModelSpec; dir: string }[], options: DownloadOptions = {}): Promise<string[]>`: links cached files for every job first (as `downloadModelFiles` does today), then fetches the jobs in ascending order of bytes to fetch (ties keep the given order). `onProgress`'s `overallReceived` and `overallTotal` count over all jobs, and `overallTotal` stays fixed for the whole call. Returns the dirs in the given order.
  - `downloadModels(ids: readonly string[], modelsDir: string, options: DownloadOptions = {}): Promise<string[]>`: jobs `{ model: MODELS[id], dir: join(modelsDir, id) }`; rejects unknown ids as `downloadModel` does.
  - All of these are re-exported from `voice/index.ts`, so `@avanzel/engine` has them.

- [ ] **Step 1: Write the failing tests.** Let `fakeHub` take a list of `{ pin, files }` as well as today's single `(pin, files)`, so one server serves two repos; existing calls stay as they are.
  - `describe("speechModels")`, in transcriber.test.ts next to the `makeTranscriber` tests: "names Parakeet and Silero for onnx-asr, and nothing for a command". It expects `speechModels({ backend: "onnx-asr", model: V3, quantization: "int8", command: [] })` to equal `[V3, "silero-vad"]` and the command backend to give `[]`, and an unknown backend to throw `/Unknown voice backend/`.
  - `describe("downloadModelsFiles")`: "fetches the smaller model first and counts progress over both". Use two made-up specs on one hub: `pinnedSpec(v3Files())` and a one-file `silero_vad.onnx` spec (10 000 random bytes) under its own repo. Expect: the returned dirs are in the given order; `requests[0]` is the small spec's file; every event's `overallTotal` equals the sum of both specs' int8 sizes; the last event's `overallReceived` equals that total; `overallReceived` never decreases.
  - Same describe: "fetches nothing for a model that is already complete". The small spec's file is already in its dir with the right bytes. Expect no request for it, and `overallTotal` equal to the big spec's size only.
  - `describe("downloadSize")`: "counts only the files still to fetch". Use `useHfCache()` and real ids. Nothing present gives the sum of Parakeet v3's int8 pinned sizes plus 2 327 524 (672 807 563). Parakeet's int8 files made by `pinnedSizeFiles` in `<models>/<V3>/` gives 2 327 524. A Silero snapshot in the cache (sparse file of the pinned size, as the `locateModel` cache tests make it) as well gives 0.
  - `describe("missingModels")`: "names the models with no complete copy, in order". Parakeet is complete in the models dir, so `missingModels([V3, VAD_MODEL], models)` gives `[VAD_MODEL]`.
- [ ] **Step 2:** Run `npm test -w @avanzel/engine -- test/voice`. Expected: the new tests fail (functions not exported).
- [ ] **Step 3:** Implement as the Interfaces say. `downloadSize` and the cache-linking pass share one private function that decides, per file, whether it is kept, linked or fetched.
- [ ] **Step 4:** Run `npm test -w @avanzel/engine`. Expected: all pass, the existing `downloadModelFiles` and `downloadModel` tests unchanged.
- [ ] **Step 5:** Commit: `voice: both speech models are checked and fetched together, the small one first`.

### Task 3: The app is ready to listen only with both models, and fetches them once there is a library

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts:66-70` (`ModelStatus`: `{ kind: "missing"; bytes: number }`)
- Modify: `apps/mac/src/main/controller.ts` (`refreshModelStatus` at ~1281, `downloadModel` at ~1287, `start` at ~196, `useLibrary` at ~1266; new private `voiceOptions()`)
- Modify: `apps/mac/src/renderer/settings/main.tsx` (Voice → Speech model: the Download label)
- Modify: `apps/mac/e2e/helpers.ts` (`launch` defaults, new `fakeModelHub`, `emptyHfCache`, `hfSnapshot`)
- Create: `apps/mac/e2e/models.spec.ts`
- Modify: `README.md:83-85`

**Interfaces:**
- Consumes: `speechModels`, `missingModels`, `downloadSize`, `downloadModels`, `locateModel` (Task 2); the engine's `defaultSettings()`.
- Produces:
  - `voiceOptions(): VoiceOptions`: the library's `loadSettings(root).voice`, or `defaultSettings().voice` without a library.
  - `ModelStatus.missing.bytes`.
  - e2e helpers:
    - `fakeModelHub(mode: "stall" | "missing"): Promise<{ url: string; requests: string[] }>`. It serves `/<repo>/resolve/<revision>/<file>` for the real `MODELS`. "stall" answers 200 with the pinned `content-length`, sends 64 KB and holds the connection; "missing" answers 404. The server closes when the test ends.
    - `emptyHfCache(): string`: a temp dir to pass as `HF_HUB_CACHE`.
    - `hfSnapshot(hub: string, id: string): void`: writes a complete sparse snapshot of `MODELS[id]`'s int8 files, with `refs/main`.
  - `launch()` sets `AVANZEL_MODELS_URL: "http://127.0.0.1:9"` before the test's own env.

Behaviour:
- `refreshModelStatus()` (unchanged while downloading): ids = `speechModels(voiceOptions())`.
  - No missing ids gives `ready` with `dir` = `locateModel(ids[0])` (or `""` when ids is empty).
  - Missing ids give `missing` with `bytes` = `downloadSize(missing)`.
  - Any throw gives `error` with its message.
- `downloadModel()` downloads the missing ids with `downloadModels(…, { quantization, baseUrl: process.env.AVANZEL_MODELS_URL || undefined, onProgress })`, keeping today's progress throttle, notification and `dropTranscriber()`. Success ends in `refreshModelStatus()`, so `ready.dir` is right.
- `start()`: after `await this.refreshModelStatus()`, a library and a `missing` status start `void this.downloadModel()`.
- `useLibrary()`: after opening the library, refresh the status and start the download when it is `missing`.

- [ ] **Step 1: Write the failing e2e tests** in `models.spec.ts`. Every launch passes `HF_HUB_CACHE: emptyHfCache()`; "total" is the sum of `MODELS`' pinned int8 sizes for Parakeet v3 plus Silero, computed in the test.
  - "with a library, both speech models start downloading at launch, the small one first": a "stall" hub and a library. Expect `snapshot().model` to reach `{ kind: "downloading", totalBytes: total }`, and `hub.requests[0]` to contain `silero-vad-onnx`.
  - "without a library nothing downloads, and Settings offers the download with its size": a "stall" hub and no library. Expect `snapshot().model` to equal `{ kind: "missing", bytes: total }`. After the Settings window opens, its Voice pane shows a button "Download (673 MB)", and `hub.requests` is empty.
  - "a cached Parakeet leaves only Silero to fetch": `hfSnapshot(cache, "nemo-parakeet-tdt-0.6b-v3")`, a "stall" hub and a library. Expect `totalBytes` 2 327 524 and every request for `silero_vad.onnx`.
  - "a command backend needs no models": the library's config sets `[voice] backend = "command"`, as `app.spec.ts:371` does. Expect `snapshot().model.kind` to be "ready" and `hub.requests` to stay empty.
- [ ] **Step 2:** Run `npm run build -w apps/mac`, then the spec. Expected: the tests fail (status counts Parakeet only, nothing starts).
- [ ] **Step 3:** Implement the Behaviour above. In Settings, the "missing" button reads "Download ({n} MB)" from `model.bytes`. In README, line 84 says that once there is a library, Avanzel downloads both speech models once: Parakeet and the Silero VAD, which splits long recordings, 673 MB together, reusing a Hugging Face cache copy.
- [ ] **Step 4:** Run `npm test -w apps/mac`, `npm run typecheck`, `npm run design:check`, and `models.spec.ts`. Expected: all pass. Then `app.spec.ts`. Expected: all pass, unchanged.
- [ ] **Step 5:** Commit: `mac: Avanzel is ready to listen only with both speech models, fetched once there is a library`.

### Task 4: The capsule shows the download as progress, and a failed one with Try again

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts` (`CapsuleState`; `AvanzelBridge.capsule`)
- Modify: `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`readyToListen` at ~483, `downloadModel`; new `retryDownload`, `typeInstead`)
- Modify: `apps/mac/src/renderer/capsule/main.tsx` (two new cases); `apps/mac/src/renderer/capsule/styles.css` (one layout rule, if needed)
- Test: `apps/mac/e2e/models.spec.ts`

**Interfaces:**
- Consumes: `downloadModel()`, `ModelStatus` (Task 3).
- Produces:
  - `CapsuleState` gains `{ kind: "preparing"; receivedBytes: number; totalBytes: number }` and `{ kind: "model-failed" }`.
  - The bridge gains `capsule.retryDownload(): void` (channel `capsule:retry-download`) and `capsule.typeInstead(): void` (`capsule:type-instead`).
  - Controller: `retryDownload(): void`, which starts `downloadModel()` and shows `preparing`; and `typeInstead(): void`, which hides the capsule and calls `openQuick()`.

Behaviour:
- `readyToListen()` with the model not ready no longer calls `fail(…)`:
  - `missing` starts the download and shows `preparing`.
  - `downloading` shows `preparing`.
  - `error` shows `model-failed`.
- While the capsule shows `preparing`, every throttled progress update also updates it. When the download ends: success hides a `preparing` capsule, and the notification says it is ready; failure turns a `preparing` capsule into `model-failed`.
- A capsule that isn't showing `preparing` is never opened by the download itself.

Renderer, from `@avanzel/ui` only:
- `preparing`: a `Hud` holding a `Row` (gap 12, align start) of `Zel mood="thinking" size="small"` and a `Stack` (gap 8).
  - The stack holds the headline `Text`, the `Progress` (value `received / total`), the footnote `Text tone="secondary" numeric`, and `Actions` with `Button variant="quiet"` "Hide" (dismiss) and `Button variant="primary"` "Type instead".
  - Wrap the `Hud` in an element of the window's own sized like the legacy `.card` (width 420 px, max-width 100%), using arrange-only CSS.
- `model-failed`: `CapsuleNotice` with the title and the body `Text variant="footnote"`, and actions `Actions` of "Hide" (quiet), "Type instead" (secondary) and "Try again" (primary).
- MB figures are `Math.round(bytes / 1e6)`.

- [ ] **Step 1: Write the failing e2e tests** in `models.spec.ts`. Use `HF_HUB_CACHE: emptyHfCache()` and a library, and drive `toggleDictate` through `call()`.
  - "pressing the shortcut while the models download shows progress, and Type instead opens Quick": a "stall" hub. Expect the capsule to show `getByRole("progressbar", { name: "Downloading the speech model" })` and the text "The speech model is still downloading". Clicking "Type instead" shows the Quick window, and `capsuleKind` is "hidden".
  - "a failed download waits quietly, then offers Try again": a "missing" hub.
    - Poll `snapshot().model.kind` to "error", then expect `capsuleKind` "hidden".
    - `toggleDictate` shows "The speech model didn't finish downloading.".
    - Clicking "Try again" makes `hub.requests.length` grow, and the capsule ends at `model-failed` again.
- [ ] **Step 2:** Run the spec after `npm run build -w apps/mac`. Expected: fail (the old error card shows).
- [ ] **Step 3:** Implement the Behaviour and the renderer cases.
- [ ] **Step 4:** Run `npm run typecheck`, `npm run design:check`, `models.spec.ts`, `app.spec.ts` and `contrast.spec.ts`. Expected: all pass.
- [ ] **Step 5:** Commit: `mac: the shortcut during the download shows its progress, and a failed one offers Try again`.

### Task 5: The engine checks an agent for real

**Files:**
- Modify: `packages/engine/src/core/harness.ts` (`HarnessSpec.signIn`, `Harness.signIn`, built-in claude and codex, new `checkAgent`)
- Test: `packages/engine/test/core/harness.test.ts`

**Interfaces:**
- Produces:
  - `HarnessSpec.signIn?: { argv: readonly string[]; signedIn(stdout: string, exitCode: number): boolean | null }`, exposed as `Harness.signIn` (readonly, `undefined` when absent; custom harnesses have none).
  - Claude Code: argv `["claude", "auth", "status"]`. `signedIn` parses the JSON and returns `loggedIn === true` → true, `=== false` → false, and anything else (not JSON, no field) → null. It reads no other field.
  - Codex: argv `["codex", "login", "status"]`. `/not logged in/i` gives false, exit 0 with `/logged in/i` gives true, and anything else gives null.
  - `type AgentCheck = { ok: true; how: "signed-in" | "replied"; seconds: number } | { ok: false; why: "signed-out" | "timeout" | "failed"; detail: string; seconds: number }`.
  - `checkAgent(harness: Harness, vault: string, options: { timeoutSeconds?: number; signal?: AbortSignal } = {}): Promise<AgentCheck>`. The timeout defaults to 15 s.
    - With `signIn`, run its argv through the module's `collect` in `vault`. `true` gives `signed-in`. `false` gives `signed-out` with `detail: ""`. `null`, a timeout or a failure to start falls through to the prompt.
    - The prompt is `runHeadless(harness, "Reply with the single word: ready.", vault, { write: false, timeoutSeconds, signal })`. Success gives `replied` with the run's seconds; exit 124 gives `timeout`.
    - Any other failure gives `failed`, or `signed-out` when `errorLine(output + "\n" + stderr)` matches `/sign in|log in|login|not logged|unauthori[sz]ed|authenticat/i`; `detail` is that line.
    - A thrown AvanzelError, such as the binary missing, gives `failed` with its message.

- [ ] **Step 1: Write the failing tests** under `describe("checkAgent")`. Use `binScripts` on a stubbed PATH, as the `selectHarness` tests do, and get built-ins from `harnesses(settings)`.
  - "reads Claude Code's sign-in from `claude auth status`, without a prompt": `auth` prints `{"loggedIn": true, "email": "a@b"}`; any other call creates a file `PROMPTED`. Expect `{ ok: true, how: "signed-in" }` and no `PROMPTED`.
  - "a signed-out Claude Code is signed-out": `{"loggedIn": false}`, exit 1. Expect `{ ok: false, why: "signed-out" }`.
  - "falls back to a prompt when the status command says nothing it understands": `auth` prints "unknown command" and exits 1; the prompt prints "ready". Expect `how: "replied"`.
  - "reads Codex's sign-in from `codex login status`": "Logged in using ChatGPT" with exit 0 gives signed-in; "Not logged in" with exit 1 gives signed-out.
  - "asks other agents one tiny read-only prompt": a fake `cursor-agent` records its argv. Expect the argv to hold "Reply with the single word: ready." and no `--force`.
  - "a prompt slower than the timeout is timeout": the fake sleeps 5 s and `timeoutSeconds: 1`. Expect `why: "timeout"`.
  - "a sign-in line in a failed reply is signed-out": the fake prints "Error: not logged in. Run cursor-agent login" and exits 1. Expect `why: "signed-out"` and a `detail` containing "not logged in".
- [ ] **Step 2:** Run `npm test -w @avanzel/engine -- test/core/harness.test.ts`. Expected: fail.
- [ ] **Step 3:** Implement as the Interfaces say.
- [ ] **Step 4:** Run `npm test -w @avanzel/engine`. Expected: all pass.
- [ ] **Step 5:** Commit: `engine: an agent check reads Claude Code's and Codex's sign-in, and asks other agents one short question`.

### Task 6: Settings → Agents says whether each agent can work

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts` (`AgentStatus`; `HarnessInfo`; bridge `settings.checkAgent`, `settings.checkAgents`)
- Modify: `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (status cache, `checkAgent`, `checkAgents`, `snapshot`, `useLibrary`)
- Modify: `apps/mac/src/renderer/settings/main.tsx` (`Agents`, from ~223)
- Create: `apps/mac/e2e/agents.spec.ts`

**Interfaces:**
- Consumes: `checkAgent`, `AgentCheck`, `Harness.signIn` (Task 5).
- Produces:
  - `type AgentStatus = { kind: "checking" } | { kind: "signed-in"; seconds: number } | { kind: "replied"; seconds: number } | { kind: "signed-out" } | { kind: "timeout" } | { kind: "failed"; detail: string }`.
  - `HarnessInfo` gains `freeCheck: boolean` (it has `signIn`) and `status: AgentStatus | null`.
  - Bridge:
    - `settings.checkAgents(): Promise<SettingsSnapshot>` (channel `settings:check-agents`) runs the free checks of installed agents not checked yet in this app run.
    - `settings.checkAgent(name: string): Promise<SettingsSnapshot>` (channel `settings:check-agent`) checks that one agent again, its prompt included.
  - Both need a library and return at once; results arrive through `settings:changed`.

Behaviour:
- The controller keeps `Map<name, AgentStatus>` for the app run. A check sets `checking`, broadcasts, runs `checkAgent(harness, vault.root)`, maps the result and broadcasts again. `useLibrary()` runs `checkAgents()`.
- The Agents pane calls `checkAgents()` once when it mounts. Each installed agent's line shows its status with the copy above:
  - `checking` shows a `Spinner size="small" label="Checking"` with the text.
  - Signed-out, timeout and failed use `Text variant="footnote" tone="danger"`; signed-in and replied use `tone="secondary"`.
  - Commands sit in `Text variant="code"`.
- A `Button size="small" variant="secondary"` reads "Check" before any result and "Check again" after one. The group note gains its sentence.

- [ ] **Step 1: Write the failing e2e tests** in `agents.spec.ts`, using `makeLibrary()` (the fake agent is a custom harness, so its check is the prompt).
  - "Settings → Agents checks the fake agent with one prompt and shows how long it took": open Settings, then Agents, and click "Check". Expect the text `/Replied in \d+\.\d s/`.
  - "an agent that isn't signed in says how to sign in": `FAKE_AGENT_MODE: "fail-signin"`, then click "Check". Expect the text `/Not signed in\./`.
- [ ] **Step 2:** Run the spec after a build. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run typecheck`, `npm run design:check`, `agents.spec.ts`, `app.spec.ts` and `contrast.spec.ts`. Expected: all pass.
- [ ] **Step 5:** Commit: `mac: Settings → Agents says whether each agent is signed in and answering`.

### Task 7: "Open Settings" opens the pane that fixes the problem

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts` (`SettingsPane`, the error card's `action`, bridge `settings.onShowPane`)
- Modify: `apps/mac/src/main/windows.ts:54-71` (`createSettingsWindow(pane?)`)
- Modify: `apps/mac/src/preload/index.ts`
- Modify: `apps/mac/src/main/controller.ts` (`showSettings`, `openSettingsFor` at ~1003, the `fail` calls listed below)
- Modify: `apps/mac/src/renderer/settings/main.tsx` (`Pane` becomes the shared `SettingsPane`; initial pane; `onShowPane`)
- Test: `apps/mac/e2e/agents.spec.ts`

**Interfaces:**
- Produces:
  - `type SettingsPane = "general" | "voice" | "agents" | "tasks" | "tools" | "privacy"`.
  - The error card's `action` becomes `"open-microphone-settings" | "open-screen-settings" | \`open-settings:${SettingsPane}\``.
  - `showSettings(pane?: SettingsPane): void`. A new window loads `pagePath("settings")` with `{ query: { pane } }`; an open one gets `settings:show-pane`.
  - `settings.onShowPane(callback: (pane: SettingsPane) => void): () => void`.
  - The renderer starts on the query's pane when it is a known one, else "general".
- `fail` call sites:
  - Library missing (~487): `open-settings:general`.
  - "The recording didn't arrive" (~552), "No speech recognized" (~627) and the transcription error (~632): `open-settings:voice`.
  - "{agent} couldn't file this note" (~770): `open-settings:agents`.
  - `openSettingsFor` accepts only known panes and falls back to "general".

- [ ] **Step 1: Write the failing e2e test** "Open Settings on a failed filing opens Settings → Agents". Use `makeLibrary()` with `FAKE_AGENT_MODE: "fail"`, type a thought in Quick and press Enter. When the capsule shows "couldn't file this note", click "Open Settings". Expect the Settings window's "Agents" button to have `aria-current="page"`.
- [ ] **Step 2:** Run it. Expected: fail (General is current).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run typecheck`, `npm run design:check`, `agents.spec.ts` and `app.spec.ts`. Expected: all pass.
- [ ] **Step 5:** Commit: `mac: Open Settings opens the pane that fixes the problem`.

### Task 8: A shortcut another app holds is named, with two free ones to pick

**Files:**
- Modify: `apps/mac/src/main/shortcuts.ts`
- Create: `apps/mac/src/main/running-apps.ts`
- Modify: `apps/mac/src/main/menu-model.ts` (`MenuInput.takenShortcuts`)
- Modify: `apps/mac/src/shared/ipc.ts` (`CapsuleState`, `SettingsSnapshot.shortcutAlternatives`, bridge `capsule.useShortcut`)
- Modify: `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`applyShortcuts` at ~318, `start`, `menuInput`, `snapshot`; new `useShortcut`)
- Modify: `apps/mac/src/renderer/capsule/main.tsx`, `apps/mac/src/renderer/settings/main.tsx` (Voice → Shortcuts)
- Test: `apps/mac/test/shortcuts.test.ts`, `apps/mac/test/menu-model.test.ts`; create `apps/mac/e2e/shortcuts.spec.ts`
- Modify: `apps/mac/e2e/helpers.ts` (`launch` sets `AVANZEL_FAKE_TAKEN_SHORTCUTS: ""` by default, so no e2e test depends on which shortcuts this Mac's other apps hold)
- Modify: `README.md` ("Good to know")

**Interfaces:**
- Consumes: `open-settings:voice` (Task 7).
- Produces (shortcuts.ts):
  - `ShortcutApi` gains `unregister(accelerator: string): void`.
  - `ALTERNATIVES: Readonly<Record<keyof Shortcuts, readonly string[]>>`:
    - dictate `["Control+Shift+Space", "Control+Alt+R", "Control+Alt+D"]`
    - capture `["Control+Alt+S", "Control+Alt+C"]`
    - type `["Control+Alt+T", "Control+Alt+N"]`
    - ask `["Control+Alt+A", "Control+Alt+Q"]`
    - None of these is a macOS default; keep them clear of ⌃Space, ⌃⌥Space, ⌘Space, ⌥⌘Space, ⌃⌘Space and ⌥⌘D.
  - `freeAlternatives(key: keyof Shortcuts, shortcuts: Shortcuts, api: ShortcutApi, count = 2): string[]`. It walks the key's candidates in order and skips one equal to any of `shortcuts`' values. It keeps one when `api.register(candidate, () => {})` returns true, then calls `api.unregister(candidate)` at once; a throw counts as taken.
  - `likelyHolder(accelerator: string, running: readonly string[]): string | null`. Only for "Alt+Space", it returns the first of Alfred, Raycast, ChatGPT and Superwhisper whose process (`Alfred`, `Raycast`, `ChatGPT`, `superwhisper`, case-insensitive) is in `running`.
  - `registerShortcuts(shortcuts, handlers, api, running: readonly string[] = [])` writes the taken-shortcut copy above, with the holder from `likelyHolder`.
- `runningAppNames(): Promise<string[]>`: `ps -axco command` with a 5 s timeout, trimmed lines without the header, `[]` on any error.
- `CapsuleState` gains `{ kind: "shortcut-taken"; key: keyof Shortcuts; accelerator: string; holder: string | null; alternatives: string[] }`. `SettingsSnapshot` gains `shortcutAlternatives: Partial<Record<keyof Shortcuts, string[]>>`. The bridge gains `capsule.useShortcut(key: keyof Shortcuts, accelerator: string): void` (`capsule:use-shortcut`).

Behaviour:
- `applyShortcuts()` becomes async.
  - It registers once; when anything is taken, it reads `runningAppNames()` and registers again with them, for the holder in the copy.
  - It computes `freeAlternatives` for each taken key.
  - It uses `globalShortcut`. When `AVANZEL_FAKE_TAKEN_SHORTCUTS` is set (comma-separated, possibly empty; a test hook like the other `AVANZEL_FAKE_*`), it uses a stand-in instead that registers nothing for real and refuses exactly the listed accelerators.
- `start()`, after applying, shows `shortcut-taken` for the first taken key in the order dictate, capture, type, ask.
- `useShortcut(key, accelerator)` sets that shortcut through the existing `setApp` path. If the new one registered, it hides a `shortcut-taken` capsule; if it was taken meanwhile, it shows `shortcut-taken` for it, with fresh alternatives.
- `menuInput()` passes the taken keys. Their menu items keep their label but lose the accelerator.
- The capsule's `shortcut-taken` is a `CapsuleNotice` built from the copy above.
  - Its actions are "Hide" (quiet), then one `Button` per alternative ("Use {pretty}"; the first alternative is the primary, placed last).
  - With none, it shows one primary "Open Settings" (`open-settings:voice`).
- Settings → Voice adds, under a taken shortcut's problem, a small secondary `Button` "Use {pretty}" per alternative.

- [ ] **Step 1: Write the failing unit tests.**
  - shortcuts.test.ts:
    - "names the app that probably holds ⌥Space": the problem text, with running apps `["Finder", "Alfred"]` and without them.
    - "offers the first two free alternatives and leaves none registered": a fake api where "Control+Shift+Space" is taken gives `["Control+Alt+R", "Control+Alt+D"]`, with nothing left registered.
    - "never offers a shortcut Avanzel already uses": `type` = "Control+Alt+R" gives `["Control+Shift+Space", "Control+Alt+D"]`.
    - "offers nothing when every candidate is taken": gives `[]`.
    - "only ⌥Space has a likely holder": `likelyHolder("Alt+Shift+S", ["Alfred"])` is null; `likelyHolder("Alt+Space", ["superwhisper"])` is "Superwhisper".
  - menu-model.test.ts: "a taken shortcut is not shown in the menu". Dictate taken leaves the "Record a thought" item with no accelerator, while the others keep theirs.
- [ ] **Step 2:** Run `npm test -w apps/mac`. Expected: the new tests fail.
- [ ] **Step 3: Write the failing e2e tests** in `shortcuts.spec.ts`, with a library.
  - "a taken ⌥Space is named at launch, and a free one can be picked": `AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space"`.
    - Expect the capsule to show `/⌥Space is used by another app/` and the buttons "Use ⌃⇧Space" and "Use ⌃⌥R".
    - Clicking "Use ⌃⌥R" makes `snapshot().app.shortcuts.dictate` "Control+Alt+R" and `snapshot().shortcutProblems` `{}`, and `capsuleKind` is "hidden".
  - "with no free shortcut the notice offers Open Settings": the variable lists Alt+Space and every dictate candidate. Expect the capsule to show "Open Settings" and no "Use" button.
- [ ] **Step 4:** Implement. README "Good to know" gains two bullets: a shortcut another app holds is named in the capsule with two free ones to pick, and Settings → Agents checks that an agent is signed in.
- [ ] **Step 5:** Run `npm test -w apps/mac`, `npm run typecheck`, `npm run design:check`, `shortcuts.spec.ts`, `app.spec.ts` and `contrast.spec.ts`. Expected: all pass.
- [ ] **Step 6:** Commit: `mac: a shortcut another app holds is named, with two free ones to pick`.

### Task 9: The whole branch, checked

- [ ] **Step 1:** From the worktree root: `npm test`, `npm run typecheck`, `npm run design:check` and `npm run ui:e2e`, then from `apps/mac` the whole e2e suite (`env -u ELECTRON_RUN_AS_NODE npm run e2e`). Expected: all pass. The gallery screenshots are unchanged, since `packages/ui` wasn't touched.
- [ ] **Step 2:** If design-check counts dropped for a migrated part of the capsule or Settings, record it with `npm run design:check -- --update-baseline` (it can only lower counts) and commit `ui: the baseline records what Phase 0 moved onto the system`.
