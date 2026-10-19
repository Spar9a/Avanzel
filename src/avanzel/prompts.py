"""Task prompts handed to the harness. Each is self-contained, so harnesses that do not auto-load
AGENTS.md still know the rules; the first line names the task for logs and test doubles."""

from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath
from string import Template

from avanzel.vault import template

_READONLY = "4. Do not create, edit or delete any files."
_SAVE = (
    "4. Then save the answer as a page, usually `topics/<slug>.md`, in the format AGENTS.md describes;\n"
    "   link it from the pages it draws on, add it to index.md, and append one line to log.md:\n"
    "   - ${now} | ask | ${question_line} → [[page-name]]"
)


def file_prompt(capture_rel: str, capture_id: str, now: datetime) -> str:
    return _render("file", capture_path=capture_rel, capture_id=capture_id, **_times(now))


def ask_prompt(question: str, *, save: bool, now: datetime) -> str:
    one_line = " ".join(question.split())
    if len(one_line) > 80:
        one_line = one_line[:79].rstrip() + "…"
    mode = Template(_SAVE).substitute(question_line=one_line, **_times(now)) if save else _READONLY
    return _render("ask", question=question.strip(), mode=mode, **_times(now))


def review_prompt(report_rel: str, now: datetime) -> str:
    report_id = PurePosixPath(report_rel).stem
    return _render("review", report_path=report_rel, report_id=report_id, **_times(now))


def _times(now: datetime) -> dict[str, str]:
    return {"now": f"{now:%Y-%m-%d %H:%M}", "today": f"{now:%Y-%m-%d}"}


def _render(name: str, **values: str) -> str:
    return Template(template(f"prompts/{name}.md")).substitute(values)
