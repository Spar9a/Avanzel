import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from avanzel.asr import Transcript
from avanzel.config import CustomHarness, Settings
from avanzel.errors import AvanzelError
from avanzel.librarian import Librarian
from avanzel.vault import Vault

FAKE_AGENT = Path(__file__).with_name("fake_agent.py")
NOW = datetime(2026, 10, 20, 14, 3, 12, tzinfo=timezone(timedelta(hours=4)))


def fake_settings(**overrides):
    fake = CustomHarness("fake", (sys.executable, str(FAKE_AGENT), "{prompt}"))
    return Settings(harness="fake", harnesses={"fake": fake}, timeout_seconds=30, **overrides)


class FakeTranscriber:
    engine = "fake:asr"

    def __init__(self, text):
        self.text, self.heard = text, []

    def transcribe(self, audio):
        self.heard.append(audio.name)
        return Transcript(self.text, self.engine, 1.5)


@pytest.fixture
def vault(tmp_path):
    return Vault.init(tmp_path / "lib", git=False)


@pytest.fixture
def librarian(vault):
    return Librarian(vault, fake_settings(), clock=lambda: NOW)


def test_file_creates_page_archives_and_logs(librarian, vault):
    capture = librarian.capture_text("Build a tiny greenhouse")
    original = capture.path.read_text()
    [outcome] = librarian.file()
    assert outcome.ok
    assert outcome.capture_id == capture.id
    assert outcome.message == f"Filed into [[idea-{capture.id}]]."
    assert outcome.changes.created == [f"ideas/idea-{capture.id}.md"]
    assert outcome.changes.modified == ["index.md", "log.md"]
    assert outcome.archived_to == vault.root / "raw" / "2026" / "10" / f"{capture.id}.md"
    assert outcome.archived_to.read_text() == original
    assert vault.pending() == []
    assert vault.log_path.read_text().count(f"[[{capture.id}]]") == 1


def test_file_failure_keeps_capture(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "fail")
    capture = librarian.capture_text("Something to keep")
    [outcome] = librarian.file()
    assert not outcome.ok
    assert "not logged in" in outcome.error
    assert outcome.archived_to is None
    assert vault.pending() == [capture.path]
    assert not vault.log_mentions(capture.id)


def test_file_restores_tampered_capture(librarian, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "tamper")
    capture = librarian.capture_text("Original words")
    original = capture.path.read_bytes()
    [outcome] = librarian.file()
    assert outcome.ok
    assert outcome.restored
    assert outcome.archived_to.read_bytes() == original


def test_file_appends_missing_log_line(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "nolog")
    capture = librarian.capture_text("Learn Rust")
    librarian.file()
    assert f"- 2026-10-20 14:03 | file | [[{capture.id}]] → [[idea-{capture.id}]]\n" in vault.log_path.read_text()


def test_file_handles_agent_archiving_itself(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "move")
    capture = librarian.capture_text("Plant tulips")
    [outcome] = librarian.file()
    assert outcome.ok
    assert not outcome.restored
    assert list(vault.raw.rglob(f"{capture.id}.md")) == [outcome.archived_to]


def test_reused_inbox_names_never_overwrite_filed_captures(librarian, vault):
    note = vault.inbox / "note.txt"
    note.write_text("first words", encoding="utf-8")
    [first] = librarian.file()
    note.write_text("second words", encoding="utf-8")
    [second] = librarian.file()
    assert first.ok and second.ok
    archived = [path.read_text(encoding="utf-8") for path in vault.raw.rglob("*.md")]
    assert sum("first words" in text for text in archived) == 1
    assert sum("second words" in text for text in archived) == 1


def test_filing_never_touches_an_existing_archive_with_the_same_name(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "tamper")
    capture = librarian.capture_text("new words")
    older = vault.archive_path(capture.path)
    older.parent.mkdir(parents=True, exist_ok=True)
    older.write_text("older words", encoding="utf-8")
    [outcome] = librarian.file()
    assert outcome.ok
    assert older.read_text(encoding="utf-8") == "older words"
    assert "new words" in outcome.archived_to.read_text(encoding="utf-8")


def test_agent_that_changes_nothing_does_not_count_as_filed(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "noop")
    capture = librarian.capture_text("Something the agent ignores")
    [outcome] = librarian.file()
    assert not outcome.ok
    assert "I would need permission to write files." in outcome.error
    assert vault.pending() == [capture.path]
    assert not vault.log_mentions(capture.id)


def test_agent_may_decide_nothing_needs_filing(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "logonly")
    capture = librarian.capture_text("test test one two")
    [outcome] = librarian.file()
    assert outcome.ok
    assert vault.pending() == []
    assert vault.log_mentions(capture.id)


def test_agent_cannot_plant_configuration_for_later_runs(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "arm")
    config = (vault.meta_dir / "config.toml").read_bytes()
    librarian.capture_text("harmless words")
    [outcome] = librarian.file()
    assert outcome.ok
    assert (vault.meta_dir / "config.toml").read_bytes() == config
    assert not (vault.root / ".claude").exists()
    assert not (vault.root / ".mcp.json").exists()
    assert outcome.guarded == [".avanzel/config.toml", ".claude/settings.json", ".mcp.json"]


def test_file_picks_up_captures_added_during_the_run(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "spawn")
    first = librarian.capture_text("First thought")
    outcomes = librarian.file()
    assert [o.capture_id for o in outcomes] == [first.id, "2026-10-20-150000-late"]
    assert vault.pending() == []


def test_file_only_given_paths(librarian, vault):
    first = librarian.capture_text("first")
    second = librarian.capture_text("second")
    assert [o.capture_id for o in librarian.file(only=[second.path])] == [second.id]
    assert vault.pending() == [first.path]


def test_file_transcribes_inbox_audio(vault):
    transcriber = FakeTranscriber("call mom about the trip")
    librarian = Librarian(vault, fake_settings(), transcriber=transcriber, clock=lambda: NOW)
    memo = vault.inbox / "Voice Memo 12.m4a"
    memo.write_bytes(b"fake audio")
    [outcome] = librarian.file()
    assert transcriber.heard == ["Voice Memo 12.m4a"]
    assert outcome.ok
    assert not memo.exists()
    assert (vault.raw / "audio" / "2026" / "10" / "2026-10-20-140312.m4a").read_bytes() == b"fake audio"
    archived = outcome.archived_to.read_text()
    assert "source: audio\n" in archived
    assert "call mom about the trip" in archived
    assert "![[2026-10-20-140312.m4a]]" in archived


def test_file_empty_transcript_keeps_audio_and_moves_on(vault):
    librarian = Librarian(vault, fake_settings(), transcriber=FakeTranscriber(""), clock=lambda: NOW)
    (vault.inbox / "silence.wav").write_bytes(b"quiet")
    [outcome] = librarian.file()
    assert outcome.ok
    assert outcome.archived_to is None
    assert "No speech" in outcome.message
    assert vault.pending() == []
    assert (vault.raw / "audio" / "2026" / "10" / "2026-10-20-140312.wav").exists()


def test_capture_audio_copies_outside_file(vault, tmp_path):
    librarian = Librarian(vault, fake_settings(), transcriber=FakeTranscriber("hello"), clock=lambda: NOW)
    outside = tmp_path / "note.wav"
    outside.write_bytes(b"audio")
    capture = librarian.capture_audio(outside, source="audio")
    assert outside.exists()
    assert (vault.raw / "audio" / "2026" / "10" / "2026-10-20-140312.wav").read_bytes() == b"audio"
    assert capture.source == "audio"


def _git_identity(monkeypatch):
    for key in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"):
        monkeypatch.setenv(key, "Avanzel Test")
    for key in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
        monkeypatch.setenv(key, "test@example.com")


def _git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True).stdout


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_file_commits_when_git(tmp_path, env_home, monkeypatch):
    _git_identity(monkeypatch)
    vault = Vault.init(tmp_path / "lib", git=True)
    librarian = Librarian(vault, fake_settings(), clock=lambda: NOW)
    capture = librarian.capture_text("Commit me")
    librarian.file()
    assert _git(vault.root, "log", "--format=%s").splitlines() == [f"avanzel: file {capture.id}", "avanzel: new library"]
    assert _git(vault.root, "status", "--porcelain") == ""


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_planted_git_hook_never_runs(tmp_path, env_home, monkeypatch):
    _git_identity(monkeypatch)
    monkeypatch.setenv("FAKE_AGENT_MODE", "arm")
    vault = Vault.init(tmp_path / "lib", git=True)
    librarian = Librarian(vault, fake_settings(), clock=lambda: NOW)
    librarian.capture_text("harmless words")
    [outcome] = librarian.file()
    assert outcome.ok
    assert not (vault.root / ".git" / "hooks" / "post-commit").exists()
    assert not (vault.root / "HOOK_RAN").exists()
    assert _git(vault.root, "log", "--format=%s").splitlines()[0].startswith("avanzel: file ")


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_file_respects_auto_commit_off(tmp_path, env_home, monkeypatch):
    _git_identity(monkeypatch)
    vault = Vault.init(tmp_path / "lib", git=True)
    librarian = Librarian(vault, fake_settings(auto_commit=False), clock=lambda: NOW)
    librarian.capture_text("Do not commit me")
    librarian.file()
    assert _git(vault.root, "log", "--format=%s").splitlines() == ["avanzel: new library"]


def test_ask_readonly_returns_answer(librarian, vault):
    (vault.root / "goals" / "run.md").write_text("# Run")
    outcome = librarian.ask("What are my goals?")
    assert outcome.result.ok
    assert outcome.result.output == "Q: What are my goals?\nPages: goals/run.md"
    assert outcome.changes.empty


def test_ask_save_files_answer_and_logs(librarian, vault):
    outcome = librarian.ask("Summarize my ideas", save=True)
    assert outcome.changes.created == ["topics/answer.md"]
    assert "- 2026-10-20 14:03 | ask | Summarize my ideas → [[answer]]\n" in vault.log_path.read_text()


def test_ask_empty_question_raises(librarian):
    with pytest.raises(AvanzelError):
        librarian.ask("   ")


def test_review_writes_report_fallback(librarian, vault, monkeypatch):
    monkeypatch.setenv("FAKE_AGENT_MODE", "noreport")
    outcome = librarian.review()
    assert outcome.report == vault.root / "reviews" / "2026-10-20.md"
    assert outcome.report.read_text() == "# Review 2026-10-20\n\nLibrary looks healthy.\n"
    assert "- 2026-10-20 14:03 | review | [[2026-10-20]]\n" in vault.log_path.read_text()


def test_review_twice_same_day_gets_new_report(librarian, vault):
    first = librarian.review().report
    second = librarian.review().report
    assert (first.name, second.name) == ("2026-10-20.md", "2026-10-20-2.md")
