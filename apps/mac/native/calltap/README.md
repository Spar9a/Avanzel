# avanzel-calltap

Hears what a call app plays, the "them" side of a call, and writes it to stdout as raw 16 kHz mono signed 16-bit
little-endian samples. That is the format the speech model reads. Your own voice is the microphone's job, so a call keeps
two streams: you and them.

- `avanzel-calltap --pid <pid> [--pid <pid>]...` taps the sound of the apps you name (an app and its sound-playing
  helpers, as Chrome and Zoom have). `avanzel-calltap` taps everything the Mac plays.
- A pid with no audio object yet is retried once a second for up to 10 s (`waiting` is said once). A pid that never gets
  one is skipped; only when none does it fail with `no app you named is playing sound`.
- `--seconds <n>` stops by itself. SIGINT and SIGTERM stop it too.
- Status lines go to stderr, one JSON object each: `waiting`, `started`, `error`, `stopped`.
- Needs macOS 14.2 and the System Audio Recording permission. The app that starts it carries the permission, so the
  bundle needs `NSAudioCaptureUsageDescription` in its Info.plist.

Build: `node apps/mac/scripts/build-calltap.mjs` makes a universal binary at `build/avanzel-calltap` (git-ignored).
`npm run build` runs it, bundles the result into `Avanzel.app/Contents/Resources/calltap/` and signs it with the app.

## Checked on 4 Nov 2026 (macOS 26.6, from Terminal)

- Everything the Mac plays: a spoken sentence came back through Parakeet v3 word for word.
- One app (`--pid` of `afplay`) while another app spoke at the same time: only the tapped app's sentence came back.
- Not checked yet: the permission prompt when the helper runs from the signed Avanzel.app, Bluetooth headsets, and a
  real Zoom, Meet or Teams call.
