# lp-uxy.15.12 — Brain RPC host ops (projects/settings/vault) via LA

**Shipped feature:** brain-rpc + LA gateway
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T14:35:02.871403+00:00
**Verdict:** **PASS**

## Acceptance

- [x] login: logged in as dev@demo.local
- [x] brain-rpc-enabled: brain_rpc_enabled=True kind=lanyard_agent profile=admin capabilities_source=brain_rpc
- [x] backend-kind-lanyard-agent: kind=lanyard_agent
- [x] brain-ping: status=200 pong=True instance=1555e820-2eba-4e83-80bd-a93f3ae09e7c
- [x] brain-health-honest: status=404 unknown_or_error_expected=True ok_200=False body_snip='{"error": "unknown method brain.health"}'
- [x] projects-list-api: status=200 count=8 names=['Workspace', 'Clients', 'demo', 'legal_work', 'QaBugWd24645', 'FixWd25140', 'k', 'dmeo']
- [x] capabilities-projects-list: projects.list in methods=True features.projects_list=True
- [x] settings-snapshot-api: status=200 source=lanyard_agent backend_home=/home/operator/.lanyard-agent crons=3
- [x] capabilities-settings-snapshot: settings.snapshot in methods=True features.settings_snapshot=True
- [x] vault-tree-api: status=200 root_count=21 names=['__pycache__', 'Archive', 'Business', 'Clients', 'dev', 'Education', 'lp-uxy-15-6-soft-archive-qa', 'Relationships', 'skills', '_count_sessions.py', 'Acme_Ops_Q1_Fake_Stats.xlsx', 'AGENTS.md']
- [x] vault-entries-api: path=/__pycache__ status=200 count=0 names=[]
- [x] directory-ui-projects: dir_chrome=True names_visible=['Workspace', 'Clients', 'demo', 'legal_work', 'QaBugWd24645', 'FixWd25140', 'k', 'dmeo'] api_count=8
- [x] settings-ui-snapshot: settings_ui_ok=True la_hint=True source=lanyard_agent len=417
- [x] vault-ui-browser: vault_ui_ok=True api_ok=True root_names=['__pycache__', 'Archive', 'Business', 'Clients', 'dev', 'Education', 'lp-uxy-15-6-soft-archive-qa', 'Relationships'] body_snip='Skip to content\nLanyard Portal\nChat\nVault\nSettings\nD\ndev@demo.local\nSearch\n__pycache__\nArchive\nBusiness\nClients\ndev\nEducation\nlp-uxy-15-6-soft-archive-qa\nRelationships\nskills\n_coun'
- [x] vault-ui-open-entry: opened first treeitem

## API summary

- brain_rpc_enabled: `True`
- backend kind: `lanyard_agent`
- hermes_profile: `admin`
- brain.ping: `{'ok': True, 'status': 200, 'pong': True, 'instance_id': '1555e820-2eba-4e83-80bd-a93f3ae09e7c'}`
- brain.health: `{'status': 404, 'unknown_expected': True, 'ok_200': False, 'body_snip': '{"error": "unknown method brain.health"}'}` (unknown method expected: `True`)
- projects count: `8`
- settings source: `lanyard_agent`
- vault tree roots: `21`

## Screenshots

- `01-post-login.png`
- `02-directory-projects.png`
- `03-settings-snapshot.png`
- `04-vault-browser.png`
- `05-vault-entry.png`

## Fix bead

None (all required checks green).

See `REPORT.json` for machine-readable results.
