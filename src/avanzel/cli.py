"""`avanzel` — capture by voice or text, let your own agent file it, ask your library anything."""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path

from avanzel import __version__
from avanzel import git as gitops
from avanzel.asr import make_transcriber
from avanzel.config import Settings, load_settings, remember_vault, resolve_vault
from avanzel.errors import AvanzelError
from avanzel.harness import exec_interactive, installed, select_harness
from avanzel.librarian import FileOutcome, Librarian
from avanzel.recorder import record_wav
from avanzel.search import search
from avanzel.skills import install_skill, skill_targets
from avanzel.vault import Capture, Vault

Command = Callable[[argparse.Namespace], int]


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "run", None):
        parser.print_help()
        return 0
    try:
        return args.run(args)
    except AvanzelError as exc:
        print(f"avanzel: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\navanzel: interrupted", file=sys.stderr)
        return 130


def build_parser() -> argparse.ArgumentParser:
    # Shared options work before or after the command: `avanzel --vault X add …` or `avanzel add --vault X …`.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--vault", type=Path, default=argparse.SUPPRESS, help="library folder (default: ~/Avanzel)")
    common.add_argument(
        "--harness", default=argparse.SUPPRESS, help="agent CLI: claude, codex, opencode, cursor-agent, gemini, …"
    )
    common.add_argument("-v", "--verbose", action="store_true", default=argparse.SUPPRESS, help="show agent progress")

    parser = argparse.ArgumentParser(
        prog="avanzel",
        parents=[common],
        description="A voice-first second brain that runs on the AI agent you already have.",
    )
    parser.add_argument("--version", action="version", version=f"avanzel {__version__}")
    commands = parser.add_subparsers(title="commands", metavar="<command>")

    def command(name: str, run: Command, help: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, parents=[common], help=help, description=help)
        sub.set_defaults(run=run)
        return sub

    sub = command("init", cmd_init, "create your library (default ~/Avanzel)")
    sub.add_argument("path", nargs="?", type=Path, help="where to create it")
    sub.add_argument("--no-git", action="store_true", help="don't version the library with git")
    sub.add_argument("--force", action="store_true", help="turn an existing, non-empty folder into a library")

    sub = command("add", cmd_add, "capture a thought (text, stdin or an audio file) and file it")
    sub.add_argument("text", nargs="*", help="what to remember (reads stdin when omitted)")
    sub.add_argument("--audio", type=Path, help="transcribe this audio file locally instead")
    _filing_options(sub)

    sub = command("record", cmd_record, "dictate a note from the microphone (press Enter to stop)")
    sub.add_argument("--max-seconds", type=float, help="stop automatically after this long")
    _filing_options(sub)

    sub = command("transcribe", cmd_transcribe, "transcribe an audio file locally and print the text")
    sub.add_argument("audio", type=Path)

    sub = command("file", cmd_file, "file everything waiting in the inbox")
    sub.add_argument("--background", action="store_true", help="return at once; file in the background")

    sub = command("ask", cmd_ask, "ask your library a question")
    sub.add_argument("question", nargs="+")
    sub.add_argument("--save", action="store_true", help="file the answer back into the library")

    command("review", cmd_review, "health-check the library: stale goals, contradictions, orphans")
    command("chat", cmd_chat, "talk to your library in your agent's own interface")

    sub = command("search", cmd_search, "keyword search across the shelves")
    sub.add_argument("query", nargs="+")
    sub.add_argument("--limit", type=int, default=10)

    command("status", cmd_status, "show the library, inbox, agent and voice setup")
    command("where", cmd_where, "print the library folder")

    sub = command("skills", cmd_skills, "install the Avanzel skill so your agents can use your library")
    sub.add_argument("action", choices=["install"])
    sub.add_argument("--target", choices=["claude", "agents", "cursor", "all"], help="default: detected agents")
    sub.add_argument("--dry-run", action="store_true", help="show where the skill would go")
    return parser


def _filing_options(sub: argparse.ArgumentParser) -> None:
    sub.add_argument("--no-file", action="store_true", help="only capture; file later with `avanzel file`")
    sub.add_argument("--background", action="store_true", help="capture now, file in the background")


# --- commands ------------------------------------------------------------------------------


def cmd_init(args: argparse.Namespace) -> int:
    root = resolve_vault(args.path or getattr(args, "vault", None))
    existed = Vault(root).exists()
    if not existed and not args.force and root.is_dir() and any(p.name != ".DS_Store" for p in root.iterdir()):
        raise AvanzelError(
            f"{root} already has files in it. Avanzel would add its folders there and commit everything to git. "
            "Pick an empty or new folder, or pass --force to turn this one (e.g. an Obsidian vault) into a library."
        )
    vault = Vault.init(root, git=not args.no_git)
    remember_vault(vault.root)
    print(f"{'Your library is already at' if existed else 'Created your library at'} {vault.root}")
    agents = installed(load_settings(vault.root))
    print(f"Agents found: {', '.join(agents) if agents else 'none yet (install Claude Code, Codex or OpenCode)'}")
    print(
        "\nNext:\n"
        '  avanzel add "I want to run a marathon next spring"\n'
        "  avanzel record                       # dictate; transcribed on this machine\n"
        '  avanzel ask "what are my goals?"\n'
        "  avanzel skills install               # use it from Claude Code / Codex / OpenCode\n"
        "  Open the folder in Obsidian to browse it."
    )
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    vault, librarian = _open(args)
    if args.audio is not None:
        if args.text:
            raise AvanzelError("Give either text or --audio, not both.")
        audio = args.audio.expanduser()
        if not audio.is_file():
            raise AvanzelError(f"No such audio file: {audio}")
        _progress(f"Transcribing {audio.name} locally ({librarian.transcriber.engine})…")
        capture = librarian.capture_audio(audio, source="audio")
        if capture is None:
            raise AvanzelError(f"No speech recognized in {audio.name}; nothing was captured.")
    else:
        text = " ".join(args.text)
        if not text and not sys.stdin.isatty():
            text = sys.stdin.read()
        if not text.strip():
            raise AvanzelError('Nothing to capture. Usage: avanzel add "your thought" (or pipe text in).')
        capture = librarian.capture_text(text)
    print(f"Captured {capture.id}")
    return _after_capture(args, vault, librarian, capture)


def cmd_record(args: argparse.Namespace) -> int:
    vault, librarian = _open(args)
    max_seconds = args.max_seconds or librarian.settings.voice.max_record_seconds
    audio = vault.new_audio_path(librarian.clock())
    stop = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.readline(), stop.set()), daemon=True).start()
    _progress(f"Recording… press Enter to stop (max {max_seconds:g}s).")
    try:
        seconds = record_wav(
            audio,
            max_seconds=max_seconds,
            stop=stop.is_set,
            on_tick=lambda s: print(f"\r  {s:5.1f}s", end="", file=sys.stderr, flush=True),
        )
    except BaseException:
        audio.unlink(missing_ok=True)  # the path was claimed up front; don't leave an empty file
        raise
    print(file=sys.stderr)
    if seconds < 0.3:
        audio.unlink(missing_ok=True)
        raise AvanzelError("Nothing was recorded. Check that your terminal app may use the microphone.")
    _progress(f"Transcribing {seconds:.1f}s locally ({librarian.transcriber.engine})…")
    capture = librarian.capture_audio(audio, source="voice")
    if capture is None:
        raise AvanzelError(
            f"No speech recognized; the recording is kept at {audio}. "
            "If you did speak, check the microphone permission for your terminal app."
        )
    print(f"Captured {capture.id}:\n  {_body(capture)}")
    return _after_capture(args, vault, librarian, capture)


def cmd_transcribe(args: argparse.Namespace) -> int:
    audio = args.audio.expanduser()
    if not audio.is_file():
        raise AvanzelError(f"No such audio file: {audio}")
    vault = Vault(resolve_vault(getattr(args, "vault", None)))
    settings = load_settings(vault.root) if vault.exists() else Settings()
    transcriber = make_transcriber(settings.voice)
    _progress(f"Transcribing with {transcriber.engine}…")
    print(transcriber.transcribe(audio).text)
    return 0


def cmd_file(args: argparse.Namespace) -> int:
    vault, librarian = _open(args)
    if args.background:
        print(f"Filing in the background (log: {_spawn_filer(args, vault)}).")
        return 0
    return _report(librarian.file(progress=_progress))


def cmd_ask(args: argparse.Namespace) -> int:
    _, librarian = _open(args)
    _progress(f"Asking {librarian.harness.name}…")
    outcome = librarian.ask(" ".join(args.question), save=args.save)
    if not outcome.result.ok:
        raise AvanzelError(f"{librarian.harness.name} failed:\n  {_tail(outcome.result.stderr or outcome.result.output)}")
    print(outcome.result.output)
    _print_guarded(outcome.guarded)
    if args.save:
        _print_changes(outcome.changes.created, outcome.changes.modified, outcome.changes.deleted)
    elif not outcome.changes.empty:
        _progress(f"Note: the agent changed files while answering: {', '.join(outcome.changes.created + outcome.changes.modified)}")
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    _, librarian = _open(args)
    _progress(f"Reviewing the library with {librarian.harness.name}…")
    outcome = librarian.review()
    if not outcome.result.ok:
        raise AvanzelError(f"{librarian.harness.name} failed:\n  {_tail(outcome.result.stderr or outcome.result.output)}")
    print(outcome.result.output)
    _print_guarded(outcome.guarded)
    if outcome.report is not None:
        print(f"\nReport: {outcome.report.relative_to(librarian.vault.root)}")
    return 0


def cmd_chat(args: argparse.Namespace) -> int:
    vault = _vault(args)
    settings = load_settings(vault.root)
    harness = select_harness(settings, getattr(args, "harness", None))
    exec_interactive(harness, vault.root, model=settings.models.get(harness.name))


def cmd_search(args: argparse.Namespace) -> int:
    vault = _vault(args)
    hits = search(vault.root, " ".join(args.query), args.limit)
    if not hits:
        print("No matches.")
    for hit in hits:
        print(f"{hit.path}: {hit.line}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    vault = _vault(args)
    settings = load_settings(vault.root)
    print(f"Library   {vault.root}{'  (git)' if gitops.is_repo(vault.root) else ''}")
    print(f"Inbox     {len(vault.pending())} waiting")
    print("Shelves   " + " · ".join(f"{name} {count}" for name, count in vault.shelf_counts().items()))
    try:
        chosen = select_harness(settings, getattr(args, "harness", None)).name
    except AvanzelError:
        chosen = "none available"
    agents = installed(settings)
    print(f"Agent     {chosen}  (installed: {', '.join(agents) if agents else 'none'})")
    voice = settings.voice
    engine = f"{voice.model} ({voice.quantization or 'full precision'})" if voice.backend == "onnx-asr" else " ".join(voice.command)
    mic = "ok" if importlib.util.find_spec("sounddevice") else "unavailable"
    ffmpeg = "ok" if shutil.which("ffmpeg") else "missing (needed for m4a/mp3/ogg)"
    print(f"Voice     {voice.backend}: {engine} · microphone {mic} · ffmpeg {ffmpeg}")
    return 0


def cmd_where(args: argparse.Namespace) -> int:
    print(resolve_vault(getattr(args, "vault", None)))
    return 0


def cmd_skills(args: argparse.Namespace) -> int:
    targets = skill_targets(Path.home(), only=args.target)
    if not targets:
        raise AvanzelError("No supported agent CLI found; choose one with --target claude|agents|cursor|all.")
    for path in install_skill(targets, dry_run=args.dry_run):
        print(f"{'would write' if args.dry_run else 'wrote'} {path}")
    if not args.dry_run:
        print('Your agents can now use your second brain — try "remember that …" in a new session.')
    return 0


# --- helpers -------------------------------------------------------------------------------


def _vault(args: argparse.Namespace) -> Vault:
    return Vault(resolve_vault(getattr(args, "vault", None))).require()


def _open(args: argparse.Namespace) -> tuple[Vault, Librarian]:
    vault = _vault(args)
    librarian = Librarian(
        vault,
        load_settings(vault.root),
        harness_name=getattr(args, "harness", None),
        verbose=getattr(args, "verbose", False),
    )
    return vault, librarian


def _after_capture(args: argparse.Namespace, vault: Vault, librarian: Librarian, capture: Capture) -> int:
    if args.no_file:
        print("Left in the inbox; run `avanzel file` when you're ready.")
        return 0
    if args.background:
        print(f"Filing in the background (log: {_spawn_filer(args, vault)}).")
        return 0
    return _report(librarian.file(only=[capture.path], progress=_progress))


def _spawn_filer(args: argparse.Namespace, vault: Vault) -> Path:
    """Start `avanzel file` detached from this terminal; the vault lock keeps runs from colliding."""
    vault.logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = vault.logs_dir / f"file-{datetime.now():%Y%m%d-%H%M%S}.log"
    argv = [sys.executable, "-m", "avanzel", "--vault", str(vault.root)]
    if getattr(args, "harness", None):
        argv += ["--harness", args.harness]
    with open(log_path, "ab") as log:
        subprocess.Popen(
            [*argv, "file"], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
        )
    return log_path


def _report(outcomes: list[FileOutcome]) -> int:
    if not outcomes:
        print("The inbox is empty; nothing to file.")
        return 0
    failed = 0
    for outcome in outcomes:
        if outcome.ok:
            if outcome.message:
                print(outcome.message)
            _print_changes(outcome.changes.created, outcome.changes.modified, outcome.changes.deleted)
            if outcome.restored:
                print("  ! the agent edited your capture; your original words were restored")
            _print_guarded(outcome.guarded)
        else:
            failed += 1
            print(f"Could not file {outcome.capture_id}:\n  {_tail(outcome.error) or 'the agent failed'}", file=sys.stderr)
            print("  It is still in the inbox; retry with `avanzel file`.", file=sys.stderr)
    return 1 if failed else 0


def _print_changes(created: list[str], modified: list[str], deleted: list[str]) -> None:
    for mark, paths in (("+", created), ("~", modified), ("-", deleted)):
        for path in paths:
            if "/" in path:  # shelf pages and reports; index.md/log.md churn on every run
                print(f"  {mark} {path}")


def _print_guarded(paths: list[str]) -> None:
    if paths:
        print(f"  ! undid the agent's changes to {', '.join(paths)} (library rules and settings are off-limits to it)")


def _body(capture: Capture) -> str:
    text = capture.path.read_text(encoding="utf-8")
    return text.split("---\n", 2)[-1].strip().split("\n\n![[")[0]


# Lines worth showing when an agent CLI fails. CLIs often print the whole prompt or a login banner
# before the line that matters.
_TELLING = (
    "error", "timed out", "sign in", "log in", "login", "not logged", "unauthorized", "authenticat", "api key",
    "quota", "rate limit",
)


def _tail(text: str, lines: int = 3) -> str:
    """The last few meaningful lines of an agent's output; error and login lines win when present."""
    rows = [row.strip() for row in text.strip().splitlines() if row.strip()]
    telling = [row for row in rows if any(word in row.lower() for word in _TELLING)]
    return "\n  ".join(row[:300] for row in (telling or rows)[-lines:])


def _progress(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


if __name__ == "__main__":
    sys.exit(main())
