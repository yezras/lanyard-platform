# 0017 throughput checkpoint

**Bead:** `lp-vqr0.2`  
**Epic:** `lp-vqr0` First-chat sandbox speed  
**Playbook:** pstack Feature step 3 (four dimensions)  
**Status:** Recorded. Sequencing only. No product code in this bead.

Parent epic notes point here. Issue index is [issue-map.md](issue-map.md). SLO ids are [testing.md](testing.md). Design lock is [overview.md](overview.md).

`architect skipped:` wake order and non-goals locked in the 2026-08-24 product thread. The alternatives table in overview.md is the design record. This note is the fan-out map, not a second architecture pass.

Two shapes considered for this artifact. Four files like plan 0004, or one `checkpoint.md` with four sections. One file wins. The bead acceptance names this path, and a single Feature owner already holds the epic.

## Blocking first steps

Gates run before CP wake-order fan-out. They are not a total serial order of every leaf.

| Gate | Bead | What must exist | Blocks |
|------|------|-----------------|--------|
| G0 Plan docs | `lp-vqr0.3` (closed) | This directory. SLO table. Non-goals include no Fargate/DS sleep. | Nothing left. Already on `main`. |
| G1 Frozen ruler | `lp-vqr0.5` | real harness harness prints `time_to_agent_ready_ms` by path (`already_online`, `start_from_stopped`, `cold_create`, `warm_pool`). Fake clock. T9. | Any PR that claims a wake-path win. Changing buckets requires editing testing.md. |
| G2 Readiness types | `lp-vqr0.4` | CP distinguishes `agent_ready` from `vault_writable`. Presence may go `online` when Relay or harness is up even if Mountpoint is not writable. T3. | Stream A wake-order edits (`lp-vqr0.6`, `.7`, `.10`). Stream D entrypoint (`lp-vqr0.12`) waits on this vocabulary. |

Do not fan out two writers on `instance-orchestrator.ts` until G1 and G2 merge.

Safe to start **now** (G0 only):

- Stream B `lp-vqr0.8` detach chat POST. Depends on plan docs, not on CP types.
- Playbook sibling `lp-vqr0.1` principles + scope.

Do **not** start:

- Stream A `.6` / `.7` / `.10` before G2.
- Stream C `.9` before B1 (`lp-vqr0.8`) exists as a contract the client can join.
- Stream D `.12` before G2. Entrypoint must not invent a third "ready" meaning.
- Stream E `.14` until OPERATOR HOLD and `lp-puzc` allow a MockLab wall-clock proof.

Hillclimb rule. Freeze the ruler (G1) before behavior PRs change path labels.

## Independent workstreams

Disjoint trees parallelize. Shared writes serialize. `/beads-execute` may fan leaves only across **different** streams after the gates above.

| Stream | Owns | Primary paths | Beads | Parallel after gates |
|--------|------|---------------|-------|----------------------|
| A CP orchestrator | Wake order, presence vs vault flag, real harness ruler, warm pool | `portal/packages/control-plane/src/instance-orchestrator.ts`, `presence.ts`, `presence-store.ts`, `orchestrator-metrics.ts`, `fake-daytona-client.ts`, `orchestrator-api.ts`, tests under `portal/packages/control-plane/test/` (`warm-pool-snapshot-wake.test.ts`, `ensure-online-relay.test.ts`, new SLO harness) | `.5` → `.4` → `.6` → then `.7` and `.10` | **Serialized with itself.** One worker on the orchestrator at a time. |
| B BFF chat | Chat POST must not wait the full wake. No-tool harness skip. | `portal/packages/bff/src/ensure-online-chat.ts`, `ensure-online-hook.ts`, `ensure-online-brain-rpc.ts`, `agent-starting-events.ts`, `thread-live-events.ts`, `chat-delivery-send.ts`, `chat-instance-resolve.ts`, `portal/packages/bff/test/ensure-online-chat.test.ts` | `.8` then `.11` | Parallel with A after G0. B1 and B2 serialize with each other (same package, same hook). |
| C Web | Speculative ensure_online when opening `/chat`. `agent_starting` UI already exists. | `portal/apps/web/src/app/ai-chat/`, `portal/apps/web/src/features/chat/` (`ChatView.tsx`, `agentStarting.ts`, `AgentStartingStatus.tsx`), `portal/apps/web/src/hooks/useChatEvents.ts`, `portal/apps/web/src/api/chat.ts` | `.9` | After B1. Client fires or joins the hook. Do not add a second BFF writer from this stream. |
| D Entrypoint | Gateway exec is not gated on post-mount writable timeout. | `deploy/daytona/agent-gateway/entrypoint.sh` and colocated smoke if present | `.12` | After G2. Parallel with remaining A/B. No CP import. Guest process only. |
| E Live residual | MockLab T10 wall-clock pack | `artifacts/` (no secrets) | `.14` | Blocked. Not in first waves. |

Stream B BFF, stream C web, and stream D entrypoint are three streams. They do not share a write target.

- BFF owns HTTP/SSE `agent_starting` / `agent_ready` and whether POST waits on `wait_timeout_ms`.
- Web owns the `/chat` land hook and status copy. It consumes BFF events. It does not call Daytona.
- Entrypoint owns guest boot order. It does not import CP or BFF.

**CP orchestrator is serialized.** `.5`, `.4`, `.6`, `.7`, and `.10` all mutate `instance-orchestrator.ts` or the real harness path union it exports. Two in-flight PRs on that file will fight singleflight, path labels, and `sandbox_id` writes. Split a new pool module out of the orchestrator if `.10` needs space, then keep claim/start in the orchestrator.

CI freeze `lp-vqr0.13` is not a fifth stream. It waits on `.6`, `.8`, `.10`, `.11`, `.12` and names T1-T9 in existing package test scripts.

## Shared mutable state

Default is split the write target. Serialize only when one writer is a real invariant.

| State | Who writes | Split or serialize |
|-------|------------|--------------------|
| Warm pool rows (pre-created stopped sandbox ids for the pin snapshot) | One CP process. In-memory map first (single task). | **Split.** Pool store is not `gateway_instances`. Claim copies `sandbox_id` onto the instance record, then `start`. No BFF writer. Tests never hit the paid org. |
| `sandbox_id` on the instance record | Instance orchestrator only | **Invariant.** One writer. Create-ahead, pool claim, cold create, and retain-on-stop all go through that module. |
| Presence (`offline` / `waking` / `online` / `error`) | Orchestrator via CAS on `gateway_instances.presence` | **Invariant.** BFF POSTs ensure-online and reads. BFF does not patch presence. |
| `vault_writable` (G2) | Guest probe or orchestrator field fed from guest, not from Mountpoint sleep in CP | **Split from presence.** `online` is Relay/harness up. File tools wait on the flag. |
| In-process singleflight map (`instance_id` → wake promise) | One map inside the orchestrator | **Invariant.** Speculative `/chat` wake and Send must join it. A second map in BFF is a bug. |
| Guest vault mount (`/mnt/...`) | Guest `entrypoint.sh` + mount-s3 | **Split.** CP does not remount on every ensure_online (`lp-kng.6`). Stream D may background the writable probe. It must not block gateway exec. |
| Daytona sandbox objects | Daytona API | External. CP is the only platform client (`DaytonaClient`). BFF must not import `@aws-sdk/client-s3` or the Daytona SDK. |

Do not "take turns" on `instance-orchestrator.ts` by convention. One in-flight bead owns that file.

## Smallest safe decomposition

If several workers are available after G0:

1. One worker on stream A (serialized CP). Start G1 harness, then G2 types, then T5 send-not-create.
2. One worker on stream B. Detach POST first (`lp-vqr0.8`). That is the smallest user-visible win. Send stops 504-ing at CloudFront 60s even before warm pool.
3. Stream D starts after G2, in parallel with remaining A and with B2.
4. Stream C starts after B1. Hide the 1 to 5s start-from-stopped. Do not invent create-on-land if `.7` already bound `sandbox_id`.
5. Stream E stays parked.

If only one worker, do not fan out:

`harness (T9) → types (T3) → T5 send-not-create → detach POST (T4) → entrypoint (T8) → pool (T2) → speculative UI (T7) → no-tool (T6) → CI T1-T9 → live T10 residual`

That order exists because the ruler lands before behavior, types land before entrypoint and wake-order, detach POST lands before pool (user-visible without new Daytona spend), and pool lands before speculative UI (speculative wake on a bound stopped sandbox, not a click-create).

One worker on `instance-orchestrator.ts` at a time even in the multi-worker case. Do not parallel two CP wake-order beads.

## Fan-out rule

`beads-execute` (or a human agent) may claim a leaf when:

1. This checkpoint is current (or a newer note on `lp-vqr0` supersedes it).
2. The leaf's stream is not already claimed against the same write files.
3. Stream A leaves respect G1/G2 and the serialized chain in [issue-map.md](issue-map.md).
4. Stream C does not add BFF routes. Stream D does not edit CP. Stream B does not edit `entrypoint.sh`.
5. No leaf runs `terraform apply`, sleeps Fargate, or sleeps ONLYOFFICE.

Rewrite this checkpoint if a phase boundary changes stream ownership.

## Principles applied

- **Model the domain.** Wake `path` union and `agent_ready` vs `vault_writable`, not extra booleans on presence.
- **Foundational thinking.** Ruler and types before wake-order branches.
- **Laziness protocol.** One checkpoint file. Reuse ensure_online singleflight. Do not add a BFF Daytona client.
- **Separate before serializing shared state.** Pool map split from instance table. One orchestrator writer for `sandbox_id`.
- **Boundary discipline.** Daytona and S3 stay behind CP. BFF validates HTTP. Entrypoint validates guest env. Web does not call Daytona.
- **Type system discipline.** Illegal combo is presence `online` meaning "vault writable". Split the flag.
- **Build the lever.** real harness SLO harness is the reviewer command. Prove block below is what this docs bead reruns.
- **Prove it works.** File exists plus section and stream greps, not "the stub was already there."
- **Redesign from first principles.** Product-ready is Relay/harness up, as if Mountpoint had never been the online gate.

## Prove

Reviewer commands from repo root:

```bash
test -f docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -F '## Blocking first steps' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -F '## Independent workstreams' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -F '## Shared mutable state' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -F '## Smallest safe decomposition' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -F 'CP orchestrator is serialized' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -E 'Stream B BFF|BFF chat' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -E 'Stream C Web|C Web' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
grep -E 'Stream D Entrypoint|D Entrypoint' docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
```
