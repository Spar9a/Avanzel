import re
from pathlib import Path

import pytest

from avanzel.config import (
    CustomHarness,
    Settings,
    load_settings,
    remember_vault,
    resolve_vault,
    user_config_path,
)
from avanzel.errors import AvanzelError


def test_resolve_vault_precedence(env_home, tmp_path, monkeypatch):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert resolve_vault(cwd=elsewhere) == env_home / "Avanzel"

    remembered = tmp_path / "remembered"
    remember_vault(remembered)
    assert resolve_vault(cwd=elsewhere) == remembered

    marked = tmp_path / "marked"
    (marked / ".avanzel").mkdir(parents=True)
    inside = marked / "goals"
    inside.mkdir()
    assert resolve_vault(cwd=inside) == marked

    from_env = tmp_path / "from-env"
    monkeypatch.setenv("AVANZEL_VAULT", str(from_env))
    assert resolve_vault(cwd=inside) == from_env

    explicit = tmp_path / "explicit"
    assert resolve_vault(explicit, cwd=inside) == explicit


def test_resolve_vault_expands_user(env_home, tmp_path):
    assert resolve_vault(Path("~/notes"), cwd=tmp_path) == env_home / "notes"


def test_remember_vault_roundtrip_with_awkward_path(env_home, tmp_path):
    target = tmp_path / 'My Brain "2" \\ дом'
    remember_vault(target)
    assert user_config_path() == env_home / ".config" / "avanzel" / "config.toml"
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert resolve_vault(cwd=elsewhere) == target


def test_load_settings_defaults_when_missing(tmp_path):
    settings = load_settings(tmp_path)
    assert settings == Settings()
    assert settings.voice.model == "nemo-parakeet-tdt-0.6b-v3"


def test_load_settings_custom_harness_and_models(tmp_path):
    (tmp_path / ".avanzel").mkdir()
    (tmp_path / ".avanzel" / "config.toml").write_text(
        """
harness = "fake"
timeout_seconds = 30
auto_commit = false

[models]
claude = "sonnet"

[voice]
backend = "command"
command = ["whisper-cli", "-f", "{audio}"]

[harnesses.fake]
headless = ["python", "agent.py", "{prompt}"]
interactive = ["python", "agent.py"]
""",
        encoding="utf-8",
    )
    settings = load_settings(tmp_path)
    assert settings.harness == "fake"
    assert settings.timeout_seconds == 30
    assert settings.auto_commit is False
    assert settings.models == {"claude": "sonnet"}
    assert settings.voice.backend == "command"
    assert settings.voice.command == ("whisper-cli", "-f", "{audio}")
    assert settings.voice.model == "nemo-parakeet-tdt-0.6b-v3"
    assert settings.harnesses == {
        "fake": CustomHarness("fake", ("python", "agent.py", "{prompt}"), ("python", "agent.py"))
    }


@pytest.mark.parametrize(
    "body, needle",
    [
        ('timeout_seconds = "soon"', "timeout_seconds"),
        ("timeout_seconds = 0", "timeout_seconds"),
        ("timeout_seconds = true", "timeout_seconds"),
        ('auto_commit = "yes"', "auto_commit"),
        ("[models]\nclaude = 3", "models.claude"),
        ('[harnesses.x]\nheadless = "agent {prompt}"', "harnesses.x.headless"),
        ('[harnesses.x]\nheadless = ["agent"]', "{prompt}"),
        ("[voice]\nmax_record_seconds = -5", "voice.max_record_seconds"),
        ("harness = [", "config.toml"),
    ],
)
def test_load_settings_rejects_bad_values(tmp_path, body, needle):
    (tmp_path / ".avanzel").mkdir()
    (tmp_path / ".avanzel" / "config.toml").write_text(body, encoding="utf-8")
    with pytest.raises(AvanzelError, match=re.escape(needle)):
        load_settings(tmp_path)
