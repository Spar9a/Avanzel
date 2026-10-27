# 1d, the menu bar and sounds: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zel's face in the menu bar shows what the app is doing. Its title counts a recording, a hidden filing or a download. The menu says how today went and keeps Undo for the last filing. A scheduled review asks before it runs. Five quiet sounds play, off by default.

**Architecture:**
- **Faces and glyphs.** The menu bar face already exists as SVG art in the design system (`menuBarFaceSvg()` in `@avanzel/ui/menu-bar`, named in DESIGN.md as the source). A small rasterizer in main turns it into template images, one per state. The same rasterizer draws the six shelf glyphs for the menu's Recently filed.
- **Tray state.** It is a pure function of the app's state (`trayView`). `MenuBar.show()` applies it without rebuilding the menu.
- **Sounds.** They are synthesised with WebAudio in a shared renderer module. The capsule plays them when main says so, and main says so only while the setting is on.

**Tech Stack:** Electron 44 (Tray, nativeImage, dialog), TypeScript, React 19 renderers on `@avanzel/ui`, Vitest, Playwright for Electron.

**Spec:** `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`:
- §6.5 Menu bar;
- §4.6 Sound;
- §6.1 (line 318: a hidden filing keeps the face thinking, and the tray title shows the elapsed time);
- §5.2 step 6 (line 262: "Play sounds (off, with Preview)").

Where this plan sits:
- 1d is the last part of product-plan Phase 1. It comes after 1c (merged at 7ad20af).
- Branch `menu-bar`, in the worktree `.claude/worktrees/design-system`.
- It was written under the owner's /goal "keep working on the plan", as 1c was.

## Global Constraints

- **Windows arrange, `@avanzel/ui` paints.**
  - Build windows only from `@avanzel/ui` components; no raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`.
  - Window CSS only arranges, with spacing from `var(--av-space-N)`.
  - Components take no `className` or `style`.
  - Nothing in `packages/ui` changes. Where a part is missing, use the stand-in this plan names and list it as an owner item.
- **Copy** is in sentence case, calm and plain: no "!", no "Oops", no emoji.
  - People are they/them.
  - An action keeps its name through the flow.
  - Never promise more than the app does (DESIGN.md).
- **The menu bar face** comes from `menuBarFaceSvg()` in `@avanzel/ui/menu-bar` (DESIGN.md:107), as a template image (one colour).
  - Its states are `MenuBarState`: `"idle" | "listening" | "filing" | "filed" | "needs-you" | "asleep"`.
  - The face is 18 × 18 points.
- **The tray title** uses `Tray.setTitle(title, { fontType: "monospacedDigit" })`.
- **Sounds** are off by default, each under 0.6 s and quiet (§4.6):
  - Tick: listening starts, 60 ms.
  - Tock: listening stops, 70 ms.
  - Stamp: filed, 180 ms.
  - Drawer: a card drops away, a short filtered whoosh.
  - Letter: two soft bell notes.
  - Every sound has a visual twin.
- **There is no evening letter yet** (Phase 2, spec §8). Until there is, the menu names the evening review: "Evening review at 21:00", never "Letter at 21:00". "Tonight's letter" isn't built.
- **This machine's rules** are binding: `/tmp/avz-ds/1d-machine-rules.md`. They are 1c's rules, carried over:
  - no real agent CLI;
  - unset `ELECTRON_RUN_AS_NODE`;
  - no bare `git stash`, no push;
  - no `npm install` in the worktree;
  - edit interface files with the Edit and Write tools;
  - run no e2e while `pgrep -x Avanzel` prints;
  - known flakes get one re-run.

## Owner items

These are stand-ins and choices for the owner. Each task names the ones it creates.

1. **The five sounds are synthesised stand-ins.** They are WebAudio versions of the UX prototypes' sounds (`reports/Avanzel UX prototypes/first-run.html:503-511`). The Letter is shortened to fit 0.6 s. The real ones are recordings, to go in `apps/mac/assets/` (§4.6).
2. **The Preview button sits beside the "Play sounds" switch, not in it.** `Switch` has no slot for a trailing action. A Switch with a trailing action belongs in `packages/ui`.
3. **The evening letter.** The status line and the Letter sound stand in for it: the sound plays when the evening review finishes. "Tonight's letter" waits for Phase 2.
4. **Open and Undo on the filed notification** (§6.1, §6.3) need a signed build. They aren't in 1d.
5. **The shelf glyphs' path data is copied into main** (`main/shelf-glyphs.ts`), because Shelf.tsx's `GLYPHS` is private JSX. A test keeps the copy equal to Shelf.tsx. A plain-TypeScript export next to `menu-bar.ts` would remove the copy.
6. **Choices the spec leaves open:**
   - The face is `filing` while the speech model downloads.
   - It is `idle` with no library.
   - It is `asleep` from the end of an evening review until the next capture (§4.5's "after the letter, until the first capture").
   - It is `filed` for 3 s after a filing ends.
7. **Native alert buttons are in title case** ("Run Now", "Cancel"), like the existing "Use This Folder" (controller.ts:2785-2796).
8. **Shelf glyphs in the menu use the light-mode shelf colours** (as today's dots do), in light and dark menus. A menu image can't follow the appearance.
9. **By hand on macOS 27:** the custom shelf images show in the menu (§6.5: "macOS 27 hides SF Symbols in menus by default").

## Review Focus

1. **The tray title widens the icon's bounds.** Setup's flight and Zel's bubble centre on `Tray.getBounds()` (setup.ts:1171-1176, setup-model.ts:219-243). So there is no title while the setup window is open (Task 2's test).
2. **A face or title left behind** after a recording, a filing or a download ends, after quitting, or after a library switch. The second ticker must stop (Task 2's tests).
3. **The menu rebuild budget.** `filing.spec.ts:739-745` allows at most one menu rebuild per filing. Title ticks and face swaps go through `MenuBar.show`, never `refreshMenu` (Task 2's test).
4. **Undo from the menu.** It applies to the right filing only:
   - never one that failed;
   - never one in another library after a switch;
   - never an Edit's taken-back first try;
   - never twice.

   Its result is told once (Task 3's tests).
5. **Sounds.**
   - While the setting is off, no sound message is sent at all.
   - The Tick doesn't land in the recording.
   - macOS's own notification sound is unchanged (Task 5's tests).

---

### Task 1: A rasterizer for the faces and the shelf glyphs

**Files:**
- Create:
  - `apps/mac/src/main/raster.ts`
  - `apps/mac/src/main/shelf-glyphs.ts`
- Modify:
  - `apps/mac/src/main/png.ts`: add `faceIcon` and `tinted`. Keep `trayIcon` until Task 2 replaces its one caller.
- Test:
  - `apps/mac/test/raster.test.ts`
  - `apps/mac/test/png.test.ts`
  - `apps/mac/test/shelf-glyphs.test.ts`

**Interfaces:**
- **Produces:**
  - `rasterizeSvg(svg: string, scale: 1 | 2): Bitmap`, in `raster.ts`.
    - Elements: `<svg viewBox="0 0 W H">`, `<g>` (passes `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` and `opacity` to its children), `<circle cx cy r>`, `<rect x y width height rx>` and `<path d>`.
    - Path commands: `M m L l H h V v Q q C c S s Z z`.
    - Fill uses the nonzero rule. Strokes are drawn with round caps and joins, whatever the attributes say; the faces and glyphs use only round ones. `opacity` multiplies.
    - Any fill or stroke other than `none` paints. The output is black (RGB 0), with the alpha set by coverage. Anti-aliasing is 4 × 4 supersampling per pixel.
    - The bitmap is `W × scale` by `H × scale`. Elements outside the subset throw, naming the element, so an art change can't fail silently.
  - `faceIcon(state: MenuBarState, scale: 1 | 2): Bitmap`, in `png.ts`. It is `rasterizeSvg(menuBarFaceSvg(state), scale)`, so 18 × 18 at 1x and 36 × 36 at 2x. Import `menuBarFaceSvg` and `MenuBarState` from `@avanzel/ui/menu-bar`.
  - `tinted(bitmap: Bitmap, hex: string): Bitmap`, in `png.ts`: the same alpha, every pixel's RGB set to `hex`.
  - In `shelf-glyphs.ts`:
    - `SHELF_GLYPH_SVG: Record<Shelf, string>`: each shelf's 12 × 12 SVG, the same paths, circles and stroke widths as `packages/ui/src/components/Shelf.tsx:22-39`.
    - `SHELF_COLORS: Record<Shelf, string>`, moved from `tray.ts:6-8` with the same values.
    - `shelfGlyphIcon(shelf: string, scale: 1 | 2): Bitmap | null`: the tinted glyph, 12 × 12 at 1x. It is null for a folder that isn't one of the six shelves.

- [ ] **Step 1: Write the failing tests.**
  - **raster.test.ts:**
    - "a filled rect covers its pixels exactly": `rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2" fill="black"/></svg>', 1)` gives alpha 255 at (1,1), (2,1), (1,2) and (2,2), and 0 elsewhere.
    - "a circle's coverage is its area": the summed alpha / 255 of an r = 5 circle at 1x is within 2% of π·25.
    - "a stroke has round caps": a horizontal 1-unit stroke from (2,5) to (8,5), width 2, has coverage at (1.5,5) and none at (0.5,5).
    - "a quadratic and a cubic pass through their midpoints": the midpoint pixel of `M0 0 q5 10 10 0` and of a `c` curve both have coverage.
    - "relative commands, h, l and z": the face's asleep "z" path (`M13.6 1.4h2.6l-2.6 3h2.6`) covers its four corners.
    - "opacity halves alpha": a filled rect with `opacity=".5"` has alpha 127 or 128.
    - "an unknown element throws with its name": `<ellipse>` throws an error that names "ellipse".
  - **png.test.ts:**
    - "each face state is its own 18 px template image": every state at 1x is 18 × 18 with every RGB 0, and no two states' alpha arrays are equal.
    - "the idle face is symmetric left to right": every pixel's alpha equals its mirror image's within 1. The idle art is symmetric about x = 9.
    - "needs-you adds its dot top right": needs-you's alpha around (15.6, 2.6) is painted where idle's is empty.
    - "2x is 36 px".
  - **shelf-glyphs.test.ts:**
    - "the glyphs match Shelf.tsx": read `packages/ui/src/components/Shelf.tsx` as text. Every `d="…"`, `cx`, `cy`, `r` and `strokeWidth` value inside its `GLYPHS` must appear, in order, in the matching shelf's `SHELF_GLYPH_SVG`.
    - "a shelf glyph is tinted with its colour": the RGB of every painted pixel of `shelfGlyphIcon("ideas", 1)` is `#ffcc00`.
    - "a folder off the shelves has no glyph": `shelfGlyphIcon("projects", 1)` is null.
- [ ] **Step 2: Run** `npx vitest run test/raster.test.ts test/png.test.ts test/shelf-glyphs.test.ts` from `apps/mac`. Expected: they fail (no module).
- [ ] **Step 3: Implement** `raster.ts`, `faceIcon`, `tinted` and `shelf-glyphs.ts`.
  - Flatten curves to polylines, at 8 segments per curve or more at 2x.
  - Fill: count windings per subsample.
  - Stroke: a subsample is covered when it lies within half the width of any segment of the polyline. That gives round caps and joins.
- [ ] **Step 4: Run** the three files, then `npm test -w @avanzel/mac`, `npm run typecheck` and `npm run design:check`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: the menu bar can draw Zel's faces and the shelf glyphs from the design system's art`.

### Task 2: Zel's face and the title in the menu bar

**Files:**
- Create:
  - `apps/mac/src/main/tray-state.ts`
- Modify:
  - `apps/mac/src/main/tray.ts`: `MenuBar.show`. The constructor starts on the idle face. The old `trayIcon` goes from `png.ts`, and with it `png.test.ts:16-25`.
  - `apps/mac/src/main/controller.ts`: `trayInput`, `refreshTray`, the title ticker, the download percent, the filed and asleep marks, and `trayForTests`.
- Test:
  - `apps/mac/test/tray-state.test.ts`
  - new `apps/mac/e2e/menu-bar.spec.ts`

**Interfaces:**
- **Consumes:** Task 1's `faceIcon`.
- **Produces:**
  - `interface TrayInput { setupOpen: boolean; problem: boolean; recordingSince: number | null; busy: boolean; hiddenFilingSince: number | null; downloadPercent: number | null; filedUntil: number | null; asleep: boolean }`, in `tray-state.ts`.
  - `interface TrayView { face: MenuBarState; title: string }`.
  - `trayView(input: TrayInput, now: number): TrayView`.
    - **The face**, first match wins:
      1. `problem` → `needs-you`;
      2. `recordingSince` → `listening`;
      3. `busy` → `filing`;
      4. `filedUntil > now` → `filed`;
      5. `asleep` → `asleep`;
      6. otherwise `idle`.
    - **The title**, first match wins:
      1. `setupOpen` → "";
      2. `recordingSince` → `elapsed(now - recordingSince)`;
      3. `hiddenFilingSince` → `elapsed(now - hiddenFilingSince)`;
      4. `downloadPercent !== null` → `${downloadPercent}%`;
      5. otherwise "".
  - `elapsed(ms: number): string`: "0:00", "0:07", "1:05" or "12:03". It shows whole seconds, never negative.
  - `MenuBar.show(view: TrayView): void`.
    - It calls `setImage` only when the face changes, with one cached `NativeImage` per state, made with `image(faceIcon, true)`.
    - It calls `setTitle(view.title, { fontType: "monospacedDigit" })` only when the title changes.
    - It never rebuilds the menu.
  - `MenuBar.shown: TrayView`.
  - `Controller.trayForTests(): TrayView`, which returns `this.menuBar.shown`.
- **What feeds `TrayInput` in the controller:**
  - **`problem`:** the capsule shows `error`, `model-failed` or `shortcut-taken`; or `libraryProblem`, `libraryMissing` or `model.kind === "error"` is set.
  - **`recordingSince`:** `this.recording && !this.recording.stopping ? this.recording.startedAt : null`.
  - **`busy`:**
    - the capsule is `transcribing`;
    - or a filing is in flight (`queuedToFile.size || runs.size`);
    - or a review is running (`this.running.size`);
    - or an Ask is running (`this.giveUpAsk`);
    - or the model is `downloading`.
  - **`hiddenFilingSince`:** `this.job` is in flight, the capsule is `hidden`, and the job isn't `waiting`. The value is `job.startedAt`.
  - **`downloadPercent`:** `Math.floor(received / total * 100)` while downloading.
  - **`filedUntil`:** set to `Date.now() + FILED_FACE_MS` (3000) when a filing ends ok, or a `saved` card shows.
  - **`asleep`:** set when an evening review ends ok. Cleared by the next recording, typed thought or screen comment, and by a library change.
  - **`setupOpen`:** the setup window is showing.
- **When `refreshTray()` runs:**
  - from `setCapsule`;
  - where filings, reviews, Asks and downloads start and end;
  - in the download's existing 250 ms gate (controller.ts:3106-3110), only when the whole percent changes;
  - from a 1-second ticker that runs only while `recordingSince` or `hiddenFilingSince` is set.
  - A face mark that expires (`filedUntil`) gets a one-shot timer.
  - All the timers are cleared at quit.

- [ ] **Step 1: Write the failing tests.**
  - **tray-state.test.ts:** each rule's order, one case per pair.
    - For example: `problem` with `recordingSince` gives `needs-you` with the title "0:05".
    - `busy` with `filedUntil` in the future gives `filing`.
    - An expired `filedUntil` gives `idle`.
    - `setupOpen` empties every title.
    - `elapsed(65_400)` is "1:05". `elapsed(-5)` is "0:00".
  - **menu-bar.spec.ts:**
    - "the face listens and the title counts while recording". With `AVANZEL_FAKE_AUDIO`, start dictating, then:
      - the face is `listening`;
      - the title matches `/^0:0[0-9]$/`;
      - after 2 s the title has moved on;
      - stopping gives `filing`, then `filed`, then `idle` after 3 s.
    - "a hidden filing keeps the face thinking and counts in the title". Use a stalling agent and Hide:
      - the face is `filing` and the title counts up;
      - at the end the title is "" and the face is `filed`.
    - "a download shows its percent". Use `fakeModelHub("trickle")`. The title matches `/^\d{1,3}%$/` and only grows, and it is "" at the end.
    - "there is no title while setup is open". During a setup download, the title is "".
    - "a problem shows needs-you". A failed filing's card gives `needs-you`. Hide gives `idle`.
    - "after the evening review Zel sleeps until the next capture". Use `runTask` on the evening review with the fake agent: the face is `asleep`, and the next dictation gives `listening`.
    - "title ticks don't rebuild the menu". Count `refreshMenu` calls during 3 s of recording: none from the ticker.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/filing.spec.ts e2e/app.spec.ts e2e/models.spec.ts e2e/setup-ending.spec.ts e2e/setup-hello-found.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: Zel's face in the menu bar shows what Avanzel is doing, and its title counts`.

### Task 3: The menu says how today went, shows each page's shelf, and keeps Undo

**Files:**
- Modify:
  - `apps/mac/src/main/menu-model.ts`
  - `apps/mac/src/main/tray.ts`: shelf glyph images replace the dots.
  - `apps/mac/src/main/library-info.ts`: `filedToday`.
  - `apps/mac/src/main/controller.ts`: the count's cache, `undoLastFiling`, the `undo-filing` action, and `MenuTask.kind`.
  - `apps/mac/src/main/jobs.ts`: `FilingJob.library`.
- Test:
  - `apps/mac/test/menu-model.test.ts`
  - `apps/mac/test/library-info.test.ts`
  - `apps/mac/e2e/menu-bar.spec.ts`
  - the e2e that read the menu's head: `library.spec.ts:464,537,572`, `app.spec.ts:391-423`, `setup-hello-found.spec.ts:130,530`, `setup-ending.spec.ts:131,351`. They keep the head's action, `open-inbox`, and change only its label.

**Interfaces:**
- **Consumes:** Task 1's `shelfGlyphIcon`.
- **Produces:**
  - `filedToday(root: string, now: Date): number`, in `library-info.ts`. It counts today's lines in `log.md` that contain " | file | ", using local dates as `Vault.logLine` writes them. It does no page lookups, and a missing file counts as 0.
  - `MenuInput` gains `filedToday: number` and `undoableFiling: boolean`. `MenuTask` gains `kind: string`.
  - `statusLine(filedToday: number, evening: MenuTask | undefined, now: Date): string`, exported from `menu-model.ts`.
  - The head item changes:
    - **Its label** is `statusLine(…)`. The evening task is the first enabled task whose `kind` is `"evening-review"`.
    - **Its sublabel** is the inbox count, "1 note in the inbox" or "N notes in the inbox", or none when the inbox is empty. The old "Next: …" sublabel goes.
    - **Its action** stays `open-inbox`.
  - **Recently filed:** each item keeps `shelf` and gains `sublabel`. That is the shelf's name ("Ideas"), or the folder's name for a page off the shelves.
  - **Undo:** "Undo the last filing" (action `undo-filing`) follows the recent items when `undoableFiling` is true.
  - `Controller.undoLastFiling(): Promise<void>`.
    - It acts only when all of these hold:
      - `this.job` has `outcome?.ok` and `outcome.commit`;
      - the job isn't `undoing` and the app isn't quitting;
      - `job.library === this.vault?.root`, where `FilingJob.library` is the root `runFiling` filed in.
    - It sets `undoing` before its first await, and reverts through `revertFiling`.
    - It reports the result once:
      - the Undone card when this job's filed card is showing, as the card's Undo does;
      - otherwise a notification: "Undone" with `undoneNote`, or the `undoRefused` problem's words.
    - Then it calls `refreshMenu`.
    - `undo()`, the card's own path, stays as it is.
  - `undoableFiling` is the same condition, minus `undoing`.
  - The count is cached like `recent`:
    - seeded in `openLibrary`;
    - refreshed wherever `recent` is refreshed (controller.ts:1482, :2223, :3226, :3288);
    - recomputed when the date changes, in `tick()`.

**Copy:**
- "Nothing filed today." / "1 thought filed today." / "3 thoughts filed today."
- When an evening review is on, " Evening review " plus `nextPhrase(at, now)` plus ".": for example "3 thoughts filed today. Evening review at 21:00.", or "… Evening review tomorrow at 21:00."
- "Undo the last filing"

- [ ] **Step 1: Write the failing tests.**
  - **menu-model.test.ts:**
    - The head's label and sublabel for 0, 1 and 3 filed:
      - with the evening review today;
      - with it tomorrow, using `now` after 21:00;
      - with no evening review;
      - with only a weekly review, which doesn't appear in the head.
    - The recent items' sublabels: shelf names, and a folder name.
    - The Undo item appears only with `undoableFiling`, right after the recent items.
    - Update `input()` and the pinned head and label lists.
  - **library-info.test.ts:** `filedToday` counts only today's `file` lines. It ignores `review` and `ask` lines and yesterday's lines, and a missing `log.md` gives 0.
  - **menu-bar.spec.ts:**
    - "the status line counts today's filings". A fake filing gives "1 thought filed today. Evening review at 21:00." and `undo-filing` appears.
    - "Undo from the menu takes the last filing back and says so once".
      - Hide the filed card, then `menuAction("undo-filing")`.
      - The page is gone and the note is back in the inbox.
      - Exactly one notification says "Undone".
      - The status line reads "Nothing filed today." in a git library.
      - The Undo item is gone.
    - "Undo from the menu is never offered for a failed filing, a filing in another library, or twice". Cover each case.
    - "Recently filed shows each page's shelf". The sublabels are the shelf names.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/library.spec.ts e2e/app.spec.ts e2e/capsule-results.spec.ts e2e/setup-hello-found.spec.ts e2e/setup-ending.spec.ts e2e/shortcuts.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: the menu says how today went, shows each page's shelf, and keeps Undo for the last filing`.

### Task 4: A scheduled review asks before it runs, and shows its progress

**Files:**
- Modify:
  - `apps/mac/src/main/controller.ts`: `confirmRun`, the `task:<id>` action, Settings' Run now, and the review's progress.
  - `apps/mac/src/main/menu-model.ts`: `MenuTask.progress`.
  - `apps/mac/src/main/ipc.ts`: if Settings' Run now needs its window passed to the dialog.
- Test:
  - `apps/mac/e2e/menu-bar.spec.ts`
  - `apps/mac/e2e/settings.spec.ts` and `library.spec.ts`: the tests that press Run now (`settings.spec.ts:385,396,440,553`, `library.spec.ts:236`) stub the dialog, with the existing pattern at `library.spec.ts:587-590`.

**Interfaces:**
- **Produces:**
  - `Controller.confirmRun(taskId: string, parent?: BrowserWindow): Promise<boolean>`.
    - It calls `app.focus({ steal: true })`, then `dialog.showMessageBox(parent?, { type: "question", buttons: ["Run Now", "Cancel"], defaultId: 0, cancelId: 1, message: \`Run "${task.name}" now?\`, detail: \`It's an agent run with ${agentName}, so it uses your plan's quota.\` })`.
    - It resolves true only for "Run Now".
    - The menu's `task:<id>` and Settings' Run now go through it. `tick()`'s due runs don't.
  - `MenuTask.progress?: string`, for example "2 of 5".
    - `executeTask` passes `progress` to `eveningReview`. It counts each "Filing … with …" report against the inbox count taken when the review started.
    - The menu shows `progress` as the item's detail instead of "Running…".
    - A rebuild per capture is fine. Per step is not.

- [ ] **Step 1: Write the failing tests** (`menu-bar.spec.ts`):
  - "running a review from the menu asks first". With the dialog stubbed to Cancel, no run happens: the run state isn't marked. With Run Now, it runs. The dialog's message names the review.
  - "Settings' Run now asks first". Use the same stub.
  - "a review on its schedule doesn't ask". `tick()` with a due review runs it without calling the dialog.
  - "a running review shows how far it is". Hold the fake agent with `FAKE_AGENT_STEP_MS`, put two notes in the inbox, and run. The menu's item reads "Evening review (1 of 2)", then "(2 of 2)".
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/settings.spec.ts e2e/library.spec.ts e2e/app.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: a scheduled review asks before it runs from the menu or Settings, and shows how far it is`.

### Task 5: Five quiet sounds, off by default

**Files:**
- Create:
  - `apps/mac/src/renderer/common/sounds.ts`
- Modify:
  - `apps/mac/src/shared/ipc.ts`: `AppSettings.sounds`, `SetupSnapshot.sounds`, and the capsule's `onSound`.
  - `apps/mac/src/main/store.ts`: the default `sounds: false`, and normalising it.
  - `apps/mac/src/preload/index.ts`: `capsule.onSound`.
  - `apps/mac/src/main/controller.ts`: the `sound(name)` helper and its triggers.
  - `apps/mac/src/main/setup.ts`: `SetupSnapshot.sounds`.
  - `apps/mac/src/renderer/capsule/main.tsx`: playing, and the Tick before the recorder.
  - `apps/mac/src/renderer/setup/steps/Done.tsx`: the switch and Preview.
  - `apps/mac/src/renderer/settings/panes/General.tsx`: the switch.
- Test:
  - `apps/mac/test/sounds.test.ts`
  - `apps/mac/test/store.test.ts`
  - `apps/mac/e2e/menu-bar.spec.ts`, or a new `sounds.spec.ts`
  - `setup-ending.spec.ts:100` and `contrast.spec.ts:512`: the switch counts.
  - `settings.spec.ts`

**Interfaces:**
- **Produces:**
  - `type SoundName = "tick" | "tock" | "stamp" | "drawer" | "letter"`.
  - `SOUND_MS: Record<SoundName, number>`, each ≤ 600.
  - `playSound(name: SoundName, make?: () => AudioContextLike): void`, in `renderer/common/sounds.ts`.
    - The synth is the prototype's: tick = `tone(1320, .06, sine, .07, 880)`, tock = `tone(760, .07, sine, .07, 520)`, stamp = `tone(160, .18, sine, .32, 52)` plus `noise(.08, 1000, .9, .22)`, drawer = `noise(.22, 500, .7, .05, 2600)`.
    - The letter is two sine notes that end by 0.6 s: 1046.5 Hz at 0 s for 0.35 s, then 1568 Hz at 0.1 s for 0.45 s.
    - Each play is also pushed to `globalThis.__avanzelSounds`, keeping the last 20, so tests can read it.
  - The `capsule:sound` channel (main → capsule page) carries a `SoundName`. Main's `sound(name)` sends it only while `store.get().sounds` is true.
- **Triggers in main:**
  - `tick` just before the capsule is sent `start`;
  - `tock` when the recording's audio arrives;
  - `stamp` when a `filed` card shows;
  - `drawer` when a `filed` or `saved` card goes to `hidden`;
  - `letter` when an evening review ends ok.
  - A filing that ends in a notification plays nothing of the app's own; macOS's notification sound stands.
- **The capsule page:**
  - It plays what it is told.
  - It starts the recorder `SOUND_MS.tick` after a Tick it was told to play, so the Tick isn't recorded.
  - It plays the Stamp at the Stamp's impact, 228 ms after the card shows, or at once with Reduce Motion.
- **Setup's Done step:**
  - Show the switches in this order: the login switch first (`watchFirstSwitch` reads the first `[role="switch"]`), then "Play sounds" (off), then the review switch.
  - A `Button variant="link"` "Preview" sits beside the sounds switch, arranged by the window's layout CSS (owner item 2). It plays Tick, then Stamp at +260 ms, then Letter at +760 ms.
  - Switching sounds on plays the Stamp.
- **Settings → General:** a "Sounds" group with `<Switch label="Play sounds" description="A soft tick when you start and stop, a stamp when a thought is filed, and two notes when the evening review is done." />`. Switching it on plays the Stamp.

- [ ] **Step 1: Write the failing tests.**
  - **sounds.test.ts**, with a fake AudioContext that records oscillators, gains and their start and stop times:
    - every sound's last stop is within its `SOUND_MS` and ≤ 0.6 s;
    - every peak gain is ≤ 0.35;
    - `playSound` records its name.
  - **store.test.ts:** the default is `sounds: false`, and only `true` normalises to true.
  - **e2e:**
    - "no sound is sent while sounds are off". Wrap the capsule's `webContents.send` and run a dictation and a filing: no `capsule:sound`.
    - "with sounds on, each moment sends its sound". Dictation sends `tick` before `start` and `tock` when it stops. A filed card sends `stamp`, its hiding sends `drawer`, and an evening review sends `letter`.
    - "the Tick isn't recorded". The capsule's `start` happens at least `SOUND_MS.tick` after the Tick plays. Read it from `__avanzelSounds` timestamps against the recorder start.
    - "setup offers sounds, off, with Preview". There are three switches, in order, with sounds off. Preview records tick, stamp and letter. Switching on records stamp and saves `sounds: true`. Update the switch counts at `setup-ending.spec.ts:100` and `contrast.spec.ts:512`.
    - "Settings has Play sounds". Switching it saves the setting.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Invoke the `avanzel-ui` skill before editing the renderer files.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run the new e2e, `setup-ending.spec.ts`, `contrast.spec.ts`, `settings.spec.ts`, `app.spec.ts`, `filing.spec.ts` and `recording.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: five quiet sounds, off by default, offered in setup and Settings`.

### Task 6: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check` (the baseline stays `{}`) and `npm run ui:e2e`.
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`.
  - Run `npm run build`, then `env -u AVANZEL_E2E_AGENT -u AVANZEL_E2E_PACKAGED -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`.
  - Expected: no failures. Re-run each known flake once, and report the wall time.
- [ ] **Step 3: The shots**, saved to `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/shots/1d/` with a README:
  - the six faces at 2x, on a light and a dark menu-bar grey, with the titles "0:12" and "37%";
  - the menu's text in each state;
  - setup's Done step and Settings → General, in light and dark.

  Use a throwaway spec, archived as `.txt` in the flight pack's `archive/1d-work/` and never committed.
- [ ] **Step 4: The design review.** The controller runs the `design-reviewer` agent on the Done step, General and the face shots. Fix its findings in one commit: `mac: the menu bar reads as one design`.
- [ ] **Step 5: Docs.** Update this plan's tables to what was built, and fill in the owner items it found.
