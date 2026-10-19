"""Install the Avanzel Agent Skill (SKILL.md, agentskills.io format) where each harness looks for it."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from avanzel.errors import AvanzelError
from avanzel.vault import template

SKILL_NAME = "avanzel"

# target -> (skills folder under $HOME, binaries whose harness reads that folder)
_TARGETS: dict[str, tuple[str, tuple[str, ...]]] = {
    "claude": (".claude/skills", ("claude", "opencode")),
    "agents": (".agents/skills", ("codex", "opencode")),
    "cursor": (".cursor/skills", ("cursor-agent",)),
}


@dataclass(frozen=True)
class SkillTarget:
    name: str
    skills_dir: Path


def skill_targets(
    home: Path, *, which: Callable[[str], str | None] = shutil.which, only: str | None = None
) -> list[SkillTarget]:
    """Skill folders to install into: the ones the installed harnesses read, or `only` (a target or "all")."""
    if only is None:
        names = [name for name, (_, binaries) in _TARGETS.items() if any(which(b) for b in binaries)]
    elif only == "all":
        names = list(_TARGETS)
    elif only in _TARGETS:
        names = [only]
    else:
        raise AvanzelError(f"Unknown skill target '{only}'. Choose from: {', '.join(_TARGETS)}, all.")
    return [SkillTarget(name, home / _TARGETS[name][0]) for name in names]


def render_skill() -> str:
    return template("skill/SKILL.md")


def install_skill(targets: list[SkillTarget], *, dry_run: bool = False) -> list[Path]:
    paths = [target.skills_dir / SKILL_NAME / "SKILL.md" for target in targets]
    if not dry_run:
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(render_skill(), encoding="utf-8")
    return paths
