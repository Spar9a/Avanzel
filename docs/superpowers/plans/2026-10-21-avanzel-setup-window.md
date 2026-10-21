# Avanzel first run, Phase 1a: the setup window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac with no library opens a setup window instead of Settings. In it Zel says hello, finds the library's place and the agents, hears the shortcut, takes the first thought (spoken or typed), files it while the person watches, answers a question about it, and ends in the menu bar. The person never visits Settings.

**Architecture:** While the window is open, the controller keeps a setup session. It holds the step on screen, the press test, the first thought, its filing and the question. The controller broadcasts one `SetupSnapshot` on `setup:changed`, the way Settings gets its own. The renderer (`apps/mac/src/renderer/setup/`) keeps only the step it shows, and arranges `@avanzel/ui` components. Pure decisions live where unit tests reach them: the best agent, mic checks, suggestions and the place of the bubble in `apps/mac/src/main/setup-model.ts`, and copy in `apps/mac/src/renderer/setup/copy.ts`. The first thought uses the real capsule for recording and the real filing queue. Its filing reports to the setup window instead of the capsule.

**Tech Stack:** TypeScript (ESM, `.ts` import suffixes), Node ≥ 22, Electron 44.9 with React 19 renderers bundled by esbuild (`apps/mac/scripts/build.mjs` builds every `src/renderer/<page>/main.tsx`), `@avanzel/ui`, Vitest, Playwright for Electron.

**Spec:** §5 (the first run: goal, the six steps, why, measures) of `reports/Avanzel UX and first-run design.md`. Also used: §4 (Zel, colour, type, motion), §6.1–6.5, §7 (error copy), §10 (accessibility and calm) and §11 (Phase 1, "A setup window"). The file is untracked and lives only in the main checkout: `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md`. The prototype `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX prototypes/first-run.html` shows layout and feel only; it predates the design system, so don't copy its code. The UI contract is `packages/ui/DESIGN.md`. Phase 0's plan, `docs/superpowers/plans/2026-10-21-avanzel-first-run-phase-0.md`, built the downloads, checks and shortcut rescue this plan uses.

## Global Constraints

### Scope

- **In:** the six steps of §5.2 in one window, which opens instead of Settings when there is no library; the microphone's purpose string; local counts for §5.4.
- **Out**, for later sub-plans, each said in the step it touches. The `Filing` step is built so that 1b can add its list.
  - The live list of the agent's file changes and the `PreToolUse` guard hook (Phase 1b). Step 4 shows the real filing with elapsed time, Cancel, the receipt and the FILED stamp. Its running state is one `Stack` under the working line, where 1b adds a row per action.
  - Live words while talking (Phase 3). The card fills after transcription.
  - Sounds (Phase 1d): no "Play sounds" switch, no Preview.
  - Desk Zel: no "Keep Zel on my desktop" switch.
  - Recording now and transcribing once the models land. While the models are still downloading, step 3 offers "Type it instead" and waits, and no copy promises to keep a recording.
  - The "Meet Avanzel" page, and "Watch a sample filing" (so with no agent, setup can't finish yet).
  - Reporting the §5.4 measures anywhere. That needs opt-in consent, and no destination exists, so this plan only keeps them on the Mac.
  - The menu bar's Zel face, the capsule's new states and the §7 copy outside setup (other Phase 1 items).

### The UI rules (from DESIGN.md)

- **Windows arrange, `@avanzel/ui` paints.** New windows (`setup/`, `up-here/`) use components imported from `"@avanzel/ui"` and nothing deeper, plus `"@avanzel/ui/base.css"` once.
  - Window CSS may only arrange.
  - No raw `<button>`, `<input>`, `<kbd>`, `<svg>`, `<a>` or headings.
  - No `style`, and no `className` on components.
  - These files are new, so design-check holds them to every rule; they aren't on the baseline.
- **No new components, variants, tokens or gallery screenshots in `packages/ui`.** Those need the owner's approval. Where nothing fits, compose the stand-in this plan names, and leave the real component to the owner's list at the end of this section.
- **Zel speaks in the first person** only in `apps/mac/src/renderer/setup/**` (design-check's `VOICE_FILES`) and inside `Bubble`, `PermissionPrimer` and `Text variant="voice"`. The `up-here` window puts its "I" inside `Bubble`.
- **Type roles:**
  - each step's heading: `Text variant="heading"` (an `h2`);
  - Zel's sentences: `Text variant="callout"`;
  - Zel's short reactions ("Heard you…", "Your first idea has a home."): `Text variant="voice"`;
  - small print: `Text variant="footnote" tone="secondary"`;
  - commands: `Text variant="code"`;
  - the shortcut inside a sentence: `<Kbd>`.
- **Zel** looks at the work, never at the person (each mood's default `look`), appears only in Avanzel's own windows, and never covers the person's words.
- **One primary button per moment** (DESIGN.md). While a `Notice` with actions shows, its actions hold the primary (its last action, as the table marks it), and the footer's or standalone button beside it is secondary: Found's "Looks good" or "Use this folder", Think's "Type it instead" and Filing's "Continue".
- **One orchestrated moment per surface:** Zel waking and stamping HELLO (step 1), the keycaps pressing themselves (step 3: §5.2 asks for it; once each time the step is entered), the FILED stamp (step 4), and the flight into the menu bar (the ending). Under Reduce Motion (`matchMedia("(prefers-reduced-motion: reduce)")` in a renderer, `systemPreferences.getAnimationSettings().prefersReducedMotion` in main), each shows its final frame at once.

### Behaviour every task keeps

- **Agent checks never cost quota without the person (Phase 0's rule).** Automatic checks only read a sign-in (`claude auth status`, `codex login status`). An agent without a sign-in command, or with one that couldn't be read, is asked its one short question only when the person picks it or presses Check again. Never read or keep anything from `claude auth status` but `loggedIn`.
- **Before a library exists, checks run in a scratch folder** (`mkdtemp` in the system temp folder), and the agents are the built-in ones (`harnesses(defaultSettings())`).
- **No e2e test downloads a real model or runs a real agent.**
  - `launch()` points `AVANZEL_MODELS_URL` at a dead port and puts stand-ins for `claude` and `codex` first on PATH.
  - Setup tests launch with `firstRun()` (Task 1): a new `HOME` with `XDG_CONFIG_HOME` inside it, an empty Hugging Face cache, and `AVANZEL_EXACT_PATH=1` with PATH set to the stand-ins plus `/usr/bin:/bin:/usr/sbin:/sbin`, so no agent of this Mac's own is ever found.
- **No e2e test touches this Mac's login items, clipboard, Terminal or System Settings.** With `AVANZEL_TEST=1`, `app.setLoginItemSettings`, `clipboard.writeText` and opening Terminal are skipped; the last two are recorded for the tests instead (Tasks 4 and 10).
- **Home is `homedir()` from `node:os`, never `app.getPath("home")`.** The tests give the app a temporary `HOME`, and only `homedir()` follows it (checked on Electron 44.9).
- **New test hooks** (read only with `AVANZEL_TEST=1`, like the other `AVANZEL_FAKE_*`):
  - `AVANZEL_EXACT_PATH=1`: keep PATH as given.
  - `AVANZEL_PRESS_WAIT_MS`: the press test's wait. `firstRun()` sets 60000, so no test sees the nudge unless it asks for it.
  - `AVANZEL_FAKE_MIC_ANSWER=granted|denied`: what the system's microphone prompt answers.
  - `AVANZEL_FAKE_TRAY_BOUNDS=x,y,width,height`: the menu bar icon's bounds, which `MenuBar.bounds()` returns instead of the real ones, so the flight and the bubble don't depend on this Mac's own menu bar (Tasks 12 and 13).
- **The capsule still records.** Setup's first spoken thought goes through `toggleDictate`, the real capsule and the real queue. Only once the words exist does the capsule hide and the setup window take over.
- A setup filing runs like any other: queue order, `withRun`, Edit-free. When the window is closed, it reports by notification, as a filing whose card isn't showing does today.

### Copy

Sentence case, verbs on buttons, no "!", the one-character "…", units as "6 s" and "412 of 673 MB", and they/them. MB figures are `Math.round(bytes / 1e6)`. In the table:
- `<⌥Space>` is a `Kbd` holding `prettyAccelerator` of the current Record a thought shortcut; in a string prop (a Notice title), it is that text.
- `` `claude` `` is a `Text variant="code"`.
- `{…}` is a value.

| Where | Text |
|---|---|
| Window titles | setup window "Set up Avanzel"; bubble window "Avanzel" |
| Footer (every step) | missing (bytes > 0): "Speech model, {673} MB. Downloads when you continue." |
| | downloading: "Getting my ears ready", a `Progress` labelled "Downloading the speech model", and "{412} of {673} MB" (when the size is known) |
| | download failed: "The speech model didn't finish downloading." with `Button size="small"` "Try the download again" (not "Try again": Notices use that, and no screen has two buttons of one name); ready: nothing |
| | buttons: "Back" (quiet; on Found and Think only), then the step's primary |
| Hello | heading "Hi, I'm Zel."; callout "Talk to me anytime with <⌥Space>. I write each thought on a card and file it in a library of plain notes on your Mac." |
| | card: label "Thought", meta "{Wednesday 21 October}", placeholder "Nothing here yet.", stamp `hello` dated "{21 Oct 2026}" |
| | primary "Set me up" (`size="large"`) |
| Found | heading "Here's what I found." |
| | group "Your library": a row labelled "{~/Avanzel}", with "Change…" |
| | the row's description: missing or empty "A new library: Markdown files with git history."; has files "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them."; a library "This folder is already an Avanzel library." |
| | group "Who should do the filing?", note "Checking Claude Code or Codex reads their sign-in. Other agents are asked one short question when you pick them." |
| | each row: the agent's label, a status description, Claude Code's caption "Best results", and an `Icon name="check" label="Chosen"` or `Button size="small"` "Use {Codex}" |
| | statuses: "Installed", "Checking…", "Signed in", "Replied in {1.6} s", "Not signed in", "Didn't reply within 15 s.", a failure's `ownLine(detail)` or "Didn't reply." |
| | footnote, when Claude Code or OpenCode is chosen: "Your agent works only inside the library folder: no shell, no web." |
| | primary "Looks good", or "Use this folder" when the folder has files or is a library; secondary while a Notice with actions shows |
| Found, problems | library: error `Notice` "I couldn't make the library at {~/Avanzel}." body "{error message}", action "Change…" |
| | chosen agent signed out: error `Notice` "{Claude Code} isn't signed in on this Mac." body "Run `claude` once in Terminal and sign in, then check again." (Codex: "Run `codex login` in Terminal, then check again."; others: "Sign in to {name} in Terminal, then check again."), actions "Open Terminal", "Check again" (primary) |
| | timed out: "{name} didn't reply within 15 s." body "It may be busy. Check again, or use another agent." action "Check again"; failed: "{name} didn't work." body "{ownLine(detail)}" action "Check again" |
| | no agent: info `Notice` "Avanzel needs an AI agent to do the filing." body "Claude Code works best. Install one in Terminal, and I'll notice when it's ready." |
| | under it, for "Claude Code" `curl -fsSL https://claude.ai/install.sh \| bash` and for "Codex" `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`, each with `Button size="small"` "Copy", then "Copied" for 2 s |
| Think | heading "What's on your mind this week?"; callout "Press <⌥Space>, ramble for half a minute, then press it again. I'll sort it out." |
| | footnote "If you're stuck, try a goal, someone you work with, or an idea you keep coming back to." |
| | the stage shows a `Kbd size="key"` per cap; the card has label "Thought" and placeholder "Your words will appear here." |
| | after a press: footnote "{⌥Space} is free on this Mac, so it works in every app. Esc cancels." |
| | listening: callout "I'm listening. Press <⌥Space> again when you're done."; transcribing: a small `Spinner` and "Turning your voice into text on this Mac…" |
| | taken: error `Notice` "{⌥Space} is used by another app, probably {Alfred}." (no holder: "{⌥Space} is used by another app.") body "Pick another shortcut." actions "Use {⌃⌥R}", "Use {⌃⇧Space}" (best last, primary) |
| | taken, none free: body "Pick another one in Settings → Voice." action "Open Settings" |
| | no press within the wait: info `Notice` "Did {⌥Space} do nothing?" body "Another app may be using it, probably {Alfred}. Try another shortcut." (no holder: "Another app may be using it. Try another shortcut.") with the same actions |
| | no press, none free: body "Another app may be using it. Pick another one in Settings → Voice." action "Open Settings" |
| | ears not here: missing or downloading "My ears are still arriving. Type it instead, or talk to me once they land."; download failed "The speech model didn't finish downloading, so I can't hear you yet. Type it instead, or try the download again." |
| | "Type it instead": secondary, and primary while the ears aren't here and no Notice with actions shows; while the microphone is denied it is the denied Notice's action, not a second button |
| | typing: `TextArea` "Your thought", placeholder "What's on your mind?", actions "Cancel" (quiet), "File it" (primary) |
| | microphone: `PermissionPrimer kind="microphone"` (its fixed words) |
| | denied: error `Notice` "Avanzel can't hear you yet." body "Allow it in System Settings, under Microphone." actions "Type it instead", "Open System Settings" (primary) |
| | a mic check: voice "Heard you. Want to try a real thought?" actions "File it anyway", "Try again" (primary) |
| | a recording problem: error `Notice` "{message}" body "{detail}" action "Try again" |
| Filing | heading "Watch me file it."; footnote "{Claude Code} is working: {6} s of about 15", or "{Claude Code} is working: {22} s" from 15 s on; waiting "Waiting for another Avanzel run to finish…"; button "Cancel" |
| | cancelled: heading "Cancelled." body "Your words are back in the inbox, untouched, and nothing else changed." (partial: "Your words are back in the inbox, untouched. {Claude Code}'s partial edits are kept as their own commit in the library's history."), action "File it again" |
| | signed out: error `Notice` "{Claude Code} isn't signed in on this Mac." body "Run `claude` once in Terminal and sign in, then try again. Your words are safe in the inbox." (Codex: "Run `codex login` in Terminal, then try again. …"; others: "Sign in to {name} in Terminal, then try again. …"), actions "Open Terminal", "Try again" (primary) |
| | other failure: error `Notice` "{Claude Code} couldn't file it." body "{ownLine(line)} Your words are safe in the inbox." action "Try again" (primary); a capture gone from the inbox has the line "The note isn't in the inbox any more." |
| | filed: heading "All filed. {Claude Code} took {12} s."; voice "Your first idea has a home." (only with pages) |
| | footnote `pagesLine`: "{1} new page, all plain Markdown in {~/Avanzel}.", "{3} new pages and {1} updated, …", "{1} updated page, …", "{2} updated pages, …"; none: "{Claude Code} noted it in the log." |
| | footnotes: others "{1} more page in other folders." / "{2} more pages in other folders."; `restored` "Your exact words are kept."; with a commit "Press ⌘Z or Undo to put everything back." |
| | buttons "Undo", and "Open in Obsidian" (the library is an Obsidian vault) or "Open the page"; footer primary "Continue" |
| | undone: heading "Undone." body "Everything is back as it was, and your words are in the inbox." action "File it again"; refused: error `Notice` "This one can't be undone automatically." body "The library's history keeps both versions." |
| Ask | heading "Ask me about it."; callout "I answer from your library only, and show you the pages I used." |
| | the suggestion as a secondary button; `TextField` "Ask your library", placeholder "Ask your library…"; the card has label "Question" |
| | asking: "Looking through your library: {4} s"; waiting: "Waiting for the filing in progress to finish…" |
| | answered: the question as `Text variant="headline"`, the answer as `Text` paragraphs, footnote "Pages I used:"; failed: error `Notice` "{Claude Code} couldn't answer." body "{ownLine(line)}" |
| | footer "Skip" (quiet) until there is an answer, then "Continue" (primary) |
| Suggestions | a person page first: "What am I doing with {Mark}?"; otherwise the first page: "What did I say about {title}?" |
| Done | heading "You're all set."; callout "Press <⌥Space> anywhere to talk to me. I'll wait in the menu bar." |
| | `Switch` "Open Avanzel when I log in" |
| | `Switch` "Review my inbox every day at {21:00}" (weekly: "Review my inbox every {Sunday} at {18:00}"), description "Files anything still in the inbox and writes a short summary." |
| | primary "Start using Avanzel" |
| Bubble | `Bubble` title "I'm up here." body "Press <⌥Space> anywhere, say what's on your mind, and press it again." actions "Not now" (quiet), "Try it now" (primary) |

Where this copy departs from the spec, and why:
- "{agent} took 12 s" is DESIGN.md's unit form.
- The evening switch doesn't promise a letter (that is Phase 2): today's review files the inbox and writes a summary.
- "Your agent works only inside…" is shown only where the harness makes it true (`harness.ts`: Claude Code's file tools, OpenCode's `opencode.json`).
- The ears line doesn't promise to keep a recording.

### Process

- Electron e2e runs with `ELECTRON_RUN_AS_NODE` unset. From `apps/mac`: `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx playwright test e2e/<spec>.ts`.
- No new npm dependencies.
- **Commits:** one per task, with subject `area: a sentence saying what now happens` (areas: `mac`, `engine`). The body is wrapped near 78 columns, with bullets saying what changed and why, and no trailers.
- **Each task's gate:**
  - `npm test -w @avanzel/mac`;
  - `npm test -w @avanzel/engine` when the engine changed;
  - `npm run typecheck`;
  - `npm run design:check`;
  - the e2e specs the task names.

### Owner items: components that can't be composed, and the stand-ins built instead

1. **A choice list** (radio rows, each with a status line) for "Who should do the filing?". Stand-in: `Group` of `GroupRow`s, a "Use {agent}" button per row, and a check icon on the chosen one.
2. **A source chip** (shelf colour, glyph, shelf name and page title, clickable) for Ask. Stand-in: `ShelfTag` beside a `Button variant="link"` with the page title.
3. **A badge** for "Best results". Stand-in: `Text variant="caption" tone="accent"`.
4. **The filing show's drawer**: mini-cards flying into tabs, Zel hopping onto the card and the card dropping away. Also Zel waking and huffing on its stamp. Stand-in: a row of six `ShelfTag variant="tab"` with counts, the `Card`'s animated FILED stamp, and Zel's moods. The flight and narration belong with Phase 1b.

---

## Review Focus

1. **The setup window closed part-way**, with the red button, during the filing or after the library exists. The filing still finishes and says so in a notification. ⌥Space then works as it does everywhere, and the next launch, which has a library, doesn't open setup. Pinned by Task 6's test "closing setup during the filing still files the thought and says so".
2. **The shortcut, Quick or Ask used before there is a library.** Setup comes forward, and the capsule shows no card. Pinned by Task 1's test "with no library, the shortcut, Quick and Ask bring setup forward and the capsule stays hidden".
3. **The speech model download failing while setup runs.** `launch()`'s dead port makes this every test's default. The footer says so with Try the download again, and step 3 says the ears aren't here and makes typing the main action. Nothing waits on the download. Pinned by Task 2's "a failed download says so in the footer, with Try the download again" and Task 7's "while the ears are still arriving, a press says so and typing is the way".
4. **`~/Avanzel` already exists**, with files of its own or as an Avanzel library. The button reads "Use this folder", nothing in it is lost, and an existing library keeps its pages. Pinned by Task 3's two "existing folder" tests.
5. **A filing that writes pages outside the six shelves, or no page at all.** The receipt lists the shelf pages and counts the others, no line claims a page that isn't there, and the suggested question still reads well. Pinned by Task 6's `receiptPages` test, Task 8's `pagesLine` tests and Task 9's `suggestQuestion` tests.

---

### Task 1: A Mac with no library opens setup, where Zel says hello

**Files:**
- Create: `apps/mac/src/renderer/setup/index.html` (as `capsule/index.html`), `main.tsx`, `frame.tsx`, `copy.ts`, `styles.css`, `steps/Hello.tsx`, `steps/Found.tsx`
- Create: `apps/mac/src/main/setup-model.ts`
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/windows.ts` (new `createSetupWindow`)
- Modify: `apps/mac/src/main/controller.ts`:
  - `start` at ~250;
  - `readyToListen` at ~600;
  - `openQuick`, `openAsk` and `openLibraryFolder`;
  - `menuAction`;
  - `broadcast`;
  - a new "setup" section.
- Modify: `apps/mac/src/main/index.ts` (`second-instance`, `activate`, `AVANZEL_EXACT_PATH`)
- Modify: `apps/mac/src/main/menu-model.ts:64-71`
- Test: create `apps/mac/test/setup-model.test.ts`, `apps/mac/test/setup-copy.test.ts`, `apps/mac/e2e/setup.spec.ts`; modify `apps/mac/test/menu-model.test.ts:88-98` and `apps/mac/e2e/helpers.ts`
- Modify (tests that relied on Settings opening by itself):
  - `apps/mac/e2e/app.spec.ts:350-356` (delete);
  - `apps/mac/e2e/models.spec.ts:38-47, 143-159`;
  - `apps/mac/e2e/contrast.spec.ts:237-244`;
  - `apps/mac/e2e/agents.spec.ts:199-209` (delete; Task 1's setup test replaces it);
  - `apps/mac/e2e/shortcuts.spec.ts:171-181`.

**Interfaces:**
- Consumes: `ModelStatus`, `prettyAccelerator`, `Vault`, the controller's `snapshot()`, `showSettings()`, `refreshMenu()`.
- Produces (shared/ipc.ts):
  ```ts
  /** The steps of the setup window, in order. */
  export const SETUP_STEPS = ["hello", "found", "think", "filing", "ask", "done"] as const;
  export type SetupStep = (typeof SETUP_STEPS)[number];
  export const isSetupStep = (value: unknown): value is SetupStep => SETUP_STEPS.some((step) => step === value);
  /** What is at the library's place now. */
  export type LibraryFolder = "missing" | "empty" | "has-files" | "library";
  /** Everything the setup window shows, in one snapshot (setup:changed). Later tasks add fields. */
  export interface SetupSnapshot {
    /** Where Looks good makes or uses the library: the stored libraryPath, else ~/Avanzel, until Change… picks another. */
    libraryPath: string;
    /** libraryPath with the home folder as "~". */
    libraryLabel: string;
    folder: LibraryFolder;
    /** A library is open. */
    libraryReady: boolean;
    model: ModelStatus;
    /** Record a thought's shortcut, "Alt+Space". */
    shortcut: string;
  }
  ```
  - Bridge `setup`:
    - `get(): Promise<SetupSnapshot>` (`setup:get`);
    - `onChanged(callback: (snapshot: SetupSnapshot) => void): () => void` (`setup:changed`);
    - `enter(step: SetupStep): Promise<SetupSnapshot>` (`setup:enter`): the window now shows `step`. Later tasks hang effects on it.
- Produces (setup-model.ts):
  - `tildePath(target: string, home: string): string`: `home` becomes "~" only when followed by "/" or the end.
  - `libraryFolder(target: string): LibraryFolder`. A path that doesn't exist is "missing". A `Vault` that `exists()` is "library". A folder holding nothing but `.DS_Store` is "empty". Anything else, a file included, is "has-files".
- Produces (renderer, `frame.tsx`):
  - `interface StepProps { snap: SetupSnapshot; go(step: SetupStep): void }`;
  - `Frame({ stage, children, actions, model }: { stage: ReactNode; children: ReactNode; actions?: ReactNode; model: ModelStatus })`: a 40 px drag strip, the `Stage` (left, 45%) beside the step (right, 55%, scrolls), and a 56 px footer with `Download` on the left and `Actions` on the right;
  - `Download({ model }: { model: ModelStatus })`: the footer rows of the copy table. Try the download again calls `window.avanzel.settings.downloadModel()`.
- Produces (renderer, `copy.ts`): `megabytes(bytes: number): number`, `cardDate(day: Date): string` ("Wednesday 21 October"), `stampDate(day: Date): string` ("21 Oct 2026").
- Produces (controller):
  - `showSetup(): void`: opens or focuses the window and starts a session.
  - `showHome(): void`: setup when there is no library and the controller's own `libraryProblem` (why a stored library failed to open, set by `openLibrary`) is null; Settings otherwise. It never reads the setup session's `makeProblem` (Task 3).
  - `setupSnapshot(): SetupSnapshot`: without a session, it describes a fresh one.
  - `enterSetupStep(step: SetupStep): SetupSnapshot`: ignores anything that isn't `isSetupStep`.
  - `setupStepForTests(): SetupStep | null`: the step the session is on, for e2e tests of steps whose body a later task builds.
  - Private:
    - `interface SetupSession { window: BrowserWindow; step: SetupStep; libraryPath: string }`;
    - `setup: SetupSession | null`;
    - `endSetup(win)`, on the window's `closed`.
    - `broadcast()` also sends `setup:changed` to an open setup window.
- Produces (windows.ts): `createSetupWindow(): BrowserWindow`: 700 × 480 content (`useContentSize`), not resizable, minimizable or full-screenable, `show: false`, title "Set up Avanzel", `titleBarStyle: "hiddenInset"`, `trafficLightPosition: { x: 18, y: 18 }`, the shared `webPreferences`; it loads `pagePath("setup")`.
- Produces (menu-model.ts): the item "Set up Avanzel…" gets `action: input.problem ? "settings" : "setup"`, and `menuAction("setup")` calls `showSetup()`.
- Produces (e2e helpers.ts):
  ```ts
  /** A first run: a new HOME (setup's ~/Avanzel and the remembered library stay in it), an empty Hugging Face cache,
      and exactly agentStubs(answers) plus the system folders on PATH, so no agent of this Mac's own is found. */
  export function firstRun(answers: Record<string, string> = {}): { env: Record<string, string>; home: string };
  ```
  `env` holds `HOME`, `XDG_CONFIG_HOME: <home>/.config`, `HF_HUB_CACHE: emptyHfCache()`, `AVANZEL_EXACT_PATH: "1"`, `AVANZEL_PRESS_WAIT_MS: "60000"`, and `PATH: \`${agentStubs(answers)}:/usr/bin:/bin:/usr/sbin:/sbin\``.

Behaviour:
- `start()` ends with `if (!this.vault) this.showHome()`. `readyToListen()` without a vault calls `showHome()` and returns false, so the capsule shows no card ("Set up your library first" goes). `openQuick`, `openAsk` and `openLibraryFolder` without a vault call `showHome()` too.
- In `index.ts`:
  - `second-instance` calls `showHome()`.
  - `app.on("activate", () => controller?.showHome())` is registered after `await controller.start()`, so a launch never triggers it.
  - With `AVANZEL_TEST=1` and `AVANZEL_EXACT_PATH=1`, PATH is kept as given, not widened.
- The renderer:
  - holds `step` (starting at "hello") and the snapshot from `get` and `onChanged`;
  - `go(next)` sets the step and calls `enter(next)`;
  - steps whose task hasn't come yet render nothing.
- **Hello:** the Hello rows of the copy table. The stage holds the card above `Zel size="medium"`.
  - Zel starts `asleep`, turns `idle` at 900 ms, and the card's `hello` stamp lands (`animate`) at 1600 ms. Under Reduce Motion both are there from the start.
  - "Set me up" goes to "found".
- **Found, for now:** its heading and "Back", which goes to "hello".

- [ ] **Step 1: Write the failing unit tests.**
  - setup-model.test.ts:
    - "tildePath shortens only the home folder itself": `("/Users/a/Avanzel", "/Users/a")` gives "~/Avanzel"; `("/Users/ab/x", "/Users/a")` and `("/Volumes/x", "/Users/a")` are unchanged; `("/Users/a", "/Users/a")` gives "~".
    - "libraryFolder tells missing, empty, has-files and library apart": in temp dirs, a missing path, an empty folder, one holding only `.DS_Store`, one holding `notes.md`, a plain file, and `await Vault.init(dir, { git: false })` give missing, empty, empty, has-files, has-files and library.
  - setup-copy.test.ts: "dates read as the card and the stamp print them": `cardDate(new Date(2026, 9, 21))` is "Wednesday 21 October", `stampDate` of it is "21 Oct 2026", and `megabytes(672_807_563)` is 673.
  - menu-model.test.ts, in place of the two "Set up Avanzel…" expectations: without a library the item is `{ type: "item", label: "Set up Avanzel…", action: "setup", sublabel: "Choose a folder for your library to start." }`; with a `problem`, its action stays "settings".
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: the new tests fail (no module, wrong action).
- [ ] **Step 3: Write the failing e2e tests** in `setup.spec.ts`. Each one launches with `firstRun().env`. Add a local `shown(app, page)` (any visible window whose URL holds `/renderer/<page>/`, as in models.spec.ts) and `closeSetup(app)` (closes that window through `BrowserWindow` in `app.evaluate`).
  - "a first launch without a library opens setup on Hello, not Settings":
    - `windowFor(app, "setup")` shows the heading "Hi, I'm Zel.", and text containing "Talk to me anytime with" and "⌥Space".
    - The image `/^Hello, \d{1,2} [A-Z][a-z]{2} \d{4}$/` is there, with the text "Speech model, 673 MB. Downloads when you continue.".
    - `shown(app, "settings")` is false. `snap(setup, "setup-hello")`.
  - "Set me up moves to Here's what I found, and Back returns": clicking "Set me up" shows the heading "Here's what I found."; clicking "Back" shows "Hi, I'm Zel." again.
  - "with no library, the shortcut, Quick and Ask bring setup forward and the capsule stays hidden": after `closeSetup`, each of `toggleDictate`, `openQuick` and `openAsk`, through `call`, makes `shown(app, "setup")` true (close it between them). `capsuleKind` is "hidden" throughout, and `shown(app, "quick")` and `shown(app, "ask")` are false.
  - "the menu's Set up Avanzel… opens setup, and so does opening Avanzel again":
    - `menuForTests()[0]` has `action: "setup"`.
    - After `closeSetup`, `call(app, "menuAction", "setup")` shows setup.
    - After another `closeSetup`, `app.evaluate(({ app }) => app.emit("activate"))` shows it again.
- [ ] **Step 4:** Run `npm run build` and the spec from `apps/mac`. Expected: fail (Settings opens instead).
- [ ] **Step 5: Implement** as the Interfaces and Behaviour say. Then fix the tests that relied on Settings opening by itself:
  - delete `app.spec.ts`'s "first launch without a library opens the welcome screen" and `agents.spec.ts`'s "Open Settings with no library opens Settings → General" (their cases are setup.spec.ts's now);
  - in the models, contrast and shortcuts tests listed under Files, call `call(app, "showSettings")` (or `call(ready, …)`) before `windowFor(…, "settings")`. Settings' own Welcome stays for a Settings opened without a library.
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, then the e2e specs `setup`, `app`, `models`, `agents`, `shortcuts`, `library`, and `contrast -g welcome`. Expected: all pass. `library.spec.ts`'s "a library that can't be opened…" still finds Settings, by `showHome()`.
- [ ] **Step 7:** Commit: `mac: a Mac with no library opens setup, where Zel says hello`.

### Task 2: Set me up starts the download and reads the agents' sign-in, and setup chooses the best agent

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts`:
  - `checkAgents`, `checkAgent` and `runAgentCheck` at ~1440-1500, which now work without a library;
  - new `harnessTable()` and `checkDir()`;
  - the setup section.
- Modify: `apps/mac/src/main/setup-model.ts` (`bestAgent`), `apps/mac/src/renderer/setup/copy.ts` (`agentLine`), `apps/mac/src/renderer/setup/steps/Found.tsx`
- Test: `apps/mac/test/setup-model.test.ts`, `apps/mac/test/setup-copy.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `checkAgent` (engine, with `prompt: false`), `harnesses`, `defaultSettings`, `downloadModel()`, `harnessName()`, `AgentStatus`.
- Produces:
  ```ts
  /** An installed agent, as setup lists it under "Who should do the filing?". */
  export interface SetupAgent {
    /** The harness name: "claude". */
    name: string;
    /** "Claude Code" (harnessName). */
    label: string;
    /** Its check reads its own sign-in; the others are asked one short question when picked. */
    freeCheck: boolean;
    /** What its check found in this app run; null while it hasn't been checked. */
    status: AgentStatus | null;
  }
  ```
  - `SetupSnapshot` gains `agents: SetupAgent[]` (installed agents in the table's order) and `agent: string | null`: the person's pick, else `bestAgent(agents)`.
  - `bestAgent(agents: readonly SetupAgent[]): string | null`: "claude" when its status is signed-in or replied; else the first agent with either; else null.
  - Bridge `setup.chooseAgent(name: string): Promise<SetupSnapshot>` (`setup:choose-agent`); controller `chooseSetupAgent(name: string): SetupSnapshot` records the pick (an installed name only).
  - Controller, private:
    - `harnessTable(): Record<string, Harness>`: the library's, else `harnesses(defaultSettings())`;
    - `checkDir(): string`: the library's root, else one scratch folder made with `mkdtempSync(path.join(tmpdir(), "avanzel-check-"))` and kept for the app run;
    - `runAgentCheck(name, harness, dir: string, prompt)` takes a folder instead of a `Vault`.
    - `SetupSession` gains `begun: boolean`, `installed: string[]` and `picked: string | null`.
  - `agentLine(status: AgentStatus | null): string`: the Found status column of the copy table.
  - `ownLine(detail: string): string` (in copy.ts) drops a leading "Error:" label (any case), capitalises the first letter, and ends with "." unless it ends with ".", "?" or "…"; "" stays "".

Behaviour:
- `checkAgents()` and `checkAgent(name)` use `harnessTable()` and `checkDir()`, so they work with no library. With one, nothing changes.
- `enterSetupStep("found")`, the first time in a session (`begun`):
  - if the model is "missing", starts `downloadModel()`;
  - records the installed agents (`harnessTable()` entries whose `available()`);
  - calls `checkAgents()`, which reads only sign-ins.
- **Found:**
  - the library group, its row and its description (no "Change…" yet);
  - when `agents` isn't empty, the agents group with a row per agent. "Use {label}" calls `chooseAgent`.
  - the limits footnote when the chosen agent is "claude" or "opencode";
  - the stage shows `Zel mood="idle"`.

- [ ] **Step 1: Write the failing unit tests.**
  - setup-model.test.ts, `describe("bestAgent")`:
    - "Claude Code first when it works": claude and codex both signed in give "claude".
    - "else the first that works": claude signed out and codex signed in give "codex"; claude checking and codex replied give "codex".
    - "nothing that is known to work": statuses null, checking and signed-out give null.
  - setup-copy.test.ts, "each status reads as Found says it":
    - null gives "Installed", and checking "Checking…";
    - `{ kind: "replied", seconds: 1.63 }` gives "Replied in 1.6 s";
    - `{ kind: "failed", detail: "Error: boom" }` gives "Boom.", and with `detail: ""` "Didn't reply.".
  - setup-copy.test.ts, "ownLine": "Error: usage limit reached" gives "Usage limit reached."; "agent crashed: not logged in" gives "Agent crashed: not logged in."; "Is it on?" stays.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests** in `setup.spec.ts` (with `test.afterEach(closeModelHubs)`):
  - "Set me up starts both speech models downloading, shown in the footer": `firstRun()` with `AVANZEL_MODELS_URL` set to a "stall" `fakeModelHub`. After "Set me up", the setup page shows "Getting my ears ready", the progress bar "Downloading the speech model" and `/^\d+ of 673 MB$/`. `hub.requests[0]` contains "silero-vad-onnx".
  - "Here's what I found reads Claude Code's and Codex's sign-in, asks no agent anything, and chooses Claude Code":
    - after "Set me up", `getByText("Signed in", { exact: true })` has count 2 (timeout 20 s);
    - "Best results" and "Your agent works only inside the library folder: no shell, no web." are visible;
    - a button "Use Codex" exists and none named "Use Claude Code" does;
    - `setupSnapshot().agent` is "claude";
    - `(await agentCalls(app)).sort()` equals `["claude auth status", "codex login status"]`.
  - "Codex is chosen while Claude Code isn't signed in": `firstRun({ claude: <body printing {"loggedIn": false} and exiting 1 for auth status> })`. "Not signed in" is visible, `agent` is "codex", and there is a button "Use Claude Code".
  - "a failed download says so in the footer, with Try the download again" (Review Focus 3): `firstRun()` with a "missing" `fakeModelHub`. After "Set me up", the text "The speech model didn't finish downloading." and a button "Try the download again" show. Clicking it makes `hub.requests.length` grow, and the heading stays "Here's what I found.".
- [ ] **Step 4:** Build and run the spec. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup` and `agents`. Expected: all pass; the agents tests are unchanged.
- [ ] **Step 7:** Commit: `mac: Set me up starts the download and reads the agents' sign-in, and setup chooses the best agent`.

### Task 3: Looks good makes the library with the chosen agent, or uses the folder that is there

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`useLibrary` at ~1405 gains a `fromSetup` flag; setup section)
- Modify: `apps/mac/src/renderer/setup/main.tsx` (the step switch shows Think), `apps/mac/src/renderer/setup/steps/Found.tsx`; create `apps/mac/src/renderer/setup/steps/Think.tsx` (heading and "Back" for now)
- Modify: `apps/mac/e2e/helpers.ts` (`throughFound`)
- Test: `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `libraryFolder`, `Vault.init`, `useLibrary`, `setLibrarySettings`, `dialog.showOpenDialog`.
- Produces:
  - `SetupSnapshot.makeProblem: string | null`; `SetupSession.makeProblem`: why the library couldn't be made. It is not called `libraryProblem`: the controller's own field of that name is what `showHome()` reads.
  - Bridge:
    - `setup.createLibrary(): Promise<SetupSnapshot>` (`setup:create-library`);
    - `setup.chooseFolder(): Promise<SetupSnapshot>` (`setup:choose-folder`).
  - Controller:
    - `createSetupLibrary(): Promise<SetupSnapshot>`;
    - `chooseSetupFolder(): Promise<SetupSnapshot>`;
    - `useLibrary(target: string, fromSetup = false)`: with `fromSetup` it skips `noticeTakenShortcut()`, because step 3 names a taken shortcut itself (Task 5).
  - e2e helper `throughFound(app: ElectronApplication): Promise<Page>`, exported from `helpers.ts` so other specs can use it. From Hello it clicks "Set me up", waits for `setupSnapshot().agent` to be "claude" (20 s), clicks "Looks good", and returns the setup page once the heading "What's on your mind this week?" shows.

Behaviour of `createSetupLibrary()` at `libraryPath`:
- When that library is already the open one, only the agent is saved.
- missing or empty: `mkdirSync` (recursive) and `Vault.init(target, { git: true })`. has-files: `Vault.init` keeps every file, and its first commit holds them. library: used as it is.
- Then `useLibrary(target, true)`, and the chosen agent saved with `setLibrarySettings({ harness })`.
- When anything throws, or `this.vault` is still null afterwards (the controller's `libraryProblem` says why), `SetupSession.makeProblem` gets the message.
- `chooseSetupFolder()` shows the folder picker as a sheet on the setup window, titled "Choose your library folder" with `openDirectory` and `createDirectory`. A chosen folder becomes `libraryPath`, which clears `makeProblem`; nothing is made yet.
- Found:
  - the row's "Change…" calls `chooseFolder`;
  - the footer's primary is "Looks good", or "Use this folder" when `folder` is has-files or library, and it is secondary while a Notice with actions shows;
  - it is enabled when the chosen agent's status is signed-in or replied, and busy while it works;
  - success goes to "think";
  - a `makeProblem` shows its Notice, whose "Change…" is then the primary.

- [ ] **Step 1: Write the failing e2e tests:**
  - "Looks good makes the library at ~/Avanzel with Claude Code, and moves on":
    - `throughFound(app)`;
    - `<home>/Avanzel/.avanzel/config.toml` exists, and `loadSettings(<home>/Avanzel).harness` is "claude";
    - `snapshot().library.path` is `<home>/Avanzel`;
    - `menuForTests()` holds an item labelled "Record a thought".
  - "an existing folder with files becomes the library through Use this folder, keeping them": before launch, write `<home>/Avanzel/notes.md`. Found shows "This folder has files already…" and the button "Use this folder". After clicking it, `notes.md` is unchanged and `gitOut(lib, "ls-files")` lists it.
  - "an existing library is used as it is": before launch, `Vault.init(<home>/Avanzel, { git: true })` and write `ideas/plant.md`. Found shows "This folder is already an Avanzel library.". After "Use this folder", `ideas/plant.md` is unchanged.
  - "Change… picks another folder": stub the picker with `app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, other)`. After "Change…" the row shows `other` (under `/var` or `/private`, so not shortened). After "Looks good", the library is at `other`.
  - "a library that can't be made says why, and Change… is the way out": `<home>/Avanzel` is a plain file. "Use this folder" shows "I couldn't make the library at ~/Avanzel." and a "Change…" in the Notice, and the heading stays "Here's what I found.".
- [ ] **Step 2:** Build and run. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup`, `shortcuts` and `models`. Expected: all pass. Shortcuts' "setting up a library names a taken shortcut at once…" still passes, because `createLibrary` isn't `fromSetup`.
- [ ] **Step 5:** Commit: `mac: Looks good makes the library with the chosen agent, or uses the folder that is there`.

### Task 4: Setup says how to sign an agent in, asks a picked agent one question, and notices a new install

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`chooseSetupAgent`, the setup session, new `openTerminal`, `copyText` and test hooks)
- Modify: `apps/mac/src/renderer/setup/steps/Found.tsx`
- Modify: `apps/mac/e2e/helpers.ts` (`noAgents`)
- Test: `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `checkAgent(name)` (now library-free, Task 2), reached from the renderer as `window.avanzel.settings.checkAgent(name)`; its result arrives through `setup:changed`.
- Produces:
  - Bridge:
    - `setup.openTerminal(): void` (`setup:open-terminal`);
    - `setup.copy(text: string): void` (`setup:copy`).
  - Controller:
    - `openTerminal(): void`: `shell.openPath("/System/Applications/Utilities/Terminal.app")`, or with `AVANZEL_TEST=1`, pushes "Terminal" to `opened`.
    - `copyText(text: string): void`: `clipboard.writeText(text)`, or in tests, pushes to `copied`.
    - `openedForTests(): string[]` and `copiedForTests(): string[]`.
  - `SetupSession.pollTimer: NodeJS.Timeout | null`; `AGENT_POLL_MS = 2_000`.
  - e2e helper `noAgents(): { env: Record<string, string>; bin: string }`: `firstRun()`'s env with PATH set to an empty new folder `bin` plus the system folders.

Behaviour:
- `chooseSetupAgent(name)` also runs that agent's check with its one question (`runAgentCheck(…, checkDir(), true)`) when the agent has no status yet: no sign-in command, or one that couldn't be read.
- "Check again" calls `settings.checkAgent(name)`. It reads the sign-in again, and asks the question only when the sign-in says nothing.
- With no installed agent when Found is entered, a timer every `AGENT_POLL_MS` looks for installed agents again. When one appears, it stops, calls `checkAgents()` and broadcasts. `endSetup` clears it.
- **Found:**
  - the chosen agent's problem Notice: signed-out, timeout or failed. Its "Check again" is the primary, so the footer's button is secondary while it shows;
  - with no agent, the no-agent Notice and the two install commands. "Copy" calls `setup.copy` and reads "Copied" for 2 s.

- [ ] **Step 1: Write the failing e2e tests:**
  - "a signed-out Claude Code, once picked, says how to sign in, and Check again only reads the sign-in again":
    - Claude Code's stand-in answers `{"loggedIn": false}` with exit 1, so Codex is chosen.
    - After "Use Claude Code", the page shows "Claude Code isn't signed in on this Mac." and the text "Run", `claude` and "once in Terminal and sign in, then check again.".
    - "Open Terminal" makes `openedForTests()` equal `["Terminal"]`.
    - After "Check again", `agentCalls(app).filter((c) => c.startsWith("claude"))` has two "claude auth status" entries and nothing else.
  - "an agent without a sign-in command is asked one question only when picked":
    - `firstRun({ opencode: "echo ready" })`. After Found settles, OpenCode's row reads "Installed" and no call starts with "opencode".
    - "Use OpenCode" leads to `/^Replied in \d+\.\d s$/`, and exactly one call starts with "opencode run" and ends with "Reply with the single word: ready.".
  - "with no agent, setup shows how to install one, copies the command, and notices when one arrives": `noAgents()`.
    - "Avanzel needs an AI agent to do the filing." and both commands show.
    - The first "Copy" turns into "Copied", and `copiedForTests()` equals `["curl -fsSL https://claude.ai/install.sh | bash"]`.
    - Copy `claude` from a fresh `agentStubs()` folder into `bin` (it answers as signed in), and `chmodSync` it to 0o755. Within 15 s "Signed in" shows, `agent` is "claude", and the no-agent Notice is gone.
- [ ] **Step 2:** Build and run. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup` and `agents`. Expected: all pass.
- [ ] **Step 5:** Commit: `mac: setup says how to sign an agent in, asks a picked agent one question, and notices a new install`.

### Task 5: Setup listens for the shortcut, and offers free ones when no press arrives

**Files:**
- Modify: `apps/mac/src/main/shortcuts.ts` (new `keyCaps`)
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts`:
  - `toggleDictate` at ~556;
  - the setup session, including `enterSetupStep("think")`;
  - new `useSetupShortcut`.
- Modify: `apps/mac/src/renderer/setup/steps/Think.tsx`
- Test: `apps/mac/test/shortcuts.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `takenShortcuts`, `freeAlternatives`, `likelyHolder`, `runningAppNames`, `shortcutApi()`, `NoticedShortcuts.add`, `useShortcut(key, accelerator)` (Phase 0).
- Produces:
  ```ts
  /** How the press of Record a thought's shortcut went on the first-thought step. */
  export interface SetupPress {
    /** Registering it failed: another app holds it. */
    taken: boolean;
    /** A press arrived since the step asked for one: the shortcut works. */
    heard: boolean;
    /** No press arrived within the wait (3 s), and none since. */
    silent: boolean;
    /** The running app whose default shortcut it is, if one is running. */
    holder: string | null;
    /** Free shortcuts to use instead, best first: filled when taken or silent. */
    alternatives: string[];
  }
  ```
  - `SetupSnapshot.press: SetupPress`. A taken one takes its holder and alternatives from `takenShortcuts`; a silent one, from the session.
  - `keyCaps(accelerator: string): string[]`: each modifier's symbol in macOS order (⌃ ⌥ ⇧ ⌘), then the key: "Alt+Space" gives `["⌥", "Space"]`.
  - Bridge `setup.useShortcut(accelerator: string): Promise<SetupSnapshot>` (`setup:use-shortcut`); controller `useSetupShortcut(accelerator: string): Promise<SetupSnapshot>`.
  - `PRESS_WAIT_MS = (AVANZEL_TEST && Number(env.AVANZEL_PRESS_WAIT_MS)) || 3_000`.
  - `SetupSession` gains `pressTimer`, `heard`, `silent`, `holder` and `alternatives`.
  - Private `setupTakesPress(): boolean` (setup is on "think" and nothing records) and `setupPress(): Promise<void>`. In this task a press only marks `heard`; Task 7 makes it record.

Behaviour:
- `toggleDictate()` starts with `if (this.setupTakesPress()) return this.setupPress();`.
- `enterSetupStep("think")` resets `heard` and `silent` and clears the timer.
  - When dictate is taken, it marks the accelerator noticed, so the capsule won't name it at the next launch, and waits for nothing.
  - Otherwise it starts the timer. If no press arrives within `PRESS_WAIT_MS`, it sets `silent`, reads `runningAppNames()` for `likelyHolder`, and takes `freeAlternatives("dictate", shortcuts, shortcutApi())`.
  - Entering any other step clears the timer.
- `endSetup` clears `pressTimer` too, so the wait can't fire against a closed session.
- `setupPress()` sets `heard`, clears `silent` and the timer, and broadcasts.
- `noticeTakenShortcut()` is not changed, and gets no early return while setup is open: Task 3's `fromSetup` skip suffices, and shortcuts.spec.ts's "setting up a library names a taken shortcut at once…" opens its library from Settings while setup is open.
- `useSetupShortcut(a)` is `useShortcut("dictate", a)`, then the same reset and timer as entering "think".
- **Think:**
  - the instruction and hint rows of the copy table;
  - the stage: the card's placeholder, a `Row` of `Kbd size="key"` per `keyCaps(shortcut)`, and `Zel mood="idle"`;
  - the keycaps press themselves twice (`pressed` for 200 ms at 700 ms and at 1600 ms), once each time the step is entered, and only while nothing has been heard. That is step 3's orchestrated moment (§5.2 asks for it): under Reduce Motion the keycaps show their final frame, unpressed, at once;
  - a heard press shows the "is free" footnote;
  - the taken and silent Notices offer "Use {alt}", the best last and primary, which calls `setup.useShortcut`. With none free, they offer "Open Settings", which calls `window.avanzel.capsule.openSettingsFor("open-settings:voice")`.

- [ ] **Step 1: Write the failing unit test** in shortcuts.test.ts: "keyCaps splits a shortcut into keycaps in macOS order". "Alt+Space" gives `["⌥", "Space"]`, "Control+Shift+Space" gives `["⌃", "⇧", "Space"]`, and "Command+Alt+K" gives `["⌥", "⌘", "K"]`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests:**
  - "a press of the shortcut is heard, and setup says it is free": after `throughFound`, `call(app, "toggleDictate")` shows "⌥Space is free on this Mac, so it works in every app. Esc cancels.". `capsuleKind` is "hidden", and the page shows the keycaps "⌥" and "Space".
  - "no press within the wait offers two free shortcuts, and the one picked is the one to press": with `AVANZEL_PRESS_WAIT_MS: "300"`.
    - "Did ⌥Space do nothing?" and the buttons "Use ⌃⌥R" and "Use ⌃⇧Space" show, in that order.
    - "Use ⌃⇧Space" makes `snapshot().app.shortcuts.dictate` "Control+Shift+Space", and the page shows the text "⌃⇧Space" in the instruction.
    - A `toggleDictate` hides the nudge.
  - "a ⌥Space another app holds is named at once, and the capsule doesn't name it too": `AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space"`.
    - Step 3 shows `/^⌥Space is used by another app/` and "Pick another shortcut.".
    - `capsuleKind` stays "hidden" from launch to here.
    - `noticed-shortcuts.json` in the app's `AVANZEL_USER_DATA` contains "Alt+Space". Pass your own `AVANZEL_USER_DATA` to read it.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup` and `shortcuts`. Expected: all pass.
- [ ] **Step 7:** Commit: `mac: setup listens for the shortcut and offers free ones when no press arrives`.

### Task 6: The first thought is filed in the setup window, with the time, Cancel and one fix

The first thought arrives typed here; Task 7 adds the spoken one, which takes the same path.

**Files:**
- Modify: `packages/engine/src/core/harness.ts` (new `asksToSignIn`, which `checkAgent` uses)
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts`:
  - `FilingJob` gains `setup?` and `cancelled?`;
  - `runFiling` at ~840, `filingFailed` and `filingProgress`;
  - setup section.
- Modify: `apps/mac/src/renderer/setup/copy.ts`, `apps/mac/src/renderer/setup/main.tsx` (the step switch shows Filing, and goes there when `snap.filing` appears), `apps/mac/src/renderer/setup/steps/Think.tsx` (typing); create `apps/mac/src/renderer/setup/steps/Filing.tsx`
- Modify: `apps/mac/e2e/helpers.ts` (`filingClaude`, `typeFirstThought`)
- Test: `packages/engine/test/core/harness.test.ts`, `apps/mac/test/setup-copy.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `enqueue`, `withRun`, `runFiling`, `takeBack`, `filedPages`, `errorLine`, `WAITING`, `openTerminal()` (Task 4).
- Produces (engine): `asksToSignIn(line: string): boolean`: the `SIGN_IN_LINE` test that `checkAgent` already applies.
- Produces (shared/ipc.ts):
  ```ts
  /** The first thought's filing, in the setup window. */
  export type SetupFiling =
    | { kind: "running"; words: string; agent: string; /** Date.now() at the start. */ startedAt: number;
        /** Another run has the library. */ waiting: boolean; /** Cancel was pressed; it is stopping. */ cancelling: boolean }
    | { kind: "filed"; words: string; agent: string; seconds: number; /** New pages first. */ pages: FiledPage[];
        /** How many of pages are new. */ created: number; /** The engine put the words back. */ restored: boolean;
        /** The filing is its own commit. */ canUndo: boolean }
    | { kind: "cancelled"; words: string; /** What the stopped run did stays, as its own commit. */ partial: boolean }
    | { kind: "failed"; words: string; agent: string; /** The harness name, "claude". */ harness: string;
        /** errorLine of the failure. */ line: string; /** That line asks to sign in. */ signedOut: boolean };
  ```
  - `SetupSnapshot.filing: SetupFiling | null` and `SetupSnapshot.typeProblem: string | null`: why a typed thought wasn't taken.
  - Bridge:
    - `setup.typeThought(words: string): Promise<SetupSnapshot>` (`setup:type-thought`);
    - `setup.cancelFiling(): void` (`setup:cancel-filing`);
    - `setup.fileAgain(): void` (`setup:file-again`).
  - Controller:
    - `typeSetupThought(words: string): SetupSnapshot`: writes a `source: "text"` capture and calls `takeThought`. It never throws: empty words, or a capture that can't be written, set `SetupSession.typeProblem` to the message and come back in the snapshot, and each call starts by clearing it.
    - `cancelSetupFiling(): void` and `fileSetupAgain(): void`.
    - Private `takeThought(capturePath: string, words: string, transcribedIn: number | null): void`. It calls `enterSetupStep("filing")` (it does not set `session.step` itself, so what Tasks 5 and 11 hang on entering a step runs), hides the capsule, adds the capture to `queuedToFile`, and enqueues `runFiling` for a job with `setup: true`.
    - `SetupSession` gains `job: FilingJob | null`, `filing: SetupFiling | null` and `typeProblem: string | null`.
- Produces (copy.ts):
  - `ESTIMATE_SECONDS = 15`; `workingLine(agent: string, seconds: number): string`;
  - `receiptPages(pages: readonly FiledPage[]): { pages: ReceiptPage[]; others: number }`: pages on the six shelves become receipt rows, in order; the rest are counted (`ReceiptPage` is `@avanzel/ui`'s).
- Produces (helpers.ts): `filingClaude(): string`, a `claude` body for `agentStubs`. It answers `{"loggedIn": true}` to `auth status`, and otherwise runs `exec '<process.execPath>' '<fake-agent.mjs>' "$2"`: the prompt follows `-p`.

Behaviour:
- `runFiling` sends a setup job to the session while `this.setup?.job === job`.
  - Success: `filed`, with `pages` from `filedPages`, `created` counting the created ones, `restored` and `canUndo: !!outcome.commit`.
  - Failure: `failed`, with `line = errorLine(error)` and `signedOut = asksToSignIn(line)`.
  - A capture gone from the inbox: `failed` with the line "The note isn't in the inbox any more.".
  - Waiting messages set `waiting`.
  - With the window closed, the job falls to today's branches: a notification "Filed by {agent}", or "A note couldn't be filed".
  - A `cancelled` job returns early, as an edited one does, in both places `runFiling` checks `job.edited`.
- `cancelSetupFiling()` marks the job `cancelled` and `cancelling`, and aborts its run. It then enqueues the job's `takeBack`, after which the filing is `cancelled` with `partial` = whether a problem came back.
- `fileSetupAgain()`, after cancelled, failed or undone (Task 8's state), files the same capture in a new job.
- **Think:** "Type it instead" opens the typing rows, and "File it" (or Return) calls `typeThought`. `snap.typeProblem`, when set, shows as the `TextArea`'s description.
- The renderer goes to "filing" when `snap.filing` appears on "think".
- **Filing:**
  - the stage: a `Card` (label "Thought", meta "Inbox", the words), a `Row` of the six `ShelfTag variant="tab"`, and `Zel` thinking while running, `needs-you` when failed, `filed` when filed, `idle` otherwise;
  - the heading sits in a `div role="status"`, so VoiceOver hears the start and the end, not each second;
  - while running, a `Stack` holds the working line (ticking every 250 ms) and "Cancel" (busy while cancelling). Phase 1b adds its rows to this `Stack`;
  - "filed" shows its heading and the `Receipt` of `receiptPages(pages).pages` (Task 8 adds the rest), and the footer shows "Continue", which goes to "done" for now;
  - cancelled and failed show their copy, and the footer offers "Continue" (secondary while a Notice with actions shows);
  - the footer has no Back in any Filing state.

- [ ] **Step 1: Write the failing unit tests.**
  - harness.test.ts, "asksToSignIn knows a sign-in line": "Error: not logged in. Run cursor-agent login" is true; "Error: usage limit reached" is false.
  - setup-copy.test.ts, "the working line counts up to the estimate, then only counts": ("Claude Code", 6.9) gives "Claude Code is working: 6 s of about 15", and 15 gives "Claude Code is working: 15 s".
  - setup-copy.test.ts, "receiptPages keeps the shelves and counts the rest" (Review Focus 5): `[ideas/a, projects/b, people/c]` gives two rows (Ideas, People) and `others: 1`.
- [ ] **Step 2:** Run both workspaces' tests. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests.** Each launches `firstRun({ claude: filingClaude() })`. The helper `typeFirstThought(setup: Page, words: string): Promise<void>`, exported from `helpers.ts` so other specs can use it, clicks "Type it instead", fills "Your thought" and clicks "File it".
  - "a typed first thought is filed in the window, with the time shown":
    - with `FAKE_AGENT_DELAY_MS: "1500"` and `FAKE_AGENT_DELAY_TASK: "file"`, type "Plant tulips in October";
    - expect "Watch me file it." and `/^Claude Code is working: \d+ s of about 15$/`, then the heading `/^All filed\. Claude Code took \d+ s\.$/`;
    - `filesUnder(lib, "ideas")` has one page, the inbox is empty, and `capsuleKind` is "hidden".
  - "Cancel stops the agent, takes back what it did, and File it again files it":
    - with `FAKE_AGENT_MODE: "slow-once"` and `FAKE_AGENT_ONCE: onceMarker()`, wait until `goals/half.md` exists (the stalled run has changed something), then "Cancel" shows "Cancelled." and "Your words are back in the inbox, untouched, and nothing else changed.";
    - `exists(lib, "goals/half.md")` is false, and the inbox holds one capture;
    - "File it again" ends at "All filed.".
  - "a filing that asks to sign in names it and offers Open Terminal": a `claude` that answers its sign-in and otherwise prints "Error: not logged in" to stderr and exits 1. The page shows "Claude Code isn't signed in on this Mac.", "Open Terminal" and "Try again", and the inbox keeps the capture.
  - "another failure shows its own line": printing "Error: usage limit reached" shows "Claude Code couldn't file it." and the text "Usage limit reached. Your words are safe in the inbox.".
  - "closing setup during the filing still files the thought and says so" (Review Focus 1):
    - it launches with its own `AVANZEL_USER_DATA`, and with `AVANZEL_FAKE_AUDIO: speechWav("Plant tulips in October")` and `AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October"` too;
    - with a 3000 ms filing delay, `closeSetup` while "Watch me file it." shows, then `idleForTests`;
    - `notificationsForTests()` holds an entry titled "Filed by Claude Code", and `ideas/` has one page;
    - `shown(app, "setup")` stays false;
    - a normal dictation works: `call(app, "toggleDictate")` makes `capsuleKind` "listening", then `cancelRecording`;
    - after closing the app, a relaunch with the same `firstRun()` env and `AVANZEL_USER_DATA` has the library open and not setup: `snapshot().library.path` is `<home>/Avanzel` and `shown(app, "setup")` is false.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run both workspaces' tests, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup`, `filing` and `app`. Expected: all pass, with filing.spec.ts unchanged.
- [ ] **Step 7:** Commit: `engine, mac: the first thought is filed in the setup window, with the time, Cancel and one fix`.

### Task 7: The first spoken thought is asked for behind the microphone primer, and a mic check gets a warm answer

**Files:**
- Modify: `apps/mac/src/main/permissions.ts` (`AVANZEL_FAKE_MIC_ANSWER`)
- Modify: `apps/mac/src/main/setup-model.ts` (`looksLikeATest`)
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`setupPress`, `fail`, `stopRecording`, `cancelRecording`, `afterCapture`; setup section)
- Modify: `apps/mac/src/renderer/setup/steps/Think.tsx`
- Modify: `apps/mac/electron-builder.yml:24` (the purpose string)
- Test: `apps/mac/test/setup-model.test.ts`; create `apps/mac/test/build-config.test.ts`; `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `startRecording("dictate")`, `requestMicrophone`, `permissionStatus`, `takeThought` (Task 6), `captureMeta`, `downloadModel()`.
- Produces:
  ```ts
  /** The first spoken thought, from the press to its words. */
  export type SetupThought =
    | { kind: "waiting" }
    | { kind: "primer" }
    | { kind: "denied" }
    | { kind: "listening"; startedAt: number }
    | { kind: "transcribing" }
    | { kind: "test"; words: string }
    | { kind: "failed"; message: string; detail: string | null };
  ```
  - `SetupSnapshot` gains `thought: SetupThought` and `hears: boolean`: the models are ready, or `AVANZEL_FAKE_TRANSCRIPT` stands in for them.
  - Bridge:
    - `setup.allowMicrophone(): void` (`setup:allow-microphone`);
    - `setup.tryAgain(): void` (`setup:try-again`);
    - `setup.fileAnyway(): void` (`setup:file-anyway`).
  - Controller:
    - `allowMicrophone(): Promise<void>`;
    - `retrySetupThought(): void`;
    - `fileSetupAnyway(): void`.
    - `SetupSession` gains `thought`, `testCapture: string | null` and `askingMicrophone: boolean`.
  - `looksLikeATest(words: string): boolean`: true for 1–8 words, all in {test, testing, tested, hello, hi, hey, one, two, three, check, checking, mic, microphone, can, you, hear, me, is, this, on, ok, okay}, compared in lower case without punctuation.
  - permissions.ts: with `AVANZEL_TEST=1`, `requestMicrophone()` takes `AVANZEL_FAKE_MIC_ANSWER` ("granted" or "denied") as the prompt's answer, which `permissionStatus("microphone")` then reports. Without the variable it stays false, as now.

Behaviour:
- `setupPress()`, after Task 5's marking:
  - nothing happens while the thought is primer or transcribing;
  - a test first does what Try again does;
  - without `hears`, a "missing" model starts `downloadModel()`, and the press records nothing and shows no capsule;
  - a microphone "not-determined" turns the thought to primer, and "denied" or "restricted" to denied;
  - otherwise it records (`startRecording("dictate")`), and once `this.recording` exists the thought is listening.
- `allowMicrophone()` runs once at a time (`askingMicrophone`). A grant records, and anything else is denied.
- Hooks, all only while setup is on "think":
  - `stopRecording` turns listening into transcribing;
  - `cancelRecording` turns listening into waiting;
  - `fail()`, while listening or transcribing, becomes thought failed {message, detail}: the capsule hides and shows no card;
  - `afterCapture`, while listening or transcribing, hands the words over: a voice capture whose words `looksLikeATest` becomes thought test (`testCapture` kept, capsule hidden), and anything else goes to `takeThought`.
- `retrySetupThought()`: a test's capture and its recording (`captureMeta(...).audio`) are removed. The thought returns to waiting, and the press wait restarts.
- `fileSetupAnyway()` hands the test's capture to `takeThought`.
- electron-builder.yml's `NSMicrophoneUsageDescription` becomes "Avanzel listens only while you can see it listening, and turns speech into text on this Mac.".
- **Think:**
  - the primer replaces the step's panel, and Continue calls `allowMicrophone`;
  - listening shows `Zel mood="listening"` and its copy; transcribing, its row; denied and failed, their Notices (Try again calls `tryAgain`, Open System Settings calls `window.avanzel.settings.openPrivacy("microphone")`). While denied, the Notice's "Type it instead" does what the standalone button does and replaces it, so there is one button of that name;
  - a test shows the words on the card, Zel's line, and "File it anyway" and "Try again";
  - without `hears`, the ears line shows, and "Type it instead" becomes the primary, unless a Notice with actions shows.

- [ ] **Step 1: Write the failing unit tests.**
  - setup-model.test.ts, "looksLikeATest knows a mic check from a thought": "Testing, testing.", "Test test one two three", "Hello?", "Can you hear me?" and "Is this on?" are true. "Testing the podcast idea with Mark", "Hello, I want to run a marathon in spring" and "" are false.
  - build-config.test.ts: "the microphone is asked for with the purpose setup promises": `electron-builder.yml` contains `NSMicrophoneUsageDescription: Avanzel listens only while you can see it listening, and turns speech into text on this Mac.`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests.** Each launches `firstRun({ claude: filingClaude() })` with `AVANZEL_FAKE_AUDIO: speechWav("Plant tulips in October")` and goes `throughFound`.
  - "the first press asks about the microphone behind one Continue, then records, and the words are filed":
    - with `AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined"`, `AVANZEL_FAKE_MIC_ANSWER: "granted"` and `AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October"`, a press shows "Next, macOS asks about the microphone.";
    - Continue makes `capsuleKind` "listening" and shows "I'm listening.";
    - another press ends at "All filed.".
  - "a denied microphone says where to allow it, and offers typing": with `microphone:denied` and a fake transcript, a press shows "Avanzel can't hear you yet.", "Open System Settings" and one button "Type it instead" (the Notice's). `capsuleKind` stays "hidden".
  - "testing, testing gets a warm answer, and Try again starts over":
    - with `AVANZEL_FAKE_TRANSCRIPT: "Testing, testing."`, press twice to get "Heard you. Want to try a real thought?", with one capture in the inbox;
    - "Try again" empties the inbox and `raw/audio/`, and the instruction shows again.
  - "File it anyway files a mic check": as above, "File it anyway" ends at "All filed.".
  - "while the ears are still arriving, a press says so and typing is the way" (Review Focus 3):
    - with no fake transcript and a "stall" hub, a press shows "My ears are still arriving. Type it instead, or talk to me once they land.";
    - `capsuleKind` is "hidden", and "Type it instead" is the primary button (`getByRole("button", { name: "Type it instead" })` has the primary variant's `data-variant="primary"`; read it as an attribute, not as a style).
  - "Esc while listening cancels, and setup asks again": with a fake transcript, a press, then `call(app, "cancelRecording")`, shows the instruction again with an empty inbox.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup`, `app`, `recording`, `permissions` and `agents`. Expected: all pass, with the recording and permissions tests unchanged.
- [ ] **Step 7:** Commit: `mac: the first spoken thought is asked for behind the microphone primer, and a mic check gets a warm answer`.

### Task 8: The first filing ends with its stamp, its pages and Undo

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (setup section: `undoSetupFiling`, `opensInObsidian`)
- Modify: `apps/mac/src/renderer/setup/copy.ts`, `apps/mac/src/renderer/setup/steps/Filing.tsx`
- Test: `apps/mac/test/setup-copy.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `SetupFiling` and `receiptPages` (both Task 6: `receiptPages` and its unit test moved there), `librarian().undo`, `recentFromLog`, `obsidianUrl`, `obsidianInstalled()`; opening a page through `window.avanzel.ask.openPage(name)`, where `name` is the page's file name without `.md`.
- Produces:
  - `SetupFiling` gains `{ kind: "undone"; words: string }`, and `filed` gains `undoRefused: boolean`.
  - `SetupSnapshot.opensInObsidian: boolean`: Obsidian is installed and `obsidianUrl(root, "")` isn't null.
  - Bridge `setup.undo(): void` (`setup:undo`); controller `undoSetupFiling(): Promise<void>`. It enqueues `undo([commit])`; one undone gives `undone`, otherwise `filed` with `undoRefused: true`. Either way it refreshes `recent`.
  - `pagesLine(created: number, updated: number, where: string): string | null`: the filed footnote of the copy table; null when both are 0.

Behaviour:
- **Filing, filed:**
  - the card's `stamp` is `{ word: "filed", date: stampDate(now), animate: true }`;
  - each shelf tab's `count` is how many filed pages are on it;
  - in order: the heading, Zel's line (only with pages), the pages line or the log line, the others line, the restored line, the Undo line (only with `canUndo`), the `Receipt`, and `Actions` of "Undo" (only with `canUndo`) and "Open in Obsidian" or "Open the page" (the first page);
  - ⌘Z (a `keydown` with `metaKey` and "z", its default prevented) undoes while `canUndo`;
  - `undoRefused` shows its Notice, and "Undo" goes away;
  - "Continue" goes to "ask" when the filing has pages, and to "done" otherwise.
- **Filing, undone:** its copy, and "File it again" calls `fileAgain` (Task 6's `fileSetupAgain()` runs after undone too); "Continue" goes to "done".
- Filing has no Back in any state (Back is on Found and Think only).

- [ ] **Step 1: Write the failing unit test** in setup-copy.test.ts (Review Focus 5; the `receiptPages` test is Task 6's now):
  - "pagesLine says what the filing wrote", with `where` "~/Avanzel": (1, 0) gives "1 new page, all plain Markdown in ~/Avanzel."; (3, 1) gives "3 new pages and 1 updated, all plain Markdown in ~/Avanzel."; (0, 1) gives "1 updated page, all plain Markdown in ~/Avanzel."; (0, 2) gives "2 updated pages, all plain Markdown in ~/Avanzel."; (0, 0) gives null.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests** (typed thoughts, `filingClaude()`):
  - "a filed thought shows its stamp, its page and how to undo it, and Undo puts everything back":
    - "Plant tulips in October" shows "Your first idea has a home.", "1 new page, all plain Markdown in ~/Avanzel.", "Press ⌘Z or Undo to put everything back.", the receipt row "Plant tulips in October" and "Ideas", the image `/^Filed, /`, and the button "Open the page";
    - "Undo" shows "Undone.", with the inbox holding one capture and `ideas/` empty;
    - "File it again" ends at "All filed.".
  - "⌘Z undoes it too": `setup.keyboard.press("Meta+z")` shows "Undone.".
  - "a filing that changed the words says they are kept": `FAKE_AGENT_MODE: "tamper"` shows "Your exact words are kept.".
  - "Continue goes to Ask after a filing, and to the end after an undo": in one launch, "Continue" after "All filed." makes `call(app, "setupStepForTests")` "ask". In a second launch, "Undo", then "Continue", makes it "done". Those steps get their bodies in Tasks 9 and 10.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the `setup` e2e spec. Expected: all pass.
- [ ] **Step 7:** Commit: `mac: the first filing ends with its stamp, its pages and Undo`.

### Task 9: Setup asks a question about the new pages and shows the pages the answer used

**Files:**
- Modify: `apps/mac/src/main/setup-model.ts` (`suggestQuestion`, `answerSources`)
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`ask` at ~1190 is split around a new private `answerQuestion`; setup section)
- Create: `apps/mac/src/renderer/setup/steps/Ask.tsx`, and `apps/mac/src/shared/wikilinks.ts` (the wikilink pattern, moved out of `apps/mac/src/renderer/ask/main.tsx:20`)
- Modify: `apps/mac/src/renderer/setup/main.tsx` (the step switch shows Ask), `apps/mac/src/renderer/ask/main.tsx` (imports the pattern from `shared/wikilinks.ts`)
- Test: `apps/mac/test/setup-model.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `librarian().ask(question, { save: false, signal, progress })`, `withRun`, `findPage`, `pageInfo`, `WAITING`, `errorLine`, `lastLines`.
- Produces:
  ```ts
  export type SetupAnswer =
    | { kind: "asking"; question: string; startedAt: number; waiting: boolean }
    | { kind: "answered"; question: string; paragraphs: string[]; sources: FiledPage[] }
    | { kind: "failed"; question: string; agent: string; line: string };
  ```
  - `SetupSnapshot` gains `suggestion: string | null` (`suggestQuestion` of the filed pages) and `answer: SetupAnswer | null`.
  - Bridge:
    - `setup.ask(question: string): Promise<SetupSnapshot>` (`setup:ask`);
    - `setup.skipAsk(): void` (`setup:skip-ask`).
  - Controller:
    - `askInSetup(question: string): Promise<SetupSnapshot>` (one question at a time);
    - `skipSetupAsk(): void` aborts it and clears `answer`;
    - `SetupSession` gains `answer` and `askAbort`; `endSetup` aborts too.
    - Private `answerQuestion(question: string, abort: AbortController, progress: (message: string) => void): Promise<{ ok: boolean; ran: boolean; text: string; agent: string; seconds: number }>`. `ran` says whether the agent ran to the end of its run: true for an answer and for a failed run, false when an error was thrown instead. `text` is the answer, or on a failed run the agent's last lines (`lastLines(stderr || output)`), or on a thrown error the error's message. `ask()` keeps its `AskResult` exactly as today: only a failed run (`ran` and not `ok`) gets "{agent} couldn't answer:\n" in front of `text`, and a thrown error's message comes back bare.
  - `WIKILINK` (shared/wikilinks.ts): the pattern of `[[name]]`, `[[name|label]]` and `[[name#heading|label]]`, moved as it is from `renderer/ask/main.tsx:20`, which now imports it. Its groups are the name and the label.
  - `suggestQuestion(pages: readonly FiledPage[]): string | null`: the first `people` page gives "What am I doing with {title}?"; otherwise the first page gives "What did I say about {title}?"; none gives null.
  - `answerSources(answer: string): { paragraphs: string[]; names: string[] }`:
    - `[[name]]`, `[[name|label]]` and `[[name#heading|label]]` become the label or the name; the pattern is `WIKILINK`, so the regex exists once;
    - `names` are the link names in order, without repeats;
    - `paragraphs` are the non-empty trimmed lines, without leading `#`s and without `**`.

Behaviour:
- `askInSetup()` maps the result: on success `answered`, with each name turned into a page by `findPage` and `pageInfo` (names that find none are dropped); on failure `failed` with `line = errorLine(text)`. A result after Skip, or after the window has closed, is dropped.
- **Ask:**
  - the stage: a `Card` labelled "Question" holding the question asked, or the suggestion; Zel `thinking` while asking, `idle` otherwise;
  - the panel: the suggestion as a secondary `Button`, which asks it; the `TextField`, which asks on Return; the asking line, ticking every 250 ms; the answer; and "Pages I used:" with a `Row` per source: a `ShelfTag` (shelf pages only) beside a `Button variant="link"` with the title, which opens it;
  - "Skip" calls `skipAsk` and goes to "done"; "Continue" goes to "done"; there is no Back (Back is on Found and Think only).

- [ ] **Step 1: Write the failing unit tests** (Review Focus 5 for `suggestQuestion`):
  - "suggestQuestion asks about a person first": `[ideas "Indie game dev podcast", people "Mark"]` gives "What am I doing with Mark?".
  - "suggestQuestion falls back to the first page": `[projects "Launch plan"]` gives "What did I say about Launch plan?"; `[]` gives null.
  - "answerSources turns links into words and keeps their names": "You want [[Mark]] to co-host [[indie-game-dev-podcast|your podcast]].\n\n**Next:** fix the hum. [[Mark]]" gives paragraphs `["You want Mark to co-host your podcast.", "Next: fix the hum. Mark"]` and names `["Mark", "indie-game-dev-podcast"]`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests** (typed "Plant tulips in October", then Continue):
  - "Ask suggests a question about the new page and answers it": the button "What did I say about Plant tulips in October?" shows "Q: What did I say about Plant tulips in October?" and a "Continue" button.
  - "an answer's links become the pages it used": the filed page's name is `filesUnder(lib, "ideas")[0]` without `.md`. Asking "What is in [[<name>]]?" in "Ask your library" with Return shows "Pages I used:", the text "Ideas" and a button "Plant tulips in October".
  - "a slow answer shows the time and can be skipped": with `FAKE_AGENT_DELAY_MS: "20000"` and `FAKE_AGENT_DELAY_TASK: "ask"`, the suggestion shows `/^Looking through your library: \d+ s$/`. "Skip" makes `call(app, "setupStepForTests")` "done", and `call(app, "busy")` turns false within 10 s.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup` and `app` (its three Ask tests unchanged). Expected: all pass.
- [ ] **Step 7:** Commit: `mac: setup asks a question about the new pages and shows the pages the answer used`.

### Task 10: Setup ends with the login and evening review switches, and Start using Avanzel

**Files:**
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`changeApp` at ~1339; setup section)
- Modify: `apps/mac/src/renderer/setup/copy.ts` (`reviewLabel`), `apps/mac/src/renderer/setup/main.tsx` (the step switch shows Done); create `apps/mac/src/renderer/setup/steps/Done.tsx`
- Modify: `apps/mac/e2e/helpers.ts` (`toDone`)
- Test: `apps/mac/test/setup-copy.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `changeApp`, `snapshot().tasks`, and through the renderer `window.avanzel.settings.setApp({ launchAtLogin })` and `window.avanzel.settings.saveTask({ id, name, schedule, agent, enabled, instructions })`. Both broadcast, so `setup:changed` follows.
- Produces:
  - `SetupSnapshot` gains `launchAtLogin: boolean` and `eveningReview: TaskInfo | null`, the task whose `kind` is "evening-review".
  - Bridge `setup.finish(): void` (`setup:finish`); controller `finishSetup(): Promise<void>`. In this task it closes the window; Task 12 adds the flight and the bubble.
  - `SetupSession.doneEntered: boolean`.
  - `reviewLabel(schedule: string): string`: "daily 21:00" gives "Review my inbox every day at 21:00", and "weekly sun 18:00" gives "Review my inbox every Sunday at 18:00".
  - e2e helper `toDone(app): Promise<Page>`, exported from `helpers.ts` so other specs can use it: `throughFound`, a typed thought (`typeFirstThought`), Continue, Skip, then the heading "You're all set.".

Behaviour:
- `changeApp` calls `app.setLoginItemSettings` only without `AVANZEL_TEST=1`; the setting itself is still saved.
- `enterSetupStep("done")`, the first time in a session, turns on launch at login (`changeApp({ launchAtLogin: true })`), so the switch shows the spec's default.
- **Done:**
  - its copy, with `Zel mood="idle"` on the stage;
  - a `Group` of the two `Switch`es: login reads `launchAtLogin`, and the evening one reads `eveningReview.enabled` and isn't there without the task;
  - "Start using Avanzel" calls `finish`; the footer has no Back (Back is on Found and Think only).

- [ ] **Step 1: Write the failing unit test:** "reviewLabel says when the review runs", with both cases above.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests:**
  - "the last step turns on opening at login, and both switches apply at once":
    - after `toDone`, `snapshot().app.launchAtLogin` is true and the switch "Open Avanzel when I log in" has `aria-checked="true"`; clicking it makes the setting false;
    - clicking "Review my inbox every day at 21:00" makes `read(lib, "tasks/evening-review.md")` contain "enabled: false".
  - "Start using Avanzel closes the window, and the menu bar is where Avanzel lives": after `toDone`, the click turns `shown(app, "setup")` false within 5 s, and `menuForTests()` holds "Record a thought".
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the e2e specs `setup`, `shortcuts` and `app`. Expected: all pass.
- [ ] **Step 7:** Commit: `mac: setup ends with the login and evening review switches, and Start using Avanzel`.

### Task 11: Setup notes its milestones on this Mac, for §5.4's measures

Nothing is reported anywhere. The file gives the owner "time from first launch to first filed thought" and "people who finish setup" from a test Mac. The other §5.4 measures come from the library's `log.md` and git history.

**Files:**
- Modify: `apps/mac/src/main/store.ts` (new `writeJsonAtomic`, which `SettingsStore.update` and `NoticedShortcuts.save` call; new `FirstRunLog`)
- Modify: `apps/mac/src/main/run-state.ts` (`RunStateStore.set` calls `writeJsonAtomic`)
- Modify: `apps/mac/src/main/controller.ts` (the constructor, `start`, `enterSetupStep`, the setup filing's `filed`, `undoSetupFiling`, `finishSetup`, `endSetup`)
- Test: `apps/mac/test/store.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Produces (store.ts):
  ```ts
  /** When a first run reached each milestone, kept with the app (userData/first-run.json) and never sent anywhere. */
  export interface FirstRun {
    version: 1;
    firstLaunchAt: string | null;
    /** When each setup step was first on screen. */
    steps: Partial<Record<SetupStep, string>>;
    firstFiledAt: string | null;
    /** Undo was used in setup. */
    undone: boolean;
    finishedAt: string | null;
    /** The step on screen the last time the window was closed without Start using Avanzel. */
    closedOn: SetupStep | null;
  }
  export class FirstRunLog {
    constructor(file: string);
    get(): FirstRun;
    launched(now: Date): void;
    entered(step: SetupStep, now: Date): void;
    filed(now: Date): void;
    undid(): void;
    finished(now: Date): void;
    closed(step: SetupStep): void;
  }
  ```
  Times are ISO strings. `launched`, `entered` (per step), `filed` and `finished` keep the first time only. A missing or broken file reads as all-null. Writes go through `writeJsonAtomic`.
- Produces (store.ts): `writeJsonAtomic(file: string, value: unknown): void`: makes the file's folder, writes `JSON.stringify(value, null, 2)` and a newline to `<file>.tmp`, and renames it over `file`. `SettingsStore.update`, `NoticedShortcuts.save` and `RunStateStore.set` each repeat these lines now; they call it instead, and so does `FirstRunLog`.

Behaviour:
- `SetupSession` gains `finished: boolean`, which `finishSetup()` sets first.
- The controller keeps a `FirstRunLog` at `userData/first-run.json`, and notes:
  - `launched` on every `start()`;
  - `entered("hello")` when `showSetup()` starts a session (the renderer starts there without calling `enter`), and `entered(step)` in `enterSetupStep`;
  - `filed` when a setup filing first reaches `filed`;
  - `undid` in `undoSetupFiling`;
  - `finished` in `finishSetup`;
  - `closed(step)` in `endSetup` unless setup finished.

- [ ] **Step 1: Write the failing unit tests** in store.test.ts:
  - "FirstRunLog keeps the first time of each milestone": `launched` twice keeps the first time; `entered("found")` twice keeps the first; `filed` then `finished` are set.
  - "FirstRunLog reads a broken file as a fresh one": garbage in the file gives `firstLaunchAt` null and `steps` `{}`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e test:** "a finished setup leaves its milestones in first-run.json". With its own `AVANZEL_USER_DATA`, `toDone` and "Start using Avanzel", the file's `steps` has hello, found, think, filing, ask and done. `firstFiledAt` and `finishedAt` are set, and `closedOn` is null.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the `setup` e2e spec. Expected: all pass.
- [ ] **Step 7:** Commit: `mac: setup notes when each first-run milestone was reached, on this Mac only`.

### Task 12: The setup window flies into the menu bar, and Zel says it's up there

The flight: the window hides its content, and its frame (`setBounds(target, true)`, macOS's own animation) shrinks onto a 24 px square on the menu bar icon, for `FLIGHT_MS`, then closes. That is the spec's moment, honestly: a blank paper window going into the icon. The content isn't drawn shrinking, because Electron can't scale a page without re-laying it out. Under Reduce Motion, or when the icon has no bounds (macOS lets people hide it), the window just closes, and with no bounds there is no bubble either: there is nothing to point at, and Spotlight or Finder reopens setup or Settings (Task 1's `activate`).

The bubble gets its own small window, because the end of setup is when the person learns where the app lives (§5.3), and `Bubble` needs no new component. Like Quick, it takes focus, and a click elsewhere, Esc or Not now puts it away. It never comes back by itself.

**Files:**
- Modify: `apps/mac/src/main/setup-model.ts` (`flightTarget`, `upHerePlace`)
- Modify: `apps/mac/src/main/tray.ts` (`MenuBar.bounds`), `apps/mac/src/main/windows.ts` (`createUpHereWindow`)
- Modify: `apps/mac/src/shared/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/main/ipc.ts`
- Modify: `apps/mac/src/main/controller.ts` (`finishSetup`; new `tryItNow`, `closeUpHere`)
- Create: `apps/mac/src/renderer/up-here/index.html`, `main.tsx`, `styles.css`
- Modify: `apps/mac/src/renderer/setup/main.tsx` (hides the content when finishing), `apps/mac/src/renderer/setup/steps/Done.tsx` (where Start using Avanzel calls `finish`), `apps/mac/src/renderer/setup/styles.css`
- Test: `apps/mac/test/setup-model.test.ts`, `apps/mac/e2e/setup.spec.ts`

**Interfaces:**
- Produces (setup-model.ts):
  - `interface Box { x: number; y: number; width: number; height: number }`;
  - `flightTarget(tray: Box): Box | null`: a 24 × 24 square centred on the icon, rounded; null when the icon's width or height is 0;
  - `upHerePlace(tray: Box, work: Box, size: { width: number; height: number }): { x: number; y: number }`. The tail's tip, 42 px in from the window's right edge, sits under the icon's centre, at `y = max(work.y, tray.y + tray.height)`; the window is then clamped into `work`.
- Produces:
  - `MenuBar.bounds(): Electron.Rectangle`: `tray.getBounds()`, or with `AVANZEL_TEST=1` and `AVANZEL_FAKE_TRAY_BOUNDS` set ("x,y,width,height"), those;
  - `UP_HERE_SIZE = { width: 320, height: 200 }`;
  - `createUpHereWindow(): BrowserWindow`: `UP_HERE_SIZE`, title "Avanzel", frameless, transparent, no shadow, not resizable, `alwaysOnTop`, `skipTaskbar`, `type: "panel"`, visible on all workspaces, `show: false`; it loads `pagePath("up-here")`;
  - `FLIGHT_MS = 700` (the drawer duration).
  - Bridge `upHere`:
    - `tryIt(): void` (`up-here:try-it`);
    - `close(): void` (`up-here:close`).
  - Controller:
    - `tryItNow(): void`: closes the bubble, then `toggleDictate()`;
    - `closeUpHere(): void`.
- The up-here renderer:
  - imports `@avanzel/ui/base.css` and sets `<html data-backdrop="clear">`;
  - arranges the `Bubble` (tail "top-end") at the window's top right with `var(--av-space-8)` and `var(--av-space-16)` padding;
  - reads the shortcut from `window.avanzel.settings.get()`;
  - Esc calls `close`.

Behaviour of `finishSetup()`:
- The renderer marks its root `data-leaving`, which its CSS turns into `visibility: hidden`, and calls `finish`.
- Main takes `flightTarget(menuBar.bounds())`.
  - With a target and without Reduce Motion: `setWindowButtonVisibility(false)`, `setBounds(target, true)`, then a wait of `FLIGHT_MS`.
  - Then it closes the window. With a target, it opens the bubble at `upHerePlace` on the display matching the icon (`screen.getDisplayMatching`): `app.focus({ steal: true })`, then `show` and `focus`, with `blur` closing it.

- [ ] **Step 1: Write the failing unit tests:**
  - "flightTarget centres a 24 px square on the icon, and has none without one": `{ x: 1000, y: 2, width: 30, height: 22 }` gives `{ x: 1003, y: 1, width: 24, height: 24 }`; a zero box gives null.
  - "upHerePlace puts the tail under the icon and keeps the bubble on the display": tray `{ x: 1000, y: 0, width: 24, height: 24 }`, work `{ x: 0, y: 25, width: 1440, height: 875 }` and size 320 × 200 give `{ x: 734, y: 25 }`; tray `{ x: 1420, y: 0, width: 20, height: 24 }` gives `x: 1120`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`. Expected: fail.
- [ ] **Step 3: Write the failing e2e tests** (`toDone`, with `AVANZEL_FAKE_AUDIO`, `AVANZEL_FAKE_TRANSCRIPT` and `AVANZEL_FAKE_TRAY_BOUNDS: "1000,0,24,24"` set):
  - "Start using Avanzel flies the window to the menu bar, Zel says it's up there, and Try it now records":
    - after the click, `shown(app, "setup")` turns false within 5 s;
    - `windowFor(app, "up-here")` shows "I'm up here." and the text "⌥Space";
    - "Try it now" makes `capsuleKind` "listening" and `shown(app, "up-here")` false; then `cancelRecording`.
  - "Not now and Esc put the bubble away": with Not now, then on a second launch with Esc pressed in the bubble, `shown(app, "up-here")` turns false.
- [ ] **Step 4:** Build and run. Expected: fail.
- [ ] **Step 5: Implement.** Then try it by hand once, in the test environment only, so no real agent runs and nothing downloads, and keeping clear of the owner's own library and CLI config:
  - from `apps/mac`, run `npm run build`; then set `bin` to a new folder of executable `claude` and `codex` scripts that answer as `agentStubs()`'s do (signed in, and "ready" to anything else), and `electron` to `$(node -p 'require("electron")')`, since the narrowed PATH below has no `node` or `npm`;
  - still in `apps/mac`, run `env -u ELECTRON_RUN_AS_NODE AVANZEL_TEST=1 AVANZEL_EXACT_PATH=1 AVANZEL_MODELS_URL=http://127.0.0.1:9 AVANZEL_USER_DATA=$(mktemp -d) XDG_CONFIG_HOME=$(mktemp -d) PATH="$bin:/usr/bin:/bin:/usr/sbin:/sbin" "$electron" .`, so there is no library, nothing is remembered in `~/.config`, the speech download fails at once, and the only agents are the stand-ins;
  - pick a temp folder with Change…, and finish setup;
  - watch the window go to the icon, with the bubble under it. With Reduce Motion on, the window just closes;
  - a run with the owner's real agent and the real download is the owner's to do: Task 14's report lists it.
- [ ] **Step 6:** Run `npm test -w @avanzel/mac`, `npm run typecheck`, `npm run design:check`, and the `setup` e2e spec. Expected: all pass.
- [ ] **Step 7:** Commit: `mac: the setup window flies into the menu bar, and Zel says it's up there`.

### Task 13: Every setup step reads in light and dark, and the README tells the first run

**Files:**
- Modify: `apps/mac/e2e/contrast.spec.ts` (a new test; reuse `readable` and `desktops`)
- Modify: `README.md:53-80` (Good to know), `README.md:93-99` (first launch)

- [ ] **Step 1: Write the test** "every setup step and the bubble are readable in light and dark" (timeout 240 s). Use `firstRun({ claude: filingClaude() })` with `AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space"`, so step 3 shows its Notice, and `AVANZEL_FAKE_TRAY_BOUNDS: "1000,0,24,24"`, so the bubble opens. The walk can use `throughFound`, `typeFirstThought` and `toDone`, which Tasks 3, 6 and 10 export from `helpers.ts`.
  - Read each surface with `readable(app, page, "Setup › …", desktops)`:
    - Hello (its stamp landed);
    - Found (both "Signed in");
    - Think (the taken Notice);
    - Think, typing;
    - Filing, filed;
    - Ask, answered;
    - Done;
    - the bubble.
  - Expect `found` to equal `[]`.
- [ ] **Step 2:** Run `npm test -w @avanzel/mac`, `npm run typecheck` and `npm run design:check`, then build and run the e2e specs `contrast` and `setup`. Expected: all pass. A failure here is a component's contrast or a wrong tone chosen in a step: fix the step's variant or tone, never by painting in the window.
- [ ] **Step 3: Update the README.**
  - Lines 93–99's first two sentences become:
    - On first launch, a setup window walks you through six short steps with no visit to Settings.
    - **Set me up** starts downloading both speech models (Parakeet and the Silero VAD, 673 MB together; an existing Hugging Face cache copy is reused) and reads your agents' sign-in.
    - **Looks good** makes the library (`~/Avanzel` by default; an existing folder or v0.1 library works as is) with the agent you chose.
    - Then you press ⌥Space and say your first thought, or type it while the model downloads.
    - Then you watch your agent file it, ask a question about it, and finish in the menu bar.
  - "macOS asks for the microphone the first time you dictate" becomes: "macOS asks for the microphone at your first press in setup, after one screen that says why."
  - Good to know gains:
    - Setup checks that ⌥Space really reaches Avanzel. When another app holds it, or no press arrives within 3 s, it names the likely app and offers two free shortcuts.
    - Agents without a sign-in command are asked one short question only when you pick them.
    - Setup keeps the times of its milestones in `first-run.json` in Avanzel's own folder, on this Mac only.
- [ ] **Step 4:** Commit: `mac: every setup step reads in light and dark, and the README tells the first run`.

### Task 14: The whole branch, checked

- [ ] **Step 1:** From the worktree root, run `npm test`, `npm run typecheck`, `npm run design:check` and `npm run ui:e2e`. Then, from `apps/mac`, run the whole e2e suite (`env -u ELECTRON_RUN_AS_NODE npm run e2e`). Expected: all pass, except the known flakes, which fail on `main` too. The gallery screenshots are unchanged, since `packages/ui` wasn't touched.
- [ ] **Step 2:** Run the `design-reviewer` agent on the branch's window changes (`apps/mac/src/renderer/setup/**`, `apps/mac/src/renderer/up-here/**`) and fix what it reports against DESIGN.md.
- [ ] **Step 3:** Commit the fixes from Steps 1 and 2, if there are any, as one commit with a subject in the Process form (`area: a sentence saying what now happens`).
- [ ] **Step 4:** Report:
  - the components each step used;
  - that no gallery section changed;
  - the owner items above, each with the stand-in now in the window;
  - that a run through setup with the owner's real agent and the real 673 MB download hasn't been done (Task 12's run by hand used the test environment), so it is the owner's to try once.
