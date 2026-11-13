# Your own shelves, and the librarian asking for one

Date: 2026-11-13. Status: design, waiting for the owner's approval.

## Why

On a work laptop the owner mentioned a project while noting a person, and no page was made for the project. The library has six
fixed shelves (goals, ideas, problems, memories, people, topics), and none of them is for projects, so the project became, at
best, a line on the person's page. The owner wants to add categories ("shelves") of their own, each with a short definition the
librarian follows. When a thought fits none of the shelves and the librarian believes a new one should exist, it should ask the
owner first and never make a shelf on its own.

## Goals

1. The owner can make a shelf in the app: a name and a one- or two-sentence definition ("Projects: work with a goal, people
   and a deadline"). They can edit its definition, and remove the shelf when it is empty.
2. Avanzel owns the shelf definitions. It writes them into the library's `AGENTS.md` and gives them to every filing run, and the
   librarian files onto your shelves exactly as it does onto the built-in ones.
3. When a thought fits no shelf, the librarian files it on the closest shelf now and may suggest a new one. The owner sees
   "Make a Projects shelf?" with Yes and No. Yes makes the shelf and moves the page there. No is remembered, so the same shelf
   isn't suggested again.
4. Your shelves show up in the app like the built-in ones: in Settings → General's shelf drawer, in the Library panel's shelf
   filter, and as a tag on each page.

## Non-goals

- Renaming or removing the six built-in shelves.
- A different colour or glyph for each of your shelves. They all share one look (see Constraints).
- Shelf-specific page formats (fields such as `deadline:` for projects). A definition is prose; the page format stays the one in
  `AGENTS.md`.
- Moving older pages onto a new shelf by itself. Only the page that prompted a suggestion is moved; the owner can ask for more
  in Ask.

## Anti-goals (a failure even if it works)

- The librarian makes a shelf, or edits `AGENTS.md`, without the owner saying yes.
- A thought waits unfiled while a question is pending.
- The same suggestion keeps coming back after the owner said no, or the owner gets more than one question for one filing.
- Avanzel overwrites words the owner typed into `AGENTS.md` themselves.

## How it works today (what this touches)

- Shelves: `SHELVES` in `packages/engine/src/core/vault.ts:37`. `Vault.shelfCounts()` already counts any extra top-level folder
  as a shelf (`vault.ts:287`). The library's rules say the owner may add a folder and describe it in the `AGENTS.md` table by
  hand (`packages/engine/templates/AGENTS.md`).
- `AGENTS.md`, `CLAUDE.md` and `.avanzel/config.toml` are protected: whatever a run does to them is put back
  (`packages/engine/src/core/guard.ts:13`). So only the app can write shelf definitions, and the librarian can't.
- `AGENTS.md` is written once, when the library is made. Older libraries keep their old copy, which is why the filing prompts are
  self-contained (`packages/engine/src/core/prompts.ts`: `CALL`, `FILES`).
- `meetings/` is already a shelf outside `SHELVES`: the call prompt makes it. It has the same gap in the panel as your shelves
  will have.
- The design system generates `SHELVES` from the tokens (`packages/ui/src/generated/tokens.ts:8`). Each built-in shelf has a
  colour token and a glyph (`packages/ui/src/components/Shelf.tsx`), and `apps/mac/src/main/shelf-glyphs.ts` copies the glyphs for
  the menu. The panel only tags and filters pages whose shelf is one of the six (`apps/mac/src/renderer/panel/main.tsx:33`), and
  it only lists pages from the six folders at all (`SHELF_FOLDERS` in `apps/mac/src/main/library-pages.ts:8`). Settings'
  "on six shelves" line counts only those six (`apps/mac/src/renderer/settings/copy.ts:40`).
- A filing run returns a `FileOutcome` (`packages/engine/src/core/librarian.ts:46`) with the agent's reply in `message`, and the
  capsule shows a filed card from it (`apps/mac/src/main/controller.ts`).

## Approaches considered

For what happens to a thought while the question waits (the owner chose **A**):

- **A. File now, ask after (chosen).** The librarian files the thought on the closest shelf and adds a suggestion to its reply.
  The owner answers whenever they like; Yes moves the page. Nothing waits on the owner, which fits capture-and-forget.
- B. Hold the thought in the inbox until the owner answers. Pages come out cleaner, but thoughts pile up unfiled whenever the
  owner is away from the Mac.

For where the definitions live:

- **Library settings, with a section in `AGENTS.md` written from them (chosen, my call).** The settings file is protected and
  already holds what Avanzel owns. The `AGENTS.md` section serves the other tools that read the library (Obsidian, or an agent the
  owner runs in the folder), and the prompt serves libraries with an old `AGENTS.md`.
- Only the `AGENTS.md` table, edited in place. This is fragile next to the owner's own edits, and old libraries' tables differ.

For how the librarian suggests a shelf:

- **A fixed line in its reply (chosen, my call).** For example `New shelf: projects | Projects | Work with a goal, people and a
  deadline. | projects/acme-launch.md`. Every agent (Claude Code, Codex, OpenCode, pi, Cursor, Gemini) can write a line, and no
  run needs new tools or write access to anything.
- A file the librarian writes, such as `proposals/`. This needs a new writable folder and a way to clean it up, and a stray file
  is easier to lose than a reply.
- A tool (MCP) the agent calls. Not every harness supports one, and MCP isolation in `harness.ts` is an open issue already.

## Design

### Shelf definitions (engine)

- New section in `.avanzel/config.toml`, read and written by `loadSettings`/`saveSettings`:

  ```toml
  # Your own shelves: a folder each, and what belongs on it. The librarian files on them as on the built-in ones.
  [[shelves]]
  folder = "projects"
  name = "Projects"
  definition = "Work with a goal, people and a deadline: what it is, who is on it, where it stands."

  # Shelves the librarian suggested and you turned down. It won't suggest them again.
  declined_shelves = ["side-quests"]
  ```

- Folder rules: lowercase kebab-case Latin letters, digits and dashes, at most 40 characters. It may not be a built-in shelf,
  one of `SPECIAL_DIRS`, or start with a dot. The app suggests a folder from the name (transliterated, as page slugs are); the
  owner can change it before saving and not afterwards. Name: one line, 1–40 characters. Definition: 1–300 characters, one
  paragraph. At most 20 shelves of your own.
- `meetings` counts as a built-in shelf for these rules. Its definition comes from Avanzel, and it gets the same look as your
  shelves (below) rather than a seventh colour.
- Making a shelf creates its folder (through `createInside`/`realFoldersTo`: real folders only, never through a link) and adds a
  heading for it to `index.md`. Removing one is only offered when its folder holds no pages; it deletes the empty folder and the
  entry.
- A folder the owner made by hand, which is already counted by `shelfCounts`, shows in Settings as "No definition yet" with an
  Add definition action. Until it has a definition it behaves as today.

### `AGENTS.md` section

- Avanzel keeps one marked section in the library's `AGENTS.md`, after the Layout table:

  ```markdown
  <!-- avanzel:shelves -->
  ## Your shelves
  | Path | Holds |
  |---|---|
  | `projects/` | Work with a goal, people and a deadline: what it is, who is on it, where it stands. |
  <!-- /avanzel:shelves -->
  ```

- Avanzel rewrites only what lies between the markers, and does so whenever the shelves change. If the markers are missing (an
  old library, or the owner removed them), it adds the section after the Layout table, or at the end when there is no table. It
  writes the file through the same safe-write path the scaffold uses, so `AGENTS.md` is never written through a symlink.
- The template's sentence "The owner may add shelves…" changes to say the app manages them and the librarian may suggest one
  (below). Older libraries get the new rule from the prompt.

### Filing prompt

- `filePrompt` gets the shelves of your own with their definitions, and the declined folders, as a self-contained note (like
  `CALL`). The text is fenced and named as data, as `SHOWN` is, since the definitions are the owner's text.
- It adds this rule, roughly: "File every thought on an existing shelf, the closest one if none fits well. Only when the thought
  clearly belongs to a kind of thing none of the shelves is for, and you expect more thoughts of that kind, end your reply with
  one line: `New shelf: <folder> | <Name> | <one-sentence definition> | <path of the page you made for this thought>`. At most
  one such line, and only when you made a page of its own for this thought (not a line on another page). Never suggest one of
  these, or the same kind of thing under another name: <built-in, your own, pending and declined shelves, each with its
  definition>. Never create the folder yourself."
- Ask and the evening review get the shelf definitions too (read only), and no suggestion rule.

### Reading a suggestion (engine)

- After a filing run, the librarian parses the reply's last `New shelf:` line into
  `FileOutcome.suggestion?: { folder, name, definition, page }`. It drops the suggestion when: the folder breaks the folder rules,
  already exists, or was declined; the page isn't a shelf page this run **created** (a page it only changed, such as a person's
  page, is never moved); the line is malformed. A dropped suggestion changes nothing about the filing itself. *(My call: only
  created pages, so Make shelf can't move a person onto Projects. The prompt says "make a page of its own for this thought".)*
- The definition comes from the agent, which read the capture, and it will end up in `AGENTS.md` as rules. So the engine cleans it
  before it is kept: one line, at most 300 characters, with no `|`, backticks, `<`, `>`, `[[`, or the marker text. The owner always
  sees it before saying yes (see below). *(My call.)*
- **Near-duplicates (my call).** The prompt lists every shelf, every pending suggestion and every declined one by name and
  definition, and says "never suggest one of these, or the same kind of thing under another name". The engine also drops a
  suggestion whose folder or name matches a declined or existing one when compared case-insensitively with a trailing `s`
  removed (`project` and `projects`). A suggestion that matches a pending one under the same rule joins it.
- **A folder the agent made without asking (my call).** After each filing run the engine compares the top-level folders with
  before. A new folder that isn't `meetings`, a special folder, or one of your shelves becomes a pending suggestion: its folder
  is the folder's name, it has no definition, and its pages are the pages in it. Its card and panel row offer only Edit first and
  No, so the owner writes the definition. Until they answer, it shows as a shelf with no definition, as a hand-made folder does
  today. No moves its pages to `topics/` (updating `shelf:` and `index.md`, in one commit) and removes the empty folder. The guard
  itself stays as it is.
- The run's own commit and the log line are as today. The suggestion is not written into the library.

### Saying yes or no (app)

- The filed card in the capsule gets a second line, "This might belong on a new shelf: Projects", with the definition under it
  (the owner reads what will go into `AGENTS.md` before saying yes), and Make shelf and Not now.
  A card holding a question stays twice as long as a plain filed card (16 s, and hovering keeps it as today); when it goes, the
  question stays in the panel. *(My call: a capsule that never hides would get in the way.)* A pending suggestion is also kept, one per folder, in the app's store (`store.ts`),
  and shown at the top of the Library panel ("Make a Projects shelf? Work with a goal, people and a deadline.") with Make shelf,
  Edit first and No.
- **Make shelf**: Avanzel makes the shelf (as above), moves the suggested page into the new folder, and sets its `shelf:` to the
  new folder. It moves the page's line in `index.md` under the new heading and appends a log line
  (`- YYYY-MM-DD HH:MM | shelf | projects → [[acme-launch]]`). All of that, including the settings, the `AGENTS.md` section
  and the new folder, is one git commit, which can be undone like a filing. *(My call.)* Undo takes it all back, and the
  suggestion is pending again. If the owner undoes or edits the filing that made the page while its suggestion is pending,
  that page leaves the suggestion, and a suggestion with no pages left is dropped.
  Wikilinks name the file, not its folder, so no link breaks. The move uses the existing inside-the-library safety, and refuses if
  a page with that name is already in the folder (the shelf is still made, and the page stays where it is).
- **Edit first** opens the Settings shelf form filled in with the suggestion, and Save does what Make shelf does.
- **No / Not now**: No adds the folder to `declined_shelves`. Not now (the capsule's button) leaves it pending in the panel. Both
  leave the page where the librarian put it.
- If a later filing suggests the same folder while one is pending, the newer page joins that suggestion and Make shelf moves all
  of its pages.
- The library lock is taken for Make shelf, as for any run that changes the library.

### Settings

- Settings → General, under the shelf drawer: a "Your shelves" group listing each shelf (name, definition, page count), with Edit,
  and Remove when empty. Add shelf opens a form: Name, Folder (suggested), What belongs on it. Copy follows `AGENTS.md`'s rules
  (sentence case, plain, no exclamation marks). Errors say what happened and offer one fix, for example "A shelf called projects
  already exists. Choose another folder name."

### The look (design system)

- One shared look for all shelves outside the six: one neutral colour token and one generic glyph, used by `ShelfTag`,
  `ShelfDrawer`, `PageRow`, the panel's filter, and the menu's copy in `shelf-glyphs.ts`. `ShelfTag` and friends take a shelf
  name string plus a `custom` variant instead of only the `Shelf` union. New variants get gallery entries in light and dark
  (`packages/ui/AGENTS.md`).
- **Needs the owner:** the colour token and new screenshot baselines are the owner's to approve (`npm run ui:approve`). The plan
  proposes a token value (a neutral already in the palette, if one passes the contrast tests) and stops for approval.

## Constraints

- Agents never write `AGENTS.md`, `config.toml` or a new shelf folder on their own; the guard stays as it is.
- Works the same with every supported agent. Nothing depends on a harness feature beyond a text reply.
- Windows are built only from `@avanzel/ui` components, and window CSS only arranges (`AGENTS.md`). `npm run design:check`
  passes.
- Libraries made before this change keep working with no migration step; the section and the settings appear the first time the
  owner adds a shelf, or a suggestion is accepted.

## Tests (what "done" looks like)

- Engine: settings round-trip with `[[shelves]]` and `declined_shelves`; folder rules; the `AGENTS.md` section written, rewritten
  and added when missing, with the owner's text outside the markers left as is; the prompt carries definitions and declined
  folders; suggestion parsing, including every reason to drop one; Make shelf moves the page, updates `shelf:`, `index.md` and
  the log in one commit, and Undo reverts it.
- App e2e (quiet project): add a shelf in Settings; a filing with a test-double agent reply that suggests a shelf shows the
  question on the card and in the panel; Make shelf moves the page; No is remembered and the next same suggestion is dropped; the
  panel filters and tags a page on your shelf.
- Gallery: the custom shelf tag, drawer entry and page row in light and dark.

## Left to the builder

- Exact copy beyond the lines above, within the copy rules.
- Where the pending suggestion sits in the store, and how the capsule card's wait interacts with the existing hover timing.
- The transliteration for the suggested folder (reuse whatever page slugs use, if the engine has it; otherwise a small table for
  Cyrillic).
