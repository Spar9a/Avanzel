import os

from avanzel.changes import Changes, diff, snapshot


def _write(root, rel, text):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_diff_created_modified_deleted(tmp_path):
    _write(tmp_path, "goals/a.md", "a")
    _write(tmp_path, "ideas/b.md", "b")
    _write(tmp_path, "index.md", "i")
    before = snapshot(tmp_path)
    _write(tmp_path, "goals/a.md", "a changed")
    (tmp_path / "ideas" / "b.md").unlink()
    _write(tmp_path, "people/c.md", "c")
    assert diff(before, snapshot(tmp_path)) == Changes(
        created=["people/c.md"], modified=["goals/a.md"], deleted=["ideas/b.md"]
    )


def test_diff_detects_same_size_edit(tmp_path):
    page = _write(tmp_path, "a.md", "aaaa")
    os.utime(page, ns=(1_000_000_000, 1_000_000_000))
    before = snapshot(tmp_path)
    page.write_text("bbbb")
    os.utime(page, ns=(2_000_000_000, 2_000_000_000))
    assert diff(before, snapshot(tmp_path)).modified == ["a.md"]


def test_snapshot_ignores_hidden_paths(tmp_path):
    for rel in (".git/HEAD", ".avanzel/lock", ".obsidian/workspace.json", ".DS_Store", "goals/.DS_Store"):
        _write(tmp_path, rel, "x")
    _write(tmp_path, "goals/a.md", "a")
    assert list(snapshot(tmp_path)) == ["goals/a.md"]


def test_changes_without_prefixes():
    changes = Changes(
        created=["inbox/x.md", "goals/a.md"], modified=["raw/2026/10/y.md", "index.md"], deleted=["inboxes/z.md"]
    )
    assert changes.without(("inbox/", "raw/")) == Changes(
        created=["goals/a.md"], modified=["index.md"], deleted=["inboxes/z.md"]
    )


def test_changes_pages_lists_written_markdown_in_folders():
    changes = Changes(
        created=["goals/a.md", "index.md", "raw/audio/x.wav"], modified=["people/b.md", "log.md"], deleted=["ideas/c.md"]
    )
    assert changes.pages == ["goals/a.md", "people/b.md"]
    assert not changes.empty
    assert Changes([], [], []).empty
