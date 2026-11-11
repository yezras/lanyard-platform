# Runbook: upgrade and rollback (skeleton)

**Status:** Skeleton — procedures are operator-ready outlines. Fill real artifact URLs, change windows, and ownership during first production cutover.

**Scope:** Hermes runtime + client-core seed + (later) Portal image digest bumps consumed by this deploy surface.

## Principles

1. Pin **immutable** versions (URL + version + SHA-256; Portal by **digest**). Never upgrade via `main` / floating tags alone.
2. Prefer **Hermes-first** then re-seed only when vault has no live `AGENTS.md` (live vaults are not overwritten by bootstrap).
3. Vault durability is **EBS + DLM**, not customer Git. Rollback of vault content = snapshot restore (see `dlm-restore-drill.md`).
4. Compatibility pins live in operator-held manifests validated by `scripts/validate-compatibility.sh`.

## Upgrade (Track A sketch)

| Step | Action | Exit criteria |
|------|--------|---------------|
| 1 | Publish Hermes / client-core artifacts; record SHA-256 | Digests in release notes |
| 2 | Update private compatibility pins; run `validate-compatibility.sh` | Validator PASS |
| 3 | Update tenant `terraform.tfvars` artifact vars (not committed) | `terraform plan` shows user_data/pin intent only as expected |
| 4 | `terraform apply` if IAM/SG/DLM/user_data pins require it | Apply clean |
| 5 | On host: re-run `sudo /usr/local/sbin/company-brain-bootstrap` (new pins in `/etc/company-brain/artifact-pins.env` after apply, or export overrides) | Hermes provenance under `/opt/hermes-lanyard/.seed/` updated |
| 6 | If vault already has `AGENTS.md`, apply **manual** client-core deltas or pack scripts — do not force re-seed | Documented vault change list |
| 7 | Merge `GATEWAY_RELAY_*` if relay contract major changed | Gateway reconnects; portal smoke |

## Rollback

| Situation | Action |
|-----------|--------|
| Bad Hermes artifact | Re-pin previous Hermes URL/version/SHA; re-run bootstrap (Hermes path refresh is allowed) |
| Bad client-core seed on **new** host | Destroy/recreate or re-run bootstrap **only if** `AGENTS.md` absent; else restore EBS snapshot |
| Bad Terraform change | `terraform plan` reverse; avoid `terraform destroy` of data volumes |
| Portal image regression | Re-pin previous **digest** in private platform tfvars / pins; re-apply compose — see `platform-staging-compose.md` |

## Platform staging composed root (Portal cloud)

Customer-host Hermes/client-core steps above are **Track A data-plane**. For the central **platform-staging** compose (VPC, artifacts, RDS, BFF/relay/CP, static edge, optional Valkey/DNS):

- Apply, backend, secrets, and **rollback:** `references/runbooks/platform-staging-compose.md`
- Compute pin map and ordered apply: `references/runbooks/portal-compute-staging-apply.md`
- Artifact landing zone only: `references/runbooks/product-artifact-staging-apply.md`

Prefer re-pin digests over destroy. Status of the compose root remains **infra_ready** until private staging evidence exists — CI does not apply.

## Relay contract major bump

1. Confirm Hermes release supports the new major.
2. Set `relay_contract_major` in pins + tfvars.
3. Re-validate customer-gateway-relay env mapping (`GATEWAY_RELAY_*`).
4. Plan dual-run window if control plane still emits previous major.

## Unfinished / next phases

- Automated pin promotion pipeline from Portal release-bucket
- Blue/green host swap for zero-downtime Hermes upgrades

**RTO/RPO (backup path):** default examples **RPO 24h / RTO 4h** with quarterly DLM restore drills — see `dlm-restore-drill.md` and `references/tenant-isolation-decision.md` § Snapshot copy.
