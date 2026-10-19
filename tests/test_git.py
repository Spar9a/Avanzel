import shutil
import subprocess

import pytest

from avanzel import git
from avanzel.vault import Vault

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


@pytest.fixture
def git_identity(monkeypatch, env_home):
    for key in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"):
        monkeypatch.setenv(key, "Avanzel Test")
    for key in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
        monkeypatch.setenv(key, "test@example.com")


def _subjects(root):
    out = subprocess.run(["git", "log", "--format=%s"], cwd=root, capture_output=True, text=True).stdout
    return out.splitlines()


def test_commit_all(tmp_path, git_identity):
    git.init_repo(tmp_path)
    assert git.is_repo(tmp_path)
    (tmp_path / "a.md").write_text("a")
    assert git.commit_all(tmp_path, "first") is True
    assert git.commit_all(tmp_path, "nothing changed") is False
    assert _subjects(tmp_path) == ["first"]


def test_commit_all_outside_repo_is_noop(tmp_path):
    assert git.commit_all(tmp_path, "x") is False


def test_init_with_git_makes_first_commit(tmp_path, git_identity):
    vault = Vault.init(tmp_path / "lib", git=True)
    assert git.is_repo(vault.root)
    assert _subjects(vault.root) == ["avanzel: new library"]


def test_commit_without_git_identity_uses_a_fallback(tmp_path, env_home, monkeypatch):
    for key in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"):
        monkeypatch.delenv(key, raising=False)
    no_identity = tmp_path / "gitconfig"
    no_identity.write_text("[user]\n\tuseConfigOnly = true\n")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(no_identity))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    repo = tmp_path / "repo"
    repo.mkdir()
    git.init_repo(repo)
    (repo / "a.md").write_text("a")
    assert git.commit_all(repo, "first") is True
    author = subprocess.run(["git", "log", "--format=%an <%ae>"], cwd=repo, capture_output=True, text=True).stdout
    assert author.strip() == "Avanzel <avanzel@localhost>"
