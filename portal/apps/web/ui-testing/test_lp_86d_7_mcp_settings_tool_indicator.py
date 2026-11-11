#!/usr/bin/env python3
"""lp-86d.7 — Tools MCP inventory + chat MCP tool-use indicator (live QA).

Wraps the standalone runner under artifacts/ui/lp-86d/mcp/run_mcp_qa.py.

Run:
  export BASE_URL=http://demo.localhost:3010
  cd portal/packages/web/ui-testing
  .venv/bin/python ../../../../artifacts/ui/lp-86d/mcp/run_mcp_qa.py
  # or pytest this module (invokes the runner as a subprocess):
  UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/mcp \\
    .venv/bin/pytest -q test_lp_86d_7_mcp_settings_tool_indicator.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[3]
RUNNER = REPO_ROOT / "artifacts" / "ui" / "lp-86d" / "mcp" / "run_mcp_qa.py"
REPORT = REPO_ROOT / "artifacts" / "ui" / "lp-86d" / "mcp" / "REPORT.json"


@pytest.mark.live
def test_lp_86d_7_mcp_settings_and_tool_indicator():
    """Live mocklab QA: Tools→MCP honesty + optional chat MCP tool rows."""
    if os.environ.get("LP_86D_7_SKIP_LIVE") == "1":
        pytest.skip("LP_86D_7_SKIP_LIVE=1")
    assert RUNNER.is_file(), f"missing runner {RUNNER}"
    py = Path(sys.executable)
    env = os.environ.copy()
    env.setdefault("BASE_URL", "http://demo.localhost:3010")
    proc = subprocess.run(
        [str(py), str(RUNNER)],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    # Always surface runner stdout/stderr for bead evidence
    sys.stdout.write(proc.stdout or "")
    sys.stderr.write(proc.stderr or "")
    assert REPORT.is_file(), f"runner did not write {REPORT}"
    report = json.loads(REPORT.read_text())
    verdict = report.get("verdict")
    # PASS or PASS_PARTIAL_GAP (honest empty inventory, fix bead filed) both OK
    assert report.get("acceptance_met") is True, report
    assert verdict in ("PASS", "PASS_PARTIAL_GAP"), report
    checks = report.get("checks") or {}
    assert checks.get("login", {}).get("ok") is True
    assert checks.get("settings-mcp-acceptance", {}).get("ok") is True
    # Runner exit 0 for partial/full pass
    assert proc.returncode == 0, f"runner exit {proc.returncode}"
