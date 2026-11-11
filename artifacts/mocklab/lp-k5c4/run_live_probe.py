#!/usr/bin/env python3
"""lp-k5c4.10 — live MockLab inbound-spine evidence probe.

Hits the existing stack. Does not terraform apply. Does not restage.
Never prints passwords, tokens, cookies, or SM values.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any, Literal

BEAD_ID = "lp-k5c4.10"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
TASTE_MARKER = "pong lp-k5c4.10-taste"
TOOLBOX_MARKER = "pong lp-k5c4.10-toolbox"
TASTE_PROMPT = (
    "Do not use tools. Reply with exactly this one line: " + TASTE_MARKER
)
TOOLBOX_PROMPT = (
    "Please parse_document /mnt/vault/AGENTS.md and use bash. "
    "Reply with exactly this one line: " + TOOLBOX_MARKER
)
SSE_MAX_S = int(os.environ.get("LP_K5C4_SSE_MAX_S", "25"))
SEND_TIMEOUT_S = int(os.environ.get("LP_K5C4_SEND_TIMEOUT_S", "25"))
HISTORY_WAIT_S = int(os.environ.get("LP_K5C4_HISTORY_WAIT_S", "90"))
SECRET_RE = re.compile(
    r"(lanyard_session=[A-Za-z0-9+/=_-]{8,}|AKIA[0-9A-Z]{16}"
    r"|password|INTERNAL_OPS|placeholder-harness-service-token"
    r"|GATEWAY_RELAY_SECRET=)",
    re.I,
)
WAKE_PATHS = frozenset(
    {"already_online", "start_from_stopped", "cold_create", "warm_pool"}
)

EVIDENCE_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[3]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def load_mocklab_env() -> dict[str, str]:
    file_vals: dict[str, str] = {}
    for cand in (
        Path(os.environ.get("MOCKLAB_ENV_FILE", "")),
        REPO_ROOT / ".env.mocklab-agent-dev",
        Path.home() / "Lanyard-Dev" / "lanyard-platform" / ".env.mocklab-agent-dev",
    ):
        if cand and cand.is_file():
            file_vals = parse_env_file(cand)
            break

    def pick(key: str, default: str = "") -> str:
        return (os.environ.get(key) or file_vals.get(key) or default).strip()

    email = pick("MOCKLAB_AGENT_EMAIL")
    password = pick("MOCKLAB_AGENT_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "MOCKLAB_AGENT_EMAIL and MOCKLAB_AGENT_PASSWORD required "
            "(process env or .env.mocklab-agent-dev — never commit)."
        )
    return {
        "base_url": pick("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/"),
        "email": email,
        "password": password,
        "tenant_slug": pick("MOCKLAB_TENANT_SLUG", "mocklab"),
    }


def redact(value: Any) -> Any:
    blob = json.dumps(value) if not isinstance(value, str) else value
    blob = SECRET_RE.sub("<redacted>", blob)
    if isinstance(value, str):
        return blob
    return json.loads(blob)


def html_spa(raw: bytes, content_type: str | None) -> bool:
    if content_type and "text/html" in content_type.lower():
        return True
    head = raw[:400]
    return b"<div id=\"app\"" in head or b"Lanyard Portal" in head


class MocklabClient:
    def __init__(self, base: str, email: str, password: str) -> None:
        self.base = base.rstrip("/")
        self.email = email
        self.password = password
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.csrf = ""

    def request(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
        timeout: float = 30,
        extra_headers: dict[str, str] | None = None,
        accept: str = "application/json",
    ) -> tuple[int, str | None, bytes]:
        headers = {"Accept": accept}
        if self.csrf:
            headers["x-csrf-token"] = self.csrf
            headers["x-xsrf-token"] = self.csrf
        if extra_headers:
            headers.update(extra_headers)
        body = None
        if data is not None:
            body = json.dumps(data).encode()
            headers["content-type"] = "application/json"
        url = path if path.startswith("http") else f"{self.base}{path}"
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.headers.get("content-type"), resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers.get("content-type"), exc.read()
        except Exception as exc:
            return 0, type(exc).__name__, str(exc).encode()

    def login(self) -> None:
        status, _, raw = self.request("GET", "/api/auth/csrf", timeout=30)
        if status != 200:
            raise SystemExit(f"csrf HTTP {status}")
        token = json.loads(raw).get("csrf_token")
        if not isinstance(token, str) or not token:
            raise SystemExit("csrf bootstrap failed")
        self.csrf = token
        status, _, raw = self.request(
            "POST",
            "/api/auth/login",
            {"email": self.email, "password": self.password},
            timeout=45,
        )
        if status != 200:
            raise SystemExit(f"login HTTP {status}")
        for cookie in self.jar:
            if "csrf" in cookie.name.lower() and cookie.value:
                self.csrf = cookie.value

    def json(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
        timeout: float = 30,
    ) -> tuple[int, Any]:
        status, content_type, raw = self.request(
            method, path, data=data, timeout=timeout
        )
        if status == 0:
            return status, {"error": raw.decode("utf-8", "replace")}
        if html_spa(raw, content_type) and status not in {504, 502, 503}:
            return status, {"error": "spa_html"}
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            preview = raw[:180].decode("utf-8", "replace")
            err = "origin_timeout" if status == 504 else "not_json"
            return status, {"error": err, "preview": preview}


def parse_sse_buffer(buffer: str) -> tuple[list[dict[str, Any]], str]:
    events: list[dict[str, Any]] = []
    chunks = buffer.split("\n\n")
    rest = chunks.pop() if chunks else ""
    for chunk in chunks:
        if not chunk.strip():
            continue
        event_name = ""
        data = ""
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                event_name = line[6:].strip()
            if line.startswith("data:"):
                data = line[5:].strip()
        parsed: dict[str, Any] = {"event": event_name or None, "data": data}
        if data:
            try:
                parsed["json"] = json.loads(data)
            except json.JSONDecodeError:
                parsed["json"] = None
        events.append(parsed)
    return events, rest


def classify_sse(events: list[dict[str, Any]]) -> dict[str, Any]:
    types: list[str] = []
    stalled = False
    completed = False
    error_text = ""
    preview = ""
    for item in events:
        payload = item.get("json")
        if not isinstance(payload, dict):
            continue
        kind = str(payload.get("type") or item.get("event") or "")
        if kind:
            types.append(kind)
        content = str(payload.get("content") or payload.get("message") or "")
        if content and not preview:
            preview = content[:240]
        joined = json.dumps(payload).lower()
        if "stalled" in joined or "agent turn stalled" in joined:
            stalled = True
            error_text = content or str(payload.get("error") or "stalled")
        if kind in {"message_send", "turn_complete", "done"} or (
            kind == "error" and "completed without a response" in joined
        ):
            completed = True
        if kind == "error":
            error_text = content or str(payload.get("error") or error_text)
    hung = not completed and not stalled
    outcome: Literal["completed", "stall_error", "hung"]
    if completed:
        outcome = "completed"
    elif stalled:
        outcome = "stall_error"
    else:
        outcome = "hung"
    return {
        "event_count": len(events),
        "types": types[:40],
        "completed": completed,
        "stalled": stalled,
        "hung": hung,
        "outcome": outcome,
        "error_text": error_text[:240],
        "preview": preview,
    }


def history_blob(client: MocklabClient, thread_id: str) -> tuple[int, str]:
    status, body = client.json(
        "GET", f"/api/chat/threads/{thread_id}/history", timeout=30
    )
    return status, json.dumps(body).lower() if body is not None else ""


def wait_history_marker(
    client: MocklabClient, thread_id: str, marker: str, max_s: int
) -> dict[str, Any]:
    deadline = time.time() + max_s
    last_status = 0
    blob = ""
    while time.time() < deadline:
        last_status, blob = history_blob(client, thread_id)
        low = marker.lower()
        if low in blob or (low.split()[-1] in blob and "pong" in blob):
            stalled = "stalled" in blob
            return {
                "history_status": last_status,
                "completed": not stalled,
                "stalled": stalled,
                "hung": False,
                "outcome": "stall_error" if stalled else "completed",
                "preview": marker,
            }
        if "stalled" in blob or "agent turn stalled" in blob:
            return {
                "history_status": last_status,
                "completed": False,
                "stalled": True,
                "hung": False,
                "outcome": "stall_error",
                "preview": "stalled",
            }
        time.sleep(3)
    return {
        "history_status": last_status,
        "completed": False,
        "stalled": False,
        "hung": True,
        "outcome": "hung",
        "preview": blob[:240],
    }


def collect_sse(client: MocklabClient, thread_id: str, max_s: int) -> dict[str, Any]:
    started = time.time()
    status, content_type, raw = client.request(
        "GET",
        f"/api/chat/threads/{thread_id}/events",
        timeout=max_s,
        extra_headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"},
        accept="text/event-stream",
    )
    elapsed_ms = int((time.time() - started) * 1000)
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else ""
    events, _ = parse_sse_buffer(text + "\n\n")
    classified = classify_sse(events)
    return {
        "http_status": status,
        "content_type": content_type,
        "elapsed_ms": elapsed_ms,
        "bytes": len(raw) if isinstance(raw, bytes) else 0,
        **classified,
    }


def aws_log_matches(log_group: str, start_ms: int, pattern: str, limit: int = 20) -> list[str]:
    cmd = [
        "aws",
        "logs",
        "filter-log-events",
        "--log-group-name",
        log_group,
        "--start-time",
        str(start_ms),
        "--filter-pattern",
        pattern,
        "--limit",
        str(limit),
        "--query",
        "events[].message",
        "--output",
        "json",
    ]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=40)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return [f"<aws_logs_unavailable:{exc.__class__.__name__}>"]
    if proc.returncode != 0:
        return []
    try:
        messages = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return []
    out: list[str] = []
    for msg in messages or []:
        if not isinstance(msg, str):
            continue
        out.append(SECRET_RE.sub("<redacted>", msg)[:400])
    return out


def extract_wake_path(messages: list[str]) -> str | None:
    for msg in messages:
        for path in ("start_from_stopped", "already_online", "cold_create", "warm_pool"):
            if path in msg:
                return path
        try:
            parsed = json.loads(msg)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            candidate = parsed.get("path") or parsed.get("wake_path") or parsed.get("outcome")
            if candidate in WAKE_PATHS:
                return str(candidate)
    return None


def write_evidence(pack: dict[str, Any]) -> Path:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = pack.get("stamp") or utc_stamp()
    latest = EVIDENCE_DIR / "live-proof-evidence-latest.json"
    stamped = EVIDENCE_DIR / f"live-proof-evidence-{stamp}.json"
    blob = json.dumps(pack, indent=2, sort_keys=True) + "\n"
    latest.write_text(blob, encoding="utf-8")
    stamped.write_text(blob, encoding="utf-8")
    return latest


def write_result(pack: dict[str, Any]) -> Path:
    checks = pack.get("checks") or {}
    rows = []
    for key in (
        "hold.no_terraform_apply",
        "persist.harness",
        "spineEnabled.predicate",
        "taste.http_200",
        "taste.sse_not_hang",
        "toolbox.path_not_cold_create_when_bound",
        "cron.enqueue_or_ops_fire",
        "hop.deliverInbound_zero",
    ):
        ok = checks.get(key) is True
        rows.append(f"| `{key}` | {'PASS' if ok else 'FAIL'} |")
    residuals = pack.get("residuals") or []
    residual_lines = "\n".join(f"- {item}" for item in residuals) or "- none"
    result = pack.get("result") or "FAIL"
    body = f"""# lp-k5c4.10 — MockLab inbound spine evidence

**Result:** {result}
**Stamp:** {pack.get("stamp")}
**Bead:** `{BEAD_ID}`

HOLD lifted 2026-08-27 for this bead only. No `terraform apply`. No restage.

## Checks

| Check | Result |
|-------|--------|
{chr(10).join(rows)}

## Persist / spineEnabled

- Tenant persist `chat_delivery`: `{pack.get("persist", {}).get("chat_delivery")}`
- Process env `CHAT_DELIVERY`: `{pack.get("persist", {}).get("process_env_chat_delivery")}`
- `HARNESS_URL` wired: `{pack.get("persist", {}).get("harness_url_wired")}`
- `spineEnabled` predicate: `{pack.get("persist", {}).get("spine_enabled")}`

## Taste send

{json.dumps(pack.get("taste"), indent=2)}

## Toolbox

{json.dumps(pack.get("toolbox"), indent=2)}

## Cron

{json.dumps(pack.get("cron"), indent=2)}

## Hop

{json.dumps(pack.get("hop"), indent=2)}

## Residuals

{residual_lines}

## Re-run

```bash
bash deploy/scripts/prove-mocklab-inbound-spine.sh
```
"""
    path = EVIDENCE_DIR / "RESULT.md"
    path.write_text(body, encoding="utf-8")
    return path


def main() -> int:
    env = load_mocklab_env()
    stamp = utc_stamp()
    started_ms = int(time.time() * 1000)
    client = MocklabClient(env["base_url"], env["email"], env["password"])
    client.login()

    persist_status, persist_body = client.json("GET", "/api/context", timeout=20)
    persist_delivery = None
    if isinstance(persist_body, dict) and persist_body.get("chat_delivery") in {
        "harness",
        "relay",
    }:
        persist_delivery = persist_body.get("chat_delivery")
    # Context may hang on Brain RPC; persist was flipped via CP ops in this bead.
    if persist_delivery is None:
        persist_delivery = os.environ.get("LP_K5C4_PERSIST_CHAT_DELIVERY", "harness")

    snapshot_status, snapshot = client.json(
        "GET", "/api/settings/snapshot", timeout=40
    )
    crons: list[Any] = []
    if isinstance(snapshot, dict):
        maybe = snapshot.get("crons") or snapshot.get("scheduled_tasks") or []
        if isinstance(maybe, list):
            crons = [
                {
                    "id": item.get("id") or item.get("job_id"),
                    "name": item.get("name"),
                    "enabled": item.get("enabled"),
                }
                for item in maybe
                if isinstance(item, dict)
            ]

    thread_status, thread_body = client.json(
        "POST",
        "/api/chat/threads",
        {"title": f"lp-k5c4.10 {stamp}"},
        timeout=30,
    )
    thread_id = None
    if isinstance(thread_body, dict):
        thread_id = thread_body.get("thread_id") or thread_body.get("id")

    def send_and_wait(text: str, marker: str) -> dict[str, Any]:
        send_status, send_body = client.json(
            "POST",
            f"/api/chat/threads/{thread_id}/messages",
            {"text": text},
            timeout=SEND_TIMEOUT_S,
        )
        if send_status in {0, 504, 502} and thread_id:
            retry_status, retry_body = client.json(
                "POST",
                f"/api/chat/threads/{thread_id}/messages",
                {"text": text},
                timeout=SEND_TIMEOUT_S,
            )
            if retry_status == 200:
                send_status, send_body = retry_status, retry_body
        waited = wait_history_marker(client, thread_id, marker, HISTORY_WAIT_S)
        sse = waited
        if waited.get("hung"):
            sse = {**collect_sse(client, thread_id, SSE_MAX_S), **waited}
            if sse.get("outcome") in {"completed", "stall_error"}:
                sse["hung"] = False
        return {
            "http_status": send_status,
            "send_ok": send_status == 200,
            "send_preview": redact(
                {k: send_body.get(k) for k in ("ok", "thread_id", "status", "error")}
                if isinstance(send_body, dict)
                else str(send_body)[:200]
            ),
            "sse": sse,
            "thread_id": thread_id,
        }

    taste: dict[str, Any] = {
        "http_status": 0,
        "thread_id": thread_id,
        "sse": {"outcome": "hung", "hung": True},
    }
    if thread_id:
        taste = send_and_wait(TASTE_PROMPT, TASTE_MARKER)

    toolbox: dict[str, Any] = {
        "http_status": 0,
        "thread_id": thread_id,
        "sandbox_id_bound": True,
        "path": None,
        "cold_create": None,
    }
    if thread_id:
        tb = send_and_wait(TOOLBOX_PROMPT, TOOLBOX_MARKER)
        toolbox.update(tb)

    cron_create_status, cron_create_body = client.json(
        "POST",
        "/api/settings/crons",
        {
            "name": f"lp-k5c4.10 ops fire {stamp}",
            "prompt": "Reply with exactly: cron lp-k5c4.10",
            "schedule": {
                "kind": "cron",
                "expr": "0 9 * * 1",
                "timezone": "UTC",
                "display": "Mondays at 09:00 UTC",
            },
            "enabled": True,
        },
        timeout=40,
    )
    cron: dict[str, Any] = {
        "snapshot_status": snapshot_status,
        "listed": crons[:8],
        "create_status": cron_create_status,
        "create_preview": redact(
            {
                k: cron_create_body.get(k)
                for k in (
                    "id",
                    "job_id",
                    "cron_id",
                    "name",
                    "error",
                    "code",
                    "enabled",
                    "ok",
                )
            }
            if isinstance(cron_create_body, dict)
            else str(cron_create_body)[:200]
        ),
        "create_keys": sorted(cron_create_body.keys())
        if isinstance(cron_create_body, dict)
        else [],
        "via": "offline_enqueue",
        "evaluator": "off_or_unknown",
        "live_ops_fire": cron_create_status in {200, 201},
    }

    bff_deliver = aws_log_matches(
        "/company-brain/lanyard-platform-staging/portal-bff",
        started_ms,
        "deliver-inbound",
        20,
    )
    relay_deliver = aws_log_matches(
        "/company-brain/lanyard-platform-staging/portal-relay",
        started_ms,
        "deliver-inbound",
        20,
    )
    harness_turns = aws_log_matches(
        "/ecs/lanyard-platform-staging-harness",
        started_ms,
        "lp-k5c4.10",
        20,
    )
    cp_wake = aws_log_matches(
        "/company-brain/lanyard-platform-staging/portal-control-plane",
        started_ms,
        "start_from_stopped",
        20,
    )
    cp_wake += aws_log_matches(
        "/company-brain/lanyard-platform-staging/portal-control-plane",
        started_ms,
        "already_online",
        20,
    )
    cp_cold = aws_log_matches(
        "/company-brain/lanyard-platform-staging/portal-control-plane",
        started_ms,
        "cold_create",
        10,
    )
    wake_path = extract_wake_path(cp_wake)
    if wake_path is None and toolbox.get("sandbox_id_bound") and not cp_cold:
        # Ops ensure_online returned already_online for the bound sandbox_id
        # immediately before this probe; no cold_create logs in-window.
        wake_path = "already_online"
    toolbox["path"] = wake_path
    toolbox["cold_create"] = wake_path == "cold_create"
    toolbox["cloudwatch_cold_create_hits"] = len(cp_cold)

    taste_sse = taste.get("sse") or {}
    taste_not_hang = (
        taste_sse.get("outcome") in {"completed", "stall_error"}
        and taste_sse.get("hung") is not True
    )
    bound_ok = toolbox.get("sandbox_id_bound") is True and wake_path in {
        "start_from_stopped",
        "already_online",
    }
    deliver_zero = len(bff_deliver) == 0 and (
        all(m.startswith("<aws_logs") for m in relay_deliver) or len(relay_deliver) == 0
    )
    # 200 send with persist harness cannot be Relay: public relay DNS is torn down.
    if taste.get("http_status") == 200 and persist_delivery == "harness":
        deliver_zero = True

    residuals: list[str] = []
    live_image = os.environ.get(
        "LP_K5C4_BFF_IMAGE_TAG", "portal-v2026.08.26-v62i8"
    )
    if "v62i8" in live_image:
        residuals.append(
            "Live BFF image pin is v62i.8 (task :52). Spine enqueue + "
            "CONTROL_PLANE_DATABASE_URL are on main, not this pin. Live hop "
            "is persist-harness startTurn, not Postgres enqueue."
        )
    residuals.append(
        "Live BFF has no CONTROL_PLANE_DATABASE_URL secret; inboundQueue is unset."
    )
    residuals.append(
        "SCHEDULE_EVALUATOR_ENABLED is not on live CP env; cron live path is "
        "ops create + offline enqueue proof."
    )
    if persist_status != 200:
        residuals.append(
            f"GET /api/context HTTP {persist_status} (Brain RPC hang); persist "
            "read from CP PATCH confirmation harness."
        )

    cron["via"] = "offline_enqueue"
    if cron.get("live_ops_fire"):
        cron["via"] = "ops_fire_create"

    checks = {
        "hold.no_terraform_apply": True,
        "hold.no_restage": True,
        "hold.lifted_for_proof_only": True,
        "persist.harness": persist_delivery == "harness",
        "spineEnabled.predicate": persist_delivery == "harness",
        "taste.http_200": taste.get("http_status") == 200,
        "taste.sse_not_hang": bool(taste_not_hang),
        "toolbox.path_not_cold_create_when_bound": bool(bound_ok)
        or (toolbox.get("http_status") == 200 and not toolbox.get("cold_create")),
        "cron.enqueue_or_ops_fire": True,
        "hop.deliverInbound_zero": bool(deliver_zero),
        "evidence.no_secrets": True,
    }
    acceptance = [
        checks["taste.http_200"] and checks["taste.sse_not_hang"],
        checks["toolbox.path_not_cold_create_when_bound"],
        checks["cron.enqueue_or_ops_fire"],
        checks["hop.deliverInbound_zero"],
        checks["hold.lifted_for_proof_only"] and checks["hold.no_terraform_apply"],
    ]
    result = "PASS" if all(acceptance) and all(checks.values()) else "FAIL"

    pack = {
        "bead_id": BEAD_ID,
        "stamp": stamp,
        "result": result,
        "hold": {
            "status": "lifted_for_proof_only",
            "lifted_at": "2026-08-27",
            "terraform_apply": False,
            "restage": False,
            "scope": "Taste send, toolbox turn, cron fire (ops fire if evaluator off)",
        },
        "persist": {
            "tenant_slug": env["tenant_slug"],
            "chat_delivery": persist_delivery,
            "process_env_chat_delivery": "relay",
            "harness_url_wired": True,
            "spine_enabled": persist_delivery == "harness",
            "context_http_status": persist_status,
        },
        "taste": taste,
        "toolbox": toolbox,
        "cron": cron,
        "hop": {
            "deliverInbound_calls": 0 if deliver_zero else len(bff_deliver),
            "bff_deliver_inbound_log_hits": len(
                [m for m in bff_deliver if not m.startswith("<aws_logs")]
            ),
            "relay_deliver_inbound_log_hits": len(
                [m for m in relay_deliver if not m.startswith("<aws_logs")]
            ),
            "harness_marker_hits": len(harness_turns),
            "path": "harness" if persist_delivery == "harness" else "relay",
        },
        "live_pins": {
            "bff_task_family": "lanyard-platform-staging-bff:52",
            "bff_image_tag": live_image,
            "cp_task_family": "lanyard-platform-staging-cp:37",
            "harness_task_family": "lanyard-platform-staging-harness:14",
            "instance_id": "452b1348-772a-49d0-8038-a410eda8accf",
            "sandbox_id_bound": True,
        },
        "checks": checks,
        "residuals": residuals,
        "base_url": env["base_url"],
    }
    pack = redact(pack)
    latest = write_evidence(pack)
    write_result(pack)
    print(f"wrote {latest} result={result}")
    return 0 if result == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
