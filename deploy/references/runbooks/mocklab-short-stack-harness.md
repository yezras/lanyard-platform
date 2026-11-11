# Runbook: MockLab short-stack harness (existing ECS)

**Status:** Operator procedure — runbook only. This file does **not** apply Terraform, does **not** `ecs update-service`, and does **not** flip MockLab chat.  
**Bead:** `lp-oop.30`  
**Epic:** `lp-oop` — plan [0015](../../../docs/plans/0015-short-stack/overview.md) / [ADR 0012](../../../docs/adr/0012-short-stack-harness.md)  
**Plan note:** [docs/plans/0015-short-stack/mocklab-harness-deploy.md](../../../docs/plans/0015-short-stack/mocklab-harness-deploy.md)  
**Lab compose:** [dev/mocklab-short-stack-harness/](../../dev/mocklab-short-stack-harness/)  
**Offline smoke:** `bash deploy/scripts/smoke-mocklab-short-stack-harness.sh`

**Honesty:** Landing this runbook is not a live no-tool turn (`lp-oop.31`), not a live tool/invariant proof (`lp-oop.32`), and not a tool-snapshot pin. `lp-oop.35` retires Relay from the Daytona **harness** hop only (no `deliverInbound`; [phase 9](../../../docs/plans/0015-short-stack/phase-9-relay-retire.md)). Guest-gateway + Relay stay the default live path until an operator flips MockLab `chat_delivery` (`lp-oop.29`) **after** the harness task is healthy. EC2 tenants stay on Relay until they move. Live snapshot flip is a human pin decision — `prove-mocklab-short-stack-invariants.sh` does not write it.

**Live residual (`lp-oop.37.4`):** [LA PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) is **MERGED** (`52f5e4d`). Live shared Fargate is `createHarnessTurnServer` (`lanyard-platform-staging-harness:3`, ECR tag `la-52f5e4d`). Replies are still `echo: <message>` until a non-echo runner is bound. See [mocklab-replace-echo-harness-la.md](mocklab-replace-echo-harness-la.md).

**Live residual (`lp-oop.38.20`):** harness task `secrets[]` references SM `harness-litellm` and `daytona`. Exec role must `GetSecretValue` those ARNs or a new revision cannot place. Dedicated module: [harness-exec-iam](../../modules/harness-exec-iam/). Shared BFF exec keep: `execution_extra_secret_arns`. This file does **not** apply Terraform.

Related:

| Doc / path | Use |
|------------|-----|
| [la-http-turn-server.md](../../../docs/plans/0015-short-stack/la-http-turn-server.md) | LA HTTP contract + PR 242 SHA |
| [phase-8-dual-run-proof.md](../../../docs/plans/0015-short-stack/phase-8-dual-run-proof.md) | Dual-run + live proof sequence |
| [phase-9-relay-retire.md](../../../docs/plans/0015-short-stack/phase-9-relay-retire.md) | Daytona harness hop has no `deliverInbound`; EC2/guest stay Relay |
| [staging-secrets-checklist.md](staging-secrets-checklist.md) | `HARNESS_*` names (no values) |
| [harness-exec-iam](../../modules/harness-exec-iam/) | Exec role GetSecretValue catalog (`lp-oop.38.20`); not auto-applied |
| [OPERATOR-HOLD-LOCALHOST-ONLY.md](../../environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md) | Do not re-enable torn-down staging AWS |
| [mocklab INDEX](../../deployments/mocklab/INDEX.md) | MockLab product path (LA + Daytona) |

---

## 1. Topology (acceptance)

```
Browser  ─HTTP + SSE─►  BFF  ─HTTP + SSE─►  Harness (LA host)  ─toolbox later─►  Daytona
```

| Requirement | Implementation |
|-------------|----------------|
| Harness process | Lanyard Agent `createHarnessTurnServer` ([PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) MERGED SHA `52f5e4d`) |
| Live form | **One more Fargate service** on the existing cluster (below). Desired count **1** |
| Lab form | Host process or compose in `dev/mocklab-short-stack-harness/` |
| Public edge | **None.** Browser never holds harness or Daytona tokens |
| Default chat | Guest-gateway + Relay. BFF `CHAT_DELIVERY` stays unset/`relay` |
| MockLab flip | Persisted tenant/instance `chat_delivery=harness` (`lp-oop.29`). Do not set a global BFF `CHAT_DELIVERY=harness` |
| Guest snapshot | Unchanged |

Live MockLab already runs BFF / Relay / CP / Docs as Fargate on **existing** clusters. Put the harness next to CP (private):

| Existing resource | Value (lab account, observed 2026-08-17) | Reuse |
|-------------------|------------------------------------------|--------|
| ECS cluster | `lanyard-platform-staging-portal-cp` | **Home.** Do not create `…-harness` cluster |
| Sibling service | `lanyard-platform-staging-cp` (desired=1) | Same VPC + private subnets |
| VPC | same as CP tasks | Existing `platform-vpc` |
| Private subnets | same as CP / BFF tasks | Existing |
| Internal ALB | `lanyard-platform-staging-cp-alb` (internal) | Additional **listener on 8080** (or host rule). No new public ALB |
| BFF tasks | cluster `lanyard-platform-staging-portal`, SG `lanyard-platform-staging-bff-tasks` | Ingress source for harness :8080 |
| ECR | existing registry `…/lanyard-platform-staging/portal/*` | Optional extra repo name `…/portal/harness` — still ECR, not a new product |
| Secrets | existing Secrets Manager / SSM | New **name** `HARNESS_SERVICE_TOKEN` in the same stores |

BFF already reaches CP at the internal ALB DNS (`CONTROL_PLANE_URL`). Harness URL is the same ALB hostname **plus port 8080** (or a host-header rule), never a CloudFront/public name.

---

## 2. No new AWS product

**Reuse:** ECS Fargate, existing cluster, existing VPC/subnets, existing internal ALB, existing ECR, existing Secrets Manager / SSM, existing CloudWatch Logs.

**Do not create**

| Product / pattern | Why not |
|-------------------|---------|
| New ECS cluster | Bead is “existing cluster” |
| OpenSearch | Out of 0015 |
| Extra Redis / Valkey | Harness turn state is in-process (desired_count=1) |
| CloudFront-for-files / extra CF distribution | Vault/Office stay BFF → CP → S3 |
| Lambda | Not the turn server |
| Public harness ALB | Browser must not reach harness |
| BFF AWS SDK / STS to S3 | CP stays the AWS S3 boundary |
| Re-apply torn-down staging VPC/NAT/endpoints | OPERATOR HOLD |

Adding one ECS **service** + task definition family + target group + ALB listener on resources that already exist is incremental compute, not a new product. Do **not** `terraform apply` `environments/platform-staging` to “create the stack.”

---

## 3. Wire (names only)

Contract ([`harness-turn-contract.v1.json`](../../../portal/packages/shared/src/fixtures/harness-turn-contract.v1.json)):

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/internal/turns` | Body `TurnRequest` → `{ turn_id }` |
| `GET` | `/internal/turns/:turnId/events` | SSE `text/event-stream` |
| `POST` | `/internal/turns/:turnId/interrupt` | `{ ok, interrupted }` |
| Header | `x-harness-service-token` | Missing/wrong → 401 |

LA default runner is no-tools echo (`echo: <message>`). Toolbox bind is `lp-oop.27` / `.28`.

### Env (BFF)

| Name | Kind | Default / rule |
|------|------|----------------|
| `CHAT_DELIVERY` | plain | **Unset** → `relay`. Do not set `harness` globally |
| `HARNESS_URL` | plain | Private base, e.g. `http://<internal-cp-alb-dns>:8080`. Required only when a tenant/instance is flipped to harness **and** `NODE_ENV=production` |
| `HARNESS_SERVICE_TOKEN` | **SM/SSM → ECS secrets map** | Same value as the harness task. Never tfvars / plain env / logs. Production rejects the `placeholder-harness-service-token` placeholder when delivery is harness |

BFF may have `HARNESS_URL` + token wired while `CHAT_DELIVERY` stays `relay`. That is the intended dual-run: only MockLab rows with `chat_delivery=harness` use the client.

### Env (harness task)

| Name | Kind | Notes |
|------|------|--------|
| `LANYARD_HARNESS_SERVICE_TOKEN` or `HARNESS_SERVICE_TOKEN` | **secret** | LA `createHarnessTurnServer({ serviceToken })`. Same value as BFF |
| `HARNESS_HOST` | plain | `0.0.0.0` in-task |
| `HARNESS_PORT` | plain | `8080` |
| Provider keys / `GATEWAY_RELAY_SECRET` | **forbidden** as plaintext env | Stay out of `environment[]`. LiteLLM keys and Daytona toolbox credentials come from SM `harness-litellm` / `daytona` (`lp-oop.38.20`). Harness **task** role must not be the CP task role |

### Start (LA)

There is no published `bin` yet. From a built `lanyard-agent` checkout at the PR SHA:

```ts
import { createHarnessTurnServer } from "@lanyard-agent/adapters-portal";

const server = createHarnessTurnServer({
  host: process.env.HARNESS_HOST ?? "0.0.0.0",
  port: Number(process.env.HARNESS_PORT ?? 8080),
  serviceToken: process.env.LANYARD_HARNESS_SERVICE_TOKEN ?? "",
});
await server.start();
```

Lab wrapper: `deploy/dev/mocklab-short-stack-harness/run-lab-harness.sh`.

**Health residual:** PR 242 authenticates **every** path (no unauthenticated `GET /health`). Until LA adds `/health`:

- ECS container health: TCP connect to `:8080`
- If the existing internal ALB listener is used: HTTP health matcher **401** on `GET /` (process up; does not prove the token). Do not POST `/internal/turns` from a health check

---

## 4. Live MockLab enable (operator-owned; not this PR)

Prerequisites:

1. LA image or task command at PR 242 SHA (or later that still speaks the contract).
2. Digest pin in existing ECR (add `harness` to private `portal_services` tfvars **only if** you need a dedicated repo; do not invent a second registry product).
3. SM/SSM name for `HARNESS_SERVICE_TOKEN` (value never in git).
4. Security group: BFF task SG → harness port **8080** on the harness / CP-ALB SG.
5. New task definition family `lanyard-platform-staging-harness` (example: [task-definition.example.json](../../dev/mocklab-short-stack-harness/task-definition.example.json)).
6. ECS **service** `lanyard-platform-staging-harness` on cluster `lanyard-platform-staging-portal-cp`, `desiredCount=1`, `assignPublicIp=DISABLED`, same private subnets as CP.
7. Target group + **additional listener :8080** on `lanyard-platform-staging-cp-alb` (internal).
8. Dedicated **task** role: logs only. Do **not** attach `lanyard-platform-staging-cp-task` (vault / model keys on CP).
9. Execution role (`lp-oop.38.20`): ECR pull + `GetSecretValue` on SM names `harness-service-token`, `harness-litellm`, and `daytona`. Prefer dedicated `lanyard-platform-staging-harness-exec` (`modules/harness-exec-iam`). Live residual: the family still uses `lanyard-platform-staging-bff-exec`; any BFF IAM reconcile must keep those ARNs via `execution_extra_secret_arns` or the service cannot place. This runbook does **not** apply Terraform.
10. BFF task: add `HARNESS_URL` (plain) + `HARNESS_SERVICE_TOKEN` (secrets map). Leave `CHAT_DELIVERY` unset.
11. Flip **only** MockLab via CP persisted `chat_delivery` (`lp-oop.29`). Guest path for everyone else stays Relay.

Do **not** run `terraform apply` on `environments/platform-staging` as the enable path. Do **not** scale other `lanyard-platform-staging-*` services.

### Post-enable checks (operator; no secrets in logs)

```bash
# From a BFF task or VPC jump (not the public internet):
# TCP
nc -z <internal-cp-alb-dns> 8080
# 401 without token (proves process, not auth)
curl -sS -o /dev/null -w "%{http_code}\n" "http://<internal-cp-alb-dns>:8080/internal/turns"
# 200 with token (operator shell; do not paste the token into tickets)
curl -sS -H "x-harness-service-token: $HARNESS_SERVICE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"tenant_id":"t","user_id":"u","instance_id":"i","thread_id":"th","message":"ping"}' \
  "http://<internal-cp-alb-dns>:8080/internal/turns"
```

Expect `{ "turn_id": "…" }`. Live chat proof is `lp-oop.31`: `bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh` → `artifacts/mocklab/short-stack/`.

### Rollback

1. Set MockLab `chat_delivery` back to `relay` or NULL (inherit).
2. Optionally set harness service `desiredCount=0`.
3. Leave BFF `CHAT_DELIVERY` unset. Guest snapshot stays as pinned.

---

## 5. Lab compose (no AWS)

```bash
cd deploy/dev/mocklab-short-stack-harness
cp .env.example .env          # lab token only; never production SM
# Host process (default):
export LANYARD_AGENT_ROOT=/path/to/lanyard-agent
bash run-lab-harness.sh
# Optional image:
#   docker compose --profile harness up -d
```

Point lab BFF at `HARNESS_URL=http://127.0.0.1:8080` (or `http://harness:8080` on the compose network). Keep `CHAT_DELIVERY=relay` unless you are deliberately exercising the flag offline.

---

## 6. Secrets (never commit values)

| Name | Store | Consumer |
|------|--------|----------|
| `HARNESS_SERVICE_TOKEN` | SM or SSM SecureString | BFF secrets map **and** harness task |
| `LANYARD_HARNESS_SERVICE_TOKEN` | same value, optional alias | LA server options |
| `.env.mocklab-agent-dev` | local 0600 only | **Never** source into the harness task definition or git |

Generate (local; do not commit):

```bash
openssl rand -base64 48
```

Checklist: [staging-secrets-checklist.md](staging-secrets-checklist.md) § Short-stack harness.

---

## 7. Non-claims

| Claim | Truth |
|-------|--------|
| Runbook + lab compose exist | **Yes** (this bead) |
| Live harness task running | **No** until an operator follows §4 |
| MockLab chat flipped to harness | **No** — default Relay |
| Guest snapshot rewritten | **No** |
| New AWS product added | **No** |
| `lp-oop.31` live turn evidence | See `artifacts/mocklab/short-stack/` + `prove-mocklab-short-stack-no-tool-turn.sh` |
| Production / all-tenant cutover | **Forbidden** here |

---

## 8. Validate (offline)

```bash
bash deploy/scripts/smoke-mocklab-short-stack-harness.sh
bash deploy/scripts/check-staging-secrets-checklist.sh
```
