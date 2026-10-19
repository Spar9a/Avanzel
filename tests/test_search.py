from avanzel.search import search


def _page(root, rel, text):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_search_ranks_title_hits_first(tmp_path):
    _page(tmp_path, "goals/run-a-marathon.md", "---\ntitle: Run a marathon\n---\n# Run a marathon\nTraining plan.\n")
    _page(tmp_path, "memories/city-race.md", "# City race\nWatched the marathon downtown. A marathon is long.\n")
    _page(tmp_path, "ideas/blog.md", "# Blog\nWrite about cooking.\n")
    hits = search(tmp_path, "Marathon")
    assert [hit.path for hit in hits] == ["goals/run-a-marathon.md", "memories/city-race.md"]
    assert hits[0].line == "# Run a marathon"
    assert hits[1].line == "Watched the marathon downtown. A marathon is long."


def test_search_non_latin_query(tmp_path):
    _page(tmp_path, "goals/marafon.md", "# Марафон\nПробежать марафон весной.\n")
    _page(tmp_path, "ideas/other.md", "# Другое\n")
    assert [hit.path for hit in search(tmp_path, "марафон")] == ["goals/marafon.md"]


def test_search_skips_sources_and_root_files(tmp_path):
    _page(tmp_path, "raw/2026/10/x.md", "marathon")
    _page(tmp_path, "inbox/y.md", "marathon")
    _page(tmp_path, "index.md", "marathon")
    _page(tmp_path, ".obsidian/z.md", "marathon")
    assert search(tmp_path, "marathon") == []


def test_search_empty_query_returns_nothing(tmp_path):
    _page(tmp_path, "goals/a.md", "anything")
    assert search(tmp_path, "  ?! ") == []


def test_search_limit(tmp_path):
    for n in range(5):
        _page(tmp_path, f"ideas/idea-{n}.md", "garden " * (n + 1))
    assert [hit.path for hit in search(tmp_path, "garden", limit=2)] == ["ideas/idea-4.md", "ideas/idea-3.md"]
