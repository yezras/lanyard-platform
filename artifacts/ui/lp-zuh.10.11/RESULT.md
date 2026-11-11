# lp-zuh.10.11 — Fix UI QA for lp-zuh.10.10 (portal ensure_online after secret-material rotate)

**Base URL:** `https://app.withlanyard.com/mocklab`
**Login:** `agent-dev@mocklab.example.com`
**passed:** `True`
**durable_state_visible:** `True`
**proof_run_id:** `wf_4e8440b25d42613a`
**proof_run_visible:** `True`
**enosys_hit:** `False`
**gateway_wake:** `True`
**When:** 2026-08-14T20:25:19.946521+00:00


## Root cause (fixed)

CP force-new-deployment for the `lp-zuh.10.10` snapshot pin wiped ephemeral
`INSTANCE_SECRET_MATERIAL_PATH` (`/tmp/...`). Cold create then failed with
missing secret material (502 ENSURE_ONLINE_WAKE_FAILED). Ops **rotate** re-seeded
material; ensure_online cold-created sandbox `8bb6fc44-…` on pin `efa7c007`.
Evidence: `artifacts/mocklab/live-qa/lp-zuh.10.11/EVIDENCE.md`.

## Scope

CLI SOE already proved stock vault admit without hot-patch (snapshot pin).
This UI residual re-verifies MockLab portal ensure_online: BFF wake,
Vault visibility of stock `wf_4e8440b25d42613a`, Tools → Workflows, and Agents
slash `/workflow run research-lite` (must not hit ENOSYS rename failure).

## Checks

- [x] `login` — {"ok": true, "url": "https://app.withlanyard.com/mocklab/", "email": "agent-dev@mocklab.example.com"}
- [x] `nav_agents_vault_tools` — {"ok": true, "agents": 1, "vault": 1, "tools": 1}
- [x] `vault_pre_wake` — {"ok": true, "need_wake": false, "name_count": 100, "wf_runs": ["wf_4e8440b25d42613a", "/wf_4e8440b25d42613a", "/wf_4e8440b25d42613a/args.json", "/wf_4e8440b25d42613a/journal.jsonl", "/wf_4e8440b25d42613a/program.json", "/wf_4e8440b25d42613
- [x] `gateway_wake` — {"ok": true, "gateway_up": true, "thread_id": null, "send": null, "poll_count": 0}
- [x] `api_vault_tree` — {"ok": true, "name_count": 100, "names_sample": ["cron", "/cron", "output", "/cron/output", "09b7330db248", "/cron/output/09b7330db248", "20260814T171330Z.md", "/cron/output/09b7330db248/20260814T171330Z.md", "jobs.json", "/cron/jobs.json",
- [x] `api_context` — {"ok": true, "status": 200}
- [x] `api_settings` — {"ok": true, "status": 200, "mentions_workflow": true}
- [x] `vault_ui` — {"ok": true, "seed_ui": ["AGENTS.md", "Projects", "skills", "workflows", "cron", "INDEX.md"], "empty_banner": false, "wf_in_body": true, "workflows_label": true}
- [x] `vault_tree_expand` — {"ok": true, "expanded": ["workflows", "Projects", "skills", "cron", "Workspace"], "wf_in_body": true, "proof_run_ui": true}
- [x] `vault_wf_run_open` — {"ok": true, "opened_run": true, "state_files_ui": ["program.json", "args.json", "state.json", "journal.jsonl"], "body_snip": "Skip to content | Lanyard Portal | Agents | Vault | Tools | A | agent-dev@mocklab.example.com | Search | cron
- [x] `vault_wf_file_open` — {"ok": true, "opened": true, "snip": "Skip to content | Lanyard Portal | Agents | Vault | Tools | A | agent-dev@mocklab.example.com | Search | cron | Knowledge | lp-kng67-demo | mempalace | Projects | skills | wf_4e8440b25d42613a | args
- [x] `tools_nav` — {"ok": true, "nav": ["Skills", "Workflows", "MCP", "Models", "Integrations"]}
- [x] `tools_workflows` — {"ok": true, "clicked": true, "gateway_down": false, "agent_failed": false, "research_lite": false, "snip": "Skip to content | Lanyard Portal | Agents | Vault | Tools | A | agent-dev@mocklab.example.com | Skills | Workflows | MCP | Mode
- [x] `chat_composer` — {"ok": true, "note": null}
- [x] `portal_ensure_online_chat` — {"ok": true, "sent": true, "card_count": 1, "launched_or_wf_signal": true, "ensure_online_signal": true, "enosys_hit": false, "agent_failed": false, "thread_id": "5b79104a-d5e2-4ee7-b31f-abaad96170bf", "response_snip": "workflow_card_visibl
- [x] `api_vault_tree_after` — {"ok": true, "wf_runs": ["wf_201a8d6b422d6a9c", "/wf_201a8d6b422d6a9c", "/wf_201a8d6b422d6a9c/scratch", "/wf_201a8d6b422d6a9c/args.json", "/wf_201a8d6b422d6a9c/journal.jsonl", "/wf_201a8d6b422d6a9c/program.json", "/wf_201a8d6b422d6a9c/state
- [x] `durable_state_visible` — {"ok": true, "note": "stock proof wf_4e8440b25d42613a and/or other wf_* / seed via vault API/UI", "proof_run_id": "wf_4e8440b25d42613a"}
- [x] `stock_proof_run_visible` — {"ok": true, "proof_run_id": "wf_4e8440b25d42613a", "strict_proof_hit": true}

## Screenshots

- `01-auth-home.png`
- `02-agents-shell.png`
- `04-vault-browser.png`
- `05-vault-tree-expanded.png`
- `06-vault-wf-run-or-root.png`
- `07-vault-wf-file-or-tree.png`
- `08-tools-overview.png`
- `09-tools-workflows.png`
- `10-agents-chat.png`
- `11-composer-slash-api-sent.png`
- `11b-composer-slash-filled.png`
- `12-after-slash-workflow.png`
- `13-final-vault.png`

## Wake

```json
{
  "gateway_up": true,
  "skipped": "vault already had roots"
}
```

## Waivers / residuals

- Journal append EPERM residual (optional, non-blocking for admit durability)
- Full research-lite multi-agent success out of scope
- Portal card for CLI-launched stock run optional

## Errors

- (none)
