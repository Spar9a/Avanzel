# Notice a call and offer notes: design

Date: 2026-11-19. Status: draft, waiting for the owner's approval.

## Intent

The owner keeps forgetting to start call notes when they're busy. When the microphone is in use by
an app other than Avanzel, a call has most likely started. So Avanzel should notice that and ask
once, in the capsule, whether to take notes. The person answers Yes or No, and stops the notes
themselves, as they do today.

A call notes session that starts by itself has to give good notes, or this feature just produces
garbled notes the owner never asked for. So the two capture bugs from the first real call
(2026-11-06) are fixed first, as part of this work.

## Goals

- When any app other than Avanzel holds the microphone for 5 seconds, the capsule asks: take notes
  on this call?
- No app list. A call in a browser counts the same as one in Zoom or FaceTime.
- Yes starts call notes at once, with the consent dialog first if it hasn't been agreed yet.
- No: it doesn't ask again until that app lets go of the microphone.
- With no answer, the question goes away after 30 seconds and nothing is recorded. That counts as
  No.
- The person stops the notes with the Stop button that's already on the call capsule. Nothing
  stops it by itself, apart from the existing 4-hour limit (`MAX_CALL_MS`).
- The other side of the call is always "everything this Mac plays", excluding Avanzel's own
  sound. The which-app picker goes away, in the panel and in the menu, as the owner decided on
  2026-11-06. "Take notes on a call" starts at once.
- The capture fixes:
  - **Speed.** AirPods in call mode run at 24 kHz instead of 48 kHz, and the other side then comes
    out at double speed. After the fix it comes out at the right speed.
  - **USB headsets.** A headset or interface with both input and output gives the IOProc two
    buffers, and today nothing is recorded for the other side. After the fix it records.
  - **Microphone change.** When the microphone changes or goes away (an AirPod out, a headset
    unplugged), the call's microphone comes back by itself. If it can't, the person is told.
- A setting turns the offer off (owner's call to keep or drop, see "My calls").

## Non-goals

- Stopping by itself when the microphone goes quiet. The owner chose the manual Stop.
- A list of call apps, a "never ask for this app" list, or telling a call from any other use of
  the microphone. Any app that holds the microphone gets asked about.
- Calendar matching or speaker names.
- Local-model notes for calls (separate work, [[avanzel-local-call-notes-direction]]).
- Windows or Intel Macs.

## Anti-goals (a failure even if it works)

- A question that steals focus or keyboard input from the call app. The capsule shows without
  taking focus, and answering is by click only.
- Asking during Avanzel's own recording: Right Option dictation, a thought, a screen capture.
- Notes that start by themselves and come out garbled (the bugs above).
- Asking again and again for the same call.

## How it works today (what this touches)

- `apps/mac/native/calltap/main.swift` is the Swift helper. It taps the named pids
  (`CATapDescription(stereoMixdownOfProcesses:)`), or everything with
  `stereoGlobalTapButExcludeProcesses: []`. It anchors the aggregate device on the default output
  (line ~94) and builds its converter from `kAudioTapPropertyFormat`, which it reads once. The
  IOProc wraps the whole input buffer list with `bufferListNoCopy:`, which returns nil when there
  are two buffers.
- `apps/mac/src/main/calltap.ts` spawns it. `call-notes.ts` runs a call (`CallNotes`), and
  `controller.ts` (~2750–2900) has `startCallNotes(app | "everything")`, `callHost`,
  `callNotesOffer` and `pickCall`, which opens the panel's call picker.
- `apps/mac/src/main/call-apps.ts` has `CALL_APPS`, the process-tree walk and `callAppLabel`.
- `apps/mac/src/renderer/panel/main.tsx` (~252–410) lists the call apps that run, plus
  "Everything this Mac plays".
- `apps/mac/src/renderer/capsule/recorder.ts` opens the microphone with `getUserMedia` (exact
  `deviceId`). Nothing handles `ended`, `mute` or `devicechange`. After a track ends, the worklet
  keeps posting silent blocks, so time keeps running but nothing is heard.
- `apps/mac/src/renderer/capsule/listening.tsx` (~69–80) is the call capsule: the time and Stop.
- How to reproduce the capture bugs, and the fix already tried for speed (anchor on the Mac's
  speakers), are in the owner's notes
  ([[avanzel-call-capture-bugs]]): `log show` predicates, and a rate rig using BlackHole 2ch and
  Muse Audio Share as clock devices.

## Approaches considered (for telling that another app holds the microphone)

1. **Ask Core Audio which processes are recording (chosen by the owner).** Watch
   `kAudioHardwarePropertyProcessObjectList`, and `kAudioProcessPropertyIsRunningInput` on each
   process object, with property listeners. This opens no microphone, so no prompt and no orange
   dot. It knows who holds the microphone, so Avanzel ignores its own processes. It also notices a
   call that starts while the person is dictating. It needs Swift, and works on macOS 14+ (call
   notes already need 14.2). Seen working on a test process, not yet on a real call app.
2. **Only "is the default input running somewhere?"**
   (`kAudioDevicePropertyDeviceIsRunningSomewhere`), with Avanzel's own state used to guess who.
   It's simpler, but it can't tell Avanzel dictating from Avanzel dictating while Zoom also holds
   the microphone. It gives false prompts and misses calls when the timing is off.
3. **Read the system log** (audiomxd's `update_running_state`). Fragile: the wording isn't an API
   and changes between versions. Ruled out.

## The design

### 1. Capture fixes (first, each with its own check)

- **calltap, speed.** Anchor the aggregate device (`MainSubDevice` and the sub-device list) on the
  Mac's built-in output, which never changes rate during a call. Fall back to the default output
  only when the Mac has no built-in output. Build the converter from the rate the IOProc actually
  delivers, not from what was read once.
- **calltap, USB headsets.** In the IOProc, take the tap's stream (the last buffer of the input
  list) as a single-buffer list before wrapping it in `AVAudioPCMBuffer`.
- **calltap, Avanzel's own sound.** The global tap leaves out Avanzel's processes, passed in by
  main as `--exclude <pid>`. Tapping everything stays the only mode the app uses.
- **Microphone.** In `Recorder`, keep the `AudioContext` and worklet for the whole call. When the
  track ends or is muted, or `devicechange` takes away the chosen device, open the microphone
  again: the chosen one if it's still there, otherwise the default. Then reconnect a new
  `MediaStreamSource` to the same worklet. Because the worklet keeps posting blocks, the gap is
  silence and the two streams stay aligned. If no microphone opens within about 3 s, the call goes
  on with the other side only, and the person gets a notice: "Your microphone stopped. The call so
  far is safe." It keeps trying when a new device appears. This applies to calls. Whether thoughts
  and dictation should get the same handling is the builder's call, because those are short.

### 2. Who holds the microphone: a watch mode in calltap

`avanzel-calltap --watch-mic` creates no tap and opens nothing. It listens as described in
approach 1 (the plan polls once a second rather than registering listeners), and writes one JSON line to stderr each time the set of recording processes changes:

```
{"event":"mic","holders":[{"pid":1234,"bundle":"us.zoom.xos"}]}
```

Main starts it once at launch, when the setting is on and macOS is 14.2 or later, and restarts it
if it dies. One binary means one signing and notarizing path, rather than a new helper.

**First step, a go/no-go spike before any of the rest:**

- On a real Mac, the line must name Zoom (or FaceTime) and a Chrome Meet tab while they hold the
  microphone.
- It must name Avanzel's own process while the capsule records.
- Running it must bring up no System Audio Recording or Microphone prompt.
- Write down which process Chromium reports for a tab (the browser or a helper), and which pid
  Avanzel's own recording shows as.

If watching needs a permission, or doesn't see browsers, stop and report back before building
further.

### 3. Deciding when to ask (main, pure and unit-tested)

A small module, e.g. `mic-watch.ts`, takes the holders lines plus Avanzel's state and decides when
to ask:

- **Avanzel's own processes are left out:** the app's pid and everything below it in the process
  tree (`running-apps.ts`), and any holder whose bundle id is Avanzel's or a child of it. Which
  works is confirmed by the spike.
- **When it asks:** another holder has held the microphone without a break for 5 s. Then it asks,
  provided call notes could start (`callNotesOffer()` would be "ready", or would be except that a
  recording runs) and no question is already showing.
- **During Avanzel's own recording:** the question waits until the recording ends, and comes then
  if the app still holds the microphone.
- **No, or 30 s without an answer:** that holder (by pid) isn't asked about again until it lets go
  of the microphone.
- **While a call runs:** nothing is asked. Every holder present during a call, however the call
  was started, counts as answered until it lets go. So nothing is asked straight after Stop, or
  after the 4-hour limit, while the same app still holds the microphone.
- **What a release is:** apps reopen the input within a fraction of a second on a route change (an
  AirPod out). So:
  - "Lets go" means the holder has been gone for 10 s.
  - A gap under 1 s doesn't break the 5 s hold.
- **Several apps:** the first one past 5 s is asked about. One question at a time.
- **Which holders count:** only processes that belong to an app the person can see, meaning
  inside an `.app` bundle. Each one is credited to that app, and the app is named in the question.
  Daemons with no app (Siri, macOS dictation, Voice Control) never ask.
  - If the spike shows a call app's audio sitting in a daemon (FaceTime's in `avconferenced`, for
    example), map that daemon to its app. Keep that map to the cases the spike proves.
- **When the capsule is busy:** the capsule holds one state at a time. The question waits until it
  has nothing to show (hidden), then appears.
  - The 30 s clock runs only while the question is visible.
  - If the person starts a dictation or thought while it's showing, it gives way. It comes back,
    with a fresh 30 s, once the capsule is free again, provided the app still holds the microphone.

### 4. The question in the capsule

A new capsule state, shown without taking focus, as the capsule already shows for dictation:

> Zoom is using the microphone. Take notes on this call?
> [Take notes] [Not now]

- The app's name comes from its bundle (localized name), or the process name.
- **Take notes** runs `startCallNotes("everything")`. The capture's `app:` is the asking app's
  name, so the meeting page can say "Zoom".
- **Not now**, or 30 s without an answer, hides it.
- Built from `@avanzel/ui` components only. If no existing component or variant fits, add a variant
  in `packages/ui` with a gallery entry. Copy in sentence case.

### 5. The picker goes away

- The panel's call row and the menu's "Take notes on a call" start `everything` at once.
- `panelCallApps`, `pickCall`, `CALL_APPS` and the picker's UI are deleted, along with anything
  that only they use. `callAppLabel` becomes "the app's name from its bundle".
- calltap's `--pid` mode can stay or go: the builder's call.

### 6. Setting

There is no Calls pane. The existing General pane gets a "Offer notes when a call starts" switch,
on by default. It's stored per Mac in the app store (`store.ts`), next to `callConsent`, not in a
library's `settings.json`. Off stops the watch helper. The owner approves the changed pane's
screenshot.

## Checks

- **Unit:**
  - The decider: 5 s hold, a break resets the hold, No lasts until release, the 30 s timeout,
    Avanzel's own processes left out, waiting during Avanzel's recording, silent during a call,
    one question at a time.
  - The recorder reopening (with a fake `mediaDevices`).
- **e2e (quiet project):** `AVANZEL_FAKE_MICWATCH`, like `AVANZEL_FAKE_CALLTAP`, feeds holders
  lines. Cover: Take notes starts a call, Not now and the timeout, nothing asked while a call runs,
  the picker gone. Update the call specs that drove the picker.
- **calltap rate rig** from the notes: 44.1 kHz and 48 kHz clock devices, and a rate change
  mid-run. The tone and the length both come out right. A USB headset or interface records the
  other side.
- **Real Mac (owner, with the flight pack review build):**
  - A Zoom or FaceTime call and a Meet call in Chrome, with AirPods in call mode. One AirPod is
    taken out and put back once on purpose.
  - The notes have both sides at the right speed.
  - The question appears once, and never during Right Option dictation.

## What's left to the builder

File and module names, the watch helper's restart policy, the exact capsule component or
variant, how to resolve a bundle's name, whether thoughts and dictation also reopen the
microphone, and whether `--pid` stays.

## My calls (the owner can overrule)

- 5 s hold and 30 s timeout. A timeout counts as No.
- "No" is remembered per pid until release, not per app forever.
- The question names the app, and the capture's `app:` keeps it.
- The question waits during Avanzel's own recording, rather than being dropped.
- A switch in Settings → General, on by default, stored per Mac.
- A holder present during a call counts as answered until it lets go, so nothing is asked after
  Stop.
- "Lets go" means gone for 10 s. A gap under 1 s doesn't break the 5 s hold.
- Only processes inside a visible app count. Siri and dictation daemons never ask.
- The question waits for an idle capsule. Its 30 s runs only while it's visible, and it gives way
  to a recording the person starts.
- Avanzel's own sound is left out of the global tap.
- If the microphone can't come back, the call goes on with the other side only, and the person
  gets a notice.
