# Runbook: lab ONLYOFFICE Document Server (`lab-shared-compose-ds`)

**Status:** Lab operator procedure — **not** production, **not** staging Terraform  
**Bead:** `lp-5q6.25`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Topology name:** `lab-shared-compose-ds` ([ADR 0006](../../../docs/adr/0006-document-server-topology-and-data-residency.md), [topology detail](../../../docs/architecture/portal-document-server-topology.md))  
**Compose tree:** `deploy/dev/lab-shared-compose-ds/`  
**Offline smoke:** `bash scripts/smoke-lab-onlyoffice-compose.sh`

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Starts Document Server with **JWT enabled** and a **known lab secret** | Yes |
| Local browser can load **`api.js`** | Yes (after healthy start) |
| DS can reach lab BFF download/callback URLs | Yes, via `host.docker.internal` + documented absolute URLs |
| Production / customer vault on this DS | **Forbidden** |
| Production enablement / paid license | **Still blocked** (free-track license `lp-5q6.7` + security) |
| Replaces BFF Office routes / pane host work | **No** — those are `lp-5q6.21`–`.28` / `.27` |
| Staging platform DS | `lp-5q6.34` — [staging-document-server.md](staging-document-server.md) (`staging-platform-shared-ds`) |

Lab green proves integration **mechanics and latency** only. It does not authorize staging or production Document Server ship.

---

## Purpose

Provide the local operational path for the Office spike:

1. Browser loads Docs API from lab Document Server (`api.js`).
2. BFF (when wired) mints JWT-signed editor config using the **same** lab JWT secret.
3. Document Server **HTTP GETs** BFF signed download URLs and **HTTP POSTs** BFF callbacks.
4. Fixture / local vault only — never production tenant data.

Hard boundary: Document Server talks **only** to Portal BFF Office HTTP endpoints for storage. No Brain RPC, no direct `VAULT_ROOT`, no relay.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Docker Engine + Compose v2 | `docker compose version` |
| Free disk for image + volumes | See [Resources](#resources-cpu-ram-disk) |
| Optional: local Portal BFF on host | Default lab BFF port `4000` (`portal/docker-compose.yml`) |
| Optional: browser on same machine | For manual `api.js` check |

Pull once (large image; network required):

```bash
docker pull onlyoffice/documentserver:latest
```

---

## Resources (CPU, RAM, disk)

| Resource | Lab minimum | Recommended for edit/convert smoke | Notes |
|----------|-------------|--------------------------------------|--------|
| **CPU** | 2 cores | 2–4 cores | Soft limit `DS_CPUS` (default `2.0`) |
| **RAM** | 2 GiB | **4 GiB** | Soft limit `DS_MEMORY` (default `4G`); conversion OOMs if under-provisioned |
| **Disk (image)** | ~3–4 GiB | — | `onlyoffice/documentserver` layers |
| **Disk (volumes)** | 1 GiB free | 5–10 GiB free | Cache, logs, embedded DB under named volumes |
| **Host ports** | 1 TCP | Default **8080** → container 80 | Loopback bind by default |

Compose soft limits live under `deploy.resources` in `docker-compose.yml`. Some Compose engines ignore `deploy.resources` outside Swarm; treat them as documented intent and size the host accordingly.

---

## Ports

| Direction | Address | Purpose |
|-----------|---------|---------|
| Browser → DS | `http://127.0.0.1:8080` (default) | Editor UI + `api.js` |
| Container internal | `80` | Document Server HTTP |
| DS → host BFF | `http://host.docker.internal:4000` (typical) | Signed download GET + callback POST |
| Browser → BFF | `http://127.0.0.1:4000` (typical) | Portal API (not the same hostname DS uses) |

Change host port via `DS_HOST_PORT` in `.env`. Keep `DS_HOST_BIND=127.0.0.1` unless you intentionally expose lab DS on a private lab network (still never production vault).

---

## Environment variables

Copy the example file; **do not commit** `.env`.

```bash
cd deploy/dev/lab-shared-compose-ds
cp .env.example .env
# edit JWT_SECRET if you share a lab host with others
```

| Variable | Required | Default / example | Role |
|----------|----------|-------------------|------|
| `JWT_ENABLED` | Yes | `true` | Must stay enabled for lab JWT proof |
| `JWT_SECRET` | Yes | `lab-jwt-secret-placeholder` | Shared with BFF config signer; **lab-only** |
| `JWT_HEADER` | No | `Authorization` | Header DS expects for tokens |
| `JWT_IN_BODY` | No | `true` | Token in body for browser/editor payloads |
| `DS_HOST_BIND` | No | `127.0.0.1` | Host interface for published port |
| `DS_HOST_PORT` | No | `8080` | Host port for browser access |
| `ONLYOFFICE_DS_TAG` | No | `latest` | Image tag pin |
| `DS_CPUS` / `DS_MEMORY` | No | `2.0` / `4G` | Soft resource caps |
| `ALLOW_PRIVATE_IP_ADDRESS` | No | `true` | Permit DS to fetch private-range BFF URLs |
| `ALLOW_META_IP_ADDRESS` | No | `true` | Permit link-local/meta ranges used by lab gateways |
| `LAB_DS_PUBLIC_URL` | Doc only | `http://127.0.0.1:8080` | Browser-facing DS base (integrator notes) |
| `LAB_BFF_PUBLIC_BASE_URL` | Doc only | `http://host.docker.internal:4000` | **DS-visible** BFF base for download/callback URLs |
| `LAB_BFF_BROWSER_BASE_URL` | Doc only | `http://127.0.0.1:4000` | Browser-visible BFF base |

### Secrets policy

- Values in `.env.example` are **lab placeholders**, not production credentials.
- Real operator `.env` is gitignored (`deploy/.gitignore`: `.env`, `.env.*`).
- Never copy production Secrets Manager JWT material into this lab tree.
- If a lab JWT leaks, rotate by changing `JWT_SECRET` and recreating the container; update any local BFF env to match. Full multi-env rotation: [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) §6.
- Free-track Community has **no paid license key** requirement for this lab path (`lp-5q6.7`).

---

## Start

```bash
cd deploy/dev/lab-shared-compose-ds
cp -n .env.example .env   # skip if .env already exists
docker compose up -d
docker compose ps
docker compose logs -f --tail=100 onlyoffice-documentserver
```

First boot after pull commonly takes **60–180 seconds** before `/healthcheck` succeeds.

### Health and `api.js` (manual smoke)

```bash
DS_PORT="${DS_HOST_PORT:-8080}"
# Health: Document Server reports ready
curl -sf "http://127.0.0.1:${DS_PORT}/healthcheck"
echo

# Browser-equivalent: Docs API loader must be JavaScript
curl -sf "http://127.0.0.1:${DS_PORT}/web-apps/apps/api/documents/api.js" | head -c 400
echo
```

**Browser proof:** open  
`http://127.0.0.1:8080/web-apps/apps/api/documents/api.js`  
Expect a large JS payload defining DocsAPI (not an HTML error page).

Offline structural smoke (no image pull, no running container):

```bash
bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
```

Optional live mode when Docker is available and you accept a pull/start:

```bash
LIVE=1 bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
```

---

## Reachability: Document Server → BFF download and callback

JWT does **not** create network reachability. The DS process must resolve and open TCP to the BFF.

### Lab pattern (default compose)

| Path | Lab URL shape |
|------|----------------|
| Browser → DS | `http://127.0.0.1:8080/...` |
| Browser → BFF | `http://127.0.0.1:4000/...` (or portal path-first URL) |
| **DS → BFF download** | `http://host.docker.internal:4000/<signed-download-path>` |
| **DS → BFF callback** | `http://host.docker.internal:4000/<callback-path>` |

Compose sets:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

so Linux and Docker Desktop both resolve `host.docker.internal` to the host gateway.

### Rules for integrators (BFF Office beads)

1. Mint **absolute** `document.url` and `editorConfig.callbackUrl` that are reachable **from inside the DS container**.
2. **Do not** put `http://127.0.0.1:...` or `http://localhost:...` in those fields when DS runs in Docker — those point at the container, not the host BFF.
3. Prefer `http://host.docker.internal:<bff-port>/...` for lab, or put BFF on the same Compose network and use the service DNS name (future optional overlay; not required for this bead).
4. Browser-facing BFF cookies/CORS remain on the browser base URL; only **server-side** DS fetches use the DS-visible base.
5. Keep JWT secret aligned: DS `JWT_SECRET` ↔ BFF document-config signer secret.

### Quick connectivity check (BFF must already be listening)

```bash
# From inside the DS container: can we open the host BFF?
docker exec lab-onlyoffice-ds curl -sS -o /dev/null -w "%{http_code}\n" \
  --connect-timeout 3 \
  "http://host.docker.internal:4000/health" || true
```

Expect a non-zero HTTP code if BFF is up (e.g. `200`). Connection refused means BFF is down or port mismatch — fix BFF first; token alone will not help.

When BFF Office routes exist (`lp-5q6.21`+), extend this check to a fixture signed download URL and a dry callback path as part of `lp-5q6.28`.

---

## Lab open / edit / save / callback round trip (`lp-5q6.28`)

**Go/no-go for production editing work.** Prove the path Document Server uses against fixture vault only. Do **not** treat green as staging/production certification.

### What “open” means in lab

| Step | Actor | BFF route | Proof |
|------|--------|-----------|--------|
| 1. Mint | Browser / lab harness (cookie + CSRF) | `POST /api/office/sessions` | Editor config with DS-reachable `document.url` + `callbackUrl` + JWT |
| 2. Open | Document Server HTTP client | `GET /api/office/sessions/:id/content?token=…` | Streams fixture DOCX/XLSX bytes; no Portal cookie |
| 3. Save | Document Server callback | `POST /api/office/callback?session_id=…&nonce=…` status `2` or `6` | Fetches assembled file from allowlisted host → `vault.write` CAS + new revision |
| 4. Fail | Document Server / bad auth | status `3`/`7` or bad nonce | `last_save_status=failed` or deny code; user-facing pane copy (no secrets) |

### Offline prove (default — CI / agent safe)

```bash
# From repository root
bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
```

This runs:

1. `deploy/scripts/smoke-lab-onlyoffice-compose.sh` (compose/runbook structure)
2. BFF integration: `portal/packages/bff/test/office-lab-roundtrip.integration.test.ts` (DOCX + XLSX)
3. Full BFF `office-*.test.ts` suite
4. Web `officeSaveUserErrors` unit tests (user-facing failed-callback copy)
5. Writes `artifacts/lab/lp-5q6.28/roundtrip-evidence-latest.json` (IDs, codes, latency — **no** body, token, or JWT)

### LIVE Document Server + DocsAPI (preferred go/no-go)

```bash
# Preferred: real DS container download + live HTTP BFF + Playwright DocsAPI screenshots
bash deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh

# Or via offline script wrapper
LIVE=1 bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
```

Proves:

1. Lab BFF on `0.0.0.0` (`portal/packages/bff/scripts/lab-onlyoffice-live-server.mts`)
2. **Document Server container** `curl` of signed download URL (`host.docker.internal`)
3. **Browser DocsAPI** open for DOCX + XLSX (`onDocumentReady`) + screenshots under `artifacts/lab/lp-5q6.28/screenshots/`
4. Real HTTP callback status `2` → new `rev-live-*` revision
5. Failed status `3` / user-facing save error wiring

Manual editor host page (with live BFF + DS):

```bash
pnpm --filter @lanyard/bff exec tsx scripts/lab-onlyoffice-live-server.mts
# open http://127.0.0.1:4100/lab/editor?type=docx
```

### Latency and status

Callback and download handlers emit safe structured logs via `buildOfficeSafeLogFields` with `latency_ms`, `onlyoffice_status`, `outcome`, `office_session_id`, and `operator_class`. Counters live on `officeMetrics` (`lp-5q6.33`). Evidence JSON records download/callback latencies from the integration harness.

### Failed callback user-facing error

| BFF code / class | Pane copy module |
|------------------|------------------|
| `save_error`, `write_failed`, … | `callback_save_issue` |
| `conflict` | `save_conflict` |
| `fetch_failed` | `document_server_unreachable` |
| `invalid_nonce`, `bad_url`, … | `save_rejected` |
| `expired` | `session_expired` |

Implementation: `portal/packages/web/src/features/chat/documentPane/officeSaveUserErrors.ts`.

### Go / no-go

| Result | Meaning |
|--------|---------|
| **GO** | DOCX + XLSX mint → signed download → status-2 writeback → new revision; failed path has user-facing copy; no body logs |
| **NO-GO** | Callback auth fragile, SSRF allowlist blocking legitimate DS, or write CAS cannot converge — **stop before staging deploy** (`lp-5q6.34`) |

Lab green does **not** authorize production vault, paid license, or customer-facing edit.

---

## Teardown

```bash
cd deploy/dev/lab-shared-compose-ds

# Stop containers
docker compose down

# Stop + remove named volumes (wipes DS cache / forgotten files / embedded DB)
docker compose down -v

# Optional: remove local image layers
docker image rm onlyoffice/documentserver:latest || true
```

After teardown:

1. Confirm volumes gone: `docker volume ls | grep lab_onlyoffice` → empty.
2. If lab JWT may have leaked, rotate `JWT_SECRET` in a fresh `.env` before next `up`.
3. Do **not** point residual lab URLs at production vault hosts.

---

## Failure cheat sheet

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `healthcheck` never true | Still starting / OOM / disk full | `docker compose logs`; free RAM/disk; wait 3 min |
| `api.js` 502/connection refused | Port bind / container down | `docker compose ps`; check `DS_HOST_PORT` |
| Editor: download failed | DS cannot reach BFF URL | Use `host.docker.internal`, not `localhost`; verify `docker exec … curl` |
| JWT / security token errors | Secret mismatch or JWT disabled | `JWT_ENABLED=true`; match BFF secret; recreate container after `.env` change |
| Mixed content | HTTPS portal page loading HTTP DS | Use same-scheme lab stack or documented local exception |
| Pull denied / timeout | Network / registry | Retry `docker pull`; pin tag when stable |

---

## What this unblocks / still blocks

**Unblocks:** Lab open/edit latency experiments; BFF Office bridge development against a real DS (`lp-5q6.21`–`.28`); browser host loading `api.js` (`lp-5q6.27`).

**Still blocked:** Customer-facing production Office edit; production Terraform DS; any production vault bytes on this compose stack; treating lab green as staging/production certification.

---

## Related

| Artifact | Role |
|----------|------|
| `deploy/dev/lab-shared-compose-ds/docker-compose.yml` | Compose wiring |
| `deploy/dev/lab-shared-compose-ds/.env.example` | Lab env template (no production secrets) |
| `deploy/scripts/smoke-lab-onlyoffice-compose.sh` | Offline (+ optional LIVE) smoke |
| ADR 0006 / topology architecture | Named topologies + residency |
| `lp-5q6.7` license decision | Free-track Community/Developer Development Server |
| `lp-5q6.34` | Staging platform shared DS (not this runbook) |
| [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) | Day-2 JWT rotate, forgotten-file purge, multi-env failures (`lp-5q6.36`) |
| `portal/docker-compose.yml` | Local BFF/CP/relay stack (port 4000 BFF) |

---

## Smoke evidence record

Record offline and optional live results when closing the bead or proving a lab host:

```text
date -u
bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
# optional:
# LIVE=1 bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
# curl -sf http://127.0.0.1:8080/healthcheck
# curl -sf http://127.0.0.1:8080/web-apps/apps/api/documents/api.js | head -c 120
```

Paste command output (no secrets) into the PR body or bead notes.

### Round-trip evidence (`lp-5q6.28`)

```text
date -u
bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
# optional LIVE DS:
# LIVE=1 bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
cat artifacts/lab/lp-5q6.28/roundtrip-evidence-latest.json
```

Evidence files must not contain document bodies, download tokens, callback nonces, or JWT secrets.
