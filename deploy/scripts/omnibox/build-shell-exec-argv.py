#!/usr/bin/env python3
"""Deploy-owned Hermes shell/host-tool argv builder for Omnibox Mode A.

When OMNIBOX_ENABLED is truthy and the tool is host-impacting, emit argv that
prefixes run-under-omnibox with --profile and optional --path-prefix flags from
session context (Portal/relay inject). Does not execute the command.

Contract: references/omnibox-mode-a-hermes-hook.md
Bead: cbd-o9s.11

Usage:
  python3 build-shell-exec-argv.py <<'JSON'
  {
    "omnibox_enabled": true,
    "wrapper": "/usr/local/sbin/run-under-omnibox",
    "tool": "shell_exec",
    "session": {"profile": "contributor", "path_prefixes": ["/Projects/Legal"]},
    "command": ["cat", "note.md"]
  }
  JSON

  # Or env + args:
  OMNIBOX_ENABLED=1 OMNIBOX_WRAPPER=/usr/local/sbin/run-under-omnibox \\
    python3 build-shell-exec-argv.py --tool shell_exec \\
      --profile contributor --path-prefix /Projects/Legal -- cat note.md

  python3 build-shell-exec-argv.py --self-test
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REGISTRY = SCRIPT_DIR / "host-impacting-tools.json"
DEFAULT_WRAPPER = "/usr/local/sbin/run-under-omnibox"
KNOWN_PROFILES = frozenset({"admin", "contributor"})


def _truthy(val: Any) -> bool:
    if val is True:
        return True
    if val is False or val is None:
        return False
    s = str(val).strip().lower()
    return s in {"1", "true", "yes", "on"}


def load_registry(path: Optional[str] = None) -> Dict[str, Any]:
    p = Path(path) if path else Path(
        os.environ.get("OMNIBOX_HOST_IMPACTING_REGISTRY", str(DEFAULT_REGISTRY))
    )
    if not p.is_file():
        # Fail-closed defaults if registry missing (offline-friendly).
        return {
            "host_impacting_tools": [
                "shell_exec",
                "terminal",
                "system_ops",
                "gateway_config",
                "profile_manage",
                "beads_admin",
            ],
            "vault_only_tools": [
                "vault_read",
                "vault_write",
                "vault_search",
                "vault_delete",
                "chat",
            ],
        }
    with p.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("host-impacting registry root must be an object")
    return data


def is_host_impacting(tool: str, registry: Dict[str, Any]) -> bool:
    name = (tool or "").strip()
    if not name:
        return False
    host = {str(t) for t in (registry.get("host_impacting_tools") or [])}
    vault = {str(t) for t in (registry.get("vault_only_tools") or [])}
    if name in vault and name not in host:
        return False
    if name in host:
        return True
    # Unknown tools: do not wrap (vault-like default); product may still deny.
    return False


def resolve_profile(raw: Any) -> Tuple[Optional[str], Optional[str]]:
    """Return (profile, error).

    Missing/empty → contributor (fail-closed least privilege).
    Unknown non-empty → error (deny host-impacting).
    """
    if raw is None:
        return "contributor", None
    s = str(raw).strip()
    if not s:
        return "contributor", None
    if s in KNOWN_PROFILES:
        return s, None
    return None, f"unknown profile: {s!r} (expected admin|contributor)"


def normalize_path_prefixes(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        raise ValueError("path_prefixes must be a list of strings")
    out: List[str] = []
    for p in raw:
        s = str(p).strip()
        if not s:
            raise ValueError("path_prefixes entries must be non-empty")
        out.append(s)
    return out


def build_argv(
    *,
    omnibox_enabled: Any,
    wrapper: Optional[str],
    tool: str,
    profile: Any,
    path_prefixes: Any = None,
    command: Sequence[str],
    registry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build exec argv for a tool invocation.

    Returns a JSON-serializable result dict:
      wrap: bool
      argv: list[str]
      profile: str | null
      tool: str
      reason: str
      error: str | null  (non-null means fail-closed deny)
    """
    reg = registry if registry is not None else load_registry()
    cmd = [str(c) for c in command]
    if not cmd:
        return {
            "wrap": False,
            "argv": [],
            "profile": None,
            "tool": tool,
            "reason": "empty_command",
            "error": "command required",
        }

    enabled = _truthy(omnibox_enabled)
    impacting = is_host_impacting(tool, reg)

    if not enabled:
        return {
            "wrap": False,
            "argv": cmd,
            "profile": None,
            "tool": tool,
            "reason": "omnibox_disabled",
            "error": None,
        }

    if not impacting:
        return {
            "wrap": False,
            "argv": cmd,
            "profile": None,
            "tool": tool,
            "reason": "vault_or_non_host_tool",
            "error": None,
        }

    resolved, perr = resolve_profile(profile)
    if perr:
        return {
            "wrap": False,
            "argv": [],
            "profile": None,
            "tool": tool,
            "reason": "unknown_profile",
            "error": perr,
        }

    # Explicit empty wrapper is fail-closed; None falls back to env then default.
    if wrapper is None:
        wrap_path = (os.environ.get("OMNIBOX_WRAPPER") or DEFAULT_WRAPPER).strip()
    else:
        wrap_path = str(wrapper).strip()
    if not wrap_path:
        return {
            "wrap": False,
            "argv": [],
            "profile": resolved,
            "tool": tool,
            "reason": "missing_wrapper",
            "error": "OMNIBOX_WRAPPER empty while OMNIBOX_ENABLED=1 for host-impacting tool",
        }

    try:
        prefixes = normalize_path_prefixes(path_prefixes)
    except ValueError as e:
        return {
            "wrap": False,
            "argv": [],
            "profile": resolved,
            "tool": tool,
            "reason": "bad_path_prefixes",
            "error": str(e),
        }

    argv: List[str] = [wrap_path, "--profile", resolved]  # type: ignore[list-item]
    for pref in prefixes:
        argv.extend(["--path-prefix", pref])
    argv.append("--")
    argv.extend(cmd)

    reason = "wrapped"
    if profile is None or str(profile).strip() == "":
        reason = "wrapped_fail_closed_contributor"

    return {
        "wrap": True,
        "argv": argv,
        "profile": resolved,
        "tool": tool,
        "reason": reason,
        "error": None,
    }


def _self_test() -> int:
    reg = load_registry(str(DEFAULT_REGISTRY))
    failures = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failures
        if cond:
            print(f"PASS: {name}")
        else:
            failures += 1
            print(f"FAIL: {name} {detail}", file=sys.stderr)

    # Contributor session → --profile contributor
    r = build_argv(
        omnibox_enabled=1,
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="shell_exec",
        profile="contributor",
        path_prefixes=["/Projects/Legal"],
        command=["/bin/echo", "hi"],
        registry=reg,
    )
    check("wrap true for shell_exec", r["wrap"] is True and r["error"] is None)
    argv = r["argv"]
    check(
        "argv includes --profile contributor",
        "--profile" in argv and argv[argv.index("--profile") + 1] == "contributor",
        str(argv),
    )
    check(
        "argv includes path-prefix",
        "--path-prefix" in argv and "/Projects/Legal" in argv,
        str(argv),
    )
    check("argv ends with command after --", argv[-2:] == ["/bin/echo", "hi"] and "--" in argv)

    # Admin session
    r_admin = build_argv(
        omnibox_enabled=True,
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="shell_exec",
        profile="admin",
        command=["true"],
        registry=reg,
    )
    check(
        "admin → --profile admin",
        r_admin["wrap"]
        and r_admin["argv"][r_admin["argv"].index("--profile") + 1] == "admin",
    )

    # Disabled: passthrough
    r_off = build_argv(
        omnibox_enabled=0,
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="shell_exec",
        profile="admin",
        command=["cat", "x"],
        registry=reg,
    )
    check("disabled passthrough", r_off["wrap"] is False and r_off["argv"] == ["cat", "x"])

    # Vault-only: no wrap when enabled
    r_vault = build_argv(
        omnibox_enabled=1,
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="vault_read",
        profile="admin",
        command=["unused"],
        registry=reg,
    )
    check(
        "vault_read not wrapped",
        r_vault["wrap"] is False and r_vault["reason"] == "vault_or_non_host_tool",
    )

    # Missing profile → contributor fail-closed
    r_miss = build_argv(
        omnibox_enabled="yes",
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="shell_exec",
        profile=None,
        command=["id"],
        registry=reg,
    )
    check(
        "missing profile → contributor",
        r_miss["wrap"]
        and r_miss["profile"] == "contributor"
        and r_miss["argv"][r_miss["argv"].index("--profile") + 1] == "contributor",
        str(r_miss),
    )
    check(
        "missing profile reason",
        r_miss["reason"] == "wrapped_fail_closed_contributor",
    )

    # Unknown profile → deny
    r_bad = build_argv(
        omnibox_enabled=1,
        wrapper="/usr/local/sbin/run-under-omnibox",
        tool="shell_exec",
        profile="superuser",
        command=["id"],
        registry=reg,
    )
    check(
        "unknown profile denied",
        r_bad["error"] is not None and r_bad["argv"] == [] and not r_bad["wrap"],
    )

    # Empty wrapper when enabled host-impacting → deny bare command
    r_nowrap = build_argv(
        omnibox_enabled=1,
        wrapper="",
        tool="shell_exec",
        profile="admin",
        command=["id"],
        registry=reg,
    )
    check(
        "empty wrapper fail-closed",
        r_nowrap["error"] is not None and r_nowrap["argv"] == [],
    )

    if failures:
        print(f"self-test: {failures} failure(s)", file=sys.stderr)
        return 1
    print("self-test: all passed")
    return 0


def _from_cli(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Build Omnibox Mode A shell_exec argv (deploy contract helper)."
    )
    parser.add_argument("--self-test", action="store_true", help="Run offline unit checks")
    parser.add_argument("--tool", default="shell_exec", help="Hermes tool name")
    parser.add_argument("--profile", default=None, help="Session profile (admin|contributor)")
    parser.add_argument(
        "--path-prefix",
        action="append",
        default=[],
        dest="path_prefixes",
        help="Session path prefix (repeatable)",
    )
    parser.add_argument(
        "--wrapper",
        default=None,
        help="OMNIBOX_WRAPPER path (default env or /usr/local/sbin/run-under-omnibox)",
    )
    parser.add_argument(
        "--enabled",
        default=None,
        help="Override OMNIBOX_ENABLED (default from env)",
    )
    parser.add_argument(
        "--registry",
        default=None,
        help="Path to host-impacting-tools.json",
    )
    parser.add_argument(
        "--stdin-json",
        action="store_true",
        help="Read full request object from stdin",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command after -- ",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return _self_test()

    if args.stdin_json or (not sys.stdin.isatty() and not args.command):
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"invalid JSON stdin: {e}", "argv": [], "wrap": False}))
            return 2
        if not isinstance(payload, dict):
            print(json.dumps({"error": "stdin JSON must be an object", "argv": [], "wrap": False}))
            return 2
        session = payload.get("session") or {}
        if not isinstance(session, dict):
            session = {}
        result = build_argv(
            omnibox_enabled=payload.get(
                "omnibox_enabled", os.environ.get("OMNIBOX_ENABLED", "0")
            ),
            wrapper=payload.get("wrapper") or os.environ.get("OMNIBOX_WRAPPER"),
            tool=str(payload.get("tool") or "shell_exec"),
            profile=session.get("profile", payload.get("profile")),
            path_prefixes=session.get("path_prefixes", payload.get("path_prefixes")),
            command=payload.get("command") or [],
            registry=load_registry(
                payload.get("registry") or args.registry
            ),
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 2 if result.get("error") else 0

    # Strip leading -- from remainder
    cmd = list(args.command)
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        parser.error("command required after -- (or use --stdin-json)")

    enabled = (
        args.enabled
        if args.enabled is not None
        else os.environ.get("OMNIBOX_ENABLED", "0")
    )
    result = build_argv(
        omnibox_enabled=enabled,
        wrapper=args.wrapper or os.environ.get("OMNIBOX_WRAPPER"),
        tool=args.tool,
        profile=args.profile,
        path_prefixes=args.path_prefixes,
        command=cmd,
        registry=load_registry(args.registry),
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 2 if result.get("error") else 0


def main() -> int:
    return _from_cli(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
