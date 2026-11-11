# lp-zuh.10.11 — Fix UI QA residual for lp-zuh.10.10 (portal ensure_online)

**Date:** 2026-08-14 (UTC)  
**Bead:** `lp-zuh.10.11` (bug)  
**Parent:** `lp-zuh.10.10` / epic `lp-zuh.10`  
**Verdict:** **PASS** (portal UI QA)

## Failure under repair

UI QA for `lp-zuh.10.10` failed with:

- BFF `POST /api/chat/threads/{id}/messages` → **502** `wake_failed` / `ENSURE_ONLINE_WAKE_FAILED`
- Vault API `unavailable=true` (empty roots; stock `wf_4e8440b25d42613a` not visible via portal)
- Tools → Workflows: **The agent failed to start**
- Slash `/workflow` not delivered
- No ENOSYS on portal path (wake never reached guest admit)

CLI stock admit on snapshot `efa7c007` remained GO (separate SOE).

## Root cause

1. **`lp-zuh.10.10` force-redeployed CP** so SM `DAYTONA_DEFAULT_SNAPSHOT` reloaded.
2. Staging CP stores Instance secret material at **ephemeral**  
   `INSTANCE_SECRET_MATERIAL_PATH=/tmp/control-plane/instance-secret-material.bin`  
   (**no EFS volume** on the task). Redeploy wipes the store.
3. Existing sandbox `7a300050-…` could still warm-start for a while (env already injected). After it was destroyed (404), every cold create failed in `buildCreateParams` with **`MissingInstanceSecretMaterialError`** before any Daytona `create` (metrics: `sandbox_start_failure` reason=`other`, latency ~20–30ms, **zero** `op=create` logs).
4. Known residual from `lp-zuh.9.4` evidence: “Ephemeral secret material path wiped on CP redeploy → rotate required.”

Not caused by the workflow ENOSYS snapshot pin itself (snapshot active; cold create from pin works once material is present).

## Fix applied (ops)

| Step | Result |
|------|--------|
| Clear presence / binding | `sandbox_id=NULL`, `presence=offline` on MockLab instance `452b1348-…` (row already had null sandbox; presence was `error`) |
| `POST …/instances/{id}/rotate` | **200** — re-seeds encrypted secret material + Relay push (service-token, via BFF SG → internal CP ALB) |
| `POST …/internal/instances/{id}/ensure-online` | **200** — cold create `sandbox_id=8bb6fc44-0812-4586-9463-e2c86941f56f`, presence `online`, snapshot pin `efa7c007-…` |
| Portal UI QA re-run | **passed=true** — see [artifacts/ui/lp-zuh.10.11/RESULT.md](../../ui/lp-zuh.10.11/RESULT.md) |

## Portal UI QA proof (acceptance of lp-zuh.10.10 surfaces)

| Check | Result |
|-------|--------|
| Login / Agents / Vault / Tools shell | PASS |
| Vault tree + stock `wf_4e8440b25d42613a` visible | PASS |
| Tools → Workflows not agent-failed | PASS |
| Agents slash `/workflow` path / ensure_online chat | PASS (`workflow_card_visible`) |
| ENOSYS rename failure on portal path | **not observed** (enosys_hit=false) |
| durable_state_visible / proof_run_visible | PASS |

Screenshots: `artifacts/ui/lp-zuh.10.11/*.png`  
Report: `artifacts/ui/lp-zuh.10.11/REPORT.json`

## Code harden (this bead)

- Classify wake failures as `missing_secret_material` and `vault_mount_sts_failed` in  
  `portal/packages/control-plane/src/orchestrator-metrics.ts` so CP metrics no longer collapse these to opaque `other` (unit test updated).

## Residuals

| Item | Status |
|------|--------|
| Durable secret-material store across CP task recycle (EFS / SM, not `/tmp`) | **Open** — ops rotate after every CP force-new-deployment until fixed |
| Journal append EPERM on Mountpoint | Optional residual from zuh.10.5 / 10.10 (non-blocking admit) |
| Merge `lp-zuh.10.10` pin PR #463 | Separate ship gate (CI + this UIQA) |

## Operator checklist after CP redeploy

```bash
# 1) Rotate MockLab instance (service token; from a task in BFF SG)
POST /tenants/319d3808-…/instances/452b1348-…/rotate

# 2) Cold ensure_online
POST /internal/instances/452b1348-…/ensure-online

# 3) Confirm presence online + sandbox_id bound; vault tree non-empty via portal
```

## Secret hygiene

- No tokens, passwords, SM payloads, or `.env.mocklab-agent-dev` contents in this pack.
- Evidence uses ids, digests, and redacted rotate responses only.
