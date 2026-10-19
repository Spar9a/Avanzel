"""What an agent run changed in the library: snapshot before, snapshot after, diff."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

Snapshot = dict[str, tuple[int, int]]


@dataclass(frozen=True)
class Changes:
    created: list[str]
    modified: list[str]
    deleted: list[str]

    @property
    def empty(self) -> bool:
        return not (self.created or self.modified or self.deleted)

    @property
    def pages(self) -> list[str]:
        """Markdown files written inside a folder (shelf pages), not root files like index.md."""
        return sorted(p for p in self.created + self.modified if p.endswith(".md") and "/" in p)

    def without(self, prefixes: tuple[str, ...]) -> Changes:
        def keep(paths: list[str]) -> list[str]:
            return [p for p in paths if not p.startswith(prefixes)]

        return Changes(keep(self.created), keep(self.modified), keep(self.deleted))


def snapshot(root: Path) -> Snapshot:
    """Map every visible file to (size, mtime_ns); hidden paths (.git, .avanzel, .obsidian, …) are skipped."""
    state: Snapshot = {}
    for path in root.rglob("*"):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts) or not path.is_file():
            continue
        stat = path.stat()
        state[rel.as_posix()] = (stat.st_size, stat.st_mtime_ns)
    return dict(sorted(state.items()))


def diff(before: Snapshot, after: Snapshot) -> Changes:
    return Changes(
        created=sorted(set(after) - set(before)),
        modified=sorted(p for p in set(after) & set(before) if after[p] != before[p]),
        deleted=sorted(set(before) - set(after)),
    )
