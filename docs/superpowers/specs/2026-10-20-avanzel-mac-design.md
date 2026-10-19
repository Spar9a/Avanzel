# Avanzel for Mac (v0.2) — design

Date: 2026-10-20 · Status: approved in conversation (owner answered "LGTM" to each playback; mockups
in-thread), then `/goal`: "commit what we have, start working on what we have discussed above to
have working application which I'll test by myself". Calls marked *(my call)* are open to change.

## 1. Intent

Turn the v0.1 CLI into an app the owner uses all day on a Mac: press a shortcut, talk, and the
thought is transcribed on the Mac and filed by the agent the owner already pays for. Capture what's
on screen with a spoken comment; let an evening run tidy the day's inbox. Everything stays plain
Markdown in the same library format as v0.1.

Owner's words that shape it: "make a whole application in TypeScript, like T3 Code"; "pop-ups when
we recognise the voice"; "inspiration from FluidVoice … follow Apple conventions"; picked pop-up
**B (capsule above the Dock)**; the inbox is "incoming messages, shares of thoughts, comments which
user did as found useful, and at the end of the day we will review it and store in proper places";
"give a vision to our agent … trigger words or shortcuts … take screenshot and put some comments".

## 2. Scope of this phase (the agreed order, steps 1–3)

1. **TypeScript engine** (`packages/engine`): port of v0.1 (library, harness adapters, filing
   contract incl. every review fix) + local Parakeet transcription in Node.
2. **Mac app** (`apps/mac`, Electron): menu bar, capsule, Settings, global shortcuts, dictation end
   to end, Type a thought, Ask your library.
3. **Screen capture + evening review**: ⌥⇧S captures the screen with a spoken comment into the
   inbox; shadow tasks run on schedule (evening review files the inbox and writes a digest; weekly
   review).

Later phases (not now): Tools & MCP connector (step 4), iPhone app (5), Notion/GitHub/GitLab pulls (6).

## 3. Decisions the owner made

- TypeScript monorepo in the T3 Code shape; Electron on the Mac; Expo later for iPhone.
- Native macOS look and conventions; FluidVoice-like dictation; capsule above the Dock.
- Menu bar only: no Dock icon, no main window; the library is browsed in Obsidian/Finder.
- Shortcut-driven, no always-on listening. ⌥ Space default; first launch lets you pick.
- Parakeet v3 preselected; capsule never takes keyboard focus; Esc cancels.
- Filing right away by default; "at the next tidy-up" is opt-in.
- Notifications via Notification Center; light/dark follow the system.
- Inbox = the day's catch; evening review files it and leaves a digest with undo.
- Screen capture on a shortcut, with the owner's spoken comment; editable.
- Shadow tasks are files in the library (schedule + agent + instructions + tools).

## 4. Architecture

```
apps/mac (Electron)
  main process ── engine (in-process) ── harness CLIs (claude -p, codex exec, …)
     │  tray menu, global shortcuts, scheduler, screen capture, notifications
     ├─ capsule window (non-activating panel, bottom-centre above the Dock): record, states, edit
     ├─ settings window (React): General, Voice, Agents, Library, Shadow tasks, Tools & MCP, Privacy
     ├─ quick-type window, ask window
packages/engine (Node, TS)
  config · vault · changes · search · git · prompts · harness · librarian · skills · voice/*
```

- Recording happens in the capsule renderer (getUserMedia → AudioWorklet → 16 kHz mono float), audio
  levels drive the waveform; on stop the samples go to main over IPC, are written as WAV under
  `raw/audio/`, transcribed by the engine, captured, and filed.
- Transcription: onnxruntime-node running the same int8 ONNX files as v0.1
  (`istupakov/parakeet-tdt-0.6b-v3-onnx` + `nemo128.onnx` preprocessor); TDT greedy decoding ported
  from onnx-asr; Silero VAD (`istupakov/silero-vad-onnx`) for audio over 25 s. Spike verified
  identical text to Python on EN and RU, 0.8 s load, ~0.12 s per 4 s clip.
- Models live in `~/Library/Application Support/Avanzel/models/`; an existing Hugging Face cache copy
  is used in place when present *(my call)*; otherwise downloaded with progress.
- Same library format as v0.1 (the Python CLI and the app can share a library, not concurrently).

## 5. Capture formats (extension of v0.1)

Screen captures add `source: screen`, `app`, `window`/`title`, `url` (browsers), `attachments:
[raw/attachments/YYYY/MM/<stamp>.png]`, optional `audio`/`transcriber` for the spoken comment; the
body is the comment, then `![[<stamp>.png]]`. AGENTS.md and the file prompt tell agents to look at
attachments; Codex gets them with `-i`, OpenCode with `-f`, Claude reads them with its Read tool.
Screen captures are **not** filed immediately: they wait for the evening review *(my call, from the
mockup)*.

## 6. Behaviour details

- **Capsule states**: listening (waveform, timer, "Auto"), transcribing, filing (transcript + Edit),
  filed (pages with Finder-tag shelf colours, Undo, Open), saved-to-inbox, error. Dismiss leaves
  filing running; result then arrives as a notification.
- **Shortcuts** *(my calls)*: ⌥Space dictate (tap to start, tap to stop — Electron global shortcuts
  have no key-up, so hold-to-talk is a later native add-on), ⌥⇧S capture screen + comment,
  ⌥⇧Space type a thought, ⌥⇧A ask. Esc cancels while the capsule is up (local shortcut while
  recording). Shortcuts are editable in Settings; a taken shortcut is reported, not silently lost.
- **Undo** reverts the filing's git commit; Open opens the main page (Obsidian if installed,
  otherwise the default app).
- **Edit** pauses the filing, makes the capsule focusable with an editable transcript, then files
  the edited text.
- **Shadow tasks**: `tasks/*.md` with frontmatter `name, schedule ("daily 21:00" | "weekly sun
  18:00"), kind (evening-review | review | custom), agent, tools, enabled`; body = instructions.
  Defaults created on first run: Evening review (daily 21:00, enabled), Weekly review (Sun 18:00,
  enabled). Scheduler checks every minute and on wake; a missed run runs once on wake.
- **Evening review** = file every inbox item (one agent run each, existing contract), then Avanzel
  writes `reviews/YYYY-MM-DD-evening.md` (what went where) and posts "Evening review: N things
  filed" with Undo all / Open summary.
- **Privacy**: mic only while the capsule listens; screen only on ⌥⇧S; permissions requested on
  first use with a sentence why; nothing uploaded except what the owner's agent CLI sends.

## 7. Non-goals for this phase

Tools & MCP connector (pane shows what's coming), iPhone, service pulls, hold-to-talk, notch/menu-bar
pop-up styles A/C, Whisper in the app (command backend remains), Live Text OCR of screenshots,
front-window-only capture (whole display under the cursor for now), wake word, code signing /
notarisation, a TypeScript CLI (the v0.1 Python CLI keeps serving the skill).

## 8. Testing & verification

Engine: vitest, porting v0.1's tests plus new ones (attachments, digest, undo). Voice: unit tests
+ opt-in comparison with `say`-generated speech. App: unit tests for pure logic (schedule maths,
menu model, settings store, capture context parsing) and Playwright-Electron end-to-end tests with
a fake agent, fake audio file and fake screenshot. Real runs: one dictation filed by Claude Code
through the built app (driven by the test hooks), and a packaged `Avanzel.app` that launches.
