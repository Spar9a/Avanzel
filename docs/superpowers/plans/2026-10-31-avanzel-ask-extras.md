# 2b, Ask's extras: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask opens with up to three suggested questions about the pages filed last. An answer can be saved as a page, with an Undo of its own. ⌥Space, pressed while Ask is the window in front, puts a spoken question in Ask's field.

**Architecture:**
- **Suggestions** are templates, with no agent run. They use setup's two sentences, one per page of the menu's "Recently filed" (the controller's `recent`), made by `suggestQuestions` beside setup's `suggestQuestion`. The window reads them over `ask:suggestions` when it opens and on each focus, as it reads its page count, and shows them only before the first question.
- **Save as a page** is the engine's save run, told the answer the person saw (`Librarian.ask(question, { save: true, answer })`, through a new `${shown}` slot in the ask prompt). Its outcome now carries its commit (`AgentOutcome.commit`). Main's `saveAnswer` runs it in the window's one run slot and answers a `SaveResult`. The turn shows its line and its ending, and an Undo that takes the commit back through 2a's `revertFiling`, in the library it was saved in. A save clears the menu's "Undo the last filing" as it starts, and again as it ends if it committed.
- **⌥Space into Ask.** `pressDictate`, while Ask is the key window and nothing records, starts a recording flagged `forAsk`. The capsule and the transcription are a thought's, but the words are never written to the library: main pushes them to the Ask page (`ask:heard`), which adds them to the field. A hint under the field names the shortcut (`ask:dictate-shortcut`).

**Tech Stack:** Electron 44, TypeScript, React 19 renderers on `@avanzel/ui`, `@avanzel/engine` (prompts, git), Vitest, Playwright for Electron.

**Spec:** `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md` (in the main checkout, untracked):
- §6.4, lines 357–362, "Ask": three suggested questions built from recent pages; the reading face and source chips by shelf; "Save as a page"; ⌥Space dictates a question while Ask is open.
- §5 step 5, line 261 (setup's one suggested question, built); §7, line 563 (Ask's empty-library line, built); §11, line 697 ("Ask. Suggested questions, source chips and "Save as a page".").
- Its line numbers into the code are stale: `librarian.ts:354-381` is now `librarian.ts:436-464` (`ask`).

Where this plan sits:
- Phase 1 is complete on main, and 2a, "Undo that lasts", is merged (dba4d32). 2b builds the spec's Ask items (§6.4, §11) and needs no owner decision.
- It is on branch `ask-extras`, from main at `dba4d32`, in the worktree `.claude/worktrees/design-system`.
- It runs under the owner's /goal "keep working on our tasks", by subagent-driven development: a fresh implementer per task, a task review, and a final whole-branch review. As with 1c, 1d and 2a, the plan doesn't wait for the owner's review; they read it in the flight pack.
- The groundwork is `/tmp/avz-ds/2b-groundwork.md`, a read-only survey at `dba4d32`. Every `file:line` below is that commit's, checked against the code. `ctl` is `apps/mac/src/main/controller.ts`, and `lib` is `packages/engine/src/core/librarian.ts`.
- **Anchors that move.** A task that edits a file an earlier task has edited finds each anchor by the text named with it: a test by its title, a method by its name, a line by its words.
- **Order.** Task 3 needs Task 1, and Task 4 needs Task 3. Tasks 2 and 5 stand alone. Task 6 is last.

## The controller's decisions (binding, as written)

**D1. Scope.**
- **In:** three suggested questions in Ask, built from recent pages; "Save as a page" on an answer, with its own Undo; ⌥Space dictates a question into Ask's field while Ask is the focused window.
- **Out**, each named under "Not in 2b" with its reason: answers in the "reading face"; one clickable "People: Mark" chip per source; grouping sources under shelf headings; suggestions written by an agent; Ask's turns surviving a window close.

**D2. Suggested questions.**
- **Where they come from:** templates, with no agent run, from the open library's recent pages. These are the pages the menu's "Recently filed" shows (the controller's `recent`, at most 3, newest first, filings only: a page saved from Ask is not a filing and doesn't count, as today's tests pin).
- **One question per page,** de-duplicated, in that order. It uses setup's two templates (`suggestQuestion`, `setup-model.ts:181-186`): a page on the People shelf, `What am I doing with ${title}?`; any other page, `What did I say about “${title}”?`. Setup's own `suggestQuestion` keeps its behaviour. Add a sibling that makes the list, and test both.
- **Where they show:** in Ask's empty state only (no turns yet), under its existing line. They are read when the window opens and on each focus, as the page count is.
  - Each is setup's pattern (`setup/steps/Ask.tsx:62-83`): the question as a `Text variant="callout"` sentence beside a secondary small `Button`, "Ask this", in a `role="group"` named by the sentence. A `Button` can't wrap or hold a question as its label.
  - "Ask this" asks that question exactly as Return asks a typed one.
  - With no recent pages, there are no suggestions, and the empty line stays as it is.
- **The way in:** a new invoke channel, beside `ask:library-pages`, that returns the questions.

**D3. "Save as a page".**
- **What it runs:** the engine's save path, a write run that files the answer as a page the library's way (AGENTS.md: usually `topics/<slug>.md`, linked, in `index.md`, a `| ask |` log line, one commit). It is told the answer the person saw, so the page keeps those words, not a fresh answer. `Librarian.ask(question, { save: true, answer })`, or a sibling method if that reads better. `askPrompt` and its template get the shown answer in save mode. The read-only prompt is unchanged.
- **Its outcome carries its commit:** `AgentOutcome` gains `commit: string | null`, the save's commit, or the leftovers commit of a save that wrote no page or failed. Both commits exist today and their SHAs are dropped (`lib:454`, `:456`).
- **Where it's offered:** on the newest turn only, once it is answered well (as "Ask again" is on the newest failed turn). One run at a time: no Save while a question runs, and no question while a save runs.
- **What the person sees:** while it runs, the turn's own status line, with Stop; after, a success line that names the page, with "Open" and "Undo"; a save that wrote no page, failed or was stopped says so honestly, with the edits it left kept as their own commit, as a filing says. A save is an explicit press, so it doesn't ask first.
- **Its Undo** takes the save's commit back through 2a's revert path (`revertFiling(commit, library)`, the `reverting` set, the library it was asked in). It is told once, in the turn. It lives in the window's turn, so closing the window ends it (the library's history keeps the commit).
- **The menu's "Undo the last filing"** is cleared when a save starts, as the weekly review clears it (`ctl:4072-4075`): the save commits after that filing, so its revert would be refused. "Show the last receipt" is untouched; its Undo hides with the record, as now.
- **Without git, or with `auto_commit` off,** a save keeps its page and offers no Undo, as a filing does.

**D4. ⌥Space dictates a question.**
- **Which presses:** the dictate shortcut's own press (`pressDictate`), only while the Ask window is the focused window. Otherwise ⌥Space records a thought, as today. The menu's "Record a thought" (`toggleDictate`) always records a thought. Setup's `takesPress()` keeps its precedence.
- **The flow:** the same recording, capsule and transcription as a thought, with the hint the capsule shows today. When the words arrive, they go into Ask's field (after whatever is typed there, with a space), and the field keeps the focus. The person presses Return to ask. A question leaves nothing in the library: no capture in the inbox, no kept audio, no `captureCount`, and no filing or evening-review path. A silent recording gets the existing "Nothing was heard." card. If the Ask window closed before the words arrive, they are dropped quietly. Stop on a slow transcription of a question stops it and keeps nothing.
- **What tells the person:** a short hint in Ask, with the dictate shortcut as `Kbd` from `prettyAccelerator(shortcuts.dictate)`. It follows a changed shortcut, and is absent when the shortcut isn't registered.

## Global Constraints

- **Windows arrange, `@avanzel/ui` paints.**
  - Build windows only from `@avanzel/ui` components: no raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`.
  - Window CSS only arranges, with spacing from `var(--av-space-N)`.
  - Components take no `className` or `style`.
  - Nothing in `packages/ui` changes. Where a part is missing, use the stand-in this plan names and list it as an owner item.
- **Interface work:** read `.claude/skills/avanzel-ui/SKILL.md` before editing anything under `apps/mac/src/renderer/` (the Skill tool doesn't know the project's skill inside a subagent).
- **Copy** is in sentence case, calm and plain: no "!", no "Oops", no emoji.
  - People are they/them, and an action keeps its name through the flow.
  - Never promise more than the app does.
- **2b's words, exactly** (`{…}` is filled in; `“ ”` are curly quotes):

  | Where | Words |
  |---|---|
  | A suggestion about a page on People / about any other page | What am I doing with {title}? / What did I say about “{title}”? |
  | A suggestion's button | Ask this |
  | The hint under the field, the shortcut as `Kbd` | Press {⌥Space} to say your question. |
  | The offer, on the newest answer | Save as a page |
  | The save's line as it runs; from 10 s, outside its status region | Saving the answer as a page… / Saving the answer as a page: {N} s |
  | While the library is busy (main's words, unchanged) | Waiting for Avanzel to finish with your library… |
  | Saved, then its buttons | Saved as “{title}” in {shelf's name, or the folder's}. / Undo, Open |
  | Undone | Undone. “{title}” is no longer in your library. |
  | Stopped | Stopped. {what it left} |
  | What a save that saved no page left (`unsavedLine`) | Your library hasn't changed. / {agent}'s partial edits are kept as their own commit in the library's history. / {agent}'s partial edits stay as they are, because nothing recorded them. |
  | A save with no page: the Notice's title | {agent} didn't save a page. |
  | A failed save, other / no agent installed (titles) | {agent} couldn't save the answer. / Avanzel needs an AI agent to save the answer. |
  | A failed save's sign-in body ends | …, then save again. |
  | The fix of a save that saved nothing | Save again |
  | A refused Undo (`undoRefused`, unchanged) | This one can't be undone automatically. / Usually a later change touched the same lines. The library's history keeps both versions. |
  | The save's prompt, after the question | The owner was shown this answer, and wants it kept as a page in its own words: |
  | The save's prompt, step 4 | 4. Then save the answer the owner was shown, above, as a page, keeping its words: usually `topics/<slug>.md`, (then as `SAVE`'s step 4) |

- **2b's values:** at most 3 suggestions (`recent`, `ctl:2022`); the save's line counts from `SLOW_SECONDS = 10` (setup/copy.ts:110); a question's recording under 0.3 s of samples has no words (`ctl:1572`); the commits are "avanzel: save answer to “{question, 60 code points}”", "avanzel: leftovers of an answer that was not saved" and "avanzel: undo save answer to “…”".
- **This machine's rules are binding:** `/tmp/avz-ds/2b-machine-rules.md`:
  - no real agent CLI; unset `ELECTRON_RUN_AS_NODE`; no bare `git stash`, no push, no merge; no `npm install`, `uninstall` or `ci` in the worktree;
  - edit interface files with the Edit and Write tools; write commit messages to a file under /tmp/avz-ds/ with the Write tool and commit with `-F`, since the design guard refuses "git … commit" phrasing in a Bash command;
  - work only in the worktree, with absolute paths, beginning each command with `cd /Users/aksimemor/git-reps/avanzel/.claude/worktrees/design-system`; never run anything in the main checkout;
  - run no e2e while `pgrep -x Avanzel` prints; wrap every e2e run in `caffeinate -i` (this Mac idle-sleeps after a minute); change no file while an e2e run goes; known flakes get one re-run;
  - tests give each launch its own user data, a library-switching test sets `XDG_CONFIG_HOME` to a new folder, and no test touches `~/Avanzel`, `~/.config/avanzel` or `~/Library/Application Support/Avanzel`.
- **Gates,** for every task: from the worktree root, `npm test -w @avanzel/mac`, `npm test -w @avanzel/engine` (Task 1), `npm run typecheck` and `npm run design:check` (the baseline stays `{}`). Then, from `apps/mac` and only if `pgrep -x Avanzel` prints nothing, `caffeinate -i npm run build`, then `caffeinate -i env -u ELECTRON_RUN_AS_NODE npx playwright test <the task's specs>`, one run at a time. If `pgrep` prints, report the e2e gate as pending with the exact specs.

## Owner items

These are stand-ins and choices for the owner. Each task names the ones it creates.

1. **Suggestions in setup's stand-in** (Task 2): a sentence beside "Ask this", since a `Button` can't wrap or hold a question (doc 3 A5). The prototype's violet suggestion pill (first-run.html:651) needs A5's wrapping Button or a chip in `packages/ui` (doc 3 A4). The questions say "I": they are the person's own questions, as setup's is, and come from main as data, so the `zel-says-i` rule never reads them.
2. **The save's ending is a line, not a Notice** (Task 3): "Saved as “Answer” in Topics." in the save's status region, with Undo and Open. The gallery's success Notice ("Filed in Ideas: Launch checklist.", Gallery.tsx:170) is the alternative.
3. **A save is a second run of the person's agent** (Task 3). It costs a run of their plan (10–60 s), and it asks nothing first (D3). Its page is what the agent writes: the prompt tells it the shown answer and asks it to keep those words, but can't make it.
4. **The hint's place and words** (Task 5): "Press ⌥Space to say your question." under the field, whenever the shortcut is registered.
5. **A stopped or failed save's edits have no Undo button** (Task 3). They are told as a filing tells them, kept as their own commit in the library's history.

**Not in 2b** (D1), each with its reason:
- Answers in the reading face: 1f ruled that DESIGN.md keeps the `words` faces for the person's own words, so an agent's answer stays in the interface face (`docs/superpowers/plans/2026-10-23-avanzel-one-product.md:60`). The owner may rule otherwise (doc 3 B6).
- One clickable "People: Mark" chip per source: it needs a new `packages/ui` part (doc 3 B5, A4). Today's pair, a `ShelfTag` and a link `Button`, stays: it already shows each source's shelf.
- Grouping sources under shelf headings: it would change the window's heading outline for no gain over a shelf on each source.
- Suggestions written by an agent: they would cost a run each time Ask opens.
- Ask's turns surviving a window close.

## Review Focus

1. **A question's words never become a thought.** On words, on silence, on a failed transcription, on Stop of a slow one, and with the window closed before they come: no capture in the inbox, no audio under raw/, no count, no filing, and no card but the silence's and the failure's. Task 5's tests.
2. **⌥Space is a question's only while Ask is the key window and nothing records.** Another app in front, the menu's Record a thought, and a press that stops a thought's recording keep today's behaviour; setup's first-thought step keeps its precedence by `pressDictate`'s order. Task 5's tests.
3. **No Undo of a filing a save has committed after.** The menu's "Undo the last filing" goes as a save starts, and again as it ends with a commit, also for a filing that ended while the save waited for the library. "Show the last receipt" stays. Task 3's tests.
4. **One run at a time in the window.** While a save runs, Return asks nothing and Save isn't offered. Stop and closing the window give the save up; what it left is kept as its own commit and, after Stop, said. Task 3's tests.
5. **A save's Undo is told once, in its turn, and only there.** It takes back that save's commit only, once, in the library it was saved in, whichever is open. A later commit on the same lines makes git refuse it, and the turn says so. No notification, no capsule card. Task 4's tests.

## Planner's calls (for the controller's ledger)

1. Six tasks, not five: the save's Undo is Task 4 — a reviewer can reject the Undo (its library, its one try, its telling) and approve the save, and each implementer's context stays small — one more review round.
2. `suggestQuestions` and setup's `suggestQuestion` build their sentences through one private `questionAbout(page)` — D2 asks for a sibling, and the wording keeps one home — none.
3. The window reads its suggestions and the hint's shortcut over two invoke channels, `ask:suggestions` and `ask:dictate-shortcut`, in the effect that counts the shelves — D2's way in, and the page count's pattern — two more round trips per focus.
4. The suggestions sit in their own left-aligned block under the centred line (`.ask-suggestions`), not inside it — in a centred block each question would be centred in its cell — a layout to move.
5. "Ask this" leaves what is typed in the field and gives the field the focus — setup's rule (Ask.tsx:32-33): a suggestion never takes away what the person is typing — words to clear by hand.
6. A suggestion's question is never shortened — it is `Text`, which wraps; only a `Button`'s title is cut (`sourceTitle`) — a long question takes three lines.
7. The save is told `AskResult.answer`, the reply the turn's lines were made from, not the lines — its `[[links]]` stay, so the page links what the answer used, in the same words — a page with links where the person saw plain words.
8. The shown answer enters at the template's blank line after the question (`${shown}`), and step 4 becomes `SAVE_SHOWN` only when there is one — the read-only prompt, and a save with no answer, stay byte for byte; `substitute` reads an inserted value once, so a `$` in an answer is safe — one more slot in the template.
9. `review()` returns its commit too — `AgentOutcome` is one type, and a null there would be untrue — none; nothing reads it yet.
10. `SaveResult` is three endings: `saved`, `unsaved` (no page, or a failure), `stopped` — each shows differently, and `unsaved` with no failure is a run that ended well with no page — none.
11. The saved page is the first one `filedPages` gives (new before changed) — the run also edits the pages it links from — a save that only changed pages names a changed one.
12. `ask:save` rejects, and `ask:undo-save` answers false, from any page but the Ask window's (`isPageOf`) — a write run and a revert act on the library, as `ask:cancel`'s rule — a rejected invoke logs a line in main.
13. A save takes the window's one run slot (`giveUpAsk`): Stop and closing the window give it up, as they give a question up — D3's one run at a time — a save given up by closing the window is told to nobody; its leftovers commit is in the library's history.
14. The menu's Undo is cleared again when a save ends with a commit — a filing that ended while the save waited for the library set it after the save began — none.
15. The save's line is "Saving the answer as a page…", from 10 s "…: N s" outside the status region, with main's own words while the library is busy — Ask's waiting-line rules (doc 4, 1f section, call 23) — words.
16. The save's ending is a line in the save's own status region, not a `Notice` — D3's "success line" — owner item 2.
17. A save that saved no page is a `Notice tone="error"` from `saveProblem`, whose fix is "Save again" — DESIGN's three-part problem, and "Save again" as "Ask again" — words.
18. The offer stands on the newest answered turn with words in its answer, while nothing runs and no save of it stands; it comes back after a Stop and after an Undo — D3's offer rule, read literally — the same answer saved twice, by two presses.
19. A refused Undo shows `undoRefused` as a Notice under the saved line, which keeps Open and offers no second Undo — 2a's one try, told once; setup's Filing step (Filing.tsx:183) — none.
20. The saved line keeps its Undo while the window is open, also under newer questions — D3: it lives in the window's turn — an Undo that git may refuse after a later commit, which the turn says.
21. The turn's Undo reverts only commits main handed that window (`savedAnswers`), once each, and the map empties as the window closes — the page can't name a commit of its own — none.
22. A question's recording is flagged `forAsk` on `Recording` and on `Transcribing`, like `forSetup`, not by a new `CapsuleMode` — the capsule draws it as a thought (D4), and `mode === "dictate"` gates `readyToListen` and the hint — none.
23. A question's audio is never written: its words are made from the samples in memory — D4's "no kept audio" — a question whose transcription fails can't be heard again.
24. Main pushes the words on `ask:heard` to the Ask window open when they arrive, and hides the capsule's transcribing card then — the field is where they show — a window closed and opened again meanwhile gets them.
25. The hint sits under the field, whenever the shortcut is registered, also while the speech model is on its way — every question can be dictated, and a press then says so in the capsule, as anywhere — owner item 4.
26. Tests that need Ask to be the key window replace its `isFocused` (`askIsKey`), as `watchBlur` replaces `blur` (capsule-helpers.ts:34-46) — on a locked Mac no window of the test app is key (filing.spec.ts:196-198) — a test can't see a real key press go astray.
27. The new e2e tests live in a new spec, `e2e/ask-extras.spec.ts`. No assertion in app.spec.ts changes; contrast.spec.ts's library gains one log line, so "Ask, empty" reads a suggestion — none.

---

### Task 1: The engine: a save keeps the answer the person saw, and hands out its commit

D3 (what it runs, its commit). Owner items: none.

**Files:**
- Modify `packages/engine/src/core/prompts.ts`: beside `READONLY` and `SAVE` (:7-11), `SAVE_SHOWN` and `SHOWN`; `askPrompt` (:42-48).
- Modify `packages/engine/templates/prompts/ask.md`: line 8, the blank line between `${question}` and "Answer from the library only:", becomes `${shown}`. The Python CLI's copy, `src/avanzel/templates/prompts/ask.md`, stays as it is.
- Modify `packages/engine/src/core/librarian.ts`: `AgentOutcome` (:86-91), `ask` (:436-464), `review` (:466-489).
- Test: `packages/engine/test/core/prompts.test.ts` (`describe("askPrompt")`, :44-62), `librarian-runs.test.ts` (`describe("ask")`, :195-242), `librarian-git.test.ts` (inside `describe.skipIf(!git.available())("with git", …)`, :19).

**Interfaces (produces):**
- **`askPrompt(question: string, { save, now, answer }: { save: boolean; now: Date; answer?: string }): string`.** With `save` and an `answer` that has words:
  - `shown` is `substitute(SHOWN, { answer: answer.trim() })`, where `SHOWN = "\nThe owner was shown this answer, and wants it kept as a page in its own words:\n\n${answer}\n"`;
  - step 4 is `SAVE_SHOWN`: "4. Then save the answer the owner was shown, above, as a page, keeping its words: usually `topics/<slug>.md`,\n   in the format AGENTS.md describes; link it from the pages it draws on, add it to index.md, and append one line\n   to log.md:\n   - ${now} | ask | ${question_line} → [[page-name]]", substituted as `SAVE` is.
  - Otherwise `shown` is "", and step 4 is `READONLY` or `SAVE` as now. `render` gets `{ question, mode, shown, ...times(now) }`.
  - The answer goes in only as a placeholder's value, never by concatenation: `substitute` inserts values in one pass and never reads them again (templates.ts:20-33), but a `$` in a template's own text is a placeholder or an error, and an answer may hold "$5".
- **`Librarian.ask(question, { save?, answer?, signal?, progress? })`** passes `answer` to `askPrompt`. Nothing else changes.
- **`AgentOutcome.commit: string | null`**: "The run's commit: a saved answer's or a review's, or the leftovers of a save or a review that didn't end well. Null for a read-only ask, without git, with auto_commit off, or when the run changed nothing." `ask` returns the commit `#commit` gives at `lib:454` or `:456` (null for read-only); `review` returns its `:483` or `:485` commit.
- The fake agent (fake-agent.mjs:387-395) needs no change. A save's prompt still holds "save the answer", so it writes `topics/answer.md` ("# Answer"). Its question on a save run now runs on through the shown answer (it cuts at "\n\nAnswer from the library only"), which only its own reply shows.

- [ ] **Step 1: Write the failing tests.**
  - **prompts.test.ts**, in `describe("askPrompt")`:
    - "a save is told the answer the owner was shown, word for word": with `const answer = "You want [[mark]] to co-host.\nIt costs $5 a month.";`, `askPrompt("What am I doing with Mark?", { save: true, now: NOW, answer: `  ${answer}\n` })` contains `"The owner asks:\nWhat am I doing with Mark?\n\nThe owner was shown this answer, and wants it kept as a page in its own words:\n\n" + answer + "\n\nAnswer from the library only:"`, contains "4. Then save the answer the owner was shown, above, as a page, keeping its words" and "- 2026-10-20 14:03 | ask | What am I doing with Mark? → [[", and not "Do not create, edit or delete any files.".
    - "the read-only prompt is unchanged, with or without an answer": `askPrompt("What are my goals?", { save: false, now: NOW })` equals the same call with `answer: "An answer."`, contains "The owner asks:\nWhat are my goals?\n\nAnswer from the library only:", and not "was shown".
    - "a save with no answer is as it was": `askPrompt("Summarize my ideas", { save: true, now: NOW })`, and the same with `answer: "  "`, contain "4. Then save the answer as a page, usually" and not "was shown".
  - **librarian-runs.test.ts**, `describe("ask")`:
    - "a save hands the agent the answer the owner was shown": `const runs = recordRuns();`, `await librarian.ask("Summarize my ideas", { save: true, answer: "You want a greenhouse." })`; `runs()[0]?.prompt` contains "You want a greenhouse.".
    - "files a saved answer and logs it" also expects `outcome.commit` to be null (this library has no git).
  - **librarian-git.test.ts**, in "with git" (`subjects()`, `head()`, `mode`, as its tests use them):
    - "a saved answer is one commit, which the outcome hands out, and Undo takes it back": `ask("Summarize my ideas", { save: true, answer: "You want a greenhouse." })`; `outcome.commit` is `head()`; `subjects()` is `["avanzel: save answer to “Summarize my ideas”", "avanzel: new library"]`; `librarian.undo([outcome.commit!])` is 1; `topics/answer.md` is gone and the log has no "| ask |" line.
    - "a save stopped part way hands out what it left as its own commit": `mode("slow-messy")` and an abort once `goals/half.md` exists, as "hands out a cancelled run's leftovers too" (:130) does; `outcome.result.ok` is false, `outcome.commit` is `head()`, and `subjects()[0]` is "avanzel: leftovers of an answer that was not saved".
    - "a read-only ask, and a save that changed nothing, hand out no commit": `(await librarian.ask("What are my goals?")).commit` is null; with `mode("fail")` a save's is null too, and `subjects()` is still `["avanzel: new library"]`.
    - "a review hands out its commit": `(await librarian.review()).commit` is `head()`.
- [ ] **Step 2: Run** `npx vitest run test/core/prompts.test.ts test/core/librarian-runs.test.ts test/core/librarian-git.test.ts` from `packages/engine`. Expected: the new tests fail (no shown answer; `commit` is undefined).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the gates. `npm test -w @avanzel/engine` (its "stops an agent that runs too long" is a known flake), `npm test -w @avanzel/mac`, `npm run typecheck`. No e2e: the app passes no answer yet, and its read-only prompt is unchanged.
- [ ] **Step 5: Commit** as `engine: a saved answer keeps the words the person saw, and hands out its commit`.

### Task 2: Suggested questions

D2. Owner item 1.

**Files:**
- Modify `apps/mac/src/main/setup-model.ts`: `suggestQuestions` beside `suggestQuestion` (:181-186).
- Modify `apps/mac/src/main/controller.ts`: `askSuggestions()` beside `libraryPages()` (:3141-3146).
- Modify `apps/mac/src/main/ipc.ts` (beside `ask:library-pages`, :66), `apps/mac/src/preload/index.ts` (:69) and `apps/mac/src/shared/ipc.ts` (the bridge's `ask`, :778-795).
- Modify `apps/mac/src/renderer/ask/main.tsx`: its state (:59-67), the effect that counts the shelves (:72-77) and the empty state (:129-132); and `styles.css` (after `.ask-empty`, :25-28).
- Test: `apps/mac/test/setup-model.test.ts` (`describe("the question setup suggests (Review Focus 5)")`, :202-211); create `apps/mac/e2e/ask-extras.spec.ts`; modify `apps/mac/e2e/contrast.spec.ts` (the library, :397-399).

**Interfaces (produces):**
- **`suggestQuestions(pages: readonly FiledPage[]): string[]`** in setup-model.ts: one question per page, in the pages' order, each once. A page whose `shelf` is "people" gets `What am I doing with ${title}?`, and any other `What did I say about “${title}”?`. Both functions make their sentence with one private `questionAbout(page: FiledPage): string`, and `suggestQuestion` keeps its behaviour.
- **`askSuggestions(): string[]`** on the controller: `suggestQuestions(this.recent)`. `recent` holds at most 3 pages, newest first, filings only (`recentFromLog` reads `| file |` lines, library-info.ts:118-139), so a page saved from Ask is never suggested.
- **`ask:suggestions`** (invoke) → `controller.askSuggestions()`; the bridge's `ask.suggestions(): Promise<string[]>`, documented beside `libraryPages`.
- **The window** reads the suggestions with its page count, when it opens and on each `focus`, in the one effect. Before the first question only, under the empty line, a block `.ask-suggestions` holds a `Stack gap={8}` of groups, each setup's pattern (Ask.tsx:66-81): `<div role="group" aria-labelledby={id}>`, a `Row gap={12} justify="between"`, the question as `<Text variant="callout" id={id}>` in a `div.ask-offer`, and `<Button size="small">Ask this</Button>`. "Ask this" calls the page's `ask(question)` and gives the field the focus; what is typed stays.
- **styles.css** (layout only): `.ask-suggestions { padding-top: var(--av-space-16); }` and `.ask-offer { flex: 1; min-width: 0; }` (as setup/styles.css:130-134).

- [ ] **Step 1: Write the failing tests.** Read `.claude/skills/avanzel-ui/SKILL.md` first.
  - **setup-model.test.ts** (its `page(shelf, title)`, :25):
    - "suggestQuestions asks one question about each page, in their order": `[page("ideas", "Plant tulips in October"), page("people", "Maya"), page("projects", "Launch plan")]` gives `["What did I say about “Plant tulips in October”?", "What am I doing with Maya?", "What did I say about “Launch plan”?"]`.
    - "suggestQuestions asks each question once, and none without pages": two People pages titled "Maya" (`people/maya.md`, `people/maya-2.md`) give `["What am I doing with Maya?"]`, and `[]` gives `[]`. The `suggestQuestion` tests stand.
  - **ask-extras.spec.ts**, new. Mirror app.spec.ts's Ask tests (`launch`, `call`, `windowFor`, `makeLibrary`, `snap` from helpers.ts), and copy menu-bar.spec.ts's `onDay` and `filedInto` (:859-871) into it:
    - "Ask suggests a question about each page filed last, newest first, and Ask this asks it". `filedInto` files `goals/run-a-marathon` ("Run a marathon"), `people/maya` ("Maya") and `ideas/tulips` ("Plant tulips in October"), a day apart in that order; and `topics/answer.md` ("# Answer") gets an ask line, `new Vault(library).appendLog("ask", "Summarize my ideas → [[answer]]")`. Open Ask:
      - "Answers come from your library only, with links to the pages they use." shows, over three groups;
      - their names in order (each group's `aria-labelledby` text) are `["What did I say about “Plant tulips in October”?", "What am I doing with Maya?", "What did I say about “Run a marathon”?"]`;
      - each group has one button, "Ask this", with `data-variant` "secondary" and `data-size` "small";
      - with "draft" in the field, "Ask this" in the "What am I doing with Maya?" group asks it: the heading "What am I doing with Maya?" and the fake's "Q: What am I doing with Maya?" show, no group is left, and the field still holds "draft" and is focused. `snap(ask, "9-ask-suggested")` before the click.
    - "with nothing filed, Ask suggests nothing, and its line is as it was": a library with `goals/run.md` and no log line shows the usual line and no group; one with no pages shows "Your shelves are empty. Say something first, then ask about it." and no group.
    - "a thought filed while Ask is open is suggested once Ask has the focus again": `launchOn(await makeLibrary())` (capsule-helpers.ts:284) and Ask open with no group; `filedFromTheCapsule(app)`, then a `focus` event in Ask (as app.spec.ts:460): the group "What did I say about “Plant tulips in October”?" shows.
    - "a long title wraps in the question, never in its button": an ideas page with a 120-character title. Its "Ask this" lies inside the window, `.ask-turns`' `scrollWidth` is no more than its `clientWidth`, and the question's `Text` is taller than its button.
  - **contrast.spec.ts:** after `goals/run-a-marathon.md` is written (:399), `new Vault(library).appendLog("file", "[[capture-run]] → [[run-a-marathon]]")`, with `Vault` imported from the engine as menu-bar.spec.ts:9 does. "Ask, empty" then reads the suggestion and its "Ask this".
- [ ] **Step 2: Run** `npx vitest run test/setup-model.test.ts` from `apps/mac`. Expected: it fails (`suggestQuestions` isn't exported).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/ask-extras.spec.ts e2e/app.spec.ts e2e/contrast.spec.ts e2e/setup-filed-ask.spec.ts` (setup's Ask uses `suggestQuestion`). Expected: they pass.
- [ ] **Step 5: Commit** as `mac: Ask suggests questions about the pages filed last`.

### Task 3: Save as a page

D3, except its Undo (Task 4). Owner items 2, 3 and 5.

**Files:**
- Modify `apps/mac/src/shared/ipc.ts`: `SaveResult` after `AskResult` (:651-675); the bridge's `ask` gets `save`, and `cancel`'s doc says it gives up a save too.
- Modify `apps/mac/src/shared/problems.ts`: `unsavedLine` and `saveProblem` beside `askProblem` (:219-250).
- Modify `apps/mac/src/main/controller.ts`: `leftBehind` (:271-274) takes `{ commit: string | null; changes: { empty: boolean } } | undefined`; `ask`'s progress closure (:3150-3156) moves to `private askProgress(win: BrowserWindow | null): (message: string) => void`; `saveAnswer` after `cancelAsk` (:3191-3193), whose doc names the save.
- Modify `apps/mac/src/main/ipc.ts` and `apps/mac/src/preload/index.ts` (beside `ask:ask`, :62 and :64).
- Modify `apps/mac/src/renderer/ask/main.tsx` (`Turn`, `busy`, `Failed`, each turn's `article`) and `copy.ts`.
- Test: `apps/mac/test/problems.test.ts`, `apps/mac/test/ask-copy.test.ts`, `apps/mac/e2e/ask-extras.spec.ts`.

**Interfaces:**
- **Consumes:** Task 1's `Librarian.ask(question, { save: true, answer, signal, progress })` and `AgentOutcome.commit`.
- **Produces:**
  - **`SaveResult`** in shared/ipc.ts, each case documented:
    ```ts
    export type SaveResult =
      | { kind: "saved"; page: FiledPage; commit: string | null }
      | { kind: "unsaved"; agent: string; failure: AgentFailure | null; partial: PartialEdits }
      | { kind: "stopped"; agent: string; partial: PartialEdits };
    ```
    `saved.commit` is the save's own, for Task 4's Undo: null without git or with automatic commits off. `unsaved` with no `failure` is a run that ended well and wrote no page.
  - **`unsavedLine(agent: string, partial: PartialEdits): string`** in problems.ts: for `null`, "Your library hasn't changed."; for "commit", `${agent}'s partial edits are kept as their own commit in the library's history.`; for "uncommitted", `leftoverEdits(agent)` (:132-134).
  - **`saveProblem(f: AgentFailure | null, agent: string, partial: PartialEdits, now: Date): AskProblem`.** Its safe sentence is `unsavedLine(agent, partial)`. With `f` null: `{ title: `${agent} didn't save a page.`, body: safe, terminal: false, settings: false }`. Otherwise askProblem's titles, bodies and offers, with three changes: "other" says `${f.agent} couldn't save the answer.`, "missing" says "Avanzel needs an AI agent to save the answer.", and a sign-in's body ends "then save again." `askProblem` and its tests don't change; both are made by one private function that takes the safe sentence and those three words.
  - **`saveAnswer(sender: WebContents, question: string, answer: string): Promise<SaveResult>`** on the controller:
    - It throws `new Error("Only the Ask window saves an answer.")` unless `isPageOf(sender, this.askWindow)`. Nothing runs.
    - It calls `this.clearLastFiled()` before the run (D3).
    - It runs as `ask` runs a question: the window taken as it starts, `giveUpAsk` (so Stop and closing the window give it up), the tray, `once("closed")`, `askProgress(win)` and `withRun`. Inside its `try`, `const vault = this.requireVault()`, then `(await this.librarianFor(vault)).ask(question, { save: true, answer, signal, progress })`.
    - Its ending: `abort.signal.aborted` is `stopped`; `result.ok` with a page (`filedPages(vault.root, outcome.changes)[0]`) is `saved`, with `outcome.commit`; `result.ok` without one is `unsaved` with no failure; otherwise `unsaved` with `this.agentFailure(harness, lastLines(result.stderr || result.output), classifyFailure(result))`, as `answerQuestion` reads a failed run (:3215-3216). A throw is `unsaved` with `partial` null: a `NoAgentError` as `answerQuestion` reads it (:3218), anything else `avanzelFailure(errorMessage(error))`. `partial` is `leftBehind(outcome)`. `agent` is `this.agentName()`.
    - When the run left a commit (`outcome.commit`), it calls `this.clearLastFiled(vault.root)` again (planner's call 14).
  - **`ask:save`** (invoke) → `controller.saveAnswer(e.sender, question, answer)`; the bridge's `ask.save(question: string, answer: string): Promise<SaveResult>`.
  - **The window's state:** `interface Saving { result: SaveResult | null; stopping?: true }` (null while it runs), and `Turn` gets `saving?: Saving`. `busy` is also true while a turn's `saving.result` is null.
  - **The turn,** after its `Reply` and outside that status region:
    - **The offer:** `<Button size="small">Save as a page</Button>`, on the newest turn (`place === 0`) whose answer is ok and has words, while nothing runs and no save of it stands (none yet, or it was stopped).
    - **While it runs,** as `Reply` (:171-193): a small `Spinner`; a status region holding `savingLine(progress.message, seconds).line`, which counts outside the region from 10 s; and `<Button size="small" variant="quiet">Stop</Button>`. Stop calls `api.cancel()` and stays `busy` until main's answer. Pressing Save resets `progress`, as `ask` does (:95).
    - **Saved:** the status region says `savedLine(page)`. Under it, `<Button size="small">Open</Button>` opens the page as a source does (`api.openPage(pageName(page.path))`).
    - **Stopped:** the status region says `stoppedSaveLine(agent, partial)`, and the offer is back.
    - **Unsaved:** `Failed` with `saveProblem(failure, agent, partial, new Date())` and the fix "Save again", which saves again; Open Terminal and Open Settings are offered as for a question.
    - **`Failed`** takes `{ problem: AskProblem; again?: { label: "Ask again" | "Save again"; onPress(): void } }`. A failed question passes `failedAnswer(result, new Date())` and "Ask again", so app.spec.ts's failure tests (:582-748) stand.
  - **copy.ts:** `SAVING = "Saving the answer as a page…"`; `savingLine(progress: string | null, seconds: number): { line: string; counting: boolean }`, as `waitingLine` (:48-51) with SAVING and `Saving the answer as a page: ${whole} s`; `savedLine(page: FiledPage): string`, `Saved as “${page.title}” in ${isShelf(page.shelf) ? SHELF_NAMES[page.shelf] : page.shelf}.` (`SHELF_NAMES` from `@avanzel/ui`, `isShelf` from `../common/shelf.ts`); `stoppedSaveLine(agent: string, partial: PartialEdits): string`, `Stopped. ${unsavedLine(agent, partial)}`.

- [ ] **Step 1: Write the failing tests.** Read `.claude/skills/avanzel-ui/SKILL.md` first.
  - **problems.test.ts**, `describe("saveProblem")` (its `failure`, `now`, `on` and `UNCHANGED`):
    - "a run that ended well with no page says so, and what it left": `saveProblem(null, "Claude Code", null, now)` is `{ title: "Claude Code didn't save a page.", body: "Your library hasn't changed.", terminal: false, settings: false }`; with "commit" the body is "Claude Code's partial edits are kept as their own commit in the library's history."; with "uncommitted", "Claude Code's partial edits stay as they are, because nothing recorded them."
    - "any other failure says the answer couldn't be saved, what it left, then the agent's line": `saveProblem(failure({ line: "ERROR: the model is not supported with this account" }), "Claude Code", "commit", now)` has the title "Claude Code couldn't save the answer." and the body "Claude Code's partial edits are kept as their own commit in the library's history. The model is not supported with this account."
    - "a sign-in names the command, then to save again, and offers Terminal": `saveProblem(failure({ kind: "signin" }), "Claude Code", null, now)` is `{ title: "Claude Code isn't signed in on this Mac.", body: "Your library hasn't changed. Run claude once in Terminal and sign in, then save again.", command: "claude", terminal: true, settings: false }`.
    - "with no agent installed, Avanzel needs one to save the answer": kind "missing" gives "Avanzel needs an AI agent to save the answer." with "Claude Code works best, and Settings → Agents has its install command." and `settings: true`.
    - "a limit, a timeout and a gone agent read as a question's, after what the save left": each title equals `askProblem`'s for the same failure, and each body begins "Your library hasn't changed."
  - **ask-copy.test.ts:**
    - "savingLine says the save, main's own words while it waits, and counts from 10 s": `savingLine(null, 3)` and `savingLine(LOOKING, 3)` are `{ line: "Saving the answer as a page…", counting: false }`; `savingLine("Waiting for Avanzel to finish with your library…", 30)` keeps that line, not counting; `savingLine(null, 12.7)` is `{ line: "Saving the answer as a page: 12 s", counting: true }`.
    - "savedLine names the page and its shelf, or its folder": `{ title: "Answer", shelf: "topics", path: "topics/answer.md" }` gives "Saved as “Answer” in Topics.", and `{ title: "Trip", shelf: "projects", path: "projects/trip.md" }` gives "Saved as “Trip” in projects."
    - "stoppedSaveLine says what the stopped save left": "Stopped. Your library hasn't changed." for null, and the commit sentence after "Stopped. " for "commit".
    - "the save's words are written as the design rules ask": each line above begins with a capital and has no "!", no "...", no emoji and no "I" (as capsule-copy.test.ts:162-191).
  - **ask-extras.spec.ts** (add `FAKE_AGENT_RECORD` where a test reads prompts; copy `agentMode` from menu-bar.spec.ts:1180 and `undoItem` from :1122):
    - "Save as a page saves the answer the person saw, says where, and opens it". A git library; ask "Summarize my ideas". The newest turn has one "Save as a page" (secondary, small). Pressing it, the save's status region says "Saving the answer as a page…", then "Saved as “Answer” in Topics." (inside a `[role="status"]`). The second recorded prompt contains the turn's answer, the fake's reply (it begins "Q: Summarize my ideas\nPages: "), and "save the answer the owner was shown". `topics/answer.md` exists, the log has "| ask | Summarize my ideas → [[answer]]", and `gitOut(library, "log", "-1", "--format=%s")` is "avanzel: save answer to “Summarize my ideas”". "Save as a page" is gone. Open, with `stubOpening`, opens the page (`openedWith`, compared by `realpathSync` as app.spec.ts:487). `snap(ask, "9-ask-saved")`.
    - "one run at a time: no question while a save runs, and Stop gives the save up, keeping what it left as its own commit". A git library; ask; then `agentMode(app, "slow-messy")` and Save. A typed question and Enter add no turn (one heading) and stay in the field, and no "Save as a page" shows. Once `goals/half.md` exists, Stop: the save's line says "Stopped. fake's partial edits are kept as their own commit in the library's history.", the last commit is "avanzel: leftovers of an answer that was not saved", the save's agent pid (its record) is gone, and "Save as a page" is back.
    - "a save that saved no page, or failed, says so with one fix, Save again". A library without git; ask; `agentMode(app, "noop")`, Save: the alert says "fake didn't save a page." and "Your library hasn't changed.", and its buttons are `["Save again"]`, primary (`snap(ask, "9-ask-save-failed")`). `agentMode(app, "fail")`, Save again: "fake isn't signed in on this Mac." and "Your library hasn't changed. Sign in to fake in Terminal, then save again.", with `["Save again", "Open Terminal"]`. `agentMode(app, "ok")`, Save again: "Saved as “Answer” in Topics.", and no alert.
    - "Save as a page is offered on the newest answered turn only": after two questions there is one "Save as a page", in the first `article`; after a third that fails (`agentMode "fail"`), there is none.
    - "a save clears the menu's Undo the last filing, as it starts and after a filing that ended while it waited":
      - `launchOn(await makeLibrary({ git: true }))`, `filedFromTheCapsule`; `undoItem` shows. Ask, then Save: `undoItem` is undefined (poll), and still is once the turn says "Saved as…". The menu still has its `show-receipt` item.
      - `launchOn` a git library with `FAKE_AGENT_DELAY_MS: "4000"` and `FAKE_AGENT_DELAY_TASK: "file"`. Ask first (not delayed), then `dictate(app)` and poll for `filing`. Save: its line says "Waiting for Avanzel to finish with your library…". Once the capsule says `filed` and the turn "Saved as…", `undoItem` is undefined.
    - "closing the Ask window gives a running save up, and keeps what it left as its own commit": a `slow-messy` save; once `goals/half.md` exists, `call(app, "closeAsk")`; poll the last commit, "avanzel: leftovers of an answer that was not saved"; the save's pid is gone.
    - "only the Ask window's page can save": from Settings' page, `window.avanzel.ask.save("Summarize my ideas", "An answer.")` rejects; no run is recorded, and there's no `topics/answer.md`.
- [ ] **Step 2: Run** `npx vitest run test/problems.test.ts test/ask-copy.test.ts` from `apps/mac`. Expected: they fail.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/ask-extras.spec.ts e2e/app.spec.ts e2e/menu-bar.spec.ts e2e/setup-filed-ask.spec.ts` (app.spec.ts's failures go through `Failed`, menu-bar.spec.ts through `clearLastFiled`, setup-filed-ask.spec.ts through Ask's progress). Expected: they pass.
- [ ] **Step 5: Commit** as `mac: an answer can be saved as a page from Ask`.

### Task 4: The save's own Undo

D3's Undo. Owner items: none.

**Files:**
- Modify `apps/mac/src/main/controller.ts`: `savedAnswers` beside `giveUpAsk` (:319); `openAsk` (:3122-3131); Task 3's `saveAnswer`; `undoSave` after it.
- Modify `apps/mac/src/main/ipc.ts`, `apps/mac/src/preload/index.ts` and `apps/mac/src/shared/ipc.ts` (the bridge's `ask`).
- Modify `apps/mac/src/renderer/ask/main.tsx` (the saved line) and `copy.ts`.
- Test: `apps/mac/test/ask-copy.test.ts`, `apps/mac/e2e/ask-extras.spec.ts`.

**Interfaces:**
- **Consumes:** Task 3's `SaveResult`, `saveAnswer`, `Saving` and `savedLine`; 2a's `revertFiling(commit: string, library: Vault): Promise<boolean>` (ctl:2799-2808).
- **Produces:**
  - **`private readonly savedAnswers = new Map<string, Vault>()`:** each saved answer's commit, with the library it was saved in, while the Ask window that saved it is open. `saveAnswer` adds a `saved` commit when it has one and its window isn't destroyed. `openAsk` empties the map when the window it makes closes (`once("closed")`).
  - **`undoSave(sender: WebContents, commit: string): Promise<boolean>`:** false unless `isPageOf(sender, this.askWindow)` and `savedAnswers` holds `commit`. It deletes the commit first (one try), then returns `revertFiling(commit, library)`, a throw read as false (as `undo()`, ctl:2831-2834). It posts no notification and puts up no capsule card: the turn tells it.
  - **`ask:undo-save`** (invoke) → `controller.undoSave(e.sender, commit)`; the bridge's `ask.undoSave(commit: string): Promise<boolean>`.
  - **`Saving.undo?: "asked" | "undone" | "refused"`.** The saved line gets `<Button size="small" busy={undo === "asked"}>Undo</Button>` before Open, in an `Actions align="start"`, when `commit` isn't null and no Undo was asked.
    - true: the status region says `undoneLine(page)`, Undo and Open go, and the offer is back on the newest turn.
    - false: `<Notice tone="error" title={undoRefused.title}>{undoRefused.body}</Notice>` under the line, which stays with Open, with no Undo (as setup/steps/Filing.tsx:183).
    - The Undo stays on its turn while the window is open, also once newer questions are asked.
  - **copy.ts:** `undoneLine(page: FiledPage): string`, `Undone. “${page.title}” is no longer in your library.`

- [ ] **Step 1: Write the failing tests.** Read `.claude/skills/avanzel-ui/SKILL.md` first.
  - **ask-copy.test.ts:** "undoneLine says the page is no longer in the library": `{ title: "Answer", … }` gives "Undone. “Answer” is no longer in your library."; it joins the design-rules list.
  - **ask-extras.spec.ts** (`watchUndos`, `undoCalls`, `undone`, `notified` and `filedFromTheCapsule` from capsule-helpers.ts):
    - "Undo takes the saved page back, once, and the turn says so": a git library, `watchUndos(app)`, a save, then Undo. The save's line says "Undone. “Answer” is no longer in your library."; `undone(library)` is `["avanzel: undo save answer to “Summarize my ideas”"]`; `topics/answer.md` is gone and the log has no "| ask |" line; `undoCalls` is 1; Undo and Open are gone and "Save as a page" is back; `notified(app, "Undone")` is `[]`, and the capsule is `hidden`. `snap(ask, "9-ask-save-undone")`.
    - "a filing after the save makes git refuse its Undo, and the turn says so once": `launchOn` a git library; a save; `filedFromTheCapsule(app)`; Undo. The alert says "This one can't be undone automatically." and "Usually a later change touched the same lines. The library's history keeps both versions."; the saved line and Open stay, with no Undo; `undone(library)` is `[]`, and `topics/answer.md` is still there.
    - "the Undo takes back in the library the save was made in, whichever is open": `XDG_CONFIG_HOME` set to a new folder; a save in git library A; `call(app, "createLibrary", B)`; Undo: A's page is gone and `undone(A)` has one subject, and B's log has no "avanzel: undo".
    - "in a library without git, the saved line offers Open and no Undo".
    - "only the Ask window's page can undo a save": the commit from `gitOut(library, "rev-parse", "HEAD")`; from Settings' page, `window.avanzel.ask.undoSave(commit)` resolves false, and `undone(library)` is `[]`. The turn's own Undo still works after it.
- [ ] **Step 2: Run** `npx vitest run test/ask-copy.test.ts` from `apps/mac`. Expected: it fails.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/ask-extras.spec.ts e2e/menu-bar.spec.ts e2e/shortcuts.spec.ts` (`revertFiling`'s other callers, and ⌥⇧Z's `reverting` check). Expected: they pass.
- [ ] **Step 5: Commit** as `mac: a saved answer has its own Undo, told in its turn`.

### Task 5: ⌥Space dictates a question into Ask

D4. Owner item 4.

**Files:**
- Modify `apps/mac/src/main/jobs.ts`: `Recording` (:16-30).
- Modify `apps/mac/src/main/controller.ts`: `Transcribing` (:263-269); a `NOTHING_HEARD` const, lifted from `onAudio` (:1612-1616); `pressDictate` (:1293-1296); `startRecording` (:1404-1447); `onAudio` (:1555-1638); `heardQuestion`, after `onAudio`; `stopTranscribing` (:1717-1741); `askHasFocus` and `askShortcut`, beside `openAsk`.
- Modify `apps/mac/src/main/ipc.ts`, `apps/mac/src/preload/index.ts`, `apps/mac/src/shared/ipc.ts` (the bridge's `ask`).
- Modify `apps/mac/src/renderer/ask/main.tsx` (the field, :113-127, and the effects) and `copy.ts`.
- Test: `apps/mac/test/ask-copy.test.ts`, `apps/mac/e2e/ask-extras.spec.ts`.

**Interfaces (produces):**
- **`Recording.forAsk: boolean`**: "A question for the Ask window (`pressDictate` while Ask is the key window): its words go to Ask's field (`heardQuestion`) and nowhere in the library, and it has no file mode." **`Transcribing.forAsk: boolean`**; `onAudio`'s own `Transcribing` gets `forAsk: false`.
- **`startRecording(mode, shot?, { forSetup = false, forAsk = false } = {})`** keeps `forAsk` on the `Recording`, and its `fileMode` is null for it, as for setup's (:1415). Setup's host call (:3638) is unchanged.
- **`private askHasFocus(): boolean`:** the Ask window exists, isn't destroyed, and `isFocused()`.
- **`pressDictate`:** after `this.setup.notePress()`, if `!this.setup.takesPress() && !this.recording && this.askHasFocus()`, it calls `void this.startRecording("dictate", undefined, { forAsk: true })` and returns; otherwise `void this.toggleDictate()`, as now. `toggleDictate` doesn't change.
- **`onAudio`:** right after `this.recording = null;`, `if (recording.forAsk) return this.heardQuestion(recording, received);`.
- **`private async heardQuestion(recording: Recording, received: Float32Array): Promise<void>`:**
  - The samples are `fakeAudio`'s or `received`, as `onAudio`'s. Under 0.3 s of samples there are no words. Otherwise `transcribeWithStop(samples, { vault: this.requireVault(), audioPath: null, now: new Date(), samples, stopped: false, forAsk: true })`; null means Stop, and it returns.
  - No words: `this.recordingFailed(recording, { problem: "silence" }, NOTHING_HEARD, "open-settings:voice", "Choose microphone")`.
  - Words: the capsule goes `hidden` if it still shows a `transcribing` card, and `ask:heard` takes them to the Ask window if one is open; with none, nothing more.
  - A throw: `console.error("question", error)`, then `recordingFailed(recording, { problem: "unheard" }, unheardProblem(errorMessage(error), null, reasonMax(error)))`, which ends "Nothing was saved."
  - It never claims or writes audio, makes a capture, calls `captureCount.add()` or reaches `afterCapture`.
- **`stopTranscribing`,** after its first `stoppable()` check: for `transcribing.forAsk`, `transcribing.stopped = true`, the capsule goes `hidden`, and it returns, with no `keepAudioOutOfGit`, `keepInInbox`, count or `recorded` card.
- **`askShortcut(): string | null`:** `shortcuts.dictate` while `shortcutProblems` doesn't name it, else null (as setup.ts:1237-1240).
- **IPC:** `ask:dictate-shortcut` (invoke) → `controller.askShortcut()`; `ask:heard` (main → the Ask page). The bridge: `ask.dictateShortcut(): Promise<string | null>` and `ask.onHeard(callback: (words: string) => void): () => void` (preload's `listen`).
- **The window:**
  - It reads the shortcut with its page count and suggestions. While it isn't null, under the `TextField` in `.ask-field`, in a `Stack gap={8}`: `<Text variant="footnote" tone="secondary">Press <Kbd>{prettyAccelerator(shortcut)}</Kbd> to say your question.</Text>`, with `prettyAccelerator` from `../../main/shortcuts.ts` (as capsule/listening.tsx:5).
  - `api.onHeard((words) => { setQuestion((typed) => withHeard(typed, words)); field.current?.focus(); })`.
  - **copy.ts:** `withHeard(typed: string, words: string): string`: `typed.trimEnd()`, a space and `words` when `typed` has words, else `words`.

- [ ] **Step 1: Write the failing tests.** Read `.claude/skills/avanzel-ui/SKILL.md` first.
  - **ask-copy.test.ts:** "withHeard puts the spoken words after what is typed, with one space": `("", "What about tulips?")` gives "What about tulips?"; `("Also,", "what about tulips?")` "Also, what about tulips?"; `("Also, ", "x")` "Also, x"; `("   ", "x")` "x".
  - **ask-extras.spec.ts.** Add `askIsKey(app, key)`, which sets the Ask window's `isFocused` to return `key` (find it by `/renderer/ask/` as `panelOf` does, capsule-helpers.ts:26-31), and copy recording.spec.ts's `stopTranscribing(page)` (:147-151). Each test launches with `launchOn(await makeLibrary(), env)`, opens Ask and calls `askIsKey(app, true)` unless it says otherwise; "a press" is `call(app, "pressShortcutForTests", "dictate")`.
    - "⌥Space in the Ask window puts the spoken question in its field, after what is typed, and keeps nothing". `launchOn(library, { AVANZEL_FAKE_TRANSCRIPT: "what about the tulips?" })`; Ask open, `askIsKey(app, true)`, "Also," in the field. `pressShortcutForTests("dictate")`: the capsule state matches `{ kind: "listening", mode: "dictate", fileMode: null, hint: "Alt+Space" }`. A second press: the field's value becomes "Also, what about the tulips?" (poll), the capsule is `hidden`, and the field is focused. There's no heading; `inbox(library)` and `filesUnder(library, "raw")` are `[]`; `captures.json` doesn't exist in `userData`; nothing is notified. Enter then asks it: the heading "Also, what about the tulips?" shows.
    - "⌥Space records a thought while another app is in front of Ask, and the menu's Record a thought always does". With `askIsKey(app, false)`, two presses file a thought (`filed`), and the field stays empty. With `askIsKey(app, true)`, two `toggleDictate` calls file a second. With `askIsKey(app, true)`, `toggleDictate` starts a third, and a press stops it: it is filed (three archived captures), and the field is still empty.
    - "a question that heard nothing, or whose words couldn't be made, says so, and keeps nothing": `AVANZEL_FAKE_AUDIO` is a 0.1 s wav (`writeWav(file, new Float32Array(1600))`, as agents.spec.ts:347-348). `expectProblem(capsule, { title: "Nothing was heard.", lines: ["Is the right microphone selected? Nothing was saved."], fix: "Choose microphone" })`; the field is empty, and nothing is kept. Then, with `AVANZEL_FAKE_AUDIO` set at runtime to `speechWav("hello")` (as `agentMode` sets its variable) and the controller's `transcribe` made to throw "The speech model fell over" (as recording.spec.ts:195-213's `noteTranscriptions` with `failWith`), a question's card says "The recording couldn't be turned into words." and "The speech model fell over. Nothing was saved."; the field is empty, and nothing is kept.
    - "Stop on a question's slow transcription keeps nothing, and its words never come": `AVANZEL_TRANSCRIBE_STOP_MS: "500"`, `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "4000"`. Two presses; poll for `{ kind: "transcribing", slow: true }`; `stopTranscribing(capsule)`. The capsule is `hidden`; 6 s later the field is still empty; `inbox(library)` and `filesUnder(library, "raw")` are `[]`, and there's no `captures.json`.
    - "words that arrive after the Ask window closed are dropped quietly": `AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "3000"`; two presses, then `call(app, "closeAsk")`. The capsule goes `hidden` (poll) and never shows an `error` card; nothing is notified, and nothing is kept.
    - "Ask's hint names the dictate shortcut, follows a change, and is gone while the shortcut isn't registered". "Press ⌥Space to say your question." shows, and its `kbd` says "⌥Space" (`snap(ask, "9-ask-hint")`). `call(app, "setApp", { shortcuts: { ...snapshot.app.shortcuts, dictate: "Control+Alt+K" } })` (as setup-think.spec.ts:154), then a `focus` event: it says "⌃⌥K". A launch with `AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space"` shows no hint.
- [ ] **Step 2: Run** `npx vitest run test/ask-copy.test.ts` from `apps/mac`. Expected: it fails.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/ask-extras.spec.ts e2e/recording.spec.ts e2e/app.spec.ts e2e/microphone.spec.ts e2e/setup-think.spec.ts e2e/setup-spoken.spec.ts` (the recording path and setup's press). `microphone.spec.ts:15` and `recording.spec.ts:57` are known flakes (the lines move). Expected: they pass.
- [ ] **Step 5: Commit** as `mac: ⌥Space dictates a question into Ask while it is in front`.

### Task 6: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check` (the baseline stays `{}`) and `npm run ui:e2e`.
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`, once `pgrep -x Avanzel` prints nothing: `caffeinate -i npm run build`, then `caffeinate -i env -u AVANZEL_E2E_AGENT -u AVANZEL_E2E_PACKAGED -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`. Expected: no failures. Re-run each known flake once, and report the wall time.
- [ ] **Step 3: Take the shots** into `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/shots/2b/`, with a README, in light and dark:
  - Ask's empty state with three suggestions and the hint, and one suggestion with a 120-character title;
  - a save running, saved (Undo, Open), undone, refused, with no page (Save again), and stopped with partial edits;
  - the field holding dictated words, and the capsule listening for a question;
  - the hint after the shortcut changed to ⌃⌥K.

  Use a throwaway spec, archived as `.txt` in the flight pack's `archive/2b-work/` and never committed.
- [ ] **Step 4: The design review.** The controller runs the `design-reviewer` agent on ask/main.tsx, ask/copy.ts, ask/styles.css and the shots, and rules on its list. Any fixes go in one commit, `mac: Ask's extras read as one design`.
- [ ] **Step 5: List the by-hand checks** in the flight pack as pending for the owner, never as done:
  - on the packaged review build, ⌥Space with Ask in front: the capsule listens, the words land in the field, and Return asks them. ⌥Space types no no-break space into the field (the groundwork couldn't check that a registered shortcut keeps the key from it);
  - ⌥Space with Ask open behind another app records a thought;
  - with the owner's own agent: Save as a page writes a `topics/` page in the answer's words, linked, in index.md, with one `| ask |` line and one commit, and its Undo takes all of it back (owner item 3);
  - VoiceOver: each suggestion reads as a group named by its question, with Ask this; the save's lines are read once each as they change; the hint is read after the field;
  - the suggestions after real filings, and after a library switch and back.
- [ ] **Step 6: Docs.**
  - README: the ⌥⇧A row (:45) says Ask suggests questions about what was filed last and saves an answer as a page, with Undo; the Ask paragraph (:99-101) says ⌥Space dictates a question into Ask while it is in front, and that a save is another run of the agent, which Stop or closing the window gives up, keeping its edits as their own commit.
  - This plan: a "Built" list under "Where this plan sits", and each task's text brought to what was built.
  - The flight pack's docs are the controller's.
