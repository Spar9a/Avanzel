# Cursor dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person taps Right Option, speaks, taps again, and the words are typed at the cursor of whatever app has focus; every dictation is kept in a history, and, if the person turns it on, in a day file in the library with the app and window it was said in.

**Architecture:** A small Swift helper (`avanzel-cursor`, built and signed like `avanzel-calltap`) reports raw modifier-key events and, on request, inspects the focused app/window/element and sends a paste keystroke; JSON lines over stdin/stdout. A pure `TapDetector` decides what a tap is. A `CursorDictation` session in the main process drives one dictation: it reuses the capsule's microphone recording (as a question for the Ask window does, `Recording.askPage`), transcribes with the library's transcriber and dictionary, then pastes or shows the copy prompt. A history store keeps every dictation outside the library; an engine module writes the optional `raw/dictations/YYYY-MM-DD.md` day file.

**Tech Stack:** Swift (CoreGraphics event tap, Accessibility API), TypeScript (Electron main, renderer, engine), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-dictate-anywhere-design.md`. Read it with this plan. It scopes this plan to slices 1 and 2; slice 3 (the evening summary run) is not planned here.

## What was built

Branch `cursor-dictation` (sixteen commits from main 75fe0c5, spec and plan in dd0af5d, not pushed). The review copy is `apps/mac/release/review-cursor/mac-arm64/Avanzel.app`; the by-hand checks are in the flight pack's "Dictate into any app checks".

- **Task 1 (4a80f75, c406fa0):** the `avanzel-cursor` Swift helper: reports modifier-key events, inspects the focused app, window and element, and sends a paste keystroke, as JSON lines.
- **Task 2 (b2dd202, 9ba8773):** `TapDetector` (a press and release with no other key between) and `CursorHelper`, the helper's process with a fake mode for tests.
- **Task 3 (609c825):** `storagePolicy`: secure fields, skipped apps and sites, and Chrome-family private windows are stored nowhere.
- **Task 4 (cdb81d0):** `DictationHistory`, every dictation kept in the app's data outside the library.
- **Task 5 (38af5f5, 1298768):** `CursorDictation`, the session: paste at the cursor, or the copy prompt when focus moved or the target can't take text; the clipboard comes back.
- **Task 6 (2a275d8):** Right Option dictates through the capsule's microphone recording, with the library's transcriber and dictionary.
- **Task 7 (92d3718):** Settings → Voice turns it on, chooses the key and says which permission is missing.
- **Task 8 (01f9b1d, 7efaa93):** Settings → Dictations lists, copies and deletes dictations; the menu has "Forget the last dictation"; the pane shows the newest hundred.
- **Task 9 (ca98eb1):** the engine's day file `raw/dictations/YYYY-MM-DD.md`, kept out of git, appended to and forgotten again.
- **Task 10 (7831d0b, 22d95d1, eaeb046):** the library log switch, the skip lists, forgetting reaching the day file, and a day file that refuses a repeated id.
- **Task 10b:** the checks, the README line and this section.

Rulings that changed the plan:
1. A cursor recording starts like a question for the Ask window: no file-mode switch and no shortcut hint, since the words never become a thought.
2. The app's `DictationEntry` (ISO time) is mapped to the engine's `DictationLogEntry` (a Date) in Task 10; each type stays in its own package.
3. The skip-list defaults are written twice, in the app and in the engine, with a test in each that pins the same list.
4. Settings runs a short-lived helper to show the permission status while the setting is off, so the status is there before the person turns it on.
5. Task 3 only decides from what the browser reports; the host reads the Chrome-family window's private mode with AppleScript, and Safari's private windows stay undetectable.
6. `DictationHistory.add` never throws, so a disk problem cannot lose or block the dictation; the file is kept at mode 0600.
7. `DictationHistory.remove` does throw when the rewrite fails, and its callers say in one calm line that the dictation could not be deleted.
8. The host gets `wait(ms)` for the 150 ms between paste and clipboard restore, so tests need no timers.
9. If the second tap's inspect fails, the target is unknown: nothing is pasted, the copy prompt shows, and the entry goes to the history only, never to the library log.
10. Fix round 1 for Task 5 also restores the clipboard in a `finally` and keeps the history entry when the copy prompt throws.
11. `cancelListening()` also drops any recognition in flight, the host's private-window lookup can reject (so the fail-closed branch fires), and the host enforces `COPY_PROMPT_MS` itself.
12. After Esc during transcribing, the host makes `heard({ text: "", seconds: 0 })` happen once, so a quick re-tap is not swallowed for 10 s.
13. Clipboard formats other than text, HTML, RTF and PNG are lost when a dictation pastes and restores the clipboard; accepted for now, and the real fix is typing the text with key events.
14. The day file is serialised by an in-process queue per library root, not by `vault.withLock`, which can wait behind a filing run for minutes; only this app writes `raw/dictations/`.
15. The engine exports `isoLocal`, and the app's private copy of it is gone.
16. A day file refuses an id it already holds, so a forget can never leave a copy behind; the controller feeds unique ids.
17. An unknown site stays stored, and the "Sites to skip" line says sites are recognised in Safari and Chrome-based browsers only.

Known limits:
- Pasting restores only text, HTML, RTF and PNG on the clipboard. A copied file, spreadsheet cells or a TIFF-only image are gone after a dictation.
- Safari private windows can't be told apart, so what is dictated there is stored. Firefox and other browsers outside Safari and the Chromium set (Chrome Canary and Dev, Dia, Orion, Zen) can't report the site or private mode either. Arc and other Chrome-based browsers that don't answer the window query fail closed: the dictation is stored nowhere.
- A site that isn't listed, and a page the browser can't name, is stored.
- Pasting needs focus to stay where it was: if the app or window title changes before the words are ready, nothing is typed and the copy prompt shows for 5 seconds.
- There is no clean-up pass: the words are what the speech model heard, after the dictionary.
- One microphone user at a time: a dictation can't start while a thought or call notes are recording, and the reverse.
- The history has no limit; the pane shows 100 at a time.
- Sync tools (Obsidian Sync, iCloud) that copy the day file are not covered by Delete or forget.
- The Enpass bundle id in the default skip list (`com.enpass.Enpass`) is unverified; it may be `in.sinew.Enpass-Desktop`.

## Global Constraints

- macOS only. Everything stays on the Mac; nothing is sent anywhere but through the owner's own filing agent reading the library.
- The tap key is **Right Option** by default; a tap is a press and release with no other key between, and no hold-time limit. **Esc** cancels and inserts nothing.
- The first version inserts the recognised text after the dictionary (sound-alike included) with no clean-up pass. `heard` is stored only when the dictionary changed something.
- Target app, window and element are fixed at the **second tap**. If focus (app or window title) has moved when the text is ready, nothing is pasted and the copy prompt names the app the text was meant for.
- Paste is the insert method: text on the clipboard, a paste keystroke, then the previous clipboard restored. Accessibility is used to **refuse** (positively not a text element, or no focused window), never to approve: when it can't tell, paste.
- Copy prompt: shown for about 5 seconds (`COPY_PROMPT_MS = 5000`), with the text and a Copy button; the text is left on the clipboard.
- History: every dictation, in the app's data (not the library), no limit; audio is discarded once transcribed.
- Library log is **off by default**; `raw/dictations/YYYY-MM-DD.md`, one file per day, kept out of git (template `.gitignore` for new libraries, the repository's `.git/info/exclude` for older ones, written the way `excludeInboxAudio` does, `packages/engine/src/core/git.ts:113`). Never in `inbox/`; not a new top-level folder.
- Skip list holds app bundle ids and site domains; seeded with password managers and Keychain Access. A skipped app/site, a secure text field, and a Chrome-family private window: text is inserted, **stored nowhere** (neither history nor log). Browsers: the domain only, never the full address.
- Deleting a history entry (or "forget the last dictation") also removes it from the day file. Rewrites happen under the library lock (`Vault.withLock`, `vault.ts:308`).
- Only one microphone user at a time: a cursor dictation can't start while a thought is recording or call notes run, and vice versa (`calls.refuse()`).
- Names: code says `cursorDictation` / `cursor-dictation.ts`; owners see "Dictate into any app". "dictate" in the codebase already means "record a thought" (`dictate` shortcut).
- Copy: sentence case, calm, plain, no "!", no emoji, people are they/them. Windows use only `@avanzel/ui` components (no `className`/`style`, no raw elements); read `packages/ui/DESIGN.md`; `npm run design:check` must pass. Owner-only: tokens, baselines, design rules, hook settings.
- Do not push `main` (D5). Work on branch `cursor-dictation` from `main`. Editing files: use the Edit/Write tools only.
- Test commands (from `apps/mac` unless noted): `npx vitest run <file>`; engine `npx vitest run` in `packages/engine`; e2e `npx playwright test --project=quiet <files>`; `npm run typecheck`; `npm run design:check`. `pkill -f "say -v"` if a run hangs on speech.

## Review Focus

1. **Focus moves while the words are made** → nothing pasted, prompt names the intended app (Task 5 test).
2. **Clipboard** holds the owner's own content before: it is restored after a paste; after a failed paste it holds the dictated text (Task 5 tests).
3. **Option held as part of a shortcut** (⌥Space, ⌥⇧S, ⌥ with a click) must not count as a tap (Task 2 tests).
4. **Skip list / secure field / private window** → text inserted, not in history, not in log (Tasks 3, 5, 10 tests).
5. **Forget** removes the entry from the day file as well, and a concurrent append is not lost (Task 9 tests).
6. Also pinned: no speech heard → nothing pasted, calm line; Esc → nothing pasted; a thought or call already recording → the tap is refused with one line.

---

## File Structure

- `apps/mac/native/cursor/main.swift`, `README.md` (create): the helper. `scripts/build-cursor.mjs` (create); `package.json`, `electron-builder.yml`, `scripts/signing.mjs` (modify).
- `apps/mac/src/main/tap-detector.ts` (create): pure tap logic. `cursor-helper.ts` (create): process + protocol + fake.
- `apps/mac/src/main/cursor-policy.ts` (create): pure decisions about a target. `dictation-history.ts` (create): history store.
- `apps/mac/src/main/cursor-dictation.ts` (create): the session, behind a `CursorHost` interface; the controller implements the host (small glue in `controller.ts`, which is already 4,600 lines: keep additions thin).
- `apps/mac/src/shared/ipc.ts`, `main/ipc.ts`, `preload` (modify): app setting, history list/copy/delete, copy-prompt card action.
- `apps/mac/src/renderer/settings/panes/Voice.tsx`, new `Dictations.tsx`, `copy.ts` (modify/create).
- `packages/engine/src/core/config.ts`, `templates/config.toml`, `templates/gitignore`, `git.ts` (modify); `dictation-log.ts` (create); `index.ts` exports.

---

### Task 1: The helper `avanzel-cursor`

**Files:**
- Create: `apps/mac/native/cursor/main.swift`, `apps/mac/native/cursor/README.md`, `apps/mac/scripts/build-cursor.mjs`
- Modify: `apps/mac/package.json` (`build`/`dist` run `build-cursor.mjs` beside `build-calltap.mjs`), `apps/mac/electron-builder.yml` (extraResources `native/cursor/build` → `cursor`, filter `avanzel-cursor`), `apps/mac/scripts/signing.mjs:83` (sign it first, like calltap)

**Interfaces:**
- Produces: a binary at `native/cursor/build/avanzel-cursor` (universal, target `macos14.2` like calltap). It speaks JSON lines. **Out (stdout):**
  - `{"event":"ready","accessibility":bool,"inputMonitoring":bool}` once at start;
  - `{"event":"modifier","key":"right-option"|"left-option"|"right-command"|"right-control","down":bool}` for the watched key's changes (the key is set by the `watch` command);
  - `{"event":"key"}` for any other key-down or mouse-down (what breaks a tap);
  - `{"event":"error","message":string}`.
  - **Replies** carry the request's `id`: `{"id":n,"ok":true,...}` or `{"id":n,"ok":false,"message":string}`.
- **In (stdin):**
  - `{"id":n,"cmd":"watch","key":<key>}`;
  - `{"id":n,"cmd":"permissions","prompt":bool}` replies `{"accessibility":bool,"inputMonitoring":bool}` (`prompt:true` asks macOS);
  - `{"id":n,"cmd":"inspect"}` replies `{"app":{"name","bundleId","pid"},"window":{"title"}|null,"element":{"role","secure":bool,"takesText":"yes"|"no"|"unknown"}|null}`;
  - `{"id":n,"cmd":"paste"}` posts ⌘V to the focused app.
- The helper exits on stdin end or SIGTERM.

- [ ] **Step 1: Write `main.swift`.** Event tap (`CGEvent.tapCreate`, listen-only, `flagsChanged`/`keyDown`/`leftMouseDown`/`rightMouseDown`) on a run loop; modifier identity by key code (right option 61, left option 58, right command 54, right control 62), "down" from the matching device flag; one stdin reader thread dispatching commands. Inspect with `NSWorkspace.frontmostApplication` and `AXUIElementCreateApplication` → `kAXFocusedWindowAttribute` → `kAXTitleAttribute`, `kAXFocusedUIElementAttribute` → role, subrole `AXSecureTextField` ⇒ `secure`, `takesText` "yes" for text field/text area/combo box/`AXWebArea`-editable, "no" when a focused element's role is positively not text (e.g. `AXButton`, `AXList`, `AXOutline`, `AXTable`, `AXImage`), else "unknown". `takesText` is "no" also when there is no focused window. Paste: `CGEvent` key-down/up of V (9) with `.maskCommand`, posted to `.cghidEventTap`. Follow the style of `native/calltap/main.swift` (header comment saying the protocol, `say`/`fail` helpers).
- [ ] **Step 2: `build-cursor.mjs`** copies `build-calltap.mjs` for the new paths and name; without `swiftc` it says so and exits 0.
- [ ] **Step 3: Packaging.** Add the build step to the scripts, the extraResources entry and the signing line; add `apps/mac/test/build-config.test.ts` assertions beside the calltap ones (extraResources lists `cursor`, signing script mentions `avanzel-cursor`).
- [ ] **Step 4: Verify.** `cd apps/mac && node scripts/build-cursor.mjs` prints "Built …"; `echo '{"id":1,"cmd":"permissions"}' | native/cursor/build/avanzel-cursor` prints a `ready` line and a reply with `"id":1`; `npx vitest run test/build-config.test.ts` passes.
- [ ] **Step 5: Commit** `mac: the avanzel-cursor helper watches a modifier key, inspects the focused element and sends a paste`.

---

### Task 2: Tap detection and the helper's process

**Files:**
- Create: `apps/mac/src/main/tap-detector.ts`, `apps/mac/src/main/cursor-helper.ts`
- Test: `apps/mac/test/tap-detector.test.ts`, `apps/mac/test/cursor-helper.test.ts`

**Interfaces:**
- Produces:
  - `export type CursorKey = "right-option" | "left-option" | "right-command" | "right-control";`
  - `export class TapDetector { push(event: { event: "modifier"; down: boolean } | { event: "key" }): boolean }` — true exactly when a press and release of the key completes with no `key` event between.
  - `export interface Target { app: { name: string; bundleId: string; pid: number }; window: { title: string } | null; element: { role: string; secure: boolean; takesText: "yes" | "no" | "unknown" } | null }`
  - `export class CursorHelper { static binaryPath: () => string; static available(): boolean; constructor(opts: { onTap(): void; onProblem(message: string): void }); start(key: CursorKey): void; setKey(key: CursorKey): void; permissions(prompt: boolean): Promise<{ accessibility: boolean; inputMonitoring: boolean }>; inspect(): Promise<Target>; paste(): Promise<void>; stop(): Promise<void> }`
  - Fake: with `AVANZEL_FAKE_CURSOR=<path to a JSON file>` the helper is replaced by a script `{ "targets": Target[], "taps": number[] /* ms after start */, "permissions": {…}, "pasteOut": "<file>" }`: `inspect` returns the next target (the last repeats), `paste` appends the current clipboard text to `pasteOut`. E2E tests use it.

- [ ] **Step 1: Failing tests, `tap-detector.test.ts`:** down→up is a tap; down→key→up is not; down→up→up is one tap; a lone `key` is nothing; down→down→up is one tap; tap, then a second tap, are two. In `cursor-helper.test.ts` with a stub binary (a node script via `CursorHelper.binaryPath`, as `calltap.test.ts` does): a stub that prints two `modifier` events calls `onTap` once; `inspect()` resolves the stub's reply by `id`; two requests in flight resolve to their own replies; a reply `ok:false` rejects with its message; helper exit while a request waits rejects it and calls `onProblem`; `stop()` ends the child.
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run test/tap-detector.test.ts test/cursor-helper.test.ts`).
- [ ] **Step 3: Implement** both files. `CursorHelper` copies `calltap.ts`'s spawn/line-buffer/kill pattern (`calltap.ts:60-170`); requests are `{id,…}` lines with a per-request 3 s timeout; `binaryPath` looks in `resources/cursor/avanzel-cursor`, then `native/cursor/build/` like `defaultBinaryPath` there.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `mac: a tap of the chosen key is told from a shortcut, and the cursor helper's requests have answers`.

---

### Task 3: What may be stored, and where from

**Files:**
- Create: `apps/mac/src/main/cursor-policy.ts`
- Test: `apps/mac/test/cursor-policy.test.ts`

**Interfaces:**
- Consumes: `Target` (Task 2); `frontApp` context from `front-app.ts` for a browser's address (its existing function returns the tab's URL and title; read it before use).
- Produces:
  - `export const DEFAULT_SKIP_APPS: string[]` (bundle ids: `com.1password.1password`, `com.agilebits.onepassword7`, `com.bitwarden.desktop`, `com.apple.keychainaccess`, `com.apple.Passwords`, `org.keepassxc.keepassxc`, `com.lastpass.LastPass`, `com.dashlane.Dashlane`, `com.enpass.Enpass`; verify the ids against the apps' real bundles where installed).
  - `export function siteOf(address: string | undefined): string | null` — the host without `www.`; null for an empty or unparsable address.
  - `export function storagePolicy(target: Target, browser: { address?: string; privateWindow?: boolean } | null, skip: { apps: readonly string[]; sites: readonly string[] }): { store: boolean; reason: "skipped-app" | "skipped-site" | "secure-field" | "private-window" | null; site: string | null }`

- [ ] **Step 1: Failing tests:** a skipped bundle id ⇒ `store:false, reason:"skipped-app"`; `element.secure` ⇒ `"secure-field"`; a browser with `privateWindow:true` ⇒ `"private-window"`; a browser whose `siteOf(address)` is on the sites list (also a subdomain of a listed site) ⇒ `"skipped-site"`; a browser address `https://a.example.com/x?token=1` ⇒ `site:"a.example.com"` and the policy result never holds the path or query; an app not browser and not listed ⇒ `store:true`; a browser whose address couldn't be read ⇒ `store:true, site:null` (Firefox stays unknown).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Precedence: secure-field, then skipped-app, then private-window, then skipped-site.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `mac: secure fields, skipped apps and sites, and private windows are stored nowhere`.

---

### Task 4: The history store

**Files:**
- Create: `apps/mac/src/main/dictation-history.ts`
- Test: `apps/mac/test/dictation-history.test.ts`

**Interfaces:**
- Produces:
  - `export interface DictationEntry { id: string; at: string /* ISO, local offset */; text: string; heard?: string; app: string; bundleId: string; title: string | null; site: string | null; seconds: number; inserted: boolean }`
  - `export class DictationHistory { constructor(file: string); add(entry: DictationEntry): void; list(): DictationEntry[] /* newest first */; remove(id: string): DictationEntry | null; last(): DictationEntry | null }` — JSON lines at `<userData>/dictations.jsonl`; `remove` rewrites via `writeJsonAtomic`-style temp-and-rename (see `store.ts:31`); a corrupt line is skipped, not fatal.

- [ ] **Step 1: Failing tests:** add then list newest first; `remove` returns the entry and it is gone after a fresh `new DictationHistory(file)`; `last()` after two adds; a file with one garbage line lists the good ones; `add` creates the folder; an entry with `heard` keeps it.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `mac: every dictation is kept in a history outside the library`.

---

### Task 5: The session

**Files:**
- Create: `apps/mac/src/main/cursor-dictation.ts`
- Test: `apps/mac/test/cursor-dictation.test.ts`

**Interfaces:**
- Consumes: `CursorHelper`-shaped `helper` (Task 2), `storagePolicy` (3), `DictationHistory` (4).
- Produces:
  - ```ts
    export interface ClipboardSnapshot { text: string | null; html: string | null; rtf: string | null; image: Buffer | null }
    export interface CursorHost {
      helper: Pick<CursorHelper, "inspect" | "paste">;
      clipboard: { read(): ClipboardSnapshot; writeText(text: string): void; restore(s: ClipboardSnapshot): void };
      /** Starts the capsule's microphone as a cursor recording; false when something else holds it (it has said why). */
      startListening(): Promise<boolean>;
      /** Asks for the audio; it arrives at `heard`. */
      stopListening(): void;
      cancelListening(): void;
      busy(): boolean;                       // a thought or a call is running
      browser(target: Target): Promise<{ address?: string; privateWindow?: boolean } | null>;
      skip(): { apps: string[]; sites: string[] };
      logTo(): { enabled: boolean; write(entry: DictationEntry): void };
      showCopyPrompt(p: { text: string; app: string; reason: "failed" | "focus-moved" }): void;
      say(line: "refused" | "nothing-heard" | "cancelled"): void;
      history: DictationHistory;
      now(): Date;
      newId(): string;
    }
    export class CursorDictation {
      constructor(host: CursorHost);
      /** One tap of the key. */
      tap(): Promise<void>;
      /** The audio is in and recognised: `{ text, heard?, seconds }` (text may be empty). */
      heard(words: { text: string; heard?: string; seconds: number }): Promise<void>;
      cancel(): void;
    }
    export const COPY_PROMPT_MS = 5000;
    ```
- Behaviour: `tap()` while idle ⇒ if `host.busy()` then `say("refused")`, else `startListening()`; while listening ⇒ `inspect()` (the target is fixed *now*), `stopListening()`. `heard()`: empty text ⇒ `say("nothing-heard")`, nothing pasted. Otherwise `inspect()` again; the target is "the same" when app pid and window title match the fixed one; not the same ⇒ `showCopyPrompt({reason:"focus-moved", app: <intended app's name>})`, text left on the clipboard. Same and `element.takesText !== "no"` ⇒ read clipboard, `writeText`, `helper.paste()`, wait 150 ms, `restore`. `takesText==="no"` or a paste that throws ⇒ `showCopyPrompt({reason:"failed"})` and the text stays on the clipboard. `storagePolicy` decides `history.add` and `logTo().write`; `inserted` is whether the paste went.

- [ ] **Step 1: Failing tests** (stub host with recorded calls): happy path pastes, restores the previous clipboard (text and html), `history.add` has `inserted:true`, app name, title, `seconds`; focus moved (second `inspect` returns another pid) ⇒ no `paste`, prompt with `reason:"focus-moved"` and the *intended* app, clipboard holds the text, `inserted:false` stored; `takesText:"no"` ⇒ prompt `failed`, clipboard holds the text; paste throws ⇒ prompt, text on clipboard; empty text ⇒ `say("nothing-heard")`, nothing stored; `busy()` ⇒ `say("refused")` and `startListening` not called; `cancel()` while listening ⇒ `cancelListening`, a later `heard()` is ignored; secure field / skipped app ⇒ pasted, `history.add` and `logTo().write` never called; log disabled ⇒ `write` never called; dictionary-changed words ⇒ `heard` stored; a second tap before `heard()` arrives (still transcribing) is ignored.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** as a small state machine (`idle | listening | transcribing`). **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `mac: a cursor dictation pastes at the cursor, or offers the text when it can't`.

---

### Task 6: Wire it into the app

**Files:**
- Modify: `apps/mac/src/main/controller.ts` (add a `forCursor` recording like `forAsk`: `Recording` at ~line 292, `startRecording` at 1435, `onAudio` at 1590 gets `if (recording.forCursor) return this.heardForCursor(recording, received)` beside `forAsk`; build the `CursorHost`; start/stop the helper with the setting), `shared/ipc.ts` (`CardAction` gains `"copy-dictation"`; `AppSettings.cursorDictation: { enabled: boolean; key: CursorKey }`), `main/store.ts` (default `{enabled:false,key:"right-option"}`, `normalizeSettings`), `main/ipc.ts` and `preload` for the card action, the capsule's problem card for the copy prompt (reuse `fail(card, action, label)` with a 5 s hide, `COPY_PROMPT_MS`)
- Test: `apps/mac/test/store.test.ts` (setting defaults and normalising a bad `key` back to `right-option`), `apps/mac/e2e/cursor-dictation.spec.ts`

**Interfaces:**
- Consumes: `CursorDictation`, `CursorHost` (Task 5); `CursorHelper` (2); the existing `transcribe` (`controller.ts:1732`, already through the dictionary) and `calls.refuse()`.
- Produces: `Controller.pressCursorDictation()` (what the helper's `onTap` calls); the copy card's action `copy-dictation` copies the text held by the last prompt; Esc while a cursor recording listens cancels it.

- [ ] **Step 1: Failing tests:** `store.test.ts` — default `cursorDictation` is off with `right-option`; `normalizeSettings({cursorDictation:{enabled:true,key:"nonsense"}})` keeps `enabled` and falls back to `right-option`. E2E `cursor-dictation.spec.ts` (quiet project, `AVANZEL_FAKE_CURSOR`, `AVANZEL_FAKE_AUDIO`, `AVANZEL_FAKE_TRANSCRIPT="hello Kowalczyk"`, `AVANZEL_FAKE_CURSOR` taps at 500 ms and 1500 ms): the paste output file holds the words; with a second target (different pid) at the second inspect the paste file stays empty and the capsule shows the copy card naming the intended app, whose Copy button puts the text on the clipboard; with a thought recording started first the tap is refused with one line; with `enabled:false` taps do nothing.
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run test/store.test.ts`; `npx playwright test --project=quiet e2e/cursor-dictation.spec.ts`).
- [ ] **Step 3: Implement.** `heardForCursor` mirrors `heardQuestion`: no capture, no kept recording, no count, no filing. The helper starts at app launch when the setting is on and the library is open, restarts when `key` changes (`setKey`) and stops when it is turned off. Copy for the lines: "Nothing was heard.", "Something else is recording. Try again when it stops." (check `NOTHING_HEARD` in `problems.ts` before adding new strings), prompt title "The words didn't go in", body names the app and says they're on the clipboard.
- [ ] **Step 4: Run, expect PASS;** `npm run typecheck` and `npm run design:check` clean.
- [ ] **Step 5: Commit** `mac: Right Option dictates into the app that has focus, and offers the words when they can't go in`.

---

### Task 7: Settings: turn it on, choose the key, the permissions

**Files:**
- Modify: `apps/mac/src/renderer/settings/panes/Voice.tsx` (a "Dictate into any app" group), `settings/copy.ts`, `shared/ipc.ts` (a `cursorPermissions` query and `setCursorDictation(patch)` in the settings API), `main/ipc.ts`, `preload`, `controller.ts` (handlers)
- Test: `apps/mac/test/settings-copy.test.ts`, `apps/mac/e2e/settings.spec.ts` (or a new `cursor-settings.spec.ts`)

**Interfaces:**
- Produces: a group with a Switch (on/off), a Select of the four `CursorKey`s (names: "Right Option", "Left Option", "Right Command", "Right Control"), and a status line from `permissions(false)`: when either permission is missing, one calm sentence and a button that asks (`permissions(true)`) and opens the System Settings pane (`Privacy_Accessibility` / `Privacy_ListenEvent`). Layout and components are the builder's within `DESIGN.md`.

- [ ] **Step 1: Failing tests:** copy tests for the new strings (sentence case, no "!"); e2e: the switch persists after reload; the key select persists; with the fake helper reporting `accessibility:false`, the group says so and shows the button.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** typecheck and design check clean.
- [ ] **Step 5: Commit** `mac: Settings turns dictating into any app on, chooses its key and says which permission is missing`.

---

### Task 8: The history window

**Files:**
- Create: `apps/mac/src/renderer/settings/panes/Dictations.tsx`
- Modify: `settings/main.tsx` (pane list), `shared/ipc.ts` (`SettingsPane` gains `"dictations"`; `listDictations()`, `copyDictation(id)`, `deleteDictation(id)`), `main/ipc.ts`, `preload`, `controller.ts`, `settings/copy.ts`
- Test: `apps/mac/e2e/cursor-history.spec.ts`

**Interfaces:**
- Consumes: `DictationHistory` (Task 4). `deleteDictation(id)` calls an `onForget(entry)` hook that Task 10 fills in to remove the entry from the day file; here it only removes it from the history.
- Produces: a pane listing entries newest first (time, app and title, the text), each with Copy and Delete; an empty state in plain words; a "Forget the last dictation" item in the menu bar menu (`menu-model.ts`).

- [ ] **Step 1: Failing e2e:** after two fake dictations the pane lists both, newest first; Copy puts the text on the clipboard; Delete removes it and a reload still shows one; the menu item forgets the last.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** with existing `@avanzel/ui` components only. **Step 4: Run, expect PASS;** design check clean.
- [ ] **Step 5: Commit** `mac: the history of dictations can be read, copied and deleted`.

---

### Task 9: The library log (engine)

**Files:**
- Create: `packages/engine/src/core/dictation-log.ts`
- Modify: `packages/engine/src/core/config.ts` (`DictationSettings { log: boolean; skipApps: string[]; skipSites: string[] }` on `Settings.dictation`; defaults `log:false`, `skipApps: DEFAULT_SKIP_APPS` values copied (the engine can't import from the app), `skipSites: []`; keys `[dictation] log`, `skip_apps`, `skip_sites`), `templates/config.toml`, `templates/gitignore` (`raw/dictations/`), `git.ts` (the exclude function also lists `raw/dictations/`; rename for what it now does, e.g. `excludeLocalOnly`, keeping callers working), `index.ts`
- Test: `packages/engine/test/core/dictation-log.test.ts`, `config` and `git` tests alongside the existing ones

**Interfaces:**
- Produces:
  - `export interface DictationLogEntry { id: string; at: Date; app: string; title: string | null; site: string | null; text: string; heard?: string }`
  - `export function appendDictation(vault: Vault, entry: DictationLogEntry): Promise<void>` — under `vault.withLock`; creates `raw/dictations/YYYY-MM-DD.md` (local date) with a short header on first write; appends `## HH:MM · <app> — <title or site>` then `<!-- dictation <id> -->` then the text (and a `heard:` line only when it differs).
  - `export function forgetDictation(vault: Vault, id: string, at: Date): Promise<boolean>` — under the lock, removes that entry's block from the day file; true if found.

- [ ] **Step 1: Failing tests:** two appends in time order in one file; the first creates the header; `heard` appears only when given; `forgetDictation` removes only the one block and leaves the rest byte for byte; returns false for an unknown id; 20 concurrent `appendDictation` calls lose none (all 20 ids present); a title containing `##` or `<!--` can't forge an entry (it is flattened to one plain line); config round-trip of `[dictation]` with defaults when the table is absent; a config line over 200 characters or more than 500 skip lines is refused like the dictionary's (`MAX_DICTIONARY_LINE_LENGTH`); `git` test: after the exclude call the repository's `info/exclude` lists `raw/dictations/` and the owner's `.gitignore` is untouched; a second call changes nothing; a committed run (`commitAll`) leaves a changed day file out of the commit.
- [ ] **Step 2: Run, expect FAIL** (`cd packages/engine && npx vitest run test/core/dictation-log.test.ts`). **Step 3: Implement.** **Step 4: Run, expect PASS;** `npm test` in `packages/engine` passes.
- [ ] **Step 5: Commit** `engine: dictations can be kept in a day file in the library, out of git, and forgotten again`.

---

### Task 10: Turn the log on, the skip list, forgetting, and the checks

**Files:**
- Modify: `apps/mac/src/main/controller.ts` (the host's `logTo`/`skip` read `loadSettings(vault.root).dictation`; `onForget` calls `forgetDictation`), `main/library-info.ts` and `shared/ipc.ts` (`LibraryInfo` gains `dictationLog: boolean`, `dictationSkipApps: string[]`, `dictationSkipSites: string[]`; `LibraryPatch` the same), `main/dictionary-settings.ts` (`patchedSettings` takes the patch; lines cleaned with `plainLine`, capped as the dictionary is), `settings/panes/Voice.tsx` (a Switch for the log with one plain line that Obsidian Sync or iCloud copies aren't covered, and two text areas for the skip list, drafted at window level like `useDictionaryEdit`), `copy.ts`
- Modify (docs): `README.md` (a paragraph), `reports/Avanzel flight pack/2 Try it on your Mac.md` ("Dictate into any app checks"), the plan's own "What was built" section
- Test: `apps/mac/test/library-info.test.ts`, `apps/mac/test/dictionary-settings.test.ts`, `apps/mac/e2e/cursor-log.spec.ts`

- [ ] **Step 1: Failing tests:** the patch writes `[dictation]` to `config.toml` and the snapshot reads it back; E2E with the fake helper: log off ⇒ no `raw/dictations/` file; log on ⇒ the day file holds the entry with the app and title; a skipped app ⇒ pasted and in neither store; deleting the entry in the history pane removes it from the day file; the "Forget the last dictation" menu item does too; the evening review still files only inbox captures (the day file is not filed).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.** Full `npm test`, `npm run typecheck`, `npm run design:check` clean.
- [ ] **Step 5: Build the review copy** `release/review-cursor/` the way the dictionary's was (`npm run dist` writes into `release/mac-arm64`, the owner's own app: do not use it; follow `.superpowers/sdd/2026-11-04-avanzel-dictionary/` for the recipe and sign with "Avanzel Local").
- [ ] **Step 6: By-hand checks** in the flight pack, for the owner: the Accessibility and Input Monitoring prompts from the signed app; a tap in Claude Code's terminal, Slack, a browser box and an editor; Option held for ⌥Space doesn't start it; the copy prompt when a window is switched while the words are made; the day file after a day; Safari private windows are stored (a stated limit).
- [ ] **Step 7: Commit** `mac: the library log, the skip list and forgetting, with the checks that need a person`.

---

## Self-review notes

- Spec coverage: trigger (T1–2), speech/dictionary (T6 uses `transcribe`), insert/target/copy prompt (T5–6), history (T4, T8), library log and git (T9–10), privacy defaults (T3, T10), naming (Global Constraints). Slice 3 is deferred by the spec.
- The helper's permission needs (Input Monitoring versus Accessibility) are unknown until run on a real Mac; the helper reports both and Task 7 shows whichever is missing; Task 10's by-hand step is where it is learned.
- Window identity is app pid plus window title (Accessibility gives no stable window id); a title that changes while dictating counts as focus moved, which errs toward the prompt.
