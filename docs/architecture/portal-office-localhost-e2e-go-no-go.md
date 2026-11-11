# Portal Office — localhost mocklab E2E go/no-go (lp-5q6.38)

**Status:** environment of record = **localhost** (mocklab-on-local + `lab-shared-compose-ds`)  
**Not in scope:** AWS staging, production customer Office edit, paid Developer Single/Cluster

## Product chain under test

1. Local user opens a chat thread (story / pane beside chat).
2. Agent or fixture creates/updates a DOCX and emits progress/artifact events.
3. Chat document pane opens/updates for that artifact.
4. Pane refreshes to the new revision after write (`openGeneration` / new `document_key`).
5. **Human edits through ONLYOFFICE (lab Document Server)** and the save callback writes vault.
6. Reload/reopen proves bytes from **vault**, not Document Server cache.
7. Evidence: sanitized screenshots + request/revision IDs; **no secrets**.

## Hard requirement (steps 5–6)

Human save **must** go through real DocsAPI + lab Document Server assemble:

- Open `e2e-proof.docx` via DocsAPI (`/lab/editor?type=e2e`).
- Edit (connector / keyboard).
- **Command Service forcesave** (JWT signed by lab BFF; secret never in evidence).
- Document Server posts callback status `2` or `6` with an assemble URL on a **DS host/path**.
- Lab BFF fetches assembled bytes from DS (not from `/lab/fixtures/*`).
- `write_observed=true` and `assembled_fetch_source=document_server`.

**Rejected residual (do not ship as GO):** synthetic `curl` status-2 against lab BFF with `human-edited.docx` fixture URL. That path never has DS assemble the human-edited bytes.

## How to run

```bash
# Repo root — requires Docker Document Server (lab compose) + pnpm portal deps
bash deploy/scripts/prove-localhost-office-e2e.sh
```

Evidence lands under `artifacts/localhost/lp-5q6.38/` (git-friendly JSON + screenshots; no JWT/bodies/full session ids).

Offline-only residual:

```bash
REQUIRE_LIVE=0 bash deploy/scripts/prove-localhost-office-e2e.sh
```

Offline alone is **not** FULL PRODUCT GO.

## Explicit non-claims

- Does **not** authorize AWS staging Office edit.
- Does **not** authorize production customer Office edit.
- Does **not** claim `live_office_api_deployed` on `app.withlanyard.com`.

## Related

- Lab DS runbook: [lab-onlyoffice-document-server.md](../../deploy/references/runbooks/lab-onlyoffice-document-server.md)
- Portal proof notes: [portal/docs/localhost-office-e2e-proof.md](../../portal/docs/localhost-office-e2e-proof.md)
- Live lab roundtrip (lp-5q6.28): `deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh`
