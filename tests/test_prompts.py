from datetime import datetime, timedelta, timezone

from avanzel.prompts import ask_prompt, file_prompt, review_prompt

NOW = datetime(2026, 10, 20, 14, 3, 12, tzinfo=timezone(timedelta(hours=4)))


def test_file_prompt_names_capture_and_log_line():
    prompt = file_prompt("inbox/2026-10-20-140312-run.md", "2026-10-20-140312-run", NOW)
    assert prompt.startswith("Avanzel task: file\n")
    assert "`inbox/2026-10-20-140312-run.md`" in prompt
    assert "([[2026-10-20-140312-run]])" in prompt
    assert "- 2026-10-20 14:03 | file | [[2026-10-20-140312-run]] → " in prompt
    assert "updated: 2026-10-20" in prompt
    assert "$" not in prompt


def test_ask_prompt_readonly_vs_save():
    readonly = ask_prompt("What are my goals? $HOME", save=False, now=NOW)
    saving = ask_prompt("What are my goals?\nAnd my ideas?", save=True, now=NOW)
    assert readonly.startswith("Avanzel task: ask\n")
    assert "What are my goals? $HOME" in readonly
    assert "Do not create, edit or delete any files." in readonly
    assert "Do not create, edit or delete any files." not in saving
    assert "- 2026-10-20 14:03 | ask | What are my goals? And my ideas? → [[" in saving


def test_ask_prompt_shortens_long_question_in_log_line():
    question = "why " * 60
    saving = ask_prompt(question, save=True, now=NOW)
    log_line = next(line for line in saving.splitlines() if "| ask |" in line)
    assert len(log_line) < 160
    assert "why why" in log_line


def test_review_prompt_names_report():
    prompt = review_prompt("reviews/2026-10-20.md", NOW)
    assert prompt.startswith("Avanzel task: review\n")
    assert "`reviews/2026-10-20.md`" in prompt
    assert "- 2026-10-20 14:03 | review | [[2026-10-20]]" in prompt
    assert "$" not in prompt
