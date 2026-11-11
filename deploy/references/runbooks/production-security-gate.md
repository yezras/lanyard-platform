# Runbook: Production security gate (fail-closed)

**Status:** Operator procedure — **private-by-default** production gate  
**Purpose:** Prevent declaring Portal relay / control-plane **production ready** while G1/G2 (and related deploy-owned checks) remain blocked.  
**Source of truth:** `references/readiness-matrix.md` § Production security gates  
**Live residual ledger:** `references/runbooks/readiness-live-proofs-residual.md` (`lp-t7q.7` — G1.4/G1a/G2/G3 pass/fail/blocked notes; monorepo smokes never flip ready)  
**Related:** `references/tenant-isolation-decision.md`, `references/migration-phases.md`

---

## Fail-closed rule (non-negotiable)

| Rule | Operator action |
|------|-----------------|
| G1 private control-plane boundary is **blocked** | Do **not** expose control plane on a public ALB or claim production Portal control-plane ready |
| G2 relay credential lifecycle is **blocked** | Do **not** claim production relay security complete until **staging** lifecycle E2E is recorded (product APIs/runbooks exist — Portal #7/#9/#10/#12, deploy #6 — but matrix stays fail-closed) |
| Platform compute modules only **infra_ready** | Do **not** claim G8 production-certified from module presence; staging apply + G1/G2/G7 evidence still required (`portal-compute-staging-apply.md`) |
| Control-plane RDS only **infra_ready** | Do **not** claim production RDS applied from example tfvars; product uses `CONTROL_PLANE_DATABASE_URL` |
| `scripts/validate-production-gates.sh` fails | **Stop** production go-live sign-off |

Customer data-plane wiring (`modules/customer-gateway-relay/`) being **present** is **not** the same as production relay/control-plane security being ready.

---

## Production security checklist (G1 / G2 + deploy-owned)

Copy into the change ticket. Every line must be true for production Portal/relay **security** sign-off. Until then status remains **blocked**.

### G1 — Authenticated private control-plane boundary

```text
[ ] Control plane not attached to a public ALB listener
[ ] Browser traffic reaches BFF only; BFF→control-plane is private network or private service mesh
[ ] Verified OIDC (or equivalent) for operator/human auth to control plane APIs
[ ] Service-to-service auth (BFF↔control-plane) verified in staging
[ ] No public unauthenticated control-plane admin routes
```

**Owner:** Portal product + future Portal compute modules. **Deploy repo:** non-claims only until product clears G1.

### G2 — Relay credential lifecycle

```text
[ ] Register path: POST .../instances/register returns instance_id + one-time secret (provision alias OK)
[ ] Rotate path: POST .../instances/:id/rotate + SSM overwrite + host refresh (not manual-only forever)
[ ] Revoke path: per-instance revoke and/or deprovision; relay kill-switch; gateway 4401
[ ] Deploy runbook is lifecycle-first: references/runbooks/relay-secret-lifecycle.md (+ provision-runbook)
[ ] Lab inline relay_instance_secret labeled non-production only
[ ] Secrets not committed to git; production uses SSM/SM refs only
[ ] Replay resistance: nonce/session binding or equivalent product control documented (G2a)
```

**Owner:** Portal control-plane/relay product. **Deploy repo:** maps register outputs + SSM/SM lifecycle (`customer-gateway-relay`, relay-secret-lifecycle runbook).

### Per-tenant authorization / isolation

```text
[ ] Tenant isolation decision followed (see tenant-isolation-decision.md)
[ ] production_intent tenants pass templates/tenant isolation validations
[ ] No shared instance roles across production tenants
[ ] Unique project_name / account boundary recorded
```

### Payload log / retention controls

```text
[ ] Relay and control-plane payload logging policy defined (what is stored, TTL)
[ ] Operator access to logs is break-glass / audited where production requires it
[ ] Customer vault content is not shipped to shared multi-tenant debug buckets by default
```

### Deploy-owned network defaults (data plane)

```text
[ ] operator_ssh_cidrs never includes 0.0.0.0/0 (module-enforced)
[ ] Production SSH off by default (empty operator_ssh_cidrs); prefer SSM Session Manager
[ ] Production SG egress is not protocol=-1 to 0.0.0.0/0 (controlled egress)
[ ] Production ami_id pinned (golden AMI preferred; use_golden_ami when prebaked)
[ ] No inbound portal ports on brain EC2 (egress-only WSS doctrine)
[ ] Secrets not hardcoded in Terraform sources in git
[ ] Artifact pins are URL + version + SHA-256 (no live git branch as version)
[ ] Production: REQUIRE_ARTIFACT_ATTESTATION=1 with Ed25519 signatures + release pubkey (lab may omit)
```

### Data processors / data-handling (data plane)

```text
[ ] Client policy from references/templates/client-data-handling-policy.md (private copy)
[ ] approved_processor_ids ⊆ references/approved-data-processors.md
[ ] Zero-retention / private-endpoint requirements recorded for model providers when vault-derived prompts leave the host
[ ] Domain allowlist (firewall/proxy) matches processor_egress_domains / policy when arbitrary HTTPS is forbidden
[ ] New processors completed references/runbooks/data-processor-onboarding.md (security review)
```

---

## What this repo may claim vs must not claim

| May claim | Forbidden claim while G1/G2 blocked |
|-----------|-------------------------------------|
| Customer gateway **wiring** module ready | Production Portal/relay security ready (**blocked** — do not claim) |
| Tenant EC2 + EBS + DLM ready | Control-plane private boundary implemented here (**blocked**) |
| Phase 2 artifact landing zones infra_ready | RDS production-applied from examples (**infra_ready** module only; operator apply separate) |
| Tier 3 **infra_ready** module (ALB/ECS topology) | Tier 3 dedicated relay production-complete / production-certified (still not auto-applied; G2 required) |

---

## Validation command

From repo root (offline, no AWS credentials):

```bash
bash scripts/validate-production-gates.sh
```

Exit non-zero means readiness docs or flags are inconsistent with fail-closed policy — fix docs/claims before any production sign-off.

Optional CI wiring: same command after compatibility validation (see root `INDEX.md` / `.github/workflows/ci.yml`).

---

## Cross-links (Portal product)

Product work lives in the Portal monorepo (not this repository):

- Control-plane OIDC and BFF service auth (G1)
- Relay register / rotate / revoke (G2)
- Brain RPC (G3): contract `references/brain-rpc-contract.md` (G3.1); Hermes handlers + Portal vertical slice still required
- Control-plane RDS apply from private operator root (`modules/control-plane-rds`, G4.3 **infra_ready**; product Postgres G4.1/G4.2 done)

Do **not** pull Portal application source into company-brain-deploy. Wire **provision outputs** and **image digests** only when compute phases open.
