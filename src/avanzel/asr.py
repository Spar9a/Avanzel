"""Local speech-to-text with small open models — audio never leaves the machine.

Default: NVIDIA Parakeet TDT 0.6B v3 through onnx-asr (the same family FluidVoice uses), with
Silero VAD splitting long recordings into model-sized pieces. Any other local engine (whisper.cpp,
mlx-whisper, …) plugs in through the `command` backend.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from avanzel.config import VoiceSettings
from avanzel.errors import AvanzelError

VAD_THRESHOLD_SECONDS = 25.0
# onnxruntime prefers CoreML on macOS, which runs only part of Parakeet's graph: ~50 s to load and
# slower than real time. Plain CPU with a few threads is several times faster on a busy laptop.
_PROVIDERS = ["CPUExecutionProvider"]
# Sample rates onnx-asr resamples from on its own.
_ONNX_RATES = frozenset({8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000})


@dataclass(frozen=True)
class Transcript:
    text: str
    engine: str
    seconds: float | None = None


class Transcriber(Protocol):
    engine: str

    def transcribe(self, audio: Path) -> Transcript: ...


def make_transcriber(voice: VoiceSettings) -> Transcriber:
    if voice.backend == "onnx-asr":
        return OnnxAsrTranscriber(voice.model, voice.quantization)
    if voice.backend == "command":
        return CommandTranscriber(voice.command)
    raise AvanzelError(f"Unknown voice backend '{voice.backend}'; use \"onnx-asr\" or \"command\".")


class OnnxAsrTranscriber:
    def __init__(self, model: str, quantization: str = "int8") -> None:
        self.model_name = model
        self.quantization = quantization or None
        self.engine = f"onnx-asr:{model}"
        self._model: Any = None

    def transcribe(self, audio: Path) -> Transcript:
        with tempfile.TemporaryDirectory(prefix="avanzel-audio-") as tmp:
            wav = normalize_audio(audio, Path(tmp))
            channels, _, rate, frames = wav_format(wav) or (1, 2, 16000, 0)
            seconds = frames / rate
            options = {"channel": "mean"} if channels > 1 else {}
            model = self._load()
            if seconds > VAD_THRESHOLD_SECONDS:
                import onnx_asr

                vad = onnx_asr.load_vad("silero", providers=_PROVIDERS, sess_options=_session_options())
                segments = model.with_vad(vad).recognize(str(wav), **options)
                text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
            else:
                text = model.recognize(str(wav), **options)
        return Transcript(text.strip(), self.engine, seconds)

    def _load(self) -> Any:
        if self._model is None:
            try:
                import onnx_asr
            except ImportError as exc:
                raise AvanzelError("Local transcription needs the onnx-asr package; reinstall avanzel.") from exc
            try:
                self._model = onnx_asr.load_model(
                    self.model_name,
                    quantization=self.quantization,
                    providers=_PROVIDERS,
                    sess_options=_session_options(),
                )
            except Exception as exc:  # download, cache or model-format problems all surface here
                raise AvanzelError(f"Could not load speech model '{self.model_name}': {exc}") from exc
        return self._model


def _session_options():
    import onnxruntime

    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    options.log_severity_level = 3  # errors only; onnxruntime warnings are noise for end users
    return options


class CommandTranscriber:
    def __init__(self, command: Sequence[str]) -> None:
        if not command:
            raise AvanzelError(
                'voice.backend = "command" needs voice.command, e.g. ["whisper-cli", "-m", "<model>", "-nt", "-f", "{audio}"].'
            )
        self.command = tuple(command)
        self.engine = f"command:{Path(command[0]).name}"

    def transcribe(self, audio: Path) -> Transcript:
        with tempfile.TemporaryDirectory(prefix="avanzel-audio-") as tmp:
            wav = normalize_audio(audio, Path(tmp), strict=True)
            argv = [part.replace("{audio}", str(wav)) for part in self.command]
            try:
                result = subprocess.run(argv, capture_output=True, text=True, stdin=subprocess.DEVNULL)
            except FileNotFoundError as exc:
                raise AvanzelError(f"Speech-to-text command `{argv[0]}` is not on your PATH.") from exc
        if result.returncode != 0:
            raise AvanzelError(f"`{argv[0]}` failed: {(result.stderr or result.stdout).strip()[-400:]}")
        return Transcript(" ".join(result.stdout.split()), self.engine, None)


def wav_format(path: Path) -> tuple[int, int, int, int] | None:
    """(channels, sample width in bytes, sample rate, frames) of a PCM WAV, or None if it is not one."""
    try:
        with wave.open(str(path), "rb") as audio:
            return audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
    except (wave.Error, EOFError, OSError):
        return None


def normalize_audio(src: Path, workdir: Path, *, strict: bool = False) -> Path:
    """Return a WAV the engine can read: `src` itself when possible, else an ffmpeg conversion to
    16 kHz mono PCM16. `strict` accepts only 16 kHz mono PCM16 as-is (what whisper.cpp needs)."""
    fmt = wav_format(src)
    if fmt is not None:
        channels, width, rate, _ = fmt
        if (channels, width, rate) == (1, 2, 16000) or (not strict and rate in _ONNX_RATES):
            return src
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AvanzelError(
            f"Can't read {src.name} directly. Install ffmpeg (macOS: `brew install ffmpeg`) to transcribe this audio."
        )
    out = workdir / f"{src.stem}.16k.wav"
    argv = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src)]
    argv += ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out)]
    result = subprocess.run(argv, capture_output=True, text=True)
    if result.returncode != 0:
        raise AvanzelError(f"ffmpeg could not read {src.name}: {result.stderr.strip()[-400:]}")
    return out
