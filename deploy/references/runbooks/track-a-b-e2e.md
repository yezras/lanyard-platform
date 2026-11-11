# Runbook: Track A / Track B E2E (skeleton)

**Status:** Skeleton — end-to-end checks for hosting tracks. Portal control-plane automation remains in the Portal repo; this document covers **data-plane** deploy surfaces owned here.

## Tracks

| Track | Meaning | Data-plane owner | Isolation (production) |
|-------|---------|------------------|------------------------|
| **Track A** — `lanyard_hosted` | Lanyard hosts the brain EC2 | company-brain-deploy tenant stack | **Target:** account-per-tenant. **Interim:** VPC-per-tenant + per-tenant KMS + log groups + DLM/`project_name` |
| **Track B** — `customer_account` | Customer AWS account hosts the brain EC2 | Same modules; different credentials/backend | Full **customer account** boundary |

Both tracks use the **same modules and artifact bootstrap**. Differences are account, state backend, networking, isolation partitions, and who holds the break-glass SSH path.

**Decision record:** `references/tenant-isolation-decision.md`  
**Onboarding procedure:** `references/runbooks/tenant-isolation.md`  
Unpartitioned multi-tenant shared VPC/KMS/roles are **forbidden** for production (`production_intent=true`).

## Shared E2E checklist

```text
[ ] Control plane: tenant created; instance provision returns relay_wss_url, instance_id, secret (once)
[ ] Compatibility pins validated (portal digests + hermes + client-core + relay major)
[ ] deployments/<slug> copied from templates/tenant; tfvars filled (not in git)
[ ] Isolation vars set per tenant-isolation-decision.md (hosting_track, isolation_mode, project_name uniqueness)
[ ] If production_intent: aws_account_id, dedicated_kms_key_arn (lanyard_hosted), log_group_prefix
[ ] bash scripts/validate-production-gates.sh passes (G1/G2 honesty; not a product go-live alone)
[ ] terraform init / plan / apply clean
[ ] SSH to host; /etc/company-brain/artifact-pins.env present and not UNCONFIGURED
[ ] /usr/local/sbin/company-brain-bootstrap exists, root-owned, executable
[ ] sudo /usr/local/sbin/company-brain-bootstrap succeeds (Hermes then client-core seed)
[ ] Provenance under /opt/hermes-lanyard/.seed and /opt/company-brain/.seed
[ ] GATEWAY_RELAY_* merged; gateway running; egress-only (no inbound portal ports)
[ ] Portal path https://app.withlanyard.com/<tenant_slug> streams a reply
[ ] Roles admin + contributor usable per hermes-profile-rbac.md
[ ] DLM policy present; Backup=daily tags on volumes
```

## Track A specifics

- Account factory contract: `modules/account-factory/` + `references/runbooks/account-factory.md`.
- Remote state in Lanyard-owned / per-tenant backend (`templates/tenant/backend.tf.example` Track A section; prefer `state_backend_config_template` after baseline) — **one state key per tenant**.
- Provider: set `deploy_role_arn` from factory `deploy_role_arn` **or** SSO into the tenant account (leave ARN null). Optional ExternalId only if factory trust requires it.
- Wire `dedicated_kms_key_arn` from factory `kms_key_arn` (template falls through to EBS CMK when `ebs_kms_key_id` unset).
- Operator SSH from Lanyard CIDRs / Tailscale (never `0.0.0.0/0`); SSM-first.
- Artifact buckets readable by instance role (`artifact_s3_bucket_arns`); `artifact_cross_account_mode=same_account` or `https_pins`.
- Isolation: `isolation_mode=account` (preferred) or `vpc_interim` with dedicated KMS + log prefix + unique `project_name`.
- Production: set `production_intent=true` only when partitions are real.
- Offline: `bash scripts/smoke-tenant-template-wiring.sh` and `bash scripts/smoke-account-factory.sh`.

## Track B specifics

- Customer access module: `modules/customer-account-access/` + `references/runbooks/track-b-customer-account-access.md`.
- Assume customer role via `deploy_role_arn` + **required** `deploy_role_external_id` (from Lanyard secret at `external_id_parameter_name`) **or** dual-alias `providers.tf.example` / separate AWS profile.
- `isolation_mode=customer_account`; record `aws_account_id` (must match role ARN account when production_intent + assume-role).
- Confirm customer VPC/subnet variables if not default VPC.
- Confirm customer can reach artifact URLs: `platform_bucket_grant` | `customer_mirror` | `https_pins` (`artifact_cross_account_mode`).
- Customer-owned remote state backend — never Lanyard platform state (`backend.tf.example` Track B).
- Secrets never cross accounts via this git repo; never commit ExternalId.
- No shared Lanyard multi-tenant instance role in the customer account.
- Offline: `bash scripts/smoke-tenant-template-wiring.sh` and `bash scripts/smoke-customer-account-access.sh`.

## Failure matrix (minimal)

| Symptom | First look |
|---------|------------|
| Bootstrap exit 2 | Unconfigured pins, branch version, or git URL |
| Bootstrap exit 4 | SHA-256 mismatch |
| Bootstrap exit 6 | Ed25519 attestation missing/invalid (`REQUIRE_ARTIFACT_ATTESTATION=1` or bad signature) |
| No portal reply | Relay env, WSS egress, control-plane secret |
| Validate fails in CI | fmt, module source paths, shell smoke |

## Unfinished / next phases

- Scripted E2E harness (API + SSH) outside this milestone
- Automated Track B dry-run in CI with mocked AWS
- Live multi-account certification (modules remain **infra_ready**; ops-owned apply)

## Track A account factory

Contract module: `modules/account-factory/`. Runbook: `references/runbooks/account-factory.md`.  
Tenant consume: `templates/tenant` (`deploy_role_arn`, backend from `state_backend_config_template`).

## Track B customer-account access

Contract module: `modules/customer-account-access/`. Runbook: `references/runbooks/track-b-customer-account-access.md`.  
Tenant consume: `templates/tenant` (`deploy_role_arn` + `deploy_role_external_id`, customer backend, artifact mode).
