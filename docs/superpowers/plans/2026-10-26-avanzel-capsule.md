# Avanzel Phase 1c, "the capsule": every capture, from listening to filed, on the design system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the capsule, Avanzel's floating window for every capture, is rebuilt from `@avanzel/ui`, and the design checks' baseline becomes empty. A capsule filing gets what setup's first filing already has:
- the agent's steps, as one narration line;
- a time with an estimate;
- a real Stop, as setup's Cancel;
- a receipt that marks each page new or updated.

A long transcription can be stopped, and its recording waits in the inbox for the evening review. Every capsule problem speaks in 1e's voice.

**Architecture:**
- **The window stays as it is:** a 480×300 panel at the bottom centre, non-focusable and click-through. Its page arranges `@avanzel/ui` parts, bottom-aligned:
  - a `Card` with the person's words, once there are words;
  - above a `CapsuleBar` pill, which has a mood, a steady line and actions.
- **Problems are a `CapsuleNotice`.**
- **Main's capsule states gain the facts the windows need:**
  - the narration rows;
  - the start time and the estimate;
  - each page's new or updated flag;
  - a "nothing new" flag;
  - this capture's file mode;
  - the first-captures hint;
  - a slow transcription's flag;
  - when the evening review runs, for the lines that promise it.
- **The app keeps each agent's filing durations** in the run state, which gives the estimate.
- **What `@avanzel/ui` lacks is stood in for, never added.** As in 1f, each stand-in is an owner item.

**Tech Stack:**
- TypeScript (ESM, `.ts` import suffixes) and Node ≥ 22.
- Electron 44.9 with React 19 renderers bundled by esbuild, and `@avanzel/ui`.
- Vitest, and Playwright for Electron (`workers: 1`).

**Spec:** `reports/Avanzel UX and first-run design.md`. It is untracked; it lives in the main checkout at `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`. The sections used:
- §6.1 (the capsule and its states table);
- §6.2 (true narration, the estimate, terse mode);
- §6.3 (the receipt and Undo);
- §5.2 and §12 (record now, transcribe later: not in 1c, owner item 12);
- §7 (problems);
- §10 (accessibility).

The UI contract is `packages/ui/DESIGN.md`. 1b's narration plan, `docs/superpowers/plans/2026-10-22-avanzel-narration.md`, has the rows and lines setup uses.

The flight pack is `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/`. It is untracked, in the main checkout: write there only by absolute path. This machine's rules and known flakes are in `/tmp/avz-ds/1c-machine-rules.md`.

## Where this plan sits

Done on main (5778471):
- Phase 0;
- 1a (setup);
- 1b (narration and the guard);
- 1f (Settings, Quick and Ask on `@avanzel/ui`);
- 1e (problem copy, the first-run gaps, faster tests).

The capsule is the last window on the design checks' baseline (`packages/ui/checks/baseline.json`: two files). After 1c, the baseline is empty. 1d (the menu bar and sounds) comes after.

**Not in 1c:**
- **"Unsure"** (§6.1). Nothing in the engine or the agent reports uncertainty. A prompt change tested on real agents comes first.
- **Terse mode** (§6.2). The capsule shows one line anyway; a setting for no line waits.
- **Sounds.** These are 1d's, with their files.
- **The capsule growing from the notch, and live words while you talk.** These need Phase 3's native helper.
- **Keyboard focus for the capsule's buttons.** The panel stays non-focusable, as today, except while editing. This is an owner item.
- **Record now, transcribe later** (§5.2, §12). The shortcut still refuses to record while the model downloads. This is owner item 12.
- **The rest of §6.3:** Undo outliving the card (the menu's "Undo the last filing", Undo on the notification), "Show the last receipt", and "Your exact words are kept."
- **The receipt's proof lines** (§6.2: "Kept your exact words in raw/" and the snapshot line). Setup's window has them; the capsule's card doesn't.

## Global Constraints

### Scope

- **In:** Tasks 1–9 below.
- **No change in `packages/ui`.** No components, variants, tokens, gallery entries or screenshots.
  - The cleanup task lowers `packages/ui/checks/baseline.json` only through `npm run design:check -- --update-baseline`. DESIGN.md tells agents to run it after a migration, and the guard blocks only `--init-baseline`.
  - Where a part is missing, build the stand-in this plan names. This overrides the `avanzel-ui` skill's "When something is missing": nothing is added to `packages/ui`.

### The UI rules (from DESIGN.md)

- **The capsule page imports `"@avanzel/ui/base.css"` once, first.** Its `index.html` gets `data-backdrop="clear"`, as Quick's and up-here's do.
- **Windows arrange; they don't paint.**
  - Only `@avanzel/ui` components, with no raw `<button>`, `<input>`, `<textarea>`, `<svg>`, `<a>` or `<h1>`–`<h6>`. A screenshot thumbnail stays an `<img>`.
  - No `style`, and no `className` on components.
  - Window CSS lays out only, with `var(--av-space-N)`.
- **One primary per moment.** A problem's fix is its primary, last. `quiet` is for dismiss.
- **Every card that isn't a problem can be hidden.** The bar's actions start with Hide: an icon-only quiet Button, `icon="close"`, `label="Hide"`, which calls `capsule.dismiss()`. A filing goes on when its card is hidden, as today (spec §6.1). A problem keeps Hide (quiet) in its CapsuleNotice.
- **One bar for the whole capsule.** `Capsule` draws ONE `CapsuleBar` for every state that has a bar, in the same place of the same stack (a card if the state has one, the hint, then the bar), so its `role="status"` region stays mounted from listening through transcribing and filing to filed. A region drawn again for each state arrives with its line already in it, which a screen reader often does not read, and DESIGN.md says "the capsule announces only the start and the end of a filing". Each state file supplies a `Scene` (`scene.tsx`): its card, its hint and a `BarSpec` (mood, line, levels, start time and actions). A capsule shown from hidden still mounts a fresh region: that is owner item 5's. Problems stay `CapsuleNotice` (`role="alert"`).
- **Nothing ticks inside a live region.**
  - `CapsuleBar` is a `role="status"` region. Its line stays steady for a whole state, and its `time` prop is used only while listening, as the design system draws it. That case is an owner item, below.
  - A filing's seconds and its narration line live on the `Card`, which isn't a live region.
- **Keep ShelfTag chips, the Stamp and the person's words on the Card's paper,** never on glass, even while the words are edited. Chips and the Stamp fail contrast or blend on glass in light mode, and DESIGN.md keeps content off glass (`Hud`: not for content).
- **Zel speaks in the first person only through `Text variant="voice"`.** The capsule's lines here are written without "I".

### Behaviour every task keeps

- **No test runs a real agent or downloads a model.**
  - makeLibrary's `fake` harness plays the library's agent, and `launch()`'s stand-ins shadow `claude` and `codex` (`apps/mac/e2e/helpers.ts`).
  - A test where the app picks an agent itself (`auto`, or another agent for a fix) launches with `onlyAgentsIn(...)`, so nothing else on this Mac's PATH runs.
  - A test that clicks something that opens a page calls `stubOpening(app)` first.
- **A person's words are never deleted.** A stopped or failed filing leaves the note in `inbox/`. A recording kept by Stop waits in `inbox/` as audio, and a transcription that returns after Stop deletes nothing and writes nothing.
- **These stay as they are:**
  - the capsule's IPC channel names. New ones are added, and they answer only the capsule's own page (`isPageOf`, `windows.ts:24`), as 1e bound `settings:pick` and `ask:cancel`. A test presses them through the capsule page's bridge (`capsule.evaluate(() => window.avanzel.capsule.…())`), since `call()` has no sender;
  - the main-side state kinds' names (new fields are added);
  - the panel's size and position;
  - Esc while listening (cancel);
  - Return and Esc in the editor;
  - the auto-hide times. A stopped filing and a stopped transcription hide after 6 s, longer while hovered, as the others do.
- **Interface files are changed with the Edit and Write tools.** The design guard refuses shell writes to `apps/*/src/renderer` files, even a heredoc that names their paths.
- **The run state keeps every field.** `schedule.ts`'s `normalizeRunState`, `markChecked` and `markRan` must carry each new `RunState` field, or `tick()` erases it. 1e learned this.

### Copy

The copy rules hold: sentence case, no "!", the one-character "…", they/them, and display names for agents. A problem says what happened, what's safe, and one fix.

In the table:
- `{…}` is a value.
- `<⌥Space>` is a `Kbd` showing the real shortcut.
- Hide is the icon-only quiet Button from the UI rules.
- `{review}` is when the evening review runs, as `reviewTime` (Task 3) words it from the review's real schedule, the way `savedNote` does: "at 21:00" for a daily review, "on Sundays at 18:00" for a weekly one. It never says "tonight". While the review is off, the sentence that names it is left out.
- An action keeps its name through the flow (DESIGN.md): Stop, then "Stopped".

| State | The bar (mood, line, actions) | The card above it |
|---|---|---|
| Listening | `listening`, no line, `time` "0:07" (as the bar draws it), actions: this capture's file mode as one small secondary Button, "Files now", or for the evening mode the label `fileModeLabel` words from `review` (Task 6 fix round, ruled): "Files at 21:00", "Files on Sundays at 18:00", "Files at the evening review" (unreadable), "Stays in the inbox" (review off). It never says "tonight". Pressing it toggles. A screen comment and setup's first spoken thought show no toggle (`fileMode` null) | no card, except a screen comment's: a `Card` (`ruled={false}`, `label` the app's name) holding its thumbnail `<img>` (`ScreenshotCard`, which the Transcribing state draws too). For the first ten kept captures, a small `Hud` card above the bar: "<⌥Space> to finish, <Esc> to cancel" (footnote). Its key is `hint`, the shortcut that finishes this recording |
| Transcribing | `thinking`, "Transcribing on this Mac…" ("Transcribing…" for a command backend). Once the state turns `slow` (after 20 s): "Still transcribing…" with Stop (secondary, small). Never for setup's first spoken thought or a screen comment | for a screen comment, the same screenshot `Card` as Listening's, in the same place (the state carries `thumbnail` and `context`), so it is not drawn away while the words are made and drawn again, smaller, on the saved card. None for a dictation. |
| Filing | `thinking`, "Filing with {Claude Code}…", actions: Hide, Edit (secondary, small; only while `canEdit`, so not once Stop was pressed), Stop (secondary, small; `busy` while stopping) | `Card` with the words. `meta` (`filingMeta`): "{6} s of about {15}", then "{18} s" past the estimate; no meta while it waits, for the library or for its turn behind another of Avanzel's own runs. Footer: the newest narration line (`rowLine`), or "{Claude Code} is still working…" after 8 s with no new step, or "Waiting for another Avanzel run to finish…" while waiting (`filingLine`). Under it, "Typed note" or "Transcribed on this Mac in {1.4} s" ("Transcribed in {1.4} s" for a command backend; units as macOS writes them, ruled in Task 6), then `detail` when set (footnote) |
| Editing | — | a `Card` labelled "Edit before filing", with `ruled={false}`: the field draws the words, and the Card's ruling would drift across them. Its words are a `TextArea` labelled "Your words" (label hidden), and its footer holds `Actions`: Cancel (quiet), File (primary) |
| Filed | `filed`, "Filed by {Claude Code} in {6} s" (never "0 s": `Math.max(1, …)`, as setup's `filedHeading`), actions: Hide, Undo (secondary, small; busy from its press, and it answers once, as Stop does on the filing card), Open (primary, small) when there are pages | `Card` with the words, clipped to 3 lines while a receipt shows (the stamp stands where the first line would run on, so words that fill two lines on the filing card need a third here; 4 lines with no receipt), `stamp={{ word: "filed", date: stampDate(new Date()), animate: true }}` (the date taken once per card, by `useStampDate`). Footer: one row per page, at most 3, then "and {2} more" (caption). Each row has three parts: a `ShelfTag` chip when the page is on one of the six shelves (`isShelf`), else the folder's name as a caption; the title as a `Button variant="link"` that opens that page, cut after a word and ended with "…" when wider than 32 cells (`shortTitle`; a wide character counts as two); and a caption, "new" or "updated". A page without `created` reads as updated |
| Nothing new (`noted`) | `filed`, "Nothing new to file", actions: Hide, Undo when there is a commit | `Card` with the words, `stamp={{ word: "noted", date: stampDate(new Date()) }}`. Footer: "{Claude Code} noted it in the log." |
| Saved (evening mode, screen comment) | `filed`, "Saved", actions: Hide | `Card` with the words and `stamp={{ word: "saved", date: stampDate(new Date()) }}`. Footer: the existing note (`savedNote`, built on `reviewTime` like every card that names the review: "Saved to the inbox for the evening review at 21:00.", "Saved to the inbox for the evening review on Sundays at 18:00." for a weekly review, "Saved to the inbox." while the review is off), then `detail` when set (footnote). For a screen comment, the Card's `label` is the app's name, its words are clipped to 3 lines (2 when `detail` is set, for the panel has no room for a third beside a line about the recording that may take two), and its footer holds the thumbnail `<img>` and the title and URL (caption) above the note. A comment with no words shows `placeholder="No comment"` |
| Undone (`saved` with `undone: true`) | `filed`, "Undone", actions: Hide | `Card` with the words, no stamp. Footer: `undoneNote`, which follows the review as `savedNote` does (Task 7, ruled), and does not say Undone again, for the bar above it does: "Your words are back in the inbox for the evening review {review}." ("…for the evening review." when unreadable; "Your words are back in the inbox." while the review is off) |
| Stopped, a filing (`cancelled`) | `filed`, "Stopped", actions: Hide | `Card` with the words. Footer: setup's `cancelledLine(agent, partial, leftovers)` for this outcome (untouched; partial edits kept as their own commit; or "{Claude Code}'s partial edits stay as they are, because nothing recorded them." in a library without git or with automatic commits off, the one sentence every card that tells it uses), then "The evening review files your words {review}." ("…files your words." when unreadable; left out while the review is off). It says "your words", for `cancelledLine` has just said what is in the inbox, and "it" would read as the commit or the agent's edits (Task 7, ruled) |
| Stopped, a transcription (`recorded`) | `filed`, "Stopped", actions: Hide | `Card` with no words, `placeholder="Your recording"`. Footer: "It's in the inbox. The evening review turns it into words and files it {review}." (With the review off: "It's in the inbox.") |
| Problem | — | `CapsuleNotice`: title, body (what's safe, a command in the code face as in the windows), actions: Hide (quiet), then the fix (primary) when there is one |
| Preparing, model failed, shortcut taken | already on `@avanzel/ui`. Preparing's headline is a sentence, with its full stop, as the failed download's title is: "The speech model is still downloading."; its Zel idles and looks right, towards the words, and not out at the person (DESIGN.md). The shortcut still refuses to record while the model downloads (owner item 12) | — |
| Shortcut picked | `filed`, "{Record a thought} now uses <⌃⇧Space>", the shortcut a `Kbd`, as the hint sets its keys. It is a bar in the stack like the others, so the page's wrapper, which takes no pointer, does not hide it under the pointer | — |

**The six capsule problems 1e left in the old voice** (1e's final review, M10) are rewritten in three parts, each a builder in `shared/problems.ts` with its unit test. The Today column keeps the old texts and the plan's line numbers, which have moved; the builders are named in the New title column. The first problem and the third each split in two: a screen comment whose recording can't start is no screen that couldn't be captured. Use the facts at each call site, and keep only what is true:

| Today | New title | New body | Fix |
|---|---|---|---|
| "Couldn't capture the screen" (`controller.ts:736`) | "Avanzel couldn't capture the screen." (`screenCaptureProblem`) | "{reason, through ownLine} Nothing was saved." To keep that true, the catch first removes the screenshot if it was claimed (`rmSync(shotPath, { force: true })`) | none |
| the same catch, when `startRecording` threw (Task 8, ruled: the old title was untrue for it) | "The screen comment couldn't start." (`commentNotStartedProblem`) | "{reason} Nothing was saved." The screenshot is removed first | none |
| "The recording didn't arrive" (:858) | "The recording didn't arrive." (`recordingLost`) | "Nothing was saved. Is the right microphone selected?" | Choose microphone (`open-settings:voice`) |
| "Couldn't transcribe that" (:977), when no words were made (`text` empty) and it is not a screen comment | "The recording couldn't be turned into words." (`unheardProblem`) | "{reason} Your recording is kept in {raw/audio/…}." Only if it is; otherwise "Nothing was saved." | none |
| the same catch, when the words were made but not saved (`text` set), and for every screen comment, whatever its words (Task 8, ruled) | "Your words couldn't be saved." ("The screen capture couldn't be saved." for a screen comment; `unsavedProblem`) | "{reason} Your recording is kept in {raw/audio/…}." Only if it is; otherwise "Nothing was saved." For a screen comment, whose screenshot nothing holds and is removed: "{reason} The screenshot is gone. Your recording is kept in {raw/audio/…}." or "{reason} The screenshot is gone, and nothing was saved." | none |
| "Couldn't save your edit yet" (:1693, `keepEdit`'s notification; the card at :1651-1656 already uses `correctedWordsProblem`) | "Your corrected words weren't saved yet." (`correctedWordsProblem`) | the body of `correctedWordsProblem(lastLines(errorMessage(error)), existsSync(job.capturePath), CAPSULE_LINE_MAX)`: one paragraph, built like its siblings, `sentences(shortReason(<the error's last lines, joined into one>, lineMax), …)`: the reason as a sentence, cut to the card's room and never inside a path (`shared/clip.ts`), then "Your corrected words are saved to the inbox when you quit; the original note is still there." (the clause after the semicolon only while it is). It has no line break, for the card gives each its own paragraph | none |
| "Couldn't save that thought" (:1926) | "That thought couldn't be saved." (`thoughtNotSavedProblem`) | "{reason} Your words are still in “Type a thought”." The body names that window by its action's name, as the menu bar does, never by a shortcut glyph in plain text (Task 8, ruled) | Type a thought (`type-a-thought`: it reopens Quick with the words) |
| "Avanzel can't use these voice settings" (:2658) | "Avanzel can't use the voice settings in this library's config file." (`voiceSettingsProblem`) | "{reason} Typed thoughts are still saved to the inbox." (Task 8, ruled: "Typing a thought works meanwhile." over-promised, for a config file that doesn't parse stops a typed thought's filing too; Settings → Voice tells it in the same words) | Open Settings (`open-settings:voice`) |

**Three more problems in the same voice,** which had no old text (the third is a notification). Task 8 gave them builders too, from carry-overs of Tasks 3, 5 and 7:

| When | Title | Body | Fix |
|---|---|---|---|
| Stop on a slow transcription whose recording can't move to the inbox (`stopFailedProblem`) | "Avanzel couldn't move the recording to the inbox." | "{reason, never cut inside a path} The transcription goes on, and your recording is in {raw/audio/…}." ("…goes on, but no copy of your recording is saved." when the library keeps none) | none |
| Stop on a filing the agent had finished, whose take-back git refuses (`stopRefused`); a notification says the same when its card is gone | "Stop couldn't take back a filing that had finished." | "Usually a later change touched the same lines. The library's history keeps both versions." | none: Show history is unbuilt (1e's owner item 3), so Hide alone. Undo that git refuses (`undoRefused`) is a card of the same kind, titled "This one can't be undone automatically." |
| A Stop whose card has gone (hidden, or replaced by another recording's) and whose run's edits stay (`stoppedNotice`) | a notification, "Stopped, but some edits stay in your library." | the Stopped card's own words (`stoppedLine`). Nothing is sent when the stop left the library as it was | — |

### Process

- **One commit per task.** The subject is `area: a sentence saying what now happens`, with a bulleted body and no trailers.
- **Each task's gate:**
  - from the worktree root: `npm test -w @avanzel/mac`, `npm test -w @avanzel/engine` when the engine changed, `npm run typecheck` and `npm run design:check`;
  - from `apps/mac`: `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test <the specs the task names>`.
- **The full e2e suite** runs only in Task 9.

### Owner items

These need the owner's approval, or are the owner's choice:
1. **A hint slot on the CapsuleBar.** The stand-in is a small Hud card above the bar.
2. **A file-mode chip.** The stand-in is a small secondary Button whose label is the mode. A `Segmented` "Now | Tonight" would tell VoiceOver the mode; the owner picks.
3. **A clickable page chip that says new or updated.** The stand-in is a ShelfTag, a link Button and a caption, on the Card. The `Receipt` pattern doesn't open pages or mark new and updated.
4. **Undo's countdown ring.** There is none: the card holds while hovered, as today.
5. **CapsuleBar's live region.** Its `role="status"` covers the ticking `time` while listening, so VoiceOver may read the timer. The fix is in `packages/ui`: hide the time from VoiceOver, or narrow the status. While listening, the time is all VoiceOver hears: the bar has no line, and Zel and the wave are hidden from it.
6. **The card landing and dropping away (700 ms drawer), and a 600 ms stamp.** The Stamp lands in 380 ms today, and nothing uses the drawer token.
7. **Unsure, with its shelf picker.** Not built.
8. **Zel on the Card.** There is none; Zel is in the bar.
9. **Keyboard focus for the capsule's buttons.** The panel takes focus only while editing, and `setCapsule` gives the keyboard back (`win.blur()`, once) when a state replaces the editor, so the person's next keys go to the app they were in and not to the card's Hide. By hand: after File or Cancel, typing goes back to the app you were in.
10. **The pairs of fixes from §7.** CapsuleNotice offers one fix by design. The pairs are "File it with Codex now / Wait until 15:00", "Open Terminal / Use another agent" and "Open System Settings / Type instead".
11. **Long words.** The Card shows its words clipped by the window's layout (a max height). A Card fade for long thoughts is 1a's owner item.
12. **Record now, transcribe later.** The shortcut still refuses to record while the model downloads (the capsule says so and offers Type instead). Recording into the inbox and filing it when the model arrives needs a model-arrival seam for tests and an engine option to keep the recording's time.
13. **An editable card.** The person's words are edited on the Card's ruled paper. The stand-in is a `TextArea` inside the Card's lines.
14. **A calm bar mood.** `CapsuleBar` has only `listening`, `thinking`, `filed` and `needs-you`, so Stopped and Undone show Zel `filed`. Setup's window uses `idle` for them.
15. **File it again, on a stopped filing.** §5.2 offers it, and setup has it. The capsule's Stopped card has none: the note waits in the inbox.
16. **A framed screenshot on the Card.** On white paper a white page has no edge (the old card had a radius and a hairline). The stand-in is an unframed `<img>`: 192×120 on a screen comment's listening card and the transcribing card that keeps it, 96×60 on its saved card. A framed thumbnail belongs in `packages/ui`.
17. **What Undo does with the words.** Undo puts the words back in the inbox, and the evening review files them again (the Undone card says so). Should Undo keep them out of the review, or offer to delete them?

## Review Focus

1. **A filing that ends while the card is hidden or replaced.** The narration rows, estimate and receipt belong to their job. A newer capture's card never shows an older job's rows or receipt. A filing whose card is gone ends in its notification ("Filed by {agent}" and its first page, `controller.ts:1153`), never on a newer card. Task 2 pins it.
2. **Stop pressed as the run ends.** Stop arrives after the agent finished but before the result is shown:
   - A run that filed and left a commit is taken back, and the card says Stopped.
   - A run that filed with no commit to take back (no git, or auto_commit off) stands, and the card says Filed.
   - If git refuses to take back a finished filing, the card is `undoRefused`, never "back in the inbox".
   - A second Stop does nothing, and Edit after Stop does nothing.

   Task 3 pins it, with a unit test of the decision (`afterStop`).
3. **A transcription that returns after Stop.** Stop moves the recording to `inbox/` and shows Stopped. The transcription itself can't be stopped, so it ends later. Its result is dropped: no capture, no deletion and no card, and the inbox holds one `.wav`. Task 5 pins it.
4. **The run state with the new durations.** A malformed or huge list is dropped or capped (the last 10 per agent, by `withDuration` and `normalizeRunState`), and `tick()` keeps it. The estimate falls back to 15 with fewer than 3 durations. Task 2 pins it.
5. **The first-captures hint counts kept captures only.** A filed or saved capture counts, and so does a recording kept by Stop (Task 5). A cancelled recording (Esc), one with no speech and one that failed don't count, and the count survives a restart. Task 4 pins it.

---

### Task 1: A streaming run keeps only the end of its output, and the folder watch reuses the librarian's snapshot

1b's deferred items for 1c, recorded in the flight pack's `archive/ledgers/1b-narration-ledger.md` (line 143). The third, `disableAllHooks: false` in the guard's settings, stays 1b's owner item 3.

**Files:**
- Modify:
  - `packages/engine/src/core/harness.ts` (`collect`, about :527–604);
  - `packages/engine/src/core/claude-stream.ts` (`#plain`, about :36, :48, :77);
  - `packages/engine/src/core/watch.ts` (`stop()`, about :72–87);
  - `packages/engine/src/core/librarian.ts` (the snapshot after the run, about :345, and `narrate`, about :600–622).
- Test: `packages/engine/test/core/harness-run.test.ts`, `claude-stream.test.ts` and the watch test.

**Interfaces:**
- **Produces:** `collect` keeps at most the last 64 KB of stdout. Name the constant, e.g. `OUTPUT_TAIL_BYTES`. `ClaudeStream`'s plain lines keep the last 200. `watchWrites(root, before, onStep)` returns `(after?: Snapshot) => void`. Given `after`, it reports what is left from it, instead of taking its own snapshot. `narrate(...)` returns `stop: (after?: Snapshot) => void`.

- [ ] **Step 1: Write the failing tests:**
  - a run printing 1 MB keeps its last 64 KB, and `errorLine` still finds the final error line;
  - a stream with 1,000 non-JSON lines keeps the last 200 for its reply fallback;
  - `stop(after)` reports what is left from `after`, not from the folder: given a snapshot that differs from the folder, the steps follow the snapshot.
- [ ] **Step 2: Run** `npm test -w @avanzel/engine -- harness-run claude-stream watch`. Expected: the new cases fail.
- [ ] **Step 3: Implement.**
  - `#run` takes one snapshot right after `runHeadless` returns or throws.
  - It hands that snapshot to `narration.stop(after)`, which still runs before the guard, as today.
  - It returns the snapshot, and `#fileOne`'s diff (`librarian.ts:345`) uses it, whether or not the run was narrated. `ask` and `review` keep their own snapshots, taken after the guard.
  - The diff then runs before the guard and the capture's restore. It finds the same changes, because `.without([...SOURCES, ...guarded])` drops what those touch. The engine suite pins this.
- [ ] **Step 4: Run** `npm test -w @avanzel/engine` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** as `engine: a long run keeps only the end of its output, and the folder watch shares the librarian's snapshot`.

### Task 2: A capsule filing narrates its steps, knows about how long it takes, and marks each page new or updated

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`:
    - `runFiling` passes `steps` for capsule jobs too (today only setup's, about :1118–1119). Background filings (`fileInBackground`) stay unnarrated;
    - the job's rows and seconds;
    - the filed and noted states;
  - `apps/mac/src/main/jobs.ts` (`FilingJob.startedAt`);
  - `apps/mac/src/main/narration.ts` (`STEP_MS` and `stepThrottle`, moved from setup);
  - `apps/mac/src/main/setup.ts` (`Setup.stepped` uses `stepThrottle`, its behaviour unchanged);
  - `apps/mac/src/main/schedule.ts` (`RunState.durations`, carried by every helper; `withDuration` and `estimateSeconds`);
  - `apps/mac/src/main/run-state.ts`;
  - `apps/mac/src/main/library-info.ts` (`filedPages` sets `created` from `changes.created`);
  - `apps/mac/src/shared/ipc.ts`:
    - the `filing` state gains `rows: NarrationRow[]`, `startedAt: number`, `estimate: number` and `stepAt: number`;
    - the `filed` state gains `noted: boolean`;
    - `FiledPage` gains `created?: boolean`. Setup, Ask and the menu leave it unset, and the capsule reads a page without it as updated.
- Test:
  - `apps/mac/test/schedule.test.ts`, `run-state.test.ts` and `library-info.test.ts`. Their exact `{ checked, ran, waiting }` literals and assertions (`schedule.test.ts:63–115`, `run-state.test.ts:8–52`) gain `durations: {}`;
  - a new `apps/mac/test/estimate.test.ts`;
  - `apps/mac/e2e/filing.spec.ts`;
  - `apps/mac/e2e/contrast.spec.ts`: its typed filing literals gain `rows: [], startedAt: Date.now(), estimate: 15, stepAt: Date.now()`, and its filed literal gains `noted: false`.

**Interfaces:**
- **Produces:**
  - `RunState.durations: Record<string, number[]>`, the last 10 filing seconds per harness, without the time spent waiting for the library;
  - `withDuration(durations: Record<string, number[]>, harness: string, seconds: number): Record<string, number[]>`, which keeps the last 10 per harness. The key is the harness that ran, never "auto";
  - `estimateSeconds(durations: readonly number[]): number`: the median rounded to whole seconds, or 15 with fewer than 3. With an even count, the median is the mean of the middle two. It lives in `schedule.ts`, beside `withDuration`;
  - `FilingJob.startedAt: number`;
  - the state fields above. `noted` is true when the outcome is `ok` and no page is filed.

  Steps reach the capsule at most every 250 ms, as setup's do. `STEP_MS` and `stepThrottle(send: () => void)` (a leading send, one trailing send, `cancel()`) move from `setup.ts` (:162, :1038–1053) to `main/narration.ts`, and both windows use them.

- [ ] **Step 1: Write the failing tests:**
  - **Unit:**
    - `estimateSeconds`: [] gives 15, [10, 12] gives 15, [10, 12, 30] gives 12, [10, 12, 30, 40] gives 21;
    - `withDuration`: an eleventh value keeps the last 10;
    - `normalizeRunState`:
      - keeps `durations`;
      - drops non-numbers, negatives and non-finite values;
      - caps a list of 50 at its last 10;
      - doesn't read a state that has only `durations` as the legacy format (`schedule.ts:88`);
    - `markChecked` and `markRan` keep `durations`.
  - **e2e, `filing.spec.ts`:**
    - **"a capsule filing shows the agent's steps".** Launch as `setup-filing.spec.ts:59` does:
      - `filingClaude({ FAKE_AGENT_STREAM: "claude" })` on PATH;
      - a library whose harness is `claude`;
      - `FAKE_AGENT_STEP_MS: "1000"`.

      Poll `capsuleStateForTests` until `rows` holds a `read` row and a `new` row. `sentToCapsule` won't do: it records kinds only.
    - **"a filing's pages say new or updated".** Seed `goals/run.md`. File with a `claude` stand-in (`answerAs`) that writes `ideas/<new>.md`, appends to `goals/run.md` and adds its log line. The filed state's pages are `[{ path: "ideas/…", created: true }, { path: "goals/run.md", created: false }]`. The fake agent's own filing won't do: it edits only `index.md` and `log.md`, which aren't pages.
    - **"a log-only filing is noted".** Use `FAKE_AGENT_MODE: "logonly"` (`fake-agent.mjs:337`). The filed state has `noted: true` and `pages: []`.
    - **"durations are kept per agent".** After two filings, `run-state.json` in the launch's `AVANZEL_USER_DATA` lists two durations for that harness.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
  - The seconds start when the run has the library. No filing sends `LOOKING`; only `ask()` does.
    - `FilingJob.startedAt` is `Date.now()` when the job is made.
    - `filingProgress` (`controller.ts:1067–1073`) resets it when `waiting` turns false, as `Setup.waiting` does (`setup.ts:1022–1028`).
    - The duration kept runs from `startedAt` to the outcome.
  - The rows belong to the job. A newer job's state never carries an older job's rows.
  - A step updates the capsule only while `this.job === job && this.capsuleState.kind === "filing"`. It sets `capsuleState` and sends `capsule:state` directly, as `followDownload` does (`controller.ts:2645–2646`): no menu rebuild, no show and no hide-timer reset.
- [ ] **Step 4: Run** `npm test -w @avanzel/mac`, typecheck and design:check. Then build and run `e2e/filing.spec.ts e2e/app.spec.ts e2e/setup-filing.spec.ts`. Expected: all pass. Setup's narration is unchanged.
- [ ] **Step 5: Commit** as `mac: a capsule filing narrates its steps, learns how long filings take, and marks each page new or updated`.

### Task 3: Stop ends a capsule filing and gives the words back

The person sees Stop, then "Stopped"; the code keeps setup's names (`cancelFiling`, `cancelled`).

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts` (a capsule Stop, reusing setup's path: abort, then `takeBack` once the run is over; `edit()` ignores a stopped job);
  - `apps/mac/src/main/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/shared/ipc.ts` (`capsule.cancelFiling()`, the `cancelled` capsule state and the filing state's `cancelling`);
  - `apps/mac/src/main/setup-model.ts` (`afterStop`, beside `unrecordedEdits`);
  - `apps/mac/src/main/schedule.ts` (`reviewTime`, beside `savedNote`).
- Test: `apps/mac/e2e/filing.spec.ts`, `apps/mac/test/setup-model.test.ts` and `apps/mac/test/schedule.test.ts`.

**Interfaces:**
- **Consumes:**
  - setup's cancel flow: `cancelSetupFiling` in `setup.ts` (about :965–979) and `takeBack`;
  - `unrecordedEdits` (`setup-model.ts:101`).

  The capsule's renderer reads `cancelledLine` (`renderer/setup/copy.ts`, about :189–193) in Task 7.
- **Produces:**
  - `capsule.cancelFiling(): void` (channel `capsule:cancel-filing`, the capsule's page only);
  - the `cancelled` state `{ text, agent, partial, leftovers, review: string | null }`, where `review` is `reviewTime`'s;
  - the filing state's `cancelling?: true`, from Stop until the stop is over. The library lock's wait can't be aborted (`vault.ts:313–329`), so this can take a while;
  - `afterStop(outcome: Pick<FileOutcome, "ok" | "commit"> | undefined): "filed" | "take-back"`. It returns "filed" when the run filed and left no commit to take back;
  - `reviewTime(review: { schedule: string; enabled: boolean } | null): string | null`, built on `savedNote`'s reading of the schedule (`schedule.ts:22–29`):
    - "at 21:00" for "daily 21:00";
    - "on Sundays at 18:00" for "weekly sun 18:00";
    - "" for a schedule it can't read (the sentence then names no time);
    - null while the review is off.

- [ ] **Step 1: Write the failing tests:**
  - **Unit:**
    - `afterStop`: a filed run with no commit gives "filed". A filed run with a commit, a failed run and no run at all give "take-back".
    - `reviewTime`: daily, weekly, unreadable and off.
  - **e2e:**
    - **"Stop ends the filing and the note stays in the inbox".** Use `dictateToStallingAgent` (`filing.spec.ts:47`): `slow-once` writes `goals/half.md` and a line in `index.md`, then hangs. Stop while filing gives the `cancelled` state. Then check:
      - the agent process is gone (`FAKE_AGENT_RECORD`'s pid, with `alive()`);
      - the note is in `inbox/`;
      - the partial edits are taken back: `goals/half.md` is gone.
    - **"Stop as the run ends doesn't take back a finished filing".** Stop arrives after the result. The filed state stays, and nothing is reverted. `afterStop`'s unit test pins the window between the agent's exit and the result.
    - **"a second Stop does nothing"** and **"Edit after Stop does nothing"**.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** The note stays in `inbox/`.
  - Once the stopped run is over:
    - When `afterStop` says "filed", the filing stands, and the capsule shows `filed`, as `runFiling` would.
    - Otherwise `takeBack` runs. A finished filing that git refuses to take back shows `undoRefused`.
    - Anything else shows `cancelled`: `partial` when the takeBack failed, and `leftovers` from `unrecordedEdits`.
  - `edit()` does nothing once `job.cancelled`. `cancelFiling()` does nothing once `job.edited`, or unless `this.job === job && this.capsuleState.kind === "filing"`.
  - The Stopped card's copy is Task 7's.
- [ ] **Step 4: Run** the unit tests, typecheck, design:check, then `e2e/filing.spec.ts e2e/app.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: Stop ends a filing in the capsule and gives the words back to the inbox`.

### Task 4: Each capture can switch between now and tonight, and the first ten captures teach the keys

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`: the listening state carries `fileMode` (this capture's, from the setting) and `hint`. A toggle changes this capture's mode only, and the stop uses it: `afterCapture` reads `recording.fileMode`, not the setting.
  - `apps/mac/src/main/jobs.ts`: `Recording.fileMode: FileMode | null`. It is null for a screen comment, and for setup's first spoken thought, which its step files whatever the mode.
  - `apps/mac/src/main/store.ts`: a capture count kept beside the first-run log, in Avanzel's own folder (`captures.json` in its user data).
  - `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/main/ipc.ts` (`capsule.toggleFileMode()`).
- Test:
  - `apps/mac/test/store.test.ts`;
  - `apps/mac/e2e/app.spec.ts`;
  - `apps/mac/e2e/contrast.spec.ts`: its typed listening literal gains `fileMode: "now"` and `hint: "Alt+Space"`.

**Interfaces:**
- **Produces:**
  - `listening` gains `fileMode: FileMode | null` (null where there is no toggle) and `hint: string | null`.
    - `hint` is the accelerator that finishes this recording: dictate's, or capture's for a screen comment. It is set while fewer than 10 captures have been kept and that shortcut is registered; null otherwise.
    - The capsule shows it with `prettyAccelerator` (`main/shortcuts.ts:36`).
  - `capsule.toggleFileMode(): void` (channel `capsule:toggle-file-mode`, the capsule's page only).
  - A capture counts once the library keeps it: its words are filed or saved, or (Task 5) Stop keeps its recording. An Esc, a no-speech result and a recording that failed don't count.

- [ ] **Step 1: Write the failing tests:**
  - **Unit:** the count round-trips and survives a malformed file.
  - **e2e:**
    - toggling to tonight, then stopping, gives the saved state with "…for the evening review at 21:00" (the evening review on), and nothing is filed. Toggle through the capsule page's bridge, since there is no button until Task 6;
    - the next capture starts at the setting's mode again;
    - `hint` is the dictate shortcut on the first capture, and null after ten kept captures. To seed the count, launch with a prepared `AVANZEL_USER_DATA` holding `captures.json`; `launch()` lets a test pass its own (`helpers.ts:241–248`);
    - an Esc doesn't count.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck, design:check, then `e2e/app.spec.ts e2e/recording.spec.ts e2e/setup-spoken.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: a thought can be filed now or tonight from the capsule, and the first ten teach the keys`.

### Task 5: A long transcription has a way out

Recording before the model arrives is not in 1c (owner item 12): the shortcut still refuses to record while the model downloads.

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`:
    - a transcription that runs past `AVANZEL_TRANSCRIBE_STOP_MS` turns the transcribing state `slow`, which offers Stop. This never happens for setup's first spoken thought, whose window shows its own progress, nor for a screen comment, whose words and screenshot are saved together (`captureScreen`, `controller.ts:940–945`);
    - Stop moves the recording to `inbox/` as an audio capture the engine's queue recognises (`vault.pending()` lists audio), and shows the `recorded` state;
    - a transcription that returns after Stop is dropped;
    - a recording kept by Stop counts toward Task 4's count;
    - with `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS` set, the fake transcript arrives only after that many ms;
  - `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/main/ipc.ts` (`capsule.stopTranscribing()`, `transcribing.slow` and the `recorded` state).
- Test: `apps/mac/e2e/recording.spec.ts`.

**Interfaces:**
- **Produces:**
  - `transcribing` gains `slow?: true`, set once the transcription has run for `AVANZEL_TRANSCRIBE_STOP_MS`. It is left out before then, so `filing.spec.ts:1522`'s `toEqual` still holds;
  - `capsule.stopTranscribing(): void` (channel `capsule:stop-transcribing`, the capsule's page only);
  - the `recorded` capsule state `{ review: string | null }` (`reviewTime`, Task 3);
  - the test variables `AVANZEL_TRANSCRIBE_STOP_MS` (default 20000) and `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS` (default 0), read under `AVANZEL_TEST=1` only.
- **Consumes:** the engine's inbox-audio transcription in `#fileQueue` (`librarian.ts`, about :268–283), which the evening review runs; `app.spec.ts:969` already pins it. The engine stamps the capture with the review's time (`librarian.ts:176–182`). Keeping the recording's time is owner item 12's engine option.

- [ ] **Step 1: Write the failing e2e tests** in `recording.spec.ts`, launched with `AVANZEL_FAKE_AUDIO`, `AVANZEL_FAKE_TRANSCRIPT` and `AVANZEL_TRANSCRIBE_STOP_MS: "500"`:
  - **"a long transcription offers Stop, and its recording waits in the inbox".** With `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "60000"`, the transcribing state turns `slow`. Stop, pressed through the capsule page's bridge, gives the `recorded` state, and then:
    - `inbox/` holds one `.wav`;
    - none is left in `raw/audio/`;
    - no capture is written;
    - the capture count is 1.
  - **"a transcription that returns after Stop is dropped".** With `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "3000"`, once the delay has passed:
    - the inbox still holds the one `.wav` and no `.md`;
    - `raw/audio/` is still empty;
    - the capsule never showed an error or a filing (`watchCapsule` and `sentToCapsule`, `setup-helpers.ts:43–57`).
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Never delete the recording.
  - Stop marks the transcription stopped. It needs a field such as `this.transcribing = { recording, audioPath, samples, stopped }`, because `this.recording` is already null by then (`controller.ts:915`).
  - Stop renames the `.wav` from `raw/audio/` to `inbox/<its name>`: never a copy, and never over another file. A recording the library had no `raw/audio/` path for (`controller.ts:988–999`) is written to `inbox/` instead. Stop then shows `recorded`.
  - The transcription itself can't be stopped (`Transcriber` takes no signal). When a stopped one returns, its result is dropped: no capture, no `rmSync` and no card.
- [ ] **Step 4: Run** the unit tests, typecheck, design:check, then `e2e/recording.spec.ts e2e/filing.spec.ts e2e/app.spec.ts e2e/setup-spoken.spec.ts`. Expected: all pass. Setup's first thought is unchanged.
- [ ] **Step 5: Commit** as `mac: a long transcription can stop, and its recording waits in the inbox for the evening review`.

### Task 6: The capsule listens, transcribes, files and edits on the design system

**Files:**
- Modify:
  - `apps/mac/src/renderer/capsule/main.tsx`, `index.html` and `styles.css`;
  - `apps/mac/src/shared/transcribing.ts` (`filingMeta`).
- Test:
  - `apps/mac/test/transcribing-copy.test.ts` (`filingMeta`);
  - `apps/mac/e2e/app.spec.ts`, `filing.spec.ts`, `recording.spec.ts` and `microphone.spec.ts`;
  - `contrast.spec.ts` (its `capsuleStates()` texts: "Auto" becomes "Files now", and "Filing with Claude Code…" stays).

**Interfaces:**
- **Produces:** `filingMeta(seconds: number, estimate: number): string`. It gives "6 s of about 15" below the estimate, and "18 s" from it. Setup's `workingLine`, whose estimate is a fixed 15, stays as it is.
- **Consumes:**
  - Task 2's `rows`, `startedAt`, `estimate` and `stepAt`, and `rowLine` (`renderer/common/narration.ts:34`);
  - Task 3's `cancelFiling` and `cancelling`;
  - Task 4's `fileMode`, `hint` and `toggleFileMode`;
  - Task 5's `slow` and `stopTranscribing`;
  - `CapsuleBar`, `Card`, `Hud`, `Text`, `Kbd`, `Button` (with `icon="close"` for Hide), `Actions` and `TextArea` from `@avanzel/ui`.

- [ ] **Step 1: Read** `packages/ui/DESIGN.md` and invoke the `avanzel-ui` skill (`.claude/skills/avanzel-ui/SKILL.md`). The plan's stand-ins override the skill's "When something is missing": nothing is added to `packages/ui`.
- [ ] **Step 2: Write or update the e2e tests** for the listening, transcribing, filing and editing rows of the Copy table:
  - the bar's line and actions by role and name, Hide among them;
  - the card's meta and footer text, `detail` included (`app.spec.ts:142–161`);
  - the hint's `Kbd`;
  - the toggle's label changing;
  - "Still transcribing…" with Stop;
  - "{Claude Code} is still working…" after a quiet 8 s, with `FAKE_AGENT_DELAY_MS: "9000"` and `FAKE_AGENT_DELAY_TASK: "file"`. Not `FAKE_AGENT_STEP_MS`: it pauses before every step, which passes makeLibrary's 30 s timeout;
  - Edit, and the editor's Cancel and File, as today, with the editor's words on the Card.

  Update the tests that looked for the old filing card's texts. The error card, its "×" and the button lists that hold it stay as they are until Task 8: `app.spec.ts:285`, and `filing.spec.ts:203, 344, 428, 543, 573, 585, 608, 683, 716, 863, 902`.
- [ ] **Step 3: Run** them against the old capsule. Expected: they fail.
- [ ] **Step 4: Implement the four states.**
  - The page arranges a Card above the CapsuleBar, bottom-aligned, in the 480×300 window.
  - Long words are clipped by a max height on the Card's box (layout CSS only, owner item 11).
  - The bar's line never ticks.
  - The editor is a Card whose words are a `TextArea` (owner item 13), not a Hud.
- [ ] **Step 5: Run** the unit tests, typecheck, design:check, then build and run `e2e/app.spec.ts e2e/filing.spec.ts e2e/recording.spec.ts e2e/microphone.spec.ts e2e/contrast.spec.ts`. Expected: all pass.
- [ ] **Step 6: Commit** as `mac: the capsule listens, transcribes, files and edits on the design system`.

### Task 7: The capsule's results (filed, nothing new, saved, undone, and the two Stopped cards) on the design system

**Files:**
- Modify:
  - `apps/mac/src/renderer/capsule/main.tsx` and `styles.css`;
  - `apps/mac/src/main/controller.ts`, `apps/mac/src/main/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/shared/ipc.ts` (`capsule.openPage(path)`, and `saved.undone`).
- Test: `apps/mac/e2e/app.spec.ts`, `filing.spec.ts`, `contrast.spec.ts` and `packaged.spec.ts` (text only).

**Interfaces:**
- **Produces:**
  - `capsule.openPage(path: string): void` (channel `capsule:open-page`, the capsule's page only). It opens `path` only when it is one of `this.job.pages`. Ask's `ask:open-page` stays as it is: setup's Filing and Ask steps use it (`Filing.tsx:196`, `Ask.tsx:190`);
  - the `saved` state gains `undone?: true`, set by Undo (`controller.ts:1804–1806`), which the capsule shows as the Undone row.
- **Consumes:**
  - Task 2's `FiledPage.created` (optional: a page without it reads as updated) and `noted`;
  - Task 3's `cancelled` and Task 5's `recorded`;
  - `cancelledLine`, `stampDate` and `isShelf` (`renderer/setup/copy.ts:189, 31, 237`);
  - `Card`, `Stamp` (through `Card stamp`), `ShelfTag`, `Button variant="link"`, `Text` and `CapsuleBar mood="filed"`.

- [ ] **Step 1: Write or update the e2e tests** for the result rows of the Copy table:
  - the filed card's stamp: `role="img"`, named "Filed, {date}", with the date from `stampDate`;
  - each page row: chip, link title and new/updated caption.
    - A page off the six shelves shows its folder's name.
    - Four pages show three rows and "and 1 more".
    - Clicking a title opens that page. Call `stubOpening(app)` first; then `openedWith(app)` lists it (`helpers.ts:470, 484`);
  - Hide, Undo and Open;
  - the noted, saved, undone and both stopped cards. A screen comment's saved card shows its context.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Add `capsule.openPage(path)` as above. Never loosen Ask's channel.
- [ ] **Step 4: Run** the unit tests, typecheck, design:check, then `e2e/app.spec.ts e2e/filing.spec.ts e2e/contrast.spec.ts`. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: the capsule's results stamp the card and list each page, new or updated, on the design system`.

### Task 8: Every capsule problem is a CapsuleNotice in 1e's voice, and the capsule leaves the design baseline

**Files:**
- Modify:
  - `apps/mac/src/renderer/capsule/main.tsx` (the `error` state as `CapsuleNotice`, with the command in the code face through `renderer/common/problem.tsx`);
  - `styles.css`, which keeps layout only and may disappear;
  - `apps/mac/src/main/controller.ts`:
    - the old-voice problems in the Copy table's second table;
    - `fail()` gains `command`, which `filingFailed`, `unwatch` and `unkeepCard` pass on (`controller.ts:680, 1189, 1540, 1568`);
    - keep `CAPSULE_LINE_MAX` for the notifications, and update its comment (`controller.ts:148–151, 1181`), which still speaks of the legacy card;
  - `apps/mac/src/shared/ipc.ts` (`error` gains `command?: string`);
  - `apps/mac/e2e/contrast.spec.ts` (`ON_FILL` and its legacy probes go);
  - `packages/ui/checks/baseline.json`, only through `npm run design:check -- --update-baseline`.
- Test:
  - `apps/mac/test/problems.test.ts`;
  - `apps/mac/e2e/filing.spec.ts`, `app.spec.ts`, `agents.spec.ts`, `permissions.spec.ts`, `models.spec.ts`, `recording.spec.ts` and `contrast.spec.ts`.

- [ ] **Step 1: Write the failing tests:**
  - the rewritten problems' titles and bodies (the second table's rows), as unit tests of their builders;
  - an e2e for any that a test can reach ("The recording didn't arrive." with Choose microphone: `recording.spec.ts`);
  - every existing problem test asserts the CapsuleNotice's role `alert`, its title and its buttons: Hide, then the fix.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Then run `npm run design:check -- --update-baseline`. Expected: `baseline.json` lists nothing, and design:check is clean.
- [ ] **Step 4: Run** the unit tests, typecheck, design:check, then every spec named above. Expected: all pass.
- [ ] **Step 5: Commit** as `mac: every capsule problem says what happened, what's safe and one fix, and no window is left on the design baseline`.

### Task 9: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check` (expected: no baseline entries) and `npm run ui:e2e` (no `--update-snapshots`).
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`: `npm run build`, then `env -u AVANZEL_E2E_AGENT -u AVANZEL_E2E_PACKAGED -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`, so `real-agent.spec.ts` and `packaged.spec.ts` stay skipped. Expected: no failures. Re-run a known flake once (they're listed in `/tmp/avz-ds/1c-machine-rules.md`), and report the wall time.
- [ ] **Step 3: Take the capsule's screenshots,** every state in the Copy table, in light and dark.
  - Put them in `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/shots/1c/`, with a README.
  - Use the throwaway shots spec kept at `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/archive/1f-work/zz-1f-shots.spec.ts.txt`, copied into `apps/mac/e2e/` to run.
  - Delete the copied spec afterwards.
- [ ] **Step 4:** The controller runs the `design-reviewer` agent on the capsule. Fix its window-code findings in one commit, `mac: the capsule reads as one design`.
