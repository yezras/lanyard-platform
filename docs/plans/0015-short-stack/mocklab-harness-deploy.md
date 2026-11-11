# 0015.30 — MockLab harness deploy (existing ECS)

**Bead:** `lp-oop.30`  
**Epic:** `lp-oop` (plan 0015 / ADR 0012)  
**Operator runbook:** [`deploy/references/runbooks/mocklab-short-stack-harness.md`](../../../deploy/references/runbooks/mocklab-short-stack-harness.md)  
**Lab compose:** [`deploy/dev/mocklab-short-stack-harness/`](../../../deploy/dev/mocklab-short-stack-harness/)

Harness is another **Fargate task on an existing MockLab cluster**, or a **lab compose** process. No new AWS product. Guest-gateway + Relay stay the default chat path.

## Decision (this leaf)

| Choice | Lock |
|---|---|
| Where the loop runs | Always-on Lanyard Agent host (`createHarnessTurnServer`, [LA PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) MERGED SHA `52f5e4d`) |
| Live MockLab home | Existing ECS cluster `lanyard-platform-staging-portal-cp` (same VPC / private subnets as CP). **Do not** create a new cluster |
| Discovery | Additional listener (or host rule) on the **existing internal** CP ALB. Do not add a public ALB |
| Lab path | Compose / host process in `deploy/dev/mocklab-short-stack-harness/` |
| Dual-run default | `CHAT_DELIVERY` unset / `relay`. Flip MockLab alone via persisted tenant/instance `chat_delivery` (`lp-oop.29`) |
| Guest snapshot | Unchanged. Do not rewrite `DAYTONA_DEFAULT_SNAPSHOT` / `agent_snapshot_id` |

## Forbidden (no new AWS product)

Do **not** add OpenSearch, extra Redis/Valkey, CloudFront-for-files, Lambda, a new ECS cluster, a public harness ALB, or BFF-as-S3-caller. Reuse ECS Fargate, the existing VPC, the existing internal ALB, Secrets Manager / SSM, and ECR.

## Residual (`lp-oop.37.4`)

Live flip left the **stdlib echo** contract on `lanyard-platform-staging-harness:2` (ECR tag `lp-oop-flip`) because PR 242 was still OPEN. PR 242 later **MERGED** (`52f5e4d`); live is now `:3` / `la-52f5e4d` `createHarnessTurnServer` with echo replies. Remaining path (same cluster / ALB :8080 / `x-harness-service-token`): [replace-echo-harness-la.md](./replace-echo-harness-la.md). Real-reply cutover stays **BLOCKED** until the LA runner factory lands and an operator rolls an image. Guest snapshot is unchanged.

## Not this bead

- Live no-tool turn evidence → `lp-oop.31` (`artifacts/mocklab/short-stack/`; `bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh`)
- Live tool + invariant script → `lp-oop.32` (`bash deploy/scripts/prove-mocklab-short-stack-invariants.sh`; live snapshot unchanged unless a human pin decision)
- Tool-only snapshot pin → `lp-oop.23` (lab only; not live)
- Relay retire → `lp-oop.35` / [phase-9-relay-retire.md](./phase-9-relay-retire.md) (Daytona harness hop has no `deliverInbound`; EC2/guest stay Relay; live default not flipped)
