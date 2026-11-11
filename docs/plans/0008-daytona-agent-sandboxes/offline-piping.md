# Offline piping track (under `lp-kng`)

**Epic:** `lp-kng.2` — Offline piping: contracts, fakes, stubs, docs (no live AWS/Daytona)  
**Parent:** `lp-kng` (Daytona sandboxes)  
**Status:** **Offline DoD met** (2026-07-31). Exit evidence: **[offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md)** (`lp-kng.2.12`). Live Phase 0 / AWS still gated by human gate `lp-kng.1`.

## Purpose

Tee up **all the piping** for on-demand Daytona agent sandboxes **without**:

- Terraform apply to AWS platform or tenant stacks  
- Creating real S3 vault buckets  
- Pushing images to ECR  
- Calling paid/managed Daytona APIs for real sandboxes  
- Cutting over real tenants  

**In scope:** types, docs, fakes, unit-tested orchestrator logic, feature-flagged call sites, local Dockerfile skeleton, provision docs.

## Normative design (when overview is present)

- Identity model (`instance_id` / `sandbox_id` / S3 vault prefix): **[identity-model.md](./identity-model.md)** / overview **§2.3** (`lp-707`)  
- Gateway env contract (EC2 name parity for Daytona): **[gateway-env-contract.md](./gateway-env-contract.md)** (`lp-vey`)  
- CP Daytona config schema (API key / org / region / default snapshot / allowlist): **[cp-daytona-config.md](./cp-daytona-config.md)** (`lp-k8n`)  
- Agent snapshot pin convention (placeholder ok offline; links Phase 2 pipeline): **[agent-snapshot-pin.md](./agent-snapshot-pin.md)** (`lp-kng.2.7`)  
- CP internal orchestrator API stubs (ensure-online / presence / signal-activity / stop): **[cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)** (`lp-biq`)  
- Agent guest + CLI prebake: plan overview **§4.3**  
- Deploy split (platform TF vs lazy sandbox): plan overview **§4.11**  
- Provision runbook daytona branch (no EC2 TF, lazy sandbox): **[provision-runbook-daytona.md](./provision-runbook-daytona.md)** (`lp-kng.2.10`)  
- Human prerequisites for *live* work: plan overview **§14** / bead `lp-kng.1`

If full `overview.md` is missing from the tree, those sections live in bead design notes and prior planning; restore overview before live Phase 0.

## Hierarchy

```text
lp-kng  (root Daytona epic)
├── lp-kng.1  Human prerequisites (parked — live only)
├── lp-kng.2  Offline piping  ← THIS TRACK
│   ├── lp-e0j   Phase 1: Contracts and data model
│   │   ├── lp-707  Identity model doc
│   │   ├── lp-nye  CP model fields
│   │   ├── lp-eya  Presence types
│   │   ├── lp-biq  Internal API stubs
│   │   ├── lp-k8n  CP config schema (keys as schema only)
│   │   ├── lp-7v5  Daytona client interface + fake
│   │   └── lp-vey  Gateway env contract doc
│   ├── lp-kng.2.1  ensure_online + singleflight on fake
│   ├── lp-kng.2.2  presence + signal-activity + idle reaper tests
│   ├── lp-kng.2.3  webhook parse + presence map (test vectors)
│   │     code: portal/packages/control-plane/src/daytona-webhook.ts
│   │     tests: portal/packages/control-plane/test/daytona-webhook.test.ts
│   ├── lp-kng.2.4  S3 vault prefix layout doc (not applied) → [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md)
│   ├── lp-kng.2.5  IAM mount policy draft (not applied) → [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md)
│   ├── lp-kng.2.6  Dockerfile + entrypoint skeleton (no ECR)
│   │     code: deploy/daytona/agent-gateway/{Dockerfile,entrypoint.sh}
│   ├── lp-kng.2.7  agent_snapshot_id pin convention
│   ├── lp-kng.2.8  BFF chat ensure_online behind flag
│   ├── lp-kng.2.9  brain_rpc + channel adapter stubs behind flag
│   ├── lp-kng.2.10 provision runbook daytona branch (docs) → [provision-runbook-daytona.md](./provision-runbook-daytona.md)
│   ├── lp-kng.2.11 runtime_kind dual-path plumbing
│   │     code: portal/packages/control-plane/src/runtime-path.ts
│   │     (+ orchestrator ensure/stop branch; real Daytona client (via harness-local) offline)
│   └── lp-kng.2.12 exit evidence summary
├── lp-6tq …  Phase 0 spike (live — after lp-kng.1)
└── other live phases (image push, real orchestrator SDK, …)
```

## Wave order (recommended)

### Wave A — Phase 1 (start here)

1. `lp-707` identity doc  
2. `lp-nye` model fields  
3. `lp-eya` presence types → `lp-biq` API stubs  
4. `lp-k8n` config schema → `lp-7v5` client + fake  
5. `lp-vey` env contract (parallel after `lp-707`)

### Wave B — Orchestrator offline

6. `lp-kng.2.1` ensure_online on fake  
7. `lp-kng.2.2` presence / activity / reaper  
8. `lp-kng.2.3` webhook parse tests  
9. `lp-kng.2.11` runtime_kind dual-path  

### Wave C — Docs / image skeleton (parallel where deps allow)

10. `lp-kng.2.4` S3 layout → `lp-kng.2.5` IAM draft  
11. `lp-kng.2.6` Dockerfile skeleton (after `lp-vey`)  
12. `lp-kng.2.7` snapshot pin convention  
13. `lp-kng.2.10` provision runbook  

### Wave D — Call sites

14. `lp-kng.2.8` BFF flag hook  
15. `lp-kng.2.9` brain_rpc / adapter stubs  

### Wave E — Close

16. `lp-kng.2.12` exit evidence  

## Hard rules while on this track

| Do | Do not |
|----|--------|
| Use fake Daytona client | Call real Daytona create/start with org key |
| Document S3/IAM | `terraform apply` for vault or tenants |
| Local `docker build` optional | ECR push / Daytona snapshot register |
| Feature flag ensure_online default off | Wake production or shared staging tenants |
| Keep `runtime_kind=ec2` as default path | Flip real customers to daytona |
| Branch on instance `runtime_kind` (`lp-kng.2.11`) | Mutate `runtime_kind` inside ensure/stop |

### BFF chat ensure_online flag (`lp-kng.2.8` → Phase 5 `lp-y3j`)

| Item | Value |
|------|--------|
| Env | `ENSURE_ONLINE_ON_CHAT` (default **off**) |
| Call site | Chat send → `ensureOnlineBeforeChatDeliver` → then relay deliver-inbound |
| Code | `portal/packages/bff/src/ensure-online-chat.ts` + shared `ensure-online-hook.ts` |
| Extra gate | Even when flag on, skips ensure-online unless `runtime_kind=daytona`; already-online skips wake POST |
| Tests | `portal/packages/bff/test/ensure-online-chat.test.ts` (fake client) |
| Phase 5 | `lp-y3j` — offline triggers wake; online skips wake; CP wake body is `lp-nus` |
| Agent starting SSE | `lp-u7z` — BFF emits `agent_starting` / `agent_ready` / timeout `error` on chat events SSE while ensure_online runs (`agent-starting-events.ts`, `thread-live-events.ts`; tests: `agent-starting-events.test.ts`) |

Do not enable this flag against shared staging/prod until live Phase 5 + `lp-kng.1`.

### Brain RPC + channel adapter ensure_online stubs (`lp-kng.2.9`)

Shared core: `portal/packages/bff/src/ensure-online-hook.ts` → `ensureOnlineIfNeeded`.

| Path | Env (default **off**) | Helper | Call site |
|------|----------------------|--------|-----------|
| Brain RPC | `ENSURE_ONLINE_ON_BRAIN_RPC` | `ensureOnlineBeforeBrainRpc` | Before relay `invokeBrainRpc` (production invoker + `/api/brain/ping` / `health`) |
| Channel adapter | `ENSURE_ONLINE_ON_CHANNEL_ADAPTER` | `ensureOnlineBeforeChannelInbound` + `deliverChannelAdapterInbound` (`lp-e23`) | Adapter inbound handoff (representative: **Slack** + **email**); primary `instance_id` only — no per-channel gateway |

| Item | Value |
|------|--------|
| Code | `ensure-online-brain-rpc.ts`, `ensure-online-channel-adapter.ts` |
| Binding | `BffBindings.ensureOnlineOnBrainRpc` / `ensureOnlineOnChannelAdapter` |
| Extra gate | Same as chat: flag off → no CP; flag on + non-daytona → presence only |
| Tests | `portal/packages/bff/test/ensure-online-brain-rpc-channel.test.ts` (fake client) |

Offline: leave both flags **off**. No live Daytona / AWS from these stubs.

## Definition of done (`lp-kng.2`)

- [x] All children closed (or waived with reason on the bead)  
- [x] Unit tests prove wake/stop/idle against **fake** only  
- [x] Docs for identity, env, S3 layout, provision daytona branch → [provision-runbook-daytona.md](./provision-runbook-daytona.md)
- [x] BFF (and stubs) call sites exist behind flag  
- [x] Exit summary `lp-kng.2.12` written → **[offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md)**  
- [x] Ready for Phase 0 **only after** `lp-kng.1` is filled *(explicit: offline complete; live still gated)*  

Full child table, PR/test evidence, and non-requirements: **[offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md)**.

## Next commands (after offline DoD)

```bash
bd show lp-kng.2.12
bd show lp-kng.1          # human gate — still required for Phase 0
# Do not claim Phase 0 (lp-6tq) until lp-kng.1 is filled and closed.
```

Do **not** wave-drain full `lp-kng` live phases until human gate `lp-kng.1` is filled.
