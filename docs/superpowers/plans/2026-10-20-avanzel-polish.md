# Avanzel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every minor the v0.2 final review parked (speech model, engine, app) and make every part of the Mac app easy to read in light and dark mode.

**Architecture:** Three independent streams touch disjoint files and can run side by side: speech model (`packages/engine/src/voice/**`), engine core (`packages/engine/src/core/**`) and UI (`apps/mac` renderers, menu). Two app tasks follow once those land, because they build on the engine changes. No new dependencies.

**Tech Stack:** TypeScript (Node ≥ 22, ESM), vitest, onnxruntime-node 1.30.0, Electron 44.9.0, React 19, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-avanzel-design.md` and `docs/superpowers/specs/2026-10-20-avanzel-mac-design.md` stay the binding authority. The work list is the v0.2 final review's parked minors (quoted per task) plus the owner's request: "we need to check UI, as we have some elements which hard to see".

## Global Constraints

- Every constraint of `docs/superpowers/plans/2026-10-20-avanzel-mac.md` still holds: library format, every v0.1 guarantee, no shell strings (argv arrays only), Electron security (`contextIsolation`, `sandbox`, no `nodeIntegration`, typed preload bridge), Parakeet on the CPU provider with `intraOpNumThreads: 4`, `logSeverityLevel: 3`.
- Transcripts stay identical to onnx-asr 0.12.0's ONNX path (ruling 8 of v0.2).
- No new npm dependencies, no edits to `package.json` dependency lists.
- Branch `avanzel-polish` (from `avanzel-mvp` at dd33ecb); one or more commits per task; never push.
- Every Electron launch unsets `ELECTRON_RUN_AS_NODE` (the e2e `launch` helper does; manual runs use `env -u ELECTRON_RUN_AS_NODE`).
- Python, when a task needs it (fixtures only), runs through `uv` from the repo root (`uv run python -I …`); the v0.1 virtualenv has onnx-asr 0.12.0.
- Copy in the UI and errors: plain words, second person, sentence case, like the existing strings.
- Checks: `npm test` (engine + app unit), `npm run typecheck`, `env -u ELECTRON_RUN_AS_NODE npm run e2e -w @avanzel/mac` (app tasks only).

## Review Focus

1. An edit in progress while the evening review (scheduled, or queued earlier) runs: the misheard words are never filed and the corrected words are filed once (Task 11 e2e).
2. Quitting, or starting a new dictation, with the editor open: the corrected words end up in the inbox, never lost (Task 11 e2e).
3. A library a careless agent touched earlier — a link under `raw/`, a folder at an archive path: later recordings never land outside the library, and the evening review still finishes and reports (Tasks 6, 7).
4. Two Avanzel processes, or a crashed one whose pid came back: no process removes a lock it doesn't hold, and nobody waits forever on a reused pid (Task 8).
5. Dark mode and light mode: every text the owner has to read passes WCAG AA contrast, checked automatically (Task 9 `contrast.spec.ts`).

---

## Stream V — speech model (`packages/engine/src/voice/**`, `packages/engine/test/voice/**`, `packages/engine/assets/**`, `packages/engine/src/types.ts`)

### Task 1: Speech-model cleanups

Parked: "command.ts:27 replaceAll("{audio}", path) interprets $$/$& in paths", "untested paths: refs/main ordering … missing-files branch of load", "duplicated test helpers (withoutPath, HF-cache beforeEach) and duplicated model-list/quantization validation", "parakeet.ts:249 ternary deserves a comment; parakeet.test.ts:21-27 doesn't clear AVANZEL_ASSETS".

**Files:** Modify `src/voice/command.ts`, `src/voice/index.ts`, `src/voice/models.ts`, `src/voice/parakeet.ts`; tests `test/voice/{helpers,command,wav,models,transcriber,parakeet}.test.ts` (helpers is `helpers.ts`).

**Interfaces — Produces:**
- `models.ts`: `export function parakeetFileNames(quantization: string): { encoder: string; decoder: string }` (`"int8"` → `encoder-model.int8.onnx` / `decoder_joint-model.int8.onnx`, `""` → without `.int8`); `parakeet(repo)` and `ParakeetTranscriber.load` both use it.
- `index.ts`: the supported Parakeet ids are `Object.keys(MODELS)` minus `VAD_MODEL` (no second hand-written list).
- `test/voice/helpers.ts`: `withoutPath(): void` (PATH points at an empty folder for the rest of the test) and `useHfCache(): string` (a fresh `HF_HUB_CACHE` for the rest of the test, `HF_HOME` unset; returns the hub dir). Both restore through `vi.stubEnv`/`onTestFinished`.

- [ ] **Step 1: Write the failing tests**
  - `command.test.ts` › "passes a path with $ characters to the command unchanged": a 16 kHz mono PCM16 WAV at `<tmp>/a$&b$$c/x$'y.wav`; argv `[process.execPath, "-e", "process.stdout.write(process.argv[1])", "{audio}"]`; `expect((await t.transcribe(path)).text).toBe(path)`.
  - `models.test.ts` › "prefers the snapshot refs/main names": two complete snapshots `aaaa1111` and `bbbb2222`; `refs/main` = `bbbb2222` → `locateModel` returns the `bbbb2222` snapshot; with `refs/main` = `aaaa1111` → that one.
  - `parakeet.test.ts` › "load names the model files that are missing": empty dir → rejects with an `AvanzelError` whose message contains `encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx` and `vocab.txt`.
  - `parakeet.test.ts` › the "ships in the engine's assets folder" test stubs `AVANZEL_ASSETS` to `""` so an exported value can't redirect it.
- [ ] **Step 2: Run them; the `$` test fails (the path comes back with `{audio}` in it), the others pass or fail on missing helpers.** `npm test -w @avanzel/engine -- test/voice`
- [ ] **Step 3: Implement.** `replaceAll("{audio}", () => path)`; move the two helpers into `helpers.ts` and use them in every voice test that had its own copy; the `PARAKEET_MODELS` list and the suffix logic in `load` go through `MODELS`/`parakeetFileNames`; the `createSessions` ternary gets a one-line comment (`InferenceSession.create` has separate overloads for a path and for bytes, so the call can't take their union).
- [ ] **Step 4: Run the engine suite and typecheck.** `npm test -w @avanzel/engine && npm run typecheck` → all pass.
- [ ] **Step 5: Commit** — `voice: paths with $ reach the command intact; shared test helpers; one list of Parakeet models`

### Task 2: Pinned, checksummed model downloads

Parked: "download completeness judged on network bytes, no checksum; short disk write could be renamed in as complete."

**Files:** Modify `src/voice/models.ts`, `src/voice/index.ts` (exports); tests `test/voice/models.test.ts`.

**Interfaces — Produces:**
```ts
export interface ModelSpec {
  repo: string;
  /** Hugging Face commit every file is downloaded from; the digests are for it. */
  revision: string;
  files: Readonly<Record<string, readonly string[]>>;
  /** Size in bytes and lowercase hex SHA-256 of every file listed in `files`. */
  digests: Readonly<Record<string, { size: number; sha256: string }>>;
}
/** Makes `dir` hold every file of `spec` (for `options.quantization`); downloadModel(id, …) is this with MODELS[id] and <modelsDir>/<id>. */
export function downloadModelFiles(spec: ModelSpec, dir: string, options?: DownloadOptions): Promise<string>;
```

Pinned values (verified on 2026-10-20 against the Hugging Face API and the owner's local cache, whose blob names are these SHA-256s):

| repo @ revision | file | size | sha256 |
|---|---|---|---|
| `istupakov/parakeet-tdt-0.6b-v3-onnx` @ `8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce` | `config.json` | 97 | `666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466` |
| | `vocab.txt` | 93939 | `d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d` |
| | `encoder-model.int8.onnx` | 652183999 | `6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09` |
| | `decoder_joint-model.int8.onnx` | 18202004 | `eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70` |
| | `encoder-model.onnx` | 41770866 | `98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1` |
| | `encoder-model.onnx.data` | 2435420160 | `9a22d372c51455c34f13405da2520baefb7125bd16981397561423ed32d24f36` |
| | `decoder_joint-model.onnx` | 72520893 | `e978ddf6688527182c10fde2eb4b83068421648985ef23f7a86be732be8706c1` |
| `istupakov/parakeet-tdt-0.6b-v2-onnx` @ `0bbb45a3365852604aef28b538a8f066f4ccaa85` | `config.json` | 97 | `666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466` |
| | `vocab.txt` | 9384 | `ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d` |
| | `encoder-model.int8.onnx` | 652184014 | `3e0581fda6ab843888b51e56d7ee78b6d5bc3237ec113af1f732d1d5286aa155` |
| | `decoder_joint-model.int8.onnx` | 8998286 | `a449f49acd68979d418651dd2dcb737cc0f1bf0225e009e29ee326354edbf7d3` |
| | `encoder-model.onnx` | 41770866 | `3987bcd28175d829d12888a996a84e8f62a0e374d9ffd640662c1515adc679d3` |
| | `encoder-model.onnx.data` | 2435420160 | `4dab7362d4874d85965045b1e41b2d61dd2cc0fb25671a7f6b3dc47bf120cc41` |
| | `decoder_joint-model.onnx` | 35792059 | `cbb52a07bd70ab5b67f8439d4b3cd8704b18467b4430bcacb5adabe154b8d191` |
| `istupakov/silero-vad-onnx` @ `b3e3ee3cce4c11ceb63b1a0b229d916069c1ddf6` | `silero_vad.onnx` | 2327524 | `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3` |

Behaviour:
- URLs are `<baseUrl>/<repo>/resolve/<revision>/<file>` (not `main`).
- Progress totals come from the pinned sizes; the HEAD requests go.
- Each file streams to `<file>.part` while a SHA-256 runs over exactly the bytes written (every write completes, or use `stream/promises` `pipeline`). It is renamed into place only when the part's size on disk equals the pinned size and the digest matches. Otherwise the part is removed and the error names the file and ends with "try again".
- A file from a Hugging Face cache snapshot is linked only when its size (following the link) equals the pinned size; otherwise it is downloaded.

- [ ] **Step 1: Write the failing tests** (download tests use a fake hub and a test `ModelSpec` built from the bytes it serves, through `downloadModelFiles`):
  - "downloads every file from the pinned revision, reporting progress against the pinned sizes": requested paths are `/<repo>/resolve/<revision>/<file>`; last progress has `overallReceived === overallTotal === sum of sizes`.
  - "refuses a file whose SHA-256 doesn't match, leaving nothing behind": same size, one byte changed → rejects with `/try again/`; neither the file nor `.part` exists.
  - "refuses a short download" (adapted from the truncation test).
  - "links what the Hugging Face cache has, downloading a cached file of the wrong size instead".
  - "replaces a dangling link left by a cache that was cleaned".
  - "fetches the full-precision files when quantization is """: requested names equal `modelFiles(id, "")`.
  - "MODELS pins a revision, a size and a SHA-256 for every file it lists": every id has a 40-hex `revision`; every name in every `files` list has a positive `size` and a 64-hex `sha256`.
  - "downloadModel asks for the pinned revision of a real model": fake hub serves wrong bytes for `silero-vad` → the request path contains `resolve/b3e3ee3cce4c11ceb63b1a0b229d916069c1ddf6/silero_vad.onnx` and the call rejects with `/try again/`.
- [ ] **Step 2: Run; they fail** (no `revision`/`digests`, `resolve/main` URLs). `npm test -w @avanzel/engine -- test/voice/models.test.ts`
- [ ] **Step 3: Implement** `ModelSpec.revision`/`digests` with the table above, `downloadModelFiles`, `downloadModel` on top of it.
- [ ] **Step 4: Run the engine suite and typecheck** → pass.
- [ ] **Step 5: Commit** — `voice: model downloads pinned to a revision and checked against SHA-256`

### Task 3: Band-limited resampling

Parked: "resampleLinear has no low-pass before decimation (prefer ffmpeg for non-16 kHz WAVs)." v0.1 used onnx-asr's resamplers for the rates onnx-asr knows and ffmpeg otherwise; this task does the same.

**Files:**
- Add `packages/engine/assets/resample_{8,11,22,24,32,44,48}_16.onnx`, copied byte-for-byte from `.venv/lib/python3.12/site-packages/onnx_asr/preprocessors/data/` (onnx-asr 0.12.0); add them to `assets/NOTICE.md` with sizes and SHA-256 (as `nemo128.onnx` is).
- Create `src/voice/resample.ts`; move `SESSION_OPTIONS` to `src/voice/onnx.ts` (both `parakeet.ts` and `resample.ts` import it; `parakeet.ts` re-exports it if anything imports it from there).
- Modify `src/voice/wav.ts` (remove `resampleLinear`), `src/voice/command.ts`, `src/voice/parakeet.ts`, `src/voice/index.ts` (export `resampleTo16k`, drop `resampleLinear`).
- Modify `apps/mac/src/main/controller.ts`: the test-only `fakeAudio` is the app's one `resampleLinear` caller. It becomes async on `resampleTo16k`, and `onAudio` awaits it. That is the only app line this stream touches.
- Tests: create `test/voice/resample.test.ts`, fixtures `test/voice/fixtures/resample-{44100,48000}.f32` plus the script that made them, `test/voice/fixtures/make-resample-fixtures.py`; update `wav.test.ts`, `command.test.ts`.

**Interfaces — Produces:**
```ts
/** onnx-asr's own resamplers handle these source rates; any other goes through ffmpeg. */
export const ONNX_RESAMPLE_RATES: readonly number[]; // [8000, 11025, 22050, 24000, 32000, 44100, 48000]
/** Mono samples at `from` Hz as 16 kHz; 16 kHz input comes back as the same array. */
export function resampleTo16k(samples: Float32Array, from: number): Promise<Float32Array>;
```
ONNX resampler I/O, as onnx-asr runs it: inputs `waveforms` float32 `[1, n]`, `waveforms_lens` int64 `[1]`; outputs `resampled` (cut to `resampled_lens[0]`). One session per rate, created on first use from the asset's bytes (so it loads from inside app.asar). Other rates: write a PCM16 WAV at `from` into a temp folder, convert with `ffmpeg … -ac 1 -ar 16000 -c:a pcm_s16le`, read it back; without ffmpeg an `AvanzelError` saying audio at `<from>` Hz needs ffmpeg (macOS: `brew install ffmpeg`).

- [ ] **Step 1: Make the fixtures.** The script builds 0.5 s of `0.5·sin(2π·440·t) + 0.25·sin(2π·5000·t)` as float32 at 44 100 Hz and at 48 000 Hz, runs onnx-asr 0.12.0's `Resampler(16_000, …)` on each, and writes the outputs as little-endian float32. Run it from the repo root with `uv run python -I packages/engine/test/voice/fixtures/make-resample-fixtures.py`; commit the script and both `.f32` files.
- [ ] **Step 2: Write the failing tests** (`resample.test.ts`):
  - "matches onnx-asr exactly at 44.1 and 48 kHz": same input built in TS → every sample within `1e-6` of the fixture, same length.
  - "keeps a 1 kHz tone at every rate onnx-asr knows": RMS of the output within 2 % of the input's.
  - "filters what 16 kHz can't hold": a 10 kHz tone at 44 100 and 48 000 Hz → output RMS below 1 % of the input's (linear interpolation folds it to 6 kHz at full level).
  - "returns 16 kHz input as it is": `toBe` the same array.
  - "uses ffmpeg for other rates" (`skipIf(!hasFfmpeg)`): 96 000 Hz, 1 kHz tone → length within 1 of `n / 6`, RMS within 5 %.
  - "asks for ffmpeg for other rates when it is missing": `withoutPath()` → rejects with `/ffmpeg/`.
  - Remove the `resampleLinear` tests; `loadAudio`'s "any rate" test still passes.
- [ ] **Step 3: Run; they fail** (no `resample.ts`).
- [ ] **Step 4: Implement** `resample.ts`, switch every caller, remove `resampleLinear`.
- [ ] **Step 5: Run the engine suite, typecheck, and the opt-in ASR suite** `AVANZEL_TEST_ASR=1 npm test -w @avanzel/engine -- test/voice/integration.test.ts` → all pass (its "other sample rates" case now runs through the ONNX resampler).
- [ ] **Step 6: Commit** — `voice: band-limited resampling with onnx-asr's own resamplers, ffmpeg for other rates`

### Task 4: Parakeet orchestration tests, the long-clip check, and `release()`

Parked: "long-clip integration test checks keyword count, not a v0.1 string; ParakeetTranscriber.transcribe orchestration (25 s switch, batch of 8, join) lacks offline coverage", "no release() to free ~700 MB of sessions when the model setting changes".

**Files:** Modify `src/types.ts`, `src/voice/parakeet.ts`, `src/voice/index.ts` (`lazily`), `src/voice/command.ts`; tests `test/voice/parakeet.test.ts`, `test/voice/transcriber.test.ts`, `test/voice/integration.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts — optional, so transcribers made elsewhere (the app's stand-in) still type-check
interface Transcriber { /* … */ release?(): Promise<void> }
// parakeet.ts
export const VAD_THRESHOLD_SECONDS = 25; // unchanged
export function needsSegments(seconds: number): boolean; // seconds > VAD_THRESHOLD_SECONDS
/** Recognises `segments` of `samples` `batchSize` at a time; trims each text, drops empty ones, joins with one space. */
export function recognizeSegments(
  samples: Float32Array,
  segments: readonly (readonly [number, number])[],
  recognize: (batch: Float32Array[]) => Promise<string[]>,
  batchSize?: number, // default 8
): Promise<string>;
```
`release()` semantics: waits for transcriptions in progress, then frees every ONNX session. `ParakeetTranscriber.transcribe` after `release()` rejects with an `AvanzelError` saying the model was released. The lazy transcriber from `makeTranscriber` releases what it loaded and loads again on its next `transcribe`. `CommandTranscriber.release()` resolves (nothing held).

- [ ] **Step 1: Write the failing tests**
  - "recognizes long audio eight segments at a time and joins the texts": 17 segments → `recognize` called with batch lengths `[8, 8, 1]`; each batch item equals `samples.subarray(start, end)`; texts `[" a ", "", "b", …]` → `"a b …"`.
  - "splits only audio longer than 25 s": `needsSegments(25) === false`, `needsSegments(25.001) === true`.
  - `transcriber.test.ts` › "release frees the loaded model and the next use loads it again": a `makeTranscriber` result over a fake load (inject through a test seam you add to `lazily`, e.g. exporting `lazily` for tests) → after `release()`, the loaded transcriber's `release` ran once and the next `transcribe` calls the loader again.
  - "release waits for a transcription in progress": the loaded transcriber's `release` starts only after a pending `transcribe` settles.
  - `integration.test.ts` (opt-in): the long-clip case asserts the exact v0.1 transcript string. Get it by running v0.1's transcriber (`uv run` from the repo root) on the same `say` output, and note in a comment which macOS voice made it.
  - `integration.test.ts` (opt-in) › "release frees the sessions and a released model refuses to transcribe".
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the two exported helpers (and use them in `transcribe`), `release()` on `ParakeetTranscriber`, `lazily` and `CommandTranscriber`.
- [ ] **Step 4: Run the engine suite, typecheck, and the opt-in ASR suite** → all pass.
- [ ] **Step 5: Commit** — `voice: Parakeet frees its model on release(); long audio is tested offline and against v0.1`

---

## Stream C — engine core (`packages/engine/src/core/**`, `packages/engine/test/core/**`, `packages/engine/test/fake-agent.mjs`)

### Task 5: The guard in its own module

Parked: "librarian.ts is 606 lines; extract guard.ts with direct unit tests"; the final review asked for "direct tests for undoProtected ordering".

**Files:** Create `src/core/guard.ts` and `test/core/guard.test.ts`; modify `src/core/librarian.ts` (imports, nothing else changes).

**Interfaces — Produces** (`guard.ts`, moved as they are from `librarian.ts`): `PROTECTED`, `PROTECTED_PARENTS`, `OWN_PATHS`, `interface ProtectedState`, `protectedState(root: string): ProtectedState`, `undoProtected(root: string, before: ProtectedState): string[]`; private helpers `kindOf`, `behindLink`, `byDepth` move with them.

- [ ] **Step 1: Write the tests** (`guard.test.ts`, on a temp library made with `Vault.init(root, { git: false })`, changes made by the test itself between `protectedState` and `undoProtected`):
  - "puts back a changed protected file and says so": edit `AGENTS.md` → restored bytes; returns `["AGENTS.md"]`.
  - "removes what a run added under a protected folder": new `.claude/settings.json` → gone; reported.
  - "puts back a protected folder swapped for a link, writing nothing through the link": `.claude` (with the owner's `commands/x.md`) replaced by a link to an outside folder holding `settings.json` → `.claude` is a real folder again with `commands/x.md`; the outside folder's listing and bytes unchanged.
  - "puts back the owner's own link when a run removes or retargets it": owner's link `.claude/commands → <outside A>`; run retargets it to `<outside B>` → points at A again.
  - "turns a file made into a folder back into the file, and a folder made into a file back into the folder": `.avanzel/config.toml` → folder with a file inside; `tasks` → a file. Both restored, contents identical.
  - "handles the shallowest link first": `.avanzel` replaced by a link to an outside folder that holds a planted `config.toml` → the outside `config.toml` is untouched and `.avanzel/config.toml` is restored inside the library.
  - "changes nothing when nothing changed": returns `[]`; `AGENTS.md`'s mtime unchanged.
- [ ] **Step 2: Run; they fail to import** (`guard.ts` missing).
- [ ] **Step 3: Move the code; `librarian.ts` imports it.**
- [ ] **Step 4: Run the engine suite and typecheck** → all pass, librarian tests untouched.
- [ ] **Step 5: Commit** — `engine: the guard in its own module, with direct tests`

### Task 6: Links an agent plants never outlive its run

Parked: "recordings moved into raw/audio via newAudioPath still follow a link planted under raw/audio", "newAttachmentPath/newAudioPath follow a link an earlier run planted under raw/attachments/YYYY or raw/audio/YYYY", "a raw/<year> link planted by an agent survives Undo (#keptOnUndo keeps every raw/* path), so later filings into that year fail until removed by hand".

**Files:** Modify `src/core/guard.ts`, `src/core/vault.ts` (`claim`), `src/core/git.ts` (`revertKeeping`), `src/core/librarian.ts` (digest wording only); `test/fake-agent.mjs` (modes `link-audio`, `link-attachments`); tests `test/core/{guard,vault,git,librarian}.test.ts`.

Behaviour:
1. `protectedState` also records every symlink under `inbox/`, `raw/` and `reviews/`, at any depth. It never descends into a link and never reads file contents there. So after every agent run, a link the run added anywhere in those folders is removed, and an owner's link it changed is put back. Both are reported in `guarded`. The digest's "Undid the agent's changes to …" parenthesis covers links in Avanzel's own folders too.
2. `newAudioPath` / `newAttachmentPath` create and claim only through real folders inside the library (`realFoldersTo(root, rel, true)`). Through a link they throw an `AvanzelError` naming the folder, saying Avanzel doesn't save through links and to remove the link.
3. `revertKeeping` never keeps a deleted symlink. Deletions are listed with their old mode (`git diff --cached --raw -z --no-renames --diff-filter=D`); mode `120000` entries are left deleted without calling `keep`. Undoing a commit that added a link under `raw/` or `inbox/` therefore removes it.

- [ ] **Step 1: Write the failing tests**
  - `librarian.test.ts` › "removes a link an agent planted under raw/audio, so later recordings stay in the library" (mode `link-audio`, `FAKE_AGENT_OUTSIDE` = empty outside folder): the outcome's `guarded` contains `raw/audio/<yyyy>`; that path is no longer a link; `vault.newAudioPath(now)`'s realpath is under the library root; the outside folder is empty.
  - Same for `link-attachments` (`raw/attachments/<yyyy>/<mm>`) and `newAttachmentPath`.
  - Update "never moves or deletes anything outside the library through a link under raw/" (`link-year`): the outside folder is untouched; the owner's words are restored; the planted `raw/2026` link is gone; the capture is filed (`ok`) into a real `raw/2026/10/` inside the library.
  - `vault.test.ts` › "never claims a recording or screenshot path through a linked folder": `raw/audio/2026` → link to an outside folder → `newAudioPath(NOW)` throws `AvanzelError`; the outside folder stays empty. Same for `raw/attachments/2026/10` and `newAttachmentPath`.
  - `git.test.ts` (or librarian) › "Undo removes a link a run committed under raw/": commit a symlink `raw/2026` straight with git (a library from before this fix) as an `avanzel: file …` commit → `librarian.undo([sha])` → `raw/2026` doesn't exist; a regular file the same commit added under `raw/` is still kept.
  - `guard.test.ts` › "removes a link added deep under raw/, keeps the owner's links there".
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the three changes and the two fake-agent modes (document them in the mode list at the top of `fake-agent.mjs`).
- [ ] **Step 4: Run the engine suite and typecheck** → all pass.
- [ ] **Step 5: Commit** — `engine: links an agent plants in inbox/, raw/ or reviews/ never outlive its run`

### Task 7: A folder at the archive path fails only its capture; cancel tests wait for the agent

Parked: "a folder an agent creates at raw/YYYY/MM/<id>.md makes Vault.archive throw EISDIR and the whole evening review throws (outcomes and commits lost to the caller)", "the cancel test aborts after a fixed 500 ms (could wait for goals/half.md instead)".

**Files:** Modify `src/core/librarian.ts` (`#notFiled`, `#fileQueue`), `src/core/vault.ts` (`archive`); `test/fake-agent.mjs` (mode `folder-at-archive`: for a capture whose words contain `blocked-archive`, makes a folder at `raw/<yyyy>/<mm>/<capture id>.md` and files a page; other captures it files normally); tests `test/core/librarian.test.ts`, `test/core/vault.test.ts`.

Behaviour:
- After a run, a folder (anything but a file) at the capture's archive path means not filed: "Could not archive <id>: the agent left a folder at <archiveRel>." What the run did is committed as leftovers, and the capture stays in the inbox.
- `Vault.archive` throws an `AvanzelError` (not `EISDIR`) when the destination isn't free for a file.
- `#fileQueue` turns an `AvanzelError` thrown while filing one capture into that capture's error outcome and goes on with the next. The evening review always returns its outcomes, digest and commits.
- At the next review, `#adopt` already gives that capture a fresh id because its archive name is taken. A test pins this.

- [ ] **Step 1: Write the failing tests**
  - "a folder the agent leaves at the archive path fails only that capture" (git library): captures "blocked-archive notes" and "plain notes", mode `folder-at-archive` → `eveningReview()` resolves; outcomes `[false, true]`; the first's error mentions the archive path and its `commit` is set; `review.commits` holds both runs' commits and the digest's; the first capture is still pending.
  - "the next review files it under a fresh id": mode `ok`, second `eveningReview()` → one outcome, `ok`, its `captureId` differs from the first capture's id.
  - `vault.test.ts` › "archive refuses a destination that is a folder with an AvanzelError".
  - Rewrite "stops when cancelled, leaving the rest in the inbox" to abort once the fake agent has started: wait until its `FAKE_AGENT_RECORD` file has a line.
  - Rewrite "hands out a cancelled run's leftovers too" to abort once `goals/half.md` exists. Neither test uses a fixed delay any more.
- [ ] **Step 2: Run; the archive tests fail** (the review throws `EISDIR`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the engine suite three times** (`for i in 1 2 3; do npm test -w @avanzel/engine || break; done`) and typecheck → all pass every time.
- [ ] **Step 5: Commit** — `engine: a folder at the archive path fails only its capture; cancel tests wait for the agent`

### Task 8: The lock is released only by its holder, and a reused pid doesn't hold it

Parked: "withLock release doesn't check ownership; pid reuse can make waiters poll forever."

**Files:** Modify `src/core/vault.ts`; tests `test/core/vault.test.ts`.

Behaviour:
- The owner file is one line `<pid> <bootSeconds> <startSeconds> <token>`. `startSeconds` = this process's start, rounded to the second (`Date.now() / 1000 - process.uptime()`); `token` = a fresh `randomUUID()` per acquisition.
- Release removes the lock only while its owner line carries this acquisition's token: rename it to a grave, re-check, and put it back if it isn't ours.
- A lock whose pid is alive is stale when the line has a `startSeconds` and that pid's real start (from `ps -o etime= -p <pid>`, run as an argv with `LC_ALL=C`) differs from it by more than 60 s. The pid was reused. `ps` runs at most once per distinct owner line (cache the verdict). When `ps` fails or prints something unparseable, the lock counts as held, as today.
- One- and two-field owner lines from older versions are judged exactly as today.

**Interfaces — Produces:** `export function parseElapsed(text: string): number | null` (`"05:07"` → 307, `"01:02:03"` → 3723, `"2-01:02:03"` → 176523, anything else → null).

- [ ] **Step 1: Write the failing tests**
  - "takes over a lock whose pid now belongs to a process started after the lock was taken": owner line = this process's pid and boot, `startSeconds` one hour before this process started, any token → `withLock` runs without calling `onWait`.
  - "waits on a lock held by a live process that started when it says": this process's pid, boot and true start → `onWait` once; after the test removes the lock, the work runs.
  - "leaves a lock that someone else took over in place": inside the work, replace the lock folder with one whose owner line has another token → after `withLock` returns, the lock folder exists with that line.
  - Update "holds the lock with this process's pid …": four fields; the pid is first and the token is 36 characters.
  - `parseElapsed` cases above.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the engine suite and typecheck** → all pass.
- [ ] **Step 5: Commit** — `engine: a lock is released only by its holder, and a reused pid no longer holds it`

---

## Stream U — UI (`apps/mac/src/renderer/**`, `apps/mac/src/main/{menu-model,tray}.ts`, one action in `controller.ts`, `apps/mac/e2e/contrast.spec.ts`)

### Task 9: Everything readable, light and dark

The owner: "we have some elements which hard to see". The audit (screenshots of every window and capsule state in both appearances, plus the menu-bar menu) found these. Contrast figures are WCAG ratios against the real backgrounds.
- **Menu-bar menu:** the status line ("Inbox is empty. Next: Evening review at 21:00.") and the "Recently filed" and "Shadow tasks" titles are disabled items, drawn dim grey.
- **Ask window:**
  - the traffic-light buttons sit on the question field's top edge;
  - the "<agent> answered in N s" line and the empty-state text use `--text-3`: 2.6:1 light, 3.0:1 dark.
- **Quick window:** the "↩ to save" hint uses `--text-3` (same ratios).
- **Status text:**
  - `Ready` / `Allowed` in `--ok` measure 2.0–2.2:1 on light;
  - `--danger` text 3.3–3.5:1 on light;
  - `--accent` links 3.7–4.0:1 on light and 3.9:1 on dark surfaces.
- **Placeholders** ("Agent's default model", "Ask your library…") are far below 3:1 in dark mode.
- **Tools & MCP:** the disabled "coming next" switches are nearly invisible in dark mode.
- **Capsule:** the close button covers the "in 23 s" text on the filed card.

**Files:** Modify:
- `apps/mac/src/main/menu-model.ts`, `tray.ts`;
- `controller.ts` (`menuAction`: `open-inbox` opens the library's `inbox/` with `shell.openPath`);
- `apps/mac/test/menu-model.test.ts`;
- `apps/mac/src/renderer/common/mac.css`, `settings/{styles.css,main.tsx}`, `ask/styles.css`, `quick/styles.css`, `capsule/styles.css`.

Create `apps/mac/e2e/contrast.spec.ts`.

**Interfaces — Produces:**
- `MenuItemModel`:
  - `{ type: "header"; label: string }` — no sublabel; a real macOS 14+ section header;
  - `{ type: "item"; …; sublabel?: string }`.
- `tray.ts` maps:
  - `header` → `{ type: "header", label }`;
  - `item.sublabel` → `sublabel`.
- New CSS tokens in `mac.css`: `--ok-text`, `--danger-text`, `--accent-text`. They are used wherever those colours are text; fills (switches, primary buttons, dots) keep `--ok`/`--danger`/`--accent`. Starting values, measured to pass:

  | Token | Light | Dark |
  |---|---|---|
  | `--ok-text` | `#1f7a35` | `#30d158` |
  | `--danger-text` | `#d70015` | `#ff6961` |
  | `--accent-text` | `#0064d2` | `#409cff` |

Behaviour:
1. **Menu.** Nothing the owner needs to read is a disabled item.
   - With a library, the first item is an enabled `Inbox is empty` / `1 note in the inbox` / `N notes in the inbox` (action `open-inbox`). The next task goes in its sublabel (`Next: Evening review at 21:00`, wording from today's `nextPhrase`).
   - Without one, the first item is the enabled `Set up Avanzel…` (action `settings`), with the problem or "Choose a folder for your library to start." as its sublabel.
   - "Recently filed" and "Shadow tasks" are headers.
   - The rest of the menu is unchanged.
2. **Ask window.** The question field starts below the traffic lights. Screenshot it to show they don't touch.
3. **Secondary text.** No text uses `--text-3` any more: the Ask meta line, Ask empty state and Quick hint use `--text-2`. `::placeholder` in every window uses a colour that passes 4.5:1 on its field in both appearances; darken the dark `--control` fill if that's what it takes.
4. **Status and link text** use the `*-text` tokens.
5. **Tools & MCP.** The "Coming next" rows show a "Coming soon" label (secondary text) instead of disabled switches.
6. **Capsule.** The close button never overlaps text: the card's first row leaves room for it. It still appears on hover.
7. **`contrast.spec.ts`** launches the app with a fake-agent library. It checks each surface in light and dark: `nativeTheme.themeSource`, plus `page.emulateMedia({ colorScheme })` on every page, since Playwright forces light otherwise.
   - **Surfaces:**
     - every Settings pane, and the welcome screen (a second launch without a library);
     - Quick, empty and typed;
     - Ask, empty and with an answer;
     - the capsule in `listening`, `transcribing`, `filing`, `editing`, `filed` (with pages), `saved` (with context) and `error`, each set through the controller's `setCapsule`.
   - **Rule:** every visible element with its own text node needs contrast ≥ 4.5:1, or ≥ 3:1 for text ≥ 24 px, or ≥ 18.66 px at weight ≥ 700. Placeholders are read with `getComputedStyle(el, "::placeholder")`. Disabled controls are exempt.
   - **Measuring:** text colour (with alpha and ancestor `opacity`) is composited over the element's background, which is itself composited from the root down over a base:
     - Settings sidebar: measured light `#e1e1e4` and dark `#464649`;
     - other transparent page roots: `--window`;
     - the capsule: white and black, and both must pass.
   - **Output:** failures list the selector, text, both colours and the ratio.
   - **Reference:** a scratch screenshot script used for the audit is at `/tmp/avz-polish/ui-audit.spec.ts`. Copy from it freely; don't commit it.

- [ ] **Step 1: Write the failing tests**
  - `menu-model.test.ts`: no item is `header` with a sublabel; the first item is an enabled `open-inbox` item labelled from the inbox count with the next-task sublabel; without a library, `Set up Avanzel…` comes first with the problem as its sublabel; "Recently filed" and "Shadow tasks" are headers.
  - `contrast.spec.ts` as above.
- [ ] **Step 2: Run them; both fail.**
  - Unit: `npm test -w @avanzel/mac`.
  - e2e: `env -u ELECTRON_RUN_AS_NODE npm run e2e -w @avanzel/mac -- contrast.spec.ts`. It lists the elements above.
- [ ] **Step 3: Implement the seven changes.** Screenshot the Ask window, the capsule's filed card and the Tools & MCP pane in both appearances. Look at them, and note in the report that you did.
- [ ] **Step 4: Run app unit tests, typecheck, and the full e2e suite** → all pass.
- [ ] **Step 5: Commit** — `mac: readable menu status and section headers, contrast fixes in light and dark, and an automated contrast check`

---

## After the three streams merge

### Task 10: Ask waits for the library lock, and says so

Parked: "read-only ask runs the guard without the lock (can re-apply a change a concurrent filing's guard undid)."

**Files:**
- Engine: modify `packages/engine/src/core/librarian.ts` (`ask`); test `packages/engine/test/core/librarian.test.ts`.
- App: modify `apps/mac/src/main/controller.ts` (`ask`), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/ask/main.tsx`; e2e `apps/mac/e2e/app.spec.ts`.

**Interfaces — Produces:**
- `Librarian.ask(question, { save?, signal?, progress?: (message: string) => void })` always runs under `withLock`, read-only too. While it waits it calls `progress` once with the engine's existing `WAITING` text.
- Bridge: `ask.onProgress(callback: (message: string) => void): () => void`, on channel `ask:progress`.
- Main sends the ask window "Waiting for the filing in progress to finish…" when the engine reports waiting. The pending row shows the latest progress message in place of "Looking through your library…".

- [ ] **Step 1: Write the failing tests**
  - Engine › "a read-only ask waits for the library lock": hold the lock with `vault.withLock(() => gate)`, start `ask("q", { progress })`. Within 300 ms `progress` got `WAITING` and the fake agent's record file is still empty. Release the gate; the ask resolves `ok` and the record has one run.
  - e2e › "asking while a note is being filed says it is waiting, then answers":
    - a dictation with `FAKE_AGENT_DELAY_MS: "4000"`;
    - while the capsule shows `filing`, ask in the Ask window;
    - the pending row shows "Waiting for the filing in progress to finish…";
    - then the answer appears.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, typecheck, and the full e2e suite** → all pass.
- [ ] **Step 5: Commit** — `engine, mac: Ask waits for the library lock and says so`

### Task 11: Edits survive reviews, quitting and new dictations; empty scheduled reviews say so; old models are freed

Parked:
- "an evening review that comes due while the owner is in the editor may file the misheard note first; the corrected words are then filed as a second note";
- "quitting with the editor open drops the edit (the original capture stays in the inbox)";
- "'Inbox was empty' is shown only for runs started by hand".

Same root as (40) "Starting a new dictation while the editor is open drops the edit", so it's included. Wiring Task 4's `release()` lives here too.

**Files:**
- Engine: modify `packages/engine/src/core/librarian.ts` (`FileOptions.leave`, `#fileQueue`); test `packages/engine/test/core/librarian.test.ts`.
- App: modify `apps/mac/src/main/controller.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/capsule/main.tsx` (the editor reports its text); e2e `apps/mac/e2e/filing.spec.ts`, `apps/mac/e2e/app.spec.ts`.

**Interfaces — Produces:**
- `FileOptions.leave?: (capturePath: string) => boolean`. Pending captures it returns true for are skipped by `file()`/`eveningReview()`: left in the inbox, not reported.
- Bridge: `capsule.editDraft(text: string): void` (channel `capsule:edit-draft`), sent on every change in the editor; the controller keeps it on the job as `draft`.
- Controller: `editing: Set<string>`, the capture paths from Edit until their edit is settled (refiled, kept or cancelled). Every `eveningReview` the controller starts passes `leave: (p) => this.editing.has(p)`.

Behaviour:
1. A review that starts during an edit, or was already queued before Edit was pressed, leaves the edited capture alone. The corrected words are filed once, by the refile; the misheard words never are.
2. **Keeping an edit:** take back the stopped run's commit, then save the draft as a fresh capture with the old one's metadata (`recapture`), without filing. If the draft is empty or unchanged, only take back, leaving the original capture in the inbox. Two triggers:
   - **Quitting with the editor open.** `busy()` is true while editing, so quitting waits. The work runs in the queue, inside the existing quit wait (`QUIT_WAIT_MS`). If the wait ends first, the draft is written as a fresh capture anyway, so the words survive even if the misheard capture also stays.
   - **Starting a dictation or screen capture with the editor open.** The edit is kept the same way, and the capsule switches to listening.
3. A scheduled evening review that found nothing to file notifies "Inbox was empty." exactly as a hand-started one does.
4. When the library's `[voice]` settings change or another library opens, the transcriber being replaced is released (`await old.release?.()`), after any transcription in progress.

- [ ] **Step 1: Write the failing tests**
  - Engine › "leaves captures the owner is editing in the inbox": captures `a` and `b`; `eveningReview({ leave: (p) => p === a.path })` files only `b`, and `a` is still pending.
  - e2e (`filing.spec.ts`) › "an evening review during an edit files only the corrected words":
    - `AVANZEL_FAKE_TRANSCRIPT: "misheard words"`, `FAKE_AGENT_DELAY_MS: "3000"`;
    - dictate, then press Edit;
    - `runTask("evening-review")` while editing, then `idleForTests`; the misheard capture is still in the inbox;
    - type "corrected words" in the editor and press File; wait until idle;
    - no archived capture contains "misheard", and exactly one contains "corrected words".
  - e2e › "quitting with the editor open keeps the edit in the inbox":
    - Edit, type "corrected words", then quit through `electronApp.quit()` (like the existing mid-filing quit test);
    - the inbox holds one capture, containing "corrected words".
  - e2e › "starting a new dictation with the editor open keeps the edit": Edit, type, `toggleDictate` → the capsule is `listening`; after cancelling the recording, the inbox holds the corrected capture.
  - e2e (`app.spec.ts`) › "a scheduled evening review with nothing to file says so": `runTask("evening-review", true)` then idle → `notificationsForTests()` contains `{ title: "Evening review", body: "Inbox was empty." }`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, typecheck, and the full e2e suite** → all pass.
- [ ] **Step 5: Commit** — `mac: edits survive reviews, quitting and new dictations; empty scheduled reviews say so; replaced speech models are freed`
