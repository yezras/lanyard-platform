# 0017 — First-chat sandbox speed

**Status:** Locked. Platform Fargate and ONLYOFFICE stay up. Speed the Daytona wake that blocks Send.
**Date:** 2026-08-24
**Playbooks:** pstack multi-phase plan, hillclimb (metric: `time_to_agent_ready_ms`), perf-issue families (scheduling, elimination, lazy).
**Related:** [0008 Daytona](../0008-daytona-agent-sandboxes/overview.md), [warm-pool stub](../0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md) (`lp-6bg` closed as stub), [presence](../0008-daytona-agent-sandboxes/presence-state-machine.md), Mountpoint first-write `lp-puzc`, CloudFront clip `lp-sjn9`, [0015 short stack](../0015-short-stack/overview.md).
**Beads:** epic `lp-vqr0` from [create-beads.sh](create-beads.sh). [issue-map.md](issue-map.md). [testing.md](testing.md). [checkpoint.md](checkpoint.md).

## Context

First chat on MockLab feels slow. Users wait on Send. Daytona `started` is not product-ready. Product-ready is gateway (or harness) able to take a turn.

Measured Daytona API only (empty snapshot, `lp-bnd`):

| Path | p50 | p95 |
|------|-----|-----|
| create-from-snapshot | 0.7s | 19s |
| start-from-stopped | 2.8s | 5s |
| Live re-wake `lp-8sn` | ~1.1s | |

The wait on first Send is the rest: `mount-s3`, post-mount writable (default 120s, live 1200s), gateway exec, Relay WSS. Evening cold creates ran 10–17 min (`lp-sjn9`). CloudFront BFF origin timeout is **60s** (`portal-static-edge` `origin_read_timeout`). A POST that waits the full wake 504s.

Human lock from 2026-08-24:

- No 45–120s first `/api` from sleeping BFF/Relay/CP.
- Do not sleep ONLYOFFICE / document server (DS) to save money.
- First Daytona chat must be much faster (seconds, not minutes).

## Who this is for

| Audience | What changes |
|----------|----------------|
| Tenant user | Send on a bound stopped sandbox is start-from-stopped. Target **< 5s** to `agent_ready`. First visit of the day uses the same path because create+mount already happened. |
| Implementer | real harness tests first. No terraform apply. OPERATOR HOLD still forbids restaging the VPC. |
| Maintainer | `agent_ready` is Relay (or harness) up. Vault writable is a separate flag. |

## SLO

Hillclimb metric is `time_to_agent_ready_ms`. The frozen ruler is [testing.md](testing.md).

| Metric | Offline stop |
|--------|----------------|
| `time_to_agent_ready_ms` | Fake `start_from_stopped` Send < 5000ms |
| `cold_create` count on first Send when `sandbox_id` bound | zero |
| Chat POST wall while a wake is in flight | < 15s with `agent_starting` |

Sleeping Fargate or DS is rejected as a speed fix. **No Fargate/DS sleep.** Do not stop BFF, Relay, CP, or ONLYOFFICE / document server. A green SLO is a Daytona or harness path, not a platform cold start.

## Data model

Wake path is a closed set of labels (already emitted by orchestrator metrics), not a pile of booleans:

| `path` | Meaning | Allowed on Send when `sandbox_id` bound |
|--------|---------|------------------------------------------|
| `already_online` | Sandbox running, Relay/harness up | yes |
| `start_from_stopped` | Bound id, Daytona start | yes (target) |
| `warm_pool` | Claim a pre-created stopped id, then start | only when unbound, then bind |
| `cold_create` | Daytona create from snapshot pin | **never** on that Send |
| `archive_restore` | Bound archived id, start-as-restore | rare; not the first-chat path |

Readiness is two independent flags. Do not fold them into one `online`:

| Flag | True when | Blocks chat Send |
|------|-----------|------------------|
| `agent_ready` | Guest Relay connected, or short-stack harness reachable | yes, until true (via `agent_starting` then retry/SSE) |
| `vault_writable` | Mountpoint accepted a write | no. File tools may wait. Presence may be `online` anyway. |

Presence `online` means `agent_ready`. Treating Mountpoint first-write as a gate for `wake_succeeded` is the illegal state this epic deletes.

Chat POST while a wake is in flight returns or streams `agent_starting`. It does not hold the CloudFront origin for `wait_timeout_ms`.

## Scope

### In

1. **SLO + harness.** One command/tests emit `time_to_agent_ready_ms` by path (`already_online`, `start_from_stopped`, `cold_create`, `warm_pool`). Fake clock. Frozen ruler.
2. **Send is not cold create.** If `sandbox_id` is bound, first Send is `start_from_stopped`. If null, create happened earlier (provision, `/chat` land, or warm pool), not on the click.
3. **Chat POST does not wait out wake.** Under CloudFront 60s. Return/stream `agent_starting` and finish wake on the singleflight. Client retries or waits on SSE.
4. **Speculative wake** when the user opens `/chat` (or logs in to chat). Hides the 1–5s start-from-stopped.
5. **Warm pool is real.** Claim a pre-created stopped sandbox on the LA snapshot. Replenish off the interactive path. `lp-6bg` only stubbed the flag.
6. **Product-ready ≠ vault writable.** Promote `online` when Relay is connected (guest) or harness is reachable (short-stack). Do not hold the gateway on `LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC`. File tools can wait on `vault_writable`.
7. **No-tool harness turns** do not `ensure_online` the sandbox. Tool turns still wake.
8. **Hillclimb stop.** Fake path: bound stopped sandbox, Send → `start_from_stopped`, `time_to_agent_ready_ms` < 5000 on the fake clock; **zero** `cold_create` on that Send. Live MockLab proof is a residual behind OPERATOR HOLD + `lp-puzc`.

### Out (non-goals)

- **No Fargate/DS sleep.** Do not stop BFF, Relay, CP, RDS, NAT, ALB, or ONLYOFFICE / document server to save idle cost. Platform Fargate and DS stay always-on. First-chat speed is the Daytona wake, not a platform cold start.
- Cloudflare migration of the platform host. That direction is [plan 0020](../0020-cloudflare-platform-revamp/overview.md) (`lp-bhcg`), not this speed epic.
- Merging public ALBs (optional later, not this epic).
- Linux-VM isolation change.
- Fixing S3/Mountpoint first-write physics (`lp-puzc` stays its own bug). This epic **stops blocking chat** on that physics.
- Raising CloudFront to 180s as the primary fix (`lp-sjn9`). Detach the POST instead.

## Constraints

- OPERATOR HOLD: no `terraform apply` that re-enables platform-staging compute. No `ecs update-service --desired-count 1` unless a human lifted the hold.
- Identity: `instance_id` permanent; `sandbox_id` ephemeral; vault prefix durable ([identity-model](../0008-daytona-agent-sandboxes/identity-model.md)).
- Retain-on-stop already default (`DAYTONA_RETAIN_SANDBOX_ON_STOP`).
- BFF must not import `@aws-sdk/client-s3`. CP is the Daytona client.
- `ensure_online` singleflight and Relay wait (`lp-rr5`) stay. Change *when* they run, not the identity rules.
- Live Daytona spend: warm pool size cap 1–2 for MockLab. Replenish is thrifty.

## Alternatives

| Approach | Verdict |
|----------|---------|
| Sleep Fargate, wake on first API | Rejected. 45–120s first API. No Fargate/DS sleep. |
| Sleep ONLYOFFICE / DS | Rejected. Same non-goal. |
| Hold Send until Mountpoint writable | Rejected. That is the minutes. |
| Raise CloudFront origin timeout | Not sufficient. Wake still minutes. Detach POST. |
| Create on first Send, optimize mount | Rejected for the click. Scheduling: create earlier. |
| Warm pool + retain + speculative wake + split vault vs agent_ready | **Chosen.** Send uses the fast path already measured. |

## Principles and scope (playbook first step)

Bead `lp-vqr0.1`. Feature playbook step 1. Not product code.

In, out, and the Fargate/DS rejection live in [Scope](#scope). SLO lives in [SLO](#slo). Each named principle below changed a concrete choice.

| Principle | Choice it changed |
|-----------|-------------------|
| experience-first | Keep platform Fargate and ONLYOFFICE always-on. First chat is Daytona start-from-stopped, not a 45-120s platform cold start to save idle money. |
| fix-root-causes | Do not paper Mountpoint first-write with a 1200s entrypoint sleep. Split `agent_ready` from `vault_writable` so chat does not wait on S3 physics (`lp-puzc`). |
| build-the-lever | Freeze the real harness SLO harness (T9) before behavior PRs. Reviewers rerun the histogram. |
| sequence-verifiable-units | One path label green before the next. Harness, then types, then send-not-create, then detach POST. |
| make-operations-idempotent | `ensure_online`, pool claim, speculative wake, and create-ahead converge. A re-run does not double-create. |
| separate-before-serializing-shared-state | One CP writer for warm pool rows. BFF never mutates the pool. The pool store is not the instance table. |

Also applied on this plan:

- `how` on `instance-orchestrator.ts` before changing wake order.
- `principle-model-the-domain`. Wake `path` union plus two readiness flags, not extra booleans.
- `principle-laziness-protocol`. Record here. Do not add a second plan file.
- `principle-foundational-thinking`. Path labels and flags before orchestrator branch edits.
- `principle-redesign-from-first-principles`. Product-ready is Relay or harness up, as if vault writable had never gated `online`.
- `principle-boundary-discipline` and `principle-type-system-discipline`. Parse presence at the CP edge. `online` only after writable is illegal.
- `principle-prove-it-works`. Grep this file for `architect skipped`.
- `unslop` on PR bodies.
- `show-me-your-work`. `.audit/sandbox-first-chat-speed.tsv`.

`architect skipped: wake order and non-goals locked in the 2026-08-24 product thread. Alternatives table above is the design record.`

## Phases

See [issue-map.md](issue-map.md). Fan-out map is [checkpoint.md](checkpoint.md). Each phase bead has verification in [testing.md](testing.md).

1. Plan docs (this directory).
2. Frozen SLO harness (real harness, T9).
3. Readiness model: `agent_ready` vs `vault_writable`.
4. Send never `cold_create` when bound.
5. Detach chat POST from wake wait.
6. Speculative wake on `/chat`.
7. Warm pool claim + replenish (fake, then live residual).
8. Harness no-tool without sandbox.
9. Entrypoint: gateway not gated on post-mount writable.
10. Live MockLab residual (hold + `lp-puzc`).

## Verification

Offline (every PR):

```bash
bash scripts/validate.sh
pnpm --filter @lanyard/control-plane test
pnpm --filter @lanyard/bff test
```

Targeted files named on each bead. Live MockLab is not required to merge phases 2–9.

This plan-docs bead (`lp-vqr0.3`):

```bash
test -f docs/plans/0017-sandbox-first-chat-speed/overview.md \
  && test -f docs/plans/0017-sandbox-first-chat-speed/testing.md \
  && test -f docs/plans/0017-sandbox-first-chat-speed/issue-map.md \
  && test -f docs/plans/0017-sandbox-first-chat-speed/checkpoint.md \
  && test -f docs/plans/0017-sandbox-first-chat-speed/create-beads.sh
```

This playbook-principles bead (`lp-vqr0.1`):

```bash
grep -F 'architect skipped' docs/plans/0017-sandbox-first-chat-speed/overview.md
grep -F 'experience-first' docs/plans/0017-sandbox-first-chat-speed/overview.md
grep -F 'No Fargate/DS sleep' docs/plans/0017-sandbox-first-chat-speed/overview.md
```

## Implementation guidance

- real harness and existing `warm-pool-snapshot-wake.test.ts` / `ensure-online-*.test.ts` are the pattern.
- Do not enable `DAYTONA_WARM_POOL_ENABLED` against the paid org from CI.
- Do not set `LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC=1200` as the product default.
- Encode the SLO in a test that fails if Send on a bound stopped instance calls `create`.
