# 1d, the menu bar and sounds: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zel's face in the menu bar shows what the app is doing. Its title counts a recording, a hidden filing or a download. The menu says how today went and keeps Undo for the last filing. A scheduled review asks before it runs. Five quiet sounds play, off by default.

**Architecture:**
- **Faces and glyphs.** The face already exists as SVG art in the design system (`menuBarFaceSvg()` in `@avanzel/ui/menu-bar`, DESIGN.md:107). A small rasterizer in main turns it into one template image per state, and draws the six shelf glyphs for Recently filed.
- **Tray state** is a pure function of the app's state (`trayView`). `MenuBar.show()` applies it without rebuilding the menu.
- **Undo from the menu** reverts an explicit `lastFiled` record, never whatever `this.job` happens to be.
- **Sounds** are synthesised with WebAudio in a shared renderer module, one AudioContext per page.
  - The capsule plays what main sends. Main sends only while the setting is on, and while a recording runs only that recording's own Tick and Tock.
  - Main also tells the capsule's page when sounds go on or off (`capsule:sounds-setting`, and at load while they are on). On, the page makes its AudioContext at once, off the dictation's path; off, it lets go of it.
  - A page suspends its AudioContext after 30 s with nothing played, since a running one keeps the Mac awake (measured with `pmset -g assertions`), and wakes it for the next sound or a recording's start. Nothing plays once Avanzel is quitting.
  - Setup and Settings play their own sounds: a Preview that plays four of the five, and the Stamp when sounds are switched on. Each asks main first (`settings:may-play-sounds`) and stays quiet while a recording runs, since the recorder has no echo cancellation.

**Tech Stack:** Electron 44 (Tray, nativeImage, dialog), TypeScript, React 19 renderers on `@avanzel/ui`, Vitest, Playwright for Electron.

**Spec:** `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`:
- §6.5 Menu bar (line 364) and §4.6 Sound (line 224).
- §4.2's mood table: Filed is "menu bar for 2 s" (line 170), and Asleep is "after the letter, until the first capture" (line 172).
- §6.1 line 318: a hidden filing keeps the face thinking, and the title shows the elapsed time.
- §6.3 line 343: "Undo the last filing" stays in the menu until the next filing.
- §5.2 step 6, line 262: "Play sounds (off, with Preview)".
- §8 line 570: the letter's notification is Passive, so silent.

Where this plan sits:
- 1d is the last part of product-plan Phase 1, after 1c (merged at 7ad20af).
- It is on branch `menu-bar`, in the worktree `.claude/worktrees/design-system`.
- It was written under the owner's /goal "keep working on the plan", as 1c was.
- Pre-flight: `/tmp/avz-ds/1d-preflight.md`. The coordinator's rulings on it are in the ledger (`.superpowers/sdd/2026-10-27-avanzel-menu-bar/progress.md`), and this plan applies them.
- **Built** (Tasks 1 to 7, each reviewed; fix rounds are the second commit):
  - Task 1: `8fad4db`, `49a37c2`.
  - Task 2: `73dfc1f`, `f2bb9ac`.
  - Task 3: `78b920a`.
  - Task 4: `d1bda75`, `7acfd5b`.
  - Task 5: `916b4f0`, `d929c6b`.
  - Task 6: `10d4eb1`.
  - Task 7: `6a5542d`, `4239057`.
  - Task 8, step 4 (the design review's fixes): `mac: the menu bar reads as one design`. Its seven changes are listed under Task 8.
  - The final fix wave, after the whole-branch review: `mac: an empty evening review leaves Undo alone, the face's words are true on every path, and the last loose ends are tied`. An evening review with nothing to file keeps the menu's Undo, the tooltips say "working" and "saved", the capsule's AudioContext is suspended after 30 s of quiet, and the README names the menu's Undo, the review's question and Play sounds.
- **This plan says what was built, through the final fix wave.** Each task's interfaces, copy and tests follow the reviews' rulings, Task 8's design fixes and the final fix wave; where the first build differed, a parenthesis says what it was. The steps' checklists and the commands they ran are as each task ran them. Owner items 11 to 20 are the ones the work found, and the Review Focus lists carry the final rulings.

## Global Constraints

- **Windows arrange, `@avanzel/ui` paints.**
  - Build windows only from `@avanzel/ui` components: no raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`.
  - Window CSS only arranges, with spacing from `var(--av-space-N)`.
  - Components take no `className` or `style`.
  - Nothing in `packages/ui` changes. Where a part is missing, use the stand-in this plan names and list it as an owner item.
- **Copy** is in sentence case, calm and plain: no "!", no "Oops", no emoji.
  - People are they/them, and an action keeps its name through the flow.
  - Never promise more than the app does.
- **Main and `@avanzel/ui`.**
  - Main imports values only from `@avanzel/ui/menu-bar`. From the root it takes types only, with `import type`.
  - Under `verbatimModuleSyntax`, a mixed `import { type … }` stays as a side-effect import.
  - The root's index pulls in CSS and .woff2 fonts, and main's build has no font loader (scripts/build.mjs:18-28). So the shelves and their names are copied into `main/shelf-glyphs.ts`. The glyphs are black template images that macOS tints, so main holds no shelf colours.
- **png.ts and raster.ts stay plain TypeScript** that Node's type stripping can run: no enums, no parameter properties. `scripts/make-icon.mjs:7` imports png.ts under plain Node.
- **The face** is `menuBarFaceSvg()` as an 18 × 18-point template image.
  - Its states are `MenuBarState`: `"idle" | "listening" | "filing" | "filed" | "needs-you" | "asleep"`.
  - The filed face lasts 2 s (spec line 170).
- **The title** uses `Tray.setTitle(title, { fontType: "monospacedDigit" })` (electron.d.ts:16110, :24622-24629).
- **Sounds** (§4.6) are off by default, each under 0.6 s and quiet, and each has a visual twin:
  - Tick: listening starts, 60 ms.
  - Tock: listening stops, 70 ms.
  - Stamp: filed, 180 ms.
  - Drawer: a card drops away, a short filtered whoosh.
  - Letter: two soft bell notes.
  - Every layer's peak gain is ≤ 0.35, and the Stamp's two layers together peak at ≤ 0.5.
- **There is no evening letter yet** (Phase 2, spec §8). The menu says "Evening review at 21:00", never "Letter at 21:00". "Tonight's letter" isn't built.
- **This machine's rules are binding:** `/tmp/avz-ds/1d-machine-rules.md`, 1c's carried over:
  - no real agent CLI;
  - unset `ELECTRON_RUN_AS_NODE`;
  - no bare `git stash`, no push;
  - no `npm install` in the worktree;
  - edit interface files with the Edit and Write tools;
  - run no e2e while `pgrep -x Avanzel` prints;
  - wrap every e2e run in `caffeinate -i`: this Mac idle-sleeps after a minute (found in Task 2), and a sleep in the middle of a run fails tests that are right;
  - known flakes get one re-run.

## Owner items

These are stand-ins and choices for the owner. Each task names the ones it creates.

1. **The five sounds are synthesised stand-ins:** WebAudio versions of the UX prototypes' sounds (`reports/Avanzel UX prototypes/first-run.html:503-511`).
   - The Letter is shortened to fit 0.6 s, and the Stamp's layers are lowered to sum to ≤ 0.5.
   - The real ones are recordings, to go in `apps/mac/assets/` (§11, line 686).
2. **Preview inside the Switch row needs a trailing slot.** Setup's "Preview sounds" sits below its Group, because `Switch` has no slot for a trailing action. Settings' sits in a box of its own (`.settings-preview`) under the switch, inside the Sounds group.
   - In both, the Preview is tied to its switch only by its place. A slot in `Switch`, or a `GroupRow` that follows it, belongs in `packages/ui`.
   - Setup's Play sounds has no description: two lines would scroll its tallest state.
3. **The evening letter.** The evening review stands in for it: the status line names the review, the Letter sound plays when it finishes, and Zel sleeps after it (§4.2 line 172 says after the letter). "Tonight's letter" waits for Phase 2.
4. **Open and Undo on the filed notification** (§6.1, §6.3) need a signed build. They aren't in 1d.
5. **The shelf glyphs and names are copied into main** (`main/shelf-glyphs.ts`).
   - Shelf.tsx's `GLYPHS` is private JSX, and main can't import a value from the package root.
   - A test keeps the copy equal to the design system. A plain-TypeScript export next to `menu-bar.ts` would remove the copy.
   - The menu draws them in black, as template images that macOS tints (the design review's fix), so main holds no shelf colours. A coloured glyph is an owner option: an ink variant per shelf in `@avanzel/ui/menu-bar`, which main would then import.
6. **Choices the spec leaves open:**
   - The face is `idle` with no library.
   - Downloading doesn't make the face busy; the title shows the percent.
   - Zel sleeps when an evening review finishes between 18:00 and 06:00 local (`sleepsAfterReview`: true from 18:00 to 05:59), until the next capture or a library change. An overdue morning run doesn't put Zel to sleep, and nor does a review that ends while a thought is in flight (an open editor, a hidden filing, speech being made into words).
   - The filed face lasts 2 s, as the spec says (§4.2 line 170).
   - The face is `needs-you` whenever the speech model can't be had (a failed download, voice settings Avanzel can't use), so a first launch offline shows it until Try again. The menu names the problem right under its head.
   - No title shows while setup's window or Zel's up-here bubble is open: a title widens the icon's bounds, which they centre on.
   - Esc plays a Tock, since the spec's Tock is "listening stops". A recording whose microphone fails to start has a Tick and no Tock: listening never began, and its error card is the twin of that end.
   - The Letter plays whenever the evening review finishes, and the review's notification is then silent (§8 line 570).
   - A review that writes to the library clears the menu's Undo: the weekly review as it starts, and the evening review as it ends, if it filed anything (or threw). An evening review with nothing to file writes nothing, so the Undo comes back after it. A custom review is only skipped, with a notice, and clears nothing.
7. **Native alert buttons are in title case** ("Run Now", "Cancel"), like the existing "Use This Folder" (controller.ts:2785-2796).
   - The default is Run Now, so Return runs the review: the question answers a press made a second ago, and Esc cancels.
8. **By hand on macOS 27:** the custom shelf images show in the menu (§6.5: "macOS 27 hides SF Symbols in menus by default"), in light and dark, and on the selected row, where a template image should turn the highlight's white.
9. **The global "Undo the last filing" shortcut** (§10, line 640) isn't in 1d.
10. **"Show the last receipt" in the menu** (§6.3, line 340) isn't in 1d.
11. **The filing face's first dot merges with the shelf at 2x** (art, `packages/ui/src/menu-bar.ts:29`).
    - The dot is a circle at 14.4, 16 with r .8, and it sits inside the shelf's right end, which ends at 14.2. Only the half-strength second dot reads as a dot.
    - The faces are the design system's art and main only rasterises them, so the redraw is the owner's.
12. **The title widens the icon** from 34 pt to 69 pt for "0:03", and to 61 pt for "0%" (measured on a notched MacBook).
    - A crowded or notched menu bar may hide the icon exactly while it counts.
    - Check by hand on a light and a dark menu bar, and decide whether a switch should turn the count off.
13. **The design guard's coverage** (`packages/ui/checks/`).
    - The shell check matches only `.tsx`, `.css` and `.html` (`guard.mjs:43`), while `config.mjs:6` makes `renderer/**/*.ts` window code.
    - A script edited `renderer/common/sounds.ts` unrefused. Its after-shell step still ran the design check, which passed.
    - Widening the regex is the owner's call.
14. **Words for the owner to read.** The implementers wrote the first three, and the design review's fixes reworded them; the tooltips are the design review's, reworded in the final fix wave:
    - The speech item's second line says what is safe and where to go, from the capsule's and Settings → Voice's own sentences: "Typing works meanwhile. Try again in Settings → Voice.", and for voice settings Avanzel can't use "Typed thoughts are still saved to the inbox. Fix the config file." What Try again does (continue or start over) is left to Settings → Voice.
    - The menu no longer says that Avanzel reads the config file again within a minute (the first build's "Fix the config file. Avanzel reads it again within a minute."). It still does (`tick`), and choosing the item reads it at once; the rewording dropped the sentence, and nothing says it now.
    - The icon's tooltip, the face in words: "Avanzel", "Avanzel is recording", "Avanzel is working", "Avanzel saved it", "Avanzel needs you" and "The evening review is done". "Working", not "filing": the busy face is also an Ask, a transcription for a screen comment or the evening review, and the weekly review. "Saved", not "filed": the stamp also follows a saved card (a screen comment, words kept for the review), and Filed is "saved and undoable" (spec §4.2).
    - The review question's detail: "It runs with Claude Code on your plan, so it may count toward your usage limit." (with no agent: "It runs on your plan, so it may count toward your usage limit."). "May", because "uses" is untrue for an empty inbox and for a local model. The capsule says "usage limit" and Settings says "on your plan".
    - Settings' description of Play sounds: "A tick and a tock as you start and stop recording, a stamp and a whoosh as the capsule files a card and puts it away, and two soft bell tones when the evening review is done." It says "tones", since "notes" is the app's word for a capture.
15. **The audio device while sounds are on.**
    - The capsule's page makes its AudioContext when sounds go on, and at launch while they are on. The first Tick is then played about 25 ms after the listening card, where making the context at the first Tick took about 150 ms and delayed the card.
    - A running context kept the Mac awake. Measured in the final fix wave, with sounds on and nothing playing, `pmset -g assertions` showed coreaudiod holding `PreventUserIdleSystemSleep` ("com.apple.audio.BuiltInSpeakerDevice.context.preventuseridlesleep") for the app's audio process, and none with sounds off. So the page now suspends its context after 30 s with nothing played (`QUIET_MS`), and then holds none. The next sound wakes it, and so does a recording's start; the Tick after a suspend came 10 to 42 ms after main sent the listening state, against 5 to 6 ms awake.
    - By hand: with AirPods, check that the headset leaves its playback profile once the 30 s have passed. The 30 s is the owner's to change.
    - A Preview that is playing when sounds go off isn't stopped.
16. **Whether the Tick lands in a recording.**
    - The Tick is sent before the recorder starts and plays while the microphone opens. A delay before the recorder would risk missing a stop or cancel, so there is none.
    - The recorder has no echo cancellation. Check `raw/audio`'s first half-second with the Mac's microphone and with AirPods.
17. **A refused save is silent in setup's Done step** for all three switches (login, Play sounds and the review): setup has no place to tell it. Find one, or accept the silence.
18. **The glyphs' edges.** The rasterizer samples 4 × 4 per pixel, so at 1x `goals` is 4.8% heavy and `topics` 3.6% light against a 16x reference. The faces are within 0.6%. 8 × 8 samples would cut the error at about four times a cost that is still tiny. Look at the glyphs on a real menu first.
19. **Sound levels.** The gains are the prototype's (.04 to .07), so the Tick and the Letter may be hard to hear on laptop speakers, and the Stamp's thud sits below their range. The recorded sounds of item 1 settle it.
20. **A needs-you that outlives a by-hand fix.** The voice settings are re-read each minute and when the menu's item is chosen while they are in error. A library that won't open, or isn't there, is read only when a library opens, so the face stays `needs-you` until one does, not when the folder comes back.

## Review Focus

1. **The title widens the icon's bounds.** Setup's flight and Zel's bubble centre on `Tray.getBounds()` (setup.ts:1171-1176, :1195-1209; setup-model.ts:219-243). So there is no title while setup's window or its up-here bubble shows (Task 2's test).
2. **No face or title is left behind** after a recording, a filing or a download ends, after quitting on either quit path (index.ts:38-48), or after a library switch. The one timer must stop (Task 2's tests).
3. **The menu rebuild budget.**
   - `filing.spec.ts:742-745` allows at most one rebuild across a filing's steps.
   - Title ticks and face swaps go through `MenuBar.show`, never `refreshMenu` (Task 2's test).
   - Clearing `lastFiled` rebuilds the menu only when it was set.
   - A running review rebuilds the menu once for each capture it counts, never for each step: over a two-note review, four builds (its start, each capture, its end), with a fifth allowed for a tick (Task 5's test).
4. **Undo from the menu reverts `lastFiled` only.**
   - It is set by a capsule or background filing that ends ok with a commit.
   - It is cleared by every filing's start, by the weekly review's start, by the end of an evening review that filed something or threw (one with nothing to file writes nothing, and leaves it), by any take-back of its commit, and by a library change.
   - The item hides while a filing or review runs, and while a filing waits in the queue. It answers once, and its result is told once (Task 4's tests).
5. **Sounds.**
   - While the setting is off, no `capsule:sound` is sent at all. Main still tells the capsule's page that sounds are off (`capsule:sounds-setting`), once, when they go off.
   - Once Avanzel is quitting no `capsule:sound` is sent either: an evening review the quit stopped still ends, and plays no Letter on the way out (final fix wave).
   - While a recording runs, only its own Tick and Tock play, and the windows' own sounds stay quiet.
   - macOS's notification sound is unchanged, except on the evening review's notification, which is silent when the Letter plays (Task 6's tests).

---

### Task 1: A rasterizer for the faces and the shelf glyphs

Owner items: 5, 11, 18.

**Files:**
- Create `apps/mac/src/main/raster.ts` and `apps/mac/src/main/shelf-glyphs.ts`.
- Modify `apps/mac/src/main/png.ts`: add `faceIcon`. Keep `trayIcon` until Task 2 replaces its one caller. (A `tinted`, for glyphs in their shelf's colour, was built here and went in Task 8, when the glyphs became template images.)
- Test: `apps/mac/test/raster.test.ts`, `png.test.ts` and `shelf-glyphs.test.ts`.

**Interfaces (produces):**
- **`rasterizeSvg(svg: string, scale: 1 | 2): Bitmap`, in `raster.ts`.**
  - **Elements:** `<svg viewBox="0 0 W H">` (its `xmlns`, `width` and `height` are ignored), `<g>`, `<circle cx cy r>`, `<rect x y width height rx>` and `<path d>`.
    - A `<g>` passes `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` and `opacity` to its children.
    - Defaults are SVG's: fill black, stroke none, stroke-width 1. Any fill or stroke other than `none` paints.
  - **Path commands:** `M m L l H h V v Q q C c S s Z z`, with SVG's implicit repeats and compact numbers. Shelf.tsx uses all of them (:24, :25, :35):
    - extra pairs after `M` are line-tos;
    - `L10.8 6 6 10.8` is two segments;
    - `7.2.8` is 7.2 then .8, and `0-2.2` is 0 then -2.2.
  - **Painting:**
    - Fill uses the nonzero rule.
    - Strokes have round caps and joins, and the art uses only round ones. A `stroke-linecap` or `stroke-linejoin` of any other value, on an element or on a `<g>`, throws like any value outside the subset, since drawing it round would be a silent change.
    - A circle's stroke is the band where |distance − r| ≤ width/2, never a flattened polygon.
    - Curves flatten to 8 segments, or more at 2x.
  - **Anti-aliasing:** 4 × 4 subsamples per pixel, at (k + ½)/4. A subsample's coverage is the greatest of the elements over it, each times its `opacity`.
  - **Output:** black (RGB 0), with the alpha set by coverage. The bitmap is `W × scale` by `H × scale`.
  - **Anything outside the subset throws, naming itself.** That covers elements (`<ellipse>`), attributes (`transform`, `fill-rule`, `fill-opacity`, `stroke-dasharray`, `style`), a path command outside the list (the path switch has a `default: throw`), paint on the `<svg>` root, a `rx` beyond half a side and a negative length, so an art change can't fail silently.
  - Nested `opacity` multiplies, as SVG's does.
- **`faceIcon(state: MenuBarState, scale: 1 | 2): Bitmap`, in `png.ts`:** `rasterizeSvg(menuBarFaceSvg(state), scale)`, so 18 × 18 at 1x and 36 × 36 at 2x. It imports `menuBarFaceSvg` and `type MenuBarState` from `@avanzel/ui/menu-bar`.
- **In `shelf-glyphs.ts`:**
  - `SHELVES`, `type Shelf` and `SHELF_NAMES` ("Goals", "Ideas", …), copied from `packages/ui/src/generated/tokens.ts:8-9` and `Shelf.tsx:9-16`.
  - `SHELF_GLYPH_SVG: Record<Shelf, string>`: each shelf's 12 × 12 SVG. It has the same paths, circles and stroke widths as `Shelf.tsx:22-39`, with `fill="none" stroke="black"` on the stroked ones.
  - No shelf colours. The glyphs are drawn black, as template images that macOS tints (Task 8's design fixes: a coloured glyph fell under 3:1 on a light menu). `tray.ts`'s own `SHELF_COLORS` went with its dots in Task 3.
  - `isShelf(folder: string): folder is Shelf`: by the exact name, so a folder the person made is none, whatever it is called.
  - `shelfGlyph(shelf: Shelf, scale: 1 | 2): Bitmap`, and `shelfGlyphIcon(shelf: string, scale: 1 | 2): Bitmap | null` around it: the glyph in black on transparent, for a template image, 12 × 12 at 1x. It is null for a folder that isn't a shelf.

- [ ] **Step 1: Write the failing tests.**
  - **raster.test.ts:**
    - "a filled rect covers its pixels exactly": `rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2" fill="black"/></svg>', 1)` gives alpha 255 at (1,1), (2,1), (1,2) and (2,2), and 0 elsewhere.
    - "a circle's coverage is its area": the summed alpha / 255 of an r = 5 circle at 1x is within 2% of π·25.
    - "a stroked circle is round": at 2x, an r = 5, width 1 ring paints the pixel at radius 5.4 on the 22.5° ray, which a flattened octagon would miss.
    - "a stroke has round caps": a stroke from (2,5) to (8,5), width 2, has coverage at (1.5,5) and none at (0.5,5).
    - "a quadratic and a cubic pass through their midpoints": stroked `M0 0 q5 10 10 0`, and a stroked `c` curve, both cover their midpoint pixel.
    - "relative h and l: the asleep face's z mark": `M13.6 1.4h2.6l-2.6 3h2.6` covers its four corners.
    - "implicit line-tos and compact numbers": the ideas glyph (`M6 .8 7.2 4.8 11.2 6 …`) paints its centre (6,6) fully.
    - "a closed path strokes its closing edge": a stroked `M1 1H9V9z` covers (5,5), on the diagonal back to the start.
    - "opacity halves alpha": a filled rect with `opacity=".5"` has alpha 127 or 128.
    - "unknowns throw with their name": `<ellipse>` throws naming "ellipse", and `transform="…"` throws naming "transform". A non-round `stroke-linecap` or `stroke-linejoin`, on an element and on a `<g>`, throws naming itself.
  - **png.test.ts:**
    - "each face state is its own 18 px template image": every state at 1x is 18 × 18 with every RGB 0, and no two states' alpha arrays are equal. The states come from a `Record<MenuBarState, true>`, so a new `MenuBarState` is a type error until the test lists it.
    - "the idle face is symmetric left to right": every pixel's alpha equals its mirror image's within 1, since the idle art is symmetric about x = 9.
    - "needs-you adds its dot top right": needs-you's alpha around (15.6, 2.6) is painted where idle's is empty.
    - "2x is 36 px".
  - **shelf-glyphs.test.ts:**
    - "the glyphs match Shelf.tsx": compare each shelf's `SHELF_GLYPH_SVG` element by element with `renderToStaticMarkup(ShelfGlyph)`. A changed path, circle or stroke width, a swapped fill and stroke, an added opacity, a new element or a new viewBox fails it (20 drifts tried on a mirror, 20 caught).
    - "the shelves and names match the design system": `SHELVES` and `SHELF_NAMES` equal `@avanzel/ui`'s. A test may import the root, since vitest takes its CSS, as `common-copy.test.ts:3` does.
    - "a shelf glyph is black on transparent, for macOS to tint: no colour of its own": every painted pixel of `shelfGlyphIcon("ideas", 1)` is black.
    - "a folder off the shelves has no glyph": `shelfGlyphIcon("projects", 1)` is null.
- [ ] **Step 2: Run** `npx vitest run test/raster.test.ts test/png.test.ts test/shelf-glyphs.test.ts` from `apps/mac`. Expected: they fail (no module).
- [ ] **Step 3: Implement.**
  - Fill counts windings per subsample.
  - For strokes, a subsample is covered when it lies within half the width of any segment of the polyline. That gives round caps and joins.
- [ ] **Step 4: Run** the three files, then the gates:
  - `npm test -w @avanzel/mac`, `npm run typecheck` and `npm run design:check`;
  - from `apps/mac`, `node -e "import('./src/main/png.ts')"`, which checks that Node's type stripping still loads png.ts.

  Expected: they pass.
- [ ] **Step 5: Commit** as `mac: the menu bar can draw Zel's faces and the shelf glyphs from the design system's art`.

### Task 2: Zel's face and the title in the menu bar

Owner items: 6, 12, 20.

**Files:**
- Create `apps/mac/src/main/tray-state.ts`.
- Modify:
  - `tray.ts`: `MenuBar.show`, and the constructor starts on the idle face. The old `trayIcon` goes from `png.ts`, and with it `png.test.ts:16-25`.
  - `controller.ts`: `trayInput`, `refreshTray`, `showTray` with its one timer, the download percent, `markFiled` and the asleep mark, `capturing`, `trayForTests`, and the timer at quit.
  - `src/shared/clock.ts` (new): the capsule's `m:ss` clock, moved out of the capsule so that the card and the menu bar count the same way.
  - `setup.ts`: `Setup.upHereOpen()`, and a new `SetupHost.refreshTray()`. Setup calls it when its window or bubble opens or closes (`show`, `end`, `openUpHere`, `closeUpHere`).
- Test: `apps/mac/test/tray-state.test.ts` and a new `apps/mac/e2e/menu-bar.spec.ts`.

**Interfaces:**
- **Consumes:** Task 1's `faceIcon`.
- **Produces:**
  - `interface TrayInput { setupOpen: boolean; problem: boolean; recordingSince: number | null; busy: boolean; hiddenFilingSince: number | null; downloadPercent: number | null; filedUntil: number | null; asleep: boolean }` and `interface TrayView { face: MenuBarState; title: string }`, in `tray-state.ts`.
  - `trayView(input: TrayInput, now: number): TrayView`. For each, the first match wins:
    - **The face:** `problem` → `needs-you`; `recordingSince` → `listening`; `busy` → `filing`; `filedUntil > now` → `filed`; `asleep` → `asleep`; otherwise `idle`.
    - **The title:** `setupOpen` → ""; `recordingSince` → `elapsed(now - recordingSince)`; `hiddenFilingSince` → `elapsed(now - hiddenFilingSince)`; `downloadPercent !== null` → `${downloadPercent}%`; otherwise "".
  - `elapsed(ms: number): string`: "0:00", "0:07", "1:05" or "12:03". It shows whole seconds, never negative. It is the capsule's own clock (`shared/clock.ts`).
  - `sleepsAfterReview(at: Date): boolean`: true from 18:00 to 05:59, local time.
  - `nextTrayWake(input: TrayInput, now: number): number | null`: the ms until the view changes by itself, which is the next whole second of a count that shows or the end of the filed stamp, whichever is sooner. Null when nothing counts down, so no timer runs.
  - `reviewEndedAt(env, now?: Date): Date`: `now`; with `AVANZEL_TEST=1`, `AVANZEL_FAKE_HOUR` (0 to 23) stands in for its hour, and anything else it holds is ignored.
  - `wholePercent(received: number, total: number): number | null`: from 0 to 100, null while the total isn't known.
  - `MenuBar.show(view: TrayView): void`.
    - It calls `setImage` only when the face changes, with one cached `NativeImage` per state, made with `image(faceIcon, true)`.
    - It calls `setTitle(view.title, { fontType: "monospacedDigit" })` only when the title changes.
    - It never rebuilds the menu, and does nothing once `tray.isDestroyed()`.
  - `MenuBar.shown: TrayView`.
  - `Controller.trayForTests(): TrayView & { nativeTitle: string }`: `shown`, plus `tray.getTitle()`, so a test sees what macOS was given.
- **What feeds `TrayInput` in the controller:**
  - **`problem`:** the capsule shows `error`, `model-failed` or `shortcut-taken`, or `libraryProblem`, `libraryMissing` or `model.kind === "error"` is set. Task 3's menu names a model error.
  - **`recordingSince`:** `this.recording && !this.recording.stopping ? this.recording.startedAt : null`.
  - **`busy`:** any of these:
    - the capsule is `transcribing`, or shows a `filing` card;
    - a filing waits or runs (`queuedToFile.size || runs.size`);
    - a review is queued or running (`running.size`);
    - an Ask is running (`giveUpAsk`).

    The download doesn't count; the title shows it.
  - **`hiddenFilingSince`:** `this.job.startedAt`, while its run is going (`this.runs.has(this.job.abort)`), it isn't `waiting`, and the capsule is `hidden`.
    - `withRun` keys `runs` by `job.abort` (controller.ts:1431-1439, :1456-1459).
    - A missing outcome isn't proof that a job is running: a run that threw, a note that was gone, and a Stop while queued all leave none.
  - **`downloadPercent`:** `Math.floor(received / total * 100)` while downloading.
  - **`filedUntil`:** set to `Date.now() + FILED_FACE_MS` (2000) when either of these happens:
    - any filing ends ok (`runFiling`'s success path);
    - a `saved` card shows that isn't `undone`. The Undone card is `saved` with `undone`, controller.ts:2250.
  - **`asleep`:**
    - It is set when `executeTask`'s `eveningReview` resolves without throwing and `sleepsAfterReview(reviewEndedAt(env))` holds, and no thought is in flight (`capturing()`: a recording, speech being made into words, an open editor, an edit still to be settled (`editing`: File after Edit during a review, whose filing waits behind it with its card shown or hidden; final fix wave), or the capsule's own filing, shown, hidden or waiting). Such a thought began before the review ended, so it is no "next capture" to wake Zel, and its filing would end on the asleep face.
    - It is cleared at the next capture (`startRecording`, `submitQuick`, or setup's typed thought through the host's `newCapture`, controller.ts:2919) and in `openLibrary`.
    - With `AVANZEL_TEST=1`, `AVANZEL_FAKE_HOUR` stands in for the hour, as `AVANZEL_FAKE_TRAY_BOUNDS` stands in for the bounds (tray.ts:57-61).
  - **`setupOpen`:** `this.setup.isOpen() || this.setup.upHereOpen()`.
- **When `refreshTray()` runs.** It doesn't show at once: it asks for `showTray` at the end of the turn of the event loop (`setImmediate`), so a run's end and its filed stamp don't flash through idle, nor a 0% between setup closing and its bubble opening. It is asked:
  - at the end of `refreshMenu()`, which covers start, `setCapsule`, library changes and broadcasts (`show()` sets nothing unchanged);
  - from `startRun` and `filingProgress` (controller.ts:1383-1402), which change `waiting` without `setCapsule`, from `withRun`, from an Ask's start and end, and after each change of `queuedToFile` that sets no capsule state;
  - from Setup's hook;
  - in the download's 250 ms gate (controller.ts:3106-3110), only when the whole percent changes;
  - from the one timer. `showTray` sets it from `nextTrayWake`: it fires at the next whole second of a count that shows (only while `recordingSince` or `hiddenFilingSince` is set) and when the filed stamp wears off, and it is re-armed from the clock each time.

  The timer is cleared on both quit paths, `stopAgentChecks()` and `stopForQuit()` (index.ts:38-48).

- [ ] **Step 1: Write the failing tests.**
  - **tray-state.test.ts:** each rule's order, one case per pair. For example:
    - `problem` with `recordingSince` gives `needs-you` with the title "0:05".
    - `busy` with `filedUntil` in the future gives `filing`, and an expired `filedUntil` gives `idle`.
    - `setupOpen` empties every title.
    - `{ downloadPercent: 37 }` alone gives the face `idle` and the title "37%".
    - `elapsed(65_400)` is "1:05", and `elapsed(-5)` is "0:00".
    - `sleepsAfterReview` is false at 17:59, true at 18:00 and 05:59, and false at 06:00.
  - **menu-bar.spec.ts:**
    - "the face listens and the title counts while recording". Use `AVANZEL_FAKE_AUDIO`, with the agent held 2 s (`FAKE_AGENT_DELAY_MS`) so that the filing can be seen.
      - While recording, the face is `listening`, the title matches `/^0:0[0-9]$/`, and after 2 s it has moved on.
      - Stopping gives `filing`, then `filed`, then `idle` within 2 s of `filed`.
      - `nativeTitle` equals the title throughout.
    - "a hidden filing keeps the face thinking and counts in the title". Hold the agent, then `dismiss`: the face is `filing` and the title counts up. At the end, the title is "" and the face is `filed`.
    - "a hidden filing that waits shows no title until its run starts". A weekly review holds the queue (`FAKE_AGENT_DELAY_MS` with `FAKE_AGENT_DELAY_TASK=review`). Dictate, then `dismiss`: the title is "" while the job waits, and counts from "0:00" once its run starts.
    - "a download shows its percent". With `fakeModelHub("trickle")`:
      - the face is `idle`, and the title matches `/^\d{1,3}%$/`, reading "0%" at the hub's pace;
      - after `closeModelHubs()`, the title is "" and the face is `needs-you`. The hub's zeros never pass SHA-256 (helpers.ts:256-263).
    - "there is no title while setup or its bubble shows". Run a first run with `fakeModelHub("trickle")`, and with `AVANZEL_FAKE_TRAY_BOUNDS` set so the bubble opens:
      - the title is "" through setup's steps (`toDone`) and while the bubble shows;
      - once `closeUpHere` runs, the percent shows.
    - "a problem shows needs-you". A failed filing's card gives `needs-you`, and Hide gives `idle`.
    - "after an evening review Zel sleeps until the next capture".
      - With `AVANZEL_FAKE_HOUR=21`, a note in the inbox and `runTask("evening-review")`, the face is `asleep`. The next dictation gives `listening`.
      - With `AVANZEL_FAKE_HOUR=9`, the same review leaves the face `idle`.
    - "title ticks don't rebuild the menu". Wrap `refreshMenu`, as `watchFilingStates` does (capsule-helpers.ts:183-203), for 3 s of recording. Expect at most one rebuild, since `tick()` or `broadcast()` may land in that time, as filing.spec.ts:742-745 allows.
    - **Added in the fix round:**
      - words saved for the evening review stamp the face `filed`, and the Undone card of an Undo doesn't;
      - a library that opens takes the stamp off before it wears off, and wakes Zel;
      - a Filing card with no run is busy, and the face keeps thinking while a stopped run's commit is taken back;
      - an Ask makes the face think until it is answered or stopped;
      - a filing Stopped before its turn, a note another Avanzel filed meanwhile, and a note filed in the background leave no face or count behind;
      - a review that ends while a thought is being recorded, made into words, edited or filed (hidden) doesn't put Zel to sleep;
      - quitting on either path stops the count where it was, and the timer runs only while something counts or the stamp wears.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/filing.spec.ts e2e/app.spec.ts e2e/models.spec.ts e2e/setup-ending.spec.ts e2e/setup-hello-found.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: Zel's face in the menu bar shows what Avanzel is doing, and its title counts`.

### Task 3: The menu says how today went, and shows each page's shelf

Owner items: 8, 14, 20.

**Files:**
- Modify:
  - `menu-model.ts`;
  - `tray.ts`: shelf glyph images replace the dots (black template images since Task 8, which macOS tints for the appearance and the highlight);
  - `library-info.ts`: `filedToday`;
  - `controller.ts`: the count's cache, `MenuTask.kind`, `speechProblem` and `speechSublabel`, and the menu's `open-settings:voice` action. (The first build rebuilt the menu on `nativeTheme`'s `updated` event for coloured glyphs; Task 8 removed it with them.)
- Test: `apps/mac/test/menu-model.test.ts`, `library-info.test.ts` and `e2e/menu-bar.spec.ts`.
- No e2e reads the ready library's head label. Only `menu-model.test.ts` pins it (:31-34, :36-40, :53-66, :76-84, :128-132).

**Interfaces:**
- **Consumes:** Task 1's `shelfGlyphIcon` and `SHELF_NAMES`.
- **Produces:**
  - `filedToday(root: string, now: Date): number`, in `library-info.ts`.
    - It counts today's lines in `log.md` whose operation is `file` (`- 2026-10-20 14:03 | file | …`, the `FILE_LINE` pattern), using local dates as `Vault.logLine` writes them. An Ask whose words mention " | file | " isn't a filing.
    - It does no page lookups, and a missing file counts as 0.
  - `MenuInput` gains `filedToday: number`, `speechProblem: string | null` and `speechSublabel?: string`, and `MenuTask` gains `kind: string`.
  - `speechProblemOf(model: ModelStatus): { title: string; sublabel: string } | null`, exported from `menu-model.ts`: null unless `model.kind === "error"`; the title is the capsule's own, and the sublabel says what is safe meanwhile and where the fix is, in the builders' own words (shared/problems.ts).
  - `statusLine(filedToday: number, evening: MenuTask | undefined, now: Date): string`, exported from `menu-model.ts`.
    - The evening review is the soonest enabled task whose `kind` is `"evening-review"` and whose `at` isn't null, picked as `upcoming` is (menu-model.ts:79-81).
    - It is named by its own `name`.
  - **The head item:**
    - Its label is `statusLine(…)`.
    - Its sublabel is "1 note in the inbox" or "N notes in the inbox", or none when the inbox is empty. The old "Next: …" sublabel goes.
    - Its action follows its words (Task 8): `open-inbox` while the sublabel names the inbox, and `open-library` when the inbox is empty and nothing names it.
  - **A speech-model problem item.** When `speechProblem` is set, an item follows the head.
    - Its label is the capsule's own problem title: "The speech model didn't finish downloading." (`downloadFailedProblem`, shared/problems.ts:258-264), or "Avanzel can't use the voice settings in this library's config file." (`voiceSettingsProblem`, :427-429).
    - Its second line (`speechSublabel`) says what is safe meanwhile and where the fix is, in the capsule's and Settings → Voice's own words (`TYPING_WORKS_MEANWHILE` and `TYPED_THOUGHTS_SAVED`, shared/problems.ts): "Typing works meanwhile. Try again in Settings → Voice." for a download that failed, and "Typed thoughts are still saved to the inbox. Fix the config file." for voice settings Avanzel can't use. Whether a retry continues or starts over is Settings → Voice's to say. (The first build said what a retry does, in words of its own; Task 8's design review replaced them.)
    - Its action is `open-settings:voice`. `menuAction` re-reads the voice settings (`rereadVoiceSettings`) and then calls `showSettings("voice")` directly. The capsule card's own path, `openSettingsFor`, would also hide an unrelated error or shortcut-taken card, so the menu doesn't use it.
    - The voice settings are re-read each minute (`tick`) and when this item is chosen while they are in error, so the item follows a fix made by hand in the config file. (`menu-will-show` is documented for `popup()` only, and an open menu isn't swapped.)
  - **Recently filed:** each item keeps `shelf` and gains a `sublabel`: `SHELF_NAMES[shelf]`, or the folder's name for a page off the shelves.
    - With no page to list, the section invites a first thought ("Nothing filed yet. Press ⌥Space and say hello.") only while nothing has been filed today and no filing can be undone (final fix wave): a filing that wrote no page would otherwise sit under "1 thought filed today." with its own Undo below. A section with nothing to show has no header.
  - **In `tray.ts`:**
    - An item's icon is the shelf's glyph (`shelfGlyph`), a black template image that macOS tints for a light or dark menu and the highlight, or none off the shelves.
    - Icons are cached per shelf. The appearance turning builds no new menu.
  - **The count's cache:**
    - it is seeded in `openLibrary` (controller.ts:484);
    - it is refreshed wherever `recent` is (controller.ts:1482, :2223, :3226, :3288);
    - it is recomputed in `tick()` when the date changes.

**Copy:**
- "Nothing filed today." / "1 thought filed today." / "3 thoughts filed today."
- When an evening review is on, add " " plus its name plus " " plus `nextPhrase(at, now)` plus ".". For example: "3 thoughts filed today. Evening review at 21:00.", or "… Evening review tomorrow at 21:00."

- [ ] **Step 1: Write the failing tests.**
  - **menu-model.test.ts:**
    - The head's label and sublabel for 0, 1 and 3 filed:
      - with the evening review today;
      - with it tomorrow, using a `now` after 21:00;
      - with no evening review;
      - with only a weekly review, which doesn't appear in the head;
      - with the review renamed "Nightly sweep", giving "… Nightly sweep at 21:00.";
      - with an enabled review whose `at` is null, which isn't named.
    - The recent items' sublabels are shelf names, or a folder name.
    - The speech-model item follows the head, with `open-settings:voice` and its second line. Without a problem there is none. `speechProblemOf` gives the failed download's line (the same whether the download can continue or must start over) and the voice settings' line, and null for a model that is ready or downloading.
    - Update `input()` (with `kind`) and the pinned head and label lists.
  - **library-info.test.ts:** `filedToday` counts only today's `file` lines. It ignores `review` and `ask` lines and yesterday's lines, and a missing `log.md` gives 0.
  - **menu-bar.spec.ts:**
    - "the status line counts today's filings". A fake filing gives "1 thought filed today. Evening review at 21:00.", or "… tomorrow at 21:00." after 21:00. The expected words come from the clock.
    - "Recently filed shows each page's shelf": the sublabels are the shelf names.
    - "a failed speech-model download is named in the menu". With `fakeModelHub("missing")`, the item after the head reads "The speech model didn't finish downloading.", and `menuAction("open-settings:voice")` opens Settings on Voice.
    - "voice settings Avanzel can't use are named in the menu until a fix is read again", and "choosing the voice settings problem in the menu reads them again, so Settings shows what is wrong now".
    - "choosing the speech model's problem in the menu leaves an error card, or a taken shortcut's notice, that is not about it up".
    - "the shelf glyphs in the menu are black template images, which macOS tints, and the appearance turning builds no new menu" (it was "drawn in the shelf's colour, and follow the appearance" until Task 8); "a library that opens brings the count of its own log, and its own pages"; "the count is read from the log once, and again when the day turns".
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/library.spec.ts e2e/app.spec.ts e2e/models.spec.ts e2e/setup-hello-found.spec.ts e2e/setup-ending.spec.ts e2e/shortcuts.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: the menu says how today went and shows each page's shelf`.

### Task 4: Undo the last filing, from the menu

**Files:**
- Modify `controller.ts` (`lastFiled`, `undoLastFiling`, the `undo-filing` action, `undoableFiling`, and the card's `undo()`) and `menu-model.ts` (the item).
- Test: `apps/mac/test/menu-model.test.ts` and `e2e/menu-bar.spec.ts`.

**Interfaces:**
- **Consumes:** Task 3's status line.
- **Produces:**
  - **`lastFiled: { commit: string; library: string; pages: FiledPage[]; job?: FilingJob } | null`,** on the controller. `library` is the root the filing filed in.
    - **Set** only when a capsule filing, or a background filing (`fileInBackground`, controller.ts:1773-1796), ends ok with a commit. That is `runFiling`'s success path, after controller.ts:1477.
      - Setup's first thought (`job.setup`) and the evening review never set it; each has its own Undo.
      - Edited and stopped runs return before that point (controller.ts:1471).
    - **Cleared**, rebuilding the menu if it was set:
      - when any filing's run starts. That covers `runFiling`, where it calls `startRun` (controller.ts:1448), on the capsule, background, setup and refile paths. A Stop on a filing that still waits in the queue clears nothing: no run has begun;
      - when a review writes to the library, in `executeTask`, since a revert of an older filing after it would conflict and be refused: the weekly review (`kind` `"review"`) as it starts, since it commits and appends to `log.md`; the evening review as it ends, in a `finally`, if it filed anything or threw. An evening review with nothing to file commits nothing and writes no log line, so the filing stays undoable, and the item comes back once the review is over (spec §6.3: it stays until the next filing). Task 4 first cleared at both reviews' start, which took the Undo away every evening on the default path; the final fix wave moved the evening review's clear to its end. A custom review is only skipped, with a notice, and clears nothing, so the last filing stands;
      - when its commit is taken back, before the take-back's first await. Stop and Edit take back through `takeBack` (controller.ts:2166-2177); Undo from the card or the menu goes through `revertFiling` (:2219-2225);
      - in `openLibrary`.
  - **`MenuInput.undoableFiling`** is true when `lastFiled` is set, its library is open, Avanzel isn't quitting, and no filing or review waits or runs (`queuedToFile.size === 0 && running.size === 0`). A running filing has already cleared `lastFiled`, and so has a running weekly review; an evening review hides the item through `running` until it ends, and clears `lastFiled` then only if it filed something.
    - `beginFiling` adds to `queuedToFile` before it shows the Filing card, so the one rebuild that follows already hides the item. A queued setup thought hides it too, since setup adds to `queuedToFile`. A background filing (`fileInBackground`) still has a moment in which the item is shown and a press does nothing; the queue add has no guarded rebuild.
  - **`Controller.undoLastFiling(): Promise<void>`.**
    - It acts only when `undoableFiling` holds and `lastFiled.job`, if any, isn't `undoing`.
    - Before its first await, it takes `lastFiled`, clears it, and sets `job.undoing`. Then it reverts `lastFiled.commit` through `revertFiling`.
    - **It reports once:**
      - if the capsule shows that job's filed card (`this.job === lastFiled.job && capsuleState.kind === "filed"`), the card turns to Undone, as the card's Undo does (controller.ts:2249-2250);
      - otherwise a notification says "Undone" with `undoneNote`, or gives `undoRefused`'s title and body.
    - Then it calls `refreshMenu`.
  - **The card's `undo()`** (controller.ts:2238-2252) also calls `refreshMenu` after it answers by notification. Otherwise it stays as it is.
  - **Also built, in the same paths:** `leftWithoutRun` rebuilds the menu; `takeBack` rebuilds it when git refuses, and re-reads the log (`readLog`), so a refused Stop's take-back leaves the filing standing and counted; `readLog` keeps its pages when the library can't be read. A queued revert follows the open library, as the card's does.
  - **The item:** "Undo the last filing" (action `undo-filing`) follows the recent items while `undoableFiling` is true.

- [ ] **Step 1: Write the failing tests.**
  - **menu-model.test.ts:** the Undo item appears only with `undoableFiling`, right after the recent items.
  - **menu-bar.spec.ts,** in a git library: use `makeLibrary({ git: true })` with `launchOn`, since `makeLibrary()` makes no repository (helpers.ts:21-32).
    - "Undo from the menu takes the last filing back and says so once". Hide the filed card, then `menuAction("undo-filing")`:
      - the page is gone, and the note is back in the inbox;
      - exactly one notification says "Undone";
      - the status line reads "Nothing filed today.", and the Undo item is gone;
      - a second `menuAction("undo-filing")` reverts nothing: `undoCalls` stays 1 (`watchUndos`, capsule-helpers.ts:231-253).
    - "Undo from the menu turns the showing filed card to Undone". The capsule's state is `saved` with `undone`, and there is no notification.
    - "Undo from the menu follows the last filing":
      - a background filing, from a usage-limit wait that comes due, offers Undo for its own commit;
      - none is offered after a failed filing, a filing Stop took back (`stopAtTheEnd`, helpers.ts:492-517), setup's first thought, or an evening review that filed;
      - the item hides while a filing or a review waits or runs. It is gone after a weekly review and after an evening review that filed a note, and back after a custom one, which changes nothing;
      - "an evening review with nothing to file leaves Undo the last filing in place, and the Undo still takes the filing back" (final fix wave);
      - the item goes with a library switch and with quitting, and a take-back of its commit (Stop, Edit, a refused one told once) takes it away.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/capsule-results.spec.ts e2e/filing.spec.ts e2e/app.spec.ts e2e/library.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: Undo the last filing stays in the menu until the next filing`.

### Task 5: A scheduled review asks before it runs, and shows its progress

Owner items: 7, 14.

**Files:**
- Modify:
  - `controller.ts`: `confirmRun`, `runTaskFromSettings`, the `task:<id>` action, and the review's progress (`countReview`);
  - `ipc.ts`: `settings:run-task` calls `runTaskFromSettings` (ipc.ts:45);
  - `menu-model.ts`: `MenuTask.progress`;
  - `packages/engine/src/core/librarian.ts`: the doc of `FileOptions.leave`, which now says what a `false` answer means (see the progress below; no behaviour changes), with a test in `packages/engine/test/core/librarian-runs.test.ts` that pins it;
  - `e2e/helpers.ts`: `answerDialogs`.
- Test: `e2e/menu-bar.spec.ts`, plus `settings.spec.ts` and `library.spec.ts`, where every Run now press calls `answerDialogs(app, 0)` first. Those presses are:
  - `settings.spec.ts:385`, `:396`, `:440` and `:553`;
  - `library.spec.ts:236`;
  - `library.spec.ts:258`, which is `hold()`, used at :263, :283 and :303.

**Interfaces (produces):**
- **`Controller.confirmRun(taskId: string, parent?: BrowserWindow): Promise<boolean>`.**
  - It returns false, asking nothing, when there is no library, no such task, or the task is running already. `runTask` would do nothing then (controller.ts:3218).
  - It returns true, asking nothing, for a review that runs no agent. A custom review (`kind` neither `"evening-review"` nor `"review"`) is only skipped by `executeTask`, with a notice, and the question would promise an agent run that doesn't happen.
  - Otherwise it calls `app.focus({ steal: true })`, then `dialog.showMessageBox(parent?, { type: "question", buttons: ["Run Now", "Cancel"], defaultId: 0, cancelId: 1, message, detail })`. The default is Run Now: it answers a press made a second ago, and Esc cancels.
  - It resolves true only for "Run Now", and only if the open library is still the one the question named. `runTask` would otherwise run the review of the same name in the other library, so Run Now for a library that changed during the question is dropped, silently.
- **Which paths ask:**
  - The menu's `task:<id>` (controller.ts:670) runs `confirmRun(id)`, then `runTask(id)`.
  - Settings' Run now calls `runTaskFromSettings(id)`: `confirmRun` with the Settings window as its parent, then `runTask`. Otherwise it returns the snapshot.
  - `runTask` itself never asks: `tick()`'s due runs and the e2e call it by name.
- **`MenuTask.progress?: string`,** for example "Filing 2 of 5" (`reviewProgress(done, total)` in `menu-model.ts`, capitalised like the other details; the first build said "2 of 5", without a unit, until Task 8).
  - `executeTask` passes the engine a `leave` callback made by `countReview(task.id, left)`, and the menu shows the count it keeps (`reviewing`, by task id).
  - The total is taken in `countReview`, as the review begins: `vault.pending()`, less what `leftAlone` would skip (controller.ts:3237-3243).
  - **A capture counts once, at the engine's `leave` pick, not at its first report.** The engine asks `leave(capturePath)` as it picks each capture, and a `false` answer is the pick: the capture is worked on from there, and `leave` isn't asked of it again (the doc of `FileOptions.leave`, pinned by an engine test for a note to leave alone, an unreadable note, a plain note, a recording and a silent recording). `countReview`'s wrapper counts the capture when its answer is false. That counts a recording once, though the engine reports it twice, and a note that can't be read, which reports nothing.
  - Captures that arrive during the review are filed too, so the total rises to meet the count: `Filing ${done} of ${Math.max(total, done)}`. The total is read once, so a capture that becomes one to leave alone after that stays in it, and the last count can read "Filing 2 of 3" until the review ends.
  - The menu shows `progress` as the item's detail instead of "Running…", and `runTask`'s `finally` clears it. One rebuild per counted capture, never per step: over a two-note review the menu is built four times (the review's start, each capture, its end), and the test allows one more for a tick.
- **`answerDialogs(app, response)`, in `e2e/helpers.ts`.**
  - From then on, `dialog.showMessageBox` answers `{ response, checkboxChecked: false }`.
  - It records each call's arguments for `dialogsAsked(app)`. That replaces the inline pattern at `library.spec.ts:585-591`.

**Copy:**
- Message: `Run “${task.name}” now?`
- Detail: `It runs with ${harnessName(named)} on your plan, so it may count toward your usage limit.`, for example "It runs with Claude Code on your plan, so it may count toward your usage limit." ("May", not "will": it is untrue for an empty inbox and for an agent on a local model. The capsule says "usage limit", and Settings says "on your plan".)
- With no agent to name (`selectedHarness` finds none), the detail is "It runs on your plan, so it may count toward your usage limit.", because `agentName` would give "your agent" (controller.ts:574-577).
- (The first build said "It's an agent run with Claude Code, so it may use your plan's quota."; Task 8's design review gave it the app's own words.)
- A custom review isn't asked about at all (see `confirmRun`).

- [ ] **Step 1: Write the failing tests** (`menu-bar.spec.ts`):
  - "running a review from the menu asks first".
    - With `answerDialogs(app, 1)`, no run happens: `lastRun` stays null. The message is "Run “Evening review” now?".
    - With `answerDialogs(app, 0)`, it runs.
  - "a review that is running isn't asked about". With a review held by `FAKE_AGENT_DELAY_MS`, `menuAction("task:evening-review")` asks nothing.
  - "Settings' Run now asks first". Use the same stub; the first argument is the Settings window, so the dialog is a sheet.
  - "a review on its schedule doesn't ask".
    1. Call `answerDialogs(app, 1)`.
    2. Write `checked: { "evening-review": <two days ago> }`, under the library's resolved path, into the test's userData `run-state.json`. `RunStateStore` reads it on every call (run-state.ts:15-44).
    3. `call(app, "tick")`: the review runs, and nothing was asked.
  - "a running review shows how far it is". Hold the fake agent with `FAKE_AGENT_STEP_MS`, and put two notes in the inbox.
    - The item's `detail` reads "Running…", then "Filing 1 of 2", then "Filing 2 of 2", then its time again.
    - `menuForTests` gives `label` and `detail` separately; "Evening review (Filing 1 of 2)" is only `menuLabel`'s rendering in tray.ts.
  - **Added in the fix round:**
    - "a custom review is never asked about: it runs no agent, and only says it was skipped";
    - "the question before a review names no agent where none can be named";
    - "a review is not run in a library other than the one the question named";
    - "a capture that arrives while the review runs is filed too, and the count rises to meet it", "the count leaves out a thought the review leaves alone", "a recording in the inbox counts once", and "a note the review can't read still counts";
    - "a review builds the menu once for each capture it counts, and at its start and its end".
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/settings.spec.ts e2e/library.spec.ts e2e/app.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: a scheduled review asks before it runs from the menu or Settings, and shows how far it is`.

### Task 6: Five quiet sounds: the module, main's triggers and the capsule

Owner items: 1, 3, 13, 15, 16, 19.

**Files:**
- Create `apps/mac/src/renderer/common/sounds.ts`.
- Modify:
  - `shared/ipc.ts`: `SoundName`, `AppSettings.sounds`, and the capsule's `onSound`;
  - `store.ts`: the default `sounds: false`, and only `true` normalises to true;
  - `preload/index.ts`: `capsule.onSound`;
  - `controller.ts`: `sound(name)` and its triggers, and `notify`'s `silent`;
  - `renderer/capsule/main.tsx`: playing, and the Tock once the microphone is released.
- Test: `apps/mac/test/sounds.test.ts`, `store.test.ts` and a new `e2e/sounds.spec.ts`.

**Interfaces:**
- **Consumes:** Task 2's review-end point in `executeTask`, where `asleep` is set.
- **Produces:**
  - `type SoundName = "tick" | "tock" | "stamp" | "drawer" | "letter"`, in `shared/ipc.ts`.
  - `SOUND_MS: Record<SoundName, number>`: the time of each sound's last sample.
    - tick 80, tock 90, stamp 200, drawer 220, letter 570.
    - The prototype's tones stop 20 ms after they fade (first-run.html:506), and its noise ends with its buffer (:507).
  - `playSound(name: SoundName, make?: () => AudioContextLike): void`, in `renderer/common/sounds.ts`.
    - It uses one AudioContext per page, made by `prepareSounds` when sounds go on (Task 7) or else at the first play (by `make` in tests); `releaseSounds` lets go of it when sounds go off. Task 6 kept it running for the page's life, so that the Tick, the one sound that races the microphone, is on time. The final fix wave measured that a running context keeps the Mac awake (coreaudiod's PreventUserIdleSystemSleep, with sounds on and nothing playing), so after 30 s with nothing played (`QUIET_MS`) the page suspends it. The next sound wakes it and waits for the wake (`wake`), and so does a recording's start (`wakeSounds`, as the listening state arrives) and a sound the capsule holds back (the Tock, the Stamp), as it arrives. The Tick after a suspend came 10 to 42 ms after main sent the listening state, against 5 to 6 ms awake.
    - Making the context opens the audio device, which took 110 to 130 ms here. The first Tick of a page that wasn't prepared is that much late, and built on the page's thread ahead of the listening card: Task 7 prepares the context off the dictation's path.
    - **The synth** is the prototype's (first-run.html:505-508):
      - tick = `tone(1320, .06, sine, .07, 880)`;
      - tock = `tone(760, .07, sine, .07, 520)`;
      - stamp = `tone(160, .18, sine, .30, 52)` plus `noise(.08, 1000, .9, .18)`. That is the prototype's .32 and .22, lowered so the layers sum to ≤ 0.5;
      - drawer = `noise(.22, 500, .7, .05, 2600)`;
      - letter = 1046.5 Hz at 0 s for 0.35 s (gain .05), then 1568 Hz at 0.1 s for 0.45 s (gain .04).
    - Each play is also pushed to `globalThis.__avanzelSounds` as `{ name, at: performance.now() }`, keeping the last 20.
  - **The `capsule:sound` channel** (main → capsule page) carries a `SoundName`. Main's `sound(name): boolean` sends it only while `store.get().sounds` is true and the capsule's page is listening, and says whether it did. While a recording runs, it sends only that recording's `tick` and `tock`.
    - A sound isn't held for a page that can't hear it yet, as a command is: it would come late, and a late sound is no twin of what happened. So it is lost, not late, in the first second after launch and after a reload, and a Letter that wasn't sent leaves the review's notification with macOS's sound.
  - **`notify(title, body, onClick?, silent = false)`.** `notified` records `silent: true` only on a silent notification, so the existing `toContainEqual({ title, body })` assertions stand.
- **Triggers in main:**
  - **`tick`:** in `startRecording`, after the listening state and just before `capsuleCommand("start")` (controller.ts:938-949). There is no delay before the recorder.
  - **`tock`:** just before `capsuleCommand("stop")` (`stopRecording`, :999), and just before the `cancel` that Esc or the × sends (`cancelRecording`, :1014-1020). A recording whose microphone fails to start has no Tock: listening never began (owner item 6).
  - **`stamp`:** when a `filed` card shows (:1490-1502).
  - **`drawer`:** when a `filed` card, or a `saved` card that isn't `undone`, goes to `hidden` (`cardSound`). A card that another card replaces isn't put away, and nor is a recording given up. The Undone card took a filing back, so nothing was filed or saved to put in the drawer.
  - **`letter`:** when the evening review's `eveningReview` resolves without throwing (`executeTask`, :3250-3266).
    - The review's notification then goes out with `silent: true` (§8 line 570).
    - With sounds off, or when no Letter was sent, the notification keeps macOS's sound.
  - A filing that ends in a notification plays nothing of the app's own.
- **The capsule page:**
  - It plays what it is told.
  - **A `tock`** waits until the `stop` or `cancel` that follows it has released the microphone: `recorder.stop()` or `recorder.cancel()` has resolved, and `sendAudio` hasn't run yet. With no recorder running (the fake microphone), it plays at once.
  - **The `stamp`** plays at the stamp's impact, 228 ms after the page draws the filed card. That is 60% of `--av-duration-card`'s 380 ms (stamp.css:31-35). It plays at once under Reduce Motion, and on a `noted` card, whose stamp doesn't animate (filed.tsx:42).

- [ ] **Step 1: Write the failing tests.**
  - **sounds.test.ts,** with a fake AudioContext that records oscillators, buffer sources and gains, with their start and stop times:
    - every sound's last stop or buffer end is within its `SOUND_MS`, and ≤ 0.6 s;
    - every gain's peak is ≤ 0.35, and the stamp's two layers' peaks sum to ≤ 0.5;
    - one AudioContext serves every play;
    - `playSound` records `{ name, at }`.
  - **store.test.ts:** the default is `sounds: false`, and only `true` normalises to true.
  - **sounds.spec.ts:**
    - "no sound is sent while sounds are off". Wrap the capsule's `webContents.send`, as `watchCapsule` does (setup-helpers.ts:43-55), and run a dictation and a filing: no `capsule:sound` is sent.
    - "with sounds on, each moment sends its sound, in order":
      - `tick` comes before `start`, and `tock` before `stop`;
      - `stamp` comes with the filed card, and `drawer` when it hides;
      - Esc while listening sends `tock` before `cancel`;
      - the capsule page's `__avanzelSounds` lists tick, tock, stamp and drawer.
    - "the Undone card isn't put in the drawer". In a git library, use the card's Undo: when the Undone card hides, no `drawer` is sent.
    - "a review's Letter comes with a silent notification". With sounds on, `letter` is sent and the review's notification has `silent: true`. With sounds off, there is no `letter` and no `silent`.
    - "no app sound plays over a recording". A held review ends while a dictation is listening: no `letter` is sent, and its notification isn't silent.
    - **Also built:** sounds.spec.ts has 17 tests, not five. The extra ones pin the page's own timing end to end: the Stamp's three cases (at its impact, at once under Reduce Motion, at once on a Noted card), the Tock's two orders against the microphone's release, and the Letter and the Drawer with the capsule window hidden.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Invoke the `avanzel-ui` skill before editing the renderer files.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/sounds.spec.ts e2e/app.spec.ts e2e/filing.spec.ts e2e/recording.spec.ts e2e/capsule-results.spec.ts e2e/library.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: five quiet sounds, off by default`.

### Task 7: Sounds in setup and Settings

Owner items: 2, 14, 15, 17.

**Files:**
- Modify:
  - `shared/ipc.ts`: `SetupSnapshot.sounds`, the bridge's `settings.mayPlaySounds` and the capsule's `onSoundsSetting`;
  - `preload/index.ts`: `capsule.onSoundsSetting` (`capsule:sounds-setting`) and `settings.mayPlaySounds` (`settings:may-play-sounds`);
  - `setup.ts`: the snapshot;
  - `controller.ts`: tells the capsule's page when sounds go on or off, and answers `mayPlayWindowSounds()`;
  - `renderer/common/sounds.ts`: `prepareSounds`, `releaseSounds`, `previewSounds` and `soundsSwitched`;
  - `renderer/capsule/main.tsx`: prepares and releases the context;
  - `renderer/setup/steps/Done.tsx`;
  - `renderer/settings/panes/General.tsx`, and a `.settings-preview` rule in Settings' CSS that only arranges, with space tokens.
- Test:
  - `e2e/sounds.spec.ts` and `e2e/settings.spec.ts`;
  - the switch counts at `setup-ending.spec.ts:100` (from 1 to 2) and `contrast.spec.ts:512` (from 2 to 3).

**Interfaces:**
- **Consumes:** Task 6's `playSound` and `AppSettings.sounds`.
- **The capsule's page is told when sounds go on or off** (Task 6's review, Minor 1).
  - `capsule:sounds-setting` carries a boolean. Main sends it when the setting changes, and once the page has loaded while sounds are on; it sends nothing at load while they are off. A page loaded with sounds on is told after the commands held for it, so a held start doesn't wait for the context.
  - On, the page calls `prepareSounds()`: it makes its AudioContext at once, off the dictation's path, so the first Tick of a launch is played about 25 ms after the listening card, where building it then took about 150 ms and delayed the card. (Since the final fix wave the context is suspended after 30 s with nothing played, and woken as a recording starts: Task 6's `QUIET_MS`.)
  - Off, the page calls `releaseSounds()`: it lets go of the device, clears a Tock that waits for the microphone, and a Stamp timer that comes later finds `soundsOn` false and plays nothing, so no late play opens the device again.
- **Setup's Done step:**
  - The Group keeps all three switches as its direct children, since a Group draws rows only for its direct children (group.css:8-17). They go in this order:
    1. "Open Avanzel when I log in", first, because `watchFirstSwitch` reads the first `[role="switch"]` (setup-ending.spec.ts:56-66);
    2. the review's switch;
    3. "Play sounds", off, last, so that Preview sounds, below the Group, sits right under its own switch (Task 8's design fixes; the first build had it second).
  - Below the Group: `<Actions align="start"><Button size="small" variant="secondary">Preview sounds</Button></Actions>`. "Start using Avanzel" stays the one primary.
  - Preview sounds plays four of the five sounds, whatever the setting: the Tick at 0, the Stamp at 260 ms, the Drawer at 520 ms and the Letter at 800 ms (`PREVIEW_AT_MS`). The times count from the Tick, which opens the device the first time and may take a tenth of a second. The first version played three, and a person deciding later heard only the Stamp.
  - Switching sounds on plays the Stamp, once the change is saved: a change that wasn't kept leaves the switch where it was and plays nothing (and setup has no place to tell it, as for the other two switches).
  - Setup's Play sounds has no description: two lines would scroll the tallest state (owner item 2).
- **Settings → General:** a "Sounds" group right before "Startup" (it shows with or without a library), with `<Switch label="Play sounds" description="A tick and a tock as you start and stop recording, a stamp and a whoosh as the capsule files a card and puts it away, and two soft bell tones when the evening review is done." />`.
  - The description says only what plays. The first version promised a stamp when a card is filed, which doesn't play for a filing that ends in a notification, for the review's cards or over a recording, and it didn't name the Drawer. Task 8's design review named the Tock and said "tones", since "notes" is the app's word for a capture (owner item 14).
  - Under the switch, in the same Group, a "Preview sounds" button (small, secondary) in a `.settings-preview` box, since a Group draws only its direct children as rows. It plays the same four sounds.
  - Switching it on plays the Stamp, once the change is saved. Off lets go of this page's audio device, and main tells the capsule's page to do the same.
- **A window's own sound asks main first.** Setup's Preview and its switch-on Stamp, and Settings' Preview and Stamp, call `settings.mayPlaySounds()` (`settings:may-play-sounds`, answered by `!this.recording`) before each sound, and a Preview asks again before each of its four. They stay quiet while a recording runs: the recorder keeps no echo cancellation, so a window's sound would be heard in the words, and the Done step's "Press ⌥Space" starts a real recording there.

- [ ] **Step 1: Write the failing tests.**
  - "setup offers sounds, off, with Preview sounds". Use `toDone(app)`:
    - the switches are, in order, the login switch, "Play sounds" (`aria-checked` false) and the review's;
    - the one primary is still "Start using Avanzel";
    - pressing Preview sounds puts tick, stamp, drawer and letter in the setup page's `__avanzelSounds`, timed on the page's own clock at 0, 260, 520 and 800 ms from the Tick (the test reads the page's times, not the wall clock, and polls longer than the Preview takes);
    - switching sounds on adds a stamp and saves `sounds: true`.

    Update the counts at `setup-ending.spec.ts:100` and `contrast.spec.ts:512`.
  - "Settings has Play sounds". Switching it on saves `sounds: true` and puts a stamp in the Settings page's `__avanzelSounds`. Switching it off saves `false`. Settings' Preview plays the same four.
  - **Also built:**
    - "switching sounds on makes the capsule page's AudioContext before any sound plays, and switching them off closes it";
    - "a page that loads with sounds on makes its AudioContext as it loads, and the first Tick is played on it", and "a page that loads with sounds off is told nothing about sounds, and makes no AudioContext";
    - "a Tock that waits for the microphone is dropped when sounds go off", and "a Stamp that would land after sounds went off is not heard", each leaving the device closed;
    - "setup's Preview sounds and Play sounds stay quiet while a recording runs, and play once it is over";
    - "a Play sounds that can't be saved in setup leaves the switch where it was, plays no Stamp and leaves no unhandled rejection".
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Invoke the `avanzel-ui` skill before editing the renderer files.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/sounds.spec.ts e2e/setup-ending.spec.ts e2e/contrast.spec.ts e2e/settings.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: setup and Settings offer the sounds, with a preview`.

### Task 8: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check` (the baseline stays `{}`) and `npm run ui:e2e`.
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`: `npm run build`, then `env -u AVANZEL_E2E_AGENT -u AVANZEL_E2E_PACKAGED -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`. Expected: no failures. Re-run each known flake once, and report the wall time.
- [ ] **Step 3: Take the shots** into `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/shots/1d/`, with a README:
  - the six faces at 2x, on a light and a dark menu-bar grey, with the titles "0:12" and "37%";
  - the menu's text in each state, and its shelf glyphs in light and dark;
  - setup's Done step and Settings → General, in light and dark.

  Use a throwaway spec, archived as `.txt` in the flight pack's `archive/1d-work/` and never committed.
- [x] **Step 4: The design review.** The controller ran the `design-reviewer` agent on the Done step, General and the face shots, and ruled a list. It is fixed in one commit, `mac: the menu bar reads as one design`:
  1. **The face's six states have words.** `trayTooltip(face)` (tray-state.ts) gives the icon's tooltip, set whenever the face changes ("Avanzel", "Avanzel is recording", "Avanzel is working", "Avanzel saved it", "Avanzel needs you", "The evening review is done"; this commit said "Avanzel is filing" and "Avanzel filed it", which the final fix wave made true on every path: the busy face is also an Ask, a transcription that files nothing yet and the weekly review, and the stamp also follows a saved card). Electron's Tray has no accessibility label, so the tooltip is all the text a hover or VoiceOver gets, and the filing face reads like idle at 18 pt. `trayForTests` gives `tooltip`.
  2. **In setup, Preview sounds sits under Play sounds.** The Done step's switches are the login switch, the review's and Play sounds, last. Preview, below the Group, is tied to its switch by place alone (owner item 2), so the place has to be right.
  3. **The menu's speech item says what is safe.** See owner item 14. `TYPING_WORKS_MEANWHILE` and `TYPED_THOUGHTS_SAVED` (problems.ts) are the builders' own words; `MenuInput.speechRetry` is now `speechSublabel`.
  4. **The app's own words.** The review question's detail and the sounds description (owner item 14), and the review's notification: "Evening review: 1 thought filed" or "N thoughts filed", as the menu's head counts them.
  5. **Settings opens without scrolling.** The window is 680 × 660, where General needs 557 px of pane (it had 513 at 600). The least height stays 440.
  6. **Three menu wordings.** The running review's count is "Filing 1 of 2" (`reviewProgress`), the Undo item is "Undo the last evening review" (the menu, the Reviews pane's note and the README), and the head opens the inbox only while its second line names it: with an empty inbox it opens the library.
  7. **Ink glyphs in the menu.** The shelf glyphs are black template images, so macOS tints them for a light menu, a dark menu and the highlight (the coloured ones fell under 3:1 on a light menu, 1.35:1 for Ideas, and kept their colour on the selection). The per-appearance cache, the `nativeTheme` rebuild, `SHELF_COLORS` and `tinted` are gone: the images are cached per shelf.
  - Left as they are, for the owner: the filing face's dots merge with the base at menu-bar size (owner item 11), and Run Now stays the review question's default button.
- [ ] **Step 5: List the by-hand checks** in the flight pack as pending for the owner, never as done:
  - with sounds on, record with the Mac's microphone and with AirPods: the Tick isn't heard in the saved recording (`raw/audio/`, the first half-second; owner item 16);
  - on macOS 27, the shelf images show in the menu, in light and dark, and on the selected row, where a template image should turn the highlight's white (owner item 8);
  - after setup's flight, with a download running, the bubble's tail points at Zel;
  - the six faces read at menu-bar size, in light and dark; the `needs-you` dot, the `asleep` z and the `filing` face's dots (owner item 11) are the small parts;
  - the title beside the icon on a crowded or notched menu bar, in light and dark (owner item 12);
  - the review question, from the menu and from Settings: from the menu it comes to the front, Return runs the review and Esc cancels, and focus goes back to the app that had it after Cancel; from Settings it is a sheet on the window;
  - by ear (owner items 15, 16 and 19): levels on laptop speakers and with AirPods; the first Tick after a launch with sounds on (about 25 ms after the card, where it was about 150), and the first Tick after 30 s of quiet, which waits for the audio to wake (measured 10 to 42 ms after main sent the listening state, against 5 to 6 ms awake); the Tick in the take; the Tock after the card, and with AirPods in call mode; the Stamp against the stamp's contact, under Reduce Motion and on a Noted card; the Drawer as the window hides, and before a screen comment's Tick; the Letter as two tones with no chime, or a chime and no tones with sounds off; a review that ends mid-dictation puts macOS's chime in the take; with sounds on and 10 minutes idle, the headset stays free (the context is suspended after 30 s, and `pmset -g assertions` holds no audio assertion then), and the output follows a device switch;
  - a recording past a few minutes ("12:03", "60:00"), App Nap over a long hidden filing, and a download on a real network.
- [ ] **Step 6: Docs.** Update this plan's tables to what was built, and fill in the owner items it found.
  - Done: the Built list, the Architecture and Global Constraints, each task's text, the Review Focus lists and owner items 11 to 20, in the commit `docs: the 1d plan says what was built`.
  - The flight pack's docs are the controller's.
