# Command line (Python, v0.1)

Requires macOS or Linux, [uv](https://docs.astral.sh/uv/), and at least one agent CLI that is
logged in (`claude`, `codex`, `opencode` or `cursor-agent`). `ffmpeg` is optional (needed for
m4a/mp3/ogg voice memos). The CLI and the Mac app read and write the same library format.

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
