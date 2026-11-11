# portal-relay-service

Thin **public relay** service on ECS Fargate + ALB, separate from the BFF.

| Resource | Purpose |
|----------|---------|
| Internet-facing ALB | Customer-host outbound WSS edge + `/health` |
| Target group | Health checks; optional stickiness until G6 bus |
| ECS Fargate service | Desired count default **1** (G6 gate for scale-out) |
| Task definition | Image pinned by **repository + digest** only |
| Secrets | Generic `secrets` map → ECS `secrets` (SM/SSM `value_from`); IAM scoped to declared ARNs/KMS |

## Status

**infra_ready** — real Terraform, not auto-applied, not production relay security (G2 still blocked).  
Managed Valkey wiring for bus/jti is deploy-ready; readiness-matrix **G6** stays **blocked** until product multi-relay bus + staging proof.

## Fail-closed posture

- Digest pin required (`sha256:` + 64 hex).
- `desired_count > 1` requires `acknowledge_g6_scale_beyond_one=true`.
- Relay stays separate from BFF; private backend services use a different module.
- Secrets via `var.secrets` (`value_from` ARNs only). Production-like `environment` rejects known secret names (including **`REDIS_URL`**) in `environment_variables`.
- Execution role: `GetSecretValue` / `GetParameters` / `kms:Decrypt` only for declared ARNs/keys (no `Resource="*"`).
- Outputs expose `secret_names` only — never `REDIS_URL` values or rediss URLs.
- Default `RELAY_CLUSTER_MODE=single` and `desired_count=1` until G6 is proven.

## Shared bus / jti / owner leases (G6) — Valkey / Redis

Multi-relay scale-out needs a shared store for:

| Use | Product responsibility |
|-----|------------------------|
| **jti / replay** | Shared single-use token store (extends G2a beyond one node) |
| **Owner leases** | Which relay owns a gateway session (exclusive dial) |
| **Revocation bus** | Cross-node revoke fan-out (kill-switch / 4401) |

| Concern | Contract |
|---------|----------|
| Product env key | **`REDIS_URL`** (`rediss://…` TLS) — same Valkey store as BFF is acceptable for staging; separate prefix/DB is product choice |
| Source | `module.portal_valkey.redis_url_secret_arn` |
| Injection | `secrets["REDIS_URL"].value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"` |
| Cluster mode | `RELAY_CLUSTER_MODE=single` (default) or `bus` (requires Redis + node identity) |
| Bus identity | `RELAY_ADVERTISE_URL`, `RELAY_NODE_ID` as plain env when `bus` |
| Stickiness | ALB stickiness may stay enabled until bus is proven; bus mode is the scale path |

### Store outage behavior (product-side; deploy documents only)

| Mode | When store is down / unreachable |
|------|----------------------------------|
| `RELAY_CLUSTER_MODE=single` | Local in-process jti/owner state only; **do not** scale beyond one task |
| `RELAY_CLUSTER_MODE=bus` | Product must **fail closed** on jti mint/check, owner lease, and cross-node revoke (no silent single-node memory that would allow replay or dual owners). Exact error codes / WSS close are Portal product ADR territory |
| Scale-out (`desired_count > 1`) | Forbidden without `acknowledge_g6_scale_beyond_one` **and** product G6 proof |

Deploy does **not** flip readiness-matrix **G6** to ready from wiring docs alone. G2 lifecycle production claim remains separately **blocked** until staging revoke E2E.

### Composition example (operator private root)

```hcl
module "portal_valkey" {
  source     = "../../modules/portal-valkey"
  name_prefix = "lanyard-portal-staging"
  environment = "staging"
  vpc_id      = var.vpc_id
  subnet_ids  = var.private_subnet_ids
  allowed_security_group_ids = [
    module.portal_bff.task_security_group_id,
    module.portal_relay.task_security_group_id,
  ]
  acknowledge_not_auto_applied = true
}

module "portal_relay" {
  source        = "../../modules/portal-relay-service"
  # … network + image_repository@image_digest …
  desired_count = 1
  environment_variables = {
    NODE_ENV           = "production"
    RELAY_CLUSTER_MODE = "single" # flip to bus only after Valkey + product G6
    # RELAY_ADVERTISE_URL = "https://relay.example.invalid"
    # RELAY_NODE_ID       = "relay-staging-a"
  }
  secrets = {
    RELAY_INTERNAL_TOKEN = {
      value_from = "arn:aws:ssm:us-east-1:000000000000:parameter/lanyard/staging/portal/relay-internal-token"
    }
    REDIS_URL = {
      value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
    }
  }
  acknowledge_not_auto_applied = true
}
```

`environments/platform-staging` does **not** compose Valkey or relay — operator private root only.

## Validate

```bash
cd modules/portal-relay-service
terraform init -backend=false -input=false && terraform validate
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-portal-valkey.sh
```

## Files

See [INDEX.md](./INDEX.md).
