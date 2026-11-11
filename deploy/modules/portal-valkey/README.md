# portal-valkey

Reusable Terraform module for **private, encrypted Amazon ElastiCache Valkey** (Redis-compatible) used as Portal **shared state** for BFF sessions (G5) and relay bus/jti (G6).

| Resource | Purpose |
|----------|---------|
| ElastiCache replication group | Valkey (default) or Redis; TLS + at-rest encryption + AUTH |
| Cache subnet group | **Private subnets only** (≥2) |
| Security group | Ingress 6379 from allow-listed SGs/CIDRs (**not** `0.0.0.0/0`) |
| Secrets Manager secret | `REDIS_URL` / `url` JSON payload (`rediss://…`) |
| Optional SSM String | Pointer to the secret **ARN** (not the auth token) |
| Optional CloudWatch logs | slow-log / engine-log delivery |
| Optional CloudWatch alarms | CPU, memory usage %, evictions |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with `terraform init -backend=false && terraform validate` |
| Product consumers (G5/G6) | BFF `REDIS_URL` / relay bus still product-gated; this module is deploy-side store only |
| Applied in platform staging from this repo | **Optional** — composed behind `enable_portal_valkey` (**default false**); not auto-applied; pilot/mocklab often leave Valkey **off** |
| Live dual-BFF staging session proof | **Deferred** — CI dual-instance substitute exists; AWS multi-task proof open (see residual runbook) |
| Production shared-state security | Still requires private SG wiring to BFF/relay, product multi-instance flags, and **recorded** staging evidence |

Readiness: **infra_ready** (**not production certified**). **This module alone is not production certification** and does **not** flip readiness-matrix **G5**/**G6**. Those gates stay **blocked** until product multi-instance + live staging evidence. Operator enable path + residual honesty: [`references/runbooks/portal-valkey-g5-enable.md`](../../references/runbooks/portal-valkey-g5-enable.md) (`lp-t7q.8` / migrated `cbd-mta.4.4`).

## Fail-closed posture

- `transit_encryption_enabled` **must** be `true` (variable validation + resource hardcode + `transit_encryption_mode = required`).
- `at_rest_encryption_enabled` **must** be `true` (variable validation + resource hardcode).
- `subnet_ids` requires **≥2** subnets; plan-time checks require `map_public_ip_on_launch=false` and matching `vpc_id`.
- `allowed_cidr_blocks` rejects `0.0.0.0/0` and `::/0`.
- At least one of `allowed_security_group_ids` or `allowed_cidr_blocks` is required (prefer BFF + relay task SGs).
- Auth token is **generated** (`random_password`) — never accepted via tfvars; **never** emitted as a non-sensitive output (secret **ARN** only).
- `acknowledge_not_auto_applied=true` required so callers do not treat examples as live apply.

## Topology: staging cost vs HA

| Mode | Suggested settings | Notes |
|------|--------------------|--------|
| **Default (production-credible HA)** | `num_cache_clusters = 2`, `multi_az_enabled = true`, `automatic_failover_enabled = true`, `node_type = cache.t4g.micro` | Smallest multi-AZ Valkey pair; failover capable |
| **Staging cost path** | `num_cache_clusters = 1`, `multi_az_enabled = false`, `automatic_failover_enabled = false` | Single node; still TLS + private SG + encrypted; lower cost, no HA. **`environments/platform-staging`** uses these as compose defaults when Valkey is enabled (`enable_portal_valkey` still defaults **false**) |
| **Higher production load** | Raise `node_type` / `num_cache_clusters` in private tfvars | Not sized from this repo’s examples |

## Product env contract

Portal BFF / relay (staging secrets checklist) expect:

```text
REDIS_URL=rediss://:AUTH_TOKEN@host:6379
# BFF multi-task also needs BFF_SESSION_BACKEND=redis and BFF_MULTI_INSTANCE=true (product-side)
# Relay multi-node needs RELAY_CLUSTER_MODE=bus (+ RELAY_NODE_ID / RELAY_ADVERTISE_URL)
```

This module stores that value under Secrets Manager. Preferred wiring through G8 service modules:

1. Apply this module; allow-list BFF + relay **task** security groups.
2. Wire consumers via generic `secrets` maps (not plain `environment_variables`):

```hcl
# modules/portal-bff-service and modules/portal-relay-service (private composition root)
secrets = {
  REDIS_URL = {
    value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
  }
}
```

3. ECS injects `REDIS_URL` at task start; execution role gets `GetSecretValue` only for the declared ARN.
4. Non-secret flags stay in `environment_variables` (`BFF_SESSION_BACKEND`, `RELAY_CLUSTER_MODE`, session TTLs).

**Do not** commit auth tokens, full URLs, or live ARNs to git. Example tfvars use placeholder `vpc-` / `subnet-` / `sg-` shapes only.  
`REDIS_URL` must **not** appear in module outputs or plain task env on production-like environments.

### Consumers (deploy wiring)

| Consumer | Gate | Uses REDIS_URL for |
|----------|------|--------------------|
| `modules/portal-bff-service` | G5 | Shared sessions (documented TTLs: 7d sliding / 30d max age) |
| `modules/portal-relay-service` | G6 | Owner leases, routing bus, jti / revocation |

See those module READMEs for composition examples, single-node defaults, and store-outage fail-closed notes.  
`environments/platform-staging` does **not** compose Valkey (artifact landing zone only).

Outputs:

| Output | Contents |
|--------|----------|
| `redis_url_secret_arn` | Secret ARN (preferred; no plaintext token) |
| `primary_endpoint_address` / `port` | Non-secret host + port for ECS wiring |
| `redis_url_shape` | Redacted `rediss://:***@host:port` |
| `ecs_secret_injection` | Machine-readable consumption notes |
| `security_group_id` | Cache SG (wire from client SGs inbound) |

Raw auth tokens are **not** exposed as non-sensitive outputs. Terraform state still contains generated secrets — protect the state backend.

## Usage

```hcl
module "portal_valkey" {
  source = "../../modules/portal-valkey"

  name_prefix = "lanyard-portal-staging"
  environment = "staging"

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  # Prefer BFF + relay task security groups (P1 shared state clients).
  allowed_security_group_ids = [
    module.portal_bff.task_security_group_id,
    module.portal_relay.task_security_group_id,
  ]

  acknowledge_not_auto_applied = true
}

module "portal_bff" {
  source = "../../modules/portal-bff-service"
  # … digest pin, network, desired_count = 1 …
  secrets = {
    REDIS_URL = {
      value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
    }
  }
  acknowledge_not_auto_applied = true
}

module "portal_relay" {
  source = "../../modules/portal-relay-service"
  # … digest pin, network, desired_count = 1 …
  secrets = {
    REDIS_URL = {
      value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
    }
  }
  acknowledge_not_auto_applied = true
}
```

Prefer **relative** module sources inside this monorepo. External consumers must pin a tag/commit — never `ref=main`.

## Validate (no credentials / no apply)

```bash
cd modules/portal-valkey
terraform init -backend=false -input=false
terraform validate
```

Offline posture smoke (repo root):

```bash
bash scripts/smoke-portal-valkey.sh
```

## Residual honesty (G5 dual-BFF)

| Item | State |
|------|--------|
| Enable path | Documented: compose `enable_portal_valkey=true` (staging cost defaults) **or** private composition below; full procedure in `references/runbooks/portal-valkey-g5-enable.md` |
| Pilot default | Valkey **off**; BFF `desired_count=1` + `BFF_SESSION_BACKEND=memory` is normal and expected |
| Dual-BFF live proof | **Deferred with reason** — no multi-instance staging campaign in this residual; product CI dual-instance test is a substitute only |
| Production cert | **Never** from module presence / offline smoke alone |

## What this does **not** do

| Non-goal | Why |
|----------|-----|
| Clear G5/G6 matrix gates | Product multi-instance + **live** staging dual-BFF/multi-relay evidence still required; wiring alone is not proof |
| Auto-enable on platform-staging | Compose default `enable_portal_valkey=false` (pilot cost); opt-in only |
| Auto-apply from CI or examples | Operator-owned; placeholders only in git |
| Accept auth tokens in tfvars | Secrets Manager only |
| Public cache or public-subnet groups | Rejected fail-closed |
| Emit REDIS_URL plaintext outputs | Secret ARN + redacted shape only |
| Claim production certification from module presence | **infra_ready** only — never production-certified from this module alone |

## Files

See [INDEX.md](./INDEX.md).
