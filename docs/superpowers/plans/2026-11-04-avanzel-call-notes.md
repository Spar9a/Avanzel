# Call notes (basic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One menu item turns a call into a note: Avanzel hears both sides on this Mac, writes the transcript as a capture, and the person's own agent files a meeting page beside the pages they already have.

**Architecture:** The microphone ("You") is recorded by the capsule page as thoughts are, and streamed to main in blocks. The other side ("Them") comes from `avanzel-calltap`, the Swift helper in `apps/mac/native/calltap` (commit 1a5de20), which main spawns and which writes 16 kHz mono PCM to its stdout. Both streams go to files in the profile folder while the call runs. When the call ends, each stream is transcribed in speech segments with start times, the two are merged into one transcript, and a capture of source `call` is written to the inbox and filed by the existing pipeline. A call is a capture; nothing in the filing pipeline is new except a note in its prompt.

**Tech Stack:** Electron main (TypeScript), the engine's Parakeet transcriber and Silero VAD, Swift (Core Audio process tap, macOS 14.2+), vitest, Playwright.

**Spec:** `reports/Avanzel UX and first-run design.md` §6.8 (notes from your calls), §11 Phase 5. Owner's order of 4 Nov 2026: functionality first, macOS only, UI polish after. This plan is the "basic" cut of §6.8.

**Not in this plan (later, §6.8):** detecting a call by itself, calendar titles and names, telling several voices on "Them" apart, the Meetings pane in Settings, marking a moment with ⌥Space, a red dot beside Zel, keeping the audio, a local-model option. Those wait; the owner polishes the window and the card afterwards.

## What was built

Branch `call-notes`, from 37d3b54 to 4b7c410, one task per block below. The ledger with every ruling is `.superpowers/sdd/2026-11-04-avanzel-call-notes/progress.md`.

- **Task 1 (engine):** timed speech segments from the transcriber, `dropEcho`, `mergeCall` and `callTranscript`. Two streams, "You" and "Them", become one transcript.
- **Task 2 (engine):** `captureCall` writes a capture of source `call`, and the filing prompt says how to file one (a meeting page, decisions, `- [ ]` lines with owners).
- **Task 3:** `avanzel-calltap`, the Swift helper (Core Audio process tap), built as one universal binary, bundled at `Resources/calltap/`, signed with the app, with `NSAudioCaptureUsageDescription` in `Info.plist`.
- **Task 4a:** the helper's process wrapper, the list of call apps, and `CallSession`, which keeps the call's two streams in `calls/<id>/`.
- **Task 4b:** `main/call-notes.ts` with the consent dialog, the call card in the capsule, failure copy, and the controller's `calls` state.
- **Task 5:** "Take notes on a call…" in the menu bar menu with a picker of running call apps, and "Finish notes for a call that was cut short" at the next launch.
- **Task 6:** the whole-branch run, a signed review build, and the by-hand checks in the flight pack's doc 2 ("Call notes checks").

Rulings that changed the plan:
1. The helper is found at `process.resourcesPath/calltap/avanzel-calltap` when packaged and at `apps/mac/native/calltap/build/avanzel-calltap` otherwise.
2. The helper waits up to 10 s for a named app's audio object (6: only while no named pid has one, so one idle pid cannot add 10 s to every start).
3. `CallSession` writes `call.json` (app, start time) so a cut-short call can be recovered.
4. While a call runs, a thought, a screen capture and a question's dictation do not start; the capsule says "Notes on the call are running. Stop them to record a thought."
5. Task 4 was split into 4a (pieces, unit tests) and 4b (controller, renderer).
7, 9. Review fixes taken with their round: a helper that dies mid-call is told, and late sound blocks stay with their own call.
8. A call with no speech keeps its folder, marked `no-speech`, and says so; the next launch deletes marked folders older than 24 h.
10. The call menu settles after a call ends, and the spec polls conditions, not fixed waits.
11. The review build goes to `release/review-call-notes`, never into `release/mac-arm64` while the owner's Avanzel runs from it.
12. Task 6 ran only the quiet e2e specs for the areas touched, so the owner's Mac stayed usable.
13. The final review's fix wave, in one dispatch: all six Important findings, the `micError` spec regression and the cheap minors.

Final review wave (Task 7, Ruling 13):
- The helper ends by itself once every tapped pid has exited, and the call then finishes with what was heard and a short notice. A helper that fails before it started says the app wasn't playing sound yet.
- `dropEcho` leaves a whole-stream side alone, and otherwise drops a "You" segment of 3 words or more only under a "Them" segment no more than 1.5 times as long that says 60 % of its words in order. This replaces Task 1's set rule.
- `call.json` keeps `themOffsetSeconds`, and every finish (also after a launch) shifts "Them" by it. The consent text names the agent's provider. A call cut short is also offered by a menu row, its notification is held until it is finished, and an unfinished folder expires after 7 days.
- Also: no Safari, collision-free call ids, a full disk ends the call with its own problem, `NoSpeechError`, the capture's app as people know it ("Zoom"), and truer kept-folder and not-heard copy.

Build: from `apps/mac`, `env -u ELECTRON_RUN_AS_NODE sh -c 'node scripts/build.mjs && node scripts/build-calltap.mjs && npx electron-builder --mac dir -c.directories.output=release/review-call-notes && node scripts/signing.mjs sign release/review-call-notes/mac-arm64/Avanzel.app'`. It gives `apps/mac/release/review-call-notes/mac-arm64/Avanzel.app`, signed with the local identity "Avanzel Local".

Left for later, as the header says: call detection, calendar names, speaker names, the Meetings pane, and keeping the audio. Known limits: a named app is tapped only for sound that starts within 10 s of Start; a call is capped at 4 hours.

## Global Constraints

- macOS only. The helper needs macOS 14.2; on an older Mac the menu item is absent and nothing else changes.
- Every file written for a call lives under the profile folder `<userData>/calls/<call-id>/` until the capture is written, and is deleted right after a capture is written (audio is never kept, never committed). If a step fails, the files stay and the failure says so.
- A call asks first, every time, with a native dialog the first time that also explains consent: in many places everyone on a call must agree to it being recorded; some workplaces forbid recording tools; the transcript, including other people's words, goes to the person's own agent provider when filed. Avanzel never joins a call as a bot.
- Copy: sentence case, calm, plain. No "!", no "Oops", no emoji. A problem says what happened, what is safe, and offers one fix. People are they/them. Zel says "I" only in its own moments, so none of this copy does.
- Windows arrange `@avanzel/ui` components and take no `className` or `style`; this plan adds no window, only a native dialog, a native menu and the capsule's existing cards. Run `npm run design:check` after the capsule changes.
- Tests never touch the real microphone, the real helper, or a real model: `AVANZEL_FAKE_CALLTAP` (a path to a raw PCM file the fake helper emits), `AVANZEL_FAKE_AUDIO` and `AVANZEL_FAKE_TRANSCRIPT` already exist for the last two.
- Do not push main (D5). Work on branch `call-notes`.

## Review Focus

Failure modes the spec implies and no task's happy path exercises. Each has its test in the task named.

1. **The call app isn't running when a call starts** (the person picks it from the menu, then it quits). Expected: the call ends with what was heard so far, and says so. Task 4.
2. **System Audio Recording is denied.** The tap runs and delivers pure silence, with no error. Expected: after the call, "Them" is empty, and the note says that the other side wasn't heard and why, with the fix. Task 4.
3. **The other side leaks into the microphone** (speakers, no headphones), so "You" repeats what "Them" said. Expected: a "You" segment that repeats an overlapping "Them" segment is dropped. Task 1.
4. **Avanzel quits or crashes during a call.** Expected: the files stay in `calls/`, and the next launch offers to finish that call's notes. Task 5.
5. **A second call starts while one runs, or a thought is recorded during a call.** Expected: the menu offers Stop, not a second start; a thought still records (the capsule is one recorder, so the call's microphone stream pauses its card but not its file). Task 4.

---

## File Structure

- `packages/engine/src/core/calls.ts` (create): pure functions that turn two timed streams into one transcript, and drop echo. No I/O.
- `packages/engine/src/voice/parakeet.ts`, `packages/engine/src/types.ts` (modify): timed segments from the transcriber.
- `packages/engine/src/core/librarian.ts`, `prompts.ts`, `packages/engine/templates/AGENTS.md`, `packages/engine/templates/prompts/file.md` (modify): `captureCall`, and the note that tells the agent what to do with a call.
- `apps/mac/native/calltap/main.swift` (modify): several `--pid`s.
- `apps/mac/scripts/build-calltap.mjs` (create), `apps/mac/electron-builder.yml`, `apps/mac/scripts/signing.mjs`, root/app `package.json` (modify): build, bundle and sign the helper; add the permission text.
- `apps/mac/src/main/calltap.ts` (create): spawns the helper, writes its output to a file, reports its events.
- `apps/mac/src/main/call-session.ts` (create): one call's files and its finish (transcribe, merge, capture).
- `apps/mac/src/main/call-apps.ts` (create): which call apps are running, and the pids of each.
- `apps/mac/src/main/controller.ts`, `menu-model.ts`, `tray.ts`, `store.ts`, `shared/ipc.ts`, `preload/index.ts`, `renderer/capsule/*` (modify): the menu items, the consent, the microphone stream, the states.
- Tests: `packages/engine/test/core/calls.test.ts`, `apps/mac/test/call-session.test.ts`, `apps/mac/test/calltap.test.ts`, `apps/mac/test/call-apps.test.ts`, `apps/mac/e2e/call-notes.spec.ts`.

---

### Task 1: Timed segments and the merged transcript (engine)

**Files:**
- Create: `packages/engine/src/core/calls.ts`
- Modify: `packages/engine/src/types.ts`, `packages/engine/src/voice/parakeet.ts`, `packages/engine/src/voice/index.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/core/calls.test.ts`, extend the Parakeet unit test file that already covers `recognizeSegments`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export interface TimedText { start: number; end: number; text: string } // seconds from the start of the audio
  ```
  and an optional member on `Transcriber`: `transcribeSegments?(samples: Float32Array, sampleRate?: number): Promise<TimedText[]>`.
- Produces, in `calls.ts`:
  ```ts
  export type Speaker = "you" | "them";
  export interface CallLine extends TimedText { speaker: Speaker }
  export function dropEcho(you: readonly TimedText[], them: readonly TimedText[]): TimedText[];
  export function mergeCall(you: readonly TimedText[], them: readonly TimedText[]): CallLine[];
  export function callTranscript(lines: readonly CallLine[]): string;
  ```

- [ ] **Step 1: Write the failing tests** in `calls.test.ts`:
  - `mergeCall` orders by `start`, ties go to "them"; each line keeps its speaker.
  - `dropEcho`: a "you" segment is dropped when a "them" segment overlaps it by at least half its length and at least 60 % of its words (lower-cased, punctuation removed) occur in that segment; a "you" segment that overlaps but says something else stays; a "you" segment with no overlap stays.
  - `callTranscript` of `[{you,0,2,"Hi Mark"},{them,2.4,5,"Hello"}]` is exactly `"[00:00] You: Hi Mark\n\n[00:02] Them: Hello\n"`; minutes grow past 59 (`"[61:05]"`) rather than adding hours.
  - A parakeet test: `transcribeSegments` on audio over the VAD threshold returns one `TimedText` per VAD segment, `start = segment[0] / 16000`, `end = segment[1] / 16000`, empty texts dropped. Use the fake recogniser pattern the existing `recognizeSegments` test uses.
- [ ] **Step 2: Run** `npx vitest run packages/engine/test/core/calls.test.ts` from the root, and the Parakeet test. Expected: FAIL, nothing defined.
- [ ] **Step 3: Implement** `calls.ts` as above. In `parakeet.ts`, add `transcribeSegments` next to `transcribe` (same release guard and `#running` bookkeeping): under the VAD threshold it is one segment `[0, seconds]`; over it, `segmentSpeech` then `#recognize` in batches of `VAD_BATCH_SIZE`, keeping each segment's text instead of joining them. Export `TimedText` from `types.ts` and the `calls.ts` functions from `core/index.ts` and `src/index.ts`.
- [ ] **Step 4: Run** the same tests, then `npm test -w @avanzel/engine`. Expected: PASS.
- [ ] **Step 5: Commit** `engine: timed speech segments, and a call transcript merged from two streams`.

### Task 2: A call is a capture, and the agent knows what to do with it (engine)

**Files:**
- Modify: `packages/engine/src/core/librarian.ts`, `packages/engine/src/core/prompts.ts`, `packages/engine/templates/AGENTS.md`, `packages/engine/templates/prompts/file.md` (only if the note needs a new placeholder)
- Test: `packages/engine/test/core/librarian-capture.test.ts` (or the file that tests `captureScreen`), `packages/engine/test/core/prompts.test.ts`

**Interfaces:**
- Consumes: `Vault.newCapture(text, { source, context, now })`.
- Produces:
  ```ts
  export interface CallCapture {
    transcript: string;   // callTranscript(...) output
    app?: string;         // "Zoom"; omitted for "everything the Mac plays"
    title?: string;       // not set in this plan
    startedAt: Date;
    seconds: number;      // the call's length
  }
  Librarian.captureCall(call: CallCapture): Capture
  ```
  and `FilePromptOptions.call?: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `captureCall` writes `inbox/<id>.md` with front matter `source: call`, `app:` (when given), `seconds:` and `created:` from `startedAt`, and the transcript as the body, with no `audio:` and no `attachments:`. An empty transcript throws `AvanzelError` (the capture would be empty).
  - `filePrompt(..., { call: true })` contains a paragraph beginning "This capture is a call." that says, in this order: the transcript marks who spoke ("You" is the owner, "Them" is everyone else); write one meeting page, `meetings/YYYY-MM-DD-<slug>.md` (create the `meetings/` folder if it is missing and add a "Meetings" heading in `index.md`); on it put what was decided, who promised what, as `- [ ]` lines naming the owner of each; link the people by `[[wikilink]]` and update their pages, citing the capture; never write the transcript out in full on the page; say when a speaker's name is unknown rather than guessing.
  - `#fileOne` passes `call: true` when the capture's front matter has `source: call` (read how it already reads `attachments`).
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** `Librarian.captureCall` beside `captureScreen` (same `isoLocal` and context rules; `seconds` is written as a whole number). Add the `call` note to `filePrompt` using the same `notes` list as the screenshot note. Add to `templates/AGENTS.md`, under "Captures", the same paragraph in the voice of that file ("Some captures are calls: `source: call`…"), and a `meetings/` row in the layout table (create, edit). Existing libraries keep their old `AGENTS.md`, which is why the prompt note is self-contained.
- [ ] **Step 4: Run** the tests, then `npm test -w @avanzel/engine`. Expected: PASS.
- [ ] **Step 5: Commit** `engine: a call is a capture, and the filing prompt says how to file one`.

### Task 3: Build, bundle, permit and sign the helper

**Files:**
- Modify: `apps/mac/native/calltap/main.swift`, `apps/mac/electron-builder.yml`, `apps/mac/scripts/signing.mjs`, `apps/mac/package.json`, root `package.json` (only to call the new step from `npm run build`)
- Create: `apps/mac/scripts/build-calltap.mjs`

**Interfaces:**
- Produces: the binary at `apps/mac/native/calltap/build/avanzel-calltap` (git-ignored) and, in a packaged app, `Avanzel.app/Contents/Resources/calltap/avanzel-calltap`. `process.resourcesPath` is where main finds it (Task 4).
- `main.swift`: `--pid` may repeat. A pid that has no audio process object is skipped. Only when none of them has one does it fail with `no app you named is playing sound`. A process with a sound-playing helper (Chrome, Zoom) is why more than one is needed (Task 5 passes an app's main pid and its children).

- [ ] **Step 1:** Change `main.swift` for repeatable `--pid`; keep the stdout and stderr contract in its header. Update the README's usage line.
- [ ] **Step 2:** `build-calltap.mjs`: run `swiftc -O -target arm64-apple-macos14.2` and `x86_64-apple-macos14.2` into two outputs, `lipo -create` them into `build/avanzel-calltap`; on a Mac without `swiftc` print one line saying the call notes will be missing and exit 0. Add the script to `apps/mac`'s build chain before electron-builder.
- [ ] **Step 3:** In `electron-builder.yml`, add `extraResources: [{ from: native/calltap/build, to: calltap, filter: ["avanzel-calltap"] }]` and, under `mac.extendInfo`, `NSAudioCaptureUsageDescription: Avanzel listens to a call's sound only while you have asked it to take notes, and turns it into text on this Mac.`
- [ ] **Step 4:** In `signing.mjs`'s `sign(app)`, sign `Contents/Resources/calltap/avanzel-calltap` with the same identity before the app (with the hardened-runtime flag off, as the app is signed), so the bundle's seal covers it.
- [ ] **Step 5: Verify** by running `npm run build` from the root, then `codesign --verify --deep --strict apps/mac/release/mac-arm64/Avanzel.app` (no output means valid) and `apps/mac/release/mac-arm64/Avanzel.app/Contents/Resources/calltap/avanzel-calltap --seconds 1 2>&1 >/dev/null` (prints a `started` and a `stopped` line).
- [ ] **Step 6: Commit** `mac: build, bundle and sign avanzel-calltap, and ask for System Audio Recording`.

### Task 4: One call, from Start to a capture (main)

**Files:**
- Create: `apps/mac/src/main/calltap.ts`, `apps/mac/src/main/call-session.ts`, `apps/mac/src/main/call-apps.ts`
- Modify: `apps/mac/src/main/running-apps.ts` (add pids), `apps/mac/src/main/controller.ts`, `apps/mac/src/main/store.ts`, `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/renderer/capsule/recorder.ts`, `apps/mac/src/renderer/capsule/main.tsx`
- Test: `apps/mac/test/calltap.test.ts`, `apps/mac/test/call-session.test.ts`, `apps/mac/test/call-apps.test.ts`

**Interfaces:**
- `calltap.ts`:
  ```ts
  export interface TapEvent { event: "started" | "stopped" | "error"; message?: string; seconds?: number }
  export class CallTap {
    static available(): boolean;                                // macOS ≥ 14.2 and the binary exists
    constructor(opts: { pids: number[]; outFile: string; onEvent(e: TapEvent): void });
    start(): void;                                              // spawns it; stdout streams to outFile
    stop(): Promise<void>;                                      // SIGTERM, resolves when it has exited
  }
  ```
  `AVANZEL_FAKE_CALLTAP=<raw pcm path>` replaces the binary with a function that copies that file to `outFile` and emits `started` then `stopped`.
- `call-apps.ts`:
  ```ts
  export interface CallApp { name: string; pids: number[] }       // pids: the app's main process and its children
  export const CALL_APPS: readonly string[];                      // "zoom.us", "Microsoft Teams", "Slack", "FaceTime", "Discord", "Webex", "Google Chrome", "Safari", "Arc", "Microsoft Edge", "Firefox"
  export function runningCallApps(): Promise<CallApp[]>;
  ```
- `call-session.ts`:
  ```ts
  export class CallSession {
    constructor(opts: { dir: string; app: string | null; startedAt: Date });
    readonly youFile: string; readonly themFile: string;
    appendYou(samples: Float32Array): void;                     // appends 16-bit PCM to youFile
    finish(t: Transcriber, now: Date): Promise<{ transcript: string; seconds: number; themHeard: boolean }>;
  }
  ```
  `finish` reads both files, transcribes each with `transcribeSegments` (a transcriber without it gives one segment per stream), applies `dropEcho` and `mergeCall`, and returns `callTranscript(...)`. `themHeard` is false when the "them" file is empty or its peak is under 0.002 of full scale (Review Focus 2).
- Store: `AppSettings.callConsent: boolean` (default false). IPC: `capsule:call-audio` carries a block of mic samples (`api.sendCallAudio(samples: Float32Array)`), and the main-to-capsule `call` command starts or stops the capsule's recorder for a call.
- The capsule's recorder gets `drain(): Float32Array`, which returns what it holds and clears it; while a call runs the capsule page calls `sendCallAudio(recorder.drain())` every 5 s and once at the end.

- [ ] **Step 1: Write the failing tests.**
  - `calltap.test.ts`: with `AVANZEL_FAKE_CALLTAP`, `start` writes the file and emits `started` then `stopped`; `stop` after `stopped` resolves; `available()` is false when the binary is missing.
  - `call-apps.test.ts`: given the parsed `ps -axco pid,ppid,command` text, `runningCallApps` returns Zoom with its pid and its children's, in `CALL_APPS` order, and nothing for apps that don't run.
  - `call-session.test.ts`: two raw files and a fake transcriber that answers by file produce a transcript with both speakers in order (Review Focus 3: an echoed "you" line is gone); an empty or silent "them" file gives `themHeard: false`; `finish` on two empty files throws an `AvanzelError` whose message is "No speech was heard on this call."; and `finish` does not delete the files (the controller does, after the capture is written).
  - Controller tests (extend the pattern in `apps/mac/test`): `startCallNotes` with consent false asks the consent dialog (injected `dialog` double) and does nothing on "Not now"; with consent it starts a session, shows the `listening` card for mode `"call"`, and a second `startCallNotes` is refused (Review Focus 5); `stopCallNotes` writes a capture of source `call` in the inbox and removes `calls/<id>/`; when `themHeard` is false the capture's first line is "The other side of this call wasn't heard. System Audio Recording may be off for Avanzel." (Review Focus 2); when the helper reports `stopped` by itself (the app quit, Review Focus 1) the call ends with what was heard.
- [ ] **Step 2: Run** `npm test -w @avanzel/mac -- calltap call-session call-apps`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules as above, then in the controller:
  - `CapsuleMode` becomes `"dictate" | "comment" | "call"`, and the `listening` card for `"call"` uses the existing card with the words "Taking notes on the call" and the elapsed time; the file-mode switch is absent (`fileMode: null`) and no hint shows. `recorder.ts`/`main.tsx` start the microphone as for a thought but stream blocks instead of keeping them.
  - `Controller.startCallNotes(app: CallApp | "everything")` and `Controller.stopCallNotes()`. Start: check `CallTap.available()`, then `store.callConsent` (the native consent dialog, whose copy is fixed in Global Constraints; "Take notes" sets `callConsent` true, "Not now" leaves it false), then microphone permission as `readyToListen` does. Stop: stop the tap and the microphone, `CallSession.finish`, `Librarian.captureCall`, remove the session folder, then `afterCapture` exactly as a thought does (file now or tonight by the person's setting).
  - A call has no 10-minute cap: `voice.maxRecordSeconds` does not apply; it ends at 4 hours with the same path as Stop.
  - The call's failure copy, through the capsule's problem notice as dictation failures use: "The call's notes couldn't be made. The recording is safe on this Mac and nothing was changed in your library." with one button, "Try again", which runs `finish` again on the files that stayed.
- [ ] **Step 4: Run** the new tests, then `npm test -w @avanzel/mac` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `mac: take notes on a call: both sides, one capture, filed by your agent`.

### Task 5: The menu, and a call cut short

**Files:**
- Modify: `apps/mac/src/main/menu-model.ts`, `apps/mac/src/main/tray.ts`, `apps/mac/src/main/popup.ts` (only if the picker needs it), `apps/mac/src/main/controller.ts`, `apps/mac/src/main/index.ts`
- Test: extend `apps/mac/test/menu-model.test.ts`; create `apps/mac/e2e/call-notes.spec.ts`

**Interfaces:**
- `MenuInput` gains `callNotes: "off" | "ready" | "running"` (`off` when `CallTap.available()` is false or no library is open); `MenuItemModel` actions `call-notes` (starts, or opens the picker) and `call-notes-stop`.
- The picker is the native popup that `popup.ts` already builds for the microphone: one row per `runningCallApps()` entry named for the app, then "Everything this Mac plays". It is shown when more than one is possible; with none running only "Everything this Mac plays" is offered, in the same popup.

- [ ] **Step 1: Write the failing tests.**
  - Menu: with `callNotes: "ready"` the menu has "Take notes on a call…" under "Capture screen with a comment"; with `"running"` it shows "Stop taking notes" (and no second start item); with `"off"` neither shows.
  - e2e (`call-notes.spec.ts`, project `quiet`): with `AVANZEL_FAKE_CALLTAP` set to a short spoken wav converted to raw PCM, `AVANZEL_FAKE_AUDIO` and `AVANZEL_FAKE_TRANSCRIPT` set, `callConsent` pre-set true: choose "Take notes on a call…" then "Everything this Mac plays"; the capsule shows "Taking notes on the call"; choose "Stop taking notes"; an inbox capture appears with `source: call`. A second run with `callConsent` false shows the consent dialog's two buttons (answered through the same dialog double the permission specs use) and writes nothing on "Not now".
  - Cut short (Review Focus 4): a unit test of `Controller.recoverCalls()` with a leftover `calls/<id>/` folder holding a "you" file and a "them" file: it returns that call's id and app, and a notification offers "Finish notes for a call that was cut short"; choosing it runs `finish` and writes the capture; folders with no audio in them are removed quietly.
- [ ] **Step 2: Run** the three test files (`-- --project=quiet e2e/call-notes.spec.ts` for the e2e). Expected: FAIL.
- [ ] **Step 3: Implement** the menu items and actions, the picker, and `recoverCalls()` called once at launch after the library opens.
- [ ] **Step 4: Run** the tests again, `npm test`, `npm run design:check`. Expected: PASS.
- [ ] **Step 5: Commit** `mac: Take notes on a call in the menu, and finishing a call that was cut short`.

### Task 6: The whole branch, and what only a person can check

**Files:**
- Modify: `reports/Avanzel flight pack/2 Try it on your Mac.md` (add "Call notes checks"), `README.md` (one paragraph), `docs/superpowers/plans/2026-11-04-avanzel-call-notes.md` (say what was built)

- [ ] **Step 1: Run** `npm test`, `npm run typecheck`, `npm run design:check`, and the quiet e2e for `call-notes`, `menu-bar`, `capsule-*`, `app`. Expected: all pass.
- [ ] **Step 2: Build** with `npm run build` and verify the signed bundle as in Task 3 Step 5.
- [ ] **Step 3: Write the by-hand checks** for the owner in doc 2 ("Call notes checks"): macOS shows the System Audio Recording prompt for Avanzel on the first call; allow it, relaunch if macOS asks; a Zoom or Meet call with a colleague, then Stop: the meeting page appears under `meetings/` with decisions and `- [ ]` lines; the same with headphones off to see the echo rule work; a call from Chrome (the helper pids of Chrome's audio process); a Bluetooth headset; quitting Avanzel in the middle of a call and the offer at the next launch; denying the permission and seeing the "other side wasn't heard" line.
- [ ] **Step 4: Commit** `docs: call notes, built, with the checks that need a person`.

---

## Self-review

- **Spec coverage (§6.8, basic cut):** capture of both sides (Tasks 3, 4), local transcription (1, 4), who said what by stream (1), meeting page and people updates by the agent (2), consent and law text (4, Global Constraints), off by default and asked each time (4), no audio kept (4), provider-sees-transcript line (4's dialog copy). Left out and listed at the top: detection, calendar, diarisation, panel, moment marking, Meetings pane.
- **Names:** `TimedText`, `CallLine`, `mergeCall`, `callTranscript`, `dropEcho` (Task 1) are the ones Tasks 2 and 4 use; `captureCall`/`CallCapture` (Task 2) is what Task 4 calls; `CallTap`, `CallApp`, `CallSession` (Task 4) are what Task 5 calls.
- **Proportion:** six tasks, each with its own tests. The riskiest facts (the tap, per-app capture, the model reading it) were proved in the spike (1a5de20). The one fact still unproven is the permission prompt from the signed app; Task 3 Step 5 and Task 6 Step 3 are where it is first seen.
