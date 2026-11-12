# Avanzel for Mac

A menu-bar app (Electron + TypeScript, `apps/mac`) on a TypeScript port of the engine
(`packages/engine`). No main window, and no Dock icon once setup is done: it lives in the menu bar
and wakes up on a shortcut.

Shortcuts are in [Keyboard shortcuts](keybindings.md).

## Reviews

The **evening review** (a scheduled review, 21:00 by default) files the day's inbox, writes a
summary to `reviews/`, and can be taken back with **Undo the last evening review** in the menu bar
menu. A **weekly review** looks over the whole library. Scheduled reviews are Markdown files in
`tasks/`; edit their times, agents and instructions in Settings → Reviews (a file Avanzel can't
read is listed there with what is wrong with it). Running the evening or the weekly review
yourself, from the menu bar menu or with Settings' **Run now**, asks first, since it runs your agent
on your plan and may count toward your usage limit; while the evening review runs, the menu shows
how far it is ("Filing 2 of 5"). A review that comes due on its schedule doesn't ask.

## Notes on a call

**Notes on a call** (macOS 14.2 or later): choose *Take notes on a call…* in the menu bar menu, pick
the call app (or *Everything this Mac plays*), and talk. Avanzel hears your microphone and the other
side's sound, turns both into text on this Mac, and keeps no audio. When you stop, your agent files
a meeting page with the decisions and a task for each person. It asks before the first call, because
in many places everyone on a call must agree to it being recorded, and it never joins the call. It
doesn't yet notice a call by itself, read calendar titles or tell the other side's voices apart.

## Dictating into any app

Tap Right Option (change it, or turn it off, in Settings → Dictation) and the words are pasted at the
cursor of the app that has focus. Your clipboard is put back afterwards, copied files and other
formats included, unless you copied something meanwhile; the pasted words are marked so clipboard
managers skip them.

Every dictation is kept in a history in Settings → Dictation, and an optional library log keeps them
in `raw/dictations/`. Nothing is kept from password managers, password fields, Chrome-family private
windows, or the apps and sites you list in Settings → Privacy (Safari and Firefox private windows
can't be told apart).

## Dictionary

Settings → Voice lists the names and terms you use, one per line. What the speech model hears is
corrected to them (`Ollama = Alema` fixes a word it keeps getting wrong), your agent is told how to
spell them, and a corrected thought keeps what was heard in its `heard:` line.

## Undo

Undo needs a git history: each filing is a commit. A Mac without the Apple Command Line Tools has no
git, so setup says changes can't be undone and offers **Install git**, and a library made without a
repository offers no Undo. Both Undo items (last filing, last evening review) survive quitting and
reopening, each library keeps its own, and one whose commit has left the history (after a reset, say)
is dropped quietly.

## Good to know

- **No sounds.** Avanzel makes none of its own, and its notifications are silent while you record, so
  macOS's sound is not heard in your words.
- **Screen Recording:** macOS applies the permission only to a fresh start of the app. After you allow
  Avanzel in System Settings → Privacy & Security → Screen Recording, quit and reopen it.
- **Quitting** while your agent is filing stops the agent. What it had changed is kept as its own
  commit (in a git library) and the note stays in the inbox for the evening review.
- **Agent checks** in Settings → Agents read only the sign-in of Claude Code and Codex and never ask
  the model. Other agents are asked one short question, only when you pick them or press Check again,
  since that may count toward your usage limit.
- **No symlinks inside the library** for `inbox/`, `raw/` or `reviews/`: Avanzel never writes through a
  link, so filings into a linked `raw/` fail, a linked `reviews/` gets no summary, and recordings and
  screenshots aren't saved through one. Links an agent plants there are removed after its run. To keep
  the library elsewhere (another disk, a synced folder), move the whole folder and choose it in
  Settings.
- **Files Avanzel keeps** in its own folder, on this Mac only: `first-run.json` (setup milestones),
  `captures.json` (a bare count of kept recordings, which decides when the capsule's key hints stop)
  and `run-state.json` (the seconds of each agent's last filings, which set the time a card says a
  filing takes).

## First launch

The setup window walks you through six short steps. **Set me up** downloads both speech models
(Parakeet and the Silero VAD, 673 MB together; an existing Hugging Face cache copy is reused).
**Change…** picks a library folder other than `~/Avanzel`; your home folder, a folder macOS makes in it
such as Documents, system folders and a disk's root are refused as too broad. If the folder already
holds a library (a v0.1 one included), **Use this folder** keeps its notes as they are and adds the
agent you chose and any default review it lacks; other files are kept while Avanzel adds the shelves,
an `AGENTS.md` for your agent and git history.

macOS asks for the microphone at your first spoken thought. Local builds are unsigned, so macOS
forgets the microphone and Screen Recording permissions whenever the app is rebuilt. To run from
source, see the [README](../../README.md).
