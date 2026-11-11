# Runbook: security alert triage (Company Brain host)

**Audience:** On-call / deploy operators for Lanyard-hosted or customer-account brains  
**Related:** `references/security-observability.md`, `modules/security-observability/`, `modules/company-brain-ec2/`

Use this when SNS (or chat bridge) fires for a tenant security topic, status-check alarm, or GuardDuty finding.

---

## 0. Classify the signal

| Signal | Typical source | Severity default |
|--------|----------------|------------------|
| `*-hermes-status-check` ALARM | CloudWatch EC2 StatusCheckFailed | **High** (host health) |
| GuardDuty finding email/SNS | EventBridge → security SNS | Use finding severity (HIGH/CRITICAL = **page**) |
| Snapshot age / DLM gap | `${project}-snapshot-age` alarm or check script / EventBridge reminder on security SNS | **High** (durability) |
| CloudTrail metric filter (unauthorized / SG) | Account trail filters | **High** until proven benign |
| Host log anomaly (manual Insights) | `/company-brain/<slug>/host` streams (`secure`, `messages`, `backend`, `company-brain`) | Context-dependent |

Record: tenant_slug, project_name, AWS account (from private inventory — not git), region, instance id, time UTC.

---

## 1. EC2 status-check alarm

1. Confirm alarm and instance:
   ```bash
   aws cloudwatch describe-alarms --alarm-names "<project>-hermes-status-check"
   aws ec2 describe-instance-status --instance-ids i-REPLACE
   ```
2. **System status check failure** → AWS infrastructure; stop/start or wait for recovery; check AWS Health.
3. **Instance status check failure** → OS hang/kernel; attempt SSM Session Manager first:
   ```bash
   aws ssm start-session --target i-REPLACE
   ```
   If SSM fails, break-glass SSH (operator CIDR / Tailscale) per deploy runbook.
4. Collect: `dmesg`, `journalctl -b -p err`, disk full (`df -h`), OOM.
5. Durability: confirm volumes encrypted + recent DLM snapshot (`Backup=daily`, `Project=<project_name>`). See `dlm-restore-drill.md` if restore needed.
6. Clear: alarm returns OK; note root cause in tenant ops log (not customer vault unless customer-owned).

---

## 2. GuardDuty finding

1. Open GuardDuty console (or CLI) in the **account/region** of the finding — detector is account-level.
   ```bash
   aws guardduty list-detectors
   aws guardduty get-findings --detector-id d-REPLACE --finding-ids "..."
   ```
2. Map finding type:
   | Family | Examples | First actions |
   |--------|----------|---------------|
   | UnauthorizedAccess / Backdoor | SSH brute, unusual API | Isolate SG if needed; rotate instance role credentials (stop instance / revoke sessions); inspect auth logs |
   | Recon / Discovery | Port probe | Confirm Flow Logs; usually monitor unless successful auth |
   | CryptoCurrency / Trojan | Malware | Snapshot volume for forensics; rebuild from known-good AMI + restore vault from DLM |
   | Stealth / Policy | IAM anomaly | Review CloudTrail for the principal |
3. Host logs (backend-neutral streams; see `references/security-observability.md`):
   ```bash
   # Log group from tenant output host_log_group_name
   aws logs filter-log-events --log-group-name "/company-brain/<slug>/host" --start-time ...
   # Streams: {instance_id}/secure|messages|backend|company-brain
   # (status alarm resource names may still use *-hermes-status-check until renamed)
   ```
4. Flow Logs: group `/company-brain/<slug>/vpc-flow-logs` (or S3 destination). Look for unexpected accept/reject on 22, high volume C2-like egress.
5. Relay secret: if compromise suspected, rotate per `relay-secret-lifecycle.md` and revoke old secret at control plane when G2 exists.
6. Do **not** paste findings with account IDs into public tickets or customer vaults without redaction policy.

---

## 3. Unauthorized API / security group change

1. CloudTrail event history (account): filter by `eventName` (`AuthorizeSecurityGroupIngress`, `DeleteSecurityGroup`, …) and `username` / `principalId`.
2. Expected? Terraform apply from known operator role → document and close.
3. Unexpected?
   - Revert SG with Terraform (`terraform apply` from known-good) or console break-glass.
   - Disable access keys / sessions for the principal.
   - Confirm module still rejects `operator_ssh_cidrs = ["0.0.0.0/0"]`.
4. Optional Config compliance: check rule results if account Config is enabled.

---

## 4. Snapshot age / missing backup

When `enable_snapshot_age_alarm` (or the daily EventBridge reminder / check script) fires on the security SNS:

1. Confirm metric and snapshots:
   ```bash
   bash scripts/check-snapshot-age.sh --project <project_name> --region <region> --json
   # or:
   aws ec2 describe-snapshots --owner-ids self \
     --filters Name=tag:Project,Values=<project_name> Name=tag:Backup,Values=daily
   aws cloudwatch describe-alarms --alarm-names "<project>-snapshot-age"
   ```
2. Check DLM policy state (`aws dlm get-lifecycle-policies` / console) — policy disabled, role/CMK failure, or tag drift (`Project` / `Backup=daily`).
3. If gap > RPO intent (default 24h) or alarm threshold (default 36h): treat as **durability incident**; prepare restore (`dlm-restore-drill.md`, `scripts/restore-from-snapshot.sh`).
4. Re-publish metric after fix: `bash scripts/check-snapshot-age.sh --project <project_name> --publish-metric`.
5. Use `terraform output -json snapshot_age_monitor_interface` for tag/SNS contract — do **not** create a second SNS topic ad hoc.

---

## 5. Communication

| Audience | When |
|----------|------|
| Internal ops | All HIGH/CRITICAL; include tenant_slug and impact on portal chat |
| Customer (customer_account track) | Per customer contract; no raw GuardDuty dumps |
| Lanyard product | Portal G1/G2 issues only if relay/control-plane involved |

---

## 6. Close-out

- [ ] Alarm OK or finding archived with reason
- [ ] Root cause + corrective action noted
- [ ] Secrets rotated if exposure possible
- [ ] Terraform drift resolved (SG, IAM)
- [ ] If detector/trail was missing: complete account checklist in `security-observability.md`

---

## Quick links

| Doc | Path |
|-----|------|
| Observability contract | `references/security-observability.md` |
| Provision | `references/provision-runbook.md` |
| Relay secret | `references/runbooks/relay-secret-lifecycle.md` |
| DLM restore | `references/runbooks/dlm-restore-drill.md` |
| Isolation | `references/tenant-isolation-decision.md` |
