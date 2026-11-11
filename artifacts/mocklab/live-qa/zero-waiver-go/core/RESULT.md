# lp-zuh.11.2 — Playwright zero-waiver matrix (core)

**Parent:** `lp-zuh.11`  
**When (UTC):** 2026-08-14T22:57:59Z → 2026-08-14T22:59:39Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Tenant:** `7d451eb7-c4c6-4a9d-a361-c6391622d036`  
**Instance:** `452b1348-772a-49d0-8038-a410eda8accf`  
**Sandbox (guest):** `c5306e38-fe05-445d-9ec0-ba3b3f7d94fd`  
**Snapshot:** `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814`  
**Marker:** `lp-zuh.11.2-zw-20260814T225759Z`  
**Thread:** `3dcd3c85-f974-4865-9388-b53122f145fd`  
**Overall verdict:** **GO**  

Zero-waiver package: **no `PARTIAL_WAIVED`** for core surfaces below.  
OnlyOffice / MemPalace / MCP are owned by sibling beads (`lp-zuh.11.3`–`.11.5`).

## Matrix (must be GO)

| # | Surface | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | **shell_auth** | **GO** | login + Agents/Vault/Tools nav |
| 2 | **vault_tree_write** | **GO** | {"api_nonempty": true, "guest_write": true, "bash_mnt": true} |
| 3 | **projects_primary_path** | **GO** | {"api_primary_path": "/mnt/vault/Projects/Workspace", "api_under_vault": true, "guest_under_vault": true, "directory_ui": true} |
| 4 | **tools_web_search** | **GO** | {"ok": true, "bash_ok": 1, "web_ok": 1, "web_err": 0, "fetch_failed": false, "mnt_vault": true, "marker_in_final": true, "event_count": 10} |
| 5 | **subagents** | **GO** | {"ok": true, "spawn_ok": 1, "spawn_err": 0, "spawn_running": 1, "spawn_attempted": 2, "spawn_last_status": "complete", "chip_count": 1, "chip_ids": ["dither-avatar-sa-89f8565d-293b |
| 6 | **workflows_launch_durable** | **GO** | {"ok": true, "launch_ok": true, "ui_hit": true, "card_count": 1, "workflow_ids": ["wf_80ac44d36ec5f758"], "guest_new_wf": true, "guest_post_ids_sample": ["wf_201a8d6b422d6a9c", "wf |
| 7 | **cron_ui_durable** | **GO** | {"ui": {"ok": true, "clicked": true, "label_visible": true, "snip": "Skip to content / Lanyard Portal / Agents / Vault / Tools / A / agent-dev@mocklab.example.com / Workspace / |

## Acceptance mapping

| Acceptance | Result |
|------------|--------|
| shell auth | GO |
| vault tree non-empty + write | GO |
| projects primary_path under `/mnt/vault` (API + Directory) | GO |
| tools / web_search | GO |
| sub-agents chips | GO |
| workflows launch + durable state path | GO |
| cron UI + durable jobs path | GO |

## Guest durable probes

- attempted: `True`
- sandbox: `c5306e38-fe05-445d-9ec0-ba3b3f7d94fd` state=`started`
- snapshot: `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814`
- writable_vault: `True`
- projects_primary_under_vault: `True`
- vault_write: `True`
- workflow_state_dir_vault: `True`
- workflow_mkdir: `True`
- cron_state_dir_vault: `True`
- cron_jobs_json: `True`
- hybrid_residual: `False`

## Chat proof

- thread_id: `3dcd3c85-f974-4865-9388-b53122f145fd`
- marker: `lp-zuh.11.2-zw-20260814T225759Z`
- analysis: `{"tool_events": [{"name": "bash", "status": "running", "preview": "pwd; ls /mnt/vault | head -10"}, {"name": "web_search", "status": "running", "preview": "NVIDIA H100 rack power kW 2024"}, {"name": "bash", "status": "complete", "preview": "Finished bash"}, {"name": "web_search", "status": "complete", "preview": "Finished web_search"}, {"name": "spawn_subagent", "status": "running", "preview": "lp-zuh.11.2 zero-waiver lp-zuh.11.2-zw-20260814T225759Z"}, {"name": "spawn_subagent", "status": "complete", "preview": "Finished spawn_subagent"}], "bash_ok": 1, "web_ok": 1, "web_err": 0, "fetch_failed`

## Screenshots

- `screenshots/01-auth-home.png`
- `screenshots/02-agents-shell.png`
- `screenshots/03-vault-browser.png`
- `screenshots/04-vault-tree-expanded.png`
- `screenshots/05-vault-entry-open.png`
- `screenshots/06-agents-projects.png`
- `screenshots/07-tools-overview.png`
- `screenshots/08-tools-workflows.png`
- `screenshots/09-scheduled-tasks.png`
- `screenshots/10-thread-ready.png`
- `screenshots/11-prompt-sent.png`
- `screenshots/12-after-turn.png`
- `screenshots/13-subagents-surface.png`
- `screenshots/14-workflow-launch.png`
- `screenshots/15-final.png`

## Logs

- `logs/guest-*.txt`
- `logs/history-sanitized.json`
- `logs/api-projects.json`
- `REPORT.json`

## Method

1. Daytona guest toolbox probes (mount, projects.db, vault write, cron/workflow state_dir).
2. Playwright headless Chromium against MockLab (`MOCKLAB_*` credentials).
3. Chat A: bash vault listing + web_search. Chat B: **mandatory** spawn_subagent (complete/success or sa-* chip / SUBAGENT_OK — not error/running-only).
4. Workflow slash `/workflow run research-lite`; require launch proof (`chat-workflow-run-card` | `Launched workflow` | non-user `wf_*` | new guest dir) + durable `state_dir` (not user-message string match alone).
5. Cron Scheduled Tasks UI + guest `cron.state_dir` / `jobs.json`.

## Review gates (anti false-GO)

- Subagents: ignore user text; `spawn_ok` only on terminal complete/success; chips must be `dither-avatar-sa-*` / `chat-subagent-*`.
- Workflows: ignore user slash text; require real admit signal + durable path; Tools→Workflows nav alone is not launch proof.

## Secret hygiene

- No passwords, cookies, JWT, SM payloads, AWS keys, or Relay secrets in this package.

## Re-run

```bash
source /path/to/daytona_env.sh   # DAYTONA_API_KEY + DAYTONA_ORG_ID
set -a; source .env.mocklab-agent-dev; set +a
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python artifacts/mocklab/live-qa/zero-waiver-go/core/run_zero_waiver_core_matrix.py
```
