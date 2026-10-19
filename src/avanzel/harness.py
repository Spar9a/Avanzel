"""Adapters for the agent CLIs the owner already pays for — Avanzel is a harness over harnesses.

Every run happens with cwd = the library, so the harness picks up AGENTS.md / CLAUDE.md, and with
the narrowest permissions each CLI offers: file tools only for Claude Code, the workspace sandbox
for Codex, the library's opencode.json for OpenCode.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

from avanzel.config import CustomHarness, Settings
from avanzel.errors import AvanzelError

BUILTIN_ORDER = ("claude", "codex", "opencode", "cursor-agent", "gemini")

# Variables that tie a process to the Claude Code session that spawned it. Avanzel is often run
# *from* a Claude Code session (via the skill); the nested harness must start a fresh session.
_SESSION_VARS = frozenset(
    {
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ATTENDED",
        "CLAUDE_CODE_MESSAGING_SOCKET",
        "CLAUDE_CODE_MESSAGING_TOKEN",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_PID",
        "CLAUDE_EFFORT",
        "CLAUDE_AGENT_SDK_VERSION",
    }
)
_ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))")
_PLACEHOLDER = re.compile(r"\{(prompt|vault)\}")

# (prompt, vault, write, model, output_file) -> argv
HeadlessBuilder = Callable[[str, Path, bool, "str | None", Path], list[str]]
# (vault, model) -> argv
InteractiveBuilder = Callable[[Path, "str | None"], list[str]]


@dataclass(frozen=True)
class Harness:
    name: str
    binary: str
    build_headless: HeadlessBuilder
    build_interactive: InteractiveBuilder
    reads_output_file: bool = False
    experimental: bool = False

    def available(self) -> bool:
        return shutil.which(self.binary) is not None

    def headless_argv(
        self, prompt: str, vault: Path, *, write: bool, model: str | None = None, output_file: Path
    ) -> list[str]:
        return self.build_headless(prompt, vault, write, model, output_file)

    def interactive_argv(self, vault: Path, *, model: str | None = None) -> list[str]:
        return self.build_interactive(vault, model)


@dataclass(frozen=True)
class RunResult:
    exit_code: int
    output: str
    stderr: str
    seconds: float

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def _opt(flag: str, value: str | None) -> list[str]:
    return [flag, value] if value else []


def _claude(prompt: str, vault: Path, write: bool, model: str | None, out: Path) -> list[str]:
    tools = "Read,Write,Edit,Glob,Grep" if write else "Read,Glob,Grep"
    # --tools limits which tools exist (--allowedTools only pre-approves them); --strict-mcp-config
    # keeps the owner's MCP servers out of the run.
    argv = ["claude", "-p", prompt, "--output-format", "text", "--tools", tools, "--allowedTools", tools]
    argv.append("--strict-mcp-config")
    if write:
        argv += ["--permission-mode", "acceptEdits"]
    return argv + _opt("--model", model)


def _codex(prompt: str, vault: Path, write: bool, model: str | None, out: Path) -> list[str]:
    sandbox = "workspace-write" if write else "read-only"
    return [
        "codex", "exec", "--cd", str(vault), "--skip-git-repo-check", "--color", "never",
        "--sandbox", sandbox, "-o", str(out), *_opt("-m", model), prompt,
    ]


def _opencode(prompt: str, vault: Path, write: bool, model: str | None, out: Path) -> list[str]:
    return ["opencode", "run", "--dir", str(vault), *_opt("-m", model), prompt]


def _cursor(prompt: str, vault: Path, write: bool, model: str | None, out: Path) -> list[str]:
    force = ["--force"] if write else []  # print mode only proposes edits without it
    return ["cursor-agent", "-p", *force, "--output-format", "text", *_opt("--model", model), prompt]


def _gemini(prompt: str, vault: Path, write: bool, model: str | None, out: Path) -> list[str]:
    return ["gemini", "-p", prompt, "--approval-mode", "auto_edit" if write else "default", *_opt("-m", model)]


_BUILTINS = {
    "claude": Harness("claude", "claude", _claude, lambda v, m: ["claude", *_opt("--model", m)]),
    "codex": Harness(
        "codex", "codex", _codex, lambda v, m: ["codex", "--cd", str(v), *_opt("-m", m)], reads_output_file=True
    ),
    "opencode": Harness("opencode", "opencode", _opencode, lambda v, m: ["opencode", str(v), *_opt("-m", m)]),
    "cursor-agent": Harness(
        "cursor-agent", "cursor-agent", _cursor, lambda v, m: ["cursor-agent", *_opt("--model", m)]
    ),
    "gemini": Harness("gemini", "gemini", _gemini, lambda v, m: ["gemini", *_opt("-m", m)], experimental=True),
}


def custom_harness(spec: CustomHarness) -> Harness:
    def fill(template: tuple[str, ...], prompt: str, vault: Path) -> list[str]:
        values = {"prompt": prompt, "vault": str(vault)}
        return [_PLACEHOLDER.sub(lambda m: values[m.group(1)], part) for part in template]

    return Harness(
        spec.name,
        spec.headless[0],
        lambda prompt, vault, write, model, out: fill(spec.headless, prompt, vault),
        lambda vault, model: fill(spec.interactive, "", vault),
    )


def harnesses(settings: Settings) -> dict[str, Harness]:
    table = dict(_BUILTINS)
    for name, spec in settings.harnesses.items():
        table[name] = custom_harness(spec)
    return table


def installed(settings: Settings) -> list[str]:
    return [name for name, harness in harnesses(settings).items() if harness.available()]


def select_harness(settings: Settings, requested: str | None = None) -> Harness:
    table = harnesses(settings)
    choice = requested or settings.harness
    if choice == "auto":
        for name in BUILTIN_ORDER:
            if table[name].available():
                return table[name]
        raise AvanzelError(
            "No agent CLI found. Install one of: Claude Code (claude), Codex (codex), OpenCode (opencode), "
            "Cursor Agent (cursor-agent), Gemini CLI (gemini) — or add [harnesses.<name>] to .avanzel/config.toml."
        )
    harness = table.get(choice)
    if harness is None:
        raise AvanzelError(f"Unknown harness '{choice}'. Known harnesses: {', '.join(table)}.")
    if not harness.available():
        others = ", ".join(installed(settings)) or "none"
        raise AvanzelError(
            f"Harness '{choice}' needs `{harness.binary}` on your PATH. Installed harnesses: {others}."
        )
    return harness


def child_env(env: Mapping[str, str]) -> dict[str, str]:
    return {key: value for key, value in env.items() if key not in _SESSION_VARS}


def run_headless(
    harness: Harness,
    prompt: str,
    vault: Path,
    *,
    write: bool,
    model: str | None = None,
    timeout: float = 900,
    verbose: bool = False,
) -> RunResult:
    """Run one non-interactive agent turn inside the library and return its final message."""
    with tempfile.TemporaryDirectory(prefix="avanzel-") as tmp:
        output_file = Path(tmp) / "last-message.txt"
        argv = harness.headless_argv(prompt, vault, write=write, model=model, output_file=output_file)
        started = time.monotonic()
        try:
            process = subprocess.Popen(
                argv,
                cwd=vault,
                env=child_env(os.environ),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=None if verbose else subprocess.PIPE,
                text=True,
                errors="replace",
            )
        except FileNotFoundError as exc:
            raise AvanzelError(f"Could not start `{argv[0]}`: it is not on your PATH.") from exc
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            stdout, stderr = _stop(process)
            note = f"{harness.name} timed out after {timeout:g}s"
            return RunResult(124, _clean(stdout), f"{stderr or ''}\n{note}".strip(), time.monotonic() - started)
        except BaseException:
            _stop(process)
            raise
        output = stdout
        if harness.reads_output_file and output_file.is_file():
            output = output_file.read_text(encoding="utf-8", errors="replace")
        return RunResult(process.returncode, _clean(output), stderr or "", time.monotonic() - started)


def exec_interactive(harness: Harness, vault: Path, *, model: str | None = None) -> NoReturn:
    """Replace this process with the harness's own interactive UI, opened inside the library."""
    argv = harness.interactive_argv(vault, model=model)
    if not argv:
        raise AvanzelError(f"Harness '{harness.name}' has no interactive command; set `interactive` in config.")
    os.chdir(vault)
    os.execvpe(argv[0], argv, child_env(os.environ))


def _stop(process: subprocess.Popen[str]) -> tuple[str, str]:
    process.terminate()
    try:
        return process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        return process.communicate()


def _clean(text: str | None) -> str:
    return _ANSI.sub("", text or "").strip()
