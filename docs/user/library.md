# The library

```
AGENTS.md      the rules your agent follows (CLAUDE.md imports it for Claude Code)
index.md       one line per page, by shelf
log.md         append-only history: - 2026-10-20 14:03 | file | [[capture]] → [[page]]
inbox/         captures waiting to be filed
raw/           your original words, archived by month (never edited); raw/audio/ recordings
goals/ ideas/ problems/ memories/ people/ topics/    one Markdown page per thing
reviews/       health-check reports
```

Pages use YAML frontmatter (`title`, `shelf`, `status`, `tags`, `sources`) and `[[wikilinks]]`, so
Obsidian's graph view, backlinks and Dataview work out of the box. Edit `AGENTS.md` to change the
rules; your agent reads it on every run. Its "Your shelves" section is Avanzel's: change your own
shelves in Settings (see below).

Avanzel enforces a few guarantees no matter how the agent behaves:

- in the Mac app, a Claude Code write to `inbox/`, `raw/`, `tasks/`, any file or folder whose name
  starts with a dot (`.obsidian/` too), the files listed below or anywhere outside the library is
  refused before it happens. So is a write to any file named `CLAUDE.md`, `CLAUDE.local.md` or
  `AGENTS.md`, in any folder, because Claude Code reads such files as instructions. The reason the
  agent is told, and the refusal of anything outside the library, come from a hook: before each
  write, Claude Code asks the app on 127.0.0.1, with a token only that run has, and the app listens
  only while the run lasts. From Claude Code 2.1.295 on, a write is refused when the app doesn't
  answer; older versions let it through then, and versions before 2.1.63 have no such hook. Claude
  Code skips hooks under `--bare` or with `disableAllHooks`, and then only the deny rules for the
  paths listed here hold;
- your captured words are restored byte-for-byte if the agent touches them;
- a capture is archived only after a run that actually filed it (an agent that only talks
  leaves it in the inbox), and never over an earlier capture with the same name;
- every filing gets a `log.md` line;
- the library's rules and anything that configures or runs code (`AGENTS.md`, `CLAUDE.md`,
  `.avanzel/config.toml`, `.avanzel/learned-notes.json`, `.avanzel/study/`, `opencode.json`,
  `.mcp.json`, `.git/config`, `.git/hooks`, agent dot-folders) are put back after every run, so text in a capture can't plant instructions or
  commands for later runs; edit those files yourself while no agent run is active, or in
  `avanzel chat`;
- an old note on a learned shelf is put back if a run rewrites it: a run may add lines to one of your
  notes there, but if any line that was in it is changed, moved or gone, the whole note is put back as
  it was and the filing says so. A folder you left out is put back the same way, whatever a run wrote
  in it (see "Learn this library" below);
- if the library is a git repo, each run is a commit you can inspect or revert (git hooks never run);
- while "Let your other agents use this library" is on (Settings → Agents), the agents you connect can
  read the library, unfiled captures and call notes included, and what they read goes to their
  providers. They can't change or delete anything themselves: a note they leave is a capture in
  `inbox/` marked `source: agent`, with the `agent` that wrote it, and the librarian decides what to
  file and files it as theirs, never as yours. See [Your other agents and the library](agents-and-mcp.md).

## Your own shelves

Besides the six shelves, you can have shelves of your own, such as `projects/` or `recipes/`. A shelf
has a name, a folder (named in any language, such as `Проекты` or `my projects`) and a line on what
belongs on it. A folder name can't hold `/ \ : * ? " < > | [ ] # ^` or a backtick. Own
shelves share one brown look in Library and on the filing card.

Add one in Settings → General → "Your shelves": give it a name, a folder and "What belongs on it". You
can edit a shelf later. You can remove it only while it holds no pages; any other files in its folder
stay, and so does the folder. A folder you made by hand shows "No
definition yet" until you choose "Add definition".

The definitions live in `.avanzel/config.toml`, as `[[shelves]]`. Avanzel also writes them into a
marked "Your shelves" section of the library's `AGENTS.md`, so every filing is told about them. Edit
the definitions in Settings, not in that section: Avanzel rewrites it. The rest of `AGENTS.md` stays
yours.

A shelf is a folder at the top of the library, and everything inside it belongs to it, at any depth.
A shelf that has subfolders can have a map: a few lines on how they are used, such as "one folder per
thinker" or "Concepts/: one note per idea". Learn this library writes the maps (you can change them
on its review screen); they are kept as `map` in the shelf's `[[shelves]]` entry, and listed under
the table in the "Your shelves" section of `AGENTS.md`. The librarian follows a map when it files: it
adds to the note a thought belongs in, or makes a new page in the subfolder the map points to. When a
thought needs a subfolder the map's pattern calls for and it isn't there yet (a new thinker, say), the
librarian makes it; the filing card says "New folder: <name>", and its Undo takes the folder away with
the page. A new folder at the top of the library is still a suggestion you answer, as below.

### When the librarian suggests a shelf

When a thought fits no shelf, the librarian files it on the closest one and may suggest a new one.

- The filing card says "This might belong on a new shelf: <name>" and shows the definition. Choose
  "Make shelf" or "Not now". "Not now" leaves the question in Library.
- Library asks "Make a shelf called <name>?" with "Make shelf", "Edit first" and "No".
- "Make shelf" makes the shelf and moves that page onto it. "Undo" takes it back, and Library asks again
  when it can.
- "No" is remembered in `declined_shelves` in `.avanzel/config.toml`, so the librarian doesn't suggest
  that shelf again. There is no button to take a No back: edit `declined_shelves` by hand, while no
  agent run is active.

If the librarian makes a folder itself, the card says "The agent started a shelf called <folder>." Choose
"Edit first" to say what belongs on it, or "No" to turn it down. Turning it down moves its pages to
Topics, and removes the folder once nothing else is in it.

## Learn this library

If you chose a folder that already holds notes of yours, such as an Obsidian vault, Avanzel can study
it and file the way you do. Choose "Learn this library…" in Settings → General → "Your shelves" (Library
offers it too, once, after setup). Before it starts, it says how many notes and folders it will read,
in how many runs.

- **It only reads.** Your filing agent reads your folders one at a time, a sample of up to 12 notes in
  each run, and proposes what belongs in each folder and how the library is written. Nothing in your
  folders changes while it studies. Avanzel checks every run: if the agent changed a file anyway, the
  file is put back from git (what it held is kept in `.avanzel/logs/study/`), or, without git, the study
  stops and names the files for you to check.
- **It can stop and go on.** Stop keeps what was studied so far, and "Learn this library…" goes on from
  there. A thought you record meanwhile is filed between two runs. What the study learns is kept in
  `.avanzel/study/` until you apply or discard it.
- **You review it first.** When it is done, Settings shows each folder with "File here", what belongs on
  it and its map, and the house style it wrote. Change anything, then choose "Apply", or "Discard".
- **Apply is one change, and Undo takes it back.** Each folder you file into becomes one of your shelves.
  Your notes stay where they are, and no `index.md` lines are added for them: the librarian searches
  those shelves before it makes a page, and adds to the note a thought belongs in.
- **A folder you turn off is left out.** It is listed as `excluded_folders` in `.avanzel/config.toml`:
  the librarian is told to stay out of it, anything a run writes there is put back, and a later study
  leaves it alone. A folder that wasn't studied and that you didn't touch is not left out; the next
  study reaches it. To bring a folder back, give it a definition in "Your shelves" ("Add definition"),
  or take it out of `excluded_folders` while no agent run is active.
- **The house style** is how notes in this library are written (file names, language, headings, dates).
  It is kept as `house_style` in `.avanzel/config.toml` and given to the librarian with every filing. If
  `AGENTS.md` has Avanzel's sections, it is also written there as "How this library is written"; an
  `AGENTS.md` of your own is left as it is. Edit or remove the style in "Your shelves". Avanzel's own
  page format still holds for the pages it makes.
- **Your notes stay yours.** Every note on a learned shelf is yours, whether it was there before the
  study or you wrote it later, except the pages Avanzel made there itself. The librarian may only add to
  your notes, and a note a run rewrote is put back. The pages Avanzel made are listed in
  `.avanzel/learned-notes.json` (beside the notes that were there when the shelf was first learned);
  don't edit that file, Avanzel keeps it and puts it back after every run.

You can run "Learn this library…" again later. It proposes definitions only for folders that still have
none, and a fresh house style, shown next to the one in use.
