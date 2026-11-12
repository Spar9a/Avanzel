# Agents

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
