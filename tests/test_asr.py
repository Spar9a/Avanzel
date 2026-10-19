import os
import shutil
import sys
import wave
from types import SimpleNamespace

import pytest

from avanzel.asr import CommandTranscriber, OnnxAsrTranscriber, make_transcriber, normalize_audio, wav_format
from avanzel.config import VoiceSettings
from avanzel.errors import AvanzelError


def _wav(path, seconds, *, rate=16000, channels=1):
    with wave.open(str(path), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x00\x00" * channels * int(rate * seconds))
    return path


class FakeOnnxAsr:
    """Stands in for the onnx_asr package: records how Avanzel drives it."""

    def __init__(self):
        self.loads, self.calls, self.runtime = [], [], []

    def load_model(self, name, quantization=None, providers=None, sess_options=None):
        self.loads.append((name, quantization))
        self.runtime.append((name, providers, sess_options and sess_options.intra_op_num_threads))
        return self

    def load_vad(self, name="silero", providers=None, sess_options=None):
        self.runtime.append((name, providers, sess_options and sess_options.intra_op_num_threads))
        return f"vad:{name}"

    def recognize(self, path, **kwargs):
        self.calls.append(("direct", kwargs))
        return " hello world "

    def with_vad(self, vad, **options):
        fake = self

        class WithVad:
            def recognize(self, path, **kwargs):
                fake.calls.append(("vad", vad, kwargs))
                return iter([SimpleNamespace(start=0, end=10, text="first part"), SimpleNamespace(start=11, end=29, text=" second part ")])

        return WithVad()


@pytest.fixture
def fake_onnx(monkeypatch):
    fake = FakeOnnxAsr()
    monkeypatch.setitem(sys.modules, "onnx_asr", fake)
    return fake


def test_make_transcriber_backends():
    assert isinstance(make_transcriber(VoiceSettings()), OnnxAsrTranscriber)
    command = make_transcriber(VoiceSettings(backend="command", command=("whisper-cli", "-f", "{audio}")))
    assert isinstance(command, CommandTranscriber)
    with pytest.raises(AvanzelError, match="voice.command"):
        make_transcriber(VoiceSettings(backend="command"))
    with pytest.raises(AvanzelError, match="nope"):
        make_transcriber(VoiceSettings(backend="nope"))


def test_onnx_short_audio_direct(fake_onnx, tmp_path):
    transcript = OnnxAsrTranscriber("nemo-parakeet-tdt-0.6b-v3", "int8").transcribe(_wav(tmp_path / "a.wav", 1.0))
    assert transcript.text == "hello world"
    assert transcript.engine == "onnx-asr:nemo-parakeet-tdt-0.6b-v3"
    assert transcript.seconds == 1.0
    assert fake_onnx.loads == [("nemo-parakeet-tdt-0.6b-v3", "int8")]
    assert fake_onnx.calls == [("direct", {})]


def test_onnx_long_audio_uses_vad(fake_onnx, tmp_path):
    transcript = OnnxAsrTranscriber("nemo-parakeet-tdt-0.6b-v3", "").transcribe(_wav(tmp_path / "long.wav", 30.0))
    assert transcript.text == "first part second part"
    assert fake_onnx.loads == [("nemo-parakeet-tdt-0.6b-v3", None)]
    assert fake_onnx.calls == [("vad", "vad:silero", {})]


def test_onnx_runs_on_cpu_with_bounded_threads(fake_onnx, tmp_path):
    # CoreML (onnxruntime's macOS default) supports only half of Parakeet's graph: ~50 s to load,
    # slower than real time. Plain CPU with a few threads transcribes several times faster.
    OnnxAsrTranscriber("nemo-parakeet-tdt-0.6b-v3", "int8").transcribe(_wav(tmp_path / "long.wav", 30.0))
    threads = min(4, os.cpu_count() or 1)
    assert fake_onnx.runtime == [
        ("nemo-parakeet-tdt-0.6b-v3", ["CPUExecutionProvider"], threads),
        ("silero", ["CPUExecutionProvider"], threads),
    ]


def test_onnx_stereo_wav_is_averaged(fake_onnx, tmp_path):
    OnnxAsrTranscriber("whisper-base", "int8").transcribe(_wav(tmp_path / "s.wav", 1.0, rate=44100, channels=2))
    assert fake_onnx.calls == [("direct", {"channel": "mean"})]


def test_onnx_model_loads_once(fake_onnx, tmp_path):
    transcriber = OnnxAsrTranscriber("whisper-base", "int8")
    audio = _wav(tmp_path / "a.wav", 1.0)
    transcriber.transcribe(audio)
    transcriber.transcribe(audio)
    assert len(fake_onnx.loads) == 1


def test_command_transcriber_substitutes_audio(tmp_path):
    audio = _wav(tmp_path / "note.wav", 0.5)
    script = "import sys; print('heard', sys.argv[2]); print('  second line  ')"
    transcriber = CommandTranscriber((sys.executable, "-c", script, "-f", "{audio}"))
    transcript = transcriber.transcribe(audio)
    assert transcript.text == f"heard {audio} second line"
    assert transcript.engine == f"command:{sys.executable.rsplit('/', 1)[-1]}"


def test_command_transcriber_failure(tmp_path):
    transcriber = CommandTranscriber((sys.executable, "-c", "import sys; sys.exit('model missing')", "{audio}"))
    with pytest.raises(AvanzelError, match="model missing"):
        transcriber.transcribe(_wav(tmp_path / "a.wav", 0.5))


def test_normalize_passthrough_16k_mono(tmp_path):
    audio = _wav(tmp_path / "a.wav", 0.5)
    assert normalize_audio(audio, tmp_path) == audio


def test_normalize_requires_ffmpeg(tmp_path, monkeypatch):
    memo = tmp_path / "memo.m4a"
    memo.write_bytes(b"not really audio")
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(AvanzelError, match="ffmpeg"):
        normalize_audio(memo, tmp_path)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_normalize_strict_converts_with_ffmpeg(tmp_path):
    stereo = _wav(tmp_path / "s.wav", 1.0, rate=44100, channels=2)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    converted = normalize_audio(stereo, out_dir, strict=True)
    assert converted.parent == out_dir
    channels, width, rate, frames = wav_format(converted)
    assert (channels, width, rate) == (1, 2, 16000)
    assert abs(frames - 16000) < 400


def test_wav_format_rejects_non_wav(tmp_path):
    junk = tmp_path / "x.wav"
    junk.write_bytes(b"junk")
    assert wav_format(junk) is None
