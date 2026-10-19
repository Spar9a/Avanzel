import os
import sys
from pathlib import Path

import pytest

from avanzel.config import CustomHarness, Settings
from avanzel.errors import AvanzelError
from avanzel.harness import Harness, child_env, harnesses, run_headless, select_harness

VAULT = Path("/v/My Brain")
OUT = Path("/tmp/out.txt")


def test_claude_argv_write_and_readonly():
    claude = harnesses(Settings())["claude"]
    # --tools limits what exists (--allowedTools only pre-approves); --strict-mcp-config keeps the
    # owner's MCP servers out of filing runs.
    assert claude.headless_argv("P", VAULT, write=True, model=None, output_file=OUT) == [
        "claude", "-p", "P", "--output-format", "text",
        "--tools", "Read,Write,Edit,Glob,Grep", "--allowedTools", "Read,Write,Edit,Glob,Grep",
        "--strict-mcp-config", "--permission-mode", "acceptEdits",
    ]
    assert claude.headless_argv("P", VAULT, write=False, model="sonnet", output_file=OUT) == [
        "claude", "-p", "P", "--output-format", "text", "--tools", "Read,Glob,Grep",
        "--allowedTools", "Read,Glob,Grep", "--strict-mcp-config", "--model", "sonnet",
    ]


def test_codex_argv_uses_output_file_and_sandbox():
    codex = harnesses(Settings())["codex"]
    assert codex.reads_output_file
    assert codex.headless_argv("P", VAULT, write=True, model="m", output_file=OUT) == [
        "codex", "exec", "--cd", "/v/My Brain", "--skip-git-repo-check", "--color", "never",
        "--sandbox", "workspace-write", "-o", "/tmp/out.txt", "-m", "m", "P",
    ]
    readonly = codex.headless_argv("P", VAULT, write=False, model=None, output_file=OUT)
    assert readonly[readonly.index("--sandbox") + 1] == "read-only"


def test_opencode_cursor_gemini_argv():
    table = harnesses(Settings())
    assert table["opencode"].headless_argv("P", VAULT, write=True, model=None, output_file=OUT) == [
        "opencode", "run", "--dir", "/v/My Brain", "P",
    ]
    # Cursor only proposes edits in print mode unless --force; read-only asks keep it off.
    assert table["cursor-agent"].headless_argv("P", VAULT, write=True, model="gpt-5", output_file=OUT) == [
        "cursor-agent", "-p", "--force", "--output-format", "text", "--model", "gpt-5", "P",
    ]
    assert table["cursor-agent"].headless_argv("P", VAULT, write=False, model=None, output_file=OUT) == [
        "cursor-agent", "-p", "--output-format", "text", "P",
    ]
    assert table["gemini"].headless_argv("P", VAULT, write=False, model=None, output_file=OUT) == [
        "gemini", "-p", "P", "--approval-mode", "default",
    ]
    assert table["gemini"].experimental


def test_interactive_argv():
    table = harnesses(Settings())
    assert table["claude"].interactive_argv(VAULT, model=None) == ["claude"]
    assert table["codex"].interactive_argv(VAULT, model=None) == ["codex", "--cd", "/v/My Brain"]
    assert table["opencode"].interactive_argv(VAULT, model="a/b") == ["opencode", "/v/My Brain", "-m", "a/b"]


def test_custom_harness_substitution():
    settings = Settings(
        harnesses={"mine": CustomHarness("mine", ("my-agent", "--dir={vault}", "{prompt}"), ("my-agent",))}
    )
    mine = harnesses(settings)["mine"]
    assert mine.binary == "my-agent"
    assert mine.headless_argv("say {vault}", VAULT, write=True, model=None, output_file=OUT) == [
        "my-agent", "--dir=/v/My Brain", "say {vault}",
    ]
    assert mine.interactive_argv(VAULT, model=None) == ["my-agent"]


def _fake_path(tmp_path, monkeypatch, *names):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    for name in names:
        exe = bindir / name
        exe.write_text("#!/bin/sh\nexit 0\n")
        exe.chmod(0o755)
    monkeypatch.setenv("PATH", str(bindir))


def test_select_auto_prefers_order(tmp_path, monkeypatch):
    _fake_path(tmp_path, monkeypatch, "opencode", "codex")
    assert select_harness(Settings()).name == "codex"


def test_select_requested_beats_config(tmp_path, monkeypatch):
    _fake_path(tmp_path, monkeypatch, "opencode", "codex")
    assert select_harness(Settings(harness="codex"), "opencode").name == "opencode"


def test_select_missing_or_unknown_raises(tmp_path, monkeypatch):
    _fake_path(tmp_path, monkeypatch, "codex")
    with pytest.raises(AvanzelError, match="codex"):
        select_harness(Settings(harness="claude"))
    with pytest.raises(AvanzelError, match="nope"):
        select_harness(Settings(), "nope")


def test_select_auto_with_nothing_installed(tmp_path, monkeypatch):
    _fake_path(tmp_path, monkeypatch)
    with pytest.raises(AvanzelError, match="claude"):
        select_harness(Settings())


def test_child_env_strips_claude_session_vars():
    env = {
        "PATH": "/bin", "CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": "s", "CLAUDE_CODE_ENTRYPOINT": "cli",
        "CLAUDE_CONFIG_DIR": "/c", "ANTHROPIC_API_KEY": "k",
    }
    assert child_env(env) == {"PATH": "/bin", "CLAUDE_CONFIG_DIR": "/c", "ANTHROPIC_API_KEY": "k"}


def _script_harness(code):
    spec = CustomHarness("py", (sys.executable, "-c", code, "{prompt}"))
    return harnesses(Settings(harnesses={"py": spec}))["py"]


def test_run_headless_reads_stdout_in_vault(tmp_path):
    harness = _script_harness("import os, sys; print('cwd=' + os.getcwd()); print('prompt=' + sys.argv[1])")
    result = run_headless(harness, "hello", tmp_path, write=True, timeout=30)
    assert result.ok
    assert result.output == f"cwd={os.path.realpath(tmp_path)}\nprompt=hello"


def test_run_headless_isolates_env_and_stdin(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDECODE", "1")
    harness = _script_harness("import os, sys; print(os.environ.get('CLAUDECODE', 'unset'), repr(sys.stdin.read()))")
    assert run_headless(harness, "x", tmp_path, write=False, timeout=30).output == "unset ''"


def test_run_headless_timeout(tmp_path):
    harness = _script_harness("import time; time.sleep(30)")
    result = run_headless(harness, "x", tmp_path, write=False, timeout=1)
    assert result.exit_code == 124
    assert not result.ok
    assert "timed out" in result.stderr


def test_run_headless_failure_keeps_stderr(tmp_path):
    harness = _script_harness("import sys; sys.stderr.write('please log in'); sys.exit(2)")
    result = run_headless(harness, "x", tmp_path, write=False, timeout=30)
    assert result.exit_code == 2
    assert "please log in" in result.stderr


def test_run_headless_strips_ansi(tmp_path):
    harness = _script_harness(r"print('\x1b[1mBold\x1b[0m done\x1b]0;title\x07')")
    assert run_headless(harness, "x", tmp_path, write=False, timeout=30).output == "Bold done"


def test_run_headless_prefers_output_file(tmp_path):
    def build(prompt, vault, write, model, out):
        return [sys.executable, "-c", f"open({str(out)!r}, 'w').write('final answer'); print('progress noise')"]

    harness = Harness("filer", sys.executable, build, lambda vault, model: [], reads_output_file=True)
    assert run_headless(harness, "x", tmp_path, write=False, timeout=30).output == "final answer"


def test_run_headless_missing_binary(tmp_path):
    spec = CustomHarness("ghost", ("definitely-not-installed-avanzel", "{prompt}"))
    harness = harnesses(Settings(harnesses={"ghost": spec}))["ghost"]
    with pytest.raises(AvanzelError, match="definitely-not-installed-avanzel"):
        run_headless(harness, "x", tmp_path, write=False, timeout=30)
