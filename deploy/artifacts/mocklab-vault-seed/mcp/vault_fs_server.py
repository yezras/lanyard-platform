#!/usr/bin/env python3
"""Vault-required stdio MCP for MockLab (lp-oop.38.19).

Runs on Daytona via process/session (JSON-RPC on stdin/stdout), not
toolbox process/execute and not the Fargate harness. Sees /mnt/vault.

No secrets, no network, no writes. tools/call list_vault returns vault
paths only (skips credential-like names).

Wire (harness BACKEND_HOME/config.yaml, classified vault_session):

  mcp_servers:
    vault_fs:
      transport: stdio
      enabled: true
      command: python3
      args:
        - /mnt/vault/mcp/vault_fs_server.py
      cwd: /mnt/vault
      requires_vault: true
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "vault_fs"
SERVER_VERSION = "0.1.0-lp-oop.38.19"
DEFAULT_VAULT_ROOT = "/mnt/vault"
LIST_LIMIT = 80
SECRET_NAME = re.compile(
    r"(^|/)(\.env($|\.)|.*secret.*|.*token.*|.*credential.*|\.pem$|id_rsa)",
    re.IGNORECASE,
)
SKIP_DIRS = {".git", ".svn", "node_modules"}


def _write(msg: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _result(req_id: Any, result: dict[str, Any]) -> None:
    _write({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id: Any, code: int, message: str) -> None:
    _write(
        {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": code, "message": message},
        }
    )


def vault_root() -> Path:
    raw = (os.environ.get("VAULT_ROOT") or DEFAULT_VAULT_ROOT).strip()
    return Path(raw)


def is_secret_name(name: str) -> bool:
    return bool(SECRET_NAME.search(name.replace("\\", "/")))


def _tool_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "list_vault",
            "description": (
                "List paths under the tenant vault mount (/mnt/vault). "
                "Read-only. Does not print file bodies or secrets."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        }
    ]


def list_vault_text() -> str:
    root = vault_root()
    display = str(root)
    if not root.is_dir():
        return f"VAULT_ROOT missing: {display}"
    try:
        root_real = root.resolve(strict=True)
    except OSError:
        return f"VAULT_ROOT missing: {display}"
    out: list[str] = [display]
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(
            d
            for d in dirnames
            if d not in SKIP_DIRS and not is_secret_name(d) and not d.startswith(".env")
        )
        rel_dir = os.path.relpath(dirpath, str(root))
        entries = sorted(filenames)
        for name in entries:
            if is_secret_name(name):
                continue
            rel = name if rel_dir == "." else f"{rel_dir}/{name}"
            full = (root / rel).resolve()
            try:
                full.relative_to(root_real)
            except ValueError:
                continue
            out.append(f"{display}/{rel}".replace("//", "/"))
            if len(out) >= LIST_LIMIT:
                return "\n".join(out)
    return "\n".join(out)


def _handle(msg: dict[str, Any]) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

    if req_id is None:
        return

    if method == "initialize":
        _result(
            req_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                },
            },
        )
        return

    if method == "ping":
        _result(req_id, {})
        return

    if method == "tools/list":
        _result(req_id, {"tools": _tool_list()})
        return

    if method == "tools/call":
        name = str(params.get("name") or "")
        if name != "list_vault":
            _error(req_id, -32601, f"Unknown tool: {name}")
            return
        text = list_vault_text()
        _result(
            req_id,
            {
                "content": [{"type": "text", "text": text}],
                "isError": False,
            },
        )
        return

    _error(req_id, -32601, f"Method not found: {method}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict):
            continue
        _handle(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
