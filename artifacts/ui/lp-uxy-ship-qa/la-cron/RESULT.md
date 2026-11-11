# lp-uxy.15.4 — LA cron jobs under Settings / Brain RPC

**Shipped feature:** lp-uxy.3
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T14:00:52.090545+00:00
**Verdict:** **PASS**

## Acceptance

- [x] login: logged in as dev@demo.local
- [x] brain-rpc-enabled: brain_rpc_enabled=True kind=lanyard_agent profile=admin
- [x] backend-kind-lanyard-agent: kind=lanyard_agent
- [x] brain-ping: status=200 pong=True instance=1555e820-2eba-4e83-80bd-a93f3ae09e7c
- [x] settings-snapshot-source-la: source=lanyard_agent backend_home=/home/operator/.lanyard-agent
- [x] backend-home-not-hermes-install: backend_home=/home/operator/.lanyard-agent hermes_home=/home/operator/.lanyard-agent
- [x] settings-snapshot-crons: status=200 count=3 ids=['la-vault-index', 'la-weekly-digest', 'la-manual-start'] paths=['cron/jobs.json', 'cron/jobs.json', 'cron/jobs.json']
- [x] cron-paths-la-layout: paths=['cron/jobs.json', 'cron/jobs.json', 'cron/jobs.json']
- [x] capabilities-honest-cron-baseline: features.cron=False cron_manager=unsupported settings_patch=True methods_include_settings.snapshot=True
- [x] settings-overview-la: overview mentions LA/crons; len=417
- [x] settings-crons-section-visible: Crons nav count=1
- [x] settings-crons-list-jobs: names_found=['LA vault index refresh', 'LA weekly digest', 'LA manual start example'] table_like=True snapshot_names=['LA vault index refresh', 'LA weekly digest', 'LA manual start example']
- [x] settings-crons-enable-toggles: switch/checkbox count=0 settings_patch=True
- [x] settings-cron-row-detail: opened first cron row

## Snapshot (API)

- source: `lanyard_agent`
- backend_home: `/home/operator/.lanyard-agent`
- hermes_home: `/home/operator/.lanyard-agent`
- crons count: 3
- cron ids: ['la-vault-index', 'la-weekly-digest', 'la-manual-start']

## Capabilities honesty

- features.cron: `False`
- cron_manager: `unsupported`
- settings_patch: `True`
- kind: `lanyard_agent`

Note: dedicated `features.cron` / `cron_manager` may remain false/unsupported
while Settings still lists `settings.snapshot.crons[]` (lp-uxy.3 honest baseline).

## Screenshots

- `01-post-login.png`
- `02-settings-overview.png`
- `03-settings-crons-list.png`
- `03-settings-crons-list.png`
- `04-settings-cron-detail.png`

## Fix bead

None (all checks green).

See `REPORT.json` for machine-readable results.
