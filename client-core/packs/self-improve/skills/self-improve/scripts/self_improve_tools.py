#!/usr/bin/env python3
"""
Deterministic helpers for the self-improve nightly loop.

- evals.db: read/write per skill (append-only policy enforced by callers).
- state.db: READ-ONLY only (URI mode=ro).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOOL_RESULT_ERROR_MARKERS = ("error", "exception", "traceback", "failed", "failure")
USER_CORRECTION_PATTERNS = (
    r"\bno\b",
    r"that'?s wrong",
    r"not what i",
    r"i meant",
    r"try again",
    r"incorrect",
)
EXPLICIT_FEEDBACK_PHRASES = (
    "perfect",
    "thanks",
    "great job",
    "exactly",
    "terrible",
    "useless",
    "wrong",
    "forget it",
    "give up",
)


def _core_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _schema_path() -> Path:
    return _core_root() / "skills" / "self-improve" / "references" / "schema.sql"


def _parse_iso(ts: str) -> float:
    ts = ts.strip()
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _connect_state_ro(path: str) -> sqlite3.Connection:
    uri = f"file:{os.path.abspath(path)}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def cmd_init_eval_db(vault_root: str) -> int:
    vault = Path(vault_root).expanduser().resolve()
    vault.mkdir(parents=True, exist_ok=True)
    db = vault / "evals.db"
    schema = _schema_path()
    if not schema.is_file():
        print(f"schema not found: {schema}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(db)
    try:
        conn.executescript(schema.read_text())
        conn.commit()
    finally:
        conn.close()
    print(json.dumps({"ok": True, "evals_db": str(db)}))
    return 0


def _session_overlaps_window(
    started_at: float,
    ended_at: float | None,
    window_start: float,
    window_end: float,
) -> bool:
    end = ended_at if ended_at is not None else window_end
    return started_at <= window_end and end >= window_start


def _first_user_message(conn: sqlite3.Connection, session_id: str) -> str | None:
    row = conn.execute(
        """
        SELECT content FROM messages
        WHERE session_id = ? AND role = 'user' AND active = 1
        ORDER BY id ASC LIMIT 1
        """,
        (session_id,),
    ).fetchone()
    return row[0] if row else None


def cmd_list_sessions(
    state_db: str,
    window_start: str,
    window_end: str,
    population: str,
    exclude_cron_job_id: str | None,
) -> int:
    ws = _parse_iso(window_start)
    we = _parse_iso(window_end)
    prefix = f"cron_{exclude_cron_job_id}" if exclude_cron_job_id else None

    conn = _connect_state_ro(state_db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, source, parent_session_id, started_at, ended_at, title
            FROM sessions
            WHERE archived = 0
            ORDER BY started_at ASC
            """
        ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            if not _session_overlaps_window(r["started_at"], r["ended_at"], ws, we):
                continue
            sid = r["id"]
            if prefix and sid.startswith(prefix):
                continue
            first_user = _first_user_message(conn, sid)
            if first_user and "[self-improve-internal]" in first_user:
                continue
            source = r["source"] or ""
            parent = r["parent_session_id"]
            is_user = source not in ("cron", "subagent") and parent is None
            is_cron = source == "cron"
            if population == "user" and not is_user:
                continue
            if population == "cron" and not is_cron:
                continue
            out.append(
                {
                    "id": sid,
                    "source": source,
                    "parent_session_id": parent,
                    "started_at": r["started_at"],
                    "ended_at": r["ended_at"],
                    "title": r["title"],
                }
            )
        print(json.dumps({"sessions": out, "count": len(out)}, indent=2))
    finally:
        conn.close()
    return 0


def _truncate_content(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def cmd_export_messages(state_db: str, session_id: str, truncate: int) -> int:
    conn = _connect_state_ro(state_db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, role, content, tool_name, timestamp
            FROM messages
            WHERE session_id = ? AND active = 1
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
        messages = []
        for r in rows:
            content = r["content"]
            if r["role"] == "tool":
                content = _truncate_content(content, truncate)
            messages.append(
                {
                    "id": r["id"],
                    "role": r["role"],
                    "content": content,
                    "tool_name": r["tool_name"],
                    "timestamp": r["timestamp"],
                }
            )
        print(json.dumps({"session_id": session_id, "messages": messages}, indent=2))
    finally:
        conn.close()
    return 0


def _tool_result_looks_like_error(content: str | None) -> bool:
    if not content:
        return False
    lower = content.lower()
    return any(m in lower for m in TOOL_RESULT_ERROR_MARKERS)


def _count_user_corrections(messages: list[dict]) -> int:
    count = 0
    for m in messages:
        if m.get("role") != "user":
            continue
        text = (m.get("content") or "").lower()
        if any(re.search(p, text) for p in USER_CORRECTION_PATTERNS):
            count += 1
    return count


def _count_retry_loops(messages: list[dict]) -> int:
    loops = 0
    last_tool = None
    streak = 0
    for m in messages:
        tool = m.get("tool_name")
        if not tool and m.get("role") != "tool":
            last_tool = None
            streak = 0
            continue
        tool = tool or "tool"
        if tool == last_tool:
            streak += 1
            if streak >= 3:
                loops += 1
        else:
            last_tool = tool
            streak = 1
    return loops


def cmd_compute_features(messages_json: str) -> int:
    data = json.loads(Path(messages_json).read_text())
    messages = data if isinstance(data, list) else data.get("messages", [])
    user_turns = sum(1 for m in messages if m.get("role") == "user")
    assistant_turns = sum(1 for m in messages if m.get("role") == "assistant")
    tool_calls = sum(1 for m in messages if m.get("tool_name") or m.get("role") == "tool")
    tool_errors = sum(
        1
        for m in messages
        if m.get("role") in ("tool", "assistant") and _tool_result_looks_like_error(m.get("content"))
    )
    last = messages[-1] if messages else None
    abandoned = bool(last and last.get("role") == "user")
    explicit_feedback: list[str] = []
    for m in messages:
        if m.get("role") != "user":
            continue
        text = (m.get("content") or "").lower()
        for phrase in EXPLICIT_FEEDBACK_PHRASES:
            if phrase in text:
                explicit_feedback.append(phrase)
    features = {
        "user_turns": user_turns,
        "assistant_turns": assistant_turns,
        "tool_calls": tool_calls,
        "tool_errors": tool_errors,
        "user_corrections": _count_user_corrections(messages),
        "retry_loops": _count_retry_loops(messages),
        "abandoned": abandoned,
        "explicit_feedback": explicit_feedback,
    }
    print(json.dumps(features, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="self-improve deterministic helpers")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init-eval-db")
    p_init.add_argument("--vault-root", required=True)

    p_list = sub.add_parser("list-sessions")
    p_list.add_argument("--state-db", default=os.path.expanduser("~/.hermes/state.db"))
    p_list.add_argument("--window-start", required=True)
    p_list.add_argument("--window-end", required=True)
    p_list.add_argument("--population", choices=("user", "cron"), default="user")
    p_list.add_argument("--exclude-cron-job-id", default=None)

    p_exp = sub.add_parser("export-messages")
    p_exp.add_argument("--state-db", default=os.path.expanduser("~/.hermes/state.db"))
    p_exp.add_argument("--session-id", required=True)
    p_exp.add_argument("--truncate", type=int, default=500)

    p_feat = sub.add_parser("compute-features")
    p_feat.add_argument("--messages-json", required=True)

    args = parser.parse_args()
    if args.command == "init-eval-db":
        return cmd_init_eval_db(args.vault_root)
    if args.command == "list-sessions":
        return cmd_list_sessions(
            args.state_db,
            args.window_start,
            args.window_end,
            args.population,
            args.exclude_cron_job_id,
        )
    if args.command == "export-messages":
        return cmd_export_messages(args.state_db, args.session_id, args.truncate)
    if args.command == "compute-features":
        return cmd_compute_features(args.messages_json)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())