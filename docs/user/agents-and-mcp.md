# Your other agents and the library

You probably work with other agents besides Avanzel's librarian: Claude Code or Codex in your
projects, Cursor, Claude Desktop, OpenCode, Gemini CLI. Avanzel can let them use your library through
MCP, the protocol these agents use to reach outside tools. Then an agent working on a project can
look up what you already decided, want or worry about, and leave a note for the librarian to file.

It is off until you turn it on.

## What they can do

An agent connected to Avanzel has five tools:

- `search`: finds pages by words, a tag or a shelf. It can include captures too.
- `read_page`: reads one page, or one section of it.
- `library_overview`: the shelves, the tags the library uses most, and the start of `index.md`.
- `recent_changes`: the last lines of `log.md`.
- `remember`: leaves a note in your inbox, with tags, a suggested title and shelf, and the pages it
  relates to.

They read what Ask reads: shelf pages, `index.md`, `log.md`, `reviews/`, and the captures in
`inbox/` and `raw/`, your unfiled ones and call notes included. Words from a capture reach the agent
marked as someone's words, not instructions.

They can't change or delete anything themselves: the librarian decides what to file. A note can ask
for a change, such as one that names a page whose fact it updates, and the librarian makes it while
filing, by the library's rules. Agents can't:

- change, move or delete anything already in the library;
- read audio, pictures or any other file that isn't Markdown;
- read your dictations' day files in `raw/dictations/`, or any file or folder whose name starts with a
  dot (`.avanzel/`, `.git/`, `.obsidian/`);
- read anything outside the library.

An agent that Avanzel itself runs, for filing or for Ask, can't leave notes even if it reaches the
server, so the librarian never files notes it wrote itself.

## How their notes are filed

A note from an agent is a capture in `inbox/` like any other, marked `source: agent` with the name the
agent gave itself (`agent: claude-code`). The librarian files it at the next filing: the evening
review, or when you file the inbox from Avanzel's panel.

It files the note as the agent's, not yours. The page's log says so ("From Claude Code: prefers pnpm"),
and so does the page wherever it repeats what the note said. Where a note disagrees with something you
said, the page keeps your version and the log records the disagreement. A note that changes an older
fact names that page, and the librarian writes the change out in its log rather than dropping the old
fact. The evening review counts agents' notes apart from yours.

At most 30 notes from agents wait in the inbox at once. Past that, `remember` says the inbox is full
until the next filing.

## Turn it on

Open Avanzel → Settings → Agents, and turn on "Let your other agents use this library" under "Your
other agents". A row for each agent appears under it.

The setup below uses the path of the app in `/Applications`. Settings copies the path of the Avanzel
you are running, so use its Copy setup if yours is somewhere else.

### Claude Code

Press "Add to Claude Code". Avanzel runs this for you, which adds it for every project:

```sh
claude mcp add avanzel --scope user -- /Applications/Avanzel.app/Contents/MacOS/Avanzel --mcp
```

If that fails, Settings says what happened. When Claude Code isn't installed, it offers Claude Code's
install command; install it, then add Avanzel again. Otherwise it offers the line above to copy: paste
it into Terminal to add Avanzel by hand.

### Claude Desktop

Paste this into `~/Library/Application Support/Claude/claude_desktop_config.json` (Settings →
Developer → Edit Config), then quit and reopen Claude Desktop:

```json
{
  "mcpServers": {
    "avanzel": {
      "command": "/Applications/Avanzel.app/Contents/MacOS/Avanzel",
      "args": [
        "--mcp"
      ]
    }
  }
}
```

### Cursor

Paste this into `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "avanzel": {
      "type": "stdio",
      "command": "/Applications/Avanzel.app/Contents/MacOS/Avanzel",
      "args": [
        "--mcp"
      ]
    }
  }
}
```

### Codex

Paste this into `~/.codex/config.toml`:

```toml
[mcp_servers.avanzel]
command = "/Applications/Avanzel.app/Contents/MacOS/Avanzel"
args = ["--mcp"]
```

### OpenCode

Paste this into `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "avanzel": {
      "type": "local",
      "command": [
        "/Applications/Avanzel.app/Contents/MacOS/Avanzel",
        "--mcp"
      ],
      "enabled": true
    }
  }
}
```

OpenCode 2 also reads servers under `"mcp": { "servers": { … } }`; the form above works in both.

### Gemini CLI

Paste this into `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "avanzel": {
      "command": "/Applications/Avanzel.app/Contents/MacOS/Avanzel",
      "args": [
        "--mcp"
      ]
    }
  }
}
```

If a file already has an `mcpServers` (or `mcp`) section, add the `avanzel` entry inside it rather than
pasting a second section.

Each agent starts Avanzel's server itself when it needs it. Avanzel doesn't have to be open, and no
port is opened: the server talks only to the agent that started it.

## Help an agent write good notes

The server tells every agent how to write a note the librarian can file well: search first, one thing
per note, written so it stands alone, with full dates, tags from the library's own set, and where it
came from. You can add your own wishes in your agent's instructions, such as "ask me before you
remember anything".

## Turn it off

Turn the switch off in Settings → Agents. It counts at once: every tool then answers that the library is
closed to other agents, and does nothing else. The agents keep Avanzel in their settings until you
remove it there, for Claude Code with:

```sh
claude mcp remove avanzel --scope user
```

## Privacy

What a connected agent reads goes to that agent's provider, as everything else you show it does. While
the switch is on, that can be any part of your library, unfiled captures and call notes included.
Connect only agents you would show the library to yourself.
