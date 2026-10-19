import fcntl
import json
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from avanzel.config import Settings, load_settings
from avanzel.errors import AvanzelError
from avanzel.vault import SHELVES, Vault, slugify

NOW = datetime(2026, 10, 20, 14, 3, 12, tzinfo=timezone(timedelta(hours=4)))


@pytest.fixture
def vault(tmp_path):
    return Vault.init(tmp_path / "lib", git=False)


def test_init_creates_layout(vault):
    root = vault.root
    for name in ("AGENTS.md", "index.md", "log.md", "opencode.json", ".gitignore", ".avanzel/config.toml"):
        assert (root / name).is_file(), name
    assert (root / "CLAUDE.md").read_text() == "@AGENTS.md\n"
    for folder in ("inbox", "raw", "reviews", *SHELVES):
        assert (root / folder).is_dir(), folder
    assert vault.exists()
    assert load_settings(root) == Settings()
    assert json.loads((root / "opencode.json").read_text())["permission"]["bash"] == "deny"


def test_init_is_idempotent_and_preserves_edits(vault):
    (vault.root / "AGENTS.md").write_text("my rules")
    (vault.root / "goals" / "x.md").write_text("x")
    again = Vault.init(vault.root, git=False)
    assert (again.root / "AGENTS.md").read_text() == "my rules"
    assert (again.root / "goals" / "x.md").read_text() == "x"


def test_require_without_library_raises(tmp_path):
    with pytest.raises(AvanzelError, match="avanzel init"):
        Vault(tmp_path / "nothing").require()


def test_new_capture_text(vault):
    capture = vault.new_capture("  I want to run a marathon next spring  ", source="text", now=NOW)
    assert capture.id == "2026-10-20-140312-i-want-to-run-a"
    assert capture.source == "text"
    assert capture.path == vault.root / "inbox" / f"{capture.id}.md"
    assert capture.path.read_text(encoding="utf-8") == (
        "---\n"
        f"id: {capture.id}\n"
        "type: capture\n"
        "source: text\n"
        "created: 2026-10-20T14:03:12+04:00\n"
        "---\n"
        "\n"
        "I want to run a marathon next spring\n"
    )


def test_capture_non_latin_text(vault):
    text = "Хочу пробежать марафон весной"
    capture = vault.new_capture(text, source="voice", now=NOW)
    assert capture.id == "2026-10-20-140312"
    assert text in capture.path.read_text(encoding="utf-8")


_RACER = """
import sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from avanzel.vault import Vault
root, text, start_at = sys.argv[1], sys.argv[2] + " " + "ж" * 200_000, float(sys.argv[3])
now = datetime(2026, 10, 20, 14, 3, 12, tzinfo=timezone(timedelta(hours=4)))
while time.time() < start_at:  # spin, not sleep: macOS coalesces timer wake-ups by milliseconds
    pass
Vault(Path(root)).new_capture(text, source="text", now=now)
"""


def test_concurrent_captures_in_the_same_second_are_all_kept(vault):
    # Two `avanzel add`s in the same second (e.g. an agent capturing two notes in parallel) compete
    # for one id; non-Latin notes always do, because their ids are timestamp-only. Large notes widen
    # the window between choosing an id and the file appearing, so the race shows up reliably.
    words = ["первая", "вторая", "третья", "четвёртая", "пятая", "шестая", "седьмая", "восьмая"]
    texts = [f"Мысль {word}" for word in words]  # no Latin letters or digits: every id is timestamp-only
    start_at = time.time() + 1.5
    racers = [
        subprocess.Popen([sys.executable, "-c", _RACER, str(vault.root), text, str(start_at)], stderr=subprocess.PIPE)
        for text in texts
    ]
    failures = [racer.stderr.read().decode() for racer in racers if racer.wait() != 0]
    assert failures == []
    bodies = [path.read_text(encoding="utf-8").split("---\n\n", 1)[1] for path in vault.pending()]
    assert sorted(bodies) == sorted(f"{text} {'ж' * 200_000}\n" for text in texts)


def test_concurrent_audio_paths_are_distinct(vault):
    paths = []
    barrier = threading.Barrier(8)

    def claim():
        barrier.wait()
        paths.append(vault.new_audio_path(NOW))

    threads = [threading.Thread(target=claim) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(set(paths)) == 8


def test_capture_rejects_empty_text(vault):
    with pytest.raises(AvanzelError):
        vault.new_capture("   \n ", source="text", now=NOW)


def test_capture_id_collision_suffix(vault):
    first = vault.new_capture("same words", source="text", now=NOW)
    vault.archive(first.path)
    second = vault.new_capture("same words", source="text", now=NOW)
    third = vault.new_capture("same words", source="text", now=NOW)
    assert [first.id, second.id, third.id] == [
        "2026-10-20-140312-same-words",
        "2026-10-20-140312-same-words-2",
        "2026-10-20-140312-same-words-3",
    ]


def test_voice_capture_embeds_audio(vault):
    audio = vault.new_audio_path(NOW)
    assert audio == vault.root / "raw" / "audio" / "2026" / "10" / "2026-10-20-140312.wav"
    audio.write_bytes(b"RIFF")
    capture = vault.new_capture(
        "hello", source="voice", audio=audio, transcriber="onnx-asr:nemo-parakeet-tdt-0.6b-v3", now=NOW
    )
    text = capture.path.read_text()
    assert "audio: raw/audio/2026/10/2026-10-20-140312.wav\n" in text
    assert "transcriber: onnx-asr:nemo-parakeet-tdt-0.6b-v3\n" in text
    assert text.endswith("hello\n\n![[2026-10-20-140312.wav]]\n")


def test_new_audio_path_is_unique(vault):
    vault.new_audio_path(NOW).write_bytes(b"x")
    assert vault.new_audio_path(NOW).name == "2026-10-20-140312-2.wav"
    assert vault.new_audio_path(NOW, suffix=".m4a").name == "2026-10-20-140312.m4a"


def test_pending_lists_text_and_audio_sorted(vault):
    for name in ("b.txt", "a.md", "memo.m4a", ".hidden.md", "notes.pdf", ".x.md.tmp"):
        (vault.root / "inbox" / name).write_text("x")
    assert [p.name for p in vault.pending()] == ["a.md", "b.txt", "memo.m4a"]


def test_archive_moves_to_year_month(vault):
    capture = vault.new_capture("hello", source="text", now=NOW)
    dest = vault.archive(capture.path)
    assert dest == vault.root / "raw" / "2026" / "10" / f"{capture.id}.md"
    assert dest.is_file()
    assert not capture.path.exists()


def test_archive_undated_file_uses_now(vault):
    note = vault.root / "inbox" / "groceries.txt"
    note.write_text("milk")
    assert vault.archive(note, now=NOW) == vault.root / "raw" / "2026" / "10" / "groceries.txt"


def test_log_append_and_mentions(vault):
    assert not vault.log_mentions("2026-10-20-140312")
    vault.append_log("file", "[[2026-10-20-140312]] → [[run-a-marathon]]", now=NOW)
    assert vault.log_path.read_text().endswith(
        "\n- 2026-10-20 14:03 | file | [[2026-10-20-140312]] → [[run-a-marathon]]\n"
    )
    assert vault.log_mentions("2026-10-20-140312")
    assert not vault.log_mentions("2026-10-20-1403")


def test_append_log_handles_missing_trailing_newline(vault):
    vault.log_path.write_text("# Log\n- old line")
    vault.append_log("review", "[[2026-10-20]]", now=NOW)
    assert vault.log_path.read_text() == "# Log\n- old line\n- 2026-10-20 14:03 | review | [[2026-10-20]]\n"


def test_shelf_counts(vault):
    (vault.root / "goals" / "a.md").write_text("a")
    (vault.root / "goals" / "sub").mkdir()
    (vault.root / "goals" / "sub" / "b.md").write_text("b")
    (vault.root / "recipes").mkdir()
    (vault.root / "recipes" / "soup.md").write_text("s")
    (vault.root / "inbox" / "x.md").write_text("x")
    counts = vault.shelf_counts()
    assert counts["goals"] == 2
    assert counts["ideas"] == 0
    assert counts["recipes"] == 1
    assert {"inbox", "raw", "reviews"}.isdisjoint(counts)
    assert list(counts)[: len(SHELVES)] == list(SHELVES)


def test_lock_waits_for_other_holder(vault):
    vault.meta_dir.mkdir(exist_ok=True)
    holder = open(vault.lock_path, "a+")
    fcntl.flock(holder, fcntl.LOCK_EX)
    events = []

    def worker():
        with vault.lock(on_wait=lambda: events.append("waiting")):
            events.append("acquired")

    thread = threading.Thread(target=worker)
    thread.start()
    time.sleep(0.3)
    assert events == ["waiting"]
    fcntl.flock(holder, fcntl.LOCK_UN)
    holder.close()
    thread.join(timeout=5)
    assert events == ["waiting", "acquired"]


def test_slugify():
    assert slugify("Café: déjà vu, again & again!") == "cafe-deja-vu-again-again"
    assert slugify("Привет мир") == ""
