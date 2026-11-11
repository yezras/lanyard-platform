# 0015 residual — Replace live echo harness with LA runner

**Bead:** `lp-oop.37.4`  
**Epic:** `lp-oop.37` (parent `lp-oop`, plan 0015 / ADR 0012)  
**Operator runbook:** [`deploy/references/runbooks/mocklab-replace-echo-harness-la.md`](../../../deploy/references/runbooks/mocklab-replace-echo-harness-la.md)  
**Pin:** [`artifacts/mocklab/short-stack/la-harness.pins.yaml`](../../../artifacts/mocklab/short-stack/la-harness.pins.yaml)  
**Offline smoke:** `bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh`

Live MockLab chat after the 2026-08-18 flip started as Browser → BFF → **stdlib echo contract server** (`lanyard-platform-staging-harness:2`, ECR tag `lp-oop-flip`) because [LA PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) was still **OPEN**.

**Observed 2026-08-19:** PR 242 is **MERGED** at SHA `52f5e4db93e7c71b279fedb79f7cc11a9cb82d30` (`52f5e4d`). Live Fargate is already `createHarnessTurnServer` on family revision **`:3`**, tag `la-52f5e4d`. Replies are still `echo: <message>` because the live start wrapper never passed a `runner` (LA default remains `createEchoTurnRunner`).

This leaf wires the in-repo start wrapper to an optional LiteLLM harness export and updates the pin. It does **not** live-deploy, does **not** `terraform apply`, does **not** `ecs update-service`, and does **not** put the agent loop in the Daytona snapshot. `apply_to_live` stays **false** while the live reply is echo.

## Decision (this leaf)

| Choice | Lock |
|---|---|
| Where the loop runs | Existing shared Fargate service `lanyard-platform-staging-harness` on cluster `lanyard-platform-staging-portal-cp` |
| Process | Lanyard Agent `createHarnessTurnServer` ([PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) MERGED SHA `52f5e4d`) |
| Runner bind | `start-la-harness.mjs` calls `createEnvLiteLlmTurnRunner` (or the name LA exports) when it is a function and passes `runner` when non-null. Missing factory keeps echo. |
| Discovery | Same internal CP ALB listener **:8080**. Header `x-harness-service-token` |
| Isolation | Shared platform task. `tenant_id` / `user_id` / `instance_id` stay on `TurnRequest` (BFF already sends them) |
| Guest snapshot | Unchanged. This path has **no** agent-core / `lanyard-agent` tree requirement |
| Live real-reply cutover | **BLOCKED** until the LA runner factory lands **and** an operator rolls an image that includes this wrapper |

## Forbidden

- New ECS cluster / public ALB / OpenSearch / extra Redis / Lambda
- Baking agent-core into the Daytona snapshot for this path
- Inventing a full agent in this repo (runner factory stays in `lanyard-agent`)
- `terraform apply`, `ecs update-service`, or ECR push from this bead
- Secrets, live account-id ARNs, or provider keys in git
- Setting `apply_to_live: true` while live still replies `echo:`

## Live real-reply still blocked (evidence)

| Field | Value |
|---|---|
| PR | https://github.com/LanyardBrain/lanyard-agent/pull/242 |
| State | **MERGED** 2026-08-19T02:27:46Z |
| Head SHA | `52f5e4db93e7c71b279fedb79f7cc11a9cb82d30` (`52f5e4d`) |
| On `origin/main` | **Yes** |
| Live task | `lanyard-platform-staging-harness:3` / `la-52f5e4d` |
| Live process | `createHarnessTurnServer` listening `:8080` |
| Default runner on that SHA | still no-tools `echo: <message>` (`createEchoTurnRunner`) |
| Remaining gap | Non-echo runner bind — LA `createEnvLiteLlmTurnRunner` (this wave, not this repo) + this start wrapper + operator image roll |

A live no-tool turn that is a **real LA reply** (not `echo: <message>`) therefore cannot be proven until:

1. LA exports `createEnvLiteLlmTurnRunner` (or the name it ships) from the harness subtree. That is **not** this bead — do not invent an agent here. Toolbox bind is [LA PR 243](https://github.com/LanyardBrain/lanyard-agent/pull/243) (draft, SHA `6bfd52210c194380041bc8581d836f078ed76378`) and is still not the model runner.
2. An operator builds the image that includes this start wrapper and follows the runbook § roll (register a new task-def revision on the **existing** service; no terraform).

Until then the live hop remains Browser → BFF → `createHarnessTurnServer` with echo replies (`la-52f5e4d`).

## Not this bead

- Tool-only Daytona snapshot pin → `lp-oop.37.5` / lab `lp-oop.23`
- First real (non-MockLab) tenant runbook → `lp-oop.37.9`
- Directory/Vault CP S3 → `lp-oop.37.1` / `.2`
- Rewriting BFF `TurnRequest` shape — already `tenant_id` + `user_id` + `instance_id`
- Implementing LiteLLM / agent-core inside this repo
