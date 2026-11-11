# lp-zuh.12.1 — Web VITE_ONLYOFFICE_* MockLab staging bake

**Bead:** `lp-zuh.12.1`  
**When (UTC):** 2026-08-18T02:08Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **GO_WEB_FLAG_BAKE** / **HTTPS_DS_RESIDUAL** (DocsAPI host waits on `lp-zuh.12.2`)

No secrets in this package (no JWT, passwords, session tokens).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `VITE_ONLYOFFICE_EDITOR=true` in staging/mocklab web pin | **GO** — pin `v0.1.6-mocklab-oo-zuh121-20260818`; origin `build.env` + live JS `VITE_ONLYOFFICE_EDITOR:"true"` |
| 2 | `VITE_ONLYOFFICE_DS_URL` points at staging DS (HTTPS preferred) | **GO bake** — HTTPS form of staging docs ALB host baked; **HTTP ALB residual** (no `:443`) |
| 3 | `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS` includes DS + `app.withlanyard.com` | **GO** — both origins in bake / live env object |
| 4 | Deployed web static shows feature flag on | **GO** — CF invalidation `IEW5DOM9USC2G6R6K62OSGFIPP`; live `/assets/index-DzazbXcP.js` |
| 5 | Evidence: build notes + screenshot (no secrets) | This package + `screenshots/01-flag-on-bake.png` |

---

## Pin coordinates (non-secret)

```text
portal.web.version=v0.1.6-mocklab-oo-zuh121-20260818
portal.web.sha256=5ebde183538f771a8efc8687a3dbe147c09d2293672fffa8168286bcb4cabf33
portal.web.url=s3://$ARTIFACT_BUCKET/portal-web/v0.1.6-mocklab-oo-zuh121-20260818/portal-web.tar.gz
```

Origin `build.env`: `logs/origin-build.env`  
Live JS analysis: `logs/spa-vite-bake-live.json`

## Recipe in repo

- `portal/scripts/pack-web-mocklab-oo.env.example`
- `portal/scripts/pack-web-mocklab-oo.sh`
- Static `import.meta.env.VITE_ONLYOFFICE_*` reads in `onlyOfficeFeatureFlag.ts`
- Optional CI inputs on `release-static-web.yml`

## Residuals (honest)

1. **`https_ds_residual`** — Staging Document Server ALB is HTTP-only (`api.js` 200 on `:80`). Prod SPA requires HTTPS. Sibling **`lp-zuh.12.2`**.
2. **DocsAPI editor host GO** — **not claimed** until HTTPS DS + vault docx mint 201 (`lp-zuh.12.3`+).
3. Private `terraform.tfvars` `static_web_artifact_*` should be bumped by operator to this pin (not committed).

## Screenshots

- `screenshots/01-flag-on-bake.png` — flag-on bake evidence card
- `screenshots/flag-on-evidence.html` — source card (also encodes `__LANYARD_FEATURE_FLAGS__.onlyoffice_editor=true` for runtime equivalence)
