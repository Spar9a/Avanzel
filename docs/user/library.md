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
  `.avanzel/config.toml`, `opencode.json`, `.mcp.json`, `.git/config`, `.git/hooks`, agent
  dot-folders) are put back after every run, so text in a capture can't plant instructions or
  commands for later runs; edit those files yourself while no agent run is active, or in
  `avanzel chat`;
- if the library is a git repo, each run is a commit you can inspect or revert (git hooks never run);
- while "Let your other agents use this library" is on (Settings → Agents), the agents you connect can
  read the library, unfiled captures and call notes included, and what they read goes to their
  providers. They can't change anything: a note they leave is a capture in `inbox/` marked
  `source: agent`, with the `agent` that wrote it, and the librarian files it as theirs, never as
  yours. See [Your other agents and the library](agents-and-mcp.md).

## Your own shelves

Besides the six shelves, you can have shelves of your own, such as `projects/` or `recipes/`. A shelf
has a name, a folder (lowercase letters, digits and dashes) and a line on what belongs on it. Own
shelves share one brown look in Library and on the filing card.

Add one in Settings → General → "Your shelves": give it a name, a folder and "What belongs on it". You
can edit a shelf later. You can remove it only while it holds no pages; any other files in its folder
stay, and so does the folder. A folder you made by hand shows "No
definition yet" until you choose "Add definition".

The definitions live in `.avanzel/config.toml`, as `[[shelves]]`. Avanzel also writes them into a
marked "Your shelves" section of the library's `AGENTS.md`, so every filing is told about them. Edit
the definitions in Settings, not in that section: Avanzel rewrites it. The rest of `AGENTS.md` stays
yours.

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
