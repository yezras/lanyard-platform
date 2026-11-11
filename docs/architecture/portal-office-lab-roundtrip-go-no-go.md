# Lab go/no-go: ONLYOFFICE open / edit / save / callback

**Bead:** `lp-5q6.28`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Topology:** `lab-shared-compose-ds` ([ADR 0006](../adr/0006-document-server-topology-and-data-residency.md))  
**Runbook:** [lab-onlyoffice-document-server.md](../../deploy/references/runbooks/lab-onlyoffice-document-server.md)  
**Prove scripts:**
- Live (preferred): `deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh`
- Offline unit + mechanical: `deploy/scripts/prove-lab-onlyoffice-roundtrip.sh`

---

## Purpose

Exercise the **real integration path** Document Server uses against **fixture vault** storage:

1. Mint Office session + editor config JWT (path-based `/lab/api/…`)
2. **Document Server container** GETs signed download via `host.docker.internal`
3. **Browser DocsAPI** opens DOCX + XLSX (`onDocumentReady`) with screenshots
4. Callback status `2` writeback of bytes → **new revision** (live HTTP BFF)
5. Record callback status + latency without payload leaks
6. Failed callback → understandable user-facing pane error (wired into editor host)

This is the lab **go/no-go** before staging Document Server deploy (`lp-5q6.34`). Lab green is **not** production enablement (license `lp-5q6.7`, security `lp-5q6.9`/`lp-5q6.35`, contracts).

---

## Acceptance map

| Criterion | How proven |
|-----------|------------|
| DOCX opens **in editor** from BFF download URL | Playwright DocsAPI `onDocumentReady` + DS container `curl` of signed URL; screenshot `docx-editor-open.png` |
| DOCX edit → callback writes changed bytes | Live HTTP `POST /lab/api/office/callback` status `2` → `rev-live-*` write; offline vitest status-2 path |
| XLSX same path | Playwright XLSX open + DS download + live callback write |
| Callback status + latency recorded | `officeMetrics` + safe `office_callback` logs (`latency_ms`, `onlyoffice_status`) |
| Failed callback user-facing error | status `3` / `invalid_nonce` → `mapOfficeSaveFailureToUserError` / `mapSaveFailureToEditorError` in host; screenshot `failed-callback-user-error.png` |
| Evidence without body | `artifacts/lab/lp-5q6.28/` JSON + screenshots; no tokens/JWT/bodies |

---

## Commands

```bash
# LIVE Document Server + real HTTP BFF + browser (preferred go/no-go)
bash deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh

# Offline mechanical (vitest + user-error mapping; no Docker required)
bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh

# Manual live BFF
pnpm --filter @lanyard/bff exec tsx scripts/lab-onlyoffice-live-server.mts
# then open http://127.0.0.1:4100/lab/editor?type=docx
```

---

## Go / no-go

| Verdict | When |
|---------|------|
| **GO** | Live prove exit 0; DS container download 200; DocsAPI screenshots; status-2 revision write; failed path has user copy; no body/token in evidence |
| **NO-GO** | DS cannot reach BFF, DocsAPI never reaches `onDocumentReady`, callback auth flaky, SSRF allowlist blocks lab DS host, or body/secret leakage in logs |

**On NO-GO:** stop before `lp-5q6.34` staging topology work; file a bug with evidence JSON and safe logs only.

---

## Still blocked after GO

- Customer-facing production Office edit (license free-track)  
- Staging platform Document Server (`lp-5q6.34`)  
- Production vault writeback path beyond fixture lab writer  

---

## Related code

| Path | Role |
|------|------|
| `portal/packages/bff/src/office/*` | Session, download, callback, mint, metrics |
| `portal/packages/bff/scripts/lab-onlyoffice-live-server.mts` | Live HTTP lab BFF + DocsAPI host page |
| `portal/packages/bff/test/office-lab-roundtrip.integration.test.ts` | Mechanical HTTP round-trip |
| `portal/packages/web/src/features/chat/documentPane/OnlyOfficeEditorHost.tsx` | DocsAPI host + save-error wiring |
| `portal/packages/web/src/features/chat/documentPane/officeSaveUserErrors.ts` | User-facing save errors |
| `portal/packages/web/ui-testing/test_onlyoffice_live_roundtrip.py` | Playwright live open screenshots |
| `deploy/dev/lab-shared-compose-ds/` | Lab Document Server compose |
| `docs/architecture/portal-office-observability.md` | Metric / log catalog |
