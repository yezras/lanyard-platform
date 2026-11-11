# Runbook: replace live echo harness with LA runner

**Status:** Operator procedure — runbook only. This file does **not** apply Terraform, does **not** `ecs update-service`, and does **not** push images to ECR.  
**Bead:** `lp-oop.37.4`  
**Epic:** `lp-oop.37` — plan [0015](../../../docs/plans/0015-short-stack/overview.md) / [ADR 0012](../../../docs/adr/0012-short-stack-harness.md)  
**Plan note:** [docs/plans/0015-short-stack/replace-echo-harness-la.md](../../../docs/plans/0015-short-stack/replace-echo-harness-la.md)  
**Pin:** [artifacts/mocklab/short-stack/la-harness.pins.yaml](../../../artifacts/mocklab/short-stack/la-harness.pins.yaml)  
**Lab image recipe:** [dev/mocklab-short-stack-harness/](../../dev/mocklab-short-stack-harness/)  
**Offline smoke:** `bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh`  
**Local image (no push):** `bash deploy/scripts/build-la-harness-image.sh`

**Honesty (2026-08-19):** [LA PR 244](https://github.com/LanyardBrain/lanyard-agent/pull/244) is **MERGED** at SHA `fb70865bf8c74a6eb980095fa404e5b7e9327f13` (`fb70865`) and exports `createEnvLiteLlmTurnRunner`. Live MockLab still speaks `createHarnessTurnServer` from task family `lanyard-platform-staging-harness:3`, ECR tag `la-52f5e4d` (PR 242, image digest prefix `sha256:3e03be54`). Replies are still `echo: <message>` until an operator rolls `la-fb70865` + this start wrapper with LiteLLM env. `apply_to_live` stays **false** while the live reply is echo.

Related:

| Doc / path | Use |
|------------|-----|
| [mocklab-short-stack-harness.md](mocklab-short-stack-harness.md) | `lp-oop.30` topology (existing cluster, ALB :8080, secrets names) |
| [la-http-turn-server.md](../../../docs/plans/0015-short-stack/la-http-turn-server.md) | Contract + PR 242 SHA |
| [staging-secrets-checklist.md](staging-secrets-checklist.md) | `HARNESS_*` names (no values) |
| [smoke-no-lanyard-agent-tree.sh](../../daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh) | Guest still has no agent-core tree requirement |

---

## 1. What is live vs what this replaces

```
Live today (2026-08-19):
  Browser ─► BFF (MockLab chat_delivery=harness) ─► LA createHarnessTurnServer
             Fargate family lanyard-platform-staging-harness:3
             ECR tag la-52f5e4d
             process = createHarnessTurnServer
             reply   = "echo: <message>"   (default runner; no runner passed)

Target (same service, new image after LA factory lands):
  Browser ─► BFF ─► LA createHarnessTurnServer({ runner })
             same cluster lanyard-platform-staging-portal-cp
             same internal CP ALB :8080
             same header x-harness-service-token
             TurnRequest still has tenant_id, user_id, instance_id
             optional sandbox_id from ensure-online when ChatDelivery=harness
             start wrapper prefers createEnvToolsTurnRunner / createAgentCoreTurnRunner (runner=tools)
             guest snapshot unchanged (no agent-core tree)
             reply is a real LA / LiteLLM completion, not echo:
```

The harness stays a **shared platform task**. Isolation is the turn body (`tenant_id` / `user_id` / `instance_id`), not a per-tenant cluster. BFF already sends those fields (`portal/packages/bff/src/chat-delivery-send.ts` → `HarnessClient.startTurn`).

Do **not** put the agent loop in the Daytona snapshot. `DAYTONA_DEFAULT_SNAPSHOT` / `agent_snapshot_id` stay as pinned. Tool-only guest pin is `lp-oop.37.5` / lab `lp-oop.23`.

---

## 2. Live real-reply gate (fail closed)

Do **not** run §4 until every row is GO:

| Gate | 2026-08-19 | Unblock |
|------|------------|---------|
| LA PR 242 merged to `lanyard-agent` `main` | **GO** — MERGED `52f5e4d` | — |
| Live task is `createHarnessTurnServer` | **GO** — `:3` / `la-52f5e4d` | — |
| Non-echo runner (real LA reply, not `echo: <message>`) | **BLOCKED** — live still echo; 52f5e4d default is `createEchoTurnRunner`; start wrapper on live did not pass `runner` | LA `createEnvLiteLlmTurnRunner` export + this wrapper + operator roll |
| `terraform apply` / new cluster / public ALB | Forbidden | — |
| Default path `ecs update-service` / ECR push from this bead | Forbidden | Operator-only §4 after the runner gate |

PR 242 default runner is still no-tools echo. Live `:3` already runs that server. Rebuilding the same SHA **without** a later runner bind would still reply `echo: <message>`. Acceptance for this bead's live proof is a real LA reply. Until LA ships that factory **and** an operator rolls an image that includes this start wrapper, keep `apply_to_live: false` and treat the real-reply cutover as **BLOCKED**.

---

## 3. Pin + local image (no AWS)

```bash
# Offline (no network, no Docker required):
bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh

# Optional local image from a lanyard-agent checkout at the pin SHA.
# Does not docker push. Does not ecs update-service.
export LANYARD_AGENT_ROOT=/path/to/lanyard-agent
bash deploy/scripts/build-la-harness-image.sh
# tag: lanyard/harness:la-52f5e4d
```

Lab host process (unchanged from `lp-oop.30`):

```bash
export LANYARD_AGENT_ROOT=/path/to/lanyard-agent   # must export createHarnessTurnServer
cd deploy/dev/mocklab-short-stack-harness
bash run-lab-harness.sh
```

The Fargate start wrapper (`start-la-harness.mjs`) looks for `createEnvLiteLlmTurnRunner` on the harness subtree export. If it is a function and returns a non-null runner, that runner is passed into `createHarnessTurnServer`. If missing, the server keeps echo. Boot logs `kind=createHarnessTurnServer` and `runner=litellm|echo`. Never log tokens or provider keys.

Env the LA factory reads (names only — no values, no ARNs, never commit secrets):

| Name | Role |
|------|------|
| `LITELLM_BASE_URL` | Required for non-echo |
| `LITELLM_API_KEY` or `LITELLM_MASTER_KEY` | Required for non-echo (either) |
| `HARNESS_MODEL` / `LANYARD_DEFAULT_MODEL` | Optional model pin |
| `CONTROL_PLANE_URL` | Optional. When set with the service token, `scheduled_task` create writes vault `cron/jobs.json` via CP HTTP (`lp-oop.38.16`). No guest ticker. |
| `CONTROL_PLANE_SERVICE_TOKEN` | Optional. Same CP service token BFF uses. Never log the value. |

The Fargate harness image copies `packages/providers` (LiteLLM HTTP client) and `packages/agent-core` plus required workspace packages so `@lanyard-agent/agent-core` resolves. It does **not** COPY that tree onto the Daytona guest snapshot.

---

## 4. Operator roll (do not run from this bead)

Print-only recipe after the gates in §2 are GO. Substitute account, digest, and secret ARN from the operator shell — **never paste tokens into tickets or git**.

```bash
# 0. Confirm the LA harness export includes createEnvLiteLlmTurnRunner
#    (or the name LA ships) and a local no-tool turn is not "echo: …".
#    Refuse if live reply is still echo and you expected a model loop.

# 1. Build + tag locally from the pin SHA (see build-la-harness-image.sh).
LANYARD_AGENT_ROOT=/path/to/lanyard-agent \
  bash deploy/scripts/build-la-harness-image.sh --build

# 2. Push the local tag to the EXISTING harness ECR repo (not a new product).
#    Record the digest. Do not invent sha256.
#    Example repo name only (account is operator-local):
#      …/lanyard-platform-staging/portal/harness
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com
docker tag lanyard/harness:la-2477b22 \
  <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/portal/harness:la-2477b22
docker push <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/portal/harness:la-2477b22
# capture: aws ecr describe-images … --query 'imageDetails[0].imageDigest'

# 3. Register a NEW revision of the EXISTING family (today :3 / la-52f5e4d).
#    Start from deploy/dev/mocklab-short-stack-harness/task-definition.example.json.
#    Replace image with the digest from step 2. Keep:
#      cluster  lanyard-platform-staging-portal-cp
#      port     8080
#      secrets  HARNESS_SERVICE_TOKEN + harness-litellm + daytona (lp-oop.38.20)
#      env      LITELLM_BASE_URL, optional HARNESS_MODEL / LANYARD_DEFAULT_MODEL
#      exec role GetSecretValue on those SM names (dedicated harness-exec, or
#      BFF extra ARNs while shared). No CP task role. No plaintext XAI /
#      GATEWAY / LITELLM / DAYTONA keys in environment[].
aws ecs register-task-definition --cli-input-json file://harness-task.json

# 4. Point the EXISTING service at the new revision. desiredCount stays 1.
#    Do not create a second service. Do not terraform apply.
aws ecs update-service \
  --cluster lanyard-platform-staging-portal-cp \
  --service lanyard-platform-staging-harness \
  --task-definition lanyard-platform-staging-harness:<NEW_REV> \
  --force-new-deployment \
  --desired-count 1

# 5. From a BFF task or VPC jump (not the public internet). Do not log the token.
nc -z <internal-cp-alb-dns> 8080
curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://<internal-cp-alb-dns>:8080/internal/turns"
# expect 401 without token
curl -sS -H "x-harness-service-token: $HARNESS_SERVICE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"tenant_id":"t","user_id":"u","instance_id":"i","thread_id":"th","message":"ping lp-oop.37.4"}' \
  "http://<internal-cp-alb-dns>:8080/internal/turns"
# expect { "turn_id": "…" }
# SSE must NOT be exactly "echo: ping lp-oop.37.4" once the real runner is bound.
```

Do **not** rewrite the guest snapshot. Confirm:

```bash
bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh
```

### Rollback

1. `aws ecs update-service … --task-definition lanyard-platform-staging-harness:3` (current `la-52f5e4d` echo runner).
2. Or `:2` / `lp-oop-flip` (stdlib echo contract from flip).
3. Or set MockLab `chat_delivery` back to `relay` (`lp-oop.29`).
4. Leave `DAYTONA_DEFAULT_SNAPSHOT` untouched.

---

## 5. Wire (unchanged)

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/internal/turns` | Body `TurnRequest` `{ tenant_id, user_id, instance_id, thread_id, message }` → `{ turn_id }` |
| `GET` | `/internal/turns/:turnId/events` | SSE `text/event-stream` |
| `POST` | `/internal/turns/:turnId/interrupt` | `{ ok, interrupted }` |
| Header | `x-harness-service-token` | Missing/wrong → 401 |

Health residual (PR 242 authenticates every path): ECS TCP :8080; ALB matcher **401** on `GET /`. Do not POST `/internal/turns` from a health check.

---

## 6. Non-claims

| Claim | Truth |
|-------|--------|
| Pin + runbook + image recipe in this repo | **Yes** (this bead) |
| Start wrapper binds optional LiteLLM factory | **Yes** (in-repo; live image not rolled from this PR) |
| Live task is `createHarnessTurnServer` | **Yes** — `:3` / `la-52f5e4d` |
| Live echo reply replaced | **No** — still `echo: <message>` until LA runner + operator roll |
| Live no-tool turn is a real LA reply | **No** — still `echo: <message>` |
| Guest snapshot rewritten / agent-core baked | **No** |
| `terraform apply` / `ecs update-service` / ECR push from this PR | **No** |
| New AWS product | **No** |
