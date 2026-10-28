# 2a, Undo that lasts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undo outlives the capsule card and survives a restart. Both menu Undo items come back after a quit and relaunch, and each library keeps its own. "Show the last receipt" reopens the last filing's card. ⌥⇧Z undoes the last filing from any app. The filed card says "Your exact words are kept." when the engine put them back.

**Architecture:**
- **Records.** A small store in the app's profile (`UndoRecordStore`, `undo-records.json`) keeps, per library, the commit "Undo the last filing" takes back, the last evening review's commits and (Task 3) the last filing's receipt. The controller's fields hold the open library's records only: they load as a library opens, and each change is written at once. As the library opens, git checks every saved commit (`git.inHistory`). Nothing is offered until it has, and a commit that has left HEAD's history is dropped quietly.
- **The receipt** (`FilingReceipt`) is what the last filed or noted card showed, kept with the records. "Show the last receipt" puts it up again as a reprint: the `filed` state with `reprint`, its stamp still and dated the day it was filed, with no sound. Its Open and rows open its own pages, and its Undo is the menu's.
- **The restored line** is the `filed` state's `restored`, drawn in the card's caption slot (`Card`'s `meta`).
- **The shortcut** is a fifth `Shortcuts` key, `undo` (⌥⇧Z), registered, saved, checked and rescued with the other four. A press runs the menu's Undo; with nothing to undo, it puts up a calm bar (`nothing-to-undo`).

**Tech Stack:** Electron 44 (globalShortcut, Menu), TypeScript, React 19 renderers on `@avanzel/ui`, git through `@avanzel/engine`, Vitest, Playwright for Electron.

**Spec:** `/Users/aksimemor/git-reps/avanzel/reports/Avanzel UX and first-run design.md` (in the main checkout, untracked):
- §6.3 The receipt and Undo, lines 336–346: "Show the last receipt" (line 340), "Your exact words are kept." (line 341), and Undo outliving the card (lines 342–345).
- §10, Keyboard, line 640: "Add a global "Undo the last filing" shortcut."
- §11, line 696: "Undo that lasts. It outlives the capsule card and survives a restart."
- §4.2's mood table, lines 166–172: the capsule's states.

Where this plan sits:
- Phase 1 of the product plan is complete on main (sub-plans 1a–1f). Phase 2 is "personality and ritual" (the spec's §11), and most of it waits on owner decisions. "Undo that lasts" waits on none, so it goes first, as 2a. Ask's extras follow as 2b.
- It is on branch `undo-that-lasts`, from main at `22145b4`, in the worktree `.claude/worktrees/design-system`.
- It runs under the owner's /goal "keep going", by subagent-driven development: a fresh implementer per task, a task review, and a final whole-branch review. As with 1c and 1d, the plan doesn't wait for the owner's review; they read it in the flight pack.
- The groundwork is `/tmp/avz-ds/2a-groundwork.md`, a read-only survey at `22145b4`. Every `file:line` below is that commit's, checked against the code.
- 1d's owner items 9 (the shortcut) and 10 (Show the last receipt) are built here.

## The controller's decisions (binding, as written)

**D1. Scope.**
- **In:** (a) both menu Undo items survive a quit and relaunch; (b) "Show the last receipt" in the menu; (c) a global "Undo the last filing" shortcut; (d) "Your exact words are kept." on the filed card when the engine restored the words.
- **Out**, each named under Owner items ("Not in 2a") with its reason: Undo and Open on the filed notification; dragging a receipt's chips into other apps; provenance shading in pages; opening a library that has no `.obsidian/` folder through Obsidian; a menu Undo for setup's first thought; Ask's extras (2b).

**D2. Where the records live.**
- **Location:** the app's profile, per library, keyed by `path.resolve(library)` the way `RunStateStore` keys its file (`apps/mac/src/main/run-state.ts`). Either fields in the run state, or a sibling store with the same keying and the same atomic write: the planner chooses, and says why (planner's call 1).
- **What is kept:** for the last filing, its commit, its pages, and what its receipt needs (D3); for the last evening review, its commits.
- **Loading.** Records load when a library opens. A commit is offered only if it still exists in that library's git and is an ancestor of HEAD. Otherwise the record is dropped quietly.
- **Clearing.** Every point that clears a record today also clears it on disk: the next filing's start; a review that writes (1d's rule: the weekly review at its start, the evening review at its end only if it filed something or threw); a take-back by Stop, Edit or Undo; the Undo itself.
- **Library switches.** A switch no longer throws a library's record away. Each library keeps its own, and the menu shows only the open library's. This fixes a latent bug: `openLibrary` clears `lastFiled` but not `lastEveningCommits`, so after a switch "Undo the last evening review" points at the other library's commits.
- **Tests.** A relaunch test (the same user data, the same library) shows both items, and each works. A record whose commit is gone isn't offered.

**D3. "Show the last receipt".**
- **What it reopens:** the last filing's result card, filed or noted ("nothing new"). This includes a background filing, which ended with a notification instead of a card. It excludes setup's first thought, and saved cards (a screen comment, or evening mode). The record lives with D2's, so it survives a restart.
- **How the card looks:** the same card, with its page rows and Open; Undo while that filing can still be taken back; the D4 line when it applies. It is shown as a reprint: no stamp motion and no sounds. It hides on the card's usual timer, and hover holds it.
- **Where the item sits:** beside "Undo the last filing". It is hidden while a recording, transcription, filing or review runs, and when the open library has no receipt. Choosing it replaces whatever card shows.
- **What replaces or clears it:** the next filing's result replaces it. A take-back of its filing clears it. A review doesn't clear it, but the receipt's Undo follows the menu's Undo, so a review that writes removes the Undo.
- **Where it goes in the menu** is the planner's call, checked against 1d's Review Focus 3, the menu rebuild budget, which it keeps (planner's call 15).

**D4. "Your exact words are kept."** When `FileOutcome.restored` is true, the filed card and the reprint carry that exact sentence (spec §6.3) as a quiet line, in the card's existing caption or footer slot. Tests make the engine restore the words with a fake agent mode, never a real agent.

**D5. The global "Undo the last filing" shortcut.**
- A fifth shortcut, defaulting to ⌥⇧Z, consistent with ⌥⇧S, ⌥⇧Space and ⌥⇧A. It is recorded, saved, checked for clashes and rescued like the other four, and it gets its row in Settings → Voice. Older settings files get the default through `normalizeSettings`. The menu's "Undo the last filing" shows it as its accelerator. The key is an owner item, next to doc 3's D6.
- **With a filing to undo,** a press runs the menu item's path: one try, and the result is told once.
- **While a filing or a review runs,** nothing happens. The running card already shows why.
- **With nothing to undo,** the capsule shows a calm, short card in an existing quiet capsule state: "There's no filing to undo." It hides after about 3 s. DESIGN.md's copy rules apply: no "!", no apology.

## Global Constraints

- **Windows arrange, `@avanzel/ui` paints.**
  - Build windows only from `@avanzel/ui` components: no raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`.
  - Window CSS only arranges, with spacing from `var(--av-space-N)`.
  - Components take no `className` or `style`.
  - Nothing in `packages/ui` changes. Where a part is missing, use the stand-in this plan names and list it as an owner item.
- **Interface work:** invoke the `avanzel-ui` skill with the Skill tool before editing anything under `apps/mac/src/renderer/`.
- **Copy** is in sentence case, calm and plain: no "!", no "Oops", no emoji.
  - People are they/them, and an action keeps its name through the flow.
  - Never promise more than the app does.
- **2a's words, exactly:**

  | Where | Words |
  |---|---|
  | The menu item (action `show-receipt`) | Show the last receipt |
  | The filed card and its reprint, in the card's head | Your exact words are kept. |
  | The capsule's bar, with nothing to undo | There's no filing to undo. |
  | The fifth action's name: the menu, Settings → Voice, the notices | Undo the last filing |
  | A taken Undo shortcut's notice, its second sentence | Pick another shortcut. “Undo the last filing” is in the menu bar after each filing. |

- **2a's values:** the Undo shortcut is `"Alt+Shift+Z"` (⌥⇧Z), with the free ones `"Control+Alt+Z"` and `"Control+Alt+U"`. `NOTHING_TO_UNDO_MS = 3_000`, beside `PICKED_SHOW_MS` (controller.ts:173). `FILED_SHOW_MS = 8_000`, the filed card's own time (controller.ts:1803). The records' file is `undo-records.json` in the app's profile (userData).
- **This machine's rules are binding:** `/tmp/avz-ds/2a-machine-rules.md`, 1d's carried over:
  - no real agent CLI;
  - unset `ELECTRON_RUN_AS_NODE`;
  - no bare `git stash`, no push;
  - no `npm install` in the worktree;
  - edit interface files with the Edit and Write tools;
  - run no e2e while `pgrep -x Avanzel` prints;
  - wrap every e2e run in `caffeinate -i`: this Mac idle-sleeps after a minute (found in 1d), and a sleep in the middle of a run fails tests that are right;
  - known flakes get one re-run;
  - added in 2a: no `cd` into the main checkout (use absolute paths and `git -C`); the records live in the app's profile, so tests give each launch its own user data, a relaunch test reuses its own on purpose, and no test touches `~/Library/Application Support/Avanzel`.
- **Gates,** for every task: from the worktree root, `npm test -w @avanzel/mac`, `npm test -w @avanzel/engine` (Task 1, which changes the engine), `npm run typecheck` and `npm run design:check`. Then, from `apps/mac` and only if `pgrep -x Avanzel` prints nothing, `caffeinate -i npm run build`, then `caffeinate -i env -u ELECTRON_RUN_AS_NODE npx playwright test <the task's specs>`, one run at a time. If `pgrep` prints, report the e2e gate as pending with the exact specs.

## Owner items

These are stand-ins and choices for the owner. Each task names the ones it creates.

1. **The Undo shortcut's key, ⌥⇧Z** (Task 4), next to doc 3's D6 (shortcuts with ⌃ or ⌥ and one letter). It has two modifiers, as D6's option (a) asks, but on a US layout it types "¸", as ⌥⇧S and ⌥⇧A type "Í" and "Å". Its free ones are ⌃⌥Z and ⌃⌥U.
2. **The reprint's Zel hops** (Task 3). A reprint's bar is `CapsuleBar mood="filed"`, whose Zel hops twice (zel.css:62), as on every calm bar (Saved, Undone, Stopped). `CapsuleBar` has no still variant, and `packages/ui` doesn't change in 2a. The card's stamp is still.
3. **"There's no filing to undo." in the `filed` mood** (Task 4). The capsule's four moods (`CapsuleMood`, CapsuleBar.tsx:10) have no idle one, so the bar shows Zel's happy squint for an answer that is "no". A quieter mood belongs in `packages/ui`.
4. **Two wordings of kept words** (Task 2). The capsule says "Your exact words are kept." (spec §6.3) only when the engine put the words back; setup's proof always says "Kept your exact words in raw/." (narration.ts:11).

**Not in 2a** (D1), each with its reason:
- Undo and Open on the filed notification: notification actions need a signed build (1d's owner item H4).
- Dragging a receipt's chips into other apps: a new interaction on the capsule, not part of Undo lasting.
- Provenance shading in pages: it is about how pages show the person's words, not about Undo or the receipt.
- Opening a library that has no `.obsidian/` folder through Obsidian: it needs a spike, since Obsidian has to know the vault.
- A menu Undo for setup's first thought: 1d's H21 stays, and setup's Undo is in setup.
- Ask's extras: they are 2b.

## Review Focus

1. **A saved Undo that history has moved past.** A reset, a rebase, a pull that rewrote history, or a library restored from a backup leaves the saved commit out of HEAD's history. It isn't offered, and its record is dropped quietly; one still in history is offered after any number of relaunches. (A revert made by hand leaves the commit in history: the Undo is offered, and git's refusal is told as `undoRefused`.) Task 1's tests.
2. **Library switches, mid-run too.** Each library keeps its own records, and the menu shows the open library's only. The evening Undo never reverts another library's commits. A filing or evening review that ends after its library was closed keeps its record with its own library. Task 1's tests.
3. **The menu rebuild budget (1d's Review Focus 3).** `filing.spec.ts:742-745` allows at most one rebuild across a filing's steps. The records' writes and the receipt add no rebuild at a filing's steps, and clearing rebuilds only when something was held. An Undo from the menu with its card gone rebuilds twice, as in 1d: `forgetFiling` takes the Undo and the receipt in one rebuild, and `tellUndone` makes the other. Task 3 runs filing.spec.ts, and counts the Undo's rebuilds.
4. **A reprint is no new filing.** No stamp motion, no Stamp or Drawer, no filed face (`markFiled` isn't called), no notification and no count. Its Undo is the menu's and is told once, and its Open and rows open only its own pages. Task 3's tests.
5. **The shortcut never takes a live card away.** Over a recording, a transcription, a filing, the editor or a problem notice, a press with nothing to undo shows nothing. With a filing to undo, it undoes once and tells once, and a taken ⌥⇧Z is rescued like the others. Task 4's tests.

## Planner's calls (for the controller's ledger)

1. The records live in a sibling store (`UndoRecordStore`, `undo-records.json`), not in the run state — `tick()` writes the run state back whole every minute through `markChecked` and `markRan`, which copy field by field, and `normalizeRunState` tells its format by its field names (schedule.ts:110-113, :191-216), so a new field must be threaded through all three or it is lost at the next tick; the Undo records change at other moments, and a failed write of them must never fail a filing — one more small JSON file in the profile.
2. A library's records load into the controller's fields as it opens, before git has checked them; `checkUndo` runs after, can only drop, and nothing is offered until it has run — `openLibrary` stays synchronous, and a filing or review that starts during the check can't be undone by it (each drop is guarded by identity) — for the milliseconds of the check after a launch or a switch, the items hide and ⌥⇧Z says there's no filing to undo.
3. An evening record is all or nothing: one commit out of history drops it — taking back part of a review would leave its digest and log half undone — a review partly rewritten by hand loses its Undo.
4. A commit git can't vouch for (git can't run, no repository) is dropped like a gone one — D2's rule, quietly — a launch on which git is broken loses the saved Undo.
5. A filing or evening review that ends after its library was closed writes its record for its own library, and `clearLastFiled` takes a library — per-library records make it free, and it closes a second path of the latent bug: a review that ended after a switch set the other library's `lastEveningCommits` and cleared its Undo (controller.ts:3740, :3751) — back in that library, an Undo for a filing that ended while away is offered, which is right: it is that library's last filing.
6. A write of the records that fails is logged and let go, as `FirstRunLog.note` does (store.ts:224-232) — an Undo record is no reason to fail a filing's card — an Undo that silently doesn't survive the restart.
7. `lastFiled` loses its `pages` — written at controller.ts:1782 and never read; the receipt keeps the pages (Task 3) — none.
8. The tasks run D2, D4, D3, then D5: the restored line comes before the receipt — the receipt then carries `restored` from its first commit, with no format change after — none.
9. "Your exact words are kept." is the card's caption, its `meta`: the head, beside "Thought", in caption type and the secondary ink (Card.tsx:9-10, card.css:14-24), not a footer line — the capsule is 300 px tall and the filed card's footer room is spent (styles.css:42-56), so a footer line would cost the words one, while the head adds no height — if the owner wants it under the pages, it moves there and the words lose a line on that card.
10. The receipt is a copy of what the card showed (`FilingReceipt`), and a background filing's words are read from its archived capture (`captureWords(outcome.archivedTo)`) — D3 covers background filings, whose job has no words (`text: ""`, controller.ts:2079) — such a card shows the capture's text as its file holds it.
11. The reprint's stamp prints the day of the filing (`reprint.filedAt`), not the day it is shown — the stamp is the receipt's proof and matches the commit (spec §4.2) — after midnight a reprint shows yesterday's date, which is the truth.
12. Only a filed or noted result replaces the receipt; a next filing that fails, is stopped and taken back, or finds its note gone leaves it — D3's result card is filed or noted, and a failure card is no receipt — "Show the last receipt" may show the filing before a failed one, with no Undo (the failed run's start ended it).
13. "A filing runs" is a new field, `filingRun`, and the receipt item and the shortcut also wait for `queuedToFile` and `running` — `runs` holds Asks too and the menu isn't rebuilt when an Ask ends, so an item hidden on `runs` would stay hidden, and `queued` drops only after `runFiling`'s last rebuild — one field.
14. A background filing that waits in the queue rebuilds no menu (1d's accepted gap, its Task 4), so the receipt item may show then; choosing it does nothing, since `showLastReceipt` checks again — as 1d's Undo item — a press with no answer, for a moment.
15. "Show the last receipt" sits right above "Undo the last filing", after the recent pages, and the "Nothing filed yet" invitation gives way to it — beside Undo (D3), with Undo still closing the section (1d), and read in `menuInput`, so it adds no rebuild (1d's Review Focus 3) — an order to swap.
16. The reprint's Undo is the menu's Undo (`undoLastFiling`); pressed after the menu stopped offering it (a review or a filing began while the card showed), the card says `undoRefused` — D3's Undo follows the menu's, and a busy Undo must not wait for ever — during an evening review that then files nothing, a refusal where a later Undo would have worked.
17. With nothing to undo, ⌥⇧Z puts up a new state, `nothing-to-undo`: a bar alone, as the picked-shortcut bar is (main.tsx:41-58), in the `filed` mood, with no buttons, for 3 s — the capsule's four moods have no idle one, `needs-you` is for something stuck with a fix, and `filed` is the calm mood every finished bar uses (Saved, Undone, Stopped); the wording is D5's — the mood or the line changes in one scene (owner item 3).
18. That bar shows only over a hidden capsule or a finished card (`hidden`, `filed`, `saved`, `cancelled`, `recorded`, `shortcut-picked`, `nothing-to-undo`); over a recording, a transcription, a filing, the editor or a notice, a press does nothing — a bar over the listening card would take the recording's card away, and a problem's fix must stay — a press over a problem card says nothing.
19. With a filing to undo, ⌥⇧Z undoes it even while a recording runs, as the menu's item does, and one notification tells it — D5: it runs the menu item's path — an accidental press mid-dictation takes the last filing back, and says so.
20. The fifth shortcut's free ones are ⌃⌥Z and ⌃⌥U — two modifiers and a letter, as every other free one (D6), clear of macOS's own and of the others' — two strings.
21. `registerShortcuts` loops over `ACTION_NAMES`' keys, not the hard-coded four (shortcuts.ts:132), so Undo registers last and a clash names the earlier action — a fifth key can't be left out again — none.
22. A taken ⌥⇧Z's notice says "Pick another shortcut. “Undo the last filing” is in the menu bar after each filing." — the item shows only while there is a filing to undo, so "is still in the menu bar" (main.tsx:162) would promise more than the app does — one sentence.

---

### Task 1: Undo records that last: kept per library, checked against git as a library opens

D2. Owner items: none.

**Files:**
- Create `apps/mac/src/main/undo-records.ts`. Mirror `run-state.ts` (its keying, :16 and :34, and `writeJsonAtomic`, store.ts:30-35) and `FirstRunLog.note`'s write, which is logged and let go (store.ts:224-232).
- Modify `packages/engine/src/core/git.ts`: `inHistory`, after `subject` (:230-235).
- Modify `apps/mac/src/main/controller.ts`: the fields (:402-413), the constructor (:436), `openLibrary` (:501-535), `menuInput` (:749), `undoableFiling` (:759-762), `clearLastFiled` (:764-774), `runFiling` (:1743, :1778-1783), `takeBack` (:2483), `revertFiling` (:2540), `undoLastFiling` (:2582), `executeTask` (:3714-3752) and `undoEveningReview` (:3769-3777).
- Test: create `apps/mac/test/undo-records.test.ts` (mirrors `test/run-state.test.ts`); modify `packages/engine/test/core/git.test.ts` and `apps/mac/e2e/menu-bar.spec.ts`.

**Interfaces (produces):**
- **`git.inHistory(root: string, sha: string): Promise<boolean>`** in git.ts, after `subject`, with `subject`'s guard line (`if (!isRepo(root) || !available() || !SHA.test(sha)) return false;`), then `git(root, ["merge-base", "--is-ancestor", sha, "HEAD"])` (git.ts:261). It is true only for exit 0: `--is-ancestor` exits 0 when `sha` is HEAD or HEAD descends from it, 1 when not, and 128 for no such commit (git-merge-base(1); the test pins all three). A git that fails to start is false.
- **`undo-records.ts`:**
  ```ts
  export interface UndoRecord {
    /** The commit "Undo the last filing" takes back, or null. */
    filing: string | null;
    /** The last evening review's commits, oldest first (`EveningReviewResult.commits`): "Undo the last evening review". Empty for none. */
    evening: string[];
  }
  export function normalizeUndoRecord(raw: unknown): UndoRecord;
  export class UndoRecordStore {
    constructor(file: string);
    get(library: string): UndoRecord;
    patch(library: string, change: Partial<UndoRecord>): void;
  }
  ```
  - Keyed by `path.resolve(library)`. The controller declares `private readonly undoRecords: UndoRecordStore` beside `runState` (:360), and makes it beside it in the constructor (:436): `this.undoRecords = new UndoRecordStore(path.join(userData, "undo-records.json"))`.
  - A commit is 40 to 64 hex digits (`/^[0-9a-f]{40,64}$/i`). `normalizeUndoRecord` makes any other `filing` null, keeps `evening` only when every item is a commit (else `[]`), and drops unknown fields. A missing or corrupt file reads as no records.
  - `patch` merges `change` into the library's record and writes the whole file. A record left with nothing to undo is taken out of the file, and a patch that changes nothing writes nothing. A write that throws is logged (`console.error("undo records", error)`) and let go.
- **Controller:**
  - **`lastFiled: { commit: string; library: string; job?: FilingJob } | null`.** Its `pages` goes (planner's call 7).
  - **`private undoCheckedFor: Vault | null = null`:** the open library, once `checkUndo` has checked its saved records. **`private undoChecked(): boolean`** is `this.vault !== null && this.undoCheckedFor === this.vault`. `undoableFiling()` needs it too, and so does the menu's `undoableReview` (`this.lastEveningCommits.length > 0 && this.undoChecked()`).
  - **`openLibrary`:** where it sets `lastFiled = null` (:506), it also empties `lastEveningCommits` and sets `undoCheckedFor = null`, and writes nothing: the closing library's records are on disk already. Right after `this.vault = vault` (:529), it loads `this.undoRecords.get(vault.root)` into `lastFiled` (`{ commit, library: vault.root }`, or null) and `lastEveningCommits`, then calls `void this.checkUndo(vault)`.
  - **`private async checkUndo(vault: Vault): Promise<void>`,** whose guards the tests can't pin, so here is its body:
    ```ts
    const filing = this.lastFiled;
    const evening = this.lastEveningCommits;
    const filingOk = filing === null || (await git.inHistory(vault.root, filing.commit));
    let eveningOk = true;
    for (const sha of evening) if (!(eveningOk = await git.inHistory(vault.root, sha))) break; // one at a time: a review may have made dozens
    if (this.vault !== vault) return; // another library opened meanwhile, and checks its own
    // Only what is still as it was loaded is dropped: a filing, a review or an Undo since then is newer, and stands.
    if (!filingOk && this.lastFiled === filing) {
      this.lastFiled = null;
      this.undoRecords.patch(vault.root, { filing: null });
    }
    if (!eveningOk && this.lastEveningCommits === evening) {
      this.lastEveningCommits = [];
      this.undoRecords.patch(vault.root, { evening: [] });
    }
    this.undoCheckedFor = vault;
    this.refreshMenu();
    ```
  - **Every change is written for the library it belongs to** (`undoRecords.patch`). The fields change only while that library is the open one:
    - `runFiling` (:1782): a filing that ends ok with a commit, and isn't setup's, patches `{ filing: outcome.commit }` for `library.root`, whether or not that library is still open. `lastFiled` is set only while it is, as today.
    - **`private clearLastFiled(root = this.vault?.root): void`** (was `clearLastFiled(commit?)`). For the open library it does what it does today, and patches `{ filing: null }` when it clears. For another library it only patches that library's `{ filing: null }`. Its callers: `runFiling` (:1743), the weekly review's start (:3714), and the evening review's `finally` (:3751) with the review's own library.
    - **`private forgetFiling(commit: string): void`** takes `clearLastFiled(commit)`'s place in `takeBack` (:2483) and `revertFiling` (:2540), and `clearLastFiled()`'s in `undoLastFiling` (:2582, with `last.commit`). It clears `lastFiled` if that holds `commit`, patches, and rebuilds the menu once, only if it cleared. (So Task 3 can clear the receipt in the same rebuild: an Undo from the menu with its card gone rebuilds twice, as in 1d.)
    - The evening review (`executeTask`) takes its library as it starts: `const library = this.requireVault();` just before `let filedNothing` (the same library `librarian()` reads as the run begins; a missing one throws to the outer `catch`, as `librarian()` would). At :3740 it patches `{ evening: result.commits }` for `library.root`, and sets `lastEveningCommits` only `if (this.vault === library)`. Its `finally` (:3751) calls `this.clearLastFiled(library.root)`.
    - `undoEveningReview`: it acts only while `undoChecked()`, and before its first await it empties `lastEveningCommits` and patches `{ evening: [] }`.

- [ ] **Step 1: Write the failing tests.**
  - **undo-records.test.ts** (commits are `"a".repeat(40)` and the like):
    - "keeps each library's records apart, in a file of the app's own, under the library's resolved path": `patch("/libs/a", { filing: A })` and `patch("/libs/b/../b", { evening: [B1, B2] })`; a new store on the same file reads `{ filing: A, evening: [] }` for `/libs/a`, `{ filing: null, evening: [B1, B2] }` for `/libs/b`, and `{ filing: null, evening: [] }` for `/libs/c`.
    - "a patch changes only what it names": `filing` and `evening` patched one after the other are both kept, and `patch(a, { filing: null })` leaves `evening`.
    - "takes a library out of the file once it has nothing to undo": the file's JSON has no key for it.
    - "starts empty when its file is missing or corrupt" (`"{not json"`), and a patch then writes a good file.
    - "drops what isn't a commit": a file holding `{ filing: "HEAD", evening: [E, 42] }` reads `{ filing: null, evening: [] }`, while a 40-digit and a 64-digit `filing` are kept.
    - "never throws when it can't write": a file where the folder should be (as store.test.ts:228-241); `console.error` is called once, and `get` still reads what the file held.
  - **git.test.ts**, inside `describe.skipIf(!git.available())("git", …)`: "inHistory: HEAD and what it descends from, not a commit a reset left behind, an unknown one or one outside a repository". Two commits, `base` and `later`: both are true. After `gitOut(root, "reset", "-q", "--hard", base)`, `later` is false. `"0".repeat(40)` is false, `"HEAD"` is false (no commit's name), and `inHistory(tmp(), base)` is false.
  - **menu-bar.spec.ts.** Add `const reviewItem = async (app) => (await menuOf(app)).find((item) => item.type === "item" && item.action === "undo-review")` and `savedUndo(userData, library)`, which reads `undo-records.json`'s entry for `path.resolve(library)` (add `readFileSync` to the spec's `node:fs` import). The filing is always taken back first: its log line follows the review's, and reverting a line next to a later change conflicts (git.test.ts:219-240).
    - "both Undo items survive a quit and relaunch, and each takes its own back". A git library with one note in the inbox (`newCapture`, as `withNote` does, :172-176): `reviewed(app)`, then `filedFromTheCapsule(app)`; both items show; close. Relaunch with `hearing({ AVANZEL_USER_DATA: first.userData }, library)` and `watchUndos`. Both items show once the check has run (poll `undoItem`). `pressUndo` leaves one page in `ideas/` (the review's) and the capsule's note in the inbox, and `notified(app, "Undone")` is `[{ title: "Undone", body: UNDONE_NOTE }]`. Then `menuAction("undo-review")`: `notified(app, "Evening review undone")` is `[{ title: "Evening review undone", body: "Everything it filed is back in the inbox." }]`, `ideas/` is empty, the inbox holds both notes, neither item shows, and `undoCalls` is 2.
    - "a saved Undo whose commit has left the library's history isn't offered after a relaunch, and is dropped". File from the capsule in a git library and close. Then `gitOut(library, "reset", "-q", "--hard", "HEAD~1")`, and set the saved record's `evening` to `["0".repeat(40)]` in the file. Relaunch on the same user data: poll until `savedUndo(first.userData, library)` is `undefined` (`launchOn`'s own `userData` is a new folder, which the passed `AVANZEL_USER_DATA` overrides); then neither item shows, and `pressUndo` takes nothing back (`undoCalls` 0).
    - Rewrite 1d's "Undo from the menu goes with a library switch, and does not come back with the library" (:1480-1502) as "each library keeps its own Undo items through a switch: only the open library's show, and they come back with it". Library A as in the relaunch test (a review, then a capsule filing). `createLibrary` B: neither item shows; `pressUndo` and `menuAction("undo-review")` take nothing back (`undoCalls` 0, `undone(A)` empty, and B's log has no `avanzel: undo`). `useLibrary(A)`: both items come back (poll), and each takes its own back.
    - "an evening review that ends after a library switch keeps its Undo with its own library". A has one note. Set `FAKE_AGENT_DELAY_MS` to `"3000"` at runtime (`app.evaluate`, as `agentMode` does, :1132; the review files each note with the `file` task, librarian.ts:243-245). `runTask("evening-review")`, poll until the review's menu item says it runs (`detail` "Running…" or "Filing 1 of 1"), then `createLibrary` B. After `reviewSaid` and `idleForTests`, B has no `undo-review`, and `savedUndo(userData, A).evening` has the review's commits. Back in A, `undo-review` shows (poll), and choosing it says "Evening review undone".
    - Both switch tests set `XDG_CONFIG_HOME` to a new temporary folder, as the test they replace does (:1481), so `rememberVault` never writes the owner's `~/.config/avanzel`.
- [ ] **Step 2: Run** `npx vitest run test/undo-records.test.ts` from `apps/mac` and `npx vitest run test/core/git.test.ts` from `packages/engine`. Expected: they fail (no module; `git.inHistory` is not a function).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the unit tests and the gates. Then build and run `e2e/menu-bar.spec.ts e2e/capsule-results.spec.ts e2e/library.spec.ts e2e/app.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: both Undo items survive a restart, and each library keeps its own`.

### Task 2: "Your exact words are kept." on the filed card

D4. Owner item 4.

**Files:**
- Modify `apps/mac/src/shared/ipc.ts`: the `filed` state (:123-135).
- Modify `apps/mac/src/main/controller.ts`: `runFiling`'s filed card (:1793-1804).
- Modify `apps/mac/src/renderer/capsule/filed.tsx`: `FiledCard` (:36-48).
- Test: `apps/mac/e2e/capsule-results.spec.ts`.

**Interfaces (produces):**
- **The `filed` state gets `restored?: true`:** "The engine put the person's words back after the agent changed them (`FileOutcome.restored`, librarian.ts:53-54): the card says so in its head. Absent otherwise."
- **`runFiling`** sets it from `outcome.restored`: `...(outcome.restored ? { restored: true as const } : {})`.
- **`FiledCard`:** `<Card label="Thought" meta={state.restored ? "Your exact words are kept." : undefined} …>`, the card's caption slot (planner's call 9). The stamp, the footer and the words' lines stay as they are.
- **How a test makes the engine restore the words:** `FAKE_AGENT_MODE: "tamper"` files, then rewrites the capture (fake-agent.mjs:376). The engine puts the words back and reports `restored: true` (librarian-file.test.ts:166-174), and setup's tests already use it (setup-filed-ask.spec.ts:124-128). No new mode is needed.

- [ ] **Step 1: Write the failing tests** (capsule-results.spec.ts; invoke the `avanzel-ui` skill first):
  - "a filed card whose words the engine put back says so in its head: “Your exact words are kept.”". `setCapsule(filedCard({ restored: true }))`: `card.locator("header").getByText("Your exact words are kept.", { exact: true })` is visible, on one line (`getClientRects().length === 1`), in the same header as "Thought". The card still has its three rows and its Filed stamp. `filedCard({ noted: true, pages: [], restored: true })` shows the line too, over "Claude Code noted it in the log.", and `filedCard()` has none (`toHaveCount(0)`). `snap(capsule, "3-filed-card-kept")`.
  - "a filing whose agent rewrote the capture keeps the person's words, and its card says so". `launchOn(await makeLibrary(), { FAKE_AGENT_MODE: "tamper" })`, `dictate`, poll for filed. `capsuleStateForTests` matches `{ kind: "filed", restored: true }`, the line is visible, and the archived capture (`archived(library)[0]`) holds "Plant tulips in October" and not "rewritten by a careless agent". With `FAKE_AGENT_MODE` set back to `ok` at runtime, the next filing's state has no `restored` property, and the line is gone.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/capsule-results.spec.ts e2e/filing.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: the filed card says when your exact words were kept`.

### Task 3: Show the last receipt

D3. Owner item 2.

**Files:**
- Modify `apps/mac/src/main/undo-records.ts` (`FilingReceipt`, `UndoRecord.receipt`), `apps/mac/src/main/library-info.ts` (`captureWords`, after `captureMeta`, :173-186), `apps/mac/src/shared/ipc.ts` (the `filed` state's `reprint`) and `apps/mac/src/main/menu-model.ts` (`MenuInput.showableReceipt` after :53; the item and the invitation, :170-180).
- Modify `apps/mac/src/main/controller.ts`: the constants (:173), the fields (:402-413), `openLibrary`, `checkUndo`, `forgetFiling`, `menuAction` (:712-713), `menuInput` (:749-750), `setCapsule` (:923-964), `cardSound` (:1030-1033), `runFiling` (:1744, :1756-1761, :1776-1804), `undo` (:2559-2569), `undoLastFiling` (:2587), `tellUndone` (:2596-2607), `openFiled` (:2609-2613) and `openFiledPage` (:2623-2626).
- Modify `apps/mac/src/renderer/capsule/filed.tsx` (`FiledCard`, :36-48).
- Test: `test/undo-records.test.ts`, `test/library-info.test.ts`, `test/menu-model.test.ts`, and the `MenuInput` builders in menu-model.test.ts:8-28 and tray.test.ts:228-240 (`showableReceipt: false`). Also `e2e/capsule-helpers.ts` (`stampDay(day = new Date())`, :15-18), `e2e/menu-bar.spec.ts`, `e2e/capsule-results.spec.ts` and `e2e/sounds.spec.ts`.

**Interfaces:**
- **Consumes:** Task 1's `UndoRecordStore.patch`, `checkUndo`, `undoChecked()` and `forgetFiling`; Task 2's `restored`.
- **Produces:**
  - **`undo-records.ts`:**
    ```ts
    export interface FilingReceipt {
      /** Its commit; null when the run left none (a library without git, or auto_commit off): the reprint then offers no Undo. */
      commit: string | null;
      text: string;
      agent: string;
      seconds: number;
      /** New pages first (`filedPages`). */
      pages: FiledPage[];
      noted: boolean;
      restored: boolean;
      /** Date.now() as the filing ended: the reprint's stamp prints that day. */
      filedAt: number;
    }
    ```
    `UndoRecord` gets `receipt: FilingReceipt | null`. `normalizeUndoRecord` keeps a receipt only when it is whole: `commit` a commit or null; `text` and `agent` strings; `seconds` and `filedAt` finite and ≥ 0; `noted` and `restored` booleans; and every page `{ title, shelf, path }` of strings, with `created` a boolean when present. Anything else reads as `receipt: null`.
  - **`captureWords(file: string): string`** in library-info.ts: what follows the capture's frontmatter (`/^---\n[\s\S]*?\n---\n/`, as `captureMeta` reads it), trimmed; "" when the file can't be read.
  - **The `filed` state gets `reprint?: { filedAt: number }`:** "'Show the last receipt' put this card up again (`Controller.showLastReceipt`): its stamp is still and dated `filedAt`, and it makes no sound. Absent on the card a filing puts up."
  - **menu-model.ts:** `MenuInput.showableReceipt: boolean`. The item `{ type: "item", label: "Show the last receipt", action: "show-receipt" }` goes right before "Undo the last filing" (:180), and the invitation's condition (:170) adds `&& !input.showableReceipt`.
  - **Controller:**
    - `const FILED_SHOW_MS = 8_000;` beside `PICKED_SHOW_MS` (:173), used by `runFiling`'s card (:1803) too.
    - **`private lastReceipt: FilingReceipt | null`:** the open library's. It is loaded, checked, written and cleared with the other records.
    - **`private reprint: FilingReceipt | null`:** the receipt the capsule shows as a reprint. `setCapsule` sets it to null for every state; `showLastReceipt` sets it after its own `setCapsule`.
    - **`private filingRun: FilingJob | null`:** set right after `startRun(job)` (:1744), and null again first thing in the run's `catch` (:1756) and in its `finally` (:1759), before anything is shown.
    - **`runFiling`** (:1776-1783): a filing that ends ok and isn't setup's makes `{ commit: outcome.commit, text: job.text || captureWords(outcome.archivedTo ?? ""), agent: job.agent, seconds, pages, noted: pages.length === 0, restored: outcome.restored, filedAt: Date.now() }`. It is patched with Task 1's `filing` for `library.root`, and `lastReceipt` is set only while that library is open. (A background job's `text` is "", controller.ts:2079, and `archivedTo` is the archived capture's absolute path, vault.ts:232-244.) A failed, stopped or gone filing leaves the receipt as it was.
    - **`checkUndo`** also checks `lastReceipt.commit`: nothing to check when it is null, and the filing's answer when it is the same commit. A receipt that fails is dropped as the others are, behind the same identity guard.
    - **`forgetFiling(commit)`** also clears `lastReceipt` when its commit is `commit`, in the same patch and the same one rebuild.
    - **`private filingOrReviewGoing(): boolean`:** `this.queuedToFile.size > 0 || this.filingRun !== null || this.running.size > 0`.
    - **`private receiptShowable(): boolean`:** `this.lastReceipt !== null && this.undoChecked() && !this.quitting && !this.recording && this.capsuleState.kind !== "transcribing" && !this.filingOrReviewGoing()`. `menuInput` gives it as `showableReceipt`.
    - **`showLastReceipt(): void`,** the `"show-receipt"` menu action. It does nothing unless `receiptShowable()`. Otherwise it calls `setCapsule({ kind: "filed", text, agent, seconds, pages, canUndo, noted, ...(restored ? { restored: true } : {}), reprint: { filedAt } }, FILED_SHOW_MS)`, then sets `this.reprint`. `canUndo` holds when the receipt's commit is `lastFiled.commit` and `undoableFiling()`. It calls no `markFiled`, so the face doesn't stamp, and posts no notification. The pointer holds it as it holds every card (`keepOpen`, main.tsx:272, and `scheduleHide`, controller.ts:1035-1040), with no change there.
    - **`cardSound`:** no Stamp for `now.reprint`, and no Drawer for `was.reprint`.
    - **`undo()`:** while `this.reprint` is set, a press runs `undoLastFiling()` if the menu's Undo still offers the reprint's commit (`lastFiled?.commit === reprint.commit && undoableFiling()`). Otherwise the card says `undoRefused` (`this.fail(undoRefused)`), so its busy Undo never waits for ever.
    - **`tellUndone(job: FilingJob | undefined, undone: boolean, commit: string)`:** the capsule shows that filing when it shows a filed card and either `this.reprint?.commit === commit`, or there is no reprint and `this.job === job`. The Undone card's `text` is the reprint's when the card is the reprint. `undo()` and `undoLastFiling()` pass their commit.
    - **`openFiled()` and `openFiledPage()`** read the reprint's pages while it shows (`this.reprint ? this.reprint.pages : this.job?.pages`).
  - **`FiledCard`:** for a reprint, the stamp's day is `stampDate(new Date(state.reprint.filedAt))` (stamp.ts:15; `useStampDate()` is still called), and the Filed stamp's `animate` is `!state.reprint`.

- [ ] **Step 1: Write the failing tests.** Invoke the `avanzel-ui` skill before editing filed.tsx.
  - **undo-records.test.ts:** "keeps a library's receipt, and drops one that isn't whole". A whole receipt round-trips equal. Each of `seconds: "23"`, a page without `path`, `filedAt: -1` and `commit: "HEAD"` reads as `receipt: null`. `patch(a, { receipt: null })` leaves `filing` and `evening`, and a record with only a receipt stays in the file.
  - **library-info.test.ts:** "captureWords: a capture's words after its frontmatter, and nothing from a file that isn't there". `"---\nid: x\ntype: capture\nsource: text\n---\n\nPlant tulips in October\n"` gives "Plant tulips in October", and a missing file gives "".
  - **menu-model.test.ts,** `describe("Show the last receipt")`:
    - "sits right above Undo the last filing, after the recent pages": with both flags, `labels(...).slice(7, 13)` is `["Recently filed", "Launch the indie game dev podcast", "Маленький сад на балконе", "Show the last receipt", "Undo the last filing", "--"]`;
    - "is all the section holds where the invitation would be": `recent: []`, `filedToday: 0` and `showableReceipt: true` give `["Recently filed", "Show the last receipt", "--"]` at 7–10, and no "Nothing filed yet";
    - "is only there while a receipt can be shown";
    - "is an item that can be read, with no shortcut, shelf or sublabel": it equals `{ type: "item", label: "Show the last receipt", action: "show-receipt" }`.
  - **capsule-results.spec.ts:** "a reprinted filed card is the same card, its stamp still and dated the day it was filed". `day` is three days ago at noon; `setCapsule(filedCard({ reprint: { filedAt: day.getTime() }, restored: true }))`. The stamp `Filed, ${stampDay(day)}` is visible with no `data-animate`; the bar says "Filed by Claude Code in 23 s" with Hide, Undo and Open; there are three rows and the restored line. A noted reprint's stamp is `Noted, ${stampDay(day)}`. `snap(capsule, "3-filed-card-reprint")`.
  - **sounds.spec.ts:** "a reprinted receipt sends no Stamp as it shows and no Drawer as it goes". `soundsOn`, then a thought filed as in "with sounds on, each moment sends its sound, in order" (:130), and its card hidden. `watchSends`, `menuAction("show-receipt")`, poll for filed, then `dismiss`: `story(app, ["filed", "hidden"])` is `["state filed", "state hidden"]`.
  - **menu-bar.spec.ts.** Add `receiptItem` (the `show-receipt` item) and `showReceipt` (`menuAction("show-receipt")`).
    - "Show the last receipt reopens the last filing's card as a reprint, with its pages, Open and Undo". A git library, `stubOpening`, `filedFromTheCapsule`, `dismiss`, `showReceipt`. The state matches `{ kind: "filed", text: "Plant tulips in October", canUndo: true, noted: false, reprint: { filedAt: expect.any(Number) }, pages: [{ shelf: "ideas", created: true }] }`. The stamp `Filed, ${stampDay()}` has no `data-animate`, and `notificationsForTests` holds only what the filing posted. The page's title opens its page and the card stays; Open opens it and hides the card. Shown again, its Undo turns it to `{ kind: "saved", undone: true, text: "Plant tulips in October", note: UNDONE_NOTE }`, with no notification, and then neither the receipt item nor the Undo item shows.
    - "Show the last receipt survives a relaunch, and its Undo still takes the filing back and says so on the card": file, close, relaunch on the same user data, poll `receiptItem`. The reprint has `canUndo: true`, its Undo turns it to Undone, and `notified(app, "Undone")` is `[]`.
    - "Show the last receipt hides while a recording or a filing runs, and with no receipt; choosing it replaces the card that shows". A new library has no item. After a filing it shows. It hides while listening (`toggleDictate`, then `dismiss`), and while a second filing runs (`FAKE_AGENT_DELAY_MS` `"3000"` at runtime; the card says filing with no `waiting`), when `showReceipt` changes nothing. Over a Saved card (put up with `setCapsule`, as capsule-results.spec.ts's `savedCard` is), `showReceipt` puts up the reprint. Left alone, the reprint is still up at 5 s and hidden within 15 s.
    - "a filing that fails leaves the last receipt as it was, without its Undo, and the next that ends well replaces it": a filing, then `agentMode(app, "fail")` and a failed one. The reprint is the first one's page, with `canUndo: false`. With `agentMode(app, "ok")`, the next filing's reprint is its own page, with `canUndo: true`.
    - Extend 1d's "Undo from the menu follows the last filing: a note filed in the background…" (:1285): after the background filing's notification, `showReceipt` gives `{ kind: "filed", text: "Plant tulips in October", canUndo: true }` with its own page (the second idea). Then `dismiss`, and once its Undo has run, `receiptItem` is `undefined`.
    - Extend 1d's review loop (:1413-1447): the receipt item hides while the review waits and runs, and is back after it, with a reprint whose `canUndo` is `!ends`.
    - "Undo from the menu rebuilds the menu twice, as in 1d, and takes the receipt in the first": a git library, filed and dismissed; `countCalls(app, "refreshMenu")` (:138-153), then `pressUndo`: `calls(app, "refreshMenu")` is 2, and the receipt item is gone.
    - Extend Task 1's gone-commit test: no receipt item, and the saved record has no receipt. Extend "a take-back of the last filing's commit, which is what Stop and Edit make, takes the menu's Undo away" (:1545-1561): the receipt item goes with the take-back.
    - "Recently filed shows each page's shelf" (:952): after its filing, the section has a fourth item, `{ label: "Show the last receipt", action: "show-receipt" }`.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/menu-bar.spec.ts e2e/capsule-results.spec.ts e2e/sounds.spec.ts e2e/filing.spec.ts e2e/capsule-problems.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: Show the last receipt reopens the last filing's card, after a restart too`.

### Task 4: The Undo shortcut, ⌥⇧Z

D5. Owner items 1 and 3.

**Files:**
- Modify `apps/mac/src/shared/ipc.ts`: `Shortcuts` (:205-210) gets `undo`; `CapsuleState` gets `{ kind: "nothing-to-undo" }` after `shortcut-picked` (:203).
- Modify `apps/mac/src/main/store.ts` (`DEFAULT_SETTINGS.shortcuts`, :11-16), `apps/mac/src/main/shortcuts.ts` (`ACTION_NAMES`, :12-17; `ALTERNATIVES`, :76-81; `registerShortcuts`' loop, :132) and `apps/mac/src/main/menu-model.ts` (the Undo item, :180).
- Modify `apps/mac/src/main/controller.ts`: `NOTHING_TO_UNDO_MS` beside `PICKED_SHOW_MS` (:173), the handlers (:626-631) and `pressUndoShortcut`.
- Modify `apps/mac/src/renderer/capsule/copy.ts` (`stillInMenuLine`) and `apps/mac/src/renderer/capsule/main.tsx`: `nothingToUndoScene` beside `pickedScene` (:41-58), its `sceneOf` case (:64-89), and the taken notice's sentence (:162).
- Test: `test/shortcuts.test.ts`, `test/store.test.ts`, `test/menu-model.test.ts`, `test/capsule-copy.test.ts`, `e2e/shortcuts.spec.ts`, and `e2e/menu-bar.spec.ts` (:1156, :1304 and :1469, where the Undo item now has `accelerator: "Alt+Shift+Z"`).

**Interfaces:**
- **Consumes:** Task 3's `filingOrReviewGoing()`; 1d's `undoableFiling()` and `undoLastFiling()`.
- **Produces:**
  - **`Shortcuts.undo: string`**, defaulting to `"Alt+Shift+Z"`. `normalizeSettings` gives it to an older file through its loop over the defaults' keys (store.ts:41), unchanged.
  - **`ACTION_NAMES.undo = "Undo the last filing"`**, last. Settings → Voice draws its row from `Object.entries(ACTION_NAMES)` (Voice.tsx:111), unchanged.
  - **`ALTERNATIVES.undo = ["Control+Alt+Z", "Control+Alt+U"]`.**
  - **`registerShortcuts`** loops over `Object.keys(ACTION_NAMES) as (keyof Shortcuts)[]`, in place of the four (:132).
  - **The menu's Undo item:** `{ type: "item", label: "Undo the last filing", action: "undo-filing", ...shortcut("undo") }`.
  - **`{ kind: "nothing-to-undo" }`** is shown for `NOTHING_TO_UNDO_MS = 3_000`.
  - **`private pressUndoShortcut(): void`,** the `undo` handler:
    - with a filing to undo (`undoableFiling()`), `void this.undoLastFiling()`: one try, told once (the filed card turns to Undone, otherwise one notification);
    - nothing once Avanzel is quitting, while `filingOrReviewGoing()`, or while the capsule shows anything but `hidden`, `filed`, `saved`, `cancelled`, `recorded`, `shortcut-picked` or `nothing-to-undo` (a `ReadonlySet` beside `NOTHING_TO_UNDO_MS`);
    - otherwise `this.setCapsule({ kind: "nothing-to-undo" }, NOTHING_TO_UNDO_MS)`.
  - **`nothingToUndoScene(): Scene`:** `{ bar: { mood: "filed", line: "There's no filing to undo." } }`, with no actions.
  - **`stillInMenuLine(key: keyof Shortcuts): string`** in capsule/copy.ts. For `undo` it is "Pick another shortcut. “Undo the last filing” is in the menu bar after each filing."; for the others, `Pick another shortcut. “${ACTION_NAMES[key]}” is still in the menu bar.`. main.tsx:162 draws `{stillInMenuLine(state.key)}`.

- [ ] **Step 1: Write the failing tests.** Invoke the `avanzel-ui` skill before editing main.tsx and copy.ts.
  - **shortcuts.test.ts:** `handlers()` (:15) gets `undo: vi.fn()`, and the registered lists (:47, :58, :76) end with `"Alt+Shift+Z"`. Add:
    - "registers Undo the last filing fifth, so a clash names the earlier action": `{ ...DEFAULT_SETTINGS.shortcuts, undo: "Alt+Shift+A" }` gives `problems` `{ undo: "⌥⇧A is already the shortcut for Ask your library. Pick another shortcut." }`, and `taken` `[]`;
    - "offers ⌃⌥Z and ⌃⌥U in place of a taken ⌥⇧Z": `freeAlternatives("undo", DEFAULT_SETTINGS.shortcuts, api)` is `["Control+Alt+Z", "Control+Alt+U"]`.
  - **store.test.ts:** "an older settings file, with four shortcuts, gets ⌥⇧Z for Undo the last filing". `normalizeSettings` of a file with only the four gives them, plus `undo: "Alt+Shift+Z"`.
  - **menu-model.test.ts:** the `undo` item (:418) gets `accelerator: "Alt+Shift+Z"`. The test at :455-459 becomes "is an item that can be read, not dimmed, with its shortcut and no shelf or sublabel", and with `unregisteredShortcuts: ["undo"]` the item has no `accelerator`.
  - **capsule-copy.test.ts:** "stillInMenuLine: the taken notice's second sentence names where each item is", with both sentences above; add both to the design-rules `sentences` (:153-157).
  - **shortcuts.spec.ts** (`UNDONE_NOTE` as in menu-bar.spec.ts:1135):
    - "⌥⇧Z takes the last filing back, as the menu's Undo does, and says so once". A git library via `launchOn`, `watchUndos`, filed and dismissed. `pressShortcutForTests("undo")` is `true`; `undoCalls` is 1 (poll), and `notified(app, "Undone")` is `[{ title: "Undone", body: UNDONE_NOTE }]`. A second press shows `nothing-to-undo`, and `undoCalls` stays 1.
    - "with nothing to undo, ⌥⇧Z says so in a calm bar that goes by itself". In a new library, a press gives `{ kind: "nothing-to-undo" }`. The status region holds exactly "There's no filing to undo.", Zel's mood is `filed`, and the bar has no button. No notification is posted, and the capsule is hidden within 8 s. `snap(capsule, "capsule-nothing-to-undo")`.
    - "while a filing or a review runs, or over a recording, ⌥⇧Z does nothing". With `FAKE_AGENT_DELAY_MS: "3000"`, a press while the filing card shows leaves it filing (`undoCalls` 0). In a new library with one note in the inbox, a press while `runTask("evening-review")` runs leaves the capsule hidden, and a press while listening leaves it listening.
    - "Undo the last filing has its row in Settings → Voice, recorded and saved like the others". The group "Undo the last filing" shows ⌥⇧Z; Change, then Control+Alt+U, sets `snapshot().app.shortcuts.undo` to `"Control+Alt+U"`, and `pressShortcutForTests("undo")` still answers.
    - "a taken ⌥⇧Z gets the launch notice, with ⌃⌥Z and ⌃⌥U, and says where its item is". `AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Shift+Z"`: the notice says /⌥⇧Z is used by another app/ and, exactly, "Pick another shortcut. “Undo the last filing” is in the menu bar after each filing."; its buttons are `["Hide", "Use ⌃⌥U", "Use ⌃⌥Z"]`. Use ⌃⌥Z says "Undo the last filing now uses ⌃⌥Z".
  - **menu-bar.spec.ts:** the three `undoItem` expectations (:1156, :1304, :1469) get `accelerator: "Alt+Shift+Z"`.
- [ ] **Step 2: Run** `npx vitest run test/shortcuts.test.ts test/store.test.ts test/menu-model.test.ts test/capsule-copy.test.ts` from `apps/mac`. Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, typecheck and design:check. Then build and run `e2e/shortcuts.spec.ts e2e/settings.spec.ts e2e/menu-bar.spec.ts e2e/app.spec.ts`. Expected: they pass.
- [ ] **Step 5: Commit** as `mac: ⌥⇧Z undoes the last filing from any app`.

### Task 5: The whole branch, checked

- [ ] **Step 1: Run every check from the worktree root:** `npm test`, `npm run typecheck`, `npm run design:check` (the baseline stays `{}`) and `npm run ui:e2e`.
- [ ] **Step 2: Run the whole e2e suite** from `apps/mac`, once `pgrep -x Avanzel` prints nothing: `caffeinate -i npm run build`, then `caffeinate -i env -u AVANZEL_E2E_AGENT -u AVANZEL_E2E_PACKAGED -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=line`. Expected: no failures. Re-run each known flake once, and report the wall time.
- [ ] **Step 3: Take the shots** into `/Users/aksimemor/git-reps/avanzel/reports/Avanzel flight pack/shots/2a/`, with a README:
  - the reprinted card, in light and dark, with and without "Your exact words are kept.";
  - the fresh filed card with the line, and a noted card with it;
  - the "There's no filing to undo." bar, and the taken-⌥⇧Z notice;
  - Settings → Voice with its five rows, in light and dark;
  - the menu's text with "Show the last receipt" and "Undo the last filing ⌥⇧Z" (from `menuForTests`, as 1d did).

  Use a throwaway spec, archived as `.txt` in the flight pack's `archive/2a-work/` and never committed.
- [ ] **Step 4: The design review.** The controller runs the `design-reviewer` agent on filed.tsx, main.tsx, copy.ts and the shots, and rules on its list. Any fixes go in one commit, `mac: Undo that lasts reads as one design`.
- [ ] **Step 5: List the by-hand checks** in the flight pack as pending for the owner, never as done:
  - on the packaged review build, file a thought, quit and reopen: both Undo items and Show the last receipt are back, and each works, after a library switch and back too;
  - ⌥⇧Z with another app in front: it takes the last filing back and says so once; with nothing to undo, the bar shows; and that app no longer gets "¸" from ⌥⇧Z (owner item 1);
  - the reprint at the real panel, in light and dark: its stamp still, the head's line on one line beside "Thought", and Zel's hop (owner item 2);
  - VoiceOver reads the reprint's line and "There's no filing to undo." once each;
  - the menu shows ⌥⇧Z beside "Undo the last filing", and nothing beside "Show the last receipt".
- [ ] **Step 6: Docs.**
  - README: a row "⌥⇧Z | Undo the last filing, from any app." in the shortcuts table (:43-45); and in the Undo paragraph (:73-77), that both Undo items survive a quit, and that Show the last receipt reopens the last filing's card.
  - This plan: a "Built" list under "Where this plan sits", each task's text brought to what was built, and the owner items the work found.
  - The flight pack's docs are the controller's.
