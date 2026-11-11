# lp-zuh.14.2 — Cold boot proof: ensure_online without SSH config seed (qh2 closeout)

**Date:** 2026-08-19 (UTC)  
**Bead:** `lp-zuh.14.2`  
**Parent:** `lp-zuh.14` (Phase 10 / MockLab residual closeout)  
**Supersedes / closes:** `lp-qh2` (Bake LA gateway config into agent-gateway snapshot)  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Cold create on LA kitchen-sink snapshot seeds `BACKEND_HOME/config.yaml` and starts gateway **without SSH / manual config seed** | **GO** — stock Daytona create `453211ac…` on `f4d947f3` / `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| 2 | Portal / channel online; brain.ping **or** chat path OK | **GO (portal)** — MockLab shell Agents/Vault online; chat_delivery=`harness` accepts POST `/api/chat/threads/:id/messages` 200. **brain.ping** via Relay guest gateway **N/A on current SM default** (tool-only; see pins note) |
| 3 | Document remaining out of scope | **GO** — see below |
| 4 | Close `lp-qh2` with this evidence | **GO** — close reason cites this pack |

## Pin context (important)

| Surface | Value |
|---------|--------|
| SM `DAYTONA_DEFAULT_SNAPSHOT` (at proof) | `b13c2b8d-…` / `lanyard-tool-only-f63beffd-20260819c` (**tool-only**, `lp-oop.37.5`) |
| SM previous / LA kitchen-sink SoT for qh2 | `f4d947f3-…` / `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` (`lp-zuh.11.1`) |
| Pins YAML (repo) | `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` still records LA kitchen-sink pin + `kitchen_sink_config_seed` |
| MockLab `agent_snapshot_id` before proof | tool-only `b13c2b8d-…` |
| MockLab after proof | **restored** to tool-only `b13c2b8d-…` (respect `lp-oop.37.5`) |

**qh2 residual surface** is the **fat LA guest** entrypoint `ensure_agent_config` (kitchen-sink `config.yaml`), not the short-stack tool-only image (no guest gateway by design).

## Proof A — Offline entrypoint smoke

```bash
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
```

**RESULT:** all entrypoint/image contract smoke checks passed (includes kitchen-sink config seed / `ensure_agent_config` / lp-qh2 assertions).  
Artifacts: [smoke-entrypoint-summary.txt](./smoke-entrypoint-summary.txt), [smoke-entrypoint-tail.txt](./smoke-entrypoint-tail.txt).

## Proof B — Stock cold create on LA kitchen-sink snapshot (no SSH)

| Field | Value |
|-------|--------|
| Snapshot id | `f4d947f3-bd03-4f6c-b8a2-b2034872feba` |
| Snapshot name | `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| Sandbox | `453211ac-a711-4eb8-89ec-9f48588314c0` (archived after proof) |
| Method | Daytona `POST /sandbox` + toolbox `process/execute` only — **no SSH**, no manual `config.yaml` write |
| Inject (names only) | `BACKEND_HOME`, `VAULT_ROOT`, `GATEWAY_RELAY_*`, `LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL=1` |

### Guest verdicts

| Check | Result |
|-------|--------|
| `CONFIG_PRESENT` at `$BACKEND_HOME/config.yaml` | **GO** |
| Header `# Auto-seeded by agent-gateway entrypoint — MockLab kitchen-sink` | **GO** |
| `vault_root: /mnt/vault` | **GO** |
| `litellm:` / `channels:` / portal `relay_*_env` keys | **GO** |
| Gateway process `node …/apps/gateway/dist/main.js --config …/config.yaml` | **GO** |
| SSH / manual seed | **None** |

Artifacts: [guest-probe.txt](./guest-probe.txt), [guest-verdicts.json](./guest-verdicts.json), [create-request-secret-free.json](./create-request-secret-free.json), [create-response-secret-free.json](./create-response-secret-free.json), [sm-pin-secret-free.json](./sm-pin-secret-free.json).

## Proof C — Portal online + channel path

| Check | Result |
|-------|--------|
| Login `https://app.withlanyard.com/mocklab` | **GO** → `/mocklab/chat` |
| Shell Agents / Vault | **GO** |
| `/api/context` | 200; `chat_delivery=harness`; `brain_rpc_enabled=true`; `vault_plane=cp_s3` |
| `GET /api/brain/ping` | **503** `Gateway not connected or handshake incomplete` — expected while MockLab pin is **tool-only** (no guest gateway / no Relay hello) |
| Chat thread create + `POST …/messages` `{text}` | **200** accepted (harness delivery) |
| Assistant reply in history | **Not observed** in this window (harness turn residual; not qh2 config-seed scope) |

Artifacts: [portal-channel-proof.json](./portal-channel-proof.json), screenshots `01`–`03`.

## Proof D — Product `ensure_online` on LA pin (attempted)

Temporarily patched MockLab `agent_snapshot_id` → LA `f4d947f3`, cleared `sandbox_id`, archived prior tool-only box, then `POST /internal/instances/…/ensure-online`.

| Observation | Detail |
|-------------|--------|
| Patch | `agent_snapshot_id=f4d947f3…`, `sandbox_id=null` |
| ALB response | **504** Gateway Time-out (idle) while wake still in flight |
| Daytona create | LA snapshot sandboxes appeared (`dffd4bf5…` started, plus recreate leftovers) |
| Guest after wake | Mountpoint **up** at `/mnt/vault`; `GATEWAY_RELAY_*` + AWS STS inject **present**; **`config.yaml` missing**; **gateway process absent**; entrypoint not past seed/`exec` |
| CP presence | ended `error` / unbound (`sandbox_id=null`) — classic never-connect / entrypoint-die class |
| Restore | MockLab `agent_snapshot_id` restored to tool-only `b13c2b8d…`; orphan LA sandboxes stopped/archived |

Artifacts: [cp-ensure-online-wake.txt](./cp-ensure-online-wake.txt), [ensure-online-guest-probe.txt](./ensure-online-guest-probe.txt), [ensure-online-guest-diag.txt](./ensure-online-guest-diag.txt), [restore-tool-only.txt](./restore-tool-only.txt).

**Interpretation:** qh2’s original failure mode (“no `config.yaml` until SSH seed”) is fixed by entrypoint kitchen-sink seed on the LA image (Proof A/B). Product cold `ensure_online` with live Mountpoint inject still can fail **before** seed/`exec` (Mountpoint writable / entrypoint hang → Relay never-connect). That class was already noted under `lp-zuh.11.1` and is **not** missing kitchen-sink bake.

## Out of scope / residual (AC3)

1. **Durable CP instance secret material store** across task recycle (ops rotate after force-new-deployment; ephemeral file store) — called out since `lp-zuh.9.4` / qh2 description.
2. **Short-stack tool-only default** (`lp-oop.37.5`) — no guest gateway; brain.ping over Relay guest path intentionally unavailable on SM default / MockLab pin while tool-only.
3. **Mountpoint post-mount / entrypoint hang** on some live `ensure_online` creates (vault mounts; gateway never `exec`) — follow-up under vault/entrypoint ops, not qh2 config bake.
4. **Harness chat assistant completion** when `chat_delivery=harness` — separate short-stack path; message accept ≠ turn complete.
5. **Do not flip SM `DAYTONA_DEFAULT_SNAPSHOT` back to fat LA** from this bead — human pin for tool-only remains.

## Why this closes `lp-qh2`

`lp-qh2` asked to bake / generate MockLab pilot `config.yaml` (vault_root, litellm, default_model, session, channels.portal.relay_*_env) so cold boot does not require SSH. That shipped as entrypoint `ensure_agent_config` + LA snapshot pins (`lp-zuh.4/5`, `lp-zuh.9`, `lp-zuh.11.1`). This leaf re-proves:

- Offline smoke still asserts kitchen-sink seed.
- Live cold create on the LA kitchen-sink snapshot auto-seeds config and runs gateway with `--config` — **no SSH**.

## Secret hygiene

No passwords, JWT, SM secret values, Relay secrets, AWS keys, or `.env.mocklab-agent-dev` contents in this package. Create env dumps redact `*SECRET*` / `*KEY*` / `*TOKEN*`.

## Prior linked evidence

- `artifacts/daytona-pilot/lp-zuh.11-snapshot/` — pin bake including kitchen-sink seed
- `artifacts/mocklab/live-qa/zero-waiver-go/` — portal online + chat on LA pin (2026-08-14)
- `deploy/daytona/agent-gateway/entrypoint.sh` — `ensure_agent_config`
- `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` — `kitchen_sink_config_seed`
