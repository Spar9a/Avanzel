import re

import pytest

from avanzel.errors import AvanzelError
from avanzel.skills import SKILL_NAME, SkillTarget, install_skill, render_skill, skill_targets


def _which(*present):
    return lambda binary: f"/usr/bin/{binary}" if binary in present else None


def test_skill_frontmatter_valid():
    text = render_skill()
    assert text.startswith("---\n")
    front = text.split("---\n")[1]
    fields = dict(line.split(": ", 1) for line in front.strip().splitlines())
    assert fields["name"] == SKILL_NAME == "avanzel"
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", fields["name"])
    assert 1 <= len(fields["description"]) <= 1024


def test_targets_follow_installed_harnesses(tmp_path):
    assert skill_targets(tmp_path, which=_which("codex")) == [SkillTarget("agents", tmp_path / ".agents" / "skills")]
    assert [t.name for t in skill_targets(tmp_path, which=_which("claude", "cursor-agent"))] == ["claude", "cursor"]
    assert [t.name for t in skill_targets(tmp_path, which=_which("opencode"))] == ["claude", "agents"]
    assert skill_targets(tmp_path, which=_which()) == []


def test_targets_explicit_choice(tmp_path):
    assert [t.name for t in skill_targets(tmp_path, which=_which(), only="all")] == ["claude", "agents", "cursor"]
    assert [t.name for t in skill_targets(tmp_path, which=_which(), only="cursor")] == ["cursor"]
    with pytest.raises(AvanzelError, match="vim"):
        skill_targets(tmp_path, only="vim")


def test_install_writes_and_dry_run_doesnt(tmp_path):
    targets = skill_targets(tmp_path, which=_which(), only="all")
    planned = install_skill(targets, dry_run=True)
    assert planned == [
        tmp_path / ".claude" / "skills" / "avanzel" / "SKILL.md",
        tmp_path / ".agents" / "skills" / "avanzel" / "SKILL.md",
        tmp_path / ".cursor" / "skills" / "avanzel" / "SKILL.md",
    ]
    assert not any(path.exists() for path in planned)
    assert install_skill(targets) == planned
    assert all(path.read_text().startswith("---\nname: avanzel\n") for path in planned)
