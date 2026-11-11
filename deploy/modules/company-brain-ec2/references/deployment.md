# Company Brain EC2 — deployment runbook

Stand up a **generic** Hermes Company Brain host. Live `tfvars`, state, and secrets stay in private operator working trees under `deployments/<tenant_slug>/` (or an external private monorepo copy).

## Architecture (MVP)

```text
Operator laptop
    │ SSM Session Manager (preferred primary)
    │ optional Tailscale mesh (secondary; enable_tailscale)
    │ optional SSH break-glass (empty by default)
    ▼
EC2 (pinned golden AMI in production)  ── Hermes gateway + profiles + crons
    │ private subnet (production) / lab may use public IP
    │ controlled egress (prod: 443/DNS/NTP — not all-protocol open)
    │ optional VPC endpoints: S3 gateway, SSM, Logs/KMS/STS
    │ encrypted root EBS (+ optional data volume; optional CMK)
    │ DLM daily snapshots (Backup=daily; inherit volume CMK)
    │ instance role → SSM core + artifact registry (S3 prefix-scoped / HTTPS)
    │ optional Tailscale auth-key read (SSM/SM reference only)
    │ IMDSv2 hop limit 1
    ▼
/opt/hermes-lanyard  (Hermes runtime, installed first)
/opt/company-brain   (client-core seed + vault; only if no AGENTS.md)
    │ optional outbound WSS (TCP 443)
    ▼
Lanyard portal relay (modules/customer-gateway-relay)
```

## Prerequisites

| Item | Notes |
|------|--------|
| AWS account / credentials | Customer-owned or Lanyard-hosted track |
| **Operator access** | Prefer **SSM Session Manager** (`enable_ssm_access`); SSH optional |
| EC2 key pair | Only if temporary SSH break-glass; not required for SSM-only |
| Operator public IP | Only for break-glass `/32`; never `0.0.0.0/0`; production default is no SSH |
| Terraform | ≥ 1.7, AWS provider ~> 5.0 |
| Artifacts | client-core + Hermes tarballs with known SHA-256 (see `artifacts/README.md`) |
| Instance role | Module creates role + SSM core; set `artifact_s3_bucket_arns` when using `s3://` URLs |
| **Production network** | Explicit `vpc_id` + private `subnet_id`; `network_mode = "production"`; no public IP; controlled egress |
| **Production AMI** | Pinned `ami_id` (golden/hardened); prefer `use_golden_ami = true` |
| **EBS CMK (recommended prod)** | Customer-managed KMS key ARN; key policy for instance + DLM roles |

## Network placement

### Production (required posture)

```hcl
network_mode        = "production"
vpc_id              = "vpc-…"       # real ID from customer/Lanyard account
subnet_id           = "subnet-…"    # private subnet with egress (NAT/etc.)
associate_public_ip = false         # forced false in production even if set true
```

Production **fails validation/plan** if `vpc_id` or `subnet_id` is omitted, or if `associate_public_ip = true`. Default-VPC lookup is **disabled** in production.

### Lab (non-production only)

```hcl
network_mode        = "lab"
# vpc_id / subnet_id may be null → account default VPC
associate_public_ip = true   # convenience for bootstrap without NAT
```

Do **not** ship lab defaults to customer production.

## Operator access (SSM-first)

| Setting | Production recommendation |
|---------|---------------------------|
| `operator_ssh_cidrs` | `[]` (no port 22) |
| `ssh_key_name` | `null` |
| `enable_ssm_access` | `true` |
| `create_ssm_vpc_endpoints` | `true` when private subnet has no NAT path to SSM |
| Session logs | `enable_ssm_session_log_group = true` + configure `SSM-SessionManagerRunShell` preferences |

```bash
terraform output -raw ssm_start_session_command
# aws ssm start-session --target <instance-id> --region <region>
```

Temporary SSH break-glass is MFA-controlled and time-boxed — see `references/runbooks/ssm-break-glass.md`.

## Optional Tailscale (secondary mesh)

Default **off**. Production private path works without Tailscale. When enabled:

```hcl
enable_tailscale                    = true
tailscale_auth_secret_source        = "ssm"
tailscale_auth_secret_ssm_parameter = "/company-brain/<project>/tailscale-auth-key"
# Auth key value lives only in SSM/SM — never in tfvars/user_data.
```

- Tags default to `tag:tenant=<project_name>`, `tag:role=company-brain`.
- Enroll helper: `/usr/local/sbin/company-brain-tailscale-enroll`.
- ACL default-deny, no cross-tenant, device approval **or** Tailnet Lock required for production.
- SSM remains primary break-glass; public SSH stays closed.

Full procedure: `references/runbooks/tailscale-operator-access.md`. Egress UDP/41641 vs DERP 443: `references/runbooks/controlled-egress.md` § Tailscale.

## Controlled egress

| `network_mode` | Default egress |
|----------------|----------------|
| production | **controlled** — TCP/443, DNS 53, NTP 123 (+ extras); never `protocol=-1` to `0.0.0.0/0` |
| lab | **open** — all protocols (non-prod only) |

Prefer VPC endpoints for S3/SSM/Logs/KMS/STS. Domain-level allowlists use Network Firewall or a proxy (`references/runbooks/controlled-egress.md`). Approved destinations and data categories: `references/approved-data-processors.md`; per-client policy template: `references/templates/client-data-handling-policy.md`. Offline check: `bash scripts/smoke-controlled-egress.sh`.

## Golden AMI / supply chain

```hcl
ami_id         = "ami-…"      # required by default when network_mode=production
use_golden_ami = true         # skip broad dnf installs in user_data
```

Details: `references/runbooks/golden-ami-supply-chain.md`.

## Artifact S3 IAM scope

Product-artifact bucket layout:

```text
s3://<bucket>/hermes/<version>/…
s3://<bucket>/client-core/<version>/…
```

Recommended tfvars:

```hcl
artifact_s3_bucket_arns = ["arn:aws:s3:::example-artifacts"]
artifact_s3_object_arns = [
  "arn:aws:s3:::example-artifacts/hermes/*",
  "arn:aws:s3:::example-artifacts/client-core/*",
]
artifact_s3_list_prefixes = ["hermes/", "hermes/*", "client-core/", "client-core/*"]
```

If only bucket ARNs are set:

- **production** auto-scopes GetObject to `hermes/*` + `client-core/*` and conditions ListBucket on those prefixes.
- **lab** may grant `bucket/*` GetObject (documented non-prod only).

## EBS CMK and snapshot controls

```hcl
ebs_kms_key_id = "arn:aws:kms:REGION:ACCOUNT:key/…"  # strongly recommended for production
enable_ebs_snapshot_block_public_access = true
ebs_snapshot_block_public_access_state  = "block-all-sharing"
```

- Root and data volumes pass `kms_key_id` when set.
- DLM snapshots of encrypted volumes inherit the source volume’s CMK (same-region primary schedule does not take a separate `cmk_arn`).
- **Opt-in cross-region copy** (`enable_cross_region_copy`, default false) uses DLM `cross_region_copy_rule` with `encrypted=true` and optional `cross_region_copy_cmk_arn` in the destination region.
- **Opt-in DR account share** (`enable_dr_account_share`, default false) uses DLM `share_rule` with a single `dr_account_id` (dedicated DR — not another tenant).
- Module grants instance + DLM roles least-privilege KMS actions on source (and destination copy) CMKs when set.
- Key policy: allow those roles (and operators for restore); **never** `Principal = "*"`. Cross-account share of CMK-encrypted snapshots needs explicit DR grants (ops-owned).
- RPO/RTO and restore path: `references/runbooks/dlm-restore-drill.md`. Isolation policy: `references/tenant-isolation-decision.md` § Snapshot copy.

## IMDS

Instance metadata uses **IMDSv2** (`http_tokens = required`) with **`http_put_response_hop_limit = 1`**. Nested containers cannot reach IMDS through an extra hop, reducing SSRF/credential-theft risk. Role credentials exposed via IMDS are only those on the instance profile (artifact read + optional CMK).

## 1. Terraform apply

Prefer the tenant template:

```bash
cp -a templates/tenant deployments/<tenant_slug>
cd deployments/<tenant_slug>
cp terraform.tfvars.example terraform.tfvars
# Edit: region, project_name, network_mode/vpc/subnet, ami_id,
#       artifact pins, ebs_kms_key_id, relay_*; SSH only if break-glass
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Record outputs: `instance_id`, `private_ip`, `ssm_start_session_command` / `access_command` (SSH only if break-glass configured).

### Optional data volume

Set `data_volume_size_gb` (e.g. `100`) so vault/beads live off the root volume. After first boot:

```bash
# Device may appear as /dev/xvdf or /dev/nvme1n1 on AL2023
sudo mkfs.xfs /dev/nvme1n1   # only once, empty volume
sudo mkdir -p /data
# Add fstab by UUID, mount, chown ec2-user
# Then: export VAULT_ROOT=/data/vault && mkdir -p "$VAULT_ROOT"
```

## 2. First session and artifact bootstrap

user_data installs the monorepo `scripts/bootstrap-host.sh` (base64gzip via `bootstrap_script_b64`) as root-owned **`/usr/local/sbin/company-brain-bootstrap`**, and writes pins to `/etc/company-brain/artifact-pins.env`.

```bash
# Prefer SSM (not public SSH):
terraform output -raw ssm_start_session_command
# Pins load automatically from /etc/company-brain/artifact-pins.env
sudo /usr/local/sbin/company-brain-bootstrap
# or: terraform output -raw bootstrap_command
```

There is **no git clone** step and **no monorepo checkout required on the host**. Bootstrap fails clearly if any pin is `UNCONFIGURED` or empty, or if `bootstrap_script_b64` was left empty (fail-closed stub).

## 3. Post-seed helpers (optional)

```bash
VAULT_ROOT=/opt/company-brain HERMES_INSTALL_PATH=/opt/hermes-lanyard \
  ./modules/company-brain-ec2/setup.sh
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `VAULT_ROOT` | `/opt/company-brain` | Where vault + seed live |
| `HERMES_INSTALL_PATH` | `/opt/hermes-lanyard` | Hermes runtime |
| `RUNTIME_USER` | `hermes` | Unprivileged service account |
| `ENSURE_RUNTIME_HARDENING` | `1` | Create user, systemd unit, tool allowlists, secrets 0600 |
| `INSTALL_FOCR` | `0` | Set `1` on OCR workers (≥ 8 GB RAM) |
| `INIT_CRM` | `1` | Create empty CRM DB if seed script present |
| `INIT_EVALS` | `1` | Create `evals.db` if seed script present |
| `SYNC_SELF_IMPROVE` | `1` | Sync skill into Hermes if seed script present |

### Runtime hardening (required for production posture)

```bash
# From company-brain-deploy checkout (or copy scripts/ + systemd/ onto host):
sudo bash scripts/ensure-runtime-hardening.sh
# Offline check:
bash scripts/ensure-runtime-hardening.sh --dry-run
bash scripts/smoke-host-runtime-hardening.sh
```

Creates user **`hermes`**, owns `/opt/hermes-lanyard`, seeds tool allowlists, installs sandboxed `hermes-gateway.service`. Full detail: `references/runbooks/host-runtime-hardening.md`.

## 4. Operator configuration (manual)

1. `hermes doctor`
2. `hermes model` / xAI OAuth (port-forward if headless)
3. Secrets (mode **0600**): prefer `/home/hermes/.hermes/.env` (service user); legacy `~/.hermes/.env` also tightened by ensure script
4. Tailscale join; drop-in sets `accept-dns=false`
5. Profiles **admin** and **contributor** under service home — `references/hermes-profile-rbac.md`
6. Portal: control-plane provision → `modules/customer-gateway-relay` → `systemctl enable --now hermes-gateway`
7. Beads (optional): `bd init --stealth` under vault (git-free posture)

## 5. Recovery from snapshot

Prefer automation + SSM (see `references/runbooks/dlm-restore-drill.md`):

```bash
bash scripts/check-snapshot-age.sh --project <project_name> --publish-metric
bash scripts/restore-from-snapshot.sh --project <project_name> --pick-newest --mode volume --az <az>
# --execute when ready; then: aws ssm start-session --target i-RECOVERY
```

Manual outline:

1. Create AMI or volume from DLM snapshot (`scripts/restore-from-snapshot.sh` or console).
2. Set `ami_id` (or attach restored data volume) in recovery tfvars — usually a **new** instance.
3. `terraform apply` (module ignores AMI/user_data drift on **existing** instances via lifecycle).
4. Confirm vault paths and `hermes doctor`. Re-run bootstrap only if `AGENTS.md` is missing (seed gate).
5. If using a CMK, ensure the restore account/role can use the same key.
6. Default RPO/RTO examples: **24h / 4h**; quarterly drill required for production tenants.

## 6. What not to put in git

- `terraform.tfvars`, state, plans
- Real SSH CIDRs beyond documentation examples
- Customer vault markdown, CRM rows, embeddings
- Relay secrets, API keys, deploy private keys
- Real artifact registry credentials
- Real VPC/subnet/KMS ARNs in committed examples (use placeholders)

## Sizing guidance

| Workload | Starting point |
|----------|----------------|
| Single-operator Hermes | `t3.medium`, 40 GiB root |
| Multi-user gateway | `t3.large`+, consider data volume |
| Local franken_ocr on same host | ≥ 8 GB RAM, 4+ vCPU; often separate OCR worker |

## Host observability (optional)

Default **off** so concurrent SSM/egress work stays additive. Production tenants should enable:

```hcl
enable_ssm_managed_instance_core = true
enable_host_log_shipping         = true
# CloudWatchAgentServerPolicy is attached automatically when log shipping is on
status_alarm_actions             = module.security_observability[0].alarm_actions
```

Pair with `modules/security-observability` for VPC Flow Logs + security SNS. Account CloudTrail/GuardDuty: `references/security-observability.md`. Alert response: `references/runbooks/security-alert-triage.md`.

Snapshot-age (optional):

```hcl
enable_snapshot_age_alarm          = true
snapshot_age_alarm_actions         = module.security_observability[0].alarm_actions
enable_snapshot_age_check_schedule = true
```

Publish metric daily: `scripts/check-snapshot-age.sh --project <project_name> --publish-metric`.

`setup.sh` re-starts the CloudWatch agent if its config exists under `/opt/aws/amazon-cloudwatch-agent/etc/` (set `ENSURE_CW_AGENT=0` to skip).

## Validate module

```bash
cd modules/company-brain-ec2
terraform init -backend=false
terraform validate
```
