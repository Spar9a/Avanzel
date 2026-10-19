"""Record the microphone to a 16 kHz mono WAV — the format the speech models want."""

from __future__ import annotations

import queue
import time
import wave
from collections.abc import Callable
from pathlib import Path

from avanzel.errors import AvanzelError

SAMPLE_RATE = 16000


def write_wav(path: Path, pcm: bytes, samplerate: int = SAMPLE_RATE) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(samplerate)
        out.writeframes(pcm)


def record_wav(
    path: Path,
    *,
    max_seconds: float,
    stop: Callable[[], bool],
    samplerate: int = SAMPLE_RATE,
    on_tick: Callable[[float], None] | None = None,
) -> float:
    """Record until `stop()` turns true or `max_seconds` pass; returns the recorded duration."""
    try:
        import sounddevice
    except (ImportError, OSError) as exc:
        raise AvanzelError(
            f"Microphone recording is unavailable ({exc}). On Linux install PortAudio (e.g. `apt install libportaudio2`)."
        ) from exc
    chunks: queue.Queue[bytes] = queue.Queue()
    pcm = bytearray()
    started = time.monotonic()

    def collect(data, frames, time_info, status) -> None:  # runs on the audio thread
        chunks.put(bytes(data))

    try:
        with sounddevice.RawInputStream(samplerate=samplerate, channels=1, dtype="int16", callback=collect):
            try:
                while not stop() and time.monotonic() - started < max_seconds:
                    try:
                        pcm.extend(chunks.get(timeout=0.1))
                    except queue.Empty:
                        pass
                    if on_tick is not None:
                        on_tick(len(pcm) / 2 / samplerate)
            except KeyboardInterrupt:
                pass  # Ctrl-C means "stop recording", not "throw the note away"
    except sounddevice.PortAudioError as exc:
        raise AvanzelError(f"Could not open the microphone: {exc}") from exc
    while not chunks.empty():
        pcm.extend(chunks.get_nowait())
    write_wav(path, bytes(pcm), samplerate)
    return len(pcm) / 2 / samplerate
