# Avanzel

**A voice-first second brain that runs on the AI agent you already pay for.**

Say a thought out loud, or type it. A small open-source speech model transcribes it **on your
machine**. Then the agent you already have (Claude Code, Codex, OpenCode or Cursor Agent) acts as
your librarian: it files the thought onto the right shelf of your private library (goals, ideas,
problems, memories, people, topics), links it to what you already know, and later answers your
questions about it.

No new subscription, no new cloud, no lock-in: your library is a folder of Markdown files you can
open in Obsidian.

```
 voice ─► local Parakeet / Whisper ─┐
 text ─────────────────────────────┤► inbox/ ─► your agent (claude · codex · opencode · cursor-agent)
 audio file ───────────────────────┘                │ files it onto shelves, links pages,
                                                     ▼ updates index.md and log.md
                     goals/  ideas/  problems/  memories/  people/  topics/   (plain Markdown, git-versioned)
```

It combines three ideas: Andrej Karpathy's
[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (an LLM-maintained
Markdown wiki with a schema file), [FluidVoice](https://github.com/altic-dev/FluidVoice)-style local
dictation (NVIDIA Parakeet or Whisper, offline), and [T3 Code](https://github.com/pingdotgg/t3code)'s
"harness over harnesses" (drive the agents you already trust instead of building another).

## Avanzel for Mac

A menu-bar app that wakes up on a shortcut. macOS only.

⌥Space to talk and ⌥⇧A to ask; the rest is in the menu bar menu and in
[Keyboard shortcuts](docs/user/keybindings.md).

It also takes notes on calls, files your inbox in an evening review, and keeps a personal
dictionary of names and terms.

Install the latest build from [GitHub Releases](https://github.com/Spar9a/Avanzel/releases), or
run it from source (Node 22+):

```bash
npm install
npm run dev -w @avanzel/mac     # build and start it
npm run dist -w @avanzel/mac    # or build apps/mac/release/mac-arm64/Avanzel.app
```

On first launch a setup window walks you through six short steps. Install at least one agent CLI
and sign in to it first (`claude`, `codex`, `opencode` or `cursor-agent`).

## Documentation

- [Keyboard shortcuts](docs/user/keybindings.md)
- [Avanzel for Mac](docs/user/mac-app.md): reviews, call notes, first launch and the details
- [Agents](docs/user/agents.md): how each agent is run, and `config.toml`
- [Voice](docs/user/voice.md): speech models and other engines
- [The library](docs/user/library.md): layout, pages and what Avanzel guarantees
- [Command line (Python, v0.1)](docs/user/cli.md)
- [Troubleshooting](docs/user/troubleshooting.md)
- [Contributing](CONTRIBUTING.md): tests and how the repository is organised

## Privacy

Audio and transcription never leave your machine. Filing and asking send the capture text and the
relevant pages to whichever model your agent CLI uses, the same trust you already give it for
code. In the Mac app, a screen you capture with a comment goes to your agent too, when it files
the capture. Nothing else is uploaded; there is no Avanzel server.

## Licence

Apache License 2.0: see [LICENSE](LICENSE). Third-party material and its licences are listed in [NOTICE](NOTICE).
