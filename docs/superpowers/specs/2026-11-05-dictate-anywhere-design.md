# Dictate anywhere: design

Status: written 2026-11-05 after a talk with the owner. Items marked **(my call)** were not decided by the owner; everything else was.

## Intent

The owner uses FluidVoice all day: every message to a coding agent, every English text in a browser, Slack or editor goes through it. They want Avanzel to replace it, so they stop opening FluidVoice. Avanzel already has the speech model (Parakeet v3, local) and a personal dictionary; what is missing is speaking into *any other app*.

A second purpose rides on it. Each dictation also knows where it was said (the app and the window title). Kept in the library, optionally, that gives the evening review a picture of the day's conversations, such as a long chat with an agent about one project, which the owner would never think to save as a thought.

## What the owner does today (the behaviour to match)

1. Taps **Right Option** once. Avanzel starts listening. It is a toggle, not hold-to-talk.
2. Speaks, often a long prompt.
3. Taps Right Option again.
4. The text is inserted at the cursor in the focused app.
5. If inserting fails, a prompt stays for about 5 seconds so the text can be copied.
6. The app keeps a history of every dictation.

## Goals

- **G1. Dictate into any app.** The Right Option tap, the speech model, the dictionary, insertion at the cursor.
- **G2. Never lose a dictation.** If it can't be inserted, the 5-second copy prompt appears. Every dictation lands in the history.
- **G3. History.** Every dictation is kept in the app, with its time, text, app and window title.
- **G4. Optional library log.** A switch (off by default) that also writes dictations, with their context, to a day file in the library.
- **G5. Evening review reads the log** and adds a short account of the day's conversations to the digest.

Success: the owner goes a week without opening FluidVoice.

## Non-goals

- A clean-up pass (removing "um", fixing punctuation and sentences, the Gemma-style "refine" in FluidVoice). The first version inserts what the speech model heard, after the dictionary. **(my call)** This is the biggest gap from FluidVoice and the likeliest first complaint; the owner never said whether they use it. It is a separate later experiment.
- Spoken editing commands ("new line", "delete that").
- Hold-to-talk, streaming partial text into the app, per-app writing styles.
- Windows or Linux. macOS only.
- Filing dictations as thoughts. They are never filed to shelves one by one.

## Anti-goals (a failure even if it works)

- Text typed into the wrong app or window.
- The owner's clipboard left changed after a successful insert.
- The log switched on without the owner choosing it, or any dictation text or window title leaving the Mac other than through the owner's own filing agent reading the library.
- A day of dictations turning into a hundred filing runs.

## Constraints from the codebase

- Electron's `globalShortcut` cannot register a modifier on its own (`apps/mac/src/main/shortcuts.ts:50-62` already treats a bare modifier as not a shortcut). A bare **Right Option tap** needs a small native helper that watches modifier key changes, built and signed like `apps/mac/native/calltap` (bundled in `Contents/Resources`, signed with the local identity "Avanzel Local"). Which macOS permission it needs (Input Monitoring, Accessibility, or both) must be checked on a real Mac; this document does not assume.
- Inserting into another app, and reading its focused window's title, need the **Accessibility** permission, which Avanzel does not ask for today (`permissions.ts` covers only microphone and screen). It needs a setup step and a calm, plain explanation, in the style of the existing ones. `NSAppleEventsUsageDescription` already covers browser tab titles and addresses (`front-app.ts`).
- Existing default shortcuts are `Alt+Space` (record a thought), `Alt+Shift+S`, `Alt+Shift+Space`, `Alt+Shift+A`, `Alt+Shift+Z` (`store.ts:12-16`). A tap of Right Option must not fire when Option is held as part of those.
- Speech: the existing recorder, `makeTranscriber`, and `withDictionary` (`packages/engine/src/voice/index.ts`, `dictionary.ts`). The transcriber cache is keyed without dictionary fields, so editing the dictionary does not reload the model.
- Window front-app context already exists for screenshots: `apps/mac/src/main/front-app.ts` (app name and bundle id via `lsappinfo`, browser tab address and title via AppleScript).
- The library: `inbox/` files are each filed by one agent run (`vault.ts` `pending()`); `raw/` is read-only to the agent (`templates/AGENTS.md`), kept on undo; every filing run commits everything (`librarian.ts`); `raw/audio/` is kept out of git by the library's `.gitignore` (`git.ts:104`). The evening review's digest is written by code (`librarian.ts` `eveningReview`, `digest()`), not by an agent.
- Interface work follows `AGENTS.md`: windows use only `@avanzel/ui`, copy is sentence case and calm, people are they/them. The owner said function comes before UI; keep any window minimal and use existing components.
- Only one thing may use the microphone at a time. While a thought is being recorded or call notes are running, a dictation can't start, and the capsule says so in one calm line. **(my call)** Dictating during a call is a plausible wish; it is left for later.

## Design

### 1. Trigger
A tap of **Right Option** (press and release with no other key between, and no hold-time limit beyond that) starts dictation; another tap ends it. **Esc** cancels and inserts nothing, as in the existing recording. The key is a setting with Right Option as the default. **(my call)** The capsule shows the same listening state it already shows for a thought, with a clear "dictating" wording so the owner can tell which kind of recording is running.

### 2. Speech
The same recorder and Parakeet model. The result goes through the whole dictionary, sound-alike included: this text has a trail (the history keeps `heard`, the text before the dictionary), so the caution that made calls aliases-only does not apply. **(my call)** If nothing was recognised, nothing is inserted and the capsule says so plainly.

### 3. Insert
**Where it goes. (my call)** The target is fixed at the second tap: the focused app, its window and its focused element are noted then. The skip list, the secure-field check, and the context stored in the history are all evaluated against that target. When the text is ready (the speech model can take a second or more for a long prompt), the focus is checked again. If the same app and window still have focus, the text is inserted. If focus has moved, nothing is inserted and the copy prompt appears, saying which app the text was meant for. The app does not try to bring the old window back.

**How. (my call)** Put the text on the clipboard, send a paste keystroke to the focused app, then restore what the clipboard held; typing it keystroke by keystroke is the alternative if paste proves unreliable in some apps. Terminals and many Electron or web apps expose little through Accessibility, so Accessibility is used to refuse, not to approve: paste unless Accessibility positively reports that the focused element does not take text (or there is no focused window at all). When it can't tell, paste. A paste of text into an app that doesn't take it does nothing. If the paste can't be sent, show the **copy prompt** for about 5 seconds with the text and a Copy button, and leave the text on the clipboard, so a manual paste also works.

**Who does the work. (my call)** Electron has no Accessibility API, so the native helper that watches the Right Option tap also reads the focused element and window title and sends the paste keystroke. The helper's contract with the app is the builder's to design.

### 4. History (always on, in the app)
Every dictation is stored in the app's own data, outside the library: time, text, `heard` (only when the dictionary changed something), app name and bundle id, window title, the site's domain when the app is a browser, duration, and whether it was inserted. The owner can open the list, copy any entry, and delete one. **(my call)** Deleting an entry, or "forget the last dictation", also removes it from the library's day file when the log is on, so each log entry carries a stable marker the app can find, and rewriting a day file happens under the library's lock so it can't collide with an append. **(my call)** The speech audio is discarded as soon as it is transcribed; only the text is kept anywhere. **(my call)** Kept without a limit by default, as the owner said "all inputs"; one line of text per dictation is small. **(my call)** A minimal window or pane built from existing `@avanzel/ui` components; its look is left to the builder and the design rules.

### 5. The library log (optional, off by default)
A switch in the library's `config.toml` **(my call: library config, because it governs what goes into the library)**. When on, each dictation is also appended to `raw/dictations/YYYY-MM-DD.md`, one file per day, in time order, each entry headed by the local time, the app and the window title, followed by the text. The day file carries `heard` only when it differs. **(my call)** `raw/dictations/` is kept out of git, so a file that changes a hundred times a day doesn't pad every commit and a deleted entry doesn't survive in git history. Two parts, following what the code does today: the library template's `.gitignore` gets the line for new libraries (as it has `raw/audio/`), and the repository's own `.git/info/exclude` gets it for libraries made before, written the way `excludeInboxAudio` in `packages/engine/src/core/git.ts` writes the inbox audio lines (added only when missing, the owner's own `.gitignore` left alone). Libraries the owner also syncs another way (Obsidian Sync, iCloud) are outside what Avanzel can promise; the settings text for the log says so in one plain line.

It is **not** written to `inbox/`, so it is never filed one by one. It is **not** a new top-level folder, because any such folder counts as a shelf the agent may file into. `raw/` is already read-only to the agent and survives undo.

Sizes, for planning: about 150 entries a day at about 300 characters is roughly 45 KB a day, roughly 1.5 MB a month.

### 6. What is recorded, and what is not (privacy defaults)
- **Skip list**, visible in settings, holding app bundle ids and, for browsers, site domains. It is seeded with password managers and Keychain Access. **(my call)** For a skipped app or site the text is still inserted but is stored nowhere: not in the history, not in the log. A site can only be checked where the address can be read (`front-app.ts`: Chrome-family browsers and Safari). For other browsers, such as Firefox, the site is unknown: the app and window title are recorded, and the list can only skip the app as a whole.
- **Secure text fields** (password boxes): inserted if the owner dictates there, stored nowhere. **(my call)**
- **Browsers**: the domain, not the full address (addresses carry tokens in their query strings). Chrome-family private windows are stored nowhere, like a skipped app, in the history as well as the log (their AppleScript reports it). Safari private windows can't be told apart, so they are stored unless the site is on the skip list; this is a stated limit. **(my call)**
- The window title is read as plain text and stays on the Mac. The only reader of the library log is the owner's own filing agent, as with the rest of the library.
- A "forget the last dictation" action in the history. **(my call)**

### 7. Evening review (last slice)
One extra agent run at the end of the evening review reads only that day's `raw/dictations/` file and writes a section into the digest: the conversations and decisions of the day, grouped by app and window, five to ten bullets, creating and editing no pages. Skipped when the log is off or the day's file is empty. If the file is very large, a trimmed copy goes to the agent (entries under about 15 characters dropped, headings kept). The project or agent session is not worked out when writing the log; the summary reads it from the window title. **(my call)** The agent's reading of `raw/` for exact words already lets Ask answer "what did I tell the agent about the dictionary today?" with no new code.

## Order of work

1. **Slice 1:** the Right Option tap helper, recording, the dictionary, insert, the copy prompt, the history with app and window context, the Accessibility permission step.
2. **Slice 2:** the optional day file, the skip list and the privacy defaults.
3. **Slice 3:** the evening summary run. **(my call)** Not planned in detail until the owner has used a week of day files; the file plus Ask may be enough.

The first plan covers slices 1 and 2.

## Unknowns, to be settled early by the builder on a real Mac

- Which permission the Right Option tap needs, and how the prompt reads when it appears from the signed app.
- Whether the window title can be read reliably in Electron and web apps, terminals and Slack; whether titles identify "the agent session and project" well enough. A week of day files will show this.
- Whether paste works in every app the owner uses (browsers, Slack, terminals, editors, Claude Code's input) or typing is needed for some.
- A tap while Option is part of another shortcut, and while an input method is switching.

## Names

**(my call)** In the codebase "dictate" already means "record a thought" (the `dictate` shortcut, "Record a thought"). This feature is called **cursor dictation** in code (`cursorDictation`, `cursor-dictation.ts`) and "Dictate into any app" to the owner, so the two are never mixed. The log folder keeps the owner's word: `raw/dictations/`.

## Left to the builder

The Swift helper's structure and messages, file and module names, how the history is stored, the exact wording of copy (within the design rules), the layout of the history window, and the tests.
