# Avanzel

**A voice-first second brain that runs on the AI agent you already pay for.**

Say a thought out loud, or type it. A small open-source speech model transcribes it **on your
machine**. Then the agent you already have — Claude Code, Codex, OpenCode or Cursor Agent —
acts as your librarian: it files the thought onto the right shelf of your private library
(goals, ideas, problems, memories, people, topics), links it to what you already know, and later
answers your questions about it.

No new subscription, no new cloud, no lock-in: your library is a folder of Markdown files you can
open in Obsidian, and Avanzel is a thin "harness over harnesses" that orchestrates local speech
models and your existing agent CLI.

```
 voice ─► local Parakeet / Whisper ─┐
 text ─────────────────────────────┤► inbox/ ─► your agent (claude · codex · opencode · cursor-agent)
 audio file ───────────────────────┘                │ files it onto shelves, links pages,
                                                     ▼ updates index.md and log.md
                     goals/  ideas/  problems/  memories/  people/  topics/   (plain Markdown, git-versioned)
```

It combines three ideas:

- **Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** —
  immutable raw sources, an LLM-maintained Markdown wiki, a schema file (`AGENTS.md`), and the
  ingest / query / lint loop with `index.md` and `log.md`.
- **[FluidVoice](https://github.com/altic-dev/FluidVoice)-style local dictation** — NVIDIA
  Parakeet TDT v3 (25 European languages) or OpenAI Whisper, running offline via
  [onnx-asr](https://github.com/istupakov/onnx-asr).
- **[T3 Code](https://github.com/pingdotgg/t3code)'s "harness over harnesses"** — don't build
  another agent; drive the ones the user already trusts and pays for.

## Install

Requires macOS or Linux, [uv](https://docs.astral.sh/uv/), and at least one agent CLI that is
logged in (`claude`, `codex`, `opencode` or `cursor-agent`). `ffmpeg` is optional (needed for
m4a/mp3/ogg voice memos).

```bash
git clone <this repo> avanzel && cd avanzel
uv tool install .            # puts `avanzel` on your PATH
avanzel init                 # creates ~/Avanzel (or: avanzel init ~/path/to/library;
                             #   --force to adopt an existing folder such as an Obsidian vault)
avanzel skills install       # optional: lets your agents use the library from any session
```

The first voice transcription downloads the speech model (~670 MB, once).

## Use it

```bash
avanzel add "I want to run a marathon next spring, but my knee hurts after 5 km"
avanzel record                         # speak, press Enter; transcribed locally, then filed
avanzel add --audio ~/Downloads/memo.m4a
avanzel ask "what are my health goals and what's blocking them?"
avanzel ask --save "summarize my ideas about the garden"   # files the answer back as a page
avanzel review                         # stale goals, contradictions, orphans → reviews/<date>.md
avanzel chat                           # open your agent inside the library and just talk
avanzel search marathon                # instant keyword search, no agent run
avanzel status                         # library, inbox, agent and voice setup
```

| Command | What it does |
|---|---|
| `init [PATH]` | Create the library (layout, `AGENTS.md` schema, config, git). |
| `add [TEXT…]` | Capture text (or stdin, or `--audio FILE`) and file it. `--no-file` only captures; `--background` files asynchronously. |
| `record` | Dictate from the microphone; Enter or Ctrl-C stops. Same filing options. |
| `transcribe FILE` | Local speech-to-text only; prints the text. |
| `file` | File everything waiting in `inbox/` (audio dropped there is transcribed first). |
| `ask QUESTION` | Answer from the library with `[[citations]]`; read-only unless `--save`. |
| `review` | Health check written to `reviews/YYYY-MM-DD.md`. |
| `chat` | Your agent's own interactive UI, opened in the library. |
| `search`, `status`, `where` | Keyword search, overview, library path. |
| `skills install` | Install the Avanzel skill for detected agents (`--target claude\|agents\|cursor\|all`). |

Global options: `--vault PATH` (or `$AVANZEL_VAULT`), `--harness NAME`, `-v` to see agent output.

Tip: drop phone voice memos into `inbox/` (e.g. via iCloud Drive or Syncthing) and run
`avanzel file` — they are transcribed and filed like everything else.

## Agents

Avanzel runs your agent non-interactively, inside the library folder, with the narrowest
permissions each CLI offers:

| Agent | How Avanzel runs it |
|---|---|
| Claude Code | `claude -p … --tools Read,Write,Edit,Glob,Grep --permission-mode acceptEdits --strict-mcp-config`: file tools only, no shell, no web, none of your MCP servers (read-only tools for `ask`) |
| Codex | `codex exec --cd <library> --sandbox workspace-write` (`read-only` for `ask`) |
| OpenCode | `opencode run --dir <library>`; the library's `opencode.json` denies bash and web access |
| Cursor Agent | `cursor-agent -p --force` (without `--force` for `ask`); untested so far |
| Gemini CLI | `gemini -p … --approval-mode auto_edit`; experimental, untested |

`harness = "auto"` picks the first installed of claude → codex → opencode → cursor-agent → gemini.
Configure it in `<library>/.avanzel/config.toml`, including a cheaper model per agent and any
other CLI:

```toml
harness = "codex"

[models]
claude = "sonnet"

[harnesses.my-agent]
headless = ["my-agent", "run", "{prompt}"]
interactive = ["my-agent"]
```

## Voice

| Model (`[voice] model = …`) | Languages | Notes |
|---|---|---|
| `nemo-parakeet-tdt-0.6b-v3` | 25 European languages, incl. English, Russian, Ukrainian | default, int8 ≈ 670 MB |
| `nemo-parakeet-tdt-0.6b-v2` | English | |
| `onnx-community/whisper-large-v3-turbo` | ~100 languages | |
| `whisper-base` | many | small and fast |
| `gigaam-v3-rnnt` | Russian | |

Long recordings are split with the Silero VAD. Prefer another engine (whisper.cpp, mlx-whisper)?
Use the command backend:

```toml
[voice]
backend = "command"
command = ["whisper-cli", "-m", "/path/to/ggml-large-v3-turbo.bin", "-nt", "-f", "{audio}"]
```

## The library

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

## Privacy

Audio and transcription never leave your machine. Filing and asking send the capture text and the
relevant pages to whichever model your agent CLI uses — the same trust you already give it for
code. Nothing else is uploaded; there is no Avanzel server.

## Troubleshooting

- **An agent fails or hangs.** Run it once on its own (`claude -p hi`, `codex exec hi`,
  `opencode run hi`); usually it is not logged in, or its default model is unavailable. Give
  Avanzel a working model in `.avanzel/config.toml` → `[models]` without touching the agent's own
  settings, e.g. `codex = "gpt-5.6-luna"` or one of OpenCode's free models,
  `opencode = "opencode/deepseek-v4.1-flash-free"` (no paid subscription at all). A stuck run is
  stopped after `timeout_seconds` (15 minutes by default).
- **`record` hears nothing.** Give your terminal app microphone access (System Settings →
  Privacy & Security → Microphone).
- **m4a / mp3 / ogg won't transcribe.** Install `ffmpeg`.
- **Undo an agent's edit.** `git -C ~/Avanzel log`, then `git -C ~/Avanzel revert <commit>`.

## Development

```bash
uv sync
uv run pytest                                              # fast suite, no network or models
AVANZEL_TEST_ASR=1 uv run pytest tests/test_integration.py  # real Parakeet (macOS `say` voices)
AVANZEL_TEST_HARNESS=claude uv run pytest tests/test_integration.py -k harness   # real agent run
```

Design: [`docs/superpowers/specs/2026-10-20-avanzel-design.md`](docs/superpowers/specs/2026-10-20-avanzel-design.md).
