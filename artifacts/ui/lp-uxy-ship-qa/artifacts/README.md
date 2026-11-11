# lp-uxy.15.3 — Subagent artifacts clickable index + harvest

**Verdict:** PASS
**Shipped:** lp-uxy.2
**Base:** `http://demo.localhost:3010`
**Route:** `?story=activity-plane&phase=artifacts`
**When:** 2026-08-05T13:46:30.224771+00:00

## Acceptance

- [x] Vault artifact openable from subagent activity detail
- [x] Nested-tool harvest when host omits `artifacts[]`
- [x] Final report has clickable citations for harvested paths
- [x] History reload keeps chips/citations openable
- [x] Web-only URLs use web chips (not vault pane)

## Screenshots

- `01-writer-a-detail-artifacts.png`
- `02-vault-chip-soft-open-findings.png`
- `03-web-chip-no-vault-pane.png`
- `04-writer-b-harvested-artifacts.png`
- `05-harvest-chip-soft-open-report.png`
- `06-final-report-citations.png`
- `07-final-citation-soft-open.png`
- `08-web-citation-no-vault-pane.png`
- `09-after-reload-chips-and-citations.png`
- `10-composite-artifacts-phase.png`

See `REPORT.json` for machine-readable pass/fail.
