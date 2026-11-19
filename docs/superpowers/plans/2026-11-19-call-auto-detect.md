# Notice a call and offer notes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an app other than Avanzel holds the microphone for 5 s, the capsule asks whether to take notes on the call. Before that, call capture is fixed so these notes come out right: AirPods speed, USB headsets, and the microphone dropping mid-call.

**Architecture:**
- `avanzel-calltap` gets a `--watch-mic` mode. It polls Core Audio's per-process "is running input" flag and prints who holds the microphone as JSON lines.
- `MicWatch` (main) runs that mode. `CallOffer`, a pure decider in main, turns the holders into "ask about this app now".
- The controller shows a `call-offer` capsule bar, and answers it with the existing `startCallNotes`.
- The other side of a call is always the global tap, excluding Avanzel's own processes. The which-app picker is deleted.

**Tech Stack:** Swift 6 (CoreAudio, AVFoundation, AppKit) single-file helper, Electron 44 main (TypeScript, Node type stripping), React capsule and panel with `@avanzel/ui`, vitest, Playwright e2e (quiet project).

**Spec:** `docs/superpowers/specs/2026-11-19-call-auto-detect-design.md`. Read it before any task.

## Global Constraints

- **Working directory.** Every command runs in `/Users/aksimemor/git-reps/avanzel/.claude/worktrees/call-auto-detect`. Start every Bash command with `cd` into it.
- **No changes to protected files.** Never change `packages/ui/tokens/`, screenshot baselines (`npm run ui:approve`), `packages/ui/checks/` or `.claude/settings.json`. If a screenshot changes, say so in the report. The owner approves it.
- **Interface rules.**
  - Windows use `@avanzel/ui` components only: no raw `<button>`, `<svg>` or `<a>`.
  - No `className` or `style` on components.
  - Window CSS only arranges.
  - Read `packages/ui/DESIGN.md` before touching `apps/mac/src/renderer/**`.
  - `npm run design:check -- --changed` must pass.
- **Copy.** Sentence case, calm, no "!", no emoji. The exact strings are given in the tasks. Use them verbatim.
- **Values from the spec.**
  - Hold before asking: `5_000` ms.
  - A gap that doesn't break the hold: under `1_000` ms.
  - "Lets go": gone for `10_000` ms.
  - The question shows for `30_000` ms.
  - Microphone reopen deadline before the notice: `3_000` ms.
- **macOS floor.** The helper is built for `macos14.2` (see `apps/mac/scripts/build-calltap.mjs`). Keep it.
- **Electron launches.** `ELECTRON_RUN_AS_NODE` is set in this shell. Unset it for every Electron launch: `env -u ELECTRON_RUN_AS_NODE npx playwright test …`. The `npm run e2e*` scripts already call the build. Use `caffeinate -i` for e2e runs.
- **Commit messages.** Follow the repo's style: `mac: <plain sentence of what changed for the person>` or `calltap: …`. Never push.
- **Comments.** Follow the repo's comment style: a doc comment on each exported symbol, saying why, in plain sentences.

## Review Focus

1. **Avanzel dictates (Right Option) while Zoom already holds the microphone.** Nothing is asked about Avanzel. Zoom is asked about once the capsule is free again. Pinned in Task 6 ("waits for a free capsule") and Task 7 (e2e).
2. **An AirPod is taken out during the 5 s hold, or after Not now.** The app drops the input for under a second, or for a few seconds. Nothing new is asked, and the hold isn't reset by a gap under 1 s. Pinned in Task 6 ("a blip", "a short release keeps No").
3. **Stop is pressed while the call app still holds the microphone.** Nothing is asked afterwards. Pinned in Task 6 ("present during a call counts as answered").
4. **The watch helper is missing, can't start, or keeps dying** (a dev build without swiftc, an old macOS). The app works and never asks, with no crash loop and no error card. Pinned in Task 5 (restart cap) and Task 8 (not started when unavailable).
5. **The only microphone is unplugged mid-call.** The call goes on with the other side only, one notice says so, and the notes are still made at Stop. Pinned in Task 4.

---

### Task 1: `avanzel-calltap --watch-mic` (go/no-go spike)

**Files:**
- Modify: `apps/mac/native/calltap/main.swift`. Argument parsing is at lines ~37–47. The watch block goes after `audioProcesses` (~line 59–66) and before `// The tap:` (~line 69).
- Modify: `apps/mac/native/calltap/README.md`.

**Interfaces:**
- Produces a stderr JSON line, the first one at start and then one each time the set changes:

  ```
  {"event":"mic","holders":[{"pid":1234,"bundle":"com.google.Chrome.helper","appPid":1200,"app":"Google Chrome","path":"/Applications/Google Chrome.app"}]}
  ```

  - `holders` is sorted by `pid`.
  - `bundle`, `appPid`, `app` and `path` are JSON `null` when unknown.
  - `appPid` is the **outermost** ancestor of `pid` (walking `ppid` up to, not including, pid 1) that `NSRunningApplication(processIdentifier:)` knows, with a `bundleURL` whose path ends in `.app`. Its own pid counts.
  - `app` is that app's `localizedName`, and `path` is its `bundleURL.path`.
- Runs until SIGINT or SIGTERM, then prints `{"event":"stopped"}` and exits 0. It creates no tap or device, and opens nothing.

Verified in source this session:
- `property(_:_:as:)` helper: main.swift:51.
- `kAudioHardwarePropertyTranslatePIDToProcessObject` use: main.swift:62.
- The signal sources pattern: main.swift:152–157.
- `dispatchMain()`: main.swift last line.
- In the macOS SDK `AudioHardware.h`: `kAudioHardwarePropertyProcessObjectList` ('prs#'), `kAudioProcessPropertyPID` ('ppid'), `kAudioProcessPropertyBundleID` ('pbid') and `kAudioProcessPropertyIsRunningInput` ('piri').

- [ ] **Step 1: Add `--watch-mic` to the argument loop** (`case "--watch-mic": watchMic = true`, with `var watchMic = false` beside `pids`).

- [ ] **Step 2: Implement the watch block.**
  - It sits after `audioProcesses` and before `// The tap:`, and starts with `if watchMic { … dispatchMain() }`, so the tap code never runs in this mode.
  - Add `import AppKit`.
  - Read `kAudioHardwarePropertyProcessObjectList` (an array of `AudioObjectID`, sized with `AudioObjectGetPropertyDataSize`).
  - For each object, read `kAudioProcessPropertyIsRunningInput` (`UInt32`), and for those that are non-zero, `kAudioProcessPropertyPID` (`pid_t`) and `kAudioProcessPropertyBundleID` (`CFString`, read the way main.swift:96–101 reads the device UID).
  - Get the parent pid with `proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))` and `info.pbi_ppid`. It lives in Darwin's libproc. If it doesn't compile, read `kinfo_proc` through `sysctl([CTL_KERN, KERN_PROC, KERN_PROC_PID, pid])` instead.
  - Poll on a `DispatchSourceTimer` on `.main` every 1 s, and print only when the encoded holders differ from the last print.
  - **The plan's call:** this polls rather than registering property listeners. The 5 s hold makes 1 s latency fine, and polling has no listener bookkeeping to get wrong.
  - The SIGINT/SIGTERM sources print `{"event":"stopped"}` and `exit(0)`.

- [ ] **Step 3: Build.** Run `node apps/mac/scripts/build-calltap.mjs`. It must end with `Built …/avanzel-calltap (arm64 and x86_64).`

- [ ] **Step 4: Check on this Mac.**
  - Run `apps/mac/native/calltap/build/avanzel-calltap --watch-mic` in the background, writing stderr to a file.
  - While it runs, record 4 s with a process that opens the microphone: `swift -e 'import AVFoundation; let e = AVAudioEngine(); _ = e.inputNode.outputFormat(forBus: 0); try! e.start(); sleep(4)'`. The `swift` interpreter is enough.
  - Then send SIGTERM.
  - **Expected:**
    - The first line is a `mic` line.
    - A later line lists a holder whose `pid` is the recording process.
    - A line after that drops it.
    - The last line is `{"event":"stopped"}`.
    - No macOS permission prompt for the watcher itself. The recording process may prompt for the Microphone.
  - If this shell can't get microphone access, say so in the report and leave the check to Step 6.

- [ ] **Step 5: Document `--watch-mic` in `README.md`,** with the line format above and "needs no permission" (or what Step 4 found). Commit:

```bash
git add apps/mac/native/calltap/main.swift apps/mac/native/calltap/README.md
git commit -m "calltap: --watch-mic says which apps hold the microphone, from Core Audio, without opening anything"
```

- [ ] **Step 6: Human checkpoint (the controller asks the owner; the implementer stops here).**
  - The owner runs the binary with `--watch-mic` in Terminal and joins a Google Meet in Chrome, then a FaceTime or Zoom call.
  - The controller records which `pid`/`bundle`/`app` each showed, and which process Avanzel's own dictation shows as (owner presses Right Option in their installed Avanzel).
  - **Go:** browsers and call apps appear with the right `app`.
  - **No-go:** a permission prompt for the watcher, or a call app that never appears. Stop the plan and report to the owner.
  - **If FaceTime appears only as a daemon** (`app: null`, a bundle such as `com.apple.avconferenced`), the controller adds that bundle to Task 6's `DAEMON_APPS` with the app name the owner saw. Only bundles seen here go in.

### Task 2: calltap capture fixes (speed, USB headsets, Avanzel's own sound)

**Files:**
- Modify: `apps/mac/native/calltap/main.swift`. The tap description is at ~lines 69–84, the aggregate anchor at ~94–112, the converter at ~114–118, and the IOProc at ~125–140.
- Modify: `apps/mac/native/calltap/README.md`.

**Interfaces:**
- Produces a new repeatable flag, `--exclude <pid>`, used with no `--pid`. The global tap becomes `CATapDescription(stereoGlobalTapButExcludeProcesses: audioProcesses(excluded))`. Pids with no audio object are skipped silently.
- The `started` line's `sampleRate` is now the rate the converter actually uses.

- [ ] **Step 1: Parse `--exclude`** the way `--pid` is parsed, into `var excluded: [pid_t] = []`. Use it in the `else` branch of the tap description.

- [ ] **Step 2: Anchor on the built-in output.**
  - Add `func builtInOutput() -> AudioObjectID?`. It goes through `kAudioHardwarePropertyDevices` and returns the first device whose `kAudioDevicePropertyTransportType` is `kAudioDeviceTransportTypeBuiltIn` and that has output streams (`kAudioDevicePropertyStreams` in `kAudioObjectPropertyScopeOutput` has a non-zero data size).
  - Use it for `output`. Fall back to `kAudioHardwarePropertyDefaultSystemOutputDevice` only when it returns nil.
  - Update the comment at ~line 94 to say why: AirPods change rate (24 kHz in call mode, 48 kHz otherwise). The aggregate's clock follows its main sub-device, and the tap hears every app whatever device it plays on.

- [ ] **Step 3: Build the converter from the aggregate's real rate.**
  - After `AudioHardwareCreateAggregateDevice`, read the aggregate's `kAudioDevicePropertyNominalSampleRate` (`Float64`).
  - If it is valid and differs from `format.mSampleRate`, set `format.mSampleRate` to it before `AVAudioFormat(streamDescription:)`.
  - Report that rate in `started`.

- [ ] **Step 4: Take the tap's buffer only.**
  - In the IOProc, wrap `input` with `UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))`.
  - When it has more than one buffer, build a local one-buffer `AudioBufferList` holding the **last** buffer (the tap's), and pass a pointer to it to `AVAudioPCMBuffer(pcmFormat:bufferListNoCopy:deallocator:)`.
  - Keep the local list alive for the whole `convert` call by doing the work inside `withUnsafeMutablePointer`.

- [ ] **Step 5: Build and check the rate.** Run `node apps/mac/scripts/build-calltap.mjs`. Then, in a scratch dir under `/tmp`:
  - Write a 5 s 1000 Hz sine WAV (48 kHz) with a short Node script.
  - Run `apps/mac/native/calltap/build/avanzel-calltap --seconds 4 > tone.raw` while `afplay` plays it.
  - Count zero crossings in `tone.raw` (s16le, 16 kHz).
  - **Expected:** about 2000 crossings per second (1000 Hz ±2 %), and the file is about 4 s long (128 000 bytes ±10 %).
  - If a second clock device is available (BlackHole 2ch or Muse Audio Share, see `audio devices` in System Settings), repeat with it as the system output. The same numbers are expected.
  - If this shell lacks System Audio Recording permission, the helper prints an error line. Report that, and leave the check to the owner's review build.

- [ ] **Step 6: Update the README** (the anchor, `--exclude`, the last-buffer rule, and what Step 5 measured). Commit:

```bash
git add apps/mac/native/calltap/main.swift apps/mac/native/calltap/README.md
git commit -m "calltap: the other side of a call keeps its speed when AirPods change rate, a USB headset's call is heard, and Avanzel's own sound can be left out"
```

### Task 3: The picker goes; a call always taps everything but Avanzel

**Files:**
- Modify: `apps/mac/src/main/calltap.ts`. In the constructor opts, `pids` becomes `exclude`. The `spawn` args are at ~line 109.
- Modify: `apps/mac/src/main/call-notes.ts`:
  - `import type { CallApp }` (line 10) goes.
  - `CallHost.newTap` opts.
  - `start(app)` (~line 213).
  - `app: app === "everything" ? null : app.name`.
  - The `pids: app === "everything" ? [] : app.pids`.
- Modify: `apps/mac/src/main/controller.ts`:
  - The `call-apps.ts` import (line 143).
  - `startCallNotes` (~2770).
  - `callHost` (`newTap`, `captureCall`, `offerCutShort`: drop `callAppLabel`).
  - `pickCall` (~2881–2887).
  - The `call` shortcut at ~line 1003.
  - The panel action block `call-notes:` (~5598–5604).
  - `panelCallChoices` and `panelCallApps` (~6136–6147).
- Modify: `apps/mac/src/main/ipc.ts:64`: delete `panel:call-apps`.
- Modify: `apps/mac/src/preload/index.ts:168,173`: delete `callApps` and `onPickCall`.
- Modify: `apps/mac/src/shared/ipc.ts:1631`, plus the `onPickCall` declaration beside it.
- Modify: `apps/mac/src/renderer/panel/main.tsx`:
  - The `Capture` call state (~269–282).
  - The tile (~387–411).
  - Its doc comment (~250–254).
- Delete: `apps/mac/src/main/call-apps.ts`, `apps/mac/test/call-apps.test.ts`.
- Test: `apps/mac/test/calltap.test.ts`, `apps/mac/test/call-notes.test.ts`, `apps/mac/e2e/call-notes.spec.ts`.

**Interfaces:**
- `new CallTap({ exclude: number[]; outFile: string; onEvent(e: TapEvent): void })`. It spawns `avanzel-calltap --exclude <pid>…`.
- `CallNotes.start(app: string | null = null): Promise<boolean>`. `app` is the name people know ("Zoom"), which goes to the session and the capture's `app:` unchanged.
- `CallHost.ownPids(): number[]`: Avanzel's processes. In the controller: `[process.pid, ...app.getAppMetrics().map((m) => m.pid)]`, de-duplicated.
- `CallHost.newTap(opts: { exclude: number[]; outFile: string; onEvent(e: TapEvent): void }): Tap`.
- `Controller.startCallNotes(app: string | null = null): Promise<boolean>`.
- The panel action `"call-notes"` (exact match) starts a call. `"call-notes-stop"` is unchanged.

- [ ] **Step 1: Update the unit tests first.**
  - In `call-notes.test.ts`:
    - Replace `const zoom = { name: "zoom.us", pids: [101, 102] }` and its uses with `"Zoom"`, and `start("everything")` with `start()`.
    - The fake host gains `ownPids: () => [7, 8]`.
    - The test at ~line 198 now reads "with consent, starts the tap on everything but Avanzel's own processes …" and asserts `t.taps[0]!.opts.exclude` equals `[7, 8]`.
    - Any assertion on the capture's or session's `app` expects `"Zoom"`.
  - In `calltap.test.ts`, every `new CallTap({ pids: [1], … })` becomes `new CallTap({ exclude: [1], … })`. Add a test with a `script(...)` helper that echoes `"$@"` to a file and asserts the args are `--exclude 1 --exclude 2`.
  - Delete `call-apps.test.ts`.

- [ ] **Step 2: Run them to see them fail.** Run `cd apps/mac && npx vitest run test/call-notes.test.ts test/calltap.test.ts`. **Expected:** type or assertion failures on `exclude`, `ownPids` and `start()`.

- [ ] **Step 3: Implement the interfaces above.**
  - Delete `call-apps.ts`.
  - The `call` shortcut becomes `this.calls.phase === "running" ? this.stopCallNotes() : this.callNotesOffer() === "ready" ? this.startCallNotes() : undefined`.
  - `"call-notes"` is already in `PANEL_ACTIONS` (controller.ts:237). `menuAction` maps it to `this.pickCall()` (controller.ts:1080); make that `this.startCallNotes()`.
  - Delete the `call-notes:` prefix block (~5598–5604).
  - Check that the panel's generic path hides the panel before `menuAction` for `"call-notes"`. If it doesn't, hide it first, as the old block did with `this.hidePanel()`.
  - In the panel, the tile drops `open`, `choices`, `askCall`, `callApps`, `openCalls` and `pickCall`. Its `onClick` is `() => act("call-notes")` when not running.
  - **The plan's call:** the label stays "Take notes on a call…". The consent dialog can still follow, and keeping the label leaves screenshots and e2e names alone.
  - Update the doc comments that mention the list of call apps.

- [ ] **Step 4: Run the unit tests and typecheck.** Run `cd apps/mac && npx vitest run && npm run typecheck`. **Expected:** both pass.

- [ ] **Step 5: Update e2e.**
  - In `call-notes.spec.ts`, `takeNotes` clicks the tile and expects no choices: delete the `choices` lines.
  - Rename the first test to "Take notes on a call…: the call's card, what it refuses meanwhile, and Stop files one call capture", and fix the header comment's "its list of calls".
  - Run `cd apps/mac && caffeinate -i env -u ELECTRON_RUN_AS_NODE npm run e2e -- e2e/call-notes.spec.ts`. **Expected:** pass.

- [ ] **Step 6: Run `npm run design:check -- --changed`, then commit:**

```bash
git add -A apps/mac
git commit -m "mac: Take notes on a call starts at once and hears everything this Mac plays but Avanzel itself; the list of call apps is gone"
```

### Task 4: The call's microphone comes back after a change

**Files:**
- Modify: `apps/mac/src/renderer/capsule/recorder.ts`: `start`, a new private `reopen`, and `release`.
- Modify: `apps/mac/src/renderer/capsule/main.tsx`: the `call-start` branch (~441–451).
- Modify: `apps/mac/src/preload/index.ts` (capsule api, beside `stopCall` at line 27), `apps/mac/src/shared/ipc.ts` (capsule api, beside `stopCall(): void` at ~1273), and `apps/mac/src/main/ipc.ts` (beside `capsule:stop-call`, line 20).
- Modify: `apps/mac/src/main/controller.ts`: a `callMicLost(sender)` beside `stopCall` (~2797).
- Modify: `apps/mac/src/main/call-notes.ts`: export the line.
- Test: `apps/mac/test/recorder.test.ts`.

**Interfaces:**
- `Recorder.start(deviceId: string | null, keep?: { lost(): void }): Promise<void>`. With `keep`, the microphone is reopened after a change, and `keep.lost()` is called once per loss that lasts `3_000` ms without a microphone.
- `export const MIC_LOST_LINE = "Your microphone stopped. The call so far is safe, and the notes go on with the other side until it's back.";` in `call-notes.ts`.
- Capsule api: `callMicLost(): void` → `ipcRenderer.send("capsule:call-mic-lost")` → `controller.callMicLost(e.sender)`. That calls `this.notify(MIC_LOST_LINE, "")` only when `isPageOf(sender, this.capsule)` and a call runs.

The algorithm, for an implementer:
- On `start` with `keep`, listen to each track's `ended`, and to `navigator.mediaDevices`' `devicechange`.
- On `devicechange`, call `enumerateDevices()`. If the track has ended, or its `getSettings().deviceId` isn't among the `audioinput` devices, reopen.
- Reopen means `getUserMedia` with the chosen `deviceId` if it is listed, else with no `deviceId`. Then create a new `MediaStreamSource` on the **same** `AudioContext`, and connect it to the **same** worklet node. Only then disconnect the old source and stop its tracks.
- The old ended source stays connected until the new one is. The worklet posts only when it has input (`capture-worklet.js`), and an ended track still feeds it zeros. So the gap is silence, and the two streams stay aligned.
- A failed reopen waits for the next `devicechange`.
- One `setTimeout(3_000)` per loss calls `keep.lost()` if no reopen has succeeded by then.
- A `generation` change (stop or cancel) ends all of this. Remove the listeners in `release`.

- [ ] **Step 1: Write the failing tests** in `recorder.test.ts`.
  - Extend `fakeMedia()` with:
    - tracks that have `addEventListener("ended")` and `getSettings()`;
    - `mediaDevices.addEventListener("devicechange")` and `enumerateDevices()`;
    - a list of the sources made and connected or disconnected.
  - Tests:
    - **`"a call's microphone that ends is opened again, and what it hears goes on into the same recording"`.** Start with `keep`, hear `[1]`, end the track, open, hear `[2]`. `stop()` gives `[1, 2]`. The old track is stopped, and `getUserMedia` was called twice.
    - **`"a chosen microphone that goes away is replaced by the default one"`.** `devicechange` with the chosen id missing. The second `getUserMedia` has no `deviceId`.
    - **`"no microphone for 3 s calls lost once, and a new device brings it back"`.** Use `vi.useFakeTimers()`, with `getUserMedia` rejecting. After 3 000 ms, `lost` was called once. Make `getUserMedia` resolve, fire `devicechange`, and the recording goes on. `lost` is still at 1.
    - **`"without keep, nothing is reopened"`** (thoughts and dictation are unchanged).
    - **`"a stop while reopening lets go of what opens after"`.**

- [ ] **Step 2: Run them to see them fail.** Run `cd apps/mac && npx vitest run test/recorder.test.ts`. **Expected:** the new tests fail.

- [ ] **Step 3: Implement it in `recorder.ts`.** In `main.tsx`'s `call-start` branch, pass `{ lost: () => api.callMicLost() }`. Add the IPC as in Interfaces.

- [ ] **Step 4: Run `cd apps/mac && npx vitest run && npm run typecheck`.** **Expected:** pass.

- [ ] **Step 5: Commit:**

```bash
git add -A apps/mac
git commit -m "mac: a call's microphone opens again when it changes or goes away, and says so when none comes back, while the notes go on"
```

### Task 5: `MicWatch`, the watch helper in main

**Files:**
- Create: `apps/mac/src/main/mic-watch.ts`. Mirror `calltap.ts`: `CallTap.binaryPath`, its stderr line parsing (~lines 128–155), and `terminate()`.
- Test: `apps/mac/test/mic-watch.test.ts`. Mirror `calltap.test.ts`'s `script()` helper and `binaryPath` override.

**Interfaces:**
- ```ts
  export interface MicHolder { pid: number; bundle: string | null; appPid: number | null; app: string | null; path: string | null }
  export function parseMicLine(line: string): MicHolder[] | null
  ```
  `parseMicLine` returns the holders of a `mic` line. It returns null for any other line, bad JSON, or a holder without a numeric `pid`. Non-string or non-number fields become `null`.
- ```ts
  export class MicWatch {
    constructor(opts: { onHolders(holders: MicHolder[]): void; binaryPath?: () => string; restartMs?: number; maxRestarts?: number })
    start(): void
    stop(): Promise<void>
    get running(): boolean
  }
  ```
  - It spawns `binaryPath()` (default `CallTap.binaryPath()`) with `["--watch-mic"]`.
  - It restarts after `restartMs` (default `5_000`) when the helper exits by itself. After `maxRestarts` (default `5`) exits within 10 minutes it gives up, with one `console.warn`.
  - On an exit it first calls `onHolders([])`, so nothing is thought to still hold the microphone.
  - `stop()` sends SIGTERM (SIGKILL after 3 s, as `CallTap.terminate`), stops restarting, and resolves on close.

- [ ] **Step 1: Write the failing tests:**
  - `parseMicLine` on a full line, on nulls, on `{"event":"stopped"}` (→ null), and on garbage (→ null).
  - **`"MicWatch passes on each mic line"`:** a script that prints two `mic` lines to stderr and sleeps.
  - **`"MicWatch restarts a helper that exits, with no holders meanwhile"`:** `restartMs: 50`, a script that prints one line and exits. `onHolders` sees the holders, then `[]`, then the holders again.
  - **`"MicWatch gives up after maxRestarts"`:** `maxRestarts: 2`, `restartMs: 10`. The spawn count stops at 3. Count spawns via a file the script appends to.
  - **`"stop() ends the helper and it isn't started again"`.**

- [ ] **Step 2: Run `cd apps/mac && npx vitest run test/mic-watch.test.ts`.** **Expected:** fail (no module).

- [ ] **Step 3: Implement `mic-watch.ts`.**

- [ ] **Step 4: Run the tests, then `npm run typecheck`.** **Expected:** pass.

- [ ] **Step 5: Commit:**

```bash
git add apps/mac/src/main/mic-watch.ts apps/mac/test/mic-watch.test.ts
git commit -m "mac: a watcher in main hears from avanzel-calltap which apps hold the microphone, and starts it again if it stops"
```

### Task 6: `CallOffer`, deciding when to ask

**Files:**
- Create: `apps/mac/src/main/call-offer.ts`.
- Test: `apps/mac/test/call-offer.test.ts`, using `vi.useFakeTimers()`.

**Interfaces:**
- ```ts
  import type { MicHolder } from "./mic-watch.ts";
  export const HOLD_MS = 5_000, BLIP_MS = 1_000, RELEASE_MS = 10_000;
  /** Daemons that stand for an app, from the Task 1 check only (bundle → the app's name). */
  export const DAEMON_APPS: Readonly<Record<string, string>> = {};
  export interface OfferedApp { pid: number; name: string; path: string | null }
  export interface OfferHost {
    ownPids(): ReadonlySet<number>;
    canAsk(): boolean;      // setting on, library open, call notes could start, capsule hidden
    callRunning(): boolean; // a call is running or ending (CallNotes.phase !== "idle")
    ask(app: OfferedApp): void;
    withdraw(): void;       // the asked app let go of the microphone while the question shows
    take(app: OfferedApp): void;
  }
  export class CallOffer {
    constructor(host: OfferHost)
    holders(list: readonly MicHolder[]): void
    recheck(): void
    answer(take: boolean): void
    gaveWay(): void
    dispose(): void
    get asking(): OfferedApp | null
  }
  ```

The rules:
- **Which holders count.** A holder counts when its `pid` and its `appPid` are not in `ownPids()`, and it has an `app`. Its key is its `appPid`. A holder with `app: null` counts only if its `bundle` is in `DAEMON_APPS`, keyed by `-pid`, with the name from the map. Several holders of one app are one entry.
- **Each entry** holds `{ app: OfferedApp; since: number; goneAt: number | null; answered: boolean }`, in insertion order.
- **On `holders`.** A present entry with `goneAt` set: if gone for `BLIP_MS` or more, set `since = now`. In every case clear `goneAt`. An entry no longer present gets `goneAt = now` (if not already set), and is deleted `RELEASE_MS` after that unless it comes back. On deletion, if it is the one asked, clear `asking` and call `host.withdraw()`.
- **On every `holders` and `recheck`.**
  - If `host.callRunning()`, mark every present entry answered. If one is being asked, clear `asking` and call `host.withdraw()`.
  - Else, if nothing is asked and `host.canAsk()`, ask about the first present, unanswered entry held for `HOLD_MS` or more: set `asking` to it, then call `host.ask(app)`.
  - Schedule a `recheck` for when the next unanswered entry reaches `HOLD_MS`.
- **`answer(true)`.** Marks the entry answered, clears `asking`, then calls `host.take(app)`.
- **`answer(false)`.** Marks it answered and clears `asking` (Not now, or the 30 s ran out).
- **`gaveWay()`.** Clears `asking` and leaves the entry unanswered: it is asked again on a later `recheck`.
- **Re-entrancy.** All of these do nothing when nothing is asked. `asking` is always cleared **before** any host call.
- **Time.** Use `Date.now()` and `setTimeout`. Fake timers drive both.

- [ ] **Step 1: Write the failing tests.** Use a host with flags, and call logs for `ask`, `withdraw` and `take`. Each test name says what it pins:
  - `"asks about an app that holds the microphone for 5 s, and not before"`: at 4 999 ms there is no ask, and at 5 000 ms `ask({ pid: 1200, name: "Google Chrome", path: … })` comes once.
  - `"never asks about Avanzel's own processes"`: the holder pid is in `ownPids`, and so is the `appPid`.
  - `"never asks about a daemon that isn't in DAEMON_APPS"`.
  - `"a blip under 1 s doesn't restart the hold"`: held 3 s, gone 500 ms, back. The ask comes at 5 s from the first sight.
  - `"a gap of 1 s or more restarts the hold"`.
  - `"Not now lasts until the app has let go for 10 s"`: answer(false). A gap of 9 s, then back: no ask. Gone 10 s, then back for 5 s: ask.
  - `"present during a call counts as answered"`: `callRunning` true while the holder is there, then false (Stop). `recheck` doesn't ask.
  - `"a call that starts while asking withdraws the question"`.
  - `"waits for a free capsule, then asks"`: `canAsk` false at 5 s. Then true, and `recheck` asks.
  - `"gaveWay asks again later; answer(false) does not"`.
  - `"Take notes hands the app to take, once"`.
  - `"an app that lets go while asked withdraws the question after 10 s"`.
  - `"two apps: the first past 5 s is asked about, one question at a time"`.

- [ ] **Step 2: Run `cd apps/mac && npx vitest run test/call-offer.test.ts`.** **Expected:** fail.

- [ ] **Step 3: Implement `call-offer.ts`.**

- [ ] **Step 4: Run the tests and `npm run typecheck`.** **Expected:** pass.

- [ ] **Step 5: Commit:**

```bash
git add apps/mac/src/main/call-offer.ts apps/mac/test/call-offer.test.ts
git commit -m "mac: when an app has held the microphone for 5 s, and nothing else is on the capsule, it is time to offer call notes"
```

### Task 7: The question in the capsule, wired to the offer

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`: the `CapsuleState` union (~line 475, after `dictation-sent`), and the capsule api (beside `stopCall`).
- Modify: `apps/mac/src/shared/transcribing.ts`: the line, beside `dictationSentLine` (line 92).
- Modify: `apps/mac/src/renderer/capsule/main.tsx`: a `callOfferScene`, mirroring `dictationSentScene` (~lines 110–124), and its `case` in `sceneOf`.
- Modify: `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`.
- Modify: `apps/mac/src/main/controller.ts`:
  - The `CallOffer` field and construction beside `this.calls` (~line 761).
  - `setCapsule` (~1462).
  - `callHost().changed`.
  - `micHoldersForTests`.
  - `answerCallOffer`.
- Test: `apps/mac/test/capsule-copy.test.ts`, `apps/mac/e2e/call-offer.spec.ts` (new, quiet project; mirror `call-notes.spec.ts`'s `launchForCalls`).

**Interfaces:**
- `CapsuleState` gains `| { kind: "call-offer"; app: string; icon?: string }`. Its doc comment: "An app other than Avanzel has held the microphone for a while: a bar asks whether to take notes on the call. It hides by itself after 30 s, which counts as Not now."
- `export const callOfferLine = (app: string): string => \`${app.trim() || "An app"} is using the microphone. Take notes on this call?\`;`
- The bar is `{ mood: "filed", line: callOfferLine(state.app), app: state.icon ? { icon: state.icon, label: state.app } : null, actions }`. Its actions are `<Button size="small" variant="quiet" onClick={() => api.answerCallOffer(false)}>Not now</Button>` and `<Button size="small" variant="primary" onClick={() => api.answerCallOffer(true)}>Take notes</Button>`, in that order. If the bar's `actions` takes one node, wrap them in a fragment.
- The capsule api gets `answerCallOffer(take: boolean): void` → `"capsule:call-offer"` → `controller.answerCallOffer(e.sender, take)`. Only the capsule's own page is heard (`isPageOf`).
- `export const CALL_OFFER_MS = 30_000;` in the controller.

The controller wiring:
- The field is `private readonly offer: CallOffer`, constructed after `this.calls`, with this host:
  - `ownPids`: the same set as `CallHost.ownPids`.
  - `canAsk`: all of these hold:
    - `this.store.get().offerCallNotes` (this setting comes in Task 8; until then treat it as `true` and leave a `// Task 8` note);
    - `this.callNotesOffer() === "ready"`;
    - `this.capsuleState.kind === "hidden"`.
  - `callRunning`: `this.calls.phase !== "idle"`.
  - `ask`: `void this.showCallOffer(app)`.
  - `withdraw`: hides the capsule if it shows `call-offer`.
  - `take`: `this.setCapsule({ kind: "hidden" }); void this.startCallNotes(app.name)`.
- `showCallOffer(app: OfferedApp)`:
  - Gets the icon with `app.getFileIcon(path, { size: "normal" })` → `.toDataURL()` when `path` is set, ignoring failures. Electron's `app` is the module-level import in controller.ts, so the parameter is named `offered` to avoid shadowing it.
  - Then, if `this.offer.asking?.pid === offered.pid` and the capsule is still hidden, calls `this.setCapsule({ kind: "call-offer", app: offered.name, ...(icon ? { icon } : {}) }, CALL_OFFER_MS)`.
  - Otherwise it calls `this.offer.gaveWay()`.
- In `setCapsule`, right after `const was = this.capsuleState`:
  - If `was.kind === "call-offer" && state.kind !== "call-offer"`: call `this.offer.answer(false)` when `state.kind === "hidden"` (the 30 s, or a dismiss), else `this.offer.gaveWay()`.
  - At the end of `setCapsule`, if the new state is `hidden`, call `queueMicrotask(() => this.offer.recheck())`.
- `callHost().changed` also calls `this.offer.recheck()`.
- `answerCallOffer(sender, take)` does nothing unless the capsule shows `call-offer`. It calls `this.offer.answer(take)` and, on Not now, `this.setCapsule({ kind: "hidden" })`. The take path hides via the host.
- `micHoldersForTests(holders: MicHolder[]): void` calls `this.offer.holders(holders)`, only with `AVANZEL_TEST === "1"`. The real watcher is Task 8.

- [ ] **Step 1: Write the failing copy test** in `capsule-copy.test.ts`: `callOfferLine("Zoom")` is `"Zoom is using the microphone. Take notes on this call?"`, and `callOfferLine(" ")` is `"An app is using the microphone. Take notes on this call?"`. Run `cd apps/mac && npx vitest run test/capsule-copy.test.ts`. **Expected:** fail.

- [ ] **Step 2: Implement the copy, the state, the scene, the IPC and the controller wiring as above.** Run `cd apps/mac && npx vitest run && npm run typecheck`. **Expected:** pass.

- [ ] **Step 3: Write `e2e/call-offer.spec.ts`.**
  - Launch as `launchForCalls` does: consent true, fake calltap, audio and transcript. Copy the helper into the spec, or export it from a shared helper if the file grows.
  - Holders are given with `call(app, "micHoldersForTests", [{ pid: 4242, bundle: "us.zoom.xos", appPid: 4242, app: "Zoom", path: null }])`.
  - Tests:
    - **`"an app that holds the microphone is asked about after 5 s; Take notes starts the call with that app's name"`.** The capsule state polls to `{ kind: "call-offer", app: "Zoom" }`. The bar's text "Zoom is using the microphone. Take notes on this call?" is visible. Click "Take notes". `expectCallCard` passes (copy it from `call-notes.spec.ts`). Press Stop, and the capture in the inbox has `app: Zoom`.
    - **`"Not now hides it, and it isn't asked again while the app holds the microphone"`.** Click "Not now". The capsule goes `hidden`. Holders are given again, and 6 s later the state is still `hidden`.
    - **`"nothing is asked while a call runs, nor after its Stop while the app still holds the microphone"`.** Start notes with `call(app, "startCallNotes")`, give the holders, Stop, and after 6 s the state is not `call-offer`.
    - **`"nothing is asked about Avanzel's own processes"`.** The holder's `pid` is the main pid: `await app.evaluate(() => process.pid)`.

- [ ] **Step 4: Run it.** Run `cd apps/mac && caffeinate -i env -u ELECTRON_RUN_AS_NODE npm run e2e -- e2e/call-offer.spec.ts e2e/call-notes.spec.ts`. **Expected:** pass.

- [ ] **Step 5: Run `npm run design:check -- --changed`, then commit:**

```bash
git add -A apps/mac
git commit -m "mac: the capsule asks whether to take notes when another app is using the microphone, with Take notes and Not now"
```

### Task 8: The setting, and the watcher's life

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`: `AppSettings` (after `checkForUpdates`, ~line 527).
- Modify: `apps/mac/src/main/store.ts`: `DEFAULT_SETTINGS` (~line 38) and `normalizeSettings` (~line 104).
- Modify: `apps/mac/src/renderer/settings/panes/General.tsx`: a new `Group` before `Startup` (~line 158).
- Modify: `apps/mac/src/main/controller.ts`:
  - `start()` (~770–800).
  - `stopForQuit()` (~816).
  - `changeApp` (~6490).
  - The Task 7 `canAsk`.
- Test: `apps/mac/test/store.test.ts`, `apps/mac/e2e/settings.spec.ts`, or the spec that covers General's switches (find it with `grep -ln "Open Avanzel when you log in" apps/mac/e2e`).

**Interfaces:**
- `AppSettings.offerCallNotes: boolean`. Doc comment: "Avanzel notices an app other than itself using the microphone and offers call notes (main/call-offer.ts). On until the person turns it off."
- `normalizeSettings`: `offerCallNotes: r.offerCallNotes !== false`, as `checkForUpdates` does.
- In General: `<Group label="Calls"><Switch label="Offer notes when a call starts" description="When another app uses the microphone, Avanzel asks whether to take notes." checked={snap.app.offerCallNotes} onChange={(offerCallNotes) => attemptChange(props, () => api.setApp({ offerCallNotes }))} /></Group>`. Check `Switch`'s props in `packages/ui` first. If it has no `description`, drop that prop and keep only the label.
- `private micWatch: MicWatch | null`, and `private applyCallOffer(): void`. The watcher runs exactly when all of these hold:
  - `offerCallNotes` is on;
  - `CallTap.available()`;
  - `process.env.AVANZEL_TEST !== "1"`;
  - the app isn't quitting.
  - Otherwise it is stopped, and `this.offer.holders([])` is called.
  - `onHolders` is `(holders) => this.offer.holders(holders)`.
- `applyCallOffer` is called:
  - at the end of `start()`;
  - in `changeApp` when `before.offerCallNotes !== after.offerCallNotes`;
  - and in `stopForQuit` (after `this.quitting = true`), where it is called before `leaving`, and `this.offer.dispose()` follows.
- `canAsk` now reads `this.store.get().offerCallNotes`. Remove the `// Task 8` note.

- [ ] **Step 1: Write the failing tests.**
  - In `store.test.ts`: the default is `true`; `{ offerCallNotes: false }` stays `false`; a file without it is `true`.
  - In the General e2e spec: the switch "Offer notes when a call starts" shows checked. Turning it off saves `offerCallNotes: false` in `settings.json` under the user-data dir.
  - In `call-offer.spec.ts`: **`"with Offer notes off, nothing is asked"`.** Launch with `offerCallNotes: false` in `settings.json`, give the holders, and after 6 s the state is `hidden`.

- [ ] **Step 2: Run them to see them fail.** Run `cd apps/mac && npx vitest run test/store.test.ts`. **Expected:** fail.

- [ ] **Step 3: Implement it.**

- [ ] **Step 4: Run all checks.**
  - `cd apps/mac && npx vitest run && npm run typecheck`
  - `cd ../.. && npm run design:check -- --changed`
  - `cd apps/mac && caffeinate -i env -u ELECTRON_RUN_AS_NODE npm run e2e -- e2e/call-offer.spec.ts e2e/call-notes.spec.ts <the General spec>`

  **Expected:** all pass. If General's screenshot baseline changes, list it in the report for the owner to approve. Don't run `ui:approve`.

- [ ] **Step 5: Commit:**

```bash
git add -A apps/mac
git commit -m "mac: Settings → General has Offer notes when a call starts, on by default, and the microphone watcher runs only while it is on"
```

### Task 9: Whole-branch checks and the owner's review build

- [ ] **Step 1: Run the full suites.**
  - `npm test` from the repo root.
  - `cd apps/mac && caffeinate -i env -u ELECTRON_RUN_AS_NODE npm run e2e:quiet`

  **Expected:** pass. A failure that also fails on `origin/main` is reported, not fixed.
- [ ] **Step 2: Hand the owner a review build** with the flight pack. The command is `sh try-review-build.sh fresh call-auto-detect`, and the script is at `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/try-review-build.sh`. Read its header for how to run it.
- [ ] **Step 3: The owner's real check**, from the spec's "Checks":
  - A Zoom or FaceTime call and a Meet call in Chrome, with AirPods in call mode.
  - One AirPod taken out and put back during the call.
  - The notes have both sides at the right speed.
  - The question appears once, and never during Right Option dictation.
