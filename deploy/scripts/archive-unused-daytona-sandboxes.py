#!/usr/bin/env python3
"""Archive unused Daytona sandboxes without touching bound instance sandbox_ids.

Bead: lp-oop.37.7 (30GiB org disk hygiene after idle-stop leftover boxes)

Idle reaper stop retains the CP `sandbox_id` (warm start-from-stopped). Stopped
volumes still count against the org disk quota until archived. Recreate leftovers
and failed archive-from-wrong-state (HTTP 409) fill the 30GiB cap and make the
next cold create fail with "Total disk limit exceeded".

This job lists org sandboxes, keeps every sandbox_id bound in the CP instance
registry (MockLab today; future tenants the same), and archives only unbound /
stale boxes. Dry-run is the default. --apply is required to mutate.

Never prints secrets (API keys, service tokens, Authorization headers).

Usage:
  python3 deploy/scripts/archive-unused-daytona-sandboxes.py --self-test
  python3 deploy/scripts/archive-unused-daytona-sandboxes.py \\
      --sandboxes-json fixtures.json --cp-instances-json instances.json
  python3 deploy/scripts/archive-unused-daytona-sandboxes.py \\
      --keep-id "$BOUND_ID"                 # live list, still dry-run
  python3 deploy/scripts/archive-unused-daytona-sandboxes.py \\
      --tenant-id "$MOCKLAB_TENANT_ID" --apply
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode

API_BASE_DEFAULT = "https://app.daytona.io/api"
SM_NAME_DEFAULT = "lanyard/staging/portal/daytona"
SM_REGION_DEFAULT = "us-east-1"
DISK_CAP_GIB_DEFAULT = 30

TERMINAL_STATES = frozenset(
    {"archived", "archiving", "destroying", "destroyed"}
)
IN_PROGRESS_STATES = frozenset(
    {"creating", "starting", "restoring", "pulling", "pending"}
)
APPLY_REFUSED_EXIT = 2

SECRET_ENV_KEYS = (
    "DAYTONA_API_KEY",
    "CONTROL_PLANE_SERVICE_TOKEN",
    "INTERNAL_OPS_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
)


# ---------------------------------------------------------------------------
# Pure selection (offline-testable)
# ---------------------------------------------------------------------------


def sandbox_id_of(item: dict[str, Any]) -> str:
    raw = item.get("id") or item.get("sandboxId") or item.get("sandbox_id")
    return str(raw).strip() if raw else ""


def sandbox_state_of(item: dict[str, Any]) -> str:
    return str(item.get("state") or "").strip().lower()


def sandbox_disk_gib(item: dict[str, Any]) -> int:
    try:
        return int(item.get("disk") or 0)
    except (TypeError, ValueError):
        return 0


def _parse_ts(raw: Any) -> datetime | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def sandbox_updated_at(item: dict[str, Any]) -> datetime | None:
    for key in ("updatedAt", "updated_at", "createdAt", "created_at"):
        dt = _parse_ts(item.get(key))
        if dt is not None:
            return dt
    return None


def sandbox_age_hours(item: dict[str, Any], now: datetime) -> float | None:
    ts = sandbox_updated_at(item)
    if ts is None:
        return None
    return max(0.0, (now - ts).total_seconds() / 3600.0)


def classify_sandbox(
    item: dict[str, Any],
    keep_set: set[str],
    *,
    include_started_unbound: bool = False,
    min_age_hours: float = 0.0,
    now: datetime | None = None,
) -> tuple[str, str]:
    """Return (action, reason).

    action is one of: keep, skip, archive.
    """
    sid = sandbox_id_of(item)
    if not sid:
        return "skip", "missing_id"
    state = sandbox_state_of(item)
    if state in TERMINAL_STATES:
        return "skip", "terminal"
    if sid in keep_set:
        return "keep", "bound_instance"
    if min_age_hours > 0:
        clock = now or datetime.now(timezone.utc)
        age = sandbox_age_hours(item, clock)
        if age is None:
            return "skip", "age_unknown"
        if age < min_age_hours:
            return "skip", "too_new"
    if state in IN_PROGRESS_STATES:
        return "skip", "in_progress"
    if state == "started" and not include_started_unbound:
        return "skip", "started_unbound"
    return "archive", "unbound"


def select_targets(
    items: Iterable[dict[str, Any]],
    keep_set: set[str],
    *,
    include_started_unbound: bool = False,
    min_age_hours: float = 0.0,
    now: datetime | None = None,
) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = {
        "keep": [],
        "skip": [],
        "archive": [],
    }
    for it in items:
        action, reason = classify_sandbox(
            it,
            keep_set,
            include_started_unbound=include_started_unbound,
            min_age_hours=min_age_hours,
            now=now,
        )
        row = dict(it)
        row["_action"] = action
        row["_reason"] = reason
        buckets[action].append(row)
    return buckets


def extract_bound_sandbox_ids(payload: Any) -> set[str]:
    """Collect sandbox_id values from a CP registry dump or keep-list JSON."""
    found: set[str] = set()

    def add(value: Any) -> None:
        if value is None:
            return
        text = str(value).strip()
        if text and text.lower() not in {"null", "none", "-"}:
            found.add(text)

    def walk(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, str):
            add(node)
            return
        if isinstance(node, dict):
            if "sandbox_id" in node:
                add(node.get("sandbox_id"))
            if "sandboxId" in node:
                add(node.get("sandboxId"))
            ids = node.get("sandbox_ids")
            if isinstance(ids, list):
                for x in ids:
                    add(x)
            for key in ("instances", "items", "tenants", "rows"):
                if key in node:
                    walk(node.get(key))
            return
        if isinstance(node, list):
            for x in node:
                walk(x)

    walk(payload)
    return found


def parse_keep_ids_file(text: str) -> set[str]:
    found: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        found.add(stripped)
    return found


def summarize_states(items: Iterable[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
    states: dict[str, int] = {}
    disk: dict[str, int] = {}
    for it in items:
        st = sandbox_state_of(it) or "?"
        states[st] = states.get(st, 0) + 1
        disk[st] = disk.get(st, 0) + sandbox_disk_gib(it)
    return states, disk


def active_disk_gib(items: Iterable[dict[str, Any]]) -> int:
    total = 0
    for it in items:
        if sandbox_state_of(it) not in TERMINAL_STATES:
            total += sandbox_disk_gib(it)
    return total


def extract_list_items(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        items = body.get("items")
        if isinstance(items, list):
            return [x for x in items if isinstance(x, dict)]
        sandboxes = body.get("sandboxes")
        if isinstance(sandboxes, list):
            return [x for x in sandboxes if isinstance(x, dict)]
    return []


def redact_text(text: str, extra_secrets: Iterable[str] = ()) -> str:
    out = text
    for key in SECRET_ENV_KEYS:
        val = os.environ.get(key, "").strip()
        if val:
            out = out.replace(val, f"<{key}>")
    for secret in extra_secrets:
        s = str(secret or "").strip()
        if s:
            out = out.replace(s, "<redacted>")
    return out


def looks_like_secret_line(line: str) -> bool:
    lowered = line.lower()
    if "bearer " in lowered and "authorization" in lowered:
        return True
    for needle in (
        "daytona_api_key=",
        "control_plane_service_token=",
        "internal_ops_token=",
        "aws_secret_access_key=",
    ):
        if needle in lowered:
            return True
    return False


# ---------------------------------------------------------------------------
# I/O (Daytona + CP). Secrets stay in memory; never printed.
# ---------------------------------------------------------------------------


def load_daytona_creds() -> tuple[str, str]:
    key = os.environ.get("DAYTONA_API_KEY", "").strip()
    org = os.environ.get("DAYTONA_ORG_ID", "").strip()
    if key and org:
        return key, org
    sm_name = os.environ.get("DAYTONA_SM_SECRET", SM_NAME_DEFAULT)
    region = os.environ.get("AWS_REGION", SM_REGION_DEFAULT)
    raw = subprocess.check_output(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            sm_name,
            "--region",
            region,
            "--query",
            "SecretString",
            "--output",
            "text",
        ],
        text=True,
    )
    data = json.loads(raw)
    return str(data["DAYTONA_API_KEY"]), str(data["DAYTONA_ORG_ID"])


def http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    *,
    timeout: int = 90,
) -> tuple[int, Any]:
    req = urllib.request.Request(url, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            if not raw:
                return resp.status, None
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw[:300]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body


def daytona_headers(api_key: str, org: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "X-Daytona-Organization-ID": org,
    }


def list_org_sandboxes(api_base: str, api_key: str, org: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        qs = {"limit": "100"}
        if cursor:
            qs["cursor"] = cursor
        url = f"{api_base.rstrip('/')}/sandbox?{urlencode(qs)}"
        status, body = http_json("GET", url, daytona_headers(api_key, org))
        if status != 200:
            raise SystemExit(
                f"list failed status={status} body={redact_text(repr(body)[:300])}"
            )
        items.extend(extract_list_items(body))
        cursor = None
        if isinstance(body, dict):
            nxt = body.get("nextCursor") or body.get("next_cursor")
            if nxt:
                cursor = str(nxt)
        if not cursor:
            break
    return items


def load_keep_set_from_cp(
    cp_url: str,
    tenant_ids: list[str],
    *,
    service_token: str = "",
    ops_token: str = "",
) -> set[str]:
    if not tenant_ids:
        return set()
    if not service_token and not ops_token:
        raise SystemExit(
            "CP keep-set requested but neither CONTROL_PLANE_SERVICE_TOKEN "
            "nor INTERNAL_OPS_TOKEN is set"
        )
    found: set[str] = set()
    base = cp_url.rstrip("/")
    for tid in tenant_ids:
        url = f"{base}/tenants/{tid}/gateway-instances"
        headers: dict[str, str] = {}
        if service_token:
            headers["x-control-plane-service-token"] = service_token
        if ops_token:
            headers["x-internal-ops-token"] = ops_token
        status, body = http_json("GET", url, headers)
        if status != 200:
            raise SystemExit(
                f"CP gateway-instances failed tenant={tid} status={status} "
                f"body={redact_text(repr(body)[:300])}"
            )
        found |= extract_bound_sandbox_ids(body)
    return found


def archive_one(
    api_base: str,
    api_key: str,
    org: str,
    item: dict[str, Any],
    *,
    retry_wait_s: float = 2.0,
) -> tuple[str, int]:
    """Stop if needed, archive, retry once on 409 (wrong-state).

    Returns (outcome, last_http_status). outcome is archived|skipped_409|
    skipped_gone|failed.
    """
    sid = sandbox_id_of(item)
    base = api_base.rstrip("/")
    headers = daytona_headers(api_key, org)
    state = sandbox_state_of(item)
    last_status = 0

    if state == "started":
        last_status, _ = http_json("POST", f"{base}/sandbox/{sid}/stop", headers)
        time.sleep(retry_wait_s)

    last_status, _ = http_json("POST", f"{base}/sandbox/{sid}/archive", headers)
    if last_status in (200, 201, 202, 204):
        return "archived", last_status
    if last_status == 404:
        return "skipped_gone", last_status
    if last_status == 409:
        # Live recreate path also sees 409 archive-from-wrong-state.
        http_json("POST", f"{base}/sandbox/{sid}/stop", headers)
        time.sleep(retry_wait_s)
        last_status, _ = http_json(
            "POST", f"{base}/sandbox/{sid}/archive", headers
        )
        if last_status in (200, 201, 202, 204):
            return "archived", last_status
        if last_status == 404:
            return "skipped_gone", last_status
        if last_status == 409:
            return "skipped_409", last_status
    return "failed", last_status


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def load_json_path(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def collect_keep_set(args: argparse.Namespace) -> set[str]:
    keep: set[str] = set()
    for sid in args.keep_id or []:
        text = str(sid).strip()
        if text:
            keep.add(text)
    if args.keep_ids_file:
        keep |= parse_keep_ids_file(
            Path(args.keep_ids_file).read_text(encoding="utf-8")
        )
    if args.cp_instances_json:
        keep |= extract_bound_sandbox_ids(load_json_path(args.cp_instances_json))
    tenant_ids = list(args.tenant_id or [])
    cp_url = (args.cp_url or os.environ.get("CONTROL_PLANE_URL") or "").strip()
    if tenant_ids and cp_url:
        keep |= load_keep_set_from_cp(
            cp_url,
            tenant_ids,
            service_token=os.environ.get("CONTROL_PLANE_SERVICE_TOKEN", "").strip(),
            ops_token=os.environ.get("INTERNAL_OPS_TOKEN", "").strip(),
        )
    elif tenant_ids and not args.cp_instances_json and not args.sandboxes_json:
        raise SystemExit(
            "--tenant-id requires --cp-url or CONTROL_PLANE_URL "
            "(or pass --cp-instances-json for an offline dump)"
        )
    return keep


def print_plan(
    items: list[dict[str, Any]],
    buckets: dict[str, list[dict[str, Any]]],
    *,
    dry_run: bool,
    disk_cap: int,
    keep_set: set[str],
) -> None:
    states, disk = summarize_states(items)
    active = active_disk_gib(items)
    print("keep_set_count", len(keep_set))
    print("org_sandboxes", len(items))
    print("before_states", states)
    print("before_disk_GiB", disk)
    print("active_disk_GiB", active)
    print("disk_cap_GiB", disk_cap)
    print("headroom_GiB", disk_cap - active)
    print("bound_kept", len(buckets["keep"]))
    print(
        f"targets={len(buckets['archive'])} dry_run={str(dry_run).lower()} "
        f"skipped={len(buckets['skip'])}"
    )
    for row in buckets["keep"]:
        print(
            " keep",
            sandbox_id_of(row),
            "state=" + (sandbox_state_of(row) or "?"),
            "disk",
            sandbox_disk_gib(row),
            "reason=bound_instance",
        )
    for row in buckets["skip"]:
        print(
            " skip",
            sandbox_id_of(row) or "-",
            "state=" + (sandbox_state_of(row) or "?"),
            "disk",
            sandbox_disk_gib(row),
            "reason=" + row.get("_reason", "skip"),
        )
    verb = "would_archive" if dry_run else "archive_plan"
    for row in buckets["archive"]:
        print(
            " " + verb,
            sandbox_id_of(row),
            "state=" + (sandbox_state_of(row) or "?"),
            "disk",
            sandbox_disk_gib(row),
            "reason=" + row.get("_reason", "unbound"),
        )


def run_job(args: argparse.Namespace) -> int:
    keep_set = collect_keep_set(args)
    dry_run = not args.apply

    if args.apply and args.sandboxes_json:
        print("refuse --apply with --sandboxes-json (fixture is read-only)", file=sys.stderr)
        return APPLY_REFUSED_EXIT
    if args.apply and not keep_set and not args.allow_empty_keep_set:
        print(
            "refuse --apply without a keep-set "
            "(pass --keep-id / --keep-ids-file / --cp-instances-json / "
            "--tenant-id+CP, or --allow-empty-keep-set)",
            file=sys.stderr,
        )
        return APPLY_REFUSED_EXIT
    if not keep_set:
        print(
            "WARN: empty keep-set; bound MockLab/tenant sandbox_id is unknown",
            file=sys.stderr,
        )

    if args.sandboxes_json:
        items = extract_list_items(load_json_path(args.sandboxes_json))
    else:
        api_key, org = load_daytona_creds()
        items = list_org_sandboxes(args.api_base, api_key, org)

    buckets = select_targets(
        items,
        keep_set,
        include_started_unbound=args.include_started_unbound,
        min_age_hours=args.min_age_hours,
    )
    print_plan(
        items,
        buckets,
        dry_run=dry_run,
        disk_cap=args.disk_cap_gib,
        keep_set=keep_set,
    )
    if dry_run:
        return 0

    api_key, org = load_daytona_creds()
    outcomes: dict[str, int] = {}
    hard_fail = 0
    for row in buckets["archive"]:
        outcome, status = archive_one(
            args.api_base,
            api_key,
            org,
            row,
            retry_wait_s=args.retry_wait_s,
        )
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
        print(
            " result",
            sandbox_id_of(row),
            outcome,
            "http",
            status,
        )
        if outcome == "failed":
            hard_fail += 1
        time.sleep(0.2)

    print("apply_outcomes", outcomes)
    after = list_org_sandboxes(args.api_base, api_key, org)
    after_states, _ = summarize_states(after)
    print("after_states", after_states)
    print("after_active_disk_GiB", active_disk_gib(after))
    if hard_fail:
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=(
            "List Daytona org sandboxes and archive unused ones. "
            "Keeps CP-bound sandbox_id. Dry-run default."
        )
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Actually stop/archive targets (default is dry-run)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicit dry-run (default). Ignored when --apply is set.",
    )
    ap.add_argument(
        "--keep-id",
        action="append",
        default=[],
        help="Bound sandbox_id to keep (repeatable)",
    )
    ap.add_argument(
        "--keep-ids-file",
        help="File of bound sandbox_ids (one per line, # comments ok)",
    )
    ap.add_argument(
        "--cp-instances-json",
        help="CP gateway-instances dump; sandbox_id values are kept",
    )
    ap.add_argument(
        "--tenant-id",
        action="append",
        default=[],
        help="Load keep-set from GET /tenants/{id}/gateway-instances (repeatable)",
    )
    ap.add_argument(
        "--cp-url",
        default="",
        help="Control Plane base URL (or CONTROL_PLANE_URL)",
    )
    ap.add_argument(
        "--sandboxes-json",
        help="Offline org sandbox list (no Daytona call)",
    )
    ap.add_argument(
        "--include-started-unbound",
        action="store_true",
        help="Also archive started sandboxes that are not in the keep-set",
    )
    ap.add_argument(
        "--allow-empty-keep-set",
        action="store_true",
        help="Permit --apply when no bound sandbox_id was loaded (dangerous)",
    )
    ap.add_argument(
        "--min-age-hours",
        type=float,
        default=0.0,
        help="Skip unbound boxes newer than this (0 = no age filter)",
    )
    ap.add_argument(
        "--disk-cap-gib",
        type=int,
        default=DISK_CAP_GIB_DEFAULT,
        help="Org disk cap used for headroom reporting (default 30)",
    )
    ap.add_argument(
        "--api-base",
        default=os.environ.get("DAYTONA_API_BASE", API_BASE_DEFAULT),
        help="Daytona API base (default https://app.daytona.io/api)",
    )
    ap.add_argument(
        "--retry-wait-s",
        type=float,
        default=2.0,
        help="Seconds to wait after stop before archive retry on 409",
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="Run offline unit checks and exit (no network)",
    )
    return ap


def self_test() -> int:
    now = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)
    bound = "bound-mocklab-sandbox"
    orphan_stopped = "orphan-stopped"
    orphan_started = "orphan-started"
    items = [
        {
            "id": bound,
            "state": "stopped",
            "disk": 3,
            "updatedAt": "2026-08-17T00:00:00Z",
        },
        {
            "id": orphan_stopped,
            "state": "stopped",
            "disk": 3,
            "updatedAt": "2026-08-16T00:00:00Z",
        },
        {
            "id": orphan_started,
            "state": "started",
            "disk": 3,
            "updatedAt": "2026-08-16T00:00:00Z",
        },
        {"id": "already-archived", "state": "archived", "disk": 3},
        {"id": "creating-box", "state": "creating", "disk": 3},
        {"state": "stopped", "disk": 1},
    ]
    keep = {bound}
    buckets = select_targets(items, keep, now=now)
    assert [sandbox_id_of(x) for x in buckets["keep"]] == [bound]
    archive_ids = {sandbox_id_of(x) for x in buckets["archive"]}
    assert archive_ids == {orphan_stopped}, archive_ids
    skip_reasons = {sandbox_id_of(x) or "-": x["_reason"] for x in buckets["skip"]}
    assert skip_reasons["already-archived"] == "terminal"
    assert skip_reasons["creating-box"] == "in_progress"
    assert skip_reasons[orphan_started] == "started_unbound"
    assert skip_reasons["-"] == "missing_id"

    started_included = select_targets(
        items, keep, include_started_unbound=True, now=now
    )
    assert {sandbox_id_of(x) for x in started_included["archive"]} == {
        orphan_stopped,
        orphan_started,
    }

    aged = select_targets(items, keep, min_age_hours=72, now=now)
    assert {sandbox_id_of(x) for x in aged["archive"]} == set()
    aged_ok = select_targets(items, keep, min_age_hours=24, now=now)
    assert {sandbox_id_of(x) for x in aged_ok["archive"]} == {orphan_stopped}

    dump = {
        "tenant_id": "t-mocklab",
        "instances": [
            {"instance_id": "i1", "sandbox_id": bound},
            {"instance_id": "i2", "sandbox_id": None},
            {"instance_id": "i3", "sandbox_id": "  "},
        ],
    }
    assert extract_bound_sandbox_ids(dump) == {bound}
    assert extract_bound_sandbox_ids({"sandbox_ids": [bound, "extra"]}) == {
        bound,
        "extra",
    }
    assert parse_keep_ids_file(f"# comment\n{bound}\n\n") == {bound}

    states, disk = summarize_states(items)
    assert states["stopped"] == 3
    assert disk["stopped"] == 7
    assert active_disk_gib(items) == 13

    assert classify_sandbox({"id": bound, "state": "started"}, keep) == (
        "keep",
        "bound_instance",
    )
    action, reason = classify_sandbox(
        {"id": "x", "state": "error"}, set()
    )
    assert (action, reason) == ("archive", "unbound")

    redacted = redact_text("Authorization: Bearer super-secret", ["super-secret"])
    assert "super-secret" not in redacted
    assert looks_like_secret_line("Authorization: Bearer abc")
    assert not looks_like_secret_line("keep bound-mocklab-sandbox state=stopped")

    # --apply without keep-set is refused (parser + run_job).
    parser = build_parser()
    refused = parser.parse_args(["--apply", "--sandboxes-json", "/dev/null"])
    # collect_keep_set empty + apply + no allow → exit 2, but /dev/null is not
    # json; call run_job only after constructing empty keep via allow check.
    refused.sandboxes_json = None
    refused.keep_id = []
    refused.keep_ids_file = None
    refused.cp_instances_json = None
    refused.tenant_id = []
    refused.cp_url = ""
    refused.allow_empty_keep_set = False
    rc = run_job(refused)
    assert rc == APPLY_REFUSED_EXIT, rc

    print("self-test ok")
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if args.self_test:
        return self_test()
    return run_job(args)


if __name__ == "__main__":
    sys.exit(main())
