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

## Avanzel for Mac

A menu-bar app (Electron + TypeScript, `apps/mac`) on a TypeScript port of the engine
(`packages/engine`). No main window, and no Dock icon once setup is done: it lives in the menu bar
and wakes up on a shortcut.

| Shortcut | What happens |
|---|---|
| ⌥Space | Start talking; press again to stop. A capsule above the Dock shows the waveform, then the transcript while your agent files it, then the pages it touched, with Undo and Open. Esc cancels. |
| ⌥⇧S | Capture the screen and say why it matters. The screenshot, the app, the page and your comment wait in the inbox for the evening review. |
| ⌥⇧Space | Type a thought. |
| ⌥⇧A | Ask your library; the answer links to the pages it used. |

The **evening review** (a scheduled review, 21:00 by default) files the day's inbox, writes a
summary to `reviews/`, and can be taken back with **Undo the last evening review** in the menu bar
menu. A **weekly review** looks over the whole library. Scheduled reviews are Markdown files in
`tasks/`; edit their times, agents and instructions in Settings → Reviews (a file Avanzel can't
read is listed there with what is wrong with it).

Good to know:

- **Esc** cancels a dictation from any app while Avanzel is listening (it is a global shortcut
  for that moment only), and the recording is dropped.
- **A shortcut another app holds** does nothing when pressed (⌥Space is also the default of
  Alfred, Raycast, ChatGPT and Superwhisper). When macOS reports a shortcut as taken, the capsule
  names it once, as soon as there is a library, with the app that probably holds it and two free
  shortcuts to pick; Settings → Voice offers the same, and the menu bar menu stops showing the
  taken one. macOS can't always tell, so if ⌥Space opens another app, pick another shortcut in
  Settings → Voice.
- **Setup** checks that ⌥Space really reaches Avanzel. When another app holds it, or you reach
  for it in the setup window (⌥ goes down) and no press follows within 3 s, it names the likely
  app and offers two free shortcuts. Reading, thinking or typing there never brings that up.
- **Edit** works for as long as your agent is filing: it stops the agent at once. When you file
  the corrected words (or cancel), whatever that run already changed is undone first, then the note
  is filed again. An edit survives quitting and a new dictation (your words wait in the inbox), and
  the evening review leaves a note you are editing alone.
- **Screen Recording**: macOS applies the permission only to a fresh start of the app. After you
  allow Avanzel in System Settings → Privacy & Security → Screen Recording, quit and reopen it.
- **Quitting** while your agent is filing stops the agent; what it had changed is kept as its own
  commit (in a git library) and the note stays in the inbox for the evening review.
- **Ask** waits for a filing in progress, and says so. A note you dictate while your agent answers
  waits for the answer, and says so too. Stop, or closing the Ask window, gives the question up and
  stops your agent.
- **Settings → Agents** checks that each agent is signed in. For Claude Code and Codex the checks
  run when the pane opens and when a library is set up; they read only the sign-in and never ask
  the model. Check asks other agents one short question, and Claude Code or Codex too when their
  sign-in can't be read.
- **Agents without a sign-in command** are asked one short question in setup only when you pick
  them or press Check again.
- **No symlinks inside the library** for `inbox/`, `raw/` or `reviews/`: Avanzel never writes
  through a link, so filings into a linked `raw/` fail, a linked `reviews/` gets no summary, a
  capture an agent changes in a linked `inbox/` can't be put back (your words are kept in
  `.avanzel/logs/` instead), and recordings and screenshots aren't saved through one (what you said
  is kept without its recording). Links an agent plants under `inbox/`, `raw/` or `reviews/` are
  removed after its run. To keep the library elsewhere (another disk, a synced folder), move the
  whole library folder and choose it in Settings.
- **A library that is missing at launch** (moved, renamed or unmounted since you chose it) opens
  Settings, not setup: General says where Avanzel can't find it, and offers **Choose a folder…**
  (again, where it is now) or **Set up a new library**, which opens setup at `~/Avanzel`, not at the
  place that went. The menu bar's first item says the same.
- **A Mac without git** (no Apple Command Line Tools: `/usr/bin/git` is then only a stub that opens
  Apple's install dialog when it runs, so Avanzel asks `xcode-select -p` and never runs it to find
  out) gets no git history. Setup says changes can't be undone and offers **Install git**; the
  library is made without a repository, a library that has `.git` makes no commits and offers no
  Undo, and setup notices the install once its window has the focus again. Cancelling the first
  filing there says the stopped run's edits stay as they are, because nothing recorded them.
- **Setup** keeps the times of its milestones in `first-run.json` in Avanzel's own folder, on this
  Mac only.
- **The capsule** keeps a bare count of the recordings the library has kept in `captures.json`
  (only a number, which decides when its key hints stop), and the seconds of each agent's last
  filings in `run-state.json` (which set the time its card says a filing takes), in Avanzel's own
  folder, on this Mac only.

Run it from this repository (Node 22+):

```bash
npm install
npm run dev -w @avanzel/mac          # build and start it (menu bar icon: Zel's face, which shows what it's doing)
npm run dist -w @avanzel/mac         # or build apps/mac/release/mac-arm64/Avanzel.app
```

On first launch, a setup window walks you through six short steps with no visit to Settings.
**Set me up** starts downloading both speech models (Parakeet and the Silero VAD, 673 MB together;
an existing Hugging Face cache copy is reused) and reads your agents' sign-in. **Looks good** makes
the library in `~/Avanzel` with the agent you chose; **Change…** picks another folder (not your
home folder, a folder macOS makes in it such as Documents, a system folder such as `/Applications`
or `/usr`, or a disk's root: those are too broad; Settings' **Change…** refuses them too).
If the folder already holds a library or other files, the button reads **Use this folder** instead:
a library (a v0.1 one included) keeps its notes as they are, gets the agent you chose saved in its
settings and any default scheduled review it lacks, and other files are kept while Avanzel adds the
shelves, an `AGENTS.md` for your agent and git history that keeps them. Then you press ⌥Space and
say your first thought, or type it while the model downloads. Then you watch your agent file it,
ask a question about it, and finish in the menu bar. macOS asks for the microphone at your first
spoken thought: in setup, after one screen that says why, or, if you typed your first thought, at
your first dictation after setup. While the setup window is open, Avanzel shows a Dock icon, so the
window is easy to find again behind other apps. The first screen capture shows where to allow
Screen Recording (Open Settings); allow Avanzel there, then quit and reopen it. The local builds
are unsigned, so macOS forgets those permissions whenever the app is rebuilt.

## Command line (Python, v0.1)

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

## Agents

Avanzel runs your agent non-interactively, inside the library folder, with the narrowest
permissions each CLI offers:

| Agent | How Avanzel runs it |
|---|---|
| Claude Code | In the Mac app, `claude -p … --output-format stream-json --verbose --tools Read,Write,Edit,Glob,Grep --permission-mode acceptEdits --strict-mcp-config --settings <guard>`: file tools only, no shell, no web, none of your MCP servers, and the write guard described below (read-only tools for `ask`). The Python command line still runs `claude -p … --output-format text`, without the guard |
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

- in the Mac app, a Claude Code write to `inbox/`, `raw/`, `tasks/`, any file or folder whose name
  starts with a dot (`.obsidian/` too), the files listed below or anywhere outside the library is
  refused before it happens. So is a write to any file named `CLAUDE.md`, `CLAUDE.local.md` or
  `AGENTS.md`, in any folder, because Claude Code reads such files as instructions. The reason the
  agent is told, and the refusal of anything outside the library, come from a hook. Claude Code
  skips hooks under `--bare` or with `disableAllHooks`, and then only the deny rules for the paths
  listed here hold;
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
code. In the Mac app, a screen you capture with a comment goes to your agent too, when it files
the capture; the Python command line can't capture the screen. Nothing else is uploaded; there is
no Avanzel server.

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
# TypeScript engine and Mac app
npm install
npm test                                   # engine + app unit tests
npm run e2e -w @avanzel/mac                # the real app driven by Playwright, with a fake agent
AVANZEL_E2E_SHOTS=1 npm run e2e -w @avanzel/mac   # the same, and collect the windows' screenshots in apps/mac/test-results/shots/
AVANZEL_TEST_ASR=1 npm test -w @avanzel/engine   # real Parakeet (macOS `say` voices)

# Python CLI (v0.1)
uv sync
uv run pytest                                              # fast suite, no network or models
AVANZEL_TEST_ASR=1 uv run pytest tests/test_integration.py  # real Parakeet (macOS `say` voices)
AVANZEL_TEST_HARNESS=claude uv run pytest tests/test_integration.py -k harness   # real agent run
```

Designs: [`docs/superpowers/specs/2026-10-20-avanzel-design.md`](docs/superpowers/specs/2026-10-20-avanzel-design.md) (v0.1),
[`docs/superpowers/specs/2026-10-20-avanzel-mac-design.md`](docs/superpowers/specs/2026-10-20-avanzel-mac-design.md) (Mac app).
