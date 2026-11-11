# 0020 — Cloudflare platform revamp, localhost first

**Status:** Proposed. Epic `lp-bhcg`. Beads and this plan are the work order. No Cloudflare account is required to start.
**Date:** 2026-10-15
**Supersedes as the hosting direction:** the platform-staging AWS stack under [OPERATOR HOLD](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md). Plan 0017 keeps its speed scope and no longer owns the hosting question ([0017 overview](../0017-sandbox-first-chat-speed/overview.md)).
**Keeps:** Daytona as the agent computer ([0008](../0008-daytona-agent-sandboxes/overview.md)). External agent products stay outside this repo ([ADR 0002](../../adr/0002-external-backend-products.md)).

Issue index: [issue-map.md](./issue-map.md).

## What this is

Lanyard is a portal for always-on agents. Each agent is a persona with its own model key, tools, cron jobs, memory, and files. The computer those tools run on is a Daytona sandbox: it persists, goes idle, and wakes when a chat, a cron job, or another trigger needs it. The portal shows that work, including scheduled jobs and inline Word editing.

The platform that serves the portal was built as a large AWS stack (VPC, NAT, RDS, ElastiCache, Fargate, CloudFront, Secrets Manager). That stack is torn down because it was costly and the product was not moving. This plan moves the platform services onto Cloudflare and proves the agent loop on localhost before any live account is required.

## Where the repo is

About 1008 beads exist; roughly 940 are closed. The open set is mostly live MockLab and AWS follow-through: mailbox (`lp-v62i`), inbound chat spine (`lp-k5c4`), Daytona vault remount (`lp-kng.6`), connectors (`lp-xhf4`), admin (`lp-2qs`), and EC2 dual-run (`lp-0pr`, `lp-3a1`). Those stay open. They are not the order below. Do not `terraform apply` platform-staging to unblock them.

What already works in tree, mostly proven offline or on the old MockLab host:

| Capability | Where it lives | Gap |
| --- | --- | --- |
| Portal UI (chat, vault, settings, agents) | `portal/apps/web` | Live AWS chat often died at the relay (504) or the harness hop |
| Control plane: tenants, RBAC, sandbox orchestrator, cron registry | `portal/packages/control-plane` + Postgres `portal_cp` | Database is RDS; staging RDS is torn down |
| Product tables: business, folders, OAuth, model tokens | `portal/packages/db` Prisma → Postgres `portal_app` | Second Postgres database, Cognito-shaped user ids |
| Chat connection | Relay WSS by default, harness HTTP as the newer path (`CHAT_DELIVERY`, plan 0015 / 0019) | Two hops, Hermes-specific names, external Lanyard Agent still drops Brain RPC |
| Model keys | LiteLLM slots + AWS Secrets Manager envelope ([ADR 0007](../../adr/0007-composer-model-intelligence-routing.md)) | A localhost chat still wants a proxy, an envelope, and several provider slots |
| Cron list and fire | Settings UI, `scheduled-job-registry.ts`, `schedule-evaluator.ts` | Fire proof against a live sandbox is blocked by the AWS hold |
| Files | S3 prefix mounted into the guest | Mountpoint first-write can take many minutes (`lp-puzc`) |
| Memory | MemPalace on the vault (`memory_read` / `memory_write`) | Palace is on the S3 mount; working context is inside the external agent |
| Office | ONLYOFFICE lab compose + BFF session bridge | Staging document server is part of the torn-down stack |
| Computer / browser | Not built | No browser tool in the sandbox image |
| Personas | Agents, rooms, and mailbox beads | A second persona still shares the fragile chat path |

Localhost is already the documented dev target (`portal/docker-compose.yml`: Postgres, BFF `:4000`, Relay `:8787`, control plane on `127.0.0.1:3100`). This environment has no Docker daemon, so that stack was not booted while filing this plan. The first bead is that boot.

## Service map

Terraform modules under `deploy/modules/` are the AWS inventory. Daytona is an API the control plane calls. It is not a Terraform service and it stays.

| Today | Role | Replacement |
| --- | --- | --- |
| `control-plane-rds` (`portal_cp`) and Prisma `portal_app` | Tenants, users, jobs, connectors, model tokens | **D1**. Two databases, same split as today. Control-plane SQL in `migrate.ts` is the port. Prisma stays the model list until those tables are SQL on D1. |
| `portal-valkey` | Sessions, relay JTI, presence, leases | **Durable Objects**. Cron alarms live here too, so a stopped sandbox can still be woken. |
| `chat-corpus-infra`, `product-artifact-infra`, sandbox vault bucket | Files, artifacts, chat corpus | **R2**. The guest can keep an S3-compatible mount pointed at R2. |
| `portal-bff-service`, `portal-control-plane-service` | API and private control plane | **Workers**. Control plane stays unbound from the public internet (service binding). |
| `portal-static-edge` | SPA | **Workers static assets** |
| `portal-dns-tls`, `portal-waf` | DNS, TLS, WAF | Cloudflare DNS, certificates, and WAF |
| Secrets Manager + Cognito | Model keys, IdP | Worker secrets for platform keys. Per-tenant model keys encrypted in D1. Local password sessions stay valid without Cognito. |
| `portal-relay-service`, `tier3-dedicated-relay` | Gateway WebSocket bus | Not the v1 chat path. Chat is HTTP to a backend base URL. A Durable Object can hold a socket later if a guest gateway still needs one. |
| `company-brain-ec2`, `platform-vpc`, account factory, customer IAM | Always-on VM and account-per-tenant | Leave them. The computer is Daytona. |
| `staging-document-server` | ONLYOFFICE | Local Docker for this plan. Not a Cloudflare database. |
| `security-observability` | GuardDuty, flow logs | Later. Logpush is enough once Workers are up. |

Hyperdrive in front of RDS keeps the database this plan is leaving. Cloudflare Containers are a possible later home for ONLYOFFICE, not for the agent computer.

## Backend connection

An agent backend becomes three fields:

- `base_url` — OpenAI-compatible model endpoint, or a Lanyard harness turn URL
- `api_key` — bearer token for that endpoint
- `protocol` — `openai_chat` or `lanyard_harness`

Localhost must complete one chat turn with those fields and no relay, no Cognito, and no Secrets Manager. The harness HTTP shape from plan 0015 is the one to keep. Hermes-named settings reads go through the backend runtime contract that already exists. LiteLLM tier routing (simple / moderate / complex) can wait; one strong model and one key is the first connection.

## Work order

Do these in order. Later rows start only when their blockers in [issue-map.md](./issue-map.md) are done. Rows marked parallel can run beside the row above them once that row's blocker is done.

| Order | Work | Done when |
| --- | --- | --- |
| 1 | Boot the current portal on localhost | Health checks for BFF, relay, and control plane; one chat turn; the scheduled-task list opens; a vault file reads. No AWS. |
| 2 | Rework backend connectivity | That chat uses base URL + API key only. |
| 3 | Two personas on localhost | Each has its own key, its own cron list, and its own memory files. |
| 4 | Lock this service map | The table above is the decision bead. Amend it before Workers code if a row is wrong. |
| 5 | D1 for `portal_cp` and `portal_app` | `wrangler` local D1 serves the tables the localhost loop touches. |
| 6 | R2 for the filesystem | A file written to the vault is still there after the process restarts, with no sandbox. |
| 7 | Durable Objects for sessions, leases, and cron alarms | A due job is recorded while nothing is running in AWS or in a sandbox. |
| 8 | Cloudflare API token | Human creates a token for Workers, D1, R2, and Durable Objects. Local steps 5–7 do not need it. |
| 9 | Workers for BFF, control plane, and the SPA | The localhost loop answers on a `*.workers.dev` host. |
| 10 | Daytona wake from that control plane | Idle sandbox starts on chat or cron, R2 prefix attaches, idle stop still happens. |
| 11 | Cron list and fire | The user sees that agent's jobs; a due job wakes the sandbox and runs. |
| 12 | Memory across idle | MemPalace stays on R2. Recent working context is restored on wake. |
| 13 | Browser use | `agent-browser` runs inside the sandbox; the portal shows the session. |
| 14 | Install programs | A package installed on the persistent disk is still there after idle. |
| 15 | Office inline | Local ONLYOFFICE opens a vault document. |
| 16 | Webhook trigger | A signed HTTP trigger wakes the same path as cron. |
| 17 | Leave AWS staging parked | Open AWS-live beads stay open and are not the next ready work. |

Parallel with step 1 once the boot is understood: step 4 (the map is already written here). Parallel with step 2: a local `agent-browser` spike that does not need Daytona. Parallel with step 6: step 15 against the local vault, then point it at R2.

## Out of this plan

- Re-enabling platform-staging VPC, NAT, ALB, ECS, RDS, or CloudFront.
- Rewriting the portal UI.
- Vendoring Hermes or Lanyard Agent source.
- Per-chat sandboxes.
- Moving the model loop onto Cloudflare Workers AI.
- Keyword triggers, Slack, and the rest of the channel matrix in plan 0016.
- Multi-user vault scopes (`lp-zoh`) until one agent, one prefix, and one sandbox work on R2.

## Cloudflare access to add later

Not needed for steps 1–3. Needed before step 9:

- Account ID
- API token: Workers Scripts Edit, D1 Edit, R2 Edit, Durable Objects Edit
- A Daytona API key already used by the control plane, stored as a Worker secret
- One model API key for the first persona

Daytona billing stays outside Cloudflare. Keep the sandbox count at one while proving wake.
