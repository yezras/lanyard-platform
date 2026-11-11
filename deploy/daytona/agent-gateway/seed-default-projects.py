#!/usr/bin/env python3
"""Seed MockLab default agent project into $BACKEND_HOME/projects.db (lp-zuh.10.7).

Product defaults after vault seed (lp-zuh.9.5):
  - ≥1 project with primary_path under VAULT_ROOT (not ephemeral BACKEND_HOME/workspace)
  - Default: Workspace → /mnt/vault/Projects/Workspace

Idempotent:
  - If slug exists: ensure primary_path + primary folder match target (update if wrong)
  - If any active project exists but slug missing: still ensure Workspace row
  - Safe to run before gateway boot so LA seedDefaultProject (BACKEND_HOME/workspace)
    no-ops on a non-empty store

Reads optional JSON from --from-json / vault .seed/default-projects.json when present.
Does not write secrets. Does not call network.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path
from typing import Any


DEFAULT_NAME = "Workspace"
DEFAULT_SLUG = "workspace"
DEFAULT_PRIMARY = "/mnt/vault/Projects/Workspace"


def log(msg: str) -> None:
    print(f"[seed-default-projects] {msg}", file=sys.stderr)


def new_project_id() -> str:
    return f"p_{uuid.uuid4().hex[:8]}"


def now_sec() -> int:
    return int(time.time())


def resolve_projects(from_json: Path | None, vault_root: str) -> list[dict[str, Any]]:
    if from_json is not None and from_json.is_file():
        data = json.loads(from_json.read_text(encoding="utf-8"))
        projs = data.get("projects") or []
        if not isinstance(projs, list) or not projs:
            raise SystemExit(f"no projects[] in {from_json}")
        out: list[dict[str, Any]] = []
        for p in projs:
            if not isinstance(p, dict):
                continue
            name = str(p.get("name") or DEFAULT_NAME).strip() or DEFAULT_NAME
            slug = str(p.get("slug") or DEFAULT_SLUG).strip().lower() or DEFAULT_SLUG
            primary = str(p.get("primary_path") or "").strip()
            if not primary:
                folders = p.get("folders") or []
                if folders and isinstance(folders[0], dict):
                    primary = str(folders[0].get("path") or "").strip()
                elif folders and isinstance(folders[0], str):
                    primary = folders[0].strip()
            if not primary:
                primary = f"{vault_root.rstrip('/')}/Projects/Workspace"
            out.append({"name": name, "slug": slug, "primary_path": primary})
        if out:
            return out
    return [
        {
            "name": DEFAULT_NAME,
            "slug": DEFAULT_SLUG,
            "primary_path": DEFAULT_PRIMARY
            if vault_root.rstrip("/") == "/mnt/vault"
            else f"{vault_root.rstrip('/')}/Projects/Workspace",
        }
    ]


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT,
    icon          TEXT,
    color         TEXT,
    board_slug    TEXT,
    primary_path  TEXT,
    created_at    INTEGER NOT NULL,
    archived      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_folders (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    label       TEXT,
    is_primary  INTEGER NOT NULL DEFAULT 0,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_project_folders_path
    ON project_folders(path);
"""


def ensure_primary_dir(path: str, dry_run: bool) -> None:
    p = Path(path)
    if dry_run:
        log(f"dry-run mkdir -p {p}")
        return
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        log(f"WARN: could not mkdir {p}: {exc} (path still registered)")


def ensure_project(
    conn: sqlite3.Connection,
    *,
    name: str,
    slug: str,
    primary_path: str,
    dry_run: bool,
) -> str:
    """Return action: created | updated | ok."""
    cur = conn.execute(
        "SELECT id, primary_path, archived FROM projects WHERE slug = ?",
        (slug,),
    )
    row = cur.fetchone()
    ts = now_sec()

    if row is None:
        if dry_run:
            log(f"dry-run create: {name} ({slug}) → {primary_path}")
            return "created"
        pid = new_project_id()
        conn.execute(
            """
            INSERT INTO projects
              (id, slug, name, description, icon, color, board_slug,
               primary_path, created_at, archived)
            VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 0)
            """,
            (pid, slug, name, "MockLab default project (lp-zuh.10.7)", primary_path, ts),
        )
        conn.execute(
            """
            INSERT INTO project_folders
              (project_id, path, label, is_primary, added_at)
            VALUES (?, ?, NULL, 1, ?)
            """,
            (pid, primary_path, ts),
        )
        log(f"created: {name} ({slug}) id={pid} → {primary_path}")
        return "created"

    pid, existing_primary, archived = row[0], row[1], int(row[2] or 0)
    needs_update = (
        existing_primary != primary_path
        or archived != 0
    )
    # Check primary folder row
    fold = conn.execute(
        "SELECT path, is_primary FROM project_folders WHERE project_id = ? AND is_primary = 1",
        (pid,),
    ).fetchone()
    if fold is None or fold[0] != primary_path:
        needs_update = True

    if not needs_update:
        log(f"ok (exists): {slug} → {primary_path}")
        return "ok"

    if dry_run:
        log(
            f"dry-run update: {slug} primary_path {existing_primary!r} → {primary_path!r}"
        )
        return "updated"

    conn.execute(
        "UPDATE projects SET name = ?, primary_path = ?, archived = 0 WHERE id = ?",
        (name, primary_path, pid),
    )
    # Replace primary folder row(s)
    conn.execute("DELETE FROM project_folders WHERE project_id = ?", (pid,))
    conn.execute(
        """
        INSERT INTO project_folders
          (project_id, path, label, is_primary, added_at)
        VALUES (?, ?, NULL, 1, ?)
        """,
        (pid, primary_path, ts),
    )
    log(f"updated: {slug} id={pid} → {primary_path}")
    return "updated"


def seed(
    *,
    projects_db: Path,
    projects: list[dict[str, Any]],
    dry_run: bool,
    list_only: bool,
) -> int:
    if list_only:
        if not projects_db.is_file():
            log(f"projects.db missing: {projects_db}")
            print(json.dumps({"projects": [], "source": "none"}))
            return 0
        conn = sqlite3.connect(str(projects_db))
        try:
            rows = conn.execute(
                """
                SELECT id, slug, name, primary_path, archived
                FROM projects ORDER BY created_at ASC
                """
            ).fetchall()
            out = [
                {
                    "id": r[0],
                    "slug": r[1],
                    "name": r[2],
                    "primary_path": r[3],
                    "archived": bool(r[4]),
                }
                for r in rows
            ]
            print(json.dumps({"projects": out, "source": "projects_db"}, indent=2))
        finally:
            conn.close()
        return 0

    for p in projects:
        ensure_primary_dir(p["primary_path"], dry_run)

    if dry_run and not projects_db.is_file():
        log(f"dry-run would create {projects_db}")
        for p in projects:
            log(f"dry-run create: {p['name']} ({p['slug']}) → {p['primary_path']}")
        print(
            json.dumps(
                {
                    "result": "dry-run",
                    "projects_db": str(projects_db),
                    "projects": projects,
                },
                indent=2,
            )
        )
        return 0

    projects_db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(projects_db))
    try:
        conn.executescript(SCHEMA_SQL)
        actions: dict[str, str] = {}
        for p in projects:
            actions[p["slug"]] = ensure_project(
                conn,
                name=p["name"],
                slug=p["slug"],
                primary_path=p["primary_path"],
                dry_run=dry_run,
            )
        if not dry_run:
            conn.commit()
        # Summary list
        rows = conn.execute(
            """
            SELECT id, slug, name, primary_path
            FROM projects WHERE archived = 0 ORDER BY created_at ASC
            """
        ).fetchall()
        listed = [
            {
                "id": r[0],
                "slug": r[1],
                "name": r[2],
                "primary_path": r[3],
            }
            for r in rows
        ]
        print(
            json.dumps(
                {
                    "result": "ok",
                    "projects_db": str(projects_db),
                    "actions": actions,
                    "projects": listed,
                },
                indent=2,
            )
        )
    finally:
        conn.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backend-home",
        default=os.environ.get("BACKEND_HOME", "/var/lib/company-brain-backend"),
        help="Runtime home containing projects.db (default: $BACKEND_HOME)",
    )
    parser.add_argument(
        "--projects-db",
        default=None,
        help="Override path to projects.db (default: $BACKEND_HOME/projects.db)",
    )
    parser.add_argument(
        "--vault-root",
        default=os.environ.get("VAULT_ROOT", "/mnt/vault"),
        help="Vault root used when default-projects.json is absent",
    )
    parser.add_argument(
        "--from-json",
        default=None,
        help="Path to default-projects.json (optional)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions only",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="List projects in projects.db as JSON",
    )
    args = parser.parse_args(argv)

    backend_home = Path(args.backend_home).resolve()
    projects_db = (
        Path(args.projects_db).resolve()
        if args.projects_db
        else backend_home / "projects.db"
    )
    vault_root = args.vault_root.rstrip("/") or "/mnt/vault"

    from_json: Path | None = None
    if args.from_json:
        from_json = Path(args.from_json)
    else:
        # Prefer vault seed document when present
        candidate = Path(vault_root) / ".seed" / "default-projects.json"
        if candidate.is_file():
            from_json = candidate

    projects = resolve_projects(from_json, vault_root)
    if from_json is not None:
        log(f"using project defs from {from_json}")
    log(f"BACKEND_HOME={backend_home}")
    log(f"projects.db={projects_db}")
    log(f"VAULT_ROOT={vault_root}")

    return seed(
        projects_db=projects_db,
        projects=projects,
        dry_run=args.dry_run,
        list_only=args.list_only,
    )


if __name__ == "__main__":
    sys.exit(main())
