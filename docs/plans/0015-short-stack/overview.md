# 0015 — Short stack: Browser → BFF → Harness → Daytona

**Status:** Decisions locked. Implementation via Beads epic `lp-oop`.  
**Date:** 2026-08-14  
**GitHub:** [lanyard-platform#450](https://github.com/LanyardBrain/lanyard-platform/issues/450)  
**ADR:** [0011](../../adr/0012-short-stack-harness.md)  
**Tool placement:** [how a tool runs (harness vs toolbox vs CP)](../../architecture/short-stack-tool-placement.md)  
**Chat hop / SSE:** [portal-chat-delivery.md](../../architecture/portal-chat-delivery.md)

## Context

Today the Daytona guest runs Lanyard Agent (source + dist) and the model loop. File tools share that disk. Bash can read or rewrite the product tree. The snapshot is fat. Wake is slow.

Target chat path:

```
Browser  ─HTTP + SSE─►  BFF  ─HTTP + SSE─►  Harness (Lanyard Agent host)  ─toolbox─►  Daytona
```

Two product goals:

1. Agent loop off the sandbox.
2. No new AWS products. Reuse S3 vault, ECS, CP. Retire Relay from the Daytona chat path after proof.

## Scope

**In**

- Dual-run. Short stack is a new path. Guest-gateway + Relay stay default until MockLab is green.
- Harness is the Lanyard Agent repo, deployed as an always-on host. Not a new Portal package.
- One Daytona sandbox per concurrent user. Not per chat. Not per tenant as the only box.
- `ensure_online(tenant, user)` resolves a user instance if 0010 created one, else the tenant primary.
- Vault UI and OnlyOffice on the new path: BFF → CP → S3. CP is the only AWS S3 caller.
- Chat tools: harness → CP `ensure_online` → Daytona toolbox. Guest mounts the same S3 prefix.
- HTTP + SSE between BFF and harness. Same Relay event shapes. No gRPC in v1.
- Tool-only snapshot that does not ship `lanyard-agent/`. Do not replace the live MockLab pin until proof.

**Out**

- Per-chat sandboxes.
- Merging BFF and Harness.
- Rewriting Portal web.
- Deleting Control Plane.
- gRPC / Connect.
- Harness Brain RPC for Directory or Office in v1.
- New AWS products (OpenSearch, extra Redis, CloudFront-for-files, Lambda).
- Live always-on scheduled-task ticker (`SCHEDULE_EVALUATOR_ENABLED` CP loop). Create + fire **function** shipped in `lp-oop.38.8` (vault jobs.json + harness HTTP turn). Chat `scheduled_task` create is bound on the harness runner (`lp-oop.38.16`) and writes the same vault document. Residual: do not enable the CP evaluator loop this wave; ops/tests call `fireScheduledTaskHarnessTurn` / `evaluateDueScheduledJobs`.
- Rewriting today's guest snapshot into the harness.
- Finishing plan 0010 (`lp-zoh`). Short stack only calls `ensure_online(tenant, user)`.

## Constraints

- BFF is Hono on Node (`portal/packages/bff`). Browser cookies stay on BFF.
- CP `ensureOnline` today takes `instance_id` only. Add a resolver. Keep the existing wake.
- CP `VaultObjectStore` is `headObject` + `putObject`. Extend with `list` + `get` for the UI plane.
- Vault HTTP today is Brain RPC **or** local FS, switched by `BRAIN_RPC_ENABLED`. Add a third plane behind a flag. Default stays today's path.
- Office Document Server needs a signed HTTP octet-stream from BFF. It cannot speak gRPC or Brain RPC.
- Agent tarball bake: `deploy/daytona/agent-gateway/install-agent-runtime.sh`. Tool-only image omits `AGENT_TARBALL`.
- OPERATOR HOLD still applies to re-enabling torn-down staging AWS. MockLab live proof is the live surface.
- Cross-repo: harness HTTP and toolbox file adapters land in `LanyardBrain/lanyard-agent`. Platform beads track those PRs.

## Alternatives

| Approach | Why not / why yes |
|---|---|
| A. Harness serves Brain RPC + gRPC for vault/Office | Extra hop. Still S3 underneath. Wakes a VM to list files. DS still needs HTTP. Rejected for v1. |
| B. BFF → CP → S3 for UI/Office. Toolbox for agent tools. HTTP+SSE for chat. | **Chosen.** No new AWS product. Chat cutover not blocked on LA Brain RPC. |
| C. BFF calls S3 with STS from CP | New AWS caller in BFF. Rejected. CP stays the AWS boundary. |

## Domain types

```text
ChatDelivery = 'relay' | 'harness'     // dual-run. default relay

TurnRequest  { tenant_id, user_id, instance_id, thread_id, message }
TurnId
TurnEvent      // existing RelayChatEvent shapes. do not fork the web mapper

SandboxKey   { tenant_id, user_id }
EnsureOnlineByUser { tenant_id, user_id } → { instance_id, sandbox_id, presence, already_online }

VaultPlane   = 'fs' | 'brain_rpc' | 'cp_s3'   // default unchanged (flag off = today)
VaultEntry   { path, kind, size_bytes, etag?, mtime? }
VaultListPage { path, entries[], next_cursor?, truncated }

Office content: BFF signed GET → CP getObject stream → DS
```

Actors and what they share:

| Actor | Writes | Must not share |
|---|---|---|
| BFF | session, chat history, office session | Daytona keys, provider keys, S3 AWS SDK |
| Harness | in-memory turn state per (tenant, user, thread) | Guest disk, tenant secrets in logs |
| CP | instance registry, S3 vault objects, Daytona API | Browser tokens |
| Guest | tool working set on Mountpoint | Agent source, `XAI_API_KEY`, `GATEWAY_RELAY_SECRET` |

## Throughput checkpoint

- **Blocking first steps.** Land this plan + ADR. Then types and fakes. No live pin. No Relay deletion.
- **Independent workstreams.** After types: (1) CP vault list/get + BFF provider, (2) BFF harness client + flag, (3) tool-only Dockerfile, (4) `ensure_online(tenant, user)` resolver. Four package roots. Parallel-safe.
- **Shared mutable state.** Do not have BFF and harness both write S3. CP writes and reads vault objects for the UI. Guest Mountpoint is the agent's view. Instance registry stays CP-only. Dual-run flag is one field, default `relay`.
- **Smallest safe decomposition.** One leaf is one flag, one port extension, or one proof. Do not land chat + vault + snapshot in one PR.

## Applicable skills

- `how` before editing BFF chat, CP orchestrator, or Office mint.
- `principle-model-the-domain` for `ChatDelivery` / `VaultPlane` unions. No new boolean that must stay in sync with another.
- `principle-boundary-discipline` at BFF session, harness service token, CP S3 ACL.
- `principle-type-system-discipline` on branded ids (`TurnId`, `SandboxKey`).
- `principle-make-operations-idempotent` on `ensure_online` and turn start.
- `principle-sequence-verifiable-units` and `principle-prove-it-works`. Offline tests before MockLab.
- `principle-outcome-oriented-execution`. Dual-run is a flag, not a forever compatibility layer. After proof, delete Relay from the Daytona chat path (`lp-oop.35`).
- `unslop` on plan, ADR, PR bodies.
- `web-ui-testing` on UI QA leaves.
- `show-me-your-work` trail: `.audit/lp-oop.tsv`.

`architect` skipped: A vs B vs gRPC already compared in GH #450. Choice is B.

## Phases

| Phase | Bead prefix | Doc |
|---|---|---|
| 0 Plan + ADR | `lp-oop.1` | this file |
| 1 Contracts and flags | `lp-oop.2`–`.4` | [phase-1-contracts.md](./phase-1-contracts.md) |
| 2 Fakes | `lp-oop.5`–`.8` | [phase-2-fakes.md](./phase-2-fakes.md) |
| 3 Vault + Office via CP/S3 | `lp-oop.9`–`.13` | [phase-3-vault-cp-s3.md](./phase-3-vault-cp-s3.md) |
| 4 Chat to harness, no tools | `lp-oop.14`–`.17`, `.26` | [phase-4-chat-harness.md](./phase-4-chat-harness.md) |
| 5 ensure_online(tenant, user) | `lp-oop.18`–`.20` | [phase-5-ensure-online-user.md](./phase-5-ensure-online-user.md) |
| 6 Tool-only snapshot | `lp-oop.21`–`.23` | [phase-6-tool-snapshot.md](./phase-6-tool-snapshot.md) |
| 7 Toolbox bind | `lp-oop.24`–`.28` | [phase-7-toolbox.md](./phase-7-toolbox.md) |
| 8 Dual-run + MockLab proof | `lp-oop.29`–`.34` | [phase-8-dual-run-proof.md](./phase-8-dual-run-proof.md) |
| 9 Relay retire | `lp-oop.35` | [phase-9-relay-retire.md](./phase-9-relay-retire.md) |

Issue index: [issue-map.md](./issue-map.md). Tests: [testing.md](./testing.md).

## Verification

- `bash scripts/validate.sh` after docs and contract changes.
- Package vitest for BFF and CP on every code leaf.
- Fake harness + fake S3. No live Daytona until phase 8.
- Phase 8 invariants (scripted):

  - Toolbox cannot see `/opt/company-brain-backend/current/lanyard-agent`.
  - Daytona create `env` has no provider keys, no `GATEWAY_RELAY_SECRET`, and no MCP secrets.
  - Two chats from the same user share one `sandbox_id`.
  - A second user gets a different `sandbox_id` once 0010 user instances exist. Until then both fall back to tenant primary (assert fallback, do not fake 0010).
  - Tenant A cannot exec on tenant B.
  - Browser never holds harness or Daytona tokens.
  - Directory lists S3 without waking a sandbox (`ensure_online` not called on `GET /api/vault/tree` when `VaultPlane=cp_s3`).

## Implementation guidance

Default `CHAT_DELIVERY=relay` and vault plane unchanged. Feature flags follow existing `parseEnvFlag` style in `portal/packages/bff/src/config.ts`.

Do not update `DAYTONA_DEFAULT_SNAPSHOT` or MockLab `agent_snapshot_id` in phase 6.

LA work is a PR on `LanyardBrain/lanyard-agent` plus a platform note with the SHA. Platform close reason must include the LA PR URL.

## Beads

Epic: `lp-oop`. Children `lp-oop.1` … `lp-oop.35`. Drain with `beads-wave-drain` and `epic_id=lp-oop`. `auto_merge=false` until a human opts in. Live leaves set `needs_ui_qa`.
