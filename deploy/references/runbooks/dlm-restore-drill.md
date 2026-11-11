# Runbook: DLM restore drill and backup resilience

**Status:** Operational procedure — practice in a non-production account before customer drills. Do not invent live AWS resource IDs in this repo.

**Scope:** Recover Company Brain vault/runtime disk state from **Data Lifecycle Manager** daily EBS snapshots created by `modules/company-brain-ec2`. Covers snapshot-age monitoring, restore automation, quarterly drills, and RTO/RPO targets.

**Related**

| Asset | Path |
|-------|------|
| Snapshot-age check (AWS CLI) | `scripts/check-snapshot-age.sh` |
| Restore automation | `scripts/restore-from-snapshot.sh` |
| Module alarms | `modules/company-brain-ec2` (`enable_snapshot_age_alarm`) |
| SNS / tag interface | `modules/security-observability` → `snapshot_age_monitor_interface` |
| SSM access | `references/runbooks/ssm-break-glass.md` |
| Cross-account/region copy | `references/tenant-isolation-decision.md` § Snapshot copy |
| Alert triage | `references/runbooks/security-alert-triage.md` § Snapshot age |

---

## What DLM protects

- Volumes tagged `Backup=daily` and `Project=<project_name>` (root and optional data volume).
- Default policy: daily snapshot at 07:00 UTC, retention from `snapshot_retention_count` (module default **14**).
- Encrypted volumes: snapshots **inherit** the source volume CMK (same-region primary schedule).

---

## RTO / RPO targets (default examples)

These are **operator defaults** for Lanyard-hosted and customer-account brains unless a customer contract states otherwise. Record actuals in the private drill report.

| Metric | Default target | Basis |
|--------|----------------|--------|
| **RPO** | **24 hours** | Daily DLM interval; max data loss ≈ one day if restore uses newest snapshot |
| **RTO** | **4 hours** | Identify snapshot → restore volume/AMI → recovery host via SSM → verify vault + Hermes smoke |
| Snapshot-age alarm | **36 hours** | Daily schedule + buffer (`snapshot_max_age_hours` default) |
| Drill cadence | **Quarterly** | Per production tenant (or shared lab template quarterly + production annually minimum) |

**Notes**

- RPO is **not** zero; continuous replication is out of scope for this module.
- Cross-region / DR-account copy is **opt-in** (`enable_cross_region_copy` / `enable_dr_account_share`, both default **false**) — enabling them does **not** automatically tighten contractual RPO/RTO until a successful drill proves it.
- If the newest snapshot is older than the RPO target, treat as a **durability incident** before a planned drill.

### RPO/RTO implications of opt-in DR copy (cbd-mta.7.4)

| Posture | RPO implication | RTO implication | When to enable |
|---------|-----------------|-----------------|----------------|
| **Default** — same account, same region DLM only | **24 h** from daily create rule | **~4 h** same-region volume/AMI restore (this runbook) | Always for production tenants |
| **`enable_cross_region_copy=true`** + `destination_region` | Still **~24 h** primary RPO; DR-region copy lag is typically **minutes after** the daily snapshot (not continuous). Regional disaster RPO remains daily unless a separate more-frequent policy is contracted | Regional failover RTO includes: switch region context → locate copied snapshot → restore in DR region/AZs → re-pin network/artifacts/SSM. Expect **≥ same-region 4 h** unless a standing DR host and quarterly regional drill prove lower | Documented regional DR need; CMK plan for destination |
| **`enable_dr_account_share=true`** + `dr_account_id` | Share does **not** create a second snapshot clock; RPO still tracks primary daily create. DR account must **CopySnapshot** (and re-encrypt if required) before restore — add ops latency | RTO adds assume-role / account switch + copy completion + restore in DR account. Do **not** claim sub-4 h multi-account RTO without a measured drill | Dedicated DR account only (never another tenant); change-controlled |

**Contract honesty**

- Default module + runbook targets remain **RPO 24 h / RTO 4 h** until a customer SOW and **successful quarterly drill** in the DR region/account record different numbers in the **private** drill report.
- Snapshot-age alarms (`enable_snapshot_age_alarm`, `scripts/check-snapshot-age.sh`) measure **primary-region** snapshots. DR copies need a **separate** scheduled check in the destination region/account if DR is contractual.
- Cross-region rule always sets `encrypted = true`. Destination CMK: set `cross_region_copy_cmk_arn` or accept the destination default EBS key; source/destination key policies must allow the DLM role (and DR principals for share+copy).
- Public snapshot share stays blocked (`enable_ebs_snapshot_block_public_access` / `block-all-sharing`). DLM `share_rule` is **private account share**, not public.

---

## Snapshot-age / missing backup alarms

### Terraform (installable)

On `modules/company-brain-ec2` (tenant root wires SNS from security-observability):

```hcl
enable_snapshot_age_alarm            = true
snapshot_max_age_hours               = 36
snapshot_age_alarm_actions           = try(module.security_observability[0].alarm_actions, [])
snapshot_age_ok_actions              = try(module.security_observability[0].alarm_actions, [])
enable_snapshot_age_check_schedule   = true  # daily SNS reminder to run the check script
```

Creates:

1. CloudWatch alarm `${project_name}-snapshot-age` on custom metric  
   `CompanyBrain/Backup` / `NewestSnapshotAgeHours` / dimension `Project=<project_name>`  
   (`treat_missing_data = breaching` so a dead checker also pages after two daily periods).
2. Optional EventBridge rule `${project_name}-snapshot-age-check` → security SNS (reminder payload; not a full Lambda runtime).

### Operator metric publisher

Schedule **at least daily** (EventBridge→Lambda, SSM State Manager, or ops cron):

```bash
bash scripts/check-snapshot-age.sh \
  --project <project_name> \
  --region <region> \
  --max-age-hours 36 \
  --publish-metric
```

Optional immediate SNS on failure (in addition to the CloudWatch alarm):

```bash
bash scripts/check-snapshot-age.sh \
  --project <project_name> \
  --publish-metric \
  --sns-topic-arn "$SECURITY_SNS_TOPIC_ARN"
```

Contract output:

```bash
terraform output -json snapshot_age_monitor_interface
terraform output -json snapshot_age_alarm_summary   # when using company-brain-ec2 outputs
```

Do **not** create a second SNS topic for backup age — reuse the tenant security topic.

---

## Drill goals

1. Prove a recent snapshot exists and is restorable (age ≤ RPO / alarm threshold).
2. Restore to a **new** volume / AMI path without mutating the live tenant host until cutover is approved.
3. Access the recovery host via **SSM Session Manager** (SSH break-glass only if SSM fails).
4. Mount/verify vault integrity; confirm Hermes can start (or document gaps).
5. Verify artifact pins (`/etc/company-brain/artifact-pins.env`) match expected URL/version/SHA-256.
6. Record **measured** RTO (and snapshot age as effective RPO sample) in private ops store.

---

## Pre-checks

```text
[ ] DLM policy enabled for the tenant project_name (enable_dlm=true)
[ ] Snapshot list for target volume(s) in the last N days (≤ RPO)
[ ] Snapshot-age alarm enabled or check script scheduled
[ ] SSM access working for an operator role (preferred); SSH only break-glass + non-0.0.0.0/0 CIDR
[ ] Recovery instance will use artifact pins (not git clone of vault/client-core)
[ ] CMK grants allow restore role if ebs_kms_key_id is customer-managed
[ ] Change window + customer notification template ready
[ ] Private drill report location ready (not this git repo)
```

List snapshots:

```bash
bash scripts/check-snapshot-age.sh --project <project_name> --region <region> --json
# or:
aws ec2 describe-snapshots --owner-ids self \
  --filters Name=tag:Project,Values=<project_name> Name=tag:Backup,Values=daily
```

---

## Procedure (automation-assisted)

### A. Identify snapshot

```bash
# Dry-run restore plan with newest daily snapshot
bash scripts/restore-from-snapshot.sh \
  --project <project_name> \
  --pick-newest \
  --mode volume \
  --az <recovery-az> \
  --region <region>
```

Or pass an explicit `--snapshot-id snap-…` (keep IDs in operator notes, not git).

### B. Restore disk state

**Volume path** (attach to a healthy recovery host in the same AZ):

```bash
bash scripts/restore-from-snapshot.sh \
  --project <project_name> \
  --snapshot-id snap-REPLACE \
  --mode volume \
  --az <az> \
  --instance-id i-RECOVERY \
  --region <region> \
  --execute
```

**AMI path** (root-disk style; then set `ami_id` on a recovery workspace or launch break-glass):

```bash
bash scripts/restore-from-snapshot.sh \
  --project <project_name> \
  --snapshot-id snap-REPLACE \
  --mode ami \
  --region <region> \
  --execute
```

Prefer pinning `ami_id` when restoring root disk state via AMI. Module lifecycle may ignore AMI drift on an **existing** instance — recovery is usually a **new** instance.

### C. Access recovery host (SSM-first)

```bash
aws ssm start-session --target i-RECOVERY --region <region>
# terraform output -raw ssm_start_session_command  # for the live tenant host
```

SSH break-glass only per `ssm-break-glass.md` (MFA-controlled, never `0.0.0.0/0`).

### D. Verify filesystem, vault, pins

On host:

```text
[ ] Filesystem clean (fsck only if required and offline)
[ ] Vault path present (/opt/company-brain or data mount)
[ ] Beads/DB files as expected for the tenant
[ ] /opt/company-brain/.seed/provenance.env if previously bootstrapped
[ ] sudo cat /etc/company-brain/artifact-pins.env — URL/version/SHA-256 match pins
[ ] Do **not** re-run client-core extract if AGENTS.md exists unless intentionally reseeding
[ ] If AGENTS.md missing: sudo /usr/local/sbin/company-brain-bootstrap
[ ] Smoke Hermes + portal relay only if this is full host recovery
```

### E. Tear down or promote

- Tear down recovery resources **or** document promotion to primary under change control.
- Never delete the last known-good snapshot during a drill.
- Keep original volumes until drill/cutover succeeds; detach restored volume and re-attach previous on rollback.

### F. Drill report (private ops store)

| Field | Example |
|-------|---------|
| tenant_slug / project_name | acme / acme-brain |
| start_utc / end_utc | … |
| snapshot_id + start_time | snap-… / age hours |
| mode | volume \| ami |
| access method | SSM \| SSH break-glass |
| **measured RTO** | e.g. 1.5 h (target 4 h) |
| **effective RPO sample** | snapshot age hours (target ≤ 24 h) |
| issues / runbook gaps | … |
| teardown complete | yes/no |

---

## Quarterly drill schedule

| Cadence | Who | Environment |
|---------|-----|-------------|
| **Quarterly** | On-call / deploy owner | Non-prod account **or** production tenant with change window |
| After major module/DLM changes | Same | Lab first |
| After real incident restore | Same | Capture lessons into runbook (no secrets/IDs in git) |

Checklist for “quarterly done”:

```text
[ ] check-snapshot-age.sh exit 0 (or alarm OK) within last 7 days
[ ] restore-from-snapshot.sh dry-run reviewed
[ ] At least one --execute restore to recovery resources this quarter
[ ] SSM path exercised
[ ] Pins verified
[ ] RTO/RPO measured and stored privately
[ ] Recovery resources destroyed or documented
```

---

## Rollback of a bad restore

- Keep original volumes until drill/cutover succeeds.
- Detach restored volume; re-attach previous.
- Never delete the last known-good snapshot during a drill.
- If AMI-based recovery is wrong, stop the recovery instance; do not replace production `ami_id` until verified.

---

## Cross-account / cross-region copy

Default posture: **same-account, same-region** DLM only (fail-closed). Optional Terraform flags on `modules/company-brain-ec2` (cbd-mta.7.4):

```hcl
# Both default false / null — production still encrypts primary snapshots either way.
enable_cross_region_copy         = false
# destination_region             = "us-west-2"   # required when enable_cross_region_copy=true
# cross_region_copy_cmk_arn      = null          # optional destination CMK ARN
enable_dr_account_share          = false
# dr_account_id                  = "000000000000"  # dedicated DR only; private tfvars — never git live IDs
```

When enabled:

1. **Cross-region:** DLM `cross_region_copy_rule` copies each daily snapshot to `destination_region` with `encrypted=true` and copy tags (preserves `Project` / `Backup`).
2. **DR account share:** DLM `share_rule` grants `dr_account_id` private create-volume permission on new snapshots. DR operators copy into the DR account before restore; grant CMK use to DR roles first.
3. Confirm with: `terraform output -json snapshot_dr_copy_summary` (does not echo the DR account id).

Isolation decision (when allowed / forbidden):

**`references/tenant-isolation-decision.md` → Snapshot copy (cross-region / cross-account)**

Summary:

- Do not share snapshots across `lanyard_hosted` tenants.
- Cross-account share only to a **dedicated DR account** (or customer-approved path on Track B) — never tenant-to-tenant.
- Cross-region copy is opt-in for regional DR; requires CMK/key policy planning.
- Public snapshot sharing remains blocked (`enable_ebs_snapshot_block_public_access`).

### DR restore sketch (when flags are on)

```text
[ ] Primary: check-snapshot-age.sh in primary region (exit 0)
[ ] Cross-region: describe-snapshots in destination_region with Project tag; age ≤ RPO + copy lag
[ ] DR account: confirm shared snapshot visible; CopySnapshot to DR account (encrypted)
[ ] restore-from-snapshot.sh in the recovery region/account (dry-run then --execute)
[ ] SSM to recovery host; vault + pins smoke
[ ] Record measured multi-region/account RTO privately — do not claim default 4 h without that number
```

---

## Unfinished / next phases

- EventBridge → Lambda (or SSM Automation) that **runs** `check-snapshot-age.sh` without human cron
- Codified recovery Terraform workspace (optional second instance module)
- Automated DR-region snapshot-age metric publisher (when cross-region copy is contractual)
