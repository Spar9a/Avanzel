---
name: avanzel
description: Use when the user asks you to remember, save, note or jot down something about their own life (an idea, goal, plan, problem, person, event, decision or lesson), asks what they noted before or what their goals, ideas or plans are, or wants a review of their notes. Applies even when they just say "remember …" without naming Avanzel.
---

# Avanzel — the owner's second brain

The owner keeps their personal notes in Avanzel: a private library of goals, ideas, problems,
memories, people and topics (`avanzel where` prints the folder). It is where "remember this"
goes. Capture personal notes with `avanzel`; your own memory may keep a copy, but Avanzel is the
owner's record.

## Capture

When the owner says "remember…", "note that…", "add to my goals/ideas…", or shares something
about their life worth keeping:

```bash
avanzel add --background "<the owner's words, verbatim>"
```

- Pass the owner's own words, plus any context they gave (who, when, why). Do not summarise,
  embellish or translate.
- `--background` returns at once; filing finishes in a minute or two.
- Voice memo or other audio file: `avanzel add --background --audio <path>` (transcribed locally).

## Recall

- Quick lookup, no agent run: `avanzel search <words>` lists matching pages with a line of
  context; read the files under `avanzel where` for more.
- A synthesised answer from the whole library: `avanzel ask "<question>"` (read-only, can take a
  couple of minutes, so allow a long timeout). Add `--save` to file the answer back as a page.

## Other commands

- `avanzel status`: inbox size, pages per shelf, harness and voice setup.
- `avanzel review`: health check (stale goals, contradictions, orphans) written to `reviews/`.
- `avanzel record`: the owner dictates into the microphone. It is interactive, so suggest it to
  the owner rather than running it yourself.

## Rules

- The library is private. Do not copy its content into other projects, files or messages unless
  the owner asks for it.
- Do not edit library files directly from another project; go through `avanzel` so the librarian
  keeps index, links and log consistent.
- If `avanzel` is not installed, tell the owner to install it from its source folder with
  `uv tool install .` (it is not published on PyPI; do not install a package of that name).
