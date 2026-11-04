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
  Also used for a line that is not JSON or has neither `id` nor `cmd`.
- A reply carries the request's `id`: `{"id":1,"ok":true,...}` or `{"id":1,"ok":false,"message":"..."}`. Every success
  reply carries `"ok":true` beside its own fields. A line with an `id` but no usable `cmd` gets an `ok:false` reply.

In (stdin):

- `{"id":1,"cmd":"watch","key":"right-option"}`. Keys: `right-option` (code 61), `left-option` (58), `right-command` (54),
  `right-control` (62). Left and right are told apart by the key's own device flag bit. Replies `ok:false` while the
  keyboard cannot be watched yet (no Input Monitoring); the key stays chosen, and a later `watch` or `permissions` makes
  the tap once the permission is there (a tap made without it is dropped, so no restart is needed).
- `{"id":2,"cmd":"permissions","prompt":bool}` replies `ok:true`, `accessibility` and `inputMonitoring` (`ready` computes
  `inputMonitoring` the same way). `prompt:true` asks macOS for both. Start-up itself never raises a dialog.
- `{"id":3,"cmd":"inspect"}` replies `ok:true`, `app` (`name`, `bundleId`, `pid`; name and bundleId can be null), `window`
  (`title`, or `null` when there is no focused window or it cannot be read) and `element` (`role`, `secure`, `takesText`;
  `null` when Accessibility is not granted or nothing could be read). `role` can be null.
  `takesText` is `"yes"` for text fields, text areas, combo boxes, search fields, secure fields and editable elements; `"no"`
  when the focused element is positively not text (button, list, outline, table, image, and the like) or when the app has
  no focused window (then `element` is present with `role` null if it had none); otherwise `"unknown"`. Every Accessibility
  question has a 0.5 s limit, and a failed one gives nulls and `"unknown"`, never an error.
- `{"id":4,"cmd":"paste"}` posts Command-V to the focused app. Replies `ok:false` with a plain message without Accessibility.

Needs the Input Monitoring permission (to see the key) and Accessibility (to inspect and to paste). Without Input
Monitoring it still starts, says `inputMonitoring:false` in `ready`, and answers every command.

Build: `node apps/mac/scripts/build-cursor.mjs` makes a universal binary (macOS 14.2) at `build/avanzel-cursor`
(git-ignored). `npm run dist` runs it, bundles the result into `Avanzel.app/Contents/Resources/cursor/` and signs it with the app.
