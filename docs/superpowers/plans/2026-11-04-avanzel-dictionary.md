# Personal dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person lists the names and terms they use ("Avanzel", "Kowalczyk", "Ollama = Alema, Polymer"); what the speech model hears is corrected to them, and the filing agent is told them, so nothing is mis-spelled in the library.

**Architecture:** One pure engine module parses the dictionary and corrects a text: exact "heard as" aliases always, a conservative sound-alike match for the rest. A transcriber decorator applies it to every transcript and segment (thoughts, questions and calls). The library's `config.toml` `[voice]` table holds the list. The filing prompt gets the spelled terms as a hint, and a corrected capture keeps what was heard in a `heard:` field. Settings → Voice gets a Dictionary group (one `TextArea`).

**Tech Stack:** TypeScript (engine + Electron main + renderer), vitest, Playwright.

**Spec:** the study that chose this design is in `/tmp/dict-test` (60 spoken sentences with 30 terms through the real Parakeet model: 16 sound-alike misses; a cautious sound-alike rule fixed 10 of 16 and rewrote 2 of 120 ordinary sentences wrongly, so it is conservative and the alias is the sure path). Prototype: `/tmp/dict-test/matcher2.py` (Python; port the logic, do not call it). FluidVoice's custom dictionary (replace "heard as" with a term) is the model for aliases.

## What was built

Branch `dictionary` (seven commits from main dc58821, not pushed). The review copy is `apps/mac/release/review-dictionary/mac-arm64/Avanzel.app`; the by-hand checks are in the flight pack's "Dictionary checks".

- **Task 1 (24008c6, 35b4c6f):** `parseDictionary` and `applyDictionary` in the engine: heard-as aliases (exact, longest first) and a cautious sound-alike match. Fixed 6 of 16 mis-hearings in the study, none wrongly.
- **Task 2 (050b5d4, b855677):** `[voice] dictionary` in `config.toml`, a transcriber decorator (`withDictionary`) for thoughts, questions and calls, `Transcript.heard`, and the spelled terms as a bounded hint in the filing prompt.
- **Task 3 (d375b13, b3cedc8):** Settings → Voice has a Dictionary (one text area), saved when the field is left; a corrected thought keeps `heard:` in its capture.
- **Task 4:** the checks, the README line and this section.

Rulings that changed the plan:
1. The sound-alike default stays at 0.85. "Clawed code" is no longer a must-fix; it needs an alias line.
2. Two guards were added (the raw letters at least 0.6 alike, a sound key of at least 4 characters), and a window may span only single horizontal spaces. Ordinary words near a term (election, Electron) remain a known limit.
3. The fix round took the discriminating tests, the stop-word test and a length pre-filter for speed.
4. `[voice] dictionary_sound_alike` (default true) was added as the per-library switch.
5. Terms and aliases are cleaned to one line at the source, and the hint to the agent is capped at 100 terms and 2,000 characters.
6. The pane replaces its draft after a save only if the field still holds what was sent, so text typed while a save waits is kept.
7. Final-review fix wave: a window spelt as any listed term keeps that term (Catherine and Katherine both listed stay apart); `compileDictionary` builds the aliases and candidates once per transcriber (3,000 call segments with 500 entries in about 230 ms, was 3.4 s); the app keeps the speech model loaded across dictionary edits and applies the dictionary per use; calls are corrected by heard-as entries only (they keep no `heard` record); inbox recordings and spoken screen comments keep `heard:`; the Settings window keeps the field's draft, so a pane switch while a save waits cannot revert it; term-less lines are dropped on save; alias words join across spaces and tabs only.

Known limits: a term split across two call segments is not corrected; Edit of a thought drops `heard`; questions and calls leave no `heard` record (calls use heard-as entries only for that reason); lines of one term are merged when used, not in the field.

## Global Constraints

- The owner's words are the source of truth (`templates/AGENTS.md` rule 1). A correction changes spelling of a listed term only; the text recognised is kept in the capture as `heard:` when it differs.
- Aliases are exact whole-word matches (case-insensitive, word boundaries), longest first; they never touch a longer word that merely contains them.
- Sound-alike matching defaults: similarity `0.85`; never for a term of fewer than 4 letters; never for terms with non-Latin letters (those get aliases only); a candidate window never starts or ends with, or consists only of, a common function word (use the stop list in the prototype); the window's first sound must equal the term's; when a term's sound key is 5 characters or fewer it must be within 1 edit.
- A text with no listed term in it comes back unchanged; `applyDictionary` is deterministic.
- Dictionary size: up to 500 entries; correcting a 2,000-word text with 500 entries must take under 200 ms (test it).
- Copy: sentence case, calm, plain, no "!", no emoji, people are they/them. Windows arrange `@avanzel/ui` components only (no `className`/`style`, no raw elements); window CSS only arranges.
- Config stays backward compatible: a `config.toml` without `dictionary` reads as an empty list.
- Do not push main (D5). Work on branch `dictionary` from main.

## Review Focus

1. **A listed term rewrites ordinary words** (e.g. "Zel" matching "sale"; a short name matching "and the"). Expected: untouched; tests with neutral sentences from the study's false hits ("failed twice" must not become "FluidVoice", "holiday" not "Ollama", "press" not "Priya").
2. **A non-Latin name** (Cyrillic, Georgian, Chinese): no crash, no sound-alike, aliases still work, regex special characters in an alias ("C++ = see plus plus") are escaped.
3. **Two entries for one term, or an alias that is another entry's term**, or a line like `= foo` with no term: ignored with no throw; a duplicate does not double-replace.
4. **A corrected thought hides the original.** Expected: `heard:` in the capture front matter holds the recognised text when different, and Undo/Edit are unaffected.
5. **Calls:** segment texts are corrected, timings untouched; the transcript line count does not change.

---

## File Structure

- `packages/engine/src/core/dictionary.ts` (create): parse and apply. Pure.
- `packages/engine/src/core/config.ts`, `templates/config.toml`, `types.ts` (modify): `VoiceSettings.dictionary: string[]`, `Transcript.heard?: string`.
- `packages/engine/src/voice/index.ts` (modify): `withDictionary` decorator; `makeTranscriber` applies it when the options carry a dictionary.
- `packages/engine/src/core/prompts.ts`, `librarian.ts` (modify): the names hint.
- `apps/mac/src/main/controller.ts`, `library-info.ts`, `shared/ipc.ts`, `preload`, `main/ipc.ts` (modify): snapshot field, patch field, the capture's `heard:`.
- `apps/mac/src/renderer/settings/panes/Voice.tsx`, `settings/copy.ts` (modify): the Dictionary group.
- Tests: `packages/engine/test/core/dictionary.test.ts`, extend config/prompts/librarian tests, `apps/mac/test/*`, `apps/mac/e2e/settings.spec.ts` (or a new `dictionary.spec.ts`).

---

### Task 1: Parse and apply a dictionary (engine)

**Files:** Create `packages/engine/src/core/dictionary.ts`; test `packages/engine/test/core/dictionary.test.ts`; export from `core/index.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface DictionaryEntry { term: string; heardAs: string[] }
  export interface DictionaryResult { text: string; changed: boolean }
  export function parseDictionary(lines: readonly string[]): DictionaryEntry[]      // "Term" or "Term = heard one, heard two"
  export function applyDictionary(text: string, entries: readonly DictionaryEntry[], opts?: { soundAlike?: boolean; similarity?: number }): DictionaryResult
  ```

- [ ] **Step 1: Write the failing tests** (`dictionary.test.ts`), using the study's real recognitions as fixtures:
  - parse: `["Ollama = Alema, Polymer", "  kubectl ", "", "= foo", "Ollama = Llama"]` gives entries `Ollama` (heardAs `Alema`, `Polymer`, `Llama` merged, no duplicates) and `kubectl`; blank and term-less lines are dropped.
  - alias: "We tried a local model through Alema but it was slow." with `Ollama = Alema` becomes "…through Ollama but…"; "Alemanni" is untouched; case-insensitive ("alema"); an alias containing regex characters works.
  - sound-alike (default on): each of these recognitions is corrected with the listed term and nothing else changes (similarity 0.85 is deliberate: "Clawed code" scores only 0.80 against "Claude Code", so it needs the alias `Claude Code = Clawed code`, and a test asserts that without the alias it is left alone): "The speech model loads through onks runtime in node." → "…onnxruntime in node."; "I wrote to Nanda about the export script." → "…Nandha…"; "Dimitri will cover the weekly sync" → "Dmitri…"; "signed by Mr Kowalkzik on Tuesday" → "Kowalczyk"; "Please spell Kowalsic correctly" → "Kowalczyk".
  - precision: with the 30 terms of the study loaded (Avanzel, Zel, Parakeet, Obsidian, Claude Code, Codex, Ollama, Tbilisi, Rotterdam, Kubernetes, kubectl, TypeScript, Playwright, SQLite, GraphQL, Electron, onnxruntime, Priya, Anna Kowalski, Mark Lee, Nandha, Oksana, Dmitri, Haiku, Granola, FluidVoice, Hugging Face, Tailscale, Anthropic, Kowalczyk) these ordinary sentences come back unchanged: "The deployment failed twice yesterday because of an expired certificate.", "Noted, I'll put the holiday dates in the shared calendar.", "We should move the launch to the second week of December because the press embargo ends then.", "Can you share the draft of the announcement with the whole team by Monday?", "We need to decide between the annual plan and the monthly plan before the pricing page goes live.", "That seems slow, can we make it run in the background?".
  - no non-Latin: term "Дмитро" with alias "Дмитрий" replaces the alias, sound-alike never runs on it; a Georgian term does not throw.
  - speed: 500 generated entries on a 2,000-word text under 200 ms.
- [ ] **Step 2: Run** `npx vitest run packages/engine/test/core/dictionary.test.ts`. Expected: FAIL, nothing defined.
- [ ] **Step 3: Implement** both functions in `dictionary.ts` per the Global Constraints: tokenise into words with spans; aliases first (longest alias first, word-bounded, case-insensitive); then sound-alike over windows of `max(1, words-1)` to `words+2` words using a simple phonetic key (lower-case letters only; rewrite ph→f, ck→k, ch→k, kn→n, wr→r, gh→∅, sh→x, th→t, qu→kv, x→ks, q→k, w→v, z→s, y→i, ce/ci/cy→se/si/si, c→k, h→∅; collapse doubled letters; keep the first letter and squash vowel runs to `a`), similarity = 1 − Levenshtein(key)/maxLength; pick non-overlapping matches best-first; skip a window already equal to the term. An entry whose term has non-Latin letters takes aliases only.
- [ ] **Step 4: Run** the test file and `npm test -w @avanzel/engine`. Expected: PASS.
- [ ] **Step 5: Commit** `engine: a personal dictionary: heard-as aliases and a cautious sound-alike match`.

### Task 2: Settings, the transcriber and the filing hint (engine)

**Files:** Modify `packages/engine/src/core/config.ts`, `templates/config.toml`, `types.ts`, `voice/index.ts`, `core/prompts.ts`, `core/librarian.ts`; tests beside them.

**Interfaces:**
- Consumes: `parseDictionary`, `applyDictionary` (Task 1).
- Produces: `VoiceSettings.dictionary: string[]` (TOML `dictionary = ["Ollama = Alema, Polymer", "Kowalczyk"]` under `[voice]`, default `[]`); `Transcript.heard?: string` (set only when the dictionary changed the text); `VoiceOptions.dictionary?: string[]`; `withDictionary(inner: Transcriber, dictionary: readonly string[]): Transcriber` (corrects `transcribe` text and each `transcribeSegments` text; `heard` set on a changed `transcribe` result; segments untouched in timing); `FilePromptOptions.names?: readonly string[]`.

- [ ] **Step 1: Write the failing tests:** config round trip and a config without `dictionary` reads `[]`; the config template renders the key; `withDictionary` over a fake transcriber changes text, keeps `engine` and `seconds`, sets `heard`, corrects every segment and keeps `start`/`end`; `makeTranscriber` with `dictionary: []` returns a transcriber that behaves as before (no wrapper cost: assert identity or equal output); `filePrompt(..., { names: ["Ollama", "Kowalczyk"] })` contains one paragraph "The owner uses these names and terms. Spell them exactly this way: Ollama, Kowalczyk." (terms only, never aliases) and omits it when empty; `Librarian` passes the terms of `settings.voice.dictionary` when it files.
- [ ] **Step 2: Run** those tests. Expected: FAIL.
- [ ] **Step 3: Implement** the settings key (parse/render beside `command`), `Transcript.heard`, `withDictionary` (in `voice/index.ts`; `makeTranscriber` wraps when `dictionary` is non-empty), and the prompt note in `prompts.ts`'s `notes` list. A dictionary line longer than 200 characters or more than 500 lines is rejected by config loading with an `AvanzelError` naming the key.
- [ ] **Step 4: Run** the new tests and `npm test -w @avanzel/engine`. Expected: PASS.
- [ ] **Step 5: Commit** `engine: the dictionary in voice settings, in every transcript, and as a hint to the filing agent`.

### Task 3: The app and Settings → Voice

**Files:** Modify `apps/mac/src/main/controller.ts` (transcriberFor, the fake-transcript branch, the capture write), `library-info.ts`, `shared/ipc.ts`, `preload/index.ts`, `main/ipc.ts`, `renderer/settings/panes/Voice.tsx`, `renderer/settings/copy.ts`; tests `apps/mac/test/*`, `apps/mac/e2e/dictionary.spec.ts`.

**Interfaces:**
- Consumes: `VoiceSettings.dictionary`, `withDictionary`, `Transcript.heard`.
- Produces: `LibraryInfo.dictionary: string[]`; `setLibrary({ dictionary?: string[] })` (the existing `setLibrarySettings` patch, saved to `config.toml` through the same queued job as `harness`/`models`); a Dictionary group in Voice.

- [ ] **Step 1: Write the failing tests:** unit: `setLibrarySettings({ dictionary })` writes `[voice] dictionary` and the snapshot returns it; saving blank lines and duplicates stores them cleaned (`parseDictionary` then re-render as `Term = a, b`); `Controller`'s test-fake transcript path (`AVANZEL_FAKE_TRANSCRIPT`) also goes through the dictionary so e2e can test it; a corrected voice capture has `heard:` in its front matter and the corrected words as its body; an unchanged one has no `heard:`. e2e (`dictionary.spec.ts`, quiet project): open Settings → Voice, find the Dictionary group by its label, type `Ollama = Alema` and `Kowalczyk` on two lines, leave the field (saves on blur like the Model field in Agents), re-open the pane: still there, `config.toml` holds both; record a thought with `AVANZEL_FAKE_TRANSCRIPT="We tried a local model through Alema"`: the inbox capture reads "…through Ollama" and carries `heard: We tried a local model through Alema`.
- [ ] **Step 2: Run** the new tests (`npm test -w @avanzel/mac -- <name>`; e2e per the Test rules below). Expected: FAIL.
- [ ] **Step 3: Implement** the snapshot/patch plumbing and the pane: a `Group` labelled "Dictionary" with a `GroupRow` whose label is "Names and terms", description "One per line. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an equals sign: Ollama = Alema, Polymer.", and a `TextArea` (label "Dictionary", `labelHidden`) inside a `div` that arranges its width, saved on blur and with a failure Notice from `attemptChange` as the Model field does. Pass `dictionary` into the transcriber (`transcriberFor`) and the fake-transcript branch, and put `heard` into the capture's context when `Transcript.heard` is set.
- [ ] **Step 4: Run** the unit tests, `npm run typecheck`, `npm run design:check`, and the e2e file. Expected: PASS.
- [ ] **Step 5: Commit** `mac: Settings → Voice has a Dictionary, and what it corrects is kept as heard`.

### Task 4: The whole branch

**Files:** Modify `reports/Avanzel flight pack/2 Try it on your Mac.md` ("Dictionary checks"), `README.md` (one sentence), this plan ("What was built").

- [ ] **Step 1:** Run `npm test`, `npm run typecheck`, `npm run design:check`, and the quiet e2e for `dictionary`, `settings`, `recording`.
- [ ] **Step 2:** Write the by-hand checks: add `Kowalczyk` and `Ollama = Alema` in Settings → Voice; say a sentence with each; the capture and the filed page spell them right and the capture shows `heard:`; add a term that sounds like an ordinary word and look for wrong rewrites; a Cyrillic name with an alias.
- [ ] **Step 3: Commit** `docs: the dictionary, built, with the checks that need a person`.

---

## Self-review

- **Coverage:** aliases, sound-alike, config, transcriber (thoughts, questions, calls through one decorator), filing hint, `heard:`, pane. Not here: learning corrections from the filing agent, per-app dictionaries, a UI for sound-alike strictness (config only), refine (LLM clean-up) pass.
- **Names:** `parseDictionary`/`applyDictionary`/`withDictionary`/`DictionaryEntry`/`Transcript.heard`/`VoiceSettings.dictionary` are used identically in Tasks 1–3.
- **Proportion:** one pure module, a decorator, one settings key, one pane group.
