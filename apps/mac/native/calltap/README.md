# avanzel-calltap

Hears what a call app plays, the "them" side of a call, and writes it to stdout as raw 16 kHz mono signed 16-bit
little-endian samples. That is the format the speech model reads. Your own voice is the microphone's job, so a call keeps
two streams: you and them.

- `avanzel-calltap --pid <pid>` taps one app's sound. `avanzel-calltap` taps everything the Mac plays.
- `--seconds <n>` stops by itself. SIGINT and SIGTERM stop it too.
- Status lines go to stderr, one JSON object each: `started`, `error`, `stopped`.
- Needs macOS 14.2 and the System Audio Recording permission. The app that starts it carries the permission, so the
  bundle needs `NSAudioCaptureUsageDescription` in its Info.plist.

Build: `swiftc -O -o avanzel-calltap main.swift`

## Checked on 4 Nov 2026 (macOS 26.6, from Terminal)

- Everything the Mac plays: a spoken sentence came back through Parakeet v3 word for word.
- One app (`--pid` of `afplay`) while another app spoke at the same time: only the tapped app's sentence came back.
- Not checked yet: the permission prompt when the helper runs from the signed Avanzel.app, Bluetooth headsets, and a
  real Zoom, Meet or Teams call.
