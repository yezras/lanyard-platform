# Company Brain EC2

Reusable Terraform for a **customer-owned Hermes Company Brain** host on AWS EC2.

**Skip for `runtime_kind=daytona`** (`lp-4nf`, plan §4.11): do **not** instantiate this module for Daytona agent tenants. Those instances use Control Plane register + S3 vault prefix only; sandboxes are created lazily by the Instance Orchestrator (not per-tenant TF). Operator branch: [`docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md`](../../../docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md). EC2 branch: [`references/provision-runbook.md`](../../references/provision-runbook.md). Tenant template fails closed if `runtime_kind=daytona` is set on `templates/tenant`.

Part of **company-brain-deploy** (canonical client deployment). Generalized from the Fortified LitigationAgent Hermes host pattern (EC2 + encrypted EBS + DLM daily snapshots + CloudWatch status alarm + SSH break-glass). Client secrets and live state stay out of git.

## Layout

| Path | Purpose |
|------|---------|
| `main.tf` | AMI lookup, SG (SSM-first + controlled egress), EC2, instance role (+ SSM), optional Tailscale IAM/UDP, VPC endpoints, data volume, DLM, EBS BPA, alarms, optional host log group/CW agent |
| `variables.tf` | Network mode, optional SSH, SSM/endpoints, controlled egress, optional Tailscale, golden AMI, artifact pins, EBS CMK, host observability flags |
| `outputs.tf` | Instance id, IPs, SSM/SSH access commands, egress mode, bootstrap, artifact pins, observability, Tailscale summary |
| `versions.tf` | Terraform ≥ 1.7, AWS provider ~> 5.0 |
| `user_data.sh.tftpl` | Optional packages (or golden AMI skip), artifact-pins.env (`BACKEND_*` + temporary `HERMES_*` dual-write + client-core), bootstrap install, optional CW agent, optional Tailscale enroll helper |
| `setup.sh` | Optional post-seed helpers (Tailscale enroll/drop-in, seed scripts, **runtime hardening**) |
| `scripts/tailscale-enroll.sh` | Runtime install + SSM/SM auth-key fetch + `tailscale up` with tenant tags |
| `systemd/hermes-gateway.service` | Unprivileged sandboxed Hermes gateway unit (`User=hermes`) |
| `systemd/hermes-gateway.service.d/sandbox.conf` | Sandbox drop-in / override point |
| `systemd/tailscaled.service.d/accept-dns-off.conf` | Keep VPC DNS when Tailscale is installed |
| `references/deployment.md` | Operator runbook for this module |
| `AGENTS.md` | Rules for agents editing this module |

## Network mode (private-by-default)

| `network_mode` | Placement | Public IP | Default VPC |
|----------------|-----------|-----------|-------------|
| **production** | Requires `vpc_id` + `subnet_id` (private subnet) | Forced **false** | **Not** used |
| **lab** | Optional; null uses default VPC | Operator choice (default true) | Allowed (non-prod only) |

Public IP + default-VPC fallback are **lab / non-production only**. Tenant roots should set `network_mode = "production"` with explicit private VPC/subnet IDs.

## Access, egress, AMI (security wave)

| Control | Production default / recommendation |
|---------|-------------------------------------|
| SSH | `operator_ssh_cidrs = []` — no port 22; optional break-glass only |
| Key pair | Optional (`ssh_key_name = null` for SSM-only) |
| SSM | `enable_ssm_access = true`; optional PrivateLink endpoints (**primary** access) |
| Tailscale | `enable_tailscale = false` by default; optional **secondary** mesh; auth key from SSM/SM only |
| Egress | `controlled` (443/DNS/NTP); rejects all-protocol open; optional UDP 41641 for Tailscale direct |
| AMI | Pinned `ami_id` required; prefer `use_golden_ami = true` |

Runbooks: `references/runbooks/ssm-break-glass.md`, `tailscale-operator-access.md`, `controlled-egress.md`, `golden-ami-supply-chain.md`.

## Artifact IAM scope

Instance role S3 read is prefix/object-scoped when configured:

| Input | Effect |
|-------|--------|
| `artifact_s3_bucket_arns` | ListBucket target buckets |
| `artifact_s3_object_arns` | GetObject resources (e.g. `arn:aws:s3:::bucket/hermes/*`) |
| `artifact_s3_list_prefixes` | ListBucket `s3:prefix` StringLike values |

**Production defaults** (when buckets set but object ARNs/prefixes omitted): GetObject on `hermes/*` + `client-core/*`; ListBucket conditioned on those prefixes (product-artifact layout).

**Lab only:** empty object ARNs with buckets set grants `bucket/*` GetObject — do not use for production.

Pin object ARNs from product-artifact layout (`hermes/<version>/…`, `client-core/<version>/…`) or version-wide wildcards under those prefixes.

## IMDS / metadata (role exposure)

| Setting | Value | Why |
|---------|-------|-----|
| `http_tokens` | `required` | IMDSv2 only |
| `http_put_response_hop_limit` | `1` | Blocks credential theft via containers/nested hops that forward IMDS |

This host does not need hop limit > 1 (no container workload that requires host IMDS). Instance role permissions reachable via IMDS are limited to artifact S3 read and optional EBS CMK use — not broad account admin.

## EBS encryption / KMS / snapshots

- Root and optional data volumes: `encrypted = true`; optional `ebs_kms_key_id` (customer-managed CMK).
- **Production:** CMK is **strongly recommended** (tenant/customer-managed key).
- DLM daily snapshots of encrypted volumes **inherit the volume CMK** (AWS behavior; primary schedule has no separate `cmk_arn` for same-region volume snapshots).
- Module attaches least-privilege KMS use policies on the instance role and DLM role when `ebs_kms_key_id` is set (and on `cross_region_copy_cmk_arn` when set).
- `enable_ebs_snapshot_block_public_access` (default true) manages account/region **Block Public Access for EBS snapshots** (`block-all-sharing` by default).
- **Opt-in DR (cbd-mta.7.4, default off):** `enable_cross_region_copy` + `destination_region` (DLM `cross_region_copy_rule`, always `encrypted=true`); `enable_dr_account_share` + `dr_account_id` (DLM `share_rule` to a dedicated DR account only). See `references/tenant-isolation-decision.md` and `references/runbooks/dlm-restore-drill.md`.

### CMK key policy guidance (operators)

Grant use of the CMK only to:

1. **EC2 instance role** (`…-hermes-instance`) — encrypt/decrypt/generate data key/create grant for EBS via `ec2.<region>.amazonaws.com`
2. **DLM role** (`…-dlm`) — same actions for snapshot lifecycle
3. **Operator / break-glass roles** — as needed for restore; never `Principal = "*"`

Keep key policy least-privilege; prefer condition keys (`kms:ViaService`, encryption context) where practical.

## Usage from tenant template

```hcl
module "company_brain" {
  source = "../../modules/company-brain-ec2"

  region       = var.region
  project_name = "acme-brain"
  # SSM-first: leave SSH empty in production
  operator_ssh_cidrs = []
  enable_ssm_access  = true

  network_mode        = "production"
  vpc_id              = var.vpc_id
  subnet_id           = var.subnet_id
  associate_public_ip = false

  ami_id         = var.ami_id
  use_golden_ami = true

  ebs_kms_key_id = var.ebs_kms_key_id

  artifact_s3_bucket_arns   = var.artifact_s3_bucket_arns
  artifact_s3_object_arns   = var.artifact_s3_object_arns
  artifact_s3_list_prefixes = var.artifact_s3_list_prefixes

  client_core_artifact_url     = var.client_core_artifact_url
  client_core_artifact_version = var.client_core_artifact_version
  client_core_artifact_sha256  = var.client_core_artifact_sha256
  # Prefer backend_artifact_*; hermes_artifact_* remain temporary aliases (locals resolve).
  backend_artifact_url     = var.backend_artifact_url
  backend_artifact_version = var.backend_artifact_version
  backend_artifact_sha256  = var.backend_artifact_sha256
  # Temporary accept-only aliases for existing tfvars:
  hermes_artifact_url      = var.hermes_artifact_url
  hermes_artifact_version  = var.hermes_artifact_version
  hermes_artifact_sha256   = var.hermes_artifact_sha256
  relay_contract_major     = var.relay_contract_major

  # Required for a working host bootstrap (tenant template sets this).
  # From deploy/templates/tenant, ../../scripts → deploy/scripts/bootstrap-host.sh:
  bootstrap_script_b64 = base64gzip(file("${path.module}/../../scripts/bootstrap-host.sh"))
}
```

Empty `bootstrap_script_b64` keeps standalone `terraform validate` working (user_data installs a fail-closed stub). Real deploys must inject `deploy/scripts/bootstrap-host.sh`; it is installed at **`/usr/local/sbin/company-brain-bootstrap`**.

Do **not** use floating `ref=main` git sources. Prefer in-repo relative paths (`../../modules/…` under `deploy/`), or pin a monorepo tag/commit with `//deploy/modules/…` if consuming from outside.

## Runtime hardening (unprivileged service)

After artifact bootstrap, operators apply host/runtime hardening (cbd-zzx.15):

| Control | Location |
|---------|----------|
| Service user `hermes` | `scripts/ensure-runtime-hardening.sh` (invoked by `setup.sh`) |
| systemd sandbox | `systemd/hermes-gateway.service` (`NoNewPrivileges`, `ProtectSystem=strict`, …) |
| Omnibox Mode A env | `systemd/hermes-gateway.service.d/omnibox.conf` + `/etc/company-brain/omnibox.env` (`enable_omnibox`, default **false**; ExecStart unchanged) |
| Secrets mode 0600 | ensure script + runbook |
| Tool allowlists | `scripts/tool-allowlists/{admin,contributor}.json` |
| SELinux (AL2023) | `references/runbooks/host-runtime-hardening.md` |
| Offline smoke | `bash scripts/smoke-host-runtime-hardening.sh` |

```bash
sudo bash scripts/ensure-runtime-hardening.sh
# or: ENSURE_RUNTIME_HARDENING=1 ./setup.sh
sudo systemctl enable --now hermes-gateway   # after model + .env ready
```

Heavy logic is **not** inlined into `bootstrap-host.sh` (user_data 16 KiB inject budget).

## Host observability (optional, default off)

| Variable | Effect |
|----------|--------|
| `enable_ssm_managed_instance_core` | Attach `AmazonSSMManagedInstanceCore` (Session Manager) |
| `enable_cloudwatch_agent_iam` | Attach `CloudWatchAgentServerPolicy` |
| `enable_host_log_shipping` | user_data installs CW agent; ships secure/messages/backend install logs + `/var/log/company-brain`; implies agent IAM |
| `host_log_group_name` | Default `/company-brain/<project_name>/host` |
| `status_alarm_actions` / `status_ok_actions` | Wire SNS from `modules/security-observability` |
| `enable_snapshot_age_alarm` | CloudWatch alarm on custom metric `CompanyBrain/Backup` / `NewestSnapshotAgeHours` |
| `snapshot_max_age_hours` | Threshold (default 36); pair with `scripts/check-snapshot-age.sh --publish-metric` |
| `snapshot_age_alarm_actions` | Prefer security-observability `alarm_actions` (same SNS) |
| `enable_snapshot_age_check_schedule` | Daily EventBridge → SNS reminder to run the check script |
| `enable_cross_region_copy` | Opt-in DLM cross-region snapshot copy (default **false**) |
| `destination_region` | Target region when cross-region copy is enabled (default null) |
| `enable_dr_account_share` | Opt-in DLM share to dedicated DR account (default **false**) |
| `dr_account_id` | 12-digit DR account when share is enabled (default null; private tfvars only) |
| `enable_omnibox` | Omnibox Mode A: OMNIBOX_* gateway env + bootstrap `ensure-omnibox` (default **false**; does **not** replace Hermes ExecStart) |

VPC Flow Logs, security SNS, and GuardDuty finding bridge live in **`modules/security-observability`** (not recreated here). Account-level CloudTrail/GuardDuty enablement: `references/security-observability.md`. Snapshot restore drills and RTO/RPO: `references/runbooks/dlm-restore-drill.md`.

## Optional Tailscale (secondary access, default off)

| Variable | Effect |
|----------|--------|
| `enable_tailscale` | Install enroll helper + optional auto-enroll; IAM for auth-key fetch |
| `tailscale_auth_secret_source` | `ssm` (default) or `secretsmanager` |
| `tailscale_auth_secret_ssm_parameter` | SSM SecureString **name** (not the key value) |
| `tailscale_auth_secret_secretsmanager_arn` | Secrets Manager ARN when source=secretsmanager |
| `tailscale_tags` | Empty → `tag:tenant=<project_name>`, `tag:role=company-brain` |
| `tailscale_auto_enroll` | user_data runs enroll (default true when enabled) |
| `tailscale_allow_direct_udp` | Controlled egress UDP/41641 (default false; DERP uses 443) |

Production tailnets: ACL default-deny, no cross-tenant, device approval **or** Tailnet Lock. See `references/runbooks/tailscale-operator-access.md`.

## Related modules (this repo)

| Module | When |
|--------|------|
| `modules/customer-gateway-relay/` | Wire Hermes to Lanyard Web Portal (outbound WSS) |
| `modules/tier3-dedicated-relay/` | Tier 3 dedicated relay (ALB/ECS hostname/WSS; infra_ready) |
| `modules/product-artifact-infra/` | S3 prefixes `hermes/`, `client-core/` for pins + IAM scope |
| `modules/security-observability/` | VPC Flow Logs, security SNS, GuardDuty findings bridge, snapshot-age SNS interface |
| `scripts/bootstrap-host.sh` | Canonical artifact bootstrap (source injected onto host) |
| `scripts/check-snapshot-age.sh` | Operator: newest snapshot age + optional CloudWatch metric |
| `scripts/restore-from-snapshot.sh` | Operator: volume/AMI restore from DLM snapshot (SSM-first) |
| `scripts/smoke-bootstrap-inject.sh` | Assert injection contract locally |
| `artifacts/README.md` | Pin contract |

## Validate

```bash
cd modules/company-brain-ec2
terraform init -backend=false
terraform validate
```

## Data boundary

Do **not** commit `terraform.tfvars`, `*.tfstate`, live CIDRs beyond examples, deploy keys, or customer vault content.
