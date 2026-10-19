"""The orchestration layer: hand one capture at a time to the harness and enforce the filing contract.

The agent does the thinking (which shelf, which pages, which links). Avanzel guarantees the
bookkeeping no matter how the agent behaves: the owner's words are restored if touched, a run that
filed nothing leaves the capture in the inbox, the log gets its line, the capture is archived under
a name that never overwrites another, the library's rules and executable settings are put back,
and the library is committed to git.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath

from avanzel import git as gitops
from avanzel.asr import Transcriber, make_transcriber
from avanzel.changes import Changes, diff, snapshot
from avanzel.config import Settings
from avanzel.errors import AvanzelError
from avanzel.harness import Harness, RunResult, run_headless, select_harness
from avanzel.prompts import ask_prompt, file_prompt, review_prompt
from avanzel.vault import AUDIO_EXTS, Capture, Vault, now_local

_NO_CHANGES = Changes([], [], [])
_SOURCES = ("inbox/", "raw/")
# Instructions and settings that load or execute on later runs. A headless agent run may not change
# them (a capture could carry a prompt injection); Avanzel undoes any change after every run.
_PROTECTED = (
    "AGENTS.md", "CLAUDE.md", ".avanzel/config.toml", "opencode.json", ".mcp.json",
    ".git/config", ".git/hooks", ".agents", ".claude", ".codex", ".cursor", ".gemini", ".opencode",
)


@dataclass(frozen=True)
class FileOutcome:
    capture_id: str
    ok: bool
    changes: Changes
    message: str = ""
    archived_to: Path | None = None
    error: str = ""
    restored: bool = False
    guarded: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AgentOutcome:
    result: RunResult
    changes: Changes
    report: Path | None = None
    guarded: list[str] = field(default_factory=list)


def _quiet(message: str) -> None:
    pass


class Librarian:
    def __init__(
        self,
        vault: Vault,
        settings: Settings,
        *,
        harness_name: str | None = None,
        transcriber: Transcriber | None = None,
        verbose: bool = False,
        clock: Callable[[], datetime] = now_local,
    ) -> None:
        self.vault = vault
        self.settings = settings
        self.harness_name = harness_name
        self.verbose = verbose
        self.clock = clock
        self._harness: Harness | None = None
        self._transcriber = transcriber

    @property
    def harness(self) -> Harness:
        if self._harness is None:
            self._harness = select_harness(self.settings, self.harness_name)
        return self._harness

    @property
    def transcriber(self) -> Transcriber:
        if self._transcriber is None:
            self._transcriber = make_transcriber(self.settings.voice)
        return self._transcriber

    # --- capture ---------------------------------------------------------------------------

    def capture_text(self, text: str, *, source: str = "text") -> Capture:
        return self.vault.new_capture(text, source=source, now=self.clock())

    def capture_audio(self, audio: Path, *, source: str, keep_original: bool = True) -> Capture | None:
        """Transcribe locally, keep the recording under raw/audio, and write the capture.
        Returns None when no speech was recognised (the recording is still kept)."""
        now = self.clock()
        transcript = self.transcriber.transcribe(audio)
        stored = audio
        if not audio.resolve().is_relative_to((self.vault.raw / "audio").resolve()):
            stored = self.vault.new_audio_path(now, audio.suffix.lower() or ".wav")
            if keep_original:
                shutil.copy2(audio, stored)
            else:
                shutil.move(audio, stored)
        if not transcript.text:
            return None
        return self.vault.new_capture(
            transcript.text, source=source, audio=stored, transcriber=transcript.engine, now=now
        )

    # --- file --------------------------------------------------------------------------------

    def file(self, only: list[Path] | None = None, progress: Callable[[str], None] = _quiet) -> list[FileOutcome]:
        """File captures one per agent run, oldest first. Without `only`, the inbox is re-read after
        every capture, so anything captured meanwhile (e.g. a background `add`) is filed too."""
        outcomes: list[FileOutcome] = []
        attempted: set[Path] = set()
        with self.vault.lock(on_wait=lambda: progress("Waiting for another Avanzel run on this library…")):
            while True:
                queue = only if only is not None else self.vault.pending()
                todo = [path for path in queue if path not in attempted and path.is_file()]
                if not todo:
                    return outcomes
                path = todo[0]
                attempted.add(path)
                if path.suffix.lower() in AUDIO_EXTS:
                    progress(f"Transcribing {path.name} locally…")
                    try:
                        capture = self.capture_audio(path, source="audio", keep_original=False)
                    except AvanzelError as exc:
                        outcomes.append(FileOutcome(path.stem, False, _NO_CHANGES, error=str(exc)))
                        continue
                    if capture is None:
                        message = "No speech recognized; the recording was kept in raw/audio."
                        outcomes.append(FileOutcome(path.stem, True, _NO_CHANGES, message=message))
                        continue
                    path = capture.path
                    attempted.add(path)
                try:
                    path = self._adopt(path)
                except AvanzelError as exc:
                    outcomes.append(FileOutcome(path.stem, False, _NO_CHANGES, error=f"{path.name}: {exc}"))
                    continue
                attempted.add(path)
                progress(f"Filing {path.name} with {self.harness.name}…")
                outcomes.append(self._file_one(path))

    def _adopt(self, path: Path) -> Path:
        """Give a file dropped into the inbox by hand (Obsidian's "Untitled.md", a Shortcut's
        "note.txt") a fresh capture id, so archiving it can never overwrite an earlier capture."""
        text = path.read_text(encoding="utf-8", errors="replace")
        frontmatter, body = _split_frontmatter(text)
        if "\ntype: capture\n" in f"\n{frontmatter}\n" and not self.vault.archive_path(path).exists():
            return path
        capture = self.vault.new_capture(body if frontmatter else text, source="text", now=self.clock())
        path.unlink()
        return capture.path

    def _file_one(self, path: Path) -> FileOutcome:
        root = self.vault.root
        now = self.clock()
        capture_id = path.stem
        original = path.read_bytes()
        archive_target = self.vault.archive_path(path, now=now)
        archive_existed = archive_target.exists()
        before = snapshot(root)
        result, guarded = self._run(file_prompt(path.relative_to(root).as_posix(), capture_id, now), write=True)
        restored = self._restore(path, original, None if archive_existed else archive_target)
        changes = diff(before, snapshot(root)).without(_SOURCES + tuple(guarded))
        if not result.ok:
            error = (result.stderr or result.output).strip()[-800:]
            return FileOutcome(capture_id, False, changes, result.output, error=error, restored=restored, guarded=guarded)
        if not changes.pages and not self.vault.log_mentions(capture_id):
            # Exit 0 but nothing written: a denied tool, a refusal or a question back. Not filed.
            reply = " ".join(result.output.split()) or "(no reply)"
            error = f"{self.harness.name} finished without filing anything. Its reply: {reply[:500]}"
            return FileOutcome(capture_id, False, changes, result.output, error=error, restored=restored, guarded=guarded)
        if not self.vault.log_mentions(capture_id):
            pages = ", ".join(f"[[{PurePosixPath(page).stem}]]" for page in changes.pages)
            self.vault.append_log("file", f"[[{capture_id}]] → {pages}", now=now)
        archived = self.vault.archive(path, now=now)
        self._commit(f"avanzel: file {capture_id}")
        return FileOutcome(
            capture_id, True, changes, result.output, archived_to=archived, restored=restored, guarded=guarded
        )

    @staticmethod
    def _restore(path: Path, original: bytes, archive_target: Path | None) -> bool:
        """Put the capture back exactly as the owner said it. True if the agent had changed it.
        `archive_target` is where the agent may have archived it itself (None if that file predates the run)."""
        if path.is_file() and not path.is_symlink() and path.read_bytes() == original:
            return False
        if (
            archive_target is not None
            and not path.exists()
            and archive_target.is_file()
            and not archive_target.is_symlink()
            and archive_target.read_bytes() == original
        ):
            os.replace(archive_target, path)  # the agent archived it itself; that is fine
            return False
        _rewrite(path, original)
        if archive_target is not None and (archive_target.exists() or archive_target.is_symlink()):
            archive_target.unlink()
        return True

    # --- ask & review ------------------------------------------------------------------------

    def ask(self, question: str, *, save: bool = False) -> AgentOutcome:
        if not question.strip():
            raise AvanzelError('Ask a question, e.g. avanzel ask "what are my goals this year?"')
        now = self.clock()
        with self.vault.lock() if save else nullcontext():
            before = snapshot(self.vault.root)
            result, guarded = self._run(ask_prompt(question, save=save, now=now), write=save)
            changes = diff(before, snapshot(self.vault.root)).without(tuple(guarded))
            if save and result.ok and changes.pages:
                if "log.md" not in changes.modified:
                    one_line = " ".join(question.split())[:80]
                    pages = ", ".join(f"[[{PurePosixPath(page).stem}]]" for page in changes.pages)
                    self.vault.append_log("ask", f"{one_line} → {pages}", now=now)
                self._commit(f"avanzel: save answer to “{' '.join(question.split())[:60]}”")
        return AgentOutcome(result, changes, guarded=guarded)

    def review(self) -> AgentOutcome:
        now = self.clock()
        with self.vault.lock():
            report = self._new_report_path(now)
            before = snapshot(self.vault.root)
            prompt = review_prompt(report.relative_to(self.vault.root).as_posix(), now)
            result, guarded = self._run(prompt, write=True)
            if result.ok and not report.exists() and result.output:
                report.write_text(f"# Review {now:%Y-%m-%d}\n\n{result.output}\n", encoding="utf-8")
            changes = diff(before, snapshot(self.vault.root)).without(tuple(guarded))
            if result.ok:
                if not self.vault.log_mentions(report.stem):
                    self.vault.append_log("review", f"[[{report.stem}]]", now=now)
                self._commit(f"avanzel: review {report.stem}")
        return AgentOutcome(result, changes, report if report.exists() else None, guarded)

    def _new_report_path(self, now: datetime) -> Path:
        folder = self.vault.root / "reviews"
        folder.mkdir(parents=True, exist_ok=True)
        stem, counter = f"{now:%Y-%m-%d}", 2
        candidate = folder / f"{stem}.md"
        while candidate.exists():
            candidate = folder / f"{stem}-{counter}.md"
            counter += 1
        return candidate

    # --- plumbing ----------------------------------------------------------------------------

    def _run(self, prompt: str, *, write: bool) -> tuple[RunResult, list[str]]:
        """One agent run; returns its result and the protected paths whose changes were undone."""
        root = self.vault.root
        protected_dirs = {rel for rel in _PROTECTED if (root / rel).is_dir()}
        protected = _protected_files(root)
        try:
            result = run_headless(
                self.harness,
                prompt,
                root,
                write=write,
                model=self.settings.models.get(self.harness.name),
                timeout=self.settings.timeout_seconds,
                verbose=self.verbose,
            )
        finally:
            guarded = _undo_protected(root, protected, protected_dirs)
        return result, guarded

    def _commit(self, message: str) -> None:
        if self.settings.auto_commit:
            gitops.commit_all(self.vault.root, message)


def _split_frontmatter(text: str) -> tuple[str, str]:
    """(frontmatter, body) of a Markdown file; frontmatter is "" when there is none."""
    if text.startswith("---\n"):
        end = text.find("\n---\n", 3)
        if end != -1:
            return text[4:end], text[end + 5 :]
    return "", text


def _rewrite(path: Path, data: bytes) -> None:
    """Write `data` to `path` itself, never through a symlink an agent may have put there."""
    if path.is_symlink() or path.is_file():
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _protected_files(root: Path) -> dict[str, bytes]:
    found: dict[str, bytes] = {}
    for rel in _PROTECTED:
        path = root / rel
        if path.is_symlink():
            continue
        files = [path] if path.is_file() else sorted(path.rglob("*")) if path.is_dir() else []
        for file in files:
            if file.is_file() and not file.is_symlink():
                found[file.relative_to(root).as_posix()] = file.read_bytes()
    return found


def _undo_protected(root: Path, before: dict[str, bytes], dirs_before: set[str]) -> list[str]:
    after = _protected_files(root)
    touched = sorted(rel for rel in before.keys() | after.keys() if before.get(rel) != after.get(rel))
    for rel in _PROTECTED:  # also catch symlinks planted in place of protected files
        if (root / rel).is_symlink() and rel not in touched:
            touched.append(rel)
    for rel in touched:
        path = root / rel
        if rel in before:
            _rewrite(path, before[rel])
        elif path.is_symlink() or path.is_file():
            path.unlink()
    for rel in _PROTECTED:
        folder = root / rel
        if rel not in dirs_before and folder.is_dir() and not folder.is_symlink():
            shutil.rmtree(folder)
    return sorted(touched)
