# avanzel-calltap

Hears what a call app plays, the "them" side of a call, and writes it to stdout as raw 16 kHz mono signed 16-bit
little-endian samples. That is the format the speech model reads. Your own voice is the microphone's job, so a call keeps
two streams: you and them.

- `avanzel-calltap --pid <pid> [--pid <pid>]...` taps the sound of the apps you name (an app and its sound-playing
  helpers, as Chrome and Zoom have). `avanzel-calltap` taps everything the Mac plays.
- A pid with no audio object yet is retried once a second for up to 10 s (`waiting` is said once). A pid that never gets
  one is skipped; only when none does it fail with `no app you named is playing sound`.
- `--exclude <pid>`, which may repeat, leaves a process out of everything the Mac plays, so Avanzel doesn't hear its own
  sounds. A pid with no audio object is skipped without a word. With `--pid` it changes nothing: the named apps are all
  that is heard.
- `--seconds <n>` stops by itself. SIGINT and SIGTERM stop it too.
- Status lines go to stderr, one JSON object each: `waiting`, `started`, `error`, `stopped`. `started` gives the
  `sampleRate` the sound is read at.
- It listens through a private aggregate device anchored on the Mac's built-in output, the first built-in device with
  output streams, and on the current output only when there is none. The aggregate's clock follows that device, and
  AirPods change rate (24 kHz in call mode, 48 kHz otherwise), which made the other side come out at double speed. The
  tap still hears every app, whatever device it plays on. The converter is built from the rate the aggregate really runs
  at, not the tap's own format.
- A device with its own input (a USB headset) hands the IOProc its microphone's buffer as well as the tap's. The tap's is
  the last one, and only that one is read.
- `avanzel-calltap --watch-mic` taps nothing and opens nothing. It says which processes hold the microphone, read from
  Core Audio four times a second (so a blip under a second is seen as one), and needs no permission. It prints one line at start and another each time the set changes,
  until SIGINT or SIGTERM, then `{"event":"stopped"}` and exit 0:

  ```
  {"event":"mic","holders":[{"pid":1234,"bundle":"com.google.Chrome.helper","appPid":1200,"app":"Google Chrome","path":"/Applications/Google Chrome.app"}]}
  ```

  `holders` is sorted by `pid`. `bundle`, `appPid`, `app` and `path` are `null` when unknown. `appPid` is the outermost
  parent of `pid` (below launchd) that is a running `.app`, its own pid included, so a helper shows as the app a person
  knows. `app` is that app's name and `path` its bundle path.
- Needs macOS 14.2 and the System Audio Recording permission (not for `--watch-mic`). The app that starts it carries the permission, so the
  bundle needs `NSAudioCaptureUsageDescription` in its Info.plist.

Build: `node apps/mac/scripts/build-calltap.mjs` makes a universal binary at `build/avanzel-calltap` (git-ignored).
`npm run build` runs it, bundles the result into `Avanzel.app/Contents/Resources/calltap/` and signs it with the app.

## Checked on 4 Nov 2026 (macOS 26.6, from Terminal)

- Everything the Mac plays: a spoken sentence came back through Parakeet v3 word for word.
- One app (`--pid` of `afplay`) while another app spoke at the same time: only the tapped app's sentence came back.
- Not checked yet: the permission prompt when the helper runs from the signed Avanzel.app, Bluetooth headsets, and a
  real Zoom, Meet or Teams call.

## Checked on 19 Nov 2026 (from the T3 Code shell)

- `--watch-mic` from this shell: no permission prompt; a `swift -e` recorder that opened the microphone for 4 s showed up
  as a holder and dropped out again, with `appPid` the app that hosts the shell.

## Checked on 27 Nov 2026 (macOS 26.6.2, from the T3 Code shell)

A 5 s, 1000 Hz sine (48 kHz WAV) played with `afplay` while `--seconds 4` ran; zero crossings counted in the output.

- Built-in speakers as the output: 2000 crossings a second (1000 Hz), 133 792 bytes (4.18 s).
- Anchored on Muse Audio Share instead, a 44.1 kHz device with input and output (a test build, the system output left
  alone): `started` said 44100, the IOProc got two buffers, and the tone came back at 1000 Hz, 132 992 bytes. The helper
  before the fix recorded nothing there (0 bytes), and without the rate read the tone came out at 1088 Hz, 48/44.1 too
  fast.
- `--exclude` with `afplay`'s pid: nothing recorded. With another pid: the tone, 1000 Hz.
- Not checked: AirPods in call mode themselves.
