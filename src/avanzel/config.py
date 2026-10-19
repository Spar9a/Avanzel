"""Where the library lives and how it is configured.

Vault resolution order: explicit path → $AVANZEL_VAULT → nearest parent folder holding `.avanzel/`
→ `vault = "..."` in the user config → `~/Avanzel`.
Per-library settings live in `<vault>/.avanzel/config.toml`.
"""

from __future__ import annotations

import json
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from avanzel.errors import AvanzelError

VAULT_MARKER = ".avanzel"
CONFIG_NAME = "config.toml"


@dataclass(frozen=True)
class CustomHarness:
    """An agent CLI the user describes in config; `{prompt}` and `{vault}` are substituted."""

    name: str
    headless: tuple[str, ...]
    interactive: tuple[str, ...] = ()


@dataclass(frozen=True)
class VoiceSettings:
    backend: str = "onnx-asr"
    model: str = "nemo-parakeet-tdt-0.6b-v3"
    quantization: str = "int8"
    command: tuple[str, ...] = ()
    max_record_seconds: int = 600


@dataclass(frozen=True)
class Settings:
    harness: str = "auto"
    timeout_seconds: int = 900
    auto_commit: bool = True
    models: dict[str, str] = field(default_factory=dict)
    harnesses: dict[str, CustomHarness] = field(default_factory=dict)
    voice: VoiceSettings = field(default_factory=VoiceSettings)


def user_config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "avanzel" / CONFIG_NAME


def default_vault() -> Path:
    return Path.home() / "Avanzel"


def resolve_vault(explicit: Path | None = None, *, cwd: Path | None = None) -> Path:
    if explicit is not None:
        return _absolute(explicit)
    from_env = os.environ.get("AVANZEL_VAULT")
    if from_env:
        return _absolute(Path(from_env))
    start = (cwd or Path.cwd()).absolute()
    for folder in (start, *start.parents):
        if (folder / VAULT_MARKER).is_dir():
            return folder
    remembered = _read_toml(user_config_path()).get("vault")
    if isinstance(remembered, str) and remembered:
        return _absolute(Path(remembered))
    return default_vault()


def remember_vault(vault: Path) -> None:
    path = user_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # A JSON string literal is also a valid TOML basic string.
    path.write_text(f"vault = {json.dumps(str(_absolute(vault)), ensure_ascii=False)}\n", encoding="utf-8")


def load_settings(vault: Path) -> Settings:
    path = vault / VAULT_MARKER / CONFIG_NAME
    data = _read_toml(path)
    defaults = Settings()
    voice_data = _table(data, "voice", path)
    voice_defaults = VoiceSettings()
    voice = VoiceSettings(
        backend=_value(voice_data, "backend", str, voice_defaults.backend, path, "voice."),
        model=_value(voice_data, "model", str, voice_defaults.model, path, "voice."),
        quantization=_value(voice_data, "quantization", str, voice_defaults.quantization, path, "voice."),
        command=_string_list(voice_data, "command", path, "voice.") or voice_defaults.command,
        max_record_seconds=_positive_int(
            voice_data, "max_record_seconds", voice_defaults.max_record_seconds, path, "voice."
        ),
    )
    models = {}
    for name, model in _table(data, "models", path).items():
        if not isinstance(model, str):
            raise AvanzelError(f"{path}: `models.{name}` must be a string")
        models[name] = model
    harnesses = {}
    for name, spec in _table(data, "harnesses", path).items():
        if not isinstance(spec, dict):
            raise AvanzelError(f"{path}: `harnesses.{name}` must be a table")
        headless = _string_list(spec, "headless", path, f"harnesses.{name}.")
        if not any("{prompt}" in part for part in headless):
            raise AvanzelError(f"{path}: `harnesses.{name}.headless` must contain a {{prompt}} placeholder")
        interactive = _string_list(spec, "interactive", path, f"harnesses.{name}.")
        harnesses[name] = CustomHarness(name, headless, interactive)
    return Settings(
        harness=_value(data, "harness", str, defaults.harness, path),
        timeout_seconds=_positive_int(data, "timeout_seconds", defaults.timeout_seconds, path),
        auto_commit=_value(data, "auto_commit", bool, defaults.auto_commit, path),
        models=models,
        harnesses=harnesses,
        voice=voice,
    )


def _absolute(path: Path) -> Path:
    return path.expanduser().absolute()


def _read_toml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise AvanzelError(f"{path}: invalid TOML: {exc}") from exc


def _table(data: dict[str, Any], key: str, path: Path) -> dict[str, Any]:
    value = data.get(key, {})
    if not isinstance(value, dict):
        raise AvanzelError(f"{path}: `{key}` must be a table")
    return value


def _value(data: dict[str, Any], key: str, kind: type, default: Any, path: Path, prefix: str = "") -> Any:
    if key not in data:
        return default
    value = data[key]
    if kind is not bool and isinstance(value, bool) or not isinstance(value, kind):
        raise AvanzelError(f"{path}: `{prefix}{key}` must be a {kind.__name__}")
    return value


def _positive_int(data: dict[str, Any], key: str, default: int, path: Path, prefix: str = "") -> int:
    value = _value(data, key, int, default, path, prefix)
    if value <= 0:
        raise AvanzelError(f"{path}: `{prefix}{key}` must be greater than zero")
    return value


def _string_list(data: dict[str, Any], key: str, path: Path, prefix: str = "") -> tuple[str, ...]:
    value = data.get(key, [])
    if not isinstance(value, list) or not all(isinstance(part, str) for part in value):
        raise AvanzelError(f"{path}: `{prefix}{key}` must be a list of strings")
    return tuple(value)
