# Runbook: Portal Valkey G5 enable path + dual-BFF residual

**Bead:** `lp-t7q.8` (migrated `cbd-mta.4.4`)  
**Status:** Deploy store **infra_ready**; pilot often **Valkey off**; live dual-BFF staging proof **deferred** (reason below)  
**Purpose:** Single operator path to enable private Valkey for BFF shared sessions (G5) and honesty rules so module presence is never mistaken for production certification.

**Related surfaces**

| Surface | Role |
|---------|------|
| `modules/portal-valkey/` | Private TLS ElastiCache Valkey + Secrets Manager `REDIS_URL` |
| `modules/portal-bff-service/` | Public BFF; `secrets.REDIS_URL`; `desired_count=1` until G5 ack |
| `modules/portal-relay-service/` | Same store for G6 bus/jti (out of scope for this residual's dual-BFF proof) |
| `environments/platform-staging/` | Optional compose (`enable_portal_valkey` **default false**) |
| `references/readiness-matrix.md` | Gate **G5** stays **blocked** until product multi-instance + live staging evidence |
| Portal product | ADR `portal/docs/adr/g5-bff-shared-state.md`; CI dual-instance test `packages/bff/test/dual-instance-session.integration.test.ts` |
| Sibling runbooks | `portal-compute-staging-apply.md` §4b, `platform-staging-compose.md`, `staging-secrets-checklist.md` |

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Module is real Terraform + offline smoke | **Yes** — `bash scripts/smoke-portal-valkey.sh` |
| Pilot / mocklab often runs with Valkey | **No** — compose default `enable_portal_valkey=false`; single-task BFF uses in-process `memory` sessions |
| Product multi-instance session code exists | **Yes** — Redis session backend + CI dual-instance sticky-less test (ioredis-mock) |
| Live dual-BFF staging session/routing proof recorded | **No — deferred** (see § Dual-BFF residual) |
| Matrix **G5** ready / production certified from this module | **No** — **infra_ready only**; `modules/portal-valkey` alone is **not** production certification |
| Safe to set BFF `desired_count > 1` from docs alone | **No** — requires product G5 + staging dual-BFF evidence + `acknowledge_g5_scale_beyond_one` |

**Rule:** `infra_ready` ≠ production-certified ≠ G5 **ready**. Offline CI green and module presence never flip the readiness-matrix G5 row.

---

## When Valkey stays off (pilot / mocklab default)

Use this path unless you are deliberately proving multi-task shared sessions.

| Setting | Pilot value | Why |
|---------|-------------|-----|
| `enable_portal_valkey` | **false** | Avoid idle ElastiCache cost until consumers need shared state |
| BFF `desired_count` | **1** | No cross-task session requirement |
| `BFF_SESSION_BACKEND` | `memory` (product default) | Process-local sessions on the single task |
| `BFF_MULTI_INSTANCE` | unset / false | Startup must not require Redis |
| Relay `RELAY_CLUSTER_MODE` | `single` | G6 bus not required for pilot chat |

This is **expected** for mocklab and many staging pilots. It is **not** a G5 clearance and **not** multi-instance production readiness.

---

## Enable path (operator)

### A. Composed platform-staging root (preferred when using that root)

1. Private working copy only: `backend.tf` + `terraform.tfvars` from examples (never commit live IDs/secrets).
2. Offline first:
   ```bash
   cd environments/platform-staging
   terraform init -backend=false -input=false && terraform validate
   bash ../../scripts/smoke-platform-staging-compose.sh
   bash ../../scripts/smoke-portal-valkey.sh
   ```
3. In **private** tfvars:
   ```hcl
   enable_portal_valkey = true
   # Staging cost path is the compose default when enabled:
   # valkey_num_cache_clusters         = 1
   # valkey_multi_az_enabled           = false
   # valkey_automatic_failover_enabled = false
   ```
4. Keep BFF/relay `desired_count = 1` until dual-BFF proof is recorded.
5. Ensure inject flags stay on (compose defaults):
   - `inject_redis_url_into_bff = true`
   - `inject_redis_url_into_relay = true` only if relay will use the store (G6 still separate)
6. Product non-secret flags on BFF (plain env — **not** secret values):
   ```hcl
   bff_environment_variables = {
     NODE_ENV            = "production"
     BFF_SESSION_BACKEND = "redis"   # only after Valkey is healthy
     # BFF_MULTI_INSTANCE = "true"  # only with desired_count > 1 + G5 ack + proof
   }
   ```
7. `terraform plan` / `apply` in the **Lanyard platform staging** account only.
8. Confirm secret **ARN** wiring (not plaintext): task has `REDIS_URL` from SM JSON key; outputs expose `redis_url_secret_arn` only.
9. Health: BFF `GET /health` (liveness, no Redis dependency). When backend is redis, optional `GET /ready` PINGs Redis before multi-task traffic.

Full compose apply/rollback: `references/runbooks/platform-staging-compose.md`.

### B. Split / private operator root (module composition)

Two-pass SG wiring is normal (task SGs must exist before Valkey allow-list).

```hcl
module "portal_valkey" {
  source     = "../../modules/portal-valkey"
  name_prefix = "lanyard-portal-staging"
  environment = "staging"
  vpc_id      = var.vpc_id
  subnet_ids  = var.private_subnet_ids
  # Staging cost path until HA is intentionally chosen:
  num_cache_clusters           = 1
  multi_az_enabled             = false
  automatic_failover_enabled   = false
  allowed_security_group_ids   = [
    module.portal_bff.task_security_group_id,
    # module.portal_relay.task_security_group_id,  # when G6 consumers exist
  ]
  acknowledge_not_auto_applied = true
}

module "portal_bff" {
  source        = "../../modules/portal-bff-service"
  # … digest pin, network …
  desired_count = 1
  environment_variables = {
    NODE_ENV             = "production"
    BFF_SESSION_BACKEND  = "redis"
  }
  secrets = {
    REDIS_URL = {
      value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
    }
  }
  acknowledge_not_auto_applied = true
  # desired_count > 1 requires acknowledge_g5_scale_beyond_one = true
}
```

Never put `REDIS_URL`, auth tokens, or full `rediss://` URLs in plain `environment_variables`, tfvars values, or Terraform outputs. Names-only checklist: `staging-secrets-checklist.md` § Valkey / Redis wiring.

### C. Staging cost vs HA (topology)

| Mode | Settings | Use when |
|------|----------|----------|
| **Staging cost (default enable path)** | 1 node; multi-AZ off; automatic failover off | First enable; pilot shared-session experiments at `desired_count=1` |
| **Production-credible HA** | ≥2 clusters; multi-AZ + automatic failover on | Only after operator chooses HA cost and still **not** a G5 ready flip by itself |

Module standalone default remains HA-capable; **platform-staging compose** deliberately uses the cost path when Valkey is enabled. See `modules/portal-valkey/README.md` § Topology.

### D. Disable / rollback

1. Product: set `BFF_SESSION_BACKEND=memory` (or remove redis backend) **before** destroying the store if a single task must keep serving.
2. Keep `desired_count=1`.
3. Compose: `enable_portal_valkey=false` only after consumers tolerate absence.
4. Do not leave multi-task BFF pointing at a removed store.

---

## Dual-BFF session/routing residual (proof deferred)

### What is already proven (product / CI — not live multi-instance staging)

| Evidence | Location | What it proves |
|----------|----------|----------------|
| G5.1 ADR | `portal/docs/adr/g5-bff-shared-state.md` | Shared store model, TTLs, fail-closed outage |
| Redis session implementation | `portal/packages/bff/src/redis-session-store.ts` | Shared session keys / backend |
| Dual-instance sticky-less integration test | `portal/packages/bff/test/dual-instance-session.integration.test.ts` | Two BFF apps + shared Redis (ioredis-mock in CI): login on A → API on B; kill A; store down → 401 fail-closed |
| Deploy wiring contract | `modules/portal-valkey` + BFF `secrets` map | Private TLS store + ARN inject; scale-out ack gate |

### What is **not** proven (live staging)

| Missing proof | Why it matters |
|---------------|----------------|
| Two **ECS tasks** behind the **staging BFF ALB** with `desired_count ≥ 2` | Real LB routing + cookie stickiness absence |
| Login via public edge → subsequent requests landing on **different** healthy tasks with shared Valkey | Session continuity without sticky affinity |
| Task replacement / scale event while session remains valid | Ops durability under ECS replacement |
| Valkey outage under multi-task → fail-closed auth (no memory split-brain) in AWS | Product ADR behavior under real network/SG failure |

### Deferral reason (acceptance for this residual)

Live multi-instance dual-BFF staging is **deferred** because:

1. **Pilot cost / topology:** platform-staging and mocklab pilots keep `enable_portal_valkey=false` and BFF `desired_count=1` by design (cost profile + single-task session sufficiency).
2. **No dedicated live multi-instance campaign in this residual:** `lp-t7q.8` is documentation + readiness honesty, not a full dual-task apply/proof campaign. Operator-owned AWS staging with real image digests and private roots is required for that proof and is not simulated by offline smokes.
3. **G5 matrix stays blocked honestly:** product multi-instance + **recorded** staging dual-BFF evidence are still required before flipping readiness-matrix **G5** or setting production-like `desired_count > 1`.

This residual **meets acceptance** by documenting the enable path and **explicitly deferring** dual-BFF live proof with the reasons above — not by claiming the proof done.

### Operator checklist when dual-BFF proof is later executed

Do **not** mark this checklist done from this residual alone.

```text
[ ] Valkey applied (private subnets, TLS, AUTH, SG from BFF task SG only)
[ ] BFF REDIS_URL via secrets map (ARN:REDIS_URL::); never plain env
[ ] BFF_SESSION_BACKEND=redis; SESSION_TTL / MAX_AGE defaults or explicit
[ ] desired_count >= 2 with acknowledge_g5_scale_beyond_one=true
[ ] BFF_MULTI_INSTANCE=true (product fail-closed if redis missing)
[ ] Login via staging public edge; capture session cookie (no secret values in tickets)
[ ] Authenticated API succeeds across multiple requests without sticky session affinity
[ ] Stop or replace one task; session still valid on remaining tasks
[ ] (Optional) Block Valkey SG briefly → authenticated routes fail closed (401), no silent memory
[ ] Evidence attached privately; only then consider readiness-matrix G5 flip with review
```

Product ADR acceptance sketch (same shape): two tasks, one Redis, no sticky; kill A; stop Redis → fail closed.

---

## What this residual does **not** change

| Non-goal | Why |
|----------|-----|
| Portal BFF app routing / Brain RPC composition | Owned by other residuals (`lp-t7q.1`, etc.) |
| Relay jti / G6 bus multi-relay proof | Separate residual (`lp-t7q.9` / G6) — same store optional, different product gates |
| Web UI behavior | Out of scope |
| Auto-apply Valkey in CI or flip G5 to ready | Fail-closed honesty |
| Production certification | Module **infra_ready** only |

---

## Offline validation (no AWS apply)

```bash
# From deploy/
bash scripts/smoke-portal-valkey.sh
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-platform-staging-compose.sh
bash scripts/smoke-pilot-cost-profile.sh   # expects Valkey default off + cost path when enabled
bash scripts/validate-production-gates.sh # G5 remains blocked
```

From Portal monorepo (product substitute, not staging proof):

```bash
pnpm --filter @lanyard/bff test -- dual-instance-session
# optional real Redis: REDIS_URL=redis://… pnpm --filter @lanyard/bff test -- dual-instance-session
```

---

## Acceptance mapping (`lp-t7q.8`)

| Criterion | How satisfied |
|-----------|----------------|
| Enable path documented | This runbook §§ Enable path A–D + module/README + compose defaults |
| Dual-BFF session/routing proof **or deferred with reason** | **Deferred** — § Dual-BFF residual (pilot Valkey off; no live multi-instance campaign; CI substitute only) |
| No production cert from module alone | Honesty tables here + readiness-matrix G5 **blocked** + module Status **infra_ready** |
