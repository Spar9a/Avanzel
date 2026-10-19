"""Version the library with git so every agent edit is reviewable and undoable."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def available() -> bool:
    return shutil.which("git") is not None


def is_repo(root: Path) -> bool:
    return (root / ".git").exists()


def init_repo(root: Path) -> None:
    _git(root, "init", "-q", check=True)


def commit_all(root: Path, message: str) -> bool:
    """Stage everything and commit; False when there is nothing to commit or git refuses."""
    if not is_repo(root) or not available():
        return False
    _git(root, "add", "-A")
    if not _git(root, "status", "--porcelain").stdout.strip():
        return False
    # The library is private notes, not code: no hooks (an agent must not be able to plant one) and
    # no signing prompts.
    commit = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message]
    if _git(root, *commit).returncode == 0:
        return True
    # Most often: git has no user name/email on this machine. Author the commit as Avanzel instead.
    fallback = ["-c", "user.name=Avanzel", "-c", "user.email=avanzel@localhost"]
    return _git(root, *fallback, *commit).returncode == 0


def _git(root: Path, *args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=check)
