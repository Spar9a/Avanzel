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
shelves or the rules; your agent reads it on every run.

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
- if the library is a git repo, each run is a commit you can inspect or revert (git hooks never run).
