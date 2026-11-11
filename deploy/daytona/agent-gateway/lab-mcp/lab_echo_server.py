#!/usr/bin/env python3
"""Lab-only stdio MCP server for MockLab product-surface proof (lp-zuh.10.6).

No secrets, no network, no vault writes. Implements a minimal MCP subset over
newline-delimited JSON-RPC 2.0 on stdin/stdout so Lanyard Agent can register
one hidden tool once `mcp_servers` is accepted by the LA config schema and
stdio MCP client (platform bead lp-vw3 / LA product work).

Tools:
  - lab_echo: echo a string (proves tools/list + tools/call path)

Wire (when LA supports it) via kitchen-sink fragment:

  mcp_servers:
    lab_echo:
      transport: stdio
      enabled: true
      command: python3
      args:
        - /opt/lanyard/lab-mcp/lab_echo_server.py

Do not use this binary in production customer images without an explicit
product decision. Lab / MockLab only.
"""

from __future__ import annotations

import json
import sys
from typing import Any

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "lab_echo"
SERVER_VERSION = "0.1.0-lp-zuh.10.6"


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


def _tool_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "lab_echo",
            "description": (
                "Lab-only MCP echo tool (MockLab product surface). "
                "Returns the input text; no secrets or side effects."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to echo back",
                    }
                },
                "required": ["text"],
                "additionalProperties": False,
            },
        }
    ]


def _handle(msg: dict[str, Any]) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

    # Notifications (no id) — ignore after initialize.
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
        arguments = (
            params.get("arguments")
            if isinstance(params.get("arguments"), dict)
            else {}
        )
        if name != "lab_echo":
            _error(req_id, -32601, f"Unknown tool: {name}")
            return
        text = arguments.get("text", "")
        if not isinstance(text, str):
            text = str(text)
        _result(
            req_id,
            {
                "content": [
                    {
                        "type": "text",
                        "text": text,
                    }
                ],
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
