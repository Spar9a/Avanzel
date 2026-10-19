"""The library on disk: layout, captures, inbox, archive, log.

Karpathy's LLM-wiki layers map onto folders: `inbox/` + `raw/` hold the owner's immutable words,
the shelves hold the agent-maintained wiki, and AGENTS.md is the schema every harness reads.
"""

from __future__ import annotations

import fcntl
import itertools
import os
import re
import unicodedata
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from importlib import resources
from pathlib import Path

from avanzel import git as gitops
from avanzel.errors import AvanzelError

SHELVES = ("goals", "ideas", "problems", "memories", "people", "topics")
SPECIAL_DIRS = ("inbox", "raw", "reviews")
TEXT_EXTS = frozenset({".md", ".txt"})
AUDIO_EXTS = frozenset(
    {".wav", ".m4a", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".aiff", ".aif", ".aac", ".webm", ".mp4", ".caf"}
)

# vault-relative path -> template name
_SCAFFOLD = {
    "AGENTS.md": "AGENTS.md",
    "CLAUDE.md": "CLAUDE.md",
    "index.md": "index.md",
    "log.md": "log.md",
    "opencode.json": "opencode.json",
    ".gitignore": "gitignore",
    ".avanzel/config.toml": "config.toml",
}


def _publish(path: Path, content: str) -> bool:
    """Create `path` with `content` atomically; False if the name is already taken.

    The content goes to a private temp file that is then hard-linked into place: the link fails
    instead of overwriting when another capture claimed the name first, and a concurrent filer never
    sees half a file. Filesystems without hard links fall back to an exclusive create.
    """
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    partial.write_text(content, encoding="utf-8")
    try:
        os.link(partial, path)
        return True
    except FileExistsError:
        return False
    except OSError:
        try:
            with open(path, "x", encoding="utf-8") as handle:
                handle.write(content)
            return True
        except FileExistsError:
            return False
    finally:
        partial.unlink()


def template(name: str) -> str:
    return resources.files("avanzel").joinpath("templates", *name.split("/")).read_text(encoding="utf-8")


def slugify(text: str, max_words: int = 5, max_len: int = 40) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    words = re.findall(r"[a-z0-9]+", ascii_text.lower())[:max_words]
    return "-".join(words)[:max_len].strip("-")


def now_local() -> datetime:
    return datetime.now().astimezone()


@dataclass(frozen=True)
class Capture:
    id: str
    path: Path
    source: str


class Vault:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    @property
    def inbox(self) -> Path:
        return self.root / "inbox"

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def index_path(self) -> Path:
        return self.root / "index.md"

    @property
    def log_path(self) -> Path:
        return self.root / "log.md"

    @property
    def meta_dir(self) -> Path:
        return self.root / ".avanzel"

    @property
    def lock_path(self) -> Path:
        return self.meta_dir / "lock"

    @property
    def logs_dir(self) -> Path:
        return self.meta_dir / "logs"

    def exists(self) -> bool:
        return self.meta_dir.is_dir()

    def require(self) -> Vault:
        if not self.exists():
            raise AvanzelError(
                f"No Avanzel library at {self.root}. Create one with `avanzel init` (or point --vault at it)."
            )
        return self

    @classmethod
    def init(cls, root: Path, *, git: bool = True) -> Vault:
        vault = cls(root)
        for folder in (*SPECIAL_DIRS, *SHELVES):
            (vault.root / folder).mkdir(parents=True, exist_ok=True)
        vault.logs_dir.mkdir(parents=True, exist_ok=True)
        for rel, name in _SCAFFOLD.items():
            target = vault.root / rel
            if not target.exists():
                target.write_text(template(name), encoding="utf-8")
        if git and gitops.available() and not gitops.is_repo(vault.root):
            gitops.init_repo(vault.root)
            gitops.commit_all(vault.root, "avanzel: new library")
        return vault

    # --- captures -------------------------------------------------------------------------

    def new_capture(
        self,
        text: str,
        *,
        source: str,
        audio: Path | None = None,
        transcriber: str | None = None,
        now: datetime | None = None,
    ) -> Capture:
        text = text.strip()
        if not text:
            raise AvanzelError("Nothing to capture: the text is empty.")
        now = now or now_local()
        stamp = now.strftime("%Y-%m-%d-%H%M%S")
        slug = slugify(text)

        def render(capture_id: str) -> str:
            lines = ["---", f"id: {capture_id}", "type: capture", f"source: {source}"]
            lines.append(f"created: {now.isoformat(timespec='seconds')}")
            if audio is not None:
                lines.append(f"audio: {audio.relative_to(self.root).as_posix()}")
            if transcriber:
                lines.append(f"transcriber: {transcriber}")
            lines += ["---", "", text, ""]
            if audio is not None:
                lines += [f"![[{audio.name}]]", ""]
            return "\n".join(lines)

        self.inbox.mkdir(parents=True, exist_ok=True)
        for capture_id in self._candidate_ids(f"{stamp}-{slug}" if slug else stamp):
            path = self.inbox / f"{capture_id}.md"
            if _publish(path, render(capture_id)):
                return Capture(capture_id, path, source)
        raise AssertionError("unreachable: candidate ids are unbounded")

    def new_audio_path(self, now: datetime, suffix: str = ".wav") -> Path:
        """Claim a fresh recording path (created empty, so concurrent recorders never share one)."""
        folder = self.raw / "audio" / now.strftime("%Y") / now.strftime("%m")
        folder.mkdir(parents=True, exist_ok=True)
        stem = now.strftime("%Y-%m-%d-%H%M%S")
        for counter in itertools.count(1):
            candidate = folder / (f"{stem}{suffix}" if counter == 1 else f"{stem}-{counter}{suffix}")
            try:
                with open(candidate, "x"):
                    return candidate
            except FileExistsError:
                continue
        raise AssertionError("unreachable")

    def pending(self) -> list[Path]:
        if not self.inbox.is_dir():
            return []
        return sorted(
            path
            for path in self.inbox.iterdir()
            if path.is_file() and not path.name.startswith(".") and path.suffix.lower() in TEXT_EXTS | AUDIO_EXTS
        )

    def archive_path(self, capture_path: Path, *, now: datetime | None = None) -> Path:
        dated = re.match(r"(\d{4})-(\d{2})-", capture_path.name)
        if dated:
            year, month = dated.groups()
        else:
            when = now or now_local()
            year, month = when.strftime("%Y"), when.strftime("%m")
        return self.raw / year / month / capture_path.name

    def archive(self, capture_path: Path, *, now: datetime | None = None) -> Path:
        destination = self.archive_path(capture_path, now=now)
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(capture_path, destination)
        return destination

    def _candidate_ids(self, stem: str) -> Iterator[str]:
        for counter in itertools.count(1):
            candidate = stem if counter == 1 else f"{stem}-{counter}"
            taken = (self.inbox / f"{candidate}.md").exists() or self.archive_path(Path(f"{candidate}.md")).exists()
            if not taken:
                yield candidate

    # --- log, shelves, lock ----------------------------------------------------------------

    @staticmethod
    def log_line(now: datetime, op: str, details: str) -> str:
        return f"- {now:%Y-%m-%d %H:%M} | {op} | {details}"

    def append_log(self, op: str, details: str, *, now: datetime | None = None) -> None:
        existing = self.log_path.read_text(encoding="utf-8") if self.log_path.exists() else "# Log\n"
        if existing and not existing.endswith("\n"):
            existing += "\n"
        line = self.log_line(now or now_local(), op, details)
        self.log_path.write_text(f"{existing}{line}\n", encoding="utf-8")

    def log_mentions(self, capture_id: str) -> bool:
        if not self.log_path.exists():
            return False
        return f"[[{capture_id}]]" in self.log_path.read_text(encoding="utf-8")

    def shelf_counts(self) -> dict[str, int]:
        folders = [
            path.name
            for path in self.root.iterdir()
            if path.is_dir() and not path.name.startswith(".") and path.name not in SPECIAL_DIRS
        ]
        ordered = [name for name in SHELVES if name in folders] + sorted(set(folders) - set(SHELVES))
        return {name: sum(1 for _ in (self.root / name).rglob("*.md")) for name in ordered}

    @contextmanager
    def lock(self, on_wait: Callable[[], None] | None = None) -> Iterator[None]:
        """Serialise agent runs on this library (e.g. a background filer and a foreground one)."""
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if on_wait is not None:
                    on_wait()
                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
