# lp-uxy.15.4 — LA cron jobs visible under Settings / Brain RPC

**Verdict:** PASS  
**Shipped:** lp-uxy.3  
**Base:** `http://demo.localhost:3010`  
**Login:** `dev@demo.local` / `local-dev-password`  
**When:** 2026-08-05

## Acceptance

- [x] Brain RPC enabled; backend kind=`lanyard_agent`
- [x] `GET /api/settings/snapshot` source=`lanyard_agent`, `backend_home` under LA home (not Hermes install)
- [x] Snapshot `crons[]` lists product jobs (`cron/jobs.json`)
- [x] Settings → Crons UI shows the three LA jobs with enable/disable state

## Screenshots

- `01-post-login.png`
- `02-settings-overview.png`
- `03-settings-crons-list.png`
- `04-settings-cron-detail.png`

## Test

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/la-cron
pytest -v portal/packages/web/ui-testing/test_lp_uxy_15_4_la_cron_settings.py
```

See `RESULT.md` / `REPORT.json` / `PASS_FAIL.md`. No fix bead (all checks green).
