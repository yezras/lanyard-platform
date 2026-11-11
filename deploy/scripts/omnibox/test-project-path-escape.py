#!/usr/bin/env python3
"""Automated negative tests for project path escape (lp-uxy.6).

Mirrors the lexical project/vault confinement rules used by Lanyard Agent
agent-core (isPathWithinRoot + resolve under cwd). Pure stdlib — no network,
no secrets, no product imports.

Acceptance: at least one automated negative test for project path escape on
the claimed sandbox contract. When a live LA checkout is available, also run
packages/agent-core/test/tools-sandbox.test.ts via prove-sandbox-path-acl.sh.

Usage:
  python3 deploy/scripts/omnibox/test-project-path-escape.py
  python3 deploy/scripts/omnibox/test-project-path-escape.py --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Optional, Tuple


def is_path_within_root(absolute_path: str, root: str) -> bool:
    """Trailing-separator prefix check (same idea as LA isPathWithinVault)."""
    root_r = os.path.realpath(os.path.abspath(root))
    path_r = os.path.abspath(absolute_path)
    # Compare using abspath first for nonexistent targets (realpath may equal).
    root_a = os.path.abspath(root)
    path_a = os.path.abspath(absolute_path)
    if path_a == root_a or path_r == root_r:
        return True
    prefix = root_a if root_a.endswith(os.sep) else root_a + os.sep
    if path_a.startswith(prefix):
        return True
    # Realpath prefix for existing symlink-resolved roots
    prefix_r = root_r if root_r.endswith(os.sep) else root_r + os.sep
    return path_r.startswith(prefix_r)


def resolve_tool_path(file_path: str, cwd: str) -> str:
    expanded = os.path.expanduser(file_path)
    if os.path.isabs(expanded):
        return os.path.abspath(expanded)
    return os.path.abspath(os.path.join(cwd, expanded))


def resolve_within_sandbox(
    file_path: str,
    *,
    vault_root: Optional[str],
    project_root: Optional[str],
    cwd: str,
) -> str:
    """Raise ValueError with VAULT_PATH_ESCAPE or PROJECT_PATH_ESCAPE code."""
    resolved = resolve_tool_path(file_path, cwd)
    if vault_root is not None and not is_path_within_root(resolved, vault_root):
        raise ValueError(
            f"VAULT_PATH_ESCAPE: {file_path!r} -> {resolved!r} outside {vault_root!r}"
        )
    if project_root is not None and not is_path_within_root(resolved, project_root):
        raise ValueError(
            f"PROJECT_PATH_ESCAPE: {file_path!r} -> {resolved!r} outside {project_root!r}"
        )
    return resolved


def expect_deny(
    name: str,
    file_path: str,
    *,
    vault_root: Optional[str],
    project_root: Optional[str],
    cwd: str,
    code: str,
    failures: List[str],
) -> None:
    try:
        resolve_within_sandbox(
            file_path,
            vault_root=vault_root,
            project_root=project_root,
            cwd=cwd,
        )
        failures.append(f"{name}: expected deny ({code}), but path was allowed")
        print(f"FAIL: {name} (allowed)")
    except ValueError as exc:
        if code not in str(exc):
            failures.append(f"{name}: expected {code}, got {exc}")
            print(f"FAIL: {name} ({exc})")
        else:
            print(f"PASS: {name} ({code})")


def expect_allow(
    name: str,
    file_path: str,
    *,
    vault_root: Optional[str],
    project_root: Optional[str],
    cwd: str,
    failures: List[str],
) -> None:
    try:
        out = resolve_within_sandbox(
            file_path,
            vault_root=vault_root,
            project_root=project_root,
            cwd=cwd,
        )
        print(f"PASS: {name} -> {out}")
    except ValueError as exc:
        failures.append(f"{name}: unexpected deny: {exc}")
        print(f"FAIL: {name} ({exc})")


def run_suite(tmp: Path) -> Tuple[List[str], dict]:
    vault = tmp / "vault"
    project = vault / "proj"
    outside = tmp / "outside"
    vault.mkdir(parents=True)
    project.mkdir(parents=True)
    outside.mkdir(parents=True)
    (project / "in.txt").write_text("in\n", encoding="utf-8")
    (vault / "sib.txt").write_text("sib\n", encoding="utf-8")
    (outside / "secret.txt").write_text("SECRET\n", encoding="utf-8")
    # Prefix trap: vault-evil sibling
    vault_evil = tmp / "vault-evil"
    vault_evil.mkdir()
    (vault_evil / "x").write_text("x\n", encoding="utf-8")

    vault_s = str(vault)
    project_s = str(project)
    outside_s = str(outside)
    failures: List[str] = []

    # --- Negative: project escape (sibling under vault) ---
    expect_deny(
        "project .. sibling",
        "../sib.txt",
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        code="PROJECT_PATH_ESCAPE",
        failures=failures,
    )
    expect_deny(
        "project absolute vault sibling",
        str(vault / "sib.txt"),
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        code="PROJECT_PATH_ESCAPE",
        failures=failures,
    )

    # --- Negative: vault escape ---
    expect_deny(
        "vault absolute outside",
        str(outside / "secret.txt"),
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        code="VAULT_PATH_ESCAPE",
        failures=failures,
    )
    expect_deny(
        "vault .. beyond root",
        "../../outside/secret.txt",
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        code="VAULT_PATH_ESCAPE",
        failures=failures,
    )
    expect_deny(
        "vault prefix trap vault-evil",
        str(vault_evil / "x"),
        vault_root=vault_s,
        project_root=None,
        cwd=vault_s,
        code="VAULT_PATH_ESCAPE",
        failures=failures,
    )
    expect_deny(
        "etc passwd absolute",
        "/etc/passwd",
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        code="VAULT_PATH_ESCAPE",
        failures=failures,
    )

    # --- Positive controls ---
    expect_allow(
        "in-tree relative",
        "in.txt",
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        failures=failures,
    )
    expect_allow(
        "project root .",
        ".",
        vault_root=vault_s,
        project_root=project_s,
        cwd=project_s,
        failures=failures,
    )
    # Vault-only (no project) still allows vault sibling
    expect_allow(
        "vault-only sibling",
        "sib.txt",
        vault_root=vault_s,
        project_root=None,
        cwd=vault_s,
        failures=failures,
    )

    # Document residual honesty: shell path ACL is NOT claimed by this suite.
    residual = {
        "shell_argv_path_acl": False,
        "note": (
            "File-tool lexical confinement only. LA bash can still cat absolute "
            "paths outside project/vault (live residual documented in "
            "docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md)."
        ),
    }

    summary = {
        "bead_id": "lp-uxy.6",
        "suite": "test-project-path-escape",
        "pass": len(failures) == 0,
        "failure_count": len(failures),
        "failures": failures,
        "residual": residual,
        "negative_cases": [
            "project .. sibling",
            "project absolute vault sibling",
            "vault absolute outside",
            "vault .. beyond root",
            "vault prefix trap vault-evil",
            "etc passwd absolute",
        ],
    }
    return failures, summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable summary on stdout",
    )
    args = parser.parse_args(argv)

    import tempfile

    with tempfile.TemporaryDirectory(prefix="lp-uxy6-path-acl-") as tmp:
        failures, summary = run_suite(Path(tmp))

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        if failures:
            print(f"\n{len(failures)} failure(s)", file=sys.stderr)
        else:
            print("\nAll project path-escape negative checks passed.")
            print(
                "Residual (documented): shell argv is not path-ACL confined "
                "by this suite."
            )

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
