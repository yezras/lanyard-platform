# Offline piping exit evidence (`lp-kng.2.12`)

**Bead:** `lp-kng.2.12`  
**Epic:** `lp-kng.2` — Offline piping: contracts, fakes, stubs, docs (no live AWS/Daytona)  
**Parent plan:** [offline-piping.md](./offline-piping.md) · [overview.md](./overview.md) · [issue-map.md](./issue-map.md)  
**Recorded:** 2026-07-31  

## Verdict

**Offline piping Definition of Done is met.**

All offline track leaf children are **closed** with PR/commit evidence. Phase 1 sub-epic `lp-e0j` has **7/7** leaves closed and is eligible for close as a tracking shell. No terraform apply, no live S3 bucket create, no ECR push, and no paid/managed Daytona org API call were required to complete this track.

### Ready for Phase 0 (live spike)

**Ready for Phase 0 (`lp-6tq` and later live phases) only when human gate `lp-kng.1` is filled and closed.**

Offline piping does **not** unblock live AWS or real Daytona sandboxes by itself. `lp-kng.1` remains the parked human checklist (Daytona org / API key location / billing, AWS lab S3, Relay WSS test instance, later ECR + CP secret path + go/no-go owner). Agents must not drain live `lp-kng` phases until that gate closes.

## Offline DoD checklist (`lp-kng.2`)

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Phase 1 contracts epic (`lp-e0j`) complete | **Met** | All 7 Phase 1 leaves closed (table below); epic shell 7/7 |
| Orchestrator wake/stop/idle unit-tested against fake Daytona only | **Met** | `lp-7v5`, `lp-kng.2.1`, `lp-kng.2.2`, `lp-kng.2.3`, `lp-kng.2.11` |
| S3 layout + IAM policy drafts documented (not applied) | **Met** | [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md), [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md), [drafts/iam/](./drafts/iam/) |
| Dockerfile/entrypoint skeleton exists; no ECR push required | **Met** | `deploy/daytona/agent-gateway/` (`lp-kng.2.6`) |
| BFF/adapters call `ensure_online` behind flag (default off) | **Met** | `lp-kng.2.8`, `lp-kng.2.9` — flags default **off** |
| Provision runbook has daytona branch (docs only) | **Met** | [provision-runbook-daytona.md](./provision-runbook-daytona.md) (`lp-kng.2.10`) |
| No TF apply / no real S3 / no paid Daytona required to close epic | **Met** | Entire track offline; fakes + docs + feature flags |
| Exit evidence summary written | **Met** | This document (`lp-kng.2.12`) |

## Explicit non-requirements (offline track)

The following were **not** performed and are **not** required to close `lp-kng.2`:

- `terraform apply` against platform or tenant stacks  
- Creating real S3 vault buckets or applying IAM policies  
- Pushing images to ECR or registering live Daytona snapshots  
- Calling paid/managed Daytona APIs to create real sandboxes  
- Enabling `ENSURE_ONLINE_ON_*` flags against shared staging/prod  
- Filling human gate `lp-kng.1`  

Live work remains under later epics (`lp-6tq` Phase 0 spike, image pipeline, vault apply, real SDK, etc.) **after** `lp-kng.1`.

## Closed children (offline leaves)

### Wave A — Phase 1 contracts (`lp-e0j`)

| Bead | Title | Status | Close evidence (abbrev.) |
|------|-------|--------|--------------------------|
| `lp-707` | Identity model doc | ✓ closed | [identity-model.md](./identity-model.md); PR #215 |
| `lp-nye` | CP model fields (`runtime_kind`, `sandbox_id`, presence, snapshot, S3 prefix) | ✓ closed | migrate + store maps; PR #220 |
| `lp-eya` | Presence state machine types | ✓ closed | offline\|waking\|online\|error; PR #221; unit 21 PASS |
| `lp-biq` | CP internal API stubs | ✓ closed | [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md); PR #224 |
| `lp-k8n` | CP Daytona config schema | ✓ closed | [cp-daytona-config.md](./cp-daytona-config.md); schema only offline |
| `lp-7v5` | Daytona client interface + fake | ✓ closed | `real Daytona client (via harness-local)` lifecycle offline; unit PASS |
| `lp-vey` | Gateway env contract (EC2 name parity) | ✓ closed | [gateway-env-contract.md](./gateway-env-contract.md); PR #219 |

**Sub-epic:** `lp-e0j` — 7/7 leaves closed; eligible for close as tracking shell (no open Phase 1 leaf work).

### Wave B — Orchestrator offline

| Bead | Title | Status | Close evidence (abbrev.) |
|------|-------|--------|--------------------------|
| `lp-kng.2.1` | `ensure_online` + singleflight on fake | ✓ closed | PR #225; 16 ensure-online tests PASS |
| `lp-kng.2.2` | Presence + signal-activity + idle reaper | ✓ closed | PR #228; 17 tests PASS offline |
| `lp-kng.2.3` | Webhook payload parse + presence map | ✓ closed | CP `daytona-webhook`; 30 unit tests PASS |
| `lp-kng.2.11` | `runtime_kind` dual-path plumbing | ✓ closed | PR #227; ec2 unchanged; daytona on fake |

### Wave C — Docs / image skeleton

| Bead | Title | Status | Close evidence (abbrev.) |
|------|-------|--------|--------------------------|
| `lp-kng.2.4` | S3 vault prefix layout design | ✓ closed | [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md); PR #218; not applied |
| `lp-kng.2.5` | IAM scoped S3 mount policy draft | ✓ closed | [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) + drafts JSON; not applied |
| `lp-kng.2.6` | Dockerfile + entrypoint skeleton | ✓ closed | `deploy/daytona/agent-gateway/`; PR #233; no ECR |
| `lp-kng.2.7` | `agent_snapshot_id` pin convention | ✓ closed | [agent-snapshot-pin.md](./agent-snapshot-pin.md); placeholder offline |
| `lp-kng.2.10` | Provision runbook daytona branch | ✓ closed | [provision-runbook-daytona.md](./provision-runbook-daytona.md); PR #229 |

### Wave D — Call sites (feature-flagged)

| Bead | Title | Status | Close evidence (abbrev.) |
|------|-------|--------|--------------------------|
| `lp-kng.2.8` | BFF chat `ensure_online` behind flag | ✓ closed | `ENSURE_ONLINE_ON_CHAT` default off; PR #226 |
| `lp-kng.2.9` | brain_rpc + channel adapter stubs | ✓ closed | flags default off; PR #231 |

### Wave E — Close

| Bead | Title | Status | Notes |
|------|-------|--------|-------|
| `lp-kng.2.12` | Exit evidence summary | This bead | Document you are reading |

## Key artifacts (durable)

| Area | Path / surface |
|------|----------------|
| Offline track plan | [offline-piping.md](./offline-piping.md) |
| Overview + locked decisions | [overview.md](./overview.md) |
| Issue map | [issue-map.md](./issue-map.md) |
| Identity | [identity-model.md](./identity-model.md) |
| Gateway env | [gateway-env-contract.md](./gateway-env-contract.md) |
| CP config | [cp-daytona-config.md](./cp-daytona-config.md) |
| Snapshot pin | [agent-snapshot-pin.md](./agent-snapshot-pin.md) |
| Internal API | [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md) |
| Presence types | [presence-state-machine.md](./presence-state-machine.md) |
| S3 layout | [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) |
| IAM drafts | [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md), [drafts/iam/](./drafts/iam/) |
| Provision daytona | [provision-runbook-daytona.md](./provision-runbook-daytona.md) |
| Image skeleton | `deploy/daytona/agent-gateway/` |
| Fake client / orchestrator | `portal/packages/control-plane` (real Daytona client (via harness-local), ensure_online, presence, reaper, webhook, runtime-path) |
| BFF hooks | `portal/packages/bff` (`ensure-online-chat`, brain_rpc, channel adapter; flags default off) |

## Feature flags (default off)

| Env | Default | Purpose |
|-----|---------|---------|
| `ENSURE_ONLINE_ON_CHAT` | **off** | BFF chat pre-deliver ensure_online |
| `ENSURE_ONLINE_ON_BRAIN_RPC` | **off** | Brain RPC path ensure_online |
| `ENSURE_ONLINE_ON_CHANNEL_ADAPTER` | **off** | Channel adapter inbound ensure_online |

Even when a flag is on, ensure-online is a no-op / presence-only path unless `runtime_kind=daytona`. Do not enable against shared staging/prod until live Phase 5 + `lp-kng.1`.

## What remains blocked (out of offline track)

| Item | Gate / owner |
|------|----------------|
| Phase 0 spike (`lp-6tq`) and all live phases | Human gate **`lp-kng.1`** |
| Real Daytona org API, billing, secrets | Human |
| Live S3 vault apply, IAM attach, ECR push | Later live epics after gate |
| Real `ensure_online` wake to managed Daytona | Phase 4–5 live work |
| Tenant cutover to `runtime_kind=daytona` | Phase 6–7+ |

## Operator next steps

1. Close tracking shell `lp-e0j` if still open (leaves already closed).  
2. Close epic `lp-kng.2` after this evidence bead merges (DoD satisfied offline).  
3. **Do not** start Phase 0 / live drain until **`lp-kng.1`** is filled and closed by a human.  
4. When ready for live: fill `lp-kng.1` checklist → claim `lp-6tq` Phase 0 spike.

## Statement of readiness (normative)

> Offline piping for Daytona agent sandboxes is complete: contracts, fakes, unit-tested orchestrator paths, docs (identity, env, S3, IAM drafts, provision), local image skeleton, and feature-flagged call sites (default off).  
> **No live AWS or Daytona was required.**  
> **The monorepo is ready for Phase 0 live spike work when — and only when — human prerequisites bead `lp-kng.1` is filled.**
