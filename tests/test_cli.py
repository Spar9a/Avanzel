import io
import json
import os
import re
import sys
from pathlib import Path

import pytest

from avanzel.cli import main
from avanzel.skills import render_skill
from avanzel.vault import Vault

FAKE_AGENT = Path(__file__).with_name("fake_agent.py")


def _configure(root, *, voice_command=None):
    """Point the library at the fake agent (and optionally a scripted speech-to-text command)."""
    config = root / ".avanzel" / "config.toml"
    text = config.read_text().replace('harness = "auto"', 'harness = "fake"')
    if voice_command:
        text = text.replace('backend = "onnx-asr"', f'backend = "command"\ncommand = {json.dumps(voice_command)}')
    text += (
        "\n[harnesses.fake]\n"
        f"headless = {json.dumps([sys.executable, str(FAKE_AGENT), '{prompt}'])}\n"
        f"interactive = {json.dumps([sys.executable, '-c', 'pass'])}\n"
    )
    config.write_text(text)


@pytest.fixture
def library(env_home, tmp_path, monkeypatch, capsys):
    root = tmp_path / "My Brain"
    assert main(["init", str(root), "--no-git"]) == 0
    _configure(root)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    capsys.readouterr()
    return root


def test_cli_init_and_where(env_home, tmp_path, monkeypatch, capsys):
    root = tmp_path / "lib"
    assert main(["init", str(root), "--no-git"]) == 0
    assert (root / "AGENTS.md").is_file()
    assert "avanzel add" in capsys.readouterr().out
    monkeypatch.chdir(tmp_path)
    assert main(["where"]) == 0
    assert capsys.readouterr().out.strip() == str(root)


def test_cli_add_no_file_then_file(library, capsys):
    assert main(["add", "--no-file", "Build", "a", "greenhouse"]) == 0
    assert "Captured" in capsys.readouterr().out
    assert len(Vault(library).pending()) == 1
    assert main(["file"]) == 0
    out = capsys.readouterr().out
    assert "Filed into [[idea-" in out
    assert "+ ideas/idea-" in out
    assert Vault(library).pending() == []


def test_cli_add_files_immediately(library, capsys):
    assert main(["add", "Call", "Anna", "about", "the", "trip"]) == 0
    assert Vault(library).pending() == []
    assert len(list((library / "ideas").glob("idea-*.md"))) == 1


def test_cli_add_reads_stdin(library, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO("piped thought\nsecond line\n"))
    assert main(["add", "--no-file"]) == 0
    [capture] = Vault(library).pending()
    assert "piped thought\nsecond line\n" in capture.read_text()


def test_cli_add_nothing_errors(library, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    assert main(["add"]) == 1
    assert "Nothing to capture" in capsys.readouterr().err


def test_cli_file_failure_exit_code(library, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_AGENT_MODE", "fail")
    assert main(["add", "Will fail"]) == 1
    err = capsys.readouterr().err
    assert "not logged in" in err
    assert len(Vault(library).pending()) == 1


def test_cli_failure_shows_the_error_not_the_echoed_prompt(library, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_AGENT_MODE", "fail-noisy")
    assert main(["add", "Will fail"]) == 1
    err = capsys.readouterr().err
    assert "ERROR: the model is not supported with this account" in err
    assert "echoed prompt line" not in err


def test_cli_failure_surfaces_login_prompt(library, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_AGENT_MODE", "fail-signin")
    assert main(["ask", "anything?"]) == 1
    err = capsys.readouterr().err
    assert "Press any key to sign in" in err
    assert "ttttt" not in err


def test_cli_timeout_is_reported_as_a_timeout(library, monkeypatch, capsys):
    config = library / ".avanzel" / "config.toml"
    config.write_text(config.read_text().replace("timeout_seconds = 900", "timeout_seconds = 1"))
    monkeypatch.setenv("FAKE_AGENT_MODE", "slow-noisy")
    assert main(["add", "Takes forever"]) == 1
    assert "timed out after 1s" in capsys.readouterr().err


def test_cli_reports_undone_config_changes(library, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_AGENT_MODE", "arm")
    assert main(["add", "harmless words"]) == 0
    out = capsys.readouterr().out
    assert ".claude/settings.json" in out
    assert ".avanzel/config.toml" in out


def test_cli_init_refuses_a_non_empty_folder(env_home, tmp_path, capsys):
    folder = tmp_path / "Documents"
    folder.mkdir()
    (folder / "taxes.pdf").write_bytes(b"%PDF")
    assert main(["init", str(folder), "--no-git"]) == 1
    assert "--force" in capsys.readouterr().err
    assert not (folder / ".avanzel").exists()
    assert main(["init", str(folder), "--no-git", "--force"]) == 0
    assert (folder / ".avanzel").is_dir()
    assert main(["init", str(folder), "--no-git"]) == 0


def test_cli_record_without_microphone_leaves_no_empty_audio(library, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "sounddevice", None)
    monkeypatch.setattr(sys, "stdin", io.StringIO("\n"))
    assert main(["record"]) == 1
    assert "icrophone" in capsys.readouterr().err
    assert [p for p in (library / "raw").rglob("*") if p.is_file()] == []


def test_cli_ask_prints_answer(library, capsys):
    (library / "goals" / "run.md").write_text("# Run")
    assert main(["ask", "what", "are", "my", "goals?"]) == 0
    assert "Q: what are my goals?\nPages: goals/run.md" in capsys.readouterr().out


def test_cli_review_prints_report(library, capsys):
    assert main(["review"]) == 0
    out = capsys.readouterr().out
    assert "Library looks healthy." in out
    assert "reviews/" in out


def test_cli_status_reports_inbox_and_shelves(library, capsys):
    main(["add", "--no-file", "one"])
    capsys.readouterr()
    assert main(["status"]) == 0
    out = capsys.readouterr().out
    assert str(library) in out
    assert "1 waiting" in out
    assert "goals 0" in out
    assert "fake" in out


def test_cli_search(library, capsys):
    (library / "goals" / "run-a-marathon.md").write_text("# Run a marathon\n")
    assert main(["search", "marathon"]) == 0
    assert "goals/run-a-marathon.md: # Run a marathon" in capsys.readouterr().out


def test_cli_errors_without_vault(env_home, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["add", "hello"]) == 1
    assert "avanzel init" in capsys.readouterr().err


def test_cli_end_to_end_path_with_spaces(library, capsys):
    assert " " in str(library)
    assert main(["status", "--vault", str(library)]) == 0
    assert main(["--vault", str(library), "add", "Plant tulips in spring"]) == 0
    [archived] = list((library / "raw").rglob("*.md"))
    assert f"[[{archived.stem}]]" in (library / "log.md").read_text()


def test_cli_record_transcribes_and_files(env_home, tmp_path, monkeypatch, capsys, fake_microphone):
    root = tmp_path / "lib"
    main(["init", str(root), "--no-git"])
    _configure(root, voice_command=[sys.executable, "-c", "print('remember to water the plants')", "{audio}"])
    fake_microphone([b"\x01\x00" * 1600] * 10)
    monkeypatch.setattr(sys, "stdin", io.StringIO("\n"))
    capsys.readouterr()
    assert main(["--vault", str(root), "record"]) == 0
    assert "remember to water the plants" in capsys.readouterr().out
    [archived] = list((root / "raw").rglob("*.md"))
    assert "source: voice\n" in archived.read_text()
    assert list((root / "raw" / "audio").rglob("*.wav"))


def test_cli_chat_execs_harness_in_library(library, monkeypatch):
    calls = []

    def fake_exec(file, argv, env):
        calls.append((file, argv, os.getcwd(), "CLAUDECODE" in env))
        raise SystemExit(0)

    monkeypatch.setattr(os, "execvpe", fake_exec)
    monkeypatch.setenv("CLAUDECODE", "1")
    with pytest.raises(SystemExit):
        main(["chat"])
    assert calls == [(sys.executable, [sys.executable, "-c", "pass"], os.path.realpath(library), False)]


def test_cli_skills_install_dry_run(env_home, capsys):
    assert main(["skills", "install", "--target", "all", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert str(env_home / ".claude" / "skills" / "avanzel" / "SKILL.md") in out
    assert not (env_home / ".claude").exists()


def test_skill_mentions_only_real_commands():
    mentioned = set(re.findall(r"\bavanzel ([a-z]+)", render_skill()))
    assert {"add", "ask", "search"} <= mentioned
    for command in sorted(mentioned):
        with pytest.raises(SystemExit) as exit_info:
            main([command, "--help"])
        assert exit_info.value.code == 0, command
