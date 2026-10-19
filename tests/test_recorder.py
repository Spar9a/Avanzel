import sys

import pytest

from avanzel.asr import wav_format
from avanzel.errors import AvanzelError
from avanzel.recorder import record_wav, write_wav

TENTH_OF_A_SECOND = b"\x01\x00" * 1600


def test_write_wav_roundtrip(tmp_path):
    path = tmp_path / "a.wav"
    write_wav(path, b"\x01\x00" * 16000)
    assert wav_format(path) == (1, 2, 16000, 16000)


def test_record_wav_keeps_everything_captured_before_stop(tmp_path, fake_microphone):
    fake_microphone([TENTH_OF_A_SECOND] * 5)
    ticks = []
    seconds = record_wav(tmp_path / "r.wav", max_seconds=10, stop=lambda: len(ticks) >= 1, on_tick=ticks.append)
    assert seconds == 0.5
    assert wav_format(tmp_path / "r.wav") == (1, 2, 16000, 8000)


def test_record_wav_stops_at_max_seconds(tmp_path, fake_microphone):
    fake_microphone([])
    assert record_wav(tmp_path / "r.wav", max_seconds=0.2, stop=lambda: False) == 0.0


def test_record_wav_ctrl_c_stops_and_keeps_audio(tmp_path, fake_microphone):
    fake_microphone([TENTH_OF_A_SECOND] * 2)
    calls = []

    def stop():
        calls.append(1)
        if len(calls) > 1:
            raise KeyboardInterrupt
        return False

    assert record_wav(tmp_path / "r.wav", max_seconds=10, stop=stop) == 0.2
    assert wav_format(tmp_path / "r.wav")[3] == 3200


def test_record_wav_without_sounddevice(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "sounddevice", None)
    with pytest.raises(AvanzelError, match="icrophone"):
        record_wav(tmp_path / "r.wav", max_seconds=1, stop=lambda: True)
