# Learn this library: Avanzel studies an existing second brain and files the way it does

Date: 2026-11-16. Status: draft for the owner's approval.

## Why

A person who already keeps notes (an Obsidian vault, a folder of Markdown) chooses that folder as their Avanzel library. Today Avanzel adds its own
folders beside theirs and the filing agent never learns that theirs exist: it is told only about the six shelves and the own shelves in
`.avanzel/config.toml` (`#shelfNotes`, `librarian.ts`), and AGENTS.md tells it never to make a top-level folder. Their folders show in Settings as
"No definition yet" until each is given one by hand. The first real user did exactly this with a Russian Obsidian vault: the thoughts were filed
well, but onto Avanzel's shelves, not into the structure they already had.

The owner wants one button: the agent reviews the whole structure and improves its own instructions, so new thoughts follow the person's approach,
while the person can still add new folders, and Avanzel's system folders stay.

## Goals

- One action, "Learn this library", that studies the library's existing folders and notes and proposes:
  1. a definition for each of the person's own top-level folders, which turns it into an own shelf (the existing own-shelf mechanism);
  2. a "house style": how notes in this library are written (file names, language, frontmatter, headings, links, tags, dates, daily notes),
     which the filing agent then follows when it writes pages.
- The person reviews the proposal on one screen and approves it. Nothing in the library changes before Apply.
- Works for a big vault: the study goes one folder at a time, shows progress, and can be stopped and resumed.
- Works with every agent Avanzel drives, including the 4B model hosted on the Mac.
- Can be run again later (the library grows, the style changes); a new run replaces the learned style and proposes definitions only for
  folders that still have none.

## Non-goals

- No moving, renaming or rewriting of the person's existing notes. The study only reads.
- No replacing of the six built-in shelves: Avanzel's folders are added as today (`inbox/`, `raw/`, `reviews/`, the six shelves).
- No nested-folder shelves: a shelf is a top-level folder, as today, and its whole tree belongs to it (Avanzel already counts and searches
  notes at any depth). Subfolders are described in the shelf's map (see "Shelves with subfolders").
- No parallel agent runs (approach C); maybe later as an option for cloud agents.
- No study of attachments' content (images, PDFs): they are counted and named only.

## Anti-goals (a failure even if it works)

- The agent changing the person's notes, or AGENTS.md being edited by the agent itself.
- A study that silently applies what it guessed.
- A run that costs a big vault's worth of tokens without the person knowing before it starts.
- The house style making filing worse for Avanzel's own shelves (it must not fight the page format in AGENTS.md: frontmatter fields Avanzel
  reads, `index.md` lines, `log.md`).

## Approaches considered

- **A. One run over a map.** Avanzel builds a compact map (tree, counts, the start of a few notes per folder) and one agent run proposes
  everything. Cheap and fast, but sees only samples and can misread big or mixed folders.
- **B. A loop, one folder at a time. (Chosen by the owner.)** Avanzel's code drives the loop: one read-only agent run per top-level folder,
  each reading more of that folder and returning a short summary; a final run combines the summaries into definitions and the house style.
  Thorough, resumable, shows progress, and each step is small enough for the Mac's 4B model.
- **C. B in parallel.** Faster on cloud agents, costs more and hits usage limits sooner; the Mac's model runs one at a time anyway. Not now.

Avanzel's own code orchestrates (not an agent orchestrating agents), so the run is the same on Claude Code, Codex, OpenCode and the hosted model.

## Design

### Where the button is

- **Settings → General → Your shelves**: a "Learn this library…" button in the group. When the library has top-level folders of the person's
  own with no definition, the group shows an info Notice above the list: "This library has folders of its own. Avanzel can study them and
  file the way you do." with the button as its action.
- **After setup** on a folder that had files (`libraryFolder()` said `has-files`): the panel shows the same offer once, as a card the person
  can dismiss. (Builder's call where exactly; the setup flow itself gets no new step.)
- Before it starts, the button's confirm says what it does and roughly what it costs: "Avanzel's agent reads your folders one at a time and
  proposes how to file into them. It reads up to N notes; nothing changes until you approve." N comes from the plan below.

### What the study reads (the plan)

Avanzel's code (not the agent) lists the library first:

- Top-level folders that are the person's own: every top-level folder except dot folders, `SPECIAL_DIRS` (`inbox`, `raw`, `reviews`, `tasks`),
  the built-in shelves, own shelves that already have a definition, and folders the person excluded on a previous review screen. Attachment
  folders (only non-Markdown files) are listed but get no folder step; the final step mentions them.
- For each folder: the number of notes, its whole subfolder tree (names and note counts, every level), and a sample of notes to read: the
  newest, the oldest and some in between, spread across its subfolders, up to a per-step cap (proposal: 12 notes, the first 2,000 characters
  each). The cap keeps a step inside the hosted model's window (65k tokens) with room to spare.
- A folder too big for one step (more notes or subfolders than one step's sample can fairly cover; the builder sets the threshold) is
  studied in parts: one step per subfolder (recursively, while a part is still too big), then a step that combines the parts into that
  folder's summary and map. It is the same loop, one level deeper; progress counts the parts.
- Loose notes at the top of the library (not in a folder) count as one more step, "notes at the top".
- Existing instruction files (`AGENTS.md` above Avanzel's sections, `CLAUDE.md`, `.obsidian/` settings such as the daily notes folder and the
  attachments folder) are read by Avanzel and given to the final step as context.

Avanzel passes each step its folder's listing and the sampled notes' text inside the prompt, so the agent needs no file access and runs
read-only (`write: false`, as Ask's read-only mode does). Note text is fenced as data, never as instructions (the vault is the person's, but a
note can hold anything).

### The loop

1. **Folder steps**, one per folder, in order of size, largest first (the most telling ones first if the person stops early). Each returns a
   small structured answer (a fenced JSON block; the prompt gives the shape):
   - `purpose`: one sentence, what belongs here, in the folder's own language;
   - `name`: a display name (default: the folder's name);
   - `conventions`: what the notes here have in common (file names, frontmatter keys, headings, templates, links, tags);
   - `map`: how its subfolders are organised, as a short outline with one line per pattern or notable subfolder ("one folder per school",
     "one folder per thinker, one note per book", "Concepts/: one note per idea"), empty for a flat folder;
   - `confidence`: high / low, and why when low (a mixed or near-empty folder).
2. **Final step**: given every folder summary, the top-level notes summary and the instruction files, it returns:
   - the definition for each folder (a one-line `definition` that keeps the shelf rules: no `|`, backticks, `[[`, line breaks; ≤300 chars);
   - the house style: a short Markdown section (proposal: at most ~40 lines) of rules for writing new pages in this library;
   - which built-in shelf, if any, overlaps a folder of theirs (e.g. their `Люди/` and Avanzel's `people/`), said as a rule in the house style
     ("thoughts about a person go to `Люди/`") rather than by removing the built-in shelf.
3. A step whose answer can't be read is retried once; a second failure marks that folder "not studied" and the loop goes on.

Progress shows in the panel as filing does ("Studying Projects, 4 of 12 folders"), with Stop. The study holds the library lock per step, not
for the whole run, so a thought recorded meanwhile is filed between steps. Each finished step's answer is saved under `.avanzel/study/`
(one JSON file per folder, plus the plan), so a stopped or crashed study resumes at the next folder; Start again discards them.

The study uses the library's filing agent and model (Settings → Agents), as every other run does.

### The review screen

When the final step is done, the person gets one screen (proposal: Settings → General, a form like the shelf form, opened from the panel's
"The study is ready" card):

- One row per folder: its name, the proposed definition (editable), its map (editable, shown when it has subfolders), the confidence, and a
  switch "File here" (on by default; off leaves the folder alone and remembers it as excluded). A "not studied" folder shows that, with no
  definition.
- The house style as editable text.
- **Apply** and **Discard**.

Apply, as one library operation (one commit, undoable like Make shelf):
- each switched-on folder becomes an own shelf with its definition and map (`makeShelf`, which already keeps an existing folder as it is;
  the map is a new optional field of an own shelf in config).
- the house style is written by Avanzel into AGENTS.md in a marked section `<!-- avanzel:style -->` … `<!-- /avanzel:style -->`, the way
  `withShelfSection` writes the shelves table, placed after the shelves section. It is also given to the filing agent in the filing prompt,
  next to `<shelves>`, so an agent that reads AGENTS.md late still has it.
- excluded folders are saved in config (like `declinedShelves`), so a later study leaves them out.

Settings shows the learned style afterwards with Edit and Remove; "Learn this library…" again runs a new study (it proposes definitions only
for folders still without one, and a fresh house style that the review screen shows next to the current one).

### What changes for filing

- `#shelfNotes` already includes own shelves; studied folders become own shelves, so the filing agent files into them with no new machinery.
- The filing prompt gets the house style. AGENTS.md's "Never create a top-level folder yourself" stays; new folders keep going through the
  existing "New shelf:" suggestion the person answers, which is how the person "can still add new folders".
- AGENTS.md's page format for Avanzel's own shelves stays authoritative; the house style applies to pages on the person's shelves. Where they
  conflict (say, the vault's notes have no frontmatter), the prompt says Avanzel's required frontmatter fields stay.

### Finding the note a thought belongs in (vaults with no index)

The motivating case: a vault such as Anastasia's, with few, big notes in plain Obsidian Markdown that she adds to over time, and no
`index.md` lines for them. Today the filing agent reads `index.md` first, which lists only Avanzel's pages, so it never finds her notes,
though every agent Avanzel drives has text search tools (Claude Code's Grep, pi's grep and find).

- **Avanzel searches before the run.** For each filing, Avanzel's code searches the learned shelves' notes with the thought's words (the
  engine's keyword search in `search.ts`, used by Ask today) and puts the best ~5 candidates in the filing prompt as data: path, title, the
  heading outline, and the matching passages. Not whole notes: a big note would fill the hosted model's window. The agent picks one to add to,
  or makes a new page. It keeps its own search tools for anything Avanzel's search missed.
- **Search that copes with word endings.** Matching by word stem (Russian "проект", "проекта", "проектом"), not whole words only; Ask gains
  it too. Meaning-based search (embeddings) is later, not this feature.
- **The note's own pattern.** For each candidate, Avanzel's code reads how the note is added to and gives it to the agent:
  - its last two or three entries, verbatim (a dated heading and its first lines, dated bullets, callouts, checklist lines);
  - the date format its entries use, detected from them (`## 16.11.2026`, `- 2026-11-16 —`), with today's date already written that way;
  - where additions go: at the end, under a fixed heading (`## Log`), or at the top (newest first).
  The agent writes its addition the same way, in the same place.
- **The study's habits.** The house style records the library's habit ("adds to big notes rather than making new ones"), which sets the
  agent's default between adding and creating.

### Shelves with subfolders

A shelf such as `Philosophy/` with `Stoicism/Seneca/…` inside is one shelf; its map (from the study, editable in Settings) tells the
filing agent how the tree is organised. Filing follows it: Avanzel's search finds candidates anywhere in the tree; the agent adds to the
matching note, or creates a new page in the subfolder the map points to.

**New subfolders are created automatically (owner's decision)** when they follow the map's pattern: a thought about Epictetus, who has no
folder yet under "one folder per thinker", gets `Philosophy/Stoicism/Epictetus/`. The filed card names it ("New folder: Epictetus") and its
Undo removes the folder with the page. A new top-level folder still goes through the "New shelf:" question, as today.

### No limit on the number of own shelves (owner's decision)

`MAX_OWN_SHELVES` (20) goes, in the engine (`makeShelf`, the config reader) and anywhere the app mirrors it. Nothing recorded why it was
there; what it protected is handled instead:
- **The filing prompt stays short.** Every shelf keeps its name and one-line definition in `<shelves>`; maps go in only for the shelves
  where Avanzel's search found candidate notes, so the prompt grows with what is relevant, not with the vault.
- **Few shelves anyway.** Shelves are top-level folders only; a deep vault becomes a few shelves with maps.
- **The screens cope with a long list.** The builder checks Library's shelf tabs, Settings' list and the AGENTS.md table with 50 shelves;
  a tab row that overflows is made to scroll in `packages/ui`, with a gallery entry, for the owner to approve.

### Old notes: add, never rewrite

Notes that were in a folder before its Apply are the person's writing. The agent may insert new text anywhere in such a note (under the
right heading, at the end, at the top) but every line that was there stays, unchanged and in order. After each run, Avanzel checks every
such note the run changed: if the old lines are no longer all there, in order, the note is put back as it was and the filing says so. The
weekly review leaves old notes alone (no added links). Avanzel's own required frontmatter is added only to pages it creates. A folder
switched off on the review screen is kept out of entirely: the agent may not write in it, enforced the same way.

### System folders and name clashes

- Avanzel keeps adding `inbox/`, `raw/`, `reviews/` and the six shelves, as today.
- The study never proposes a system or built-in folder as a shelf (the folder rule already refuses them).
- A vault that already had `tasks/`, `inbox/`, `raw/` or `reviews/` of its own (found at study time with notes that aren't Avanzel's) is named
  on the review screen as a problem with no fix in this feature: "Your tasks folder has the name Avanzel uses for its own tasks." Fixing such
  clashes is out of scope (noted for later).

## Constraints

- The guard: the agent may not write AGENTS.md, `.avanzel/` or the person's words; the study runs read-only, so the guard has nothing to undo.
  Avanzel itself writes AGENTS.md's section and `.avanzel/study/`.
- Privacy: in a private library (`settings.private`) the study uses the private model like every other run; note text leaves the Mac only
  as filing would send it with the chosen agent.
- Copy follows `packages/ui/DESIGN.md` and AGENTS.md's copy rules; the screens use `@avanzel/ui` components only (Notice, Group, GroupRow,
  Switch, TextArea, Button, Progress). Any missing component is added in `packages/ui` with a gallery entry, for the owner to approve.
- Unit tests for the plan, the answer parsing and the Apply operation; e2e with the engine's fake agent for the whole loop, a resume and Apply.

### Claude's calls after the builder check

- **index.md.** Apply adds no `index.md` lines for the notes already in the adopted folders: a vault of thousands of notes would fill the
  index and the hosted model's window on every filing. Instead the filing prompt tells the agent that a shelf learned from the library holds
  notes that aren't in `index.md`, and to search that folder (by file name and text) before creating a page. The review prompt is told not to
  "fix" missing index lines for notes older than the shelf's Apply (Apply records its date per shelf in config).
- **A second study.** It studies every own folder again for the house style (the style should follow the whole library as it grows), but
  proposes definitions only for folders that have none; the current style is given to the final step, and the review screen shows the new
  style beside the current one. The cost line counts every folder.
- **A vault with its own AGENTS.md or CLAUDE.md.** Merging Avanzel's rules into a person's own instruction files is out of scope here (it is
  a gap that exists today, for later). The house style always reaches the agent through the filing prompt block; the AGENTS.md section is
  written only when AGENTS.md has Avanzel's markers, else it is left out and the review screen says the style lives in Avanzel's settings.
  The style is also kept in `.avanzel/config.toml`, the source the prompt block reads.
- **Branch.** Built on top of the onboarding-fixes branch (any-language shelf folders), or after it is merged.

## Decided

- Approach B, driven by Avanzel's code (owner).
- The person approves before anything is applied (owner).
- Avanzel's system folders and the six shelves stay (owner).
- The person's folders become own shelves; the style becomes a marked AGENTS.md section plus a prompt block (Claude's call, owner agreed to
  "improve its prompt").
- Avanzel searches the person's notes by text before each filing and gives the agent each candidate note's own entry pattern, so additions
  match what is there (owner).
- A shelf's whole tree belongs to it, described by a map; new subfolders that follow the map are created automatically, with Undo (owner).
- No limit on own shelves (owner).

## Left to the builder

- Exact caps (notes per folder, characters per note) within the hosted model's window; the cost line's wording.
- The prompt texts (`templates/prompts/study-folder.md`, `study-combine.md`), within the shapes above.
- Exactly where the post-setup offer appears.
- Names of new IPC calls and engine methods.
- How many search candidates go in the prompt and how long each passage is; the stemming method (a light suffix-stripping stemmer for
  Russian and English, or prefix matching), as long as it needs no model.
- How an entry and its date format are detected, within the cases listed above; a note with no recognisable pattern gets none.
