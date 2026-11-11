# Cutover checklist: flip pilot tenant EC2 → `runtime_kind=daytona` (keep instance credentials)

**Status:** Operator checklist + offline dry-run recorded (no live AWS / Daytona apply).  
**Primary bead:** `lp-6h8`  
**Parent epic:** Phase 7 dual-run migration `lp-0pr`  
**Depends on:** dual-run field `lp-gu2`, vault EC2→S3 copy `lp-3ux`  
**Blocks:** rollback leaf `lp-ky7`, EC2 decommission `lp-u00`  
**Related:** [dual-run-runtime-kind.md](./dual-run-runtime-kind.md), [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md), [provision-runbook-daytona.md](./provision-runbook-daytona.md), [identity-model.md](./identity-model.md), [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md), [agent-snapshot-pin.md](./agent-snapshot-pin.md), [production-network-allowlist.md](./production-network-allowlist.md), [cp-daytona-config.md](./cp-daytona-config.md)

## Goal

Migrate a **pilot** gateway instance from always-on EC2 compute to on-demand Daytona **without** minting a new product identity:

| Keep (must not change) | May change / set on cutover |
|------------------------|-----------------------------|
| `instance_id` (Relay / Brain RPC / BFF routing identity) | `runtime_kind`: `ec2` → `daytona` |
| Instance secret (hash + salt; show-once material already held by gateway / SM) | `s3_vault_prefix` (must match verified vault copy destination) |
| Tenant membership / authz | `agent_snapshot_id` (pin or inherit platform default) |
| Audit history on the same `instance_id` | `presence` → `offline` (pre-wake); then orchestrator-driven |
| | `sandbox_id` → `null` until first `ensure_online` |
| | `ec2_instance_id` metadata may clear / stay as ops note (not auth) |

**Do not** re-register / re-provision a new instance for cutover.  
**Do not** call secret rotate as part of the flip.  
**Do not** use `sandbox_id` as Relay identity.

## Acceptance for this bead

| Criterion | How met |
|-----------|---------|
| Checklist doc | This file |
| Pilot cutover performed **or** dry-run recorded | Offline dry-run against fixtures/docs + CP dual-run tests ([Dry-run evidence](#offline-dry-run-evidence)); live pilot residual below |

**Offline smoke:** [`deploy/scripts/smoke-cutover-ec2-to-daytona.sh`](../../../deploy/scripts/smoke-cutover-ec2-to-daytona.sh)

## Non-goals

| Out of scope | Owner |
|--------------|--------|
| Live AWS / Daytona pilot execute | Residual (operator with lab access); blocked by OPERATOR HOLD / Relay DNS as applicable |
| Vault host-disk → S3 copy itself | [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) (`lp-3ux`) — **prerequisite**, not this checklist |
| Dual-run field design | [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) (`lp-gu2`) |
| Rollback flip to EC2 + stop sandbox | `lp-ky7` |
| Decommission EC2 | `lp-u00` |
| Greenfield daytona provision (no prior EC2) | [provision-runbook-daytona.md](./provision-runbook-daytona.md) (`lp-w9a` / `lp-6jx`) |
| Secrets in docs / logs / argv | Never |

---

## 1. Pre-requisites (gates before flip)

Complete **all** of the following. Abort if any fail — leave `runtime_kind=ec2`.

### 1.1 Dual-run path available (`lp-gu2`)

| Check | Pass criteria |
|-------|----------------|
| Per-instance field | `gateway_instances.runtime_kind` is `ec2` \| `daytona` (not a global-only product switch) |
| Coexistence | Other tenants may remain `ec2` while pilot flips |
| Orchestrator dual-path | `ensure_online` / `stop` branch on field; never mutate kind as a side-effect |
| Operator surface | Registry PATCH accepts `runtime_kind` (see [§2](#2-flip-runtime_kind-keep-instance_id--secret)) |

Canonical: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md).  
Offline proof: `portal/packages/control-plane/test/runtime-kind-dual-run.test.ts`.

### 1.2 Vault EC2 → S3 copy verified (`lp-3ux`)

| Check | Pass criteria |
|-------|----------------|
| Copy runbook executed | Freeze → dry-run → `--execute --verify` (or fixture smoke for offline) |
| Verify report | `$MANIFEST_DIR/verify-report.txt` has `result=PASS` (file count + sha256) |
| Destination | Objects under pilot `s3_vault_prefix` (shape `tenants/{tenant_id}/vault/`) |
| EC2 vault | Still intact (one-writer source of truth until cutover soak) |
| `runtime_kind` | Still `ec2` until this checklist’s flip step |

Canonical: [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) + `deploy/scripts/copy-vault-ec2-to-s3.sh`.

Attach verify-report path + file counts to the cutover ticket before flip.

### 1.3 Platform Daytona gates (allowlist + ready)

| Check | Env / field | Pass criteria |
|-------|-------------|---------------|
| Orchestrator enabled | `DAYTONA_ENABLED` | `true` / `1` for the CP environment that will wake the pilot |
| API ready | `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION` | Present in secret store (values never logged) |
| Tenant allowlist | `DAYTONA_TENANT_ALLOWLIST` | Pilot `tenant_id` **explicitly** listed (empty = deny all) |
| Domain egress | `DAYTONA_DOMAIN_ALLOWLIST` | Production host catalog set for pilot Relay + model + S3 hosts ([production-network-allowlist.md](./production-network-allowlist.md), `lp-ccp`) |
| Fail-closed | — | Unknown tenant stays gated even if `runtime_kind=daytona` |

Canonical: [cp-daytona-config.md](./cp-daytona-config.md).  
Config gates **do not** replace setting `runtime_kind`; they only allow the daytona *orchestration path*.

### 1.4 Agent snapshot pin

| Check | Pass criteria |
|-------|----------------|
| Platform default | `DAYTONA_DEFAULT_SNAPSHOT` non-empty when Daytona enabled (live pin from Phase 2 / `lp-1wa`, or documented placeholder offline) |
| Per-instance pin (recommended for pilot) | `agent_snapshot_id` set on the pilot row to a known-good snapshot id |
| Resolution | `resolveAgentSnapshotId` → non-null before first create ([agent-snapshot-pin.md](./agent-snapshot-pin.md)) |

Do not rely on implicit “latest” snapshot at wake.

### 1.5 Identity + Relay readiness

| Check | Pass criteria |
|-------|----------------|
| `instance_id` known | Same id the EC2 gateway already dials Relay with |
| Secret material available to wake inject | SM / inject path still holds the **current** instance secret (no rotate during cutover) |
| Relay hostname | Matches allowlist + `GATEWAY_RELAY_URL` host; live DNS residuals: [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md) |
| BFF ensure_online | Chat / channel flags understood (`ENSURE_ONLINE_*`); offline default off until live enable |

### 1.6 Operator hold / environment policy

| Check | Notes |
|-------|--------|
| Staging OPERATOR HOLD | Do **not** re-enable fixed staging network/compute solely for this cutover — see hold docs |
| Lab coordinates | Prefer mocklab / pilot lab account; thrifty throwaways only |
| No secrets in tickets | Hashes, counts, ids only |

### Pre-req sign-off template (operator log)

```text
tenant_id:            <uuid>
instance_id:          <uuid>   # MUST remain after flip
runtime_kind before:  ec2
s3_vault_prefix:      tenants/<tenant_id>/vault/
vault verify-report:  <path> result=PASS  files=N
DAYTONA_ENABLED:      true
tenant on allowlist:  yes
agent_snapshot_id:    <pin or null→platform default>
domain allowlist set: yes (count only in logs)
freeze window UTC:    <start> → <end planned>
operator:             <actor>
date_utc:             <ISO>
```

---

## 2. Flip `runtime_kind` (keep `instance_id` + secret)

### 2.1 Control Plane path (already shipped — `lp-gu2` / `lp-nye`)

**No new flip API required.** Use the existing registry update:

```http
PATCH /tenants/:tenantId/instances/:instanceId/registry
Content-Type: application/json
x-lanyard-actor: <operator-id>
x-request-id: <correlation-id>

{
  "runtime_kind": "daytona",
  "s3_vault_prefix": "tenants/<tenant_id>/vault/",
  "agent_snapshot_id": "<pinned-snapshot-id>",
  "presence": "offline",
  "sandbox_id": null
}
```

Permission: `instances.manage` (same as other registry mutations).  
Handler: `app.patch("/tenants/:id/instances/:instanceId/registry")` → `ControlPlaneStore.updateInstanceRegistry`.  
Schema: `instanceRegistrySchema` includes `runtime_kind` (`portal/packages/control-plane/src/app.ts`).

**What the UPDATE does / does not touch:**

| Column | On cutover PATCH |
|--------|------------------|
| `runtime_kind` | Set to `daytona` |
| `s3_vault_prefix` | Set to verified prefix |
| `agent_snapshot_id` | Set pin (or leave null to inherit platform default) |
| `presence` | Set `offline` (cold before first wake) |
| `sandbox_id` | Set `null` (no sandbox yet) |
| `ec2_instance_id` | Optional: leave as ops metadata or set `null` — **not** Relay auth |
| `instance_id` | **Unchanged** (PK; not in PATCH body) |
| `secret_hash` / `secret_salt` | **Unchanged** (UPDATE omits credential columns) |
| `credential_rotated_at` | **Unchanged** |

Store helper (same semantics, for scripts/tests):

```ts
await store.updateInstanceRegistry({
  tenant_id,
  instance_id,
  runtime_kind: "daytona",
  s3_vault_prefix: `tenants/${tenant_id}/vault/`,
  agent_snapshot_id: SNAPSHOT, // or null → platform default
  presence: "offline",
  sandbox_id: null,
  actor: "cutover-operator",
  request_id: "cutover-<ticket>",
});
```

### 2.2 Operator sequence (live pilot)

```text
[0] Pre-reqs §1 all green; vault verify PASS attached
        ↓
[1] Short freeze: stop vault-mutating traffic on EC2 gateway
    (same one-writer discipline as vault copy)
        ↓
[2] GET presence / list instance — record instance_id, runtime_kind=ec2,
    secret not re-emitted (hash-only in CP)
        ↓
[3] PATCH registry → runtime_kind=daytona + prefix + snapshot + presence=offline
        ↓
[4] GET presence — confirm:
      instance_id unchanged
      runtime_kind=daytona
      presence=offline
      sandbox_id=null
      s3_vault_prefix matches copy dest
        ↓
[5] Audit: action instance.registry_updated with runtime_kind=daytona
        ↓
[6] Do NOT unfreeze EC2 as primary writer — next step is first wake (§3)
```

### 2.3 Anti-patterns (fail the cutover)

| Do not | Why |
|--------|-----|
| `POST …/instances/register` a second instance | New `instance_id` / secret breaks Relay continuity |
| `POST …/rotate` during flip | Forces secret re-inject; dual identity window |
| Flip only `DAYTONA_ENABLED` | Does not set per-instance path; other tenants unaffected but pilot stays EC2 path |
| Mutate `runtime_kind` inside ensure/stop | Forbidden by dual-path plumbing (`assertRuntimeKindUnchanged`) |
| Point vault prefix at empty/unverified prefix | Agent wakes onto empty or wrong vault |
| Put `sandbox_id` into `GATEWAY_RELAY_*` | Identity model violation |

---

## 3. First `ensure_online` / chat cold wake

After flip, the pilot is **offline** until wake. First cold path:

```text
BFF chat send (or channel adapter)  — when ENSURE_ONLINE_* flags on
        ↓
POST /internal/instances/:instanceId/ensure-online
        ↓
runtime_kind=daytona → Instance Orchestrator
  → allowlist + config ready
  → resolveAgentSnapshotId
  → create/start sandbox (lazy), mount s3_vault_prefix @ VAULT_ROOT
  → inject GATEWAY_RELAY_INSTANCE_ID=<same instance_id> + secret
  → agent dials Relay as instance_id
  → presence online (Relay-connected wait when injected; lp-rr5)
```

| Step | Operator / product action | Pass criteria |
|------|---------------------------|---------------|
| 3.1 | `POST …/ensure-online` with optional `wait_timeout_ms` | `200`, `presence=online`, `runtime_kind=daytona`, `already_online=false` first time |
| 3.2 | Observe `sandbox_id` | Non-null ephemeral handle; **≠** `instance_id` |
| 3.3 | Chat cold path | First user message after idle triggers ensure before deliver-inbound (`lp-y3j`) |
| 3.4 | Gateway env | `GATEWAY_RELAY_INSTANCE_ID` / `GATEWAY_RELAY_ID` = permanent `instance_id` ([gateway-env-contract.md](./gateway-env-contract.md)) |
| 3.5 | Vault visible | Mount shows files from copy (spot-check file count / known path) |
| 3.6 | Presence GET | `online`, same `instance_id`, `s3_vault_prefix` stable |

API shapes: [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md).  
Presence semantics: [presence-state-machine.md](./presence-state-machine.md).

**Failure handling (abort / rollback prep):**

| Symptom | Action |
|---------|--------|
| `403` Daytona path gated | Fix allowlist / `DAYTONA_ENABLED`; leave kind or flip back per `lp-ky7` |
| `502` wake failed | Inspect orchestrator metrics / redacted logs; do not rotate secret blindly |
| `504` timeout | Increase wait or fix snapshot/Relay; presence may be `error` |
| Empty vault | Stop using daytona path; verify S3 prefix; rollback kind → `ec2` (`lp-ky7`) |
| Agent auth fail on Relay | Confirm secret inject used **existing** credentials; do not re-register |

---

## 4. Validation gates (post-cutover)

Run in order; record results on the ticket.

### 4.1 Identity continuity

- [ ] `instance_id` equal pre/post flip  
- [ ] Secret not rotated (`credential_rotated_at` unchanged; no new show-once secret)  
- [ ] Relay still authenticates the same gateway identity  
- [ ] `sandbox_id` is present only while online and never used as auth  

### 4.2 Dual-run isolation

- [ ] Sibling / other tenants still `runtime_kind=ec2` and always-on path  
- [ ] Idle reaper / stop only target this daytona instance  
- [ ] No global config required for coexistence  

### 4.3 Vault + compute

- [ ] S3 prefix content matches post-copy verify (optional `--verify-only` re-check)  
- [ ] Write from agent lands on S3 mount (sparse/packed I/O policy: [vault-io-pilot-decision.md](./vault-io-pilot-decision.md))  
- [ ] Idle stop → presence `offline`, `sandbox_id` cleared; re-wake remounts **same** prefix  

### 4.4 Product path

- [ ] Portal chat send after cold start succeeds (ensure_online before deliver)  
- [ ] Channel adapter (if in pilot scope) gated the same way  
- [ ] Mid-turn protection does not stop during active turn (`lp-053`)  

### 4.5 Observability (no secrets)

- [ ] Audit row `instance.registry_updated` with `runtime_kind=daytona`  
- [ ] Orchestrator metrics: wake success / latency (see [sandbox-orchestrator-metrics.md](./sandbox-orchestrator-metrics.md))  
- [ ] Logs: `daytonaConfigLogSummary` fields only (api key = configured/missing)  

### 4.6 Soak before EC2 decommission

- [ ] Agreed soak window (pilot policy) with zero P0 on identity/vault  
- [ ] EC2 host left intact until soak complete — **do not** run `lp-u00` yet  
- [ ] Rollback procedure reviewed (`lp-ky7`)  

---

## 5. Residual: live pilot cutover (operator AWS + Daytona)

**This bead’s offline path does not perform live cutover.** Live execute requires:

| Residual | Why blocked offline / hold |
|----------|----------------------------|
| Operator AWS lab credentials + freeze on real EC2 | No live host in offline dry-run |
| Vault `--execute --verify` residual from `lp-3ux` | May still be open for real pilot host |
| `DAYTONA_*` secrets + org in CP env | Not in git; operator inject only |
| Tenant on `DAYTONA_TENANT_ALLOWLIST` in that env | Env-specific |
| Live snapshot pin (`lp-1wa` / bump runbook) | Placeholder ok offline only |
| Relay public WSS healthy | [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md); OPERATOR HOLD may still apply |
| First real `ensure_online` + chat prove | Paid/live Daytona + Relay |

Track residual under Phase 7 ops when lab access and hold policy allow. Do **not** bypass OPERATOR HOLD to force staging re-enable.

### Live execute checklist (when residual clears)

```text
[ ] §1 pre-reqs green with real verify-report
[ ] §2 PATCH flip; identity checks
[ ] §3 ensure_online + chat cold wake
[ ] §4 validation gates + soak
[ ] File follow-ups: lp-ky7 readiness; lp-u00 only after soak
```

---

## Offline dry-run evidence

No live AWS, no Daytona API, no secret material.

```bash
# From monorepo root
bash deploy/scripts/smoke-cutover-ec2-to-daytona.sh
```

Expected coverage:

| Check | Pass criteria |
|-------|----------------|
| Checklist present | `docs/plans/0008-daytona-agent-sandboxes/cutover-ec2-to-daytona.md` |
| Doc axes | Pre-reqs, flip keep credentials, first ensure_online, validation gates, residual live |
| API surface | `PATCH …/registry` + `runtime_kind` in `instanceRegistrySchema` |
| Credential safety | Registry UPDATE SQL omits `secret_hash` / `secret_salt` |
| Dual-run tests | `runtime-kind-dual-run.test.ts` registry flip → real harness ensure_online |
| Vault prereq link | Points at `lp-3ux` runbook + smoke |
| Cross-links | dual-run / vault-copy / issue-map mention `lp-6h8` |
| AWS / Daytona | Not invoked |

Optional deeper offline proof (when package deps installed):

```bash
cd portal && npm test -- workspace @lanyard/control-plane -- runtime-kind-dual-run
```

Postgres store cases in that file skip without `DATABASE_URL` / `CONTROL_PLANE_DATABASE_URL`; real harness dual-path cases always run.

### Dry-run walkthrough (recorded against fixtures/docs)

This is the **recorded dry-run** for `lp-6h8` acceptance (not a live pilot cutover).

| Checklist step | Offline stand-in | Result |
|----------------|------------------|--------|
| 1.1 Dual-run | Doc + `runtime-kind-dual-run.test.ts` + `runtime-path.ts` | Field is per-instance; coexistence proven on real harness |
| 1.2 Vault copy | `bash deploy/scripts/smoke-copy-vault-ec2-to-s3.sh` (lp-3ux) | Fixture file count + sha256 PASS; live residual remains |
| 1.3 Allowlist | [cp-daytona-config.md](./cp-daytona-config.md) fail-closed rules | Empty allowlist denies; pilot must be listed live |
| 1.4 Snapshot pin | [agent-snapshot-pin.md](./agent-snapshot-pin.md) resolution order | Instance pin or `DAYTONA_DEFAULT_SNAPSHOT` |
| 2 Flip | Registry PATCH schema + dual-run test `registry update can set runtime_kind` | `ec2`→`daytona`; then real harness `ensure_online` |
| 2 Keep credentials | UPDATE columns review | No secret columns in registry UPDATE |
| 3 First wake | real harness ensure after flip in dual-run test | `presence=online`, `sandbox_id` fake-*, kind stable |
| 4 Gates | Documented checklist | Live soak residual |
| 5 Live residual | Explicit in this doc + smoke | Operator AWS+Daytona required |

Date recorded: **2026-08-05** (offline path).  
Smoke script re-runs the doc/code evidence without network.

---

## Rollback pointer

If post-flip validation fails:

1. Prefer **`lp-ky7`**: flip `runtime_kind` back to `ec2` via same registry PATCH; stop ephemeral sandbox if any.  
2. Keep EC2 vault as source of truth until re-copy.  
3. Do not decommission EC2 (`lp-u00` only after successful soak).

---

## Safety

- No secrets in checklist tickets, smoke output, or manifests.  
- Prefer thrifty lab usage; no thrash create/delete loops.  
- Respect pilot bucket “do not destroy” (`lp-d26`).  
- Staging OPERATOR HOLD: localhost / lab only until hold lifted.  
- Guest agent never receives Daytona API keys.

## See also

- Dual-run field: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) (`lp-gu2`)  
- Vault copy: [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) (`lp-3ux`)  
- Identity: [identity-model.md](./identity-model.md)  
- Orchestrator API: [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)  
- Next: rollback `lp-ky7` · EC2 decommission `lp-u00`
