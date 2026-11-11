# Rollback checklist: flip pilot tenant `runtime_kind=daytona` → EC2; stop sandbox

**Status:** Operator checklist + offline dry-run recorded (no live AWS / Daytona apply).  
**Primary bead:** `lp-ky7`  
**Parent epic:** Phase 7 dual-run migration `lp-0pr`  
**Depends on:** cutover checklist `lp-6h8` (pilot was flipped to daytona), dual-run field `lp-gu2`  
**Blocks:** safe soak recovery before EC2 decommission `lp-u00`  
**Related:** [dual-run-runtime-kind.md](./dual-run-runtime-kind.md), [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) (`lp-6h8`, may land in parallel), [identity-model.md](./identity-model.md), [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md), [warm-pool-snapshot-wake.md](./warm-pool-snapshot-wake.md), [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md), [provision-runbook-daytona.md](./provision-runbook-daytona.md)

## Goal

Roll a **pilot** gateway instance back from on-demand Daytona to the always-on **EC2** path **without** minting a new product identity and **without** rotating instance credentials:

| Keep (must not change) | Must change on rollback |
|------------------------|-------------------------|
| `instance_id` (Relay / Brain RPC / BFF routing identity) | `runtime_kind`: `daytona` → `ec2` |
| Instance secret (hash + salt; gateway / SM material) | Stop / archive ephemeral sandbox if present |
| Tenant membership / authz | `sandbox_id` → **`null`** (clear binding; not warm retain) |
| Audit history on the same `instance_id` | Presence restored to EC2 always-on semantics |
| S3 vault prefix objects (do not GC as part of rollback) | Ops note: EC2 host must still exist (dual-run) |

**Do not** re-register / re-provision a new instance for rollback.  
**Do not** call secret rotate as part of the flip.  
**Do not** use `sandbox_id` as Relay identity.  
**Do not** decommission EC2 as part of this procedure (`lp-u00` is separate and only after successful soak).

### Critical ordering

```text
[1] WHILE runtime_kind is still daytona → stop (and optional archive) sandbox
[2] Clear sandbox_id binding (stop with retain off, and/or registry PATCH null)
[3] PATCH registry → runtime_kind=ec2 (keep credentials)
[4] Verify EC2 host still exists and can serve as always-on path
```

**Why stop before flip:** `decideStopPath("ec2")` is a **no-op** (always-on host). If you flip first, orchestrator `POST …/stop` will not call Daytona and the sandbox may keep billing until Daytona autoStop / idle reaper (reaper also skips `runtime_kind=ec2`). Always stop/archive **while still `daytona`**.

Default product stop (`lp-6bg`) **retains** `sandbox_id` for warm re-wake. Rollback is the opposite: **clear** the binding so the row does not reference dead compute after the kind flip.

## Acceptance for this bead

| Criterion | How met |
|-----------|---------|
| Rollback steps work in lab | Offline: this checklist + unit/smoke proof of stop sandbox + `runtime_kind` flip back; **residual** for live lab |
| Sandbox stopped; EC2 path restored | real harness stop (+ optional archive) + registry/path short-circuit after flip; live residual below |

**Offline smoke:** [`deploy/scripts/smoke-rollback-daytona-to-ec2.sh`](../../../deploy/scripts/smoke-rollback-daytona-to-ec2.sh)

## Non-goals

| Out of scope | Owner |
|--------------|--------|
| Live AWS / Daytona pilot execute | Residual (operator with lab access); OPERATOR HOLD / Relay DNS as applicable |
| Full cutover EC2 → daytona | [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) (`lp-6h8`) |
| Dual-run field design | [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) (`lp-gu2`) |
| Decommission EC2 | `lp-u00` |
| Vault S3 GC / delete prefix | [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) — pilot default **retain** |
| Snapshot pin roll | [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md) (`lp-i7s`) — unrelated pin rollback |
| Secrets in docs / logs / argv | Never |

---

## 1. Pre-requisites (gates before rollback)

Complete **all** of the following. Abort if any fail — leave the pilot on `runtime_kind=daytona` until safe.

### 1.1 Dual-run path available (`lp-gu2`)

| Check | Pass criteria |
|-------|----------------|
| Per-instance field | `gateway_instances.runtime_kind` is `ec2` \| `daytona` |
| Coexistence | Other tenants may remain daytona or ec2 while pilot rolls back |
| Orchestrator dual-path | `ensure_online` / `stop` branch on field; never mutate kind as a side-effect |
| Operator surface | Registry PATCH accepts `runtime_kind` (see [§3](#3-flip-runtime_kind-back-to-ec2-keep-credentials)) |

Canonical: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md).  
Offline proof: `portal/packages/control-plane/test/runtime-kind-dual-run.test.ts`.

### 1.2 EC2 host still exists (dual-run rollback precondition)

| Check | Pass criteria |
|-------|----------------|
| Company-brain EC2 (or lab host) for this instance | Still running / startable; **not** torn down by `lp-u00` |
| Host vault / agent process path | Host disk vault or bootstrap still usable as always-on path |
| `instance_id` + secret on host | Same credentials the gateway already used pre-cutover (or still holds via SM) |
| Relay dial from EC2 | Host can reach Relay with permanent `instance_id` |

**If EC2 was already decommissioned, this rollback cannot restore service.** Treat as blocked; restore host first or re-provision EC2 under a **new** plan (out of scope for this leaf). Dual-run exists so rollback remains possible **until** soak accepts `lp-u00`.

### 1.3 Freeze / drain Daytona writer

| Check | Pass criteria |
|-------|----------------|
| No active agent turn | Mid-turn lock clear or wait for turn end (`lp-053`); do not stop mid-turn if product requires finish |
| One-writer discipline | Stop vault-mutating traffic on Daytona path before EC2 becomes primary writer again |
| Operators know cutover residual | If vault diverged on S3 after cutover, decide copy-back vs accept host disk (ops judgment; not automated here) |

### 1.4 Identity continuity plan

| Check | Pass criteria |
|-------|----------------|
| `instance_id` recorded | Same id before and after |
| Secret material available on EC2 path | No rotate during rollback |
| `sandbox_id` treated as ephemeral | Never written into `GATEWAY_RELAY_*` |

### Pre-req sign-off template (operator log)

```text
tenant_id:            <uuid>
instance_id:          <uuid>   # MUST remain after flip
runtime_kind before:  daytona
sandbox_id before:    <id or null>
presence before:      online|offline|waking|error
ec2_host_exists:      yes   # HARD REQUIREMENT
ec2_host_id_or_note:  <ops note only; not auth>
freeze window UTC:    <start> → <end planned>
operator:             <actor>
date_utc:             <ISO>
```

---

## 2. Stop / archive sandbox (while still `runtime_kind=daytona`)

### 2.1 Explicit stop (required if sandbox may be live)

```http
POST /internal/instances/:instanceId/stop
Content-Type: application/json
Authorization: <service/ops token as configured>

{
  "reason": "explicit_stop"
}
```

Permission / gate: same internal orchestrator auth as other wake/stop routes.  
Handler: `InstanceOrchestrator.stop` → Fake/live Daytona `stop` when kind is `daytona`.  
Shapes: [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md).

| Outcome | Meaning |
|---------|---------|
| `stopped: true`, presence `offline` | Sandbox stop attempted; live compute down |
| `sandbox_id` still set | **Default retain** (`lp-6bg`) — binding kept for warm re-wake; **not** sufficient for rollback alone |
| `stopped: false` with `runtime_kind=ec2` | Wrong order — you already flipped; go back is blocked for Daytona teardown |

**Pass criteria for rollback stop step:** Daytona sandbox state is **stopped** (or already gone). Confirm via presence + Daytona ops if live.

### 2.2 Clear `sandbox_id` binding (required)

Default stop **retains** `sandbox_id` ([warm-pool-snapshot-wake.md](./warm-pool-snapshot-wake.md)). For rollback, clear the binding so the EC2 row does not point at ephemeral compute:

**Option A — orchestrator config (lab / inject):** run stop with `retainSandboxOnStop: false` so stop writes `sandbox_id = null`.

**Option B — registry PATCH (operator default):** include `"sandbox_id": null` in the same (or a prior) registry update as the kind flip ([§3](#3-flip-runtime_kind-back-to-ec2-keep-credentials)).

| Approach | When |
|----------|------|
| A | Test/smoke and CP builds that inject `retainSandboxOnStop: false` for rollback tooling |
| B | Production operator path via existing PATCH registry (no new API) |

Both are valid. Live checklist prefers **B** after stop, or A+B.

### 2.3 Optional archive (thrift / cost)

After stop, optional **archive** reduces idle cost vs leaving a stopped sandbox:

- Orchestrator port: `archiveSandbox(sandboxId)` → Daytona client `archive`
- Not required for product path correctness after kind flip + clear binding
- Prefer thrifty archive in lab when org billing matters; do not thrash create/delete loops

Archive does **not** replace clear binding: always null `sandbox_id` on the CP row for rollback.

### 2.4 Operator sequence (stop phase)

```text
[0] Pre-reqs §1 green; EC2 host exists
        ↓
[1] GET presence — record instance_id, runtime_kind=daytona,
    sandbox_id, presence (no secrets)
        ↓
[2] If mid_turn active → wait or clear with product policy
        ↓
[3] POST …/stop { reason: "explicit_stop" }   # WHILE still daytona
        ↓
[4] Optional: archive sandbox_id via ops client if still known
        ↓
[5] Prepare clear binding (retain off stop and/or upcoming PATCH null)
```

---

## 3. Flip `runtime_kind` back to `ec2` (keep credentials)

### 3.1 Control Plane path (already shipped — `lp-gu2` / `lp-nye`)

**No new flip API required.** Use the existing registry update:

```http
PATCH /tenants/:tenantId/instances/:instanceId/registry
Content-Type: application/json
x-lanyard-actor: <operator-id>
x-request-id: <correlation-id>

{
  "runtime_kind": "ec2",
  "sandbox_id": null,
  "presence": "online"
}
```

Permission: `instances.manage` (same as other registry mutations).  
Handler: `app.patch("/tenants/:id/instances/:instanceId/registry")` → `ControlPlaneStore.updateInstanceRegistry`.  
Schema: `instanceRegistrySchema` includes `runtime_kind` (`portal/packages/control-plane/src/app.ts`).

**What the UPDATE does / does not touch:**

| Column | On rollback PATCH |
|--------|-------------------|
| `runtime_kind` | Set to **`ec2`** |
| `sandbox_id` | Set to **`null`** (clear binding) |
| `presence` | Typically `online` for always-on EC2 path (ops may set offline if host is down) |
| `s3_vault_prefix` | Leave as-is (S3 objects retained; not used as EC2 host vault root) |
| `agent_snapshot_id` | Leave as-is or clear — unused on EC2 path |
| `ec2_instance_id` | Optional restore of ops metadata if cleared at cutover — **not** auth |
| `instance_id` | **Unchanged** (PK; not in PATCH body) |
| `secret_hash` / `secret_salt` | **Unchanged** (UPDATE omits credential columns) |
| `credential_rotated_at` | **Unchanged** |
| `secret_param_arn` | Unchanged unless operator intentionally updates ARN ref |

Store helper (same semantics, for scripts/tests):

```ts
await store.updateInstanceRegistry({
  tenant_id,
  instance_id,
  runtime_kind: "ec2",
  sandbox_id: null,
  presence: "online",
  actor: "rollback-operator",
  request_id: "rollback-<ticket>",
});
```

### 3.2 Operator sequence (flip phase)

```text
[6] PATCH registry → runtime_kind=ec2 + sandbox_id=null (+ presence)
        ↓
[7] GET presence — confirm:
      instance_id unchanged
      runtime_kind=ec2
      sandbox_id=null
      secret not re-emitted
        ↓
[8] Audit: action instance.registry_updated with runtime_kind=ec2
        ↓
[9] ensure_online / chat path → EC2 short-circuit (no Daytona create)
        ↓
[10] Confirm EC2 gateway online on Relay as same instance_id
```

### 3.3 Anti-patterns (fail the change)

| Do not | Why |
|--------|-----|
| Flip to `ec2` **before** Daytona stop | Stop becomes no-op; sandbox may keep running |
| Leave `sandbox_id` bound after flip | Stale handle; confuses ops and webhooks |
| Re-register instance | New identity; breaks Relay / sessions / audit continuity |
| Rotate secret as part of rollback | Unnecessary blast radius |
| Call ensure_online hoping to “stop” Daytona after flip | EC2 path short-circuits; does not tear down sandbox |
| GC S3 vault prefix on rollback | Pilot retain default; dual-run may re-cutover later |
| Decommission EC2 during rollback | Defeats the purpose of dual-run safety |
| Put `sandbox_id` into `GATEWAY_RELAY_*` | Identity model violation |

---

## 4. Validation gates (post-rollback)

Run in order; record results on the ticket.

### 4.1 Sandbox stopped; binding cleared

- [ ] Daytona sandbox stopped (or archived / gone)  
- [ ] CP `sandbox_id` is **null**  
- [ ] No further create/start for this instance after flip  

### 4.2 Identity continuity

- [ ] `instance_id` equal pre/post  
- [ ] Secret not rotated (`credential_rotated_at` unchanged)  
- [ ] Relay authenticates the same gateway identity on EC2  
- [ ] `runtime_kind=ec2`  

### 4.3 EC2 path restored

- [ ] `ensure_online` short-circuits already-online (no Daytona)  
- [ ] Chat / Brain RPC reach host agent  
- [ ] Host vault usable (or documented residual if S3-only divergence)  

### 4.4 Dual-run isolation

- [ ] Sibling daytona tenants unaffected  
- [ ] Idle reaper does not target this instance (ec2 never reaped)  

### 4.5 Observability (no secrets)

- [ ] Audit row `instance.registry_updated` with `runtime_kind=ec2`  
- [ ] Logs: ids only; no API keys / instance secrets  

---

## 5. Residual: live lab rollback (operator AWS + Daytona)

**This bead’s offline path does not perform live rollback.** Live execute requires:

| Residual | Why blocked offline / hold |
|----------|----------------------------|
| Operator AWS lab + reachable EC2 host for pilot | No live host in offline dry-run |
| Live Daytona stop/archive for pilot sandbox | Paid/live API; thrifty only |
| CP env with registry PATCH + orchestrator stop | Operator credentials not in git |
| Vault divergence decision (S3 vs host disk) | Ops judgment after cutover writes |
| Relay public WSS healthy for EC2 path | [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md); OPERATOR HOLD may still apply |

Track residual under Phase 7 ops when lab access and hold policy allow. Do **not** bypass OPERATOR HOLD to force staging re-enable.

### Live execute checklist (when residual clears)

```text
[ ] §1 pre-reqs green; EC2 host exists
[ ] §2 stop (+ optional archive) while runtime_kind=daytona
[ ] §2 clear sandbox_id (retain off and/or PATCH null)
[ ] §3 PATCH runtime_kind=ec2 keep credentials
[ ] §4 validation gates
[ ] Do not run lp-u00 as part of rollback
```

---

## Offline dry-run evidence

No live AWS, no Daytona API (except in-process **real harness** in unit tests), no secret material.

```bash
# From monorepo root
bash deploy/scripts/smoke-rollback-daytona-to-ec2.sh
```

Expected coverage:

| Check | Pass criteria |
|-------|----------------|
| Checklist present | `docs/plans/0008-daytona-agent-sandboxes/rollback-daytona-to-ec2.md` |
| Doc axes | Stop-before-flip, clear `sandbox_id`, keep credentials, EC2 host must exist, residual live |
| API surface | `POST …/stop` + `PATCH …/registry` + `runtime_kind` in schema |
| Credential safety | Registry UPDATE SQL omits `secret_hash` / `secret_salt` |
| Dual-run tests | `runtime-kind-dual-run.test.ts` rollback case: stop + flip → ec2 short-circuit |
| Cross-links | dual-run / issue-map mention `lp-ky7` |
| AWS / live Daytona | Not invoked by smoke |

Optional deeper offline proof (when package deps installed):

```bash
cd portal && npm test -- workspace @lanyard/control-plane -- runtime-kind-dual-run
```

Postgres store cases skip without `DATABASE_URL` / `CONTROL_PLANE_DATABASE_URL`; real harness cases always run.

### Dry-run walkthrough (recorded against fixtures/docs)

This is the **recorded dry-run** for `lp-ky7` acceptance (not a live pilot rollback).

| Checklist step | Offline stand-in | Result |
|----------------|------------------|--------|
| 1.1 Dual-run | Doc + `runtime-kind-dual-run.test.ts` + `runtime-path.ts` | Field is per-instance; stop/ensure branch on kind |
| 1.2 EC2 host exists | Documented hard requirement | Live residual; offline asserts doc coverage |
| 2 Stop while daytona | real harness `stop` + optional `archive` in dual-run test | `stopped` / archived; no AWS |
| 2 Clear sandbox_id | `retainSandboxOnStop: false` and/or registry null | Binding cleared |
| 3 Flip to ec2 | Registry PATCH schema + dual-run rollback test | `runtime_kind=ec2`; secrets columns omitted from UPDATE |
| 3 Keep credentials | UPDATE columns review | No `secret_hash` / `secret_salt` in registry UPDATE |
| 4 EC2 path | ensure_online after flip → short_circuit | No additional real harness create |
| 5 Live residual | Explicit in this doc + smoke | Operator AWS+Daytona+EC2 host required |

Date recorded: **2026-08-05** (offline path).  
Smoke script re-runs the doc/code evidence without network.

---

## Safety

- No secrets in checklist tickets, smoke output, or manifests.  
- Prefer thrifty lab usage; archive when useful; no thrash create/delete loops.  
- Respect pilot bucket “do not destroy” (`lp-d26`); do not GC vault on rollback.  
- Staging OPERATOR HOLD: localhost / lab only until hold lifted.  
- Guest agent never receives Daytona API keys.  
- Never decommission EC2 as part of this rollback (`lp-u00` only after successful soak on daytona).

## See also

- Dual-run field: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) (`lp-gu2`)  
- Cutover (inverse): [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) (`lp-6h8`)  
- Identity: [identity-model.md](./identity-model.md)  
- Orchestrator API: [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)  
- Warm retain vs clear: [warm-pool-snapshot-wake.md](./warm-pool-snapshot-wake.md) (`lp-6bg`)  
- Next: EC2 decommission only after soak `lp-u00`  
