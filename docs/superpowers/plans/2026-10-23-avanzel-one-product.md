# Avanzel Phase 1f, "one product": Settings, Quick and Ask built from @avanzel/ui — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings, Quick and Ask look, read and behave like the first-run setup window, because they are built from the same `@avanzel/ui` components and the same copy rules. Afterwards no window but the capsule is left on the design checks' baseline.

**Architecture:**
- **Ask** follows setup's Ask step. Main reads each answer into its lines and the pages its `[[links]]` name (`answeredFrom`, moved out of `setup.ts` into `library-info.ts`). The window draws them with `Text`, `ShelfTag` and link `Button`s. `marked` and `dompurify` go.
- **Quick** is a frameless panel whose surface macOS draws (`vibrancy: "popover"`, native corners and shadow). Its page is clear and holds the gallery's large bare field.
- **Settings** keeps its snapshot and its IPC.
  - The sidebar becomes a `Segmented` toolbar under a hidden title bar.
  - Each pane is rebuilt in its own file under `settings/panes/`, one task at a time.
  - Until the last pane moves (Task 9), the window keeps `common/mac.css` for the panes not yet rebuilt. Then it switches to `@avanzel/ui/base.css`, and Task 10 deletes `mac.css`.
- **What `@avanzel/ui` lacks is stood in for, never added:**
  - a shortcut recorder: a `Kbd`, a Change button and a `keydown` listener;
  - pickers: a Choose… button that asks main for a native `Menu.popup`;
  - a time field: a `TextField` checked as HH:MM.
- **Words:** "Shadow tasks" becomes "Scheduled reviews" wherever a person reads it.

**Tech Stack:**
- TypeScript (ESM, `.ts` import suffixes) and Node ≥ 22.
- Electron 44.9 with React 19 renderers bundled by esbuild (`apps/mac/scripts/build.mjs` builds every `src/renderer/<page>/main.tsx`), and `@avanzel/ui`.
- Vitest, and Playwright for Electron.

**Spec:** `reports/Avanzel UX and first-run design.md`. It is untracked and lives only in the main checkout: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`.
- **The sections used:**
  - §1, row 9: the jargon in Settings ("Shadow tasks", "Tools & MCP" with five "Coming soon" rows, "Parakeet v3", "workspace sandbox");
  - §4.1: native window chrome, with the personality in the objects;
  - §6.4: Quick and Ask;
  - §6.5: "Shadow tasks" becomes "Scheduled reviews";
  - §7: empty states;
  - §10: accessibility.
- **The mockup the owner was shown:**
  - Its source is `.superpowers/mockups/settings/SettingsMockup.tsx` in this worktree (git-ignored). Its screenshots are `/tmp/avz-ds/settings-mockup/shots/<pane>-<light|dark>.png`.
  - Two corrections apply to it: no Zel in Settings, and no "I" or "my" in Settings copy.
- **The UI contract** is `packages/ui/DESIGN.md`.
- **Phase 1a's plan,** `docs/superpowers/plans/2026-10-21-avanzel-setup-window.md`, built the patterns reused here: the choice list, the source chips and the Ask step.

## Where this plan sits

Three parts are done on main:
- Phase 0 (7deda48);
- Phase 1's setup window, 1a (9c0c276);
- Phase 1's narration and filing guard, 1b (0a9a266).

What changed since 1b's plan:
- **The release moved.** On 2026-10-22 the owner put it after the product plan's Phase 5, so Phase 1 no longer ships alone.
- **The owner's concern.** On 2026-10-23 they said setup has the "wow", but "it should be consistent, as one ready to use product".
  - Settings, Quick and Ask are the windows still built before the design system. 1f rebuilds those three.
  - The capsule is 1c's, and the menu bar's Zel face is 1d's.
  - The measure: after 1f, `packages/ui/checks/baseline.json` lists the capsule's two files and nothing else.

**After 1f, the order is 1c, then 1e, then 1d.**
- **1c: the capsule's card, stamp, chips and narration.** It waits on the owner's verdicts on 1a's and 1b's stand-ins. Once the capsule's legacy buttons go, contrast.spec.ts can drop its last legacy probe, `ON_FILL`.
- **1e: the §7 error copy and 1a's parked first-run gaps,** such as a remembered library that is missing. It now lands once, in windows built from `@avanzel/ui`, Settings' library Notices included.
- **1d: the menu bar's Zel face and sounds.** §6.5's "Running one from the menu asks first" goes there with the menu, and Settings' Run now asks first at the same time.

**Not in 1f:**
- §6.4's Ask extras: three suggested questions, Save as a page, and dictating a question with ⌥Space while Ask is open.
- §6.4's "Show answers in the reading face". DESIGN.md keeps the `words` faces for the person's own words, so an agent's answer stays in the interface face. The owner can rule otherwise.
- Quick's card, narration and stamp after Return. They are the capsule's (1c).
- Zel in Quick or in Settings (owner item 6).

## Global Constraints

### Scope

- **In:**
  - Ask, rebuilt on setup's Ask pattern. `AskResult` gains the lines and the pages, `answeredFrom` is shared, and `marked` and `dompurify` are removed.
  - Quick, on a native popover panel, with the gallery's field.
  - Settings: the toolbar, the five panes rebuilt, Tools & MCP removed, and the Welcome form replaced by Notices. It also gets the native-menu pickers and the shortcut recorder stand-in.
  - "Scheduled reviews" wherever a person reads it: Settings, the menu's header, the controller's copy, the library's `AGENTS.md` template and the README.
  - `common/mac.css` deleted, the baseline lowered, and the contrast test's Settings-era probes removed.
- **Out:**
  - the capsule (1c);
  - the menu bar's face and sounds, and "asks first" (1d);
  - §7's copy (1e);
  - §6.4's Ask extras.
- **No change in `packages/ui`,** except the cleanup task's `checks/baseline.json`, written only by `npm run design:check -- --update-baseline`. DESIGN.md and `apps/mac/src/renderer/AGENTS.md` tell agents to run it after a migration, and `checks/guard.mjs` blocks only `--init-baseline`.

### The UI rules (from DESIGN.md)

- **Windows arrange; they don't paint.**
  - Changed window code arranges `@avanzel/ui` components, imported from `"@avanzel/ui"` and nothing deeper.
  - A window that has moved over imports `"@avanzel/ui/base.css"` once, first.
  - No raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<kbd>`, `<svg>`, `<a>` or `<h1>`–`<h6>`. Plain `div`, `span`, `main` and `article` elements, and ARIA roles on them, are fine.
  - No `style`, and no `className` on components.
  - Window CSS sets layout only, with `var(--av-space-N)` for spacing (2 4 6 8 10 12 16 20 24 32 40 48; there is no 14).
- **No components, variants, tokens, gallery entries or screenshots are added.** Where nothing fits, build the stand-in this plan names; the real component is an owner item.
- **Settings panes are laid out as in the mockup.**
  - Each pane is a `Stack gap={20}` under its heading, `Text variant="heading"`, which the shell draws.
  - Groups take their label from `Group label`, and their small print from `Group note`.
  - An on/off setting is a `Switch` in the `Group`. Anything else is a `GroupRow`, with its control on the right.
  - Content that isn't a row (the shelf tabs, a paragraph, a `TextArea`, an editor's Save) sits in a box of the window's own, padded `var(--av-space-10) var(--av-space-12)` or `var(--av-space-12)`.
- **Rows stay direct children of their `Group`.**
  - group.css styles rows only as the box's direct children (`.av-group-box > .av-group-row`), so never wrap a `GroupRow` or a `Switch`.
  - When several rows have buttons of one name (Change, Check, Choose…), put the row's controls in a `<div role="group" aria-label={the row's name}>` inside its control slot. VoiceOver then hears which Change it is, and tests find each row by `getByRole("group", { name })`.
- **No hook below an early return.** A pane that needs a library is rendered only when there is one: the shell renders `snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`. React would throw once a library opened if a pane returned early above its hooks.
- **One primary per moment.** In Settings, only a Notice's fix and a review editor's Save are primary. When a pane shows more than one Notice, only the first one's fix is.
- **Zel appears in none of these windows,** and none of their copy says "I", "me" or "my".

### Behaviour every task keeps

- **No test runs a real agent or downloads a model.**
  - `launch()` points the models at a dead port, puts stand-ins for `claude` and `codex` first on PATH, and fakes the global shortcuts.
  - Settings → Agents runs only the free checks (`checkAgents`) when it opens, which read a sign-in. Check asks the one short question.
- **Electron objects are reached at call time,** never through bound copies: `dialog.showOpenDialog`, `shell.openPath`, `shell.openExternal` and `Menu`. The e2e tests stub them on the live objects.
- **Native menus are stubbed in tests.**
  - Every e2e test that clicks a Choose… button first calls `answerMenus` (Task 4). A real native menu would hold the test until it timed out.
  - A test reads `shownMenus` only after `await expect.poll(() => shownMenus(app)).toHaveLength(n)`, because the menu opens after an IPC round trip.
- **Deep links keep working.**
  - `showSettings(pane)` and an error card's `open-settings:<pane>` open that pane.
  - A pane Settings doesn't have means General.
  - A window that is already open moves to the pane (`settings:show-pane`).
- **Esc closes Quick and Ask.** Quick hides. Ask closes, which gives up its question.
- **These names stay:**
  - the window titles "Avanzel Settings" and "Ask your library" (setup.spec.ts counts windows by title);
  - the IPC channel names;
  - the internal names `ShadowTask`, `TaskInfo` and the pane id `"tasks"`.
- **Settings works without a library.** Voice and Privacy work as usual. General shows the no-library Notice, and Agents and Reviews show it too once they are rebuilt.
- **Settings applies each change at once,** through the existing IPC (`setApp`, `setLibrary`, `saveTask`, `checkAgent`, `runTask`). The one exception is a review's editor, which saves on Save.
- **The other windows don't change.** The capsule, the setup window and the bubble behave as before; setup.spec.ts changes only where Task 3 moves its helpers.
- **Interface files are changed with the Edit and Write tools.** The design guard refuses shell writes to `.tsx`, `.css` and `.html` under `apps/*/src/renderer`. Deleting `mac.css` with `git rm` is fine.

### Copy

Sentence case, verbs first on buttons, no "!", the one-character "…", and they/them. Units are written as "673 MB" and "12 s". No model names, and no sandbox jargon. In the table, `{…}` is a value and `<↩>` is a `Kbd`.

| Where | Text |
|---|---|
| Ask: field | `TextField` "Ask your library" (label hidden), placeholder "Ask your library…" |
| Ask: empty | "Answers come from your library only, with links to the pages they use." |
| Ask: pending | "Looking through your library…", or main's "Waiting for the filing in progress to finish…" |
| Ask: answered | the question as the turn's heading; the answer's lines; "Pages used:" with each page's shelf and title; "{fake} answered in {12} s", never "0 s" |
| Ask: failed | error `Notice`, title "{fake} couldn't answer." and body "{the agent's last lines}". When nothing ran, the message alone is the title |
| Quick | `TextField` "Type a thought" (label hidden), placeholder "Type a thought…", `icon="waveform"`; footnote "<↩> to save" |
| Settings: toolbar | `Segmented` "Section": General, Voice, Agents, Reviews, Privacy. Each pane's heading is its name |
| General: library | `Group` "Library". The row's label is `{~/Avanzel}`, and its description is `libraryLine`: "{128} pages on six shelves." ("1 page…"; no pages: "Your first thought will fill a shelf."), then "Every change is a commit you can undo." or "This folder has no git history, so changes can't be undone." |
| | buttons "Show in Finder", "Open in Obsidian" (only when Obsidian has the library as a vault), and "Change…" (quiet); under the row, the six shelf tabs, without counts |
| General: library problem | error `Notice`, title "{libraryProblem}." and body "Choose it again once it's fixed, or choose another folder.", with action "Choose a folder…" |
| General: no library | info `Notice`, title "Avanzel has no library open." and body "Setup makes one, or opens the one you have.", with action "Set up Avanzel…" |
| General: filing | `Group` "After you speak": row "File each thought", description "Right away uses your agent now. Tonight waits for the evening review."; `Segmented` "When to file" with "Right away" and "Tonight" |
| General: startup | `Group` "Startup": `Switch` "Open Avanzel when you log in" |
| Voice: shortcuts | `Group` "Shortcuts", note "They work in every app.". One row per action, named as the menu names it (`ACTION_NAMES`), with a `Kbd` and "Change"; while recording, the button reads "Type the new shortcut…" |
| Voice: a shortcut's problem | error `Notice`, title "{shortcutProblems[key]}"; body, with a library, "“{Record a thought}” is still in the menu bar."; actions "Use {⌃⌥R}", "Use {⌃⇧Space}", best last |
| Voice: microphone | `Group` "Microphone". The row's label is "System default", the device's name, or "Microphone not connected"; description "Avanzel listens only while the capsule shows it listening."; button "Choose…", whose menu has "System default", then each device ("Microphone {n}" when it has no name) |
| Voice: speech | `Group` "Speech": row "Speech model", description "Turns your voice into text on this Mac. Nothing is sent anywhere." Its control: "Ready" (ok), or "Download ({673} MB)", or a `Progress` "Downloading the speech model" with "{412} of {673} MB" |
| | a failed download: error `Notice` "The speech model didn't finish downloading.", body "Typing a thought works meanwhile.", action "Try again". Settings it can't use: error `Notice` "Avanzel can't use these voice settings.", body "{message}" |
| Agents | `Group` "Who files your thoughts", note "Avanzel runs the agent inside your library folder, with your own sign-in and plan. Checking Claude Code or Codex reads their sign-in; other agents are asked one short question." |
| | each row: the agent's name, with description "Experimental" for an experimental one. Its status, then "Best results" (Claude Code), then a check icon "Chosen" or "Use {Codex}", then "Check" or "Check again". Not installed: "Copy install command", then "Copied" for 2 s (Claude Code and Codex only) |
| | the last row: "Choose automatically", description "Avanzel uses the best agent installed: Claude Code first.", with the check icon "Chosen" or "Use automatic" |
| | statuses: "Installed", "Not installed", "Checking…", "Signed in", "Replied in {1.6} s"; "Not signed in. Run `claude` once in Terminal and sign in." ("Run `codex login` in Terminal.", or "Sign in to {name} in Terminal."), then the agent's own line; "Didn't reply within 15 s."; `ownLine(detail)` or "Didn't reply." |
| | `Group` "{agent in use}": row "Model", description "A smaller model often files just as well and costs less.", `TextField` "{agent} model" (label hidden), placeholder "Your agent's default" |
| Reviews | intro footnote "Scheduled reviews run on this Mac with your agent, on your plan. If the Mac is asleep at the time, a review runs once it wakes." |
| | one `Group` per review, labelled with its name. `Switch` "On", described by kind: "Files anything still in the inbox and writes a short summary." / "Looks over the whole library and writes a report in reviews/." / "Avanzel doesn't run custom reviews yet." |
| | then a row whose label is "Every day at {21:00}" or "{Sundays} at {18:00}", described "Not run yet.", "Running now…", or "Last run today at {21:00}." ("yesterday at …", "on {Sunday} at …", "on {2 Oct} at …"), with "Run now" and "Edit" (or "Close") |
| | the evening review's note: "Undo last evening review, in the menu bar menu, takes back its last run." |
| | the editor's rows: "Repeats", with a `Segmented` "How often" holding "Every day" and "Every week"; "Day" (weekly only), with the day and "Choose…"; "Time", with a `TextField` "Time" (label hidden), and the row's description "Use a time like 21:00." when the time isn't one; "Agent", with "The library's agent" or the agent's name, and "Choose…". Then a `TextArea` "Instructions", and "Save" |
| | a save that fails: error `Notice` "This review couldn't be saved.", body "{message}" |
| | `Group` "Files that can't be used", note "Fix them in your library's tasks/ folder. The other reviews run as usual.", with one row per file: label "{tasks/broken.md}", description "{why}" |
| Privacy | `Group` "Permissions", note "After you allow screen recording, quit and reopen Avanzel: macOS applies it only then." |
| | rows "Microphone", described "Only while the capsule shows it listening.", and "Screen recording", described "Needed only to capture the screen with a comment.". Each control is "Allowed" (ok), or "Allow…" (the microphone only, while macOS hasn't asked), or "Open System Settings" |
| | `Group` "What leaves this Mac": callout "Your voice never leaves this Mac. Your words go only to the agent you chose, the same way your code already does." |
| Menu | the header "Shadow tasks" becomes "Scheduled reviews" |
| Controller | "No scheduled review called {id}."; a custom one's notification: "Avanzel doesn't run custom reviews yet, so this one was skipped." |
| `AGENTS.md` template, README | "Shadow tasks" becomes "Scheduled reviews", and "a shadow task" becomes "a scheduled review" |

Where this copy departs from the mockup, and why:
- **The shelf tabs have no counts.** `ShelfTag`'s count badge is labelled "{count} new" (`Shelf.tsx:64`), so VoiceOver would say "41 new" for a total. The row's description gives the total (owner item 7).
- **The shortcut rows use the menu's names.** Settings' rows use `ACTION_NAMES` ("Capture screen with a comment"), so the row and the menu item agree.
- **The model row is a `TextField`,** with the placeholder "Your agent's default", not "Your default" with "Change…". There is no list of models to choose from, so the name is typed, as it is today.
- **"Often" in the model's description.** "A smaller model files just as well" would promise more than the app knows.
- **The choice list ends with "Choose automatically",** which the mockup lacks. Without it, a library could never go back to letting Avanzel pick, as today's Agent menu's "Automatic" can.
- **Privacy's rows.** Each row's description says what the permission is for, and its control says the state. The mockup had "Allowed." with "On", which says the state twice.
- **Reviews follow the decided structure.** One `Group` per review with a `Switch` "On" replaces the mockup's evening switch and its rows of Run now.
- **The Agents note adds a sentence,** on which checks ask a question, because a check costs the person's quota.
- **The library's description adds the commit sentence,** so the row says why every change can be undone.

### Process

- **Electron e2e** runs with `ELECTRON_RUN_AS_NODE` unset: the T3 shell sets it. From `apps/mac`, run `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/<spec>.ts`.
- **No new npm dependencies.** Task 1 removes two.
- **Commits:** one per task.
  - The subject reads `mac: a sentence saying what now happens`.
  - The body is wrapped near 78 columns, with bullets saying what changed and why, and no trailers.
  - Never skip the hooks.
- **Each task's gate:**
  - `npm test -w @avanzel/mac`;
  - `npm test -w @avanzel/engine`, in Task 7;
  - `npm run typecheck`, whose scope includes `apps/mac/e2e`;
  - `npm run design:check`;
  - the e2e specs the task names.
- **Known flakes,** which fail the same way on `main`. Re-run a failure once before looking into it; the owner's own use of the Mac during a run causes some.
  - `microphone.spec.ts:15`;
  - `recording.spec.ts:36`;
  - the engine's "stops an agent that runs too long";
  - an Electron quit hang in about 2.4% of runs;
  - under load, `setup.spec.ts`'s layout check near `:791`, and the bubble tests (`setup.spec.ts:2589–2737`);
  - `contrast.spec.ts`'s setup and bubble test.

### Owner items

These need the owner's approval, or are the owner's choice:

1. **Moving between panes.** The stand-in is a `Segmented` "Section" toolbar. The owner may prefer a sidebar, or a toolbar component with icons, as System Settings has.
2. **A ShortcutField.** The stand-in is a `Kbd`, a "Change" button and a `keydown` listener on the window.
3. **A Select, or pop-up button,** for the microphone and a review's day and agent. The stand-in is the value in words and "Choose…", which opens a native menu.
4. **A time field** for a review. The stand-in is a `TextField` checked as HH:MM.
5. **1a's stand-ins, reused here:** the agent choice list, the "Best results" badge, and the source chip in Ask.
6. **Zel in Settings and in Quick.** There is none.
   - DESIGN.md keeps Zel to setup, the capsule, the menu bar and letters.
   - §6.4 asks for Zel's face in Quick, and the mockup's first brief had Zel in Settings' library band.
   - Either needs DESIGN.md's Zel rule changed.
7. **The shelf counts in Settings.** 1f shows the six tabs without counts. `ShelfTag`'s badge is the drawer's "just went in" count, labelled "{count} new". A variant for totals would bring the counts back, as the mockup has them.
8. **Quick's material.** The page is clear over macOS's popover material, which the page can't read. So the contrast test reads Quick over the window surface token. Check Quick by eye in light and dark, over a dark and a light desktop.
9. **A stale comment in `packages/ui/src/base.css`.** It still mentions `common/mac.css`. 1f leaves `packages/ui/src` alone.

## Review Focus

1. **A window opened on a deep-linked pane,** including one Settings no longer has (`open-settings:tools`), and a link that arrives while a shortcut is being recorded.
   - The window opens on that pane, with its toolbar choice checked and its heading shown.
   - An unknown pane means General.
   - A recording in progress ends, and nothing is saved.
   - Pinned by Task 3's "Open Settings moves a Settings window that is open to the pane…" (with its `tools` and `tasks` lines) and Task 5's "Change records the next shortcut…".
2. **A library problem at launch:** a library folder Avanzel can't open, or no library at all.
   - Settings opens on General, with an error Notice and Choose a folder…; with no library, Set up Avanzel….
   - Voice and Privacy still work, and Agents and Reviews show the same Notice.
   - Pinned by Task 3's library.spec tests "a library that can't be opened…" and "Settings without a library offers setup…", which Tasks 6 and 8 extend, and by models.spec's "without a library nothing downloads…".
3. **A shortcut recording that is interrupted:** by Esc, by the focus moving elsewhere, by the window losing the focus, or by a key with no modifier.
   - The old shortcut stays, and the button reads Change again.
   - Only a whole shortcut is saved.
   - Pinned by Task 5's `accelerator.test.ts` and its shortcuts.spec test "Change records the next shortcut…".
4. **An agent list with none installed,** or a library whose own agent isn't installed.
   - Every agent row says Not installed, and Claude Code and Codex offer their install commands.
   - No agent row offers Use or Check.
   - The library's agent is still marked chosen, and its Not installed shows as its problem.
   - Pinned by Task 6's "with no agent installed…".
5. **A scheduled review file that can't be parsed,** and a time typed wrong in the editor.
   - The file is listed under "Files that can't be used", with why, and the other reviews still show and run.
   - "25:00" is refused with "Use a time like 21:00.", and the file keeps its schedule.
   - Pinned by Task 8's library.spec tests.

---

### Task 1: Ask shows each answer in paragraphs, with a button for each page it used

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts:444-449`, which is `AskResult`.
- Modify: `apps/mac/src/main/library-info.ts`. Add `answeredFrom`, importing `answerSources` from `./setup-model.ts`.
- Modify: `apps/mac/src/main/setup.ts`.
  - Delete the private `answeredFrom` (`1099–1117`).
  - `askInSetup` (`1083`) spreads `answeredFrom(this.host.vault()?.root ?? null, result.text)`.
  - The imports at `43` and `48` lose `findPage`, `pageInfo` and `answerSources`.
- Modify: `apps/mac/src/main/controller.ts`: `closeAsk` (`1328–1330`), `ask` (`1332–1351`), and the import at `79`.
- Modify: `apps/mac/src/main/windows.ts:153-167` (`createAskWindow`). Set `trafficLightPosition: { x: 18, y: 18 }`, as setup's window has.
- Create: `apps/mac/src/renderer/ask/copy.ts`.
- Rewrite: `apps/mac/src/renderer/ask/main.tsx` and `apps/mac/src/renderer/ask/styles.css`.
- Modify: `apps/mac/package.json` and `package-lock.json`, through npm only.
- Test:
  - `apps/mac/test/library-info.test.ts`;
  - create `apps/mac/test/ask-copy.test.ts`;
  - `apps/mac/e2e/app.spec.ts`;
  - `apps/mac/e2e/contrast.spec.ts:216-224`.

**Interfaces:**
- Produces:
```ts
// shared/ipc.ts
export interface AskResult {
  ok: boolean;
  /** ok: the agent's reply. Otherwise what failed: "{agent} couldn't answer.\n{its last lines}" for a run that
      failed, or the message alone when nothing ran (no library, a question the engine refuses). */
  answer: string;
  agent: string;
  seconds: number;
  /** ok: the reply's lines, as answerSources reads them; [] otherwise. */
  paragraphs: string[];
  /** ok: the pages its [[links]] name that are in the library; [] otherwise. */
  sources: FiledPage[];
}
// main/library-info.ts
/** An answer as Ask and setup's Ask step show it: answerSources' lines, and the pages its links name, each found
    with findPage. A name that finds no page, or whose search throws, is left out. Without a library: no pages. */
export function answeredFrom(root: string | null, text: string): { paragraphs: string[]; sources: FiledPage[] };
// renderer/ask/copy.ts
/** "{agent} answered in {n} s", in whole seconds and never 0. */
export function answeredLine(agent: string, seconds: number): string;
/** A failed answer as its Notice shows it: its first line is the title, the other lines, joined by spaces, the body. */
export function failureLines(answer: string): { title: string; body: string };
```
- **The controller.**
  - `ask` returns `{ ok, answer, agent, seconds, ...(ok ? answeredFrom(this.vault?.root ?? null, text) : { paragraphs: [], sources: [] }) }`.
  - A run that failed reads `` `${agent} couldn't answer.\n${text}` `` (a full stop where the colon was).
  - `closeAsk` does nothing for a window that is destroyed.

**The window:**
- `import "@avanzel/ui/base.css"` comes first. No `common/mac.css`.
- **Layout,** so the turns scroll and the body doesn't:
  - `#root { height: 100% }`;
  - `.ask { display: grid; grid-template-rows: 40px auto minmax(0, 1fr); height: 100% }`, which holds a drag strip, the field and the turns;
  - `.ask-drag { -webkit-app-region: drag }`;
  - `.ask-field`, padded `0 var(--av-space-24) var(--av-space-16)`;
  - `.ask-turns { overflow-y: auto }`, with `overflow-wrap: anywhere` and padding `0 var(--av-space-24) var(--av-space-24)`;
  - the empty state centred (`text-align: center`), 24 below the field.
- **The field:** `TextField label="Ask your library" labelHidden placeholder="Ask your library…" autoFocus onEnter={ask}`, as setup's Ask step has it.
- **Each turn** is an `<article>` holding a `Stack gap={8}`:
  - `Text variant="headline" as="h2"` with the question;
  - a `<div role="status">` with the pending line (a small `Spinner` beside `Text variant="footnote" tone="secondary"`) or the answer;
  - for a failure, the error `Notice` from `failureLines`, outside the status region. Notice is an alert itself.
- **The answer** is a `Stack gap={12}`:
  - the lines, as `Text`, in a `Stack gap={6}`;
  - when there are sources, "Pages used:" as `Text variant="footnote" tone="secondary"`, then for each page a `Row gap={6} wrap` holding `ShelfTag` (when `isShelf`, from `../setup/copy.ts`) and `Button variant="link"` with its title. The button calls `window.avanzel.ask.openPage(pageName(page.path))`.
  - then `answeredLine`, as `Text variant="footnote" tone="secondary" numeric`.
- **Order:** newest first. Turns are keyed by a counter, not by their index. One question at a time, as today.
- **Esc:** a `keydown` listener on `window`, as `up-here/main.tsx` has, calls `ask.close()`. The field has no `onEscape`, so a press closes once.

- [ ] **Step 1: Write the failing tests.**
  - **`library-info.test.ts`:**
    - "answeredFrom reads an answer's lines and the pages its links name, and leaves out a name with no page". In `library()`, the text `"See [[launch-podcast|the podcast]] and [[nowhere]].\n\n## Next\n**Call Mark**"` gives:
      - paragraphs `["See the podcast and nowhere.", "Next", "Call Mark"]`;
      - sources `[{ title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md" }]`.
    - "answeredFrom without a library keeps the lines and names no page": `answeredFrom(null, "See [[x]].")` equals `{ paragraphs: ["See x."], sources: [] }`.
  - **`ask-copy.test.ts`:**
    - "answeredLine counts whole seconds and never says 0 s": `("fake", 0.2)` gives "fake answered in 1 s", and `("Claude Code", 12.6)` gives "Claude Code answered in 13 s".
    - "failureLines splits what happened from what the agent said": `"fake couldn't answer.\nagent crashed: not logged in"` gives `{ title: "fake couldn't answer.", body: "agent crashed: not logged in" }`, and a one-line message gives that line with body `""`.
  - **`app.spec.ts`:**
    - "asking shows the agent's answer" (`225`) now also expects:
      - the heading "What are my goals?" (`exact`);
      - `getByText(/^fake answered in \d+ s$/)`;
      - no "Pages used:".
    - New: "an answer's links become buttons for the pages they name". With `goals/run-a-marathon.md` holding "# Run a marathon", ask "What about [[run-a-marathon]]?". Visible: the button "Run a marathon" (`exact`), `getByText("Goals", { exact: true })` and `getByText("Q: What about run-a-marathon?")`.
    - New: "the newest question comes first". Ask "First question?", wait for "Q: First question?", then ask "Second question?". `ask.getByRole("heading")` has the texts `["Second question?", "First question?"]`.
    - "a failed answer names the agent…" (`238`):
      - the first call matches `{ ok: false, answer: "fake couldn't answer.\nagent crashed: not logged in", agent: "fake", paragraphs: [], sources: [] }`;
      - the second also has `paragraphs: []`.
    - New: "a failed answer says so in the window". With `FAKE_AGENT_MODE: "fail"`, ask through the field. `ask.getByRole("alert")` contains "fake couldn't answer." and "agent crashed: not logged in".
    - New: "Esc closes Ask from anywhere in it". After a sourced answer, focus the button "Run a marathon" and press Escape. The window closes: use `waitForEvent("close")`, with the press `.catch(() => undefined)`, as at `app.spec.ts:327–329`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- library-info ask-copy`. Expected: FAIL, because `answeredFrom` and `ask/copy.ts` don't exist.
- [ ] **Step 3: Implement** the type, the move, the controller's changes and the window.
- [ ] **Step 4: Remove the dependencies.** From the worktree root, run `npm uninstall -w @avanzel/mac marked dompurify` (add `--offline` if npm reaches for the network). Afterwards `grep -rn "marked\|dompurify" apps/mac/src apps/mac/package.json` prints nothing.
- [ ] **Step 5: Read Ask in contrast.spec.ts the way setup's windows are read.**
  - Ask is read over `desktops`.
  - The library gets `goals/run-a-marathon.md` ("# Run a marathon").
  - The question is "What are my goals besides [[run-a-marathon]]?".
  - The wait is for `ask.getByRole("button", { name: "Run a marathon" })`.
- [ ] **Step 6: Run the checks.**
  - Run `npm test -w @avanzel/mac`, `npm run typecheck` and `npm run design:check`.
  - From `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/app.spec.ts e2e/setup.spec.ts e2e/contrast.spec.ts`. setup.spec.ts's Ask step uses the moved helper.
  - Expected: PASS.
- [ ] **Step 7: Commit.** Subject: `mac: Ask shows each answer in paragraphs, with a button for each page it used`.

### Task 2: Quick is a native panel holding the gallery's thought field

**Files:**
- Modify: `apps/mac/src/main/windows.ts:123-144` (`createQuickWindow`).
- Modify: `apps/mac/src/renderer/quick/index.html`, which becomes `<html lang="en" data-backdrop="clear">`.
- Rewrite: `apps/mac/src/renderer/quick/main.tsx` and `apps/mac/src/renderer/quick/styles.css`.
- Test: `apps/mac/e2e/app.spec.ts`, and `apps/mac/e2e/contrast.spec.ts`, where `windowColour` (`38`) and the Quick lines (`209–214`) change.

**Interfaces:**
- Produces `export const QUICK_SIZE = { width: 640, height: 68 };` in `windows.ts`.
- `createQuickWindow` takes `QUICK_SIZE`, `show: false`, `frame: false`, `vibrancy: "popover"`, `visualEffectState: "active"`, `backgroundColor: "#00000000"`, `roundedCorners: true` and `hasShadow: true`. It drops `transparent`. It keeps `resizable`, `minimizable`, `maximizable` and `fullscreenable` false, with `skipTaskbar`, `alwaysOnTop`, `type: "panel"` and every workspace, as now.

**The window:**
- `import "@avanzel/ui/base.css"` comes first. No `common/mac.css`.
- **Layout:**
  - `#root { height: 100%; }`. Without it, `.quick` shrinks to the 44 px field and clips the bare field's focus ring (`field.css:41`).
  - `.quick` is a flex row with `align-items: center`, `gap: var(--av-space-12)`, `height: 100%` and padding `0 var(--av-space-16)`.
  - `.quick-field` is `flex: 1; min-width: 0`.
  - The 12 px above and below the 44 px field leave room for its focus ring (§6.4: "Restore the focus ring").
- **The field:** `TextField label="Type a thought" labelHidden size="large" variant="bare" icon="waveform" placeholder="Type a thought…" autoFocus disabled={busy} onEnter={submit}`.
- **The footnote:** `<Text variant="footnote" tone="secondary" as="span"><Kbd>↩</Kbd> to save</Text>`.
- **Esc:** a `keydown` listener on `window` calls `quick.close()`.
- **Submitting** works as today. A save that fails keeps the words in the field.

- [ ] **Step 1: Write the failing test** in `app.spec.ts`: "Quick is a clear page on a native panel: its field has the focus, and Esc puts it away".
  - `openQuick`. The field "Type a thought" is focused.
  - `quick.locator("html")` has `data-backdrop="clear"`, and `quick.locator("kbd")` has the text "↩".
  - Press Escape. A `shown(app, "quick")` like `models.spec.ts:23` polls to false.
- [ ] **Step 2: Run it.** Expected: FAIL. Today's page isn't clear, and its "↩ to save" is a plain span, with no `Kbd`.
- [ ] **Step 3: Implement** the window and its panel.
- [ ] **Step 4: Read Quick in contrast.spec.ts over the window surface** (owner item 8). Delete `windowColour`, and add:
```ts
// Quick's page is clear, over the popover material macOS draws, which the page can't read: it is read over the window
// surface, the tone that material keeps.
const surface: Bases = async (_mode, page) => [
  await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.backgroundColor = "var(--av-surface-window)";
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }),
];
```
- [ ] **Step 5: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/app.spec.ts e2e/library.spec.ts e2e/models.spec.ts e2e/contrast.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** Subject: `mac: Quick is a native panel holding the gallery's thought field`.

### Task 3: Settings moves between its panes on a toolbar, and General shows the library with its shelves

Tools & MCP goes here, with the sidebar, because the toolbar has no place for it. The panes not rebuilt yet (Voice, Agents, the tasks pane and Privacy) stay in `settings/main.tsx` as they are, with their helpers and `common/mac.css`, until their own tasks.
- **Keep them in `settings/main.tsx`.** The baseline covers that file. The same code moved to a new file would be held to every rule at once.
- **Keep `@avanzel/ui`'s `Group` out of `main.tsx`.** The file keeps its local `Group`, `Toggle` and the rest for those panes until Task 9.
- **The interim look is expected.** Until Task 9, `mac.css` also styles the `@avanzel/ui` text fields its input rule reaches. Leave it.

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`: `SETTINGS_PANES` (`20`), `LibraryInfo` (`168–177`), `SettingsSnapshot` (`180–196`), and the bridge's `settings` (`478–500`).
- Modify: `apps/mac/src/preload/index.ts:32-48` and `apps/mac/src/main/ipc.ts:31-46`.
- Modify: `apps/mac/src/main/controller.ts`:
  - `snapshot()` (`1449–1501`);
  - two new methods beside `showSettings` (`1418`);
  - import `tildePath` from `./setup-model.ts`.
- Modify: `apps/mac/src/main/windows.ts:55-73` (`createSettingsWindow`).
- Create:
  - `apps/mac/src/renderer/settings/copy.ts`;
  - `apps/mac/src/renderer/settings/parts.tsx`;
  - `apps/mac/src/renderer/settings/panes/General.tsx`, the first file of `settings/panes/`.
- Modify: `apps/mac/src/renderer/settings/main.tsx`. Out go `ICONS` and the local `Icon`, `Welcome`, the old `General`, `Tools`, and the sidebar and its header. In comes the shell.
- Modify: `apps/mac/src/renderer/settings/styles.css`.
  - Out go `html, body { background: transparent }`, `.window`, `.sidebar*`, `.ni*`, `.ico*`, `.content`, `.tb*`, `.welcome*`, `.seg*`, `.path` and `.app-ico*`.
  - In come the layout rules below.
- Test:
  - create `apps/mac/test/settings-copy.test.ts` and `apps/mac/e2e/settings.spec.ts`;
  - modify `apps/mac/e2e/helpers.ts`, `setup.spec.ts`, `app.spec.ts`, `agents.spec.ts`, `library.spec.ts`, `models.spec.ts`, `shortcuts.spec.ts` and `contrast.spec.ts`.

**Interfaces:**
- Produces:
```ts
// shared/ipc.ts
export const SETTINGS_PANES = ["general", "voice", "agents", "tasks", "privacy"] as const; // "tools" goes
// LibraryInfo gains:  /** The path with the home folder as "~" (tildePath). */ label: string;
// SettingsSnapshot gains:  /** Open in Obsidian works: Obsidian is installed, and the library has .obsidian/ (obsidianUrl). */
//                          opensInObsidian: boolean;
// The bridge's settings gains:
showLibrary(): void; // settings:show-library — Show in Finder: the library's folder opens in Finder
openSetup(): void;   // settings:open-setup — Set up Avanzel…: setup opens or comes forward, and Settings closes
// controller.ts
showLibraryInFinder(): void;   // shell.openPath(vault.root), reached at call time; nothing without a library
openSetupFromSettings(): void; // nothing while a library is open; else setup.show(), then a Settings window that is open closes
// renderer/settings/copy.ts
export const PANE_LABELS: Readonly<Record<SettingsPane, string>>; // General, Voice, Agents, Reviews, Privacy
/** The library row's description, from LibraryInfo.shelves (the six shelves count; others don't) and isGit. */
export function libraryLine(shelves: Readonly<Record<string, number>>, isGit: boolean): string;
/** `text` ending as a sentence: a full stop added, unless it ends in ".", "?" or "…". */
export function asSentence(text: string): string;
// renderer/settings/parts.tsx
export interface PaneProps { snap: SettingsSnapshot; onChange(snapshot: SettingsSnapshot): void }
/** The Notice without a library: libraryProblem's, with Choose a folder…, or the no-library one, with Set up Avanzel…. */
export function NoLibrary({ snap, onChange }: PaneProps): ReactNode;
// renderer/settings/panes/General.tsx
export function General({ snap, onChange }: PaneProps): ReactNode;
// e2e/helpers.ts
/** Opens Settings (showSettings) and moves to `pane` on its toolbar; returns the window once that pane's heading shows. */
export async function openSettings(app: ElectronApplication, pane = "General"): Promise<Page>;
// moved verbatim from setup.spec.ts and exported: stubPicker, pickerAsked (96–110), stubOpening, openedWith (1923–1937)
```
- **`snapshot()`** sets `label` in both of its `LibraryInfo` branches, and sets `opensInObsidian: !!vault && obsidianUrl(vault.root, "") !== null && this.obsidianInstalled()`.
- **`createSettingsWindow`** opens at `width: 680, height: 600, minWidth: 640, minHeight: 440`. It loses `vibrancy`, `visualEffectState` and `backgroundColor`, and keeps its title, `titleBarStyle: "hiddenInset"` and `trafficLightPosition: { x: 18, y: 18 }`.
- **The shell (`main.tsx`):**
  - `.settings` is a grid with `grid-template-rows: 40px auto minmax(0, 1fr)` and `height: 100%` (with `#root { height: 100% }`).
  - `.settings-drag` is `-webkit-app-region: drag`.
  - `.settings-toolbar` is a flex row with `justify-content: center` and padding `0 var(--av-space-24) var(--av-space-20)`. It holds `Segmented label="Section"`, with options from `SETTINGS_PANES` and `PANE_LABELS`.
  - `<main className="settings-pane">` has `overflow-y: auto`, `overflow-wrap: anywhere` and padding `0 var(--av-space-24) var(--av-space-24)`. It holds `<Stack gap={20}><Text variant="heading">{label}</Text><div>{pane}</div></Stack>`.
  - `startingPane()` and `onShowPane` stay as they are.
- **General** follows the copy table.
  - It shows `NoLibrary` in place of the Library group when `snap.library?.exists` is false, never as an early return. "After you speak" and "Startup" follow either way.
  - The shelf tabs are `<div className="settings-shelves"><Row gap={6} wrap>…</Row></div>`, padded `var(--av-space-12)`, holding `SHELVES.map((shelf) => <ShelfTag shelf={shelf} variant="tab" />)`. They take no `count` (owner item 7).
  - "Change…" and "Choose a folder…" call `onChange(await api.chooseLibrary())`. "Open in Obsidian" calls `api.openLibrary()`.

- [ ] **Step 1: Write the failing tests.**
  - **`settings-copy.test.ts`:**
    - "the toolbar lists the panes in their order": `SETTINGS_PANES.map((pane) => PANE_LABELS[pane])` equals `["General", "Voice", "Agents", "Reviews", "Privacy"]`.
    - "libraryLine counts the six shelves' pages and says whether changes can be undone":
      - all six shelves at `12, 41, 9, 18, 27, 21` with git give "128 pages on six shelves. Every change is a commit you can undo.";
      - `{ ideas: 1 }` with git gives "1 page on six shelves. …";
      - `{}` with git gives "Your first thought will fill a shelf. Every change is a commit you can undo.";
      - `{ ideas: 2, projects: 5 }` without git gives "2 pages on six shelves. This folder has no git history, so changes can't be undone.".
    - "asSentence ends a line with a full stop once": it adds one to "…mkdir '/x/tasks'", and leaves "Done." as it is.
  - **`settings.spec.ts`** (new). Its header comment: "The Settings window, built from @avanzel/ui: its toolbar, and each pane's controls."
    - "Settings moves between its five panes on its toolbar, by click and by the arrow keys":
      - `getByRole("radiogroup", { name: "Section" }).getByRole("radio")` has the texts `["General", "Voice", "Agents", "Reviews", "Privacy"]`;
      - each radio, clicked, is `aria-checked="true"`, its heading (`exact`) shows, and `snap(settings, "settings-<pane>")` runs;
      - with "General" focused, ArrowRight checks "Voice" and shows its heading;
      - `getByText("Tools & MCP")` has count 0.
    - "General shows the library with its shelves, and each of its controls applies at once". The library is `makeLibrary({ git: true })` with `goals/a.md`, `ideas/b.md` and `ideas/c.md`; `other` is `makeLibrary()`.
      - "3 pages on six shelves. Every change is a commit you can undo." and the six shelf names (`exact`) show.
      - The radio "Tonight" makes the snapshot's `fileMode` "evening".
      - The switch "Open Avanzel when you log in" makes `launchAtLogin` true.
      - After `stubOpening`, "Show in Finder" opens the library: the `realpathSync` of `openedWith`'s paths equals `[realpathSync(library)]`.
      - "Open in Obsidian" has count 0.
      - After `stubPicker(app, other)`, "Change…" makes `library.path` `other`. The row then reads "Your first thought will fill a shelf. This folder has no git history, so changes can't be undone.".
    - "Open in Obsidian shows only for a library Obsidian has opened, and opens it there".
      - Before opening Settings, `mkdir .obsidian` and set `app.getApplicationNameForProtocol = () => "Obsidian"`, as `setup.spec.ts:2118–2122` does.
      - After `stubOpening`, the button's `openedWith` starts with `obsidian://open?path=`.
  - **`library.spec.ts`:**
    - "a library that can't be opened…" (`53`) is renamed: "…is explained in Settings and the menu, and Choose a folder… fixes it".
      - `settings.getByRole("alert")` contains `/Avanzel couldn't open the library/` and `/permission denied/`.
      - After `stubPicker(app, good)`, where `good` is a `makeLibrary()`, its "Choose a folder…" makes `library.path` `good`.
      - The heading "Library" (`exact`) then shows.
    - New: "Settings without a library offers setup, which comes forward as Settings closes".
      - Launch with `firstRun().env`, which opens setup by itself, then `call(app, "showSettings")`.
      - "Avanzel has no library open." shows.
      - Clicking "Set up Avanzel…" closes Settings, using the close-wait pattern of `app.spec.ts:327–329`.
      - `call(app, "setupStepForTests")` is "hello".
    - "a malformed task file…" (`8`) moves on the radio "Reviews". The pane's text stays the legacy one until Task 8.
  - **`agents.spec.ts`:**
    - `agentsPane` becomes `openSettings(app, "Agents")`.
    - `paneButton` becomes `paneRadio = (settings, name) => settings.getByRole("radio", { name, exact: true })`, and every `aria-current="page"` check becomes `aria-checked="true"` (`154–222`).
    - "Open Settings moves a Settings window that is open to the pane…" (`172`) gains two lines, after the `open-settings:privacy` check at line 183: `openSettingsFor("open-settings:tools")` checks General (Review Focus 1), and `openSettingsFor("open-settings:tasks")` checks Reviews.
  - **The other specs:**
    - `models.spec.ts:44`, `185` and `203`, and `shortcuts.spec.ts:178`, click the radio "Voice".
    - Delete `models.spec.ts:144-162` (the Welcome). `setup.spec.ts:177` covers the size of the download.
    - Delete `app.spec.ts:395-406`. `settings.spec.ts` replaces it.
  - **`contrast.spec.ts`:**
    - The Settings loop (`193–207`) clicks each radio, waits for its `exact` heading and its texts as now, and reads the pane over `desktops`.
    - Delete `sidebar` (`35`).
    - The Welcome test (`237–245`) becomes "Settings without a library is readable in light and dark": launch with `firstRun().env`, call `showSettings`, wait for "Avanzel has no library open.", and read over `desktops`.
  - **`setup.spec.ts`:** delete the four moved helpers and import them from `./helpers.ts`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- settings-copy`. Expected: FAIL, because the module doesn't exist.
- [ ] **Step 3: Implement** the IPC, the snapshot fields, the window, the shell, `parts.tsx`, `copy.ts` and General.
- [ ] **Step 4: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/settings.spec.ts e2e/agents.spec.ts e2e/library.spec.ts e2e/models.spec.ts e2e/shortcuts.spec.ts e2e/setup.spec.ts e2e/contrast.spec.ts e2e/app.spec.ts`. Expected: PASS, apart from the known flakes.
- [ ] **Step 5: Commit.** Subject: `mac: Settings moves between its panes on a toolbar, and General shows the library with its shelves`.

### Task 4: Settings → Voice picks the microphone from a native menu

This task brings the native-menu picker that Task 8 uses again for a review's day and agent. Voice's other groups stay legacy until Task 5, so for now the new Microphone group sits among them.

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/main/ipc.ts`, for `settings:pick`.
- Create: `apps/mac/src/main/popup.ts`.
- Modify: `apps/mac/src/main/controller.ts`: `pickFromSettings`, beside `showSettings`.
- Create: `apps/mac/src/renderer/settings/panes/Voice.tsx`, which starts with `MicrophoneGroup`.
- Modify:
  - `settings/parts.tsx`: `ChooseButton`;
  - `settings/copy.ts`: the microphone helpers;
  - `settings/main.tsx`: the legacy `Voice` renders `<MicrophoneGroup snap={snap} onChange={onChange} />` in place of its own "Microphone" group (`239–247`), and loses its `mics` state and effect (`177–180`).
- Test:
  - create `apps/mac/test/popup.test.ts`;
  - `settings-copy.test.ts`;
  - e2e `helpers.ts` and `settings.spec.ts`.

**Interfaces:**
- Consumes `PaneProps` and `openSettings`, from Task 3.
- Produces:
```ts
// shared/ipc.ts
/** One choice of a native pop-up menu, as Settings' Choose… offers it. */
export interface PickOption { label: string; value: string; checked: boolean }
// The bridge's settings gains (settings:pick, ipcMain.handle):
/** Choose…: a native menu of `options` pops up at `at` (window points; null: at the pointer). Resolves with the
    value picked, or null when the menu closes without one. */
pick(options: readonly PickOption[], at: { x: number; y: number } | null): Promise<string | null>;
// main/popup.ts
/** The page's request, checked: each option an object with a non-empty string label and a string value (checked:
    `=== true`), the first 50 at most; `at` with finite numbers, rounded and at least 0, else null. Null with no option. */
export function pickRequest(options: unknown, at: unknown): { options: PickOption[]; at: { x: number; y: number } | null } | null;
export function popupChoice(win: BrowserWindow, options: readonly PickOption[], at: { x: number; y: number } | null): Promise<string | null>;
// controller.ts
/** Choose…, in Settings: null without an open Settings window or a valid request; else popupChoice on it. */
pickFromSettings(options: unknown, at: unknown): Promise<string | null>;
// renderer/settings/copy.ts
export interface InputDevice { deviceId: string; label: string }
export function microphoneName(id: string | null, devices: readonly InputDevice[]): string;
export function microphoneOptions(id: string | null, devices: readonly InputDevice[]): PickOption[];
// renderer/settings/parts.tsx
/** "Choose…" in a group named `label`; its menu pops up at the group's bottom left (getBoundingClientRect). */
export function ChooseButton({ label, options, onChoose }: { label: string; options: readonly PickOption[]; onChoose(value: string): void }): ReactNode;
// renderer/settings/panes/Voice.tsx
/** Voice's "Microphone" group: the device in use, and Choose…. */
export function MicrophoneGroup({ snap, onChange }: PaneProps): ReactNode;
// e2e/helpers.ts
/** From now on, the native menus Settings pops up record their items and pick the one labelled `choice`, or close
    without a pick when it is null. Each call starts a new record. */
export async function answerMenus(app: ElectronApplication, choice: string | null): Promise<void>;
/** What answerMenus' stand-in was asked to show since it was set, oldest first. */
export async function shownMenus(app: ElectronApplication): Promise<{ label: string; checked: boolean }[][]>;
```
- **`popupChoice`** builds `Menu.buildFromTemplate(options.map((o) => ({ label: o.label, type: "checkbox", checked: o.checked, click: () => resolve(o.value) })))`. It calls `menu.popup({ window: win, ...(at ?? {}), callback: () => resolve(null) })`.
  - Electron's macOS menu controller runs a picked item's `click` first, and posts the close callback after it (`menuDidClose:` in `electron_menu_controller.mm`). So the later `resolve(null)` changes nothing.
  - The e2e stand-in keeps that order. No test opens a real native menu, so Task 11 reports that one is still to be tried by hand.
- **`answerMenus`** stubs the live `Menu.prototype.popup`:
```ts
await app.evaluate(({ Menu }, pick) => {
  const shown: { label: string; checked: boolean }[][] = [];
  (globalThis as { shownMenus?: typeof shown }).shownMenus = shown;
  Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
    shown.push(this.items.map((item) => ({ label: item.label, checked: item.checked })));
    this.items.find((item) => item.label === pick)?.click();
    options?.callback?.();
  };
}, choice);
```
- **The microphone group:**
  - On mount, `navigator.mediaDevices.enumerateDevices()` lists the `audioinput` devices, leaving out `deviceId === "default"`.
  - The row is `GroupRow label={microphoneName(…)}`, with `ChooseButton label="Microphone"` as its control.
  - `microphoneName(id, devices)`:
    - `null` gives "System default";
    - a device found gives its label, or "Microphone {i + 1}" when it has none;
    - otherwise it gives "Microphone not connected".
  - `microphoneOptions` gives "System default" (value `""`) first, then each device, named the same way, with `checked` on the current one.
  - A choice saves `setApp({ microphoneId: value || null })`.

- [ ] **Step 1: Write the failing tests.**
  - **`popup.test.ts`:**
    - "pickRequest keeps the well-formed options, at most fifty, and rounds the point". A mix with `{ label: 1, value: "a" }`, `{ label: "A" }`, `"x"`, `{ label: "", value: "b" }` and two good ones keeps the two good ones. 60 good ones keep 50. `{ x: 10.4, y: 20.6 }` gives `{ x: 10, y: 21 }`.
    - "pickRequest refuses a request without an option in words": `null`, `{}` and `[{ label: 2 }]` each give null.
    - "a point that isn't one leaves the menu at the pointer": `at` of `"x"` or `{ x: NaN, y: 1 }` gives `at: null`.
  - **`settings-copy.test.ts`:** "the microphone is named as the menu names it":
    - `microphoneName(null, devices)` is "System default";
    - `microphoneName("b", [{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }])` is "Microphone 2";
    - `microphoneName("gone", devices)` is "Microphone not connected";
    - `microphoneOptions("b", …)`'s first option is `{ label: "System default", value: "", checked: false }`, and only "b" is checked.
  - **`settings.spec.ts`:** "the microphone's Choose… lists System default first, and saves the choice".
    - Write `{ version: 1, microphoneId: "gone" }` into `settings.json` in an `AVANZEL_USER_DATA` folder, as `shortcuts.spec.ts:99–101` does.
    - Voice shows "Microphone not connected".
    - `answerMenus(app, null)`, then Choose… in the group "Microphone". Poll `shownMenus` to length 1. Its first item is `{ label: "System default", checked: false }`. Then `microphoneId` is still "gone", and the row still reads "Microphone not connected".
    - `answerMenus(app, "System default")`, then Choose… again. Poll `shownMenus` to length 1. Then `microphoneId` polls to null, and the row reads "System default".
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- popup settings-copy`. Expected: FAIL.
- [ ] **Step 3: Implement** the IPC, `popup.ts`, `pickFromSettings`, `ChooseButton`, `MicrophoneGroup` and the e2e helpers.
- [ ] **Step 4: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/settings.spec.ts e2e/shortcuts.spec.ts e2e/models.spec.ts e2e/contrast.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `mac: Settings → Voice picks the microphone from a native menu`.

### Task 5: Settings → Voice records shortcuts, offers free ones in a Notice, and shows the speech model

**Files:**
- Create: `apps/mac/src/renderer/settings/accelerator.ts`.
- Modify: `settings/panes/Voice.tsx`, adding `Voice`.
- Modify: `settings/main.tsx`.
  - The legacy `Voice`, `ShortcutField`, `toAccelerator` and `KEY_CODES` go, with the imports only they used.
  - The shell renders the new `Voice`.
- Modify: `settings/styles.css`. `.alternatives`, `.keys*`, `.bar*` and `.status-bad` go, and `.settings-meter { width: 120px; }` comes in.
- Test: create `apps/mac/test/accelerator.test.ts`, and modify `apps/mac/e2e/shortcuts.spec.ts` and `apps/mac/e2e/models.spec.ts`.

**Interfaces:**
- Consumes `PaneProps`, and `MicrophoneGroup` from Task 4.
- Produces:
```ts
// renderer/settings/accelerator.ts
/** A keydown as an Electron accelerator ("Alt+Shift+S"), its modifiers in the order Control, Alt, Shift, Command; null
    while only modifiers are down, and for a key without a modifier other than F1–F24. Keys come from `code`. */
export function toAccelerator(key: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null;
// renderer/settings/panes/Voice.tsx
/** The Voice pane: the shortcuts and their problems, MicrophoneGroup, and the speech model. */
export function Voice({ snap, onChange }: PaneProps): ReactNode;
```
- **The shortcut rows** come in `ACTION_NAMES` order. Each is `GroupRow label={name}`, whose control is `<div role="group" aria-label={name}>` holding a `Row gap={8}` of `Kbd` and `Button size="small"` ("Change" or "Type the new shortcut…").
  - **One recording at a time:** `useState<keyof Shortcuts | null>`. Change toggles it.
  - **While recording,** a capturing `keydown` listener on `window` does this:
```ts
if (event.key === "Tab") return; // the focus may leave the row, which ends the recording
event.preventDefault();
event.stopPropagation();
if (event.key === "Escape") return setRecording(null);
const accelerator = toAccelerator(event);
if (!accelerator) return; // only modifiers so far, or a key without one: keep listening
setRecording(null);
onChange(await api.setApp({ shortcuts: { ...snap.app.shortcuts, [recording]: accelerator } }));
```
  - **The recording also ends** on the window's `blur`, and when the row's group fires `onBlur` with a `relatedTarget` outside it. Leaving the pane unmounts it, which ends it too.
- **Problems** come under the Shortcuts group, as one `Notice` per key that has one, in `ACTION_NAMES` order.
  - The alternatives come best last. The best is primary only in the pane's first Notice.
  - After a "Use …", the focus moves to that row's "Change". Hold the group divs in a ref map, then call `querySelector("button")?.focus()`.
- **The pane's order:** the Shortcuts group, its problem Notices, `MicrophoneGroup`, then the Speech group and its Notice.
- **Speech:** see the copy table. Download is secondary. Its label is "Download ({MB} MB)" when `bytes > 0`, else "Download".

- [ ] **Step 1: Write the failing tests.**
  - **`accelerator.test.ts`:**
    - "a key with modifiers becomes an accelerator":
      - `KeyS` with Alt and Shift gives "Alt+Shift+S";
      - `Space` with Control and Alt gives "Control+Alt+Space";
      - `Digit5` with Command gives "Command+5";
      - `Comma` with Shift and Command gives "Shift+Command+,".
    - "F-keys need no modifier": `F5` gives "F5".
    - "nothing is saved for a key without a modifier, or for modifiers alone": `KeyA`, `AltLeft` with Alt, and `Escape` each give null.
  - **`shortcuts.spec.ts`:**
    - "Settings → Voice offers the free ones…" (`135–157`):
      - the "Use" buttons read `["Use ⌃⌥R", "Use ⌃⇧Space"]`, and the last is `data-variant="primary"`;
      - after "Use ⌃⇧Space", the earlier checks hold;
      - `settings.getByRole("group", { name: "Record a thought", exact: true })` shows "⌃⇧Space", and its "Change" is focused.
    - New: "Change records the next shortcut; Esc, leaving the row or the window, a key with no modifier, and a move to another pane keep the old one". In the group "Type a thought" (`exact`), each of these starts a recording ("Type the new shortcut…" shows) and then ends it with "Change" back and `snapshot().app.shortcuts.type` still "Alt+Shift+Space":
      1. press Escape;
      2. focus the radio "Voice";
      3. `page.evaluate(() => window.dispatchEvent(new Event("blur")))`;
      4. press "K" (still recording), then Escape;
      5. `call(app, "openSettingsFor", "open-settings:privacy")`. Wait for `getByRole("radio", { name: "Privacy", exact: true })` to have `aria-checked="true"`, then press "Control+Alt+K". `call(app, "showSettings", "voice")`, and wait for the heading "Voice".

      Last, press "Control+Alt+K" while recording. The snapshot's `type` becomes "Control+Alt+K", the group shows "⌃⌥K", and its "Change" is focused.
  - **`models.spec.ts`:**
    - `38–48` also clicks "Download (673 MB)". `modelStatus` then polls to `kind: "downloading"`.
    - `164–188`: Settings → Voice's `getByRole("alert")` contains "The speech model didn't finish downloading." and the button "Try again".
    - `190–208`: the alert contains "Avanzel can't use these voice settings." and the message; "Try again" has count 0.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- accelerator`. Expected: FAIL, because the module doesn't exist.
- [ ] **Step 3: Implement** `accelerator.ts` and the pane.
- [ ] **Step 4: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/shortcuts.spec.ts e2e/models.spec.ts e2e/settings.spec.ts e2e/setup.spec.ts e2e/contrast.spec.ts`. Expected: PASS. setup.spec.ts's Open Settings → Voice test is at `963`.
- [ ] **Step 5: Commit.** Subject: `mac: Settings → Voice records shortcuts, offers free ones in a Notice, and shows the speech model`.

### Task 6: Settings → Agents lists every agent as setup does, with its check, and names the model of the one in use

**Files:**
- Create: `apps/mac/src/renderer/settings/panes/Agents.tsx`.
- Modify: `settings/main.tsx`.
  - The legacy `Agents`, `CheckStatus`, `signInHint` and `ownLine` go.
  - `HARNESS_NAMES` and `harnessName` stay: the legacy `TaskRow` calls `harnessName` (`main.tsx:393`) until Task 8.
  - The shell renders `snap.library?.exists ? <Agents {...props} /> : <NoLibrary {...props} />`.
- Modify: `settings/styles.css`. Add `.settings-status { max-width: 240px; }` and `.settings-field { width: 200px; }`.
- Test: `apps/mac/e2e/agents.spec.ts` and `apps/mac/e2e/library.spec.ts`.

**Interfaces:**
- Consumes:
  - `PaneProps` and `NoLibrary`;
  - `harnessName` from `../../../main/jobs.ts` (Agents.tsx imports it; `main.tsx` keeps its own copy until Task 8);
  - `ownLine` from `../../setup/copy.ts`;
  - `AGENT_INSTALLS` and `window.avanzel.setup.copy(agent)` (no session is needed);
  - the bridge's `checkAgents`, `checkAgent` and `setLibrary`.
- **Two notions of the chosen agent:**
  - The *chosen* row is `lib.harness`: an agent's name, or `"auto"` for the last row.
  - The agent *in use* is `lib.harness === "auto" ? snap.selectedHarness : lib.harness`. It sets the danger tone and the model group.
- **Each agent row** is `GroupRow label={harnessName(name)} description={experimental ? "Experimental" : undefined}`. Its control is `<div role="group" aria-label={harnessName(name)}>` holding a `Row gap={8}` of:
  1. `<span className="settings-status" role="status">`, holding the status as `Text variant="footnote" as="span"`. The status keeps today's `CheckStatus` words, with `ownLine` from setup's copy. A problem (signed out, timed out, failed, or not installed) is `tone="danger"` for the agent in use and `"secondary"` for the others; anything else is `"secondary"`.
  2. "Best results" (`Text variant="caption" tone="accent"`), for Claude Code.
  3. For the agent `lib.harness` names, `Icon name="check" label="Chosen"`, installed or not. For another installed agent, `Button size="small"` "Use {name}", which calls `setLibrary({ harness: name })`.
  4. For an installed agent, "Check" or "Check again", with today's `checked`-set logic. It is `busy` while checking, which keeps the focus.
  5. For one that isn't installed, and is in `AGENT_INSTALLS`, "Copy install command", then "Copied" for 2 s.
- **The last row,** in the same choice-list pattern:
  - label "Choose automatically", description "Avanzel uses the best agent installed: Claude Code first.";
  - its control is a group of the same name, holding the check icon "Chosen" while `lib.harness === "auto"`, else `Button size="small"` "Use automatic", which calls `setLibrary({ harness: "auto" })`.
- **The free checks** run on mount: `api.checkAgents().then(onChange)`.
- **The model group** shows only while there is an agent in use.
  - It is keyed by that agent, so its draft starts again when the agent changes.
  - It saves `setLibrary({ models })`, with empty values dropped.
  - It saves on Return (`onEnter`) and when the focus leaves the field. Put `onBlur` on its `.settings-field` box, because `TextField` takes no `onBlur`.

- [ ] **Step 1: Write the failing tests** in `agents.spec.ts`.
  - The failure's text at `72–73` becomes "The model is not supported with this account." (setup's `ownLine`).
  - New: "Use Codex makes Codex the agent that files, Use automatic hands the choice back, and the agent in use names its model".
    - The group "fake" (`exact`) shows the img "Chosen".
    - Fill the textbox "fake model" with "small" and press Return. `loadSettings(library).models` polls to `{ fake: "small" }`.
    - "Use Codex" in the group "Codex" makes `loadSettings(library).harness` poll to "codex".
    - The group "Codex" then shows "Chosen", the group "fake" shows "Use fake", and the heading "Codex" (`exact`) shows.
    - "Use automatic" in the group "Choose automatically" (`exact`) makes the harness poll to "auto". That group then shows "Chosen", and the heading "Claude Code" (`exact`) shows, since Automatic picks Claude Code's stand-in.
  - New: "with no agent installed, every row says so, and Claude Code and Codex offer their install commands" (Review Focus 4).
    - Save `{ harness: "claude", harnesses: {} }` into a `makeLibrary()`.
    - Launch with `AVANZEL_EXACT_PATH: "1"` and `PATH: \`${emptyBin}:/usr/bin:/bin:/usr/sbin:/sbin\``.
    - Each of the five agent groups' status reads "Not installed". Claude Code's has `data-tone="danger"` and Codex's `"secondary"`.
    - The group "Claude Code" shows "Chosen".
    - In each of the five agent groups, `getByRole("button", { name: /^(Use|Check)/ })` has count 0.
    - "Copy install command" has count 2.
    - Claude Code's copy button makes "Copied" show, and `copiedForTests()` equal `["curl -fsSL https://claude.ai/install.sh | bash"]`.
  - In `library.spec.ts`, "Settings without a library offers setup…" gains a line: the radio "Agents" shows "Avanzel has no library open." too.
- [ ] **Step 2: Run them.** Expected: FAIL. The legacy pane has no "Use", and its failure's text has no full stop.
- [ ] **Step 3: Implement** the pane.
- [ ] **Step 4: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/agents.spec.ts e2e/library.spec.ts e2e/settings.spec.ts e2e/contrast.spec.ts`. Expected: PASS. The other agents.spec tests keep their selectors: each row's control group and its status region.
- [ ] **Step 5: Commit.** Subject: `mac: Settings → Agents lists every agent as setup does, with its check, and names the model of the one in use`.

### Task 7: Shadow tasks are called scheduled reviews wherever a person reads them

**Files:**
- Modify: `apps/mac/src/main/menu-model.ts:99`.
- Modify: `apps/mac/src/main/controller.ts`: `1978`, `2044`, and the comment at `495`, which says "Settings → Reviews".
- Modify: `packages/engine/templates/AGENTS.md:21` and `README.md:47-51` and `:107`.
- Test: `apps/mac/test/menu-model.test.ts:42-44` and `:59`, and `apps/mac/e2e/library.spec.ts`.

**Interfaces:**
- **The copy** is in the table's "Menu", "Controller" and "`AGENTS.md` template, README" rows.
- **The template line** becomes ``| `tasks/` | Scheduled reviews: schedules and standing instructions for runs Avanzel starts on its own | read |``.
- **The README:**
  - the evening review becomes "(a scheduled review, 21:00 by default)";
  - "Scheduled reviews are Markdown files in `tasks/`; edit their times, agents and instructions in Settings → Reviews";
  - line 107 says "any default scheduled review it lacks".

- [ ] **Step 1: Write the failing tests.**
  - **`menu-model.test.ts`:** the header is "Scheduled reviews" (`44` and `59`), and the test's name says so (`42`).
  - **`library.spec.ts`:** new, "a custom review is skipped, and its notification says so plainly".
    - Write `tasks/standup.md` holding `---\nname: Standup\nschedule: daily 09:00\nkind: custom\n---\nAsk about the day.\n`.
    - Call `runTask("standup")` and `idleForTests`.
    - `notificationsForTests()` contains `{ title: "Standup", body: "Avanzel doesn't run custom reviews yet, so this one was skipped." }`.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- menu-model`. Expected: FAIL.
- [ ] **Step 3: Rename** in `menu-model.ts`, `controller.ts`, the template and the README. Afterwards, `grep -rni "shadow task" README.md packages/engine/templates apps/mac/src/renderer apps/mac/src/main/menu-model.ts` prints nothing.
- [ ] **Step 4: Run the checks.**
  - Run `npm test -w @avanzel/mac`, `npm test -w @avanzel/engine`, typecheck and design:check.
  - From `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/library.spec.ts`.
  - Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `mac: shadow tasks are called scheduled reviews wherever a person reads them`.

### Task 8: Settings → Reviews edits each scheduled review in place

**Files:**
- Create: `apps/mac/src/renderer/settings/panes/Reviews.tsx`.
- Modify:
  - `settings/copy.ts`: the review helpers;
  - `settings/main.tsx`: the legacy `Tasks`, `TaskRow`, `Toggle`, `WEEKDAYS`, `DAY_NAMES`, `HARNESS_NAMES` and `harnessName` go, and the shell renders `snap.library?.exists ? <Reviews {...props} /> : <NoLibrary {...props} />`;
  - `settings/styles.css`: `.task-editor*`, `.actions` and `.sw*` go, and `.settings-time { width: 72px; }` and `.settings-editor` (padding `var(--av-space-10) var(--av-space-12)`) come in.
- Test: `settings-copy.test.ts` and `apps/mac/e2e/library.spec.ts`.

**Interfaces:**
- Consumes `PaneProps`, `NoLibrary`, `ChooseButton`, `answerMenus` and `shownMenus`, and `harnessName` from `../../../main/jobs.ts`.
- Produces (`renderer/settings/copy.ts`):
```ts
export const DAYS: readonly { value: string; label: string }[]; // sun "Sunday" … sat "Saturday"
export function scheduleParts(schedule: string): { every: "daily" | "weekly"; day: string; time: string }; // "daily 21:00": day "sun"
export function scheduleText(every: "daily" | "weekly", day: string, time: string): string; // "daily 07:30", "weekly mon 07:30"
export function whenLine(schedule: string): string; // "Every day at 21:00", "Sundays at 18:00"; anything else as given
/** "Running now…", "Not run yet.", or "Last run today at 21:00." / "yesterday at …" / "on Sunday at …" for a run in the
    last 6 days / "on 2 Oct at …" before that. Formatted by hand, never with toLocale*, so tests don't depend on locale. */
export function lastRunLine(task: Pick<TaskInfo, "running" | "lastRun">, now: Date): string;
/** HH:MM with an hour under 24 and minutes under 60, as parseSchedule takes it, zero-padded ("7:30" → "07:30"); else null. */
export function validTime(text: string): string | null;
export function kindLine(kind: string): string;
/** An IPC rejection's message without Electron's "Error invoking remote method '…': " and the error's class name. */
export function remoteMessage(error: unknown): string;
```
- **Each review** is a `<div role="group" aria-label={task.name}>` around a `Group label={task.name}`. The evening review's Group gets the note from the copy table. Its children, in order:
  1. `Switch label="On" description={kindLine(task.kind)}`. It saves `saveTask` with `enabled` flipped and the other fields as stored.
  2. `GroupRow label={whenLine(task.schedule)} description={lastRunLine(task, new Date())}`, holding "Run now" (`busy={task.running}`), which calls `runTask(id)`, and "Edit" or "Close".
  3. While editing, these rows: "Repeats", with the `Segmented`; "Day" (weekly only), with the day and a `ChooseButton label="Day"` over `DAYS`; "Time", with `TextField`; "Agent", with "The library's agent" or `harnessName(agent)`, and a `ChooseButton label="Agent"` over "The library's agent" (value `"auto"`) and each available harness.
  4. Then `.settings-editor` boxes: one holding `TextArea label="Instructions" rows={5}`, and one holding `<Actions><Button variant="primary">Save</Button></Actions>`.
- **One editor open at a time,** held as the pane's `editing` id. Close discards the draft.
- **Save** works through `validTime` and `scheduleText`.
  - A time that isn't one sets the Time row's description, and nothing is saved.
  - A save that throws shows the error `Notice` with `remoteMessage`.
  - Otherwise `onChange`, and the editor closes.
- **The pane** opens with the intro footnote, then the reviews, then "Files that can't be used" when `taskProblems` has any.

- [ ] **Step 1: Write the failing tests.**
  - **`settings-copy.test.ts`,** with `now = new Date(2026, 9, 23, 12, 0)`, a Friday:
    - `whenLine("daily 21:00")` is "Every day at 21:00", and `whenLine("weekly sun 18:00")` is "Sundays at 18:00".
    - `lastRunLine` gives:
      - "Running now…" when running;
      - "Not run yet." without a run;
      - for `new Date(2026, 9, 23, 9, 5).toISOString()`, "Last run today at 09:05.";
      - for `new Date(2026, 9, 22, 21, 0)`, "Last run yesterday at 21:00.";
      - for `new Date(2026, 9, 18, 18, 0)`, "Last run on Sunday at 18:00.";
      - for `new Date(2026, 9, 2, 18, 0)`, "Last run on 2 Oct at 18:00.".
    - `validTime` turns " 7:30 " into "07:30" and keeps "21:00". It gives null for "24:00", "21:60", "9", "9:5" and "".
    - `scheduleText(…scheduleParts("weekly sun 18:00"))` round-trips.
    - `kindLine` gives each of the three kinds its line.
    - `remoteMessage(new Error("Error invoking remote method 'settings:save-task': AvanzelError: No scheduled review called x."))` is "No scheduled review called x.".
  - **`library.spec.ts`:**
    - "a malformed task file…" (`8`) is renamed: "a review file that can't be used is listed with why, and the evening review still runs" (Review Focus 5). Its checks:
      - the heading "Files that can't be used";
      - "tasks/broken.md";
      - `/Unknown schedule "sometimes"/`;
      - the group "Evening review" (`exact`);
      - then the run, as now.
    - New: "a scheduled review's switch, schedule, agent and instructions are edited in Settings and saved to its file". In the group "Weekly review":
      1. "Sundays at 18:00" and "Not run yet." show.
      2. The switch "On" makes `read(library, "tasks/weekly-review.md")` poll to contain "enabled: false".
      3. Edit. Time "25:00", then Save: "Use a time like 21:00." shows, and the file still has "schedule: weekly sun 18:00".
      4. `answerMenus(app, "Monday")`, then Day's Choose…. Poll `shownMenus` to length 1. Its menu is the seven days, with Sunday checked.
      5. Time "7:30". `answerMenus(app, "Codex")`, then Agent's Choose…. Poll `shownMenus` to length 1.
      6. Instructions "Look for stale goals.", then Save.
      7. The file has "schedule: weekly mon 07:30", "agent: codex" and "Look for stale goals.". The row reads "Mondays at 07:30", and the editor is closed.
    - New: "Run now runs a review at once, and the review says when it last ran". After Run now in the group "Weekly review", call `idleForTests`. The group then shows `/^Last run today at \d\d:\d\d\.$/`.
    - "Settings without a library offers setup…" gains a line: the radio "Reviews" shows "Avanzel has no library open." too.
- [ ] **Step 2: Run them.** `npm test -w @avanzel/mac -- settings-copy`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the pane.
- [ ] **Step 4: Run the checks.**
  - Run `npm test -w @avanzel/mac`, typecheck and design:check.
  - From `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/library.spec.ts e2e/settings.spec.ts e2e/app.spec.ts e2e/contrast.spec.ts`.
  - Expected: PASS. app.spec.ts holds the evening review's tests.
- [ ] **Step 5: Commit.** Subject: `mac: Settings → Reviews edits each scheduled review in place`.

### Task 9: Settings → Privacy says what each permission is for, and Settings stands on @avanzel/ui alone

**Files:**
- Create: `apps/mac/src/renderer/settings/panes/Privacy.tsx`.
- Modify: `settings/main.tsx`.
  - The legacy `Privacy` goes, with every legacy helper left: the local `Group`, `ReactNode` and `Ref` uses, and the unused imports.
  - `import "@avanzel/ui/base.css"` comes first, and `../common/mac.css` goes.
- Modify: `settings/styles.css`. Only layout rules remain: `#root`, `.settings`, `.settings-drag`, `.settings-toolbar`, `.settings-pane`, `.settings-shelves`, `.settings-words`, `.settings-status`, `.settings-meter`, `.settings-field`, `.settings-time` and `.settings-editor`.
- Test: `apps/mac/e2e/permissions.spec.ts`.

**Interfaces:**
- Consumes `PaneProps`, and the bridge's `requestPermission` and `openPrivacy`.
- **Each row's control** is a `<div role="group" aria-label={row}>`:
  - granted: `Text variant="footnote" tone="ok"` "Allowed";
  - the microphone while `not-determined`: "Allow…", which sets `onChange(await api.requestPermission("microphone"))`;
  - otherwise: "Open System Settings", which calls `api.openPrivacy(kind)`.

  Screen recording never offers "Allow…": Electron can't tell its "never asked" from "denied".
- **"What leaves this Mac"** is a `.settings-words` box, padded `var(--av-space-10) var(--av-space-12)`, holding `Text variant="callout"`.

- [ ] **Step 1: Write the failing tests** in `permissions.spec.ts`.
  - "Settings → Privacy says what each permission is for, and Open System Settings goes where it's allowed".
    - Launch with `AVANZEL_FAKE_PERMISSIONS: "screen:denied"`.
    - The group "Microphone" shows "Allowed".
    - In the group "Screen recording", "Open System Settings" makes `openedForTests()` poll to `["System Settings → Screen Recording"]`.
    - "Your voice never leaves this Mac." (`exact: false`) shows.
  - "Allow… asks macOS for the microphone once, and the row then says Allowed". Launch with `AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined"` and `AVANZEL_FAKE_MIC_ANSWER: "granted"`. "Allow…" turns the group "Microphone" to "Allowed".
- [ ] **Step 2: Run them.** Expected: FAIL. The legacy rows have no groups, and their label is "Screen Recording".
- [ ] **Step 3: Implement** the pane and the switch to `base.css`. `grep -rn "common/mac.css" apps/mac/src` then prints nothing: Ask and Quick left it in Tasks 1 and 2.
- [ ] **Step 4: Run the checks.** Run the unit tests, typecheck and design:check. Then, from `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/permissions.spec.ts e2e/settings.spec.ts e2e/agents.spec.ts e2e/library.spec.ts e2e/shortcuts.spec.ts e2e/models.spec.ts e2e/contrast.spec.ts`. Expected: PASS. Every pane now stands on base.css.
- [ ] **Step 5: Commit.** Subject: `mac: Settings → Privacy says what each permission is for, and Settings stands on @avanzel/ui alone`.

### Task 10: mac.css goes, and the design checks' baseline holds only the capsule

**Files:**
- Delete: `apps/mac/src/renderer/common/mac.css`.
- Modify: `packages/ui/checks/baseline.json`, only through `npm run design:check -- --update-baseline`.
- Modify: `apps/mac/e2e/contrast.spec.ts`: `ON_FILL` and its comment (`30–33`).

- [ ] **Step 1: Check that nothing imports `mac.css`.** `grep -rn "mac.css" apps/mac/src apps/mac/scripts` prints nothing. Then run `git rm apps/mac/src/renderer/common/mac.css`.
- [ ] **Step 2: Lower the baseline.** From the worktree root, run `npm run design:check -- --update-baseline`. Expected:
  - it prints "Baseline lowered: 9 → 2 legacy files";
  - `Object.keys` of the file is then exactly `["apps/mac/src/renderer/capsule/main.tsx", "apps/mac/src/renderer/capsule/styles.css"]`;
  - the capsule's counts are unchanged.
- [ ] **Step 3: Trim the contrast test.** `ON_FILL` can't go yet: the capsule's legacy "File", "Open" and "OK" buttons, and its "!" badge, are white on the capsule's own `--accent` and `--danger`, at 3.4–3.7:1. Only 1c's rebuild ends them.
  - So `ON_FILL` becomes `".btn.primary, .warn"`.
  - Its comment, the only place that mentions the sidebar, becomes: "The capsule's legacy primary buttons and error badge (1c rebuilds them): white on its --accent or --danger, at 3.4–3.7:1, held to 3:1 while on exactly that fill."
  - `sidebar` (Task 3) and `windowColour` (Task 2) are gone already.
- [ ] **Step 4: Run the checks.**
  - Run `npm run design:check` and `npm test -w @avanzel/ui`, which runs the rules, tokens, catalog and guard tests.
  - Run `npm test -w @avanzel/mac` and `npm run typecheck`.
  - From `apps/mac`, run `npm run build && env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/contrast.spec.ts`.
  - Expected: PASS.
- [ ] **Step 5: Commit.** Subject: `mac: mac.css goes, and the design checks' baseline holds only the capsule`.

### Task 11: The whole branch, checked

- [ ] **Step 1: Run every check.**
  - From the worktree root: `npm test`, `npm run typecheck`, `npm run design:check` and `npm run ui:e2e`.
  - From `apps/mac`: `env -u ELECTRON_RUN_AS_NODE npm run e2e`.
  - Expected: all pass, apart from the known flakes. The gallery's screenshots are unchanged, since `packages/ui/src` wasn't touched.
- [ ] **Step 2: Run the `design-reviewer` agent** on `apps/mac/src/renderer/ask/**`, `apps/mac/src/renderer/quick/**` and `apps/mac/src/renderer/settings/**`. Fix what it reports against DESIGN.md. A finding that needs a new component is an owner item, not a fix.
- [ ] **Step 3: Look at the windows.** Screenshot Settings' five panes, Quick, and Ask answered, in light and dark, with the e2e `snap` shots or a run of `settings.spec.ts`. Compare them with the mockup's shots in `/tmp/avz-ds/settings-mockup/shots/`. Note any difference that isn't one of the departures listed under the copy table.
- [ ] **Step 4: Commit the fixes** from Steps 1–3, if there are any, as one commit with a subject in the Process form.
- [ ] **Step 5: Report:**
  - the stand-ins and the owner's choices (owner items 1–9);
  - the baseline's result, from Task 10;
  - that no test opens a real native menu: the owner should pick a microphone and a review's day once, and dismiss one menu with Esc;
  - that no gallery section changed;
  - the e2e totals;
  - the line counts of `settings/main.tsx` and each pane.
