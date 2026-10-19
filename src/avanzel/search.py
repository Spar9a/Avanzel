"""Plain keyword search over the shelves — enough for a personal library, no index to maintain."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_SOURCE_DIRS = ("inbox", "raw")


@dataclass(frozen=True)
class SearchHit:
    path: str
    score: int
    line: str


def search(root: Path, query: str, limit: int = 10) -> list[SearchHit]:
    terms = re.findall(r"\w+", query.lower())
    if not terms:
        return []
    hits = []
    for path in root.rglob("*.md"):
        rel = path.relative_to(root)
        if len(rel.parts) < 2 or rel.parts[0] in _SOURCE_DIRS or any(p.startswith(".") for p in rel.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lower, stem = text.lower(), path.stem.lower()
        # Body occurrences, plus a bonus when the page is named after the term.
        score = sum(lower.count(term) + 3 * (term in stem) for term in terms)
        if score:
            hits.append(SearchHit(rel.as_posix(), score, _matching_line(text, terms)))
    hits.sort(key=lambda hit: (-hit.score, hit.path))
    return hits[:limit]


def _matching_line(text: str, terms: list[str]) -> str:
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), 0)
        lines = lines[end + 1 :]
    for line in lines:
        if any(term in line.lower() for term in terms):
            return line.strip()[:160]
    return ""
