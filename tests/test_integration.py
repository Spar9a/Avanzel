"""Opt-in tests against real speech models and real agent CLIs.

They download the Parakeet model once (~670 MB) and spend a little of your agent subscription:

    AVANZEL_TEST_ASR=1 uv run pytest tests/test_integration.py -k parakeet
    AVANZEL_TEST_HARNESS=claude uv run pytest tests/test_integration.py -k harness
"""

import os
import shutil
import subprocess

import pytest

from avanzel.asr import OnnxAsrTranscriber
from avanzel.config import load_settings
from avanzel.librarian import Librarian
from avanzel.vault import Vault

pytestmark = pytest.mark.integration

needs_asr = pytest.mark.skipif(not os.environ.get("AVANZEL_TEST_ASR"), reason="set AVANZEL_TEST_ASR=1")
needs_say = pytest.mark.skipif(shutil.which("say") is None, reason="needs macOS `say` to synthesize speech")
HARNESS = os.environ.get("AVANZEL_TEST_HARNESS")


def _say(path, text, voice):
    subprocess.run(["say", "-v", voice, "-o", str(path), "--data-format=LEI16@16000", text], check=True)
    return path


@pytest.fixture(scope="module")
def parakeet():
    return OnnxAsrTranscriber("nemo-parakeet-tdt-0.6b-v3", "int8")


@needs_asr
@needs_say
def test_parakeet_transcribes_english(parakeet, tmp_path):
    audio = _say(tmp_path / "en.wav", "I want to run a marathon next spring.", "Samantha")
    assert "marathon" in parakeet.transcribe(audio).text.lower()


@needs_asr
@needs_say
def test_parakeet_transcribes_russian(parakeet, tmp_path):
    audio = _say(tmp_path / "ru.wav", "Хочу пробежать марафон следующей весной.", "Milena")
    assert "марафон" in parakeet.transcribe(audio).text.lower()


@needs_asr
@needs_say
def test_parakeet_long_recording_goes_through_vad(parakeet, tmp_path):
    sentence = "This is a long voice note about my plans for the garden and the greenhouse. "
    audio = _say(tmp_path / "long.wav", sentence * 8, "Samantha")
    transcript = parakeet.transcribe(audio)
    assert transcript.seconds > 25
    assert transcript.text.lower().count("greenhouse") >= 6


@pytest.mark.skipif(not HARNESS, reason="set AVANZEL_TEST_HARNESS=claude|codex|opencode|cursor-agent")
def test_real_harness_files_capture_and_answers(tmp_path):
    vault = Vault.init(tmp_path / "lib", git=False)
    librarian = Librarian(vault, load_settings(vault.root), harness_name=HARNESS)
    capture = librarian.capture_text(
        "I want to run a marathon next spring, but my left knee hurts after five kilometers. "
        "My friend Anna offered to train with me on weekends."
    )
    [outcome] = librarian.file()
    assert outcome.ok, outcome.error
    assert outcome.archived_to is not None and outcome.archived_to.is_file()
    assert any(page.startswith("goals/") for page in outcome.changes.created), outcome.changes
    assert vault.log_mentions(capture.id)
    assert "[[" in vault.index_path.read_text().split("## Goals", 1)[1]
    answer = librarian.ask("What is my running goal, and what is in the way?")
    assert answer.result.ok, answer.result.stderr
    assert "knee" in answer.result.output.lower()
