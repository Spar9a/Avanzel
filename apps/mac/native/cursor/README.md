# avanzel-cursor

The part of "dictate into any app" that only the Mac itself can do: it watches one modifier key (a tap of Right Option
starts and ends a dictation), says which app is in front and whether its cursor takes text, and sends the paste keystroke.

It is a long-running helper. Commands come in on stdin and events and replies go out on stdout, one JSON object per line;
diagnostics go to stderr. It exits when stdin ends or on SIGTERM or SIGINT.

Out (stdout):

- `{"event":"ready","accessibility":bool,"inputMonitoring":bool}` once, at start.
- `{"event":"modifier","key":"right-option","down":bool}` for each change of the watched key.
- `{"event":"key"}` for any other key-down or mouse-down: what breaks a tap. Sent only after a `watch`; it carries nothing
  about which key.
- `{"event":"error","message":"..."}`.
- A reply carries the request's `id`: `{"id":1,"ok":true,...}` or `{"id":1,"ok":false,"message":"..."}`.

In (stdin):

- `{"id":1,"cmd":"watch","key":"right-option"}`. Keys: `right-option` (code 61), `left-option` (58), `right-command` (54),
  `right-control` (62). Left and right are told apart by the key's own device flag bit. Replies `ok:false` while the
  keyboard cannot be watched yet (no Input Monitoring); the key stays chosen, and a later `watch` or `permissions` retries.
- `{"id":2,"cmd":"permissions","prompt":bool}` replies `accessibility` and `inputMonitoring`. `prompt:true` asks macOS for
  both. Start-up itself never raises a dialog.
- `{"id":3,"cmd":"inspect"}` replies `app` (`name`, `bundleId`, `pid`), `window` (`title`, or `null` when there is no
  focused window or it cannot be read) and `element` (`role`, `secure`, `takesText`, or `null` when nothing is known).
  `takesText` is `"yes"` for text fields, text areas, combo boxes, search fields, secure fields and editable elements; `"no"`
  when the focused element is positively not text (button, list, outline, table, image, and the like) or when the app has
  no focused window (then `element` is present with `role` null if it had none); otherwise `"unknown"`. Every Accessibility
  question has a 0.5 s limit, and a failed one gives nulls and `"unknown"`, never an error.
- `{"id":4,"cmd":"paste"}` posts Command-V to the focused app. Replies `ok:false` with a plain message without Accessibility.

Needs the Input Monitoring permission (to see the key) and Accessibility (to inspect and to paste). Without Input
Monitoring it still starts, says `inputMonitoring:false` in `ready`, and answers every command.

Build: `node apps/mac/scripts/build-cursor.mjs` makes a universal binary (macOS 14.2) at `build/avanzel-cursor`
(git-ignored). `npm run dist` runs it, bundles the result into `Avanzel.app/Contents/Resources/cursor/` and signs it with the app.
