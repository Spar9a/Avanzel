import sys
from types import SimpleNamespace

import pytest


@pytest.fixture
def env_home(tmp_path, monkeypatch):
    """Isolate HOME and the user config dir so tests never touch the real ~/Avanzel."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / ".config"))
    monkeypatch.delenv("AVANZEL_VAULT", raising=False)
    return home


class PortAudioError(Exception):
    pass


@pytest.fixture
def fake_microphone(monkeypatch):
    """Install a stand-in `sounddevice` whose stream delivers the given PCM chunks on open."""

    def install(chunks):
        class RawInputStream:
            def __init__(self, samplerate, channels, dtype, callback):
                assert (samplerate, channels, dtype) == (16000, 1, "int16")
                self.callback = callback

            def __enter__(self):
                for chunk in chunks:
                    self.callback(memoryview(chunk), len(chunk) // 2, None, None)
                return self

            def __exit__(self, *exc):
                return False

        monkeypatch.setitem(sys.modules, "sounddevice", SimpleNamespace(RawInputStream=RawInputStream, PortAudioError=PortAudioError))

    return install
