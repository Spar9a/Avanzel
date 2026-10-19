# Avanzel — design

Date: 2026-10-20 · Status: v0.1 design (autonomous `/goal` session — the owner skipped the question round, so every "my call" below is open to change)

## 1. Intent

Avanzel is a **voice-first second brain that runs on the AI agent you already pay for**.

You speak (or type) a thought. A small open-source speech model transcribes it **locally**. Then the
coding-agent harness already installed on your machine — Claude Code, Codex, OpenCode, Cursor
Agent, … — acts as a librarian: it files the thought onto the right *shelf* of your private library
(goals, ideas, problems, memories, …), links it to what you already have, and later answers
questions about it. No new subscription, no new cloud service: Avanzel is "a harness over harnesses"
plus a transcription layer plus skills, orchestrating them all.

Three pieces of prior art, combined:

| Prior art | What we take |
|---|---|
| **Karpathy's "LLM Wiki"** (gist, Apr 2026) | The library pattern: immutable *raw* sources → LLM-maintained Markdown wiki → a *schema* file (AGENTS.md/CLAUDE.md). Operations **ingest / query / lint**, an `index.md` catalog and an append-only `log.md`. Obsidian as the viewer, git for history. |
| **FluidVoice** (open-source macOS dictation) | Local, private speech-to-text with small open models: **NVIDIA Parakeet TDT 0.6B v3** (25 European languages) by default, **OpenAI Whisper** as the alternative. |
| **T3 Code** ("harness over harnesses") | Don't build an agent or sell tokens — drive the user's existing agent CLIs headlessly and let the user pick. |

Interpretation notes (the request was dictated): "hygienic"/"a genetic" → **agentic**; "hardness" →
**harness**; "clot" → **Claude Code**; "open coder" → **OpenCode**; "Carpassi / Andrew Carpati" →
**Andrej Karpathy**; "remote users" → read as *regular end users*. Name spelling follows the repo
README: **Avanzel**.

## 2. Goals, non-goals, anti-goals

**Goals (v0.1)**
1. Capture by **voice** (microphone or an audio file) or **text** in one command.
2. **Local transcription** with open models (Parakeet v3 default; Whisper and any local CLI pluggable).
3. **Agentic filing**: the user's harness files each capture onto the right shelf(s), updates or
   creates pages, cross-links, maintains `index.md` and `log.md`.
4. **Agentic access**: ask questions (`ask`), run health checks (`review`), or open an interactive
   agent session inside the library (`chat`).
5. **Works with whatever harness is installed** (auto-detect; Claude Code, Codex, OpenCode, Cursor
   Agent built in; Gemini CLI experimental; any other CLI via config) — no API keys, no subscription.
6. **Skills**: a portable Agent Skill (`SKILL.md`) so the user can use Avanzel from inside any
   harness session ("remember this idea…", "what are my goals?").
7. Plain files: Markdown + YAML frontmatter, Obsidian-compatible, git-versioned.

**Non-goals (v0.1)** — GUI/menu-bar app, global dictation hotkey, mobile app, cloud sync,
multi-user/sharing, embeddings/vector search, our own LLM or API billing, Windows support.

**Anti-goals** (would be failure even if it "works")
- Sending audio to any server. Transcription is always local.
- Rewriting or losing the user's original words. Captures are immutable once written.
- An agent wandering outside the library folder or onto the network while filing.
- Lock-in: the library must stay fully useful with no Avanzel installed (just Markdown).
- Requiring an extra paid account.

## 3. Constraints

- Python ≥ 3.11 managed with **uv** (owner's rule). Core uses only the stdlib; voice deps
  (`onnx-asr`, `sounddevice`, `numpy`) are imported lazily.
- macOS + Linux (POSIX). Developed on macOS/Apple Silicon.
- Harness CLIs as installed today: Claude Code 2.1.x (`claude -p`), Codex CLI 0.16x (`codex exec`),
  OpenCode 1.18 (`opencode run`), Cursor Agent (`cursor-agent -p`).
- Headless Claude must **not** use `--bare` (bare mode ignores the subscription login).

## 4. Architecture

```
          voice ──► recorder ──► raw/audio/*.wav ─┐
   audio file ───────────────────────────────────┤► transcriber (onnx-asr Parakeet/Whisper | command)
         text ───────────────────────────────────┤
                                                 ▼
                                    inbox/<capture>.md   (immutable capture)
                                                 │  avanzel file
                                                 ▼
             Librarian ──prompt──► Harness adapter ──► claude -p | codex exec | opencode run | cursor-agent -p
                 │                                         (cwd = vault, sandboxed to it)
                 ├─ snapshot/diff of the vault (what changed)
                 ├─ guarantees: capture restored if touched, log line present
                 ├─ archive capture → raw/YYYY/MM/
                 └─ git commit (if the vault is a repo)
```

Modules (`src/avanzel/`): `config` (vault + settings resolution), `vault` (layout, captures, inbox,
snapshot/diff, index/log helpers, search, status), `prompts` (task prompt templates), `harness`
(adapter registry, detection, headless + interactive runs), `librarian` (orchestrates file/ask/review),
`asr` (transcribers, audio normalisation), `recorder` (microphone → WAV), `skills` (install the
Agent Skill), `cli` (argparse entry point). Templates (AGENTS.md, CLAUDE.md, index, log, config,
SKILL.md, prompts) ship as package data.

## 5. The library (vault)

Default location `~/Avanzel` (my call). Resolution order: `--vault` → `$AVANZEL_VAULT` → nearest
parent containing `.avanzel/` → `vault =` in `~/.config/avanzel/config.toml` → `~/Avanzel`.

```
AGENTS.md        the schema: how this library works (Codex, OpenCode, Cursor read it natively)
CLAUDE.md        "@AGENTS.md" so Claude Code loads the same schema
index.md         catalog: one line per page, grouped by shelf
log.md           append-only operation log
inbox/           captures waiting to be filed (.md/.txt, or audio files dropped in, e.g. phone memos)
raw/YYYY/MM/     filed captures (immutable)      raw/audio/YYYY/MM/  recordings
goals/ ideas/ problems/ memories/ people/ topics/     the shelves
reviews/         health-check reports
.avanzel/        config.toml, logs/, lock
opencode.json    OpenCode permissions for this folder (no bash, no web)
```

Shelves (my call, editable in AGENTS.md — the schema is the user's to evolve):
`goals` (outcomes + status + next steps), `ideas`, `problems` (open frictions/questions),
`memories` (facts, events, decisions, lessons about the owner's life), `people`, `topics`
(knowledge, recurring themes, saved answers).

**Capture** (`inbox/<id>.md`): id = `YYYY-MM-DD-HHMMSS[-ascii-slug]`; frontmatter `id, type: capture,
source (text|voice|audio), created, [audio, transcriber]`; body = the user's words verbatim
(voice captures also embed the audio for playback in Obsidian).

**Page**: `<shelf>/<latin-kebab-slug>.md` with frontmatter `title, shelf, status, created, updated,
tags, sources`; body = current-state summary, optional `## Next steps`, dated `## Log` bullets citing
captures as `[[capture-id]]`, `## Related` wikilinks. Status vocabularies per shelf live in AGENTS.md.

**Log line**: `- YYYY-MM-DD HH:MM | file|ask|review | details` (grep-able, per Karpathy).

## 6. Operations

| Command | What happens |
|---|---|
| `avanzel init [PATH]` | Create the library (layout, schema, config, `git init`), remember its path. |
| `avanzel add "text"` / stdin / `--audio FILE` | Write capture to inbox (transcribing audio locally), then file it. `--no-file` to only capture, `--background` to file asynchronously. |
| `avanzel record` | Record mic until Enter (or max seconds) → WAV in `raw/audio` → transcribe → capture → file. |
| `avanzel transcribe FILE` | Local speech-to-text only; prints text. |
| `avanzel file` | Process the inbox one capture at a time (audio files are transcribed first). |
| `avanzel ask "question" [--save]` | Agent answers from the library with `[[citations]]`; read-only unless `--save` files the answer back. |
| `avanzel review` | Health check (stale goals, contradictions, duplicates, orphans, missing links) → `reviews/DATE.md`. |
| `avanzel chat` | Open the harness interactively inside the library. |
| `avanzel search`, `status`, `where` | Keyword search, overview (inbox, shelves, harnesses, voice), vault path. |
| `avanzel skills install` | Install the Avanzel Agent Skill for detected harnesses. |

**Filing contract** (one capture per agent run — Karpathy's "one source at a time"; my call):
1. Librarian renders the *file* prompt (capture path, rules, log format) and runs the harness with
   cwd = vault. Filing runs hold `.avanzel/lock` (`flock`) so background filers never collide.
2. Before/after **snapshot** of the vault → report created/modified pages.
3. If the agent altered the capture, Avanzel **restores** the original bytes.
4. If `log.md` lacks the capture's line, Avanzel appends one from the diff.
5. Capture is **archived** to `raw/YYYY/MM/` (wikilinks by basename keep working).
6. If the vault is a git repo and `auto_commit = true`, commit `avanzel: file <id>`.
7. Harness failure → capture stays in inbox, error tail shown, non-zero exit.

## 7. Harness adapters

| Harness | Headless (write) | Read-only (`ask`) | Interactive |
|---|---|---|---|
| Claude Code | `claude -p P --permission-mode acceptEdits --allowedTools Read,Write,Edit,Glob,Grep` | `--allowedTools Read,Glob,Grep` | `claude` |
| Codex | `codex exec --cd V --sandbox workspace-write --skip-git-repo-check -o OUT P` | `--sandbox read-only` | `codex --cd V` |
| OpenCode | `opencode run --dir V P` (+ vault `opencode.json`: bash/web denied) | same (prompt-level) | `opencode V` |
| Cursor Agent | `cursor-agent -p --output-format text P` | same | `cursor-agent` |
| Gemini CLI *(experimental, untested)* | `gemini -p P --approval-mode auto_edit` | `--approval-mode default` | `gemini` |
| Custom | `[harnesses.NAME] headless = [..., "{prompt}"]` in config | same | `interactive = [...]` |

Selection: `--harness` → config `harness` → `auto` = first installed of claude, codex, opencode,
cursor-agent, gemini (my call). Optional per-harness model in config (`[models] claude = "sonnet"`)
to keep filing cheap. Stdin is `/dev/null`; Claude-session env vars (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, …) are
stripped so Avanzel works when invoked *from inside* a Claude Code session (the skill path).

## 8. Voice

- `onnx-asr` backend (default): `nemo-parakeet-tdt-0.6b-v3`, `int8` (~670 MB one-time download to the
  Hugging Face cache); Silero VAD for audio longer than ~25 s. Alternatives by config:
  `nemo-parakeet-tdt-0.6b-v2` (English), `onnx-community/whisper-large-v3-turbo`, `whisper-base`,
  `gigaam-v3-*` (Russian).
- `command` backend: any local CLI, e.g. whisper.cpp `["whisper-cli","-m","…","-nt","-f","{audio}"]`.
- Non-WAV or non-16 kHz-mono input is normalised with `ffmpeg` when available.
- Recorder: `sounddevice`, 16 kHz mono PCM16 WAV, stops on Enter / Ctrl-C / max seconds.

## 9. Skills

`avanzel skills install` writes `avanzel/SKILL.md` to `~/.claude/skills` (Claude Code, OpenCode),
`~/.agents/skills` (Codex, OpenCode, others) and `~/.cursor/skills` for detected harnesses. The
skill teaches any agent to call the CLI: `avanzel add --background "<verbatim words>"`, `avanzel ask`,
`avanzel search`, `avanzel status`. Inside the vault, AGENTS.md/CLAUDE.md are the always-loaded
schema, so `avanzel chat` needs no skill.

## 10. Privacy & safety

Audio and transcription never leave the machine. Filing/asking sends capture text and relevant pages
to the model behind the user's harness (the same trust the user already gives it) — stated plainly in
the README. Agents run with cwd = vault and file-only permissions (Claude), workspace sandbox
(Codex), denied bash/web (OpenCode). Git history makes every agent edit reviewable and undoable.

## 11. Testing

- Unit tests (pytest) for config, vault, harness argv/detection/env, prompts, librarian contract,
  ASR selection/normalisation, skills install, CLI.
- A **fake harness** script plays the agent so the full capture→file→archive→log→commit loop is
  tested without LLM calls (including failure, tampering and missing-log paths).
- Opt-in integration tests: real Parakeet transcription of speech synthesised with macOS `say`
  (`AVANZEL_TEST_ASR=1`), real harness runs (`AVANZEL_TEST_HARNESS=claude`).

## 12. Later (not v0.1)

Menu-bar app + global hotkey (FluidVoice-style) calling `avanzel record --background`; watch-folder
daemon for phone voice memos; notifications; MCP server; semantic search (e.g. qmd); scheduled
weekly reviews; Windows.

## 13. My calls (please check)

Python CLI (not a Swift/Tauri app) for v0.1 · default vault `~/Avanzel` · six shelves listed above ·
one capture per agent run · Parakeet v3 int8 default · harness auto-order claude → codex → opencode →
cursor-agent → gemini · audio kept but git-ignored · auto-commit on by default · global skill is
opt-in via `avanzel skills install`.
