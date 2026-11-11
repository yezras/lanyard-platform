#!/usr/bin/env python3
"""Prove MockLab kitchen-sink config.yaml + BACKEND_HOME inventory (lp-oop.38.18).

Reads the real seed document (not a proxy). Exit 0 when:
  - config.yaml has subagents.enabled, mempalace.enabled, workflow.enabled,
    tools.catalog_search.enabled, cron.enabled, and skills.disabled: []
  - BACKEND_HOME (or --config parent) has at least one SKILL.md and one
    workflow definition so a harness snapshot would not be an empty fixture
  - no lanyard-agent/ tree under the home

Usage:
  python3 check-mocklab-kitchen-sink-config.py --config PATH
  python3 check-mocklab-kitchen-sink-config.py --home BACKEND_HOME
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def block_enabled(text: str, key: str) -> bool:
    pattern = rf"(?m)^{re.escape(key)}:\n(?:[ \t].*\n)*?[ \t]+enabled:\s*true\s*$"
    return re.search(pattern, text) is not None


def nested_enabled(text: str, parent: str, child: str) -> bool:
    pattern = (
        rf"(?m)^{re.escape(parent)}:\n(?:[ \t].*\n)*?"
        rf"[ \t]+{re.escape(child)}:\n(?:[ \t].*\n)*?[ \t]+enabled:\s*true\s*$"
    )
    return re.search(pattern, text) is not None


def skills_disabled_empty(text: str) -> bool:
    return bool(re.search(r"(?m)^skills:\n(?:[ \t].*\n)*?[ \t]+disabled:\s*\[\s*\]\s*$", text))


def collect_skills(home: Path) -> list[str]:
    skills: list[str] = []
    root = home / "skills"
    if not root.is_dir():
        return skills
    for skill_md in sorted(root.rglob("SKILL.md")):
        skills.append(str(skill_md.relative_to(home)))
    return skills


def collect_workflows(home: Path) -> list[str]:
    out: list[str] = []
    for rel in (Path(".lanyard") / "workflows", Path("workflows")):
        d = home / rel
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if not p.is_file() or p.name.startswith("."):
                continue
            if p.name.upper() == "README.MD":
                continue
            if p.suffix.lower() in {".yaml", ".yml", ".json", ".md"} or p.suffix == "":
                out.append(str(p.relative_to(home)))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, help="Path to config.yaml")
    parser.add_argument("--home", type=Path, help="BACKEND_HOME (implies --config HOME/config.yaml)")
    parser.add_argument("--json", action="store_true", help="Print snapshot-shaped JSON")
    args = parser.parse_args()

    if args.home:
        home = args.home.resolve()
        config = home / "config.yaml"
    elif args.config:
        config = args.config.resolve()
        home = config.parent
    else:
        fail("provide --config or --home")

    if not config.is_file():
        fail(f"missing config.yaml: {config}")

    text = config.read_text(encoding="utf-8")
    if "api_key:" in text.lower() or re.search(r"(?i)(sk-|AKIA)[A-Za-z0-9]", text):
        fail("config.yaml looks like it contains a secret")

    for key in ("subagents", "mempalace", "workflow", "cron"):
        if not block_enabled(text, key):
            fail(f"{key}.enabled: true missing in {config}")
    if not nested_enabled(text, "tools", "catalog_search"):
        fail("tools.catalog_search.enabled: true missing")
    if not skills_disabled_empty(text):
        fail("skills.disabled: [] missing")

    lanyard_agent = home / "lanyard-agent"
    if lanyard_agent.exists():
        fail(f"guest/harness home must not contain lanyard-agent tree: {lanyard_agent}")

    skills = collect_skills(home)
    workflows = collect_workflows(home)
    if not skills:
        fail(f"no SKILL.md under {home}/skills (snapshot would be empty)")
    if not workflows:
        fail(f"no workflow definition under {home}/workflows (snapshot would be empty)")

    snapshot = {
        "source": "harness",
        "backend_home": str(home),
        "skills": [{"id": Path(p).parent.name, "path": p, "enabled": True} for p in skills],
        "workflows": [
            {"id": Path(p).stem, "path": p, "enabled": True} for p in workflows
        ],
        "mcp_servers": [],
        "models": [{"provider": "poolside", "model": "laguna-s-2.1", "is_active": True}]
        if "default_model:" in text
        else [],
        "flags": {
            "subagents.enabled": True,
            "mempalace.enabled": True,
            "workflow.enabled": True,
            "cron.enabled": True,
            "tools.catalog_search.enabled": True,
            "skills.disabled": [],
        },
    }
    if args.json:
        json.dump(snapshot, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        print(
            "OK: kitchen-sink "
            f"skills={len(skills)} workflows={len(workflows)} "
            f"source={snapshot['source']}"
        )


if __name__ == "__main__":
    main()
