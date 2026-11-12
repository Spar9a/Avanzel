# Troubleshooting

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
