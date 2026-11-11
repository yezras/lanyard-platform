# Runbook: copy vault EC2 host disk → S3 for pilot tenant (`lp-3ux`)

**Status:** Operator runbook + offline-capable tool (secret-free).  
**Primary bead:** `lp-3ux`  
**Parent epic:** Phase 7 dual-run migration `lp-0pr`  
**Depends on:** `lp-gu2` (dual-run `runtime_kind`), `lp-d26` (pilot lab S3 vault bucket)  
**Blocks:** cutover checklist `lp-6h8`  
**Related:** [dual-run-runtime-kind.md](./dual-run-runtime-kind.md), [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md), [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md), [provision-runbook-daytona.md](./provision-runbook-daytona.md), rollback leaf `lp-ky7`

## Goals

One-writer migration of a pilot tenant’s **company-brain vault** from the EC2 host path (`VAULT_ROOT`, typically `/opt/company-brain`) into the durable **S3 vault prefix** used by `runtime_kind=daytona` Mountpoint:

```text
s3://{lanyard_vault_bucket}/tenants/{tenant_id}/vault/
```

Acceptance for this bead:

| Criterion | How met |
|-----------|---------|
| Runbook tested on lab data **or** dry-run + fixtures | Offline smoke with local fixtures (below); live lab residual filed |
| Checksum **or** file count verification | Both: file count + sorted relative-path **sha256** manifests |
| Rollback note | [Rollback](#rollback) — leave EC2 vault intact; do not flip `runtime_kind` until cutover (`lp-6h8`) |

**Tool:** [`deploy/scripts/copy-vault-ec2-to-s3.sh`](../../../deploy/scripts/copy-vault-ec2-to-s3.sh)  
**Offline smoke:** [`deploy/scripts/smoke-copy-vault-ec2-to-s3.sh`](../../../deploy/scripts/smoke-copy-vault-ec2-to-s3.sh)

## Non-goals

| Out of scope | Owner |
|--------------|--------|
| Flip `runtime_kind` to `daytona` | `lp-6h8` cutover checklist |
| Rollback flip back to EC2 + stop sandbox | `lp-ky7` |
| Decommission EC2 | `lp-u00` |
| Destroy / recreate pilot bucket | Forbidden (`lp-d26`) |
| Live AWS apply while OPERATOR HOLD | Hold doc; this runbook is offline-first |
| Copy secrets / SM material / Relay keys | Never part of vault tree copy |

## Preconditions

| Check | Notes |
|-------|--------|
| Dual-run field understood | Per-instance `runtime_kind` (`ec2` \| `daytona`) — [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) |
| Pilot prefix assigned | CP `s3_vault_prefix` = `tenants/{tenant_id}/vault/` (trailing slash) |
| Pilot bucket exists | Lab: `lanyard-mocklab-vault-123456789012` — [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) |
| Source vault path known | EC2 `VAULT_ROOT` / `COMPANY_BRAIN_VAULT_ROOT` (not `BACKEND_HOME`) |
| Operator profile (live only) | `AWS_PROFILE=lanyard-main`, region `us-east-1`, account `123456789012` |
| Freeze window planned | **One writer:** stop agent writes / freeze vault mutations on EC2 for the copy window |
| Staging hold | If OPERATOR HOLD is active, do **not** re-enable staging fixed network/compute to run this |

### Canonical lab coordinates (no secrets)

```text
Bucket:  lanyard-mocklab-vault-123456789012
Prefix:  tenants/mocklab/vault/
URI:     s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/
Source:  /opt/company-brain   # example EC2 VAULT_ROOT
```

## Freeze (one-writer) policy

During live copy the EC2 host must not accept vault-mutating agent traffic for that tenant:

1. Prefer: put gateway in a maintenance / drain state (no inbound chat that writes vault).  
2. Or: stop the gateway unit briefly if product policy allows a short outage.  
3. Do **not** flip `runtime_kind` yet — keep serving from EC2 until cutover (`lp-6h8`) after verify.  
4. Record freeze start/end UTC in the operator log.

If writes continue during sync, file count or sha256 verification **must** fail (or silently miss new files). Treat verify failure as abort — re-freeze and re-run.

## Tool usage

Default mode is **`--dry-run`** (plan + inventory only; no writes; no AWS calls for S3 dest).

```bash
# From monorepo root
SCRIPT=deploy/scripts/copy-vault-ec2-to-s3.sh
```

### Offline / fixture path (no AWS)

```bash
# Dry-run (always first)
bash "$SCRIPT" \
  --source /path/to/ec2-or-fixture-vault \
  --dest-local /tmp/vault-s3-mirror \
  --manifest-dir /tmp/vault-copy-manifests \
  --dry-run

# Execute + verify (file count + sha256)
bash "$SCRIPT" \
  --source /path/to/ec2-or-fixture-vault \
  --dest-local /tmp/vault-s3-mirror \
  --manifest-dir /tmp/vault-copy-manifests \
  --execute --verify

# Re-check without re-copy
bash "$SCRIPT" \
  --source /path/to/ec2-or-fixture-vault \
  --dest-local /tmp/vault-s3-mirror \
  --manifest-dir /tmp/vault-copy-manifests \
  --verify-only
```

### Live pilot path (lab account only; residual until executed)

```bash
export AWS_PROFILE=lanyard-main
export AWS_REGION=us-east-1

# 1) Freeze EC2 vault writes (operator step — see above)

# 2) Dry-run from the host path (or a host-side tarball extracted locally)
bash "$SCRIPT" \
  --source /opt/company-brain \
  --s3-uri s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/ \
  --manifest-dir /tmp/vault-copy-manifests \
  --dry-run

# 3) Execute + verify (sync + re-download checksum compare)
bash "$SCRIPT" \
  --source /opt/company-brain \
  --s3-uri s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/ \
  --manifest-dir /tmp/vault-copy-manifests \
  --execute --verify

# 4) Unfreeze only after PASS; keep runtime_kind=ec2 until lp-6h8 cutover
```

**Guards built into the script:**

- Refuses employee-vault-like source/dest paths (`*/Lanyard`, `employee-vault`, markers).  
- Requires S3 prefix shape `tenants/{tenant_id}/vault/`.  
- Refuses unexpected bucket names (must be `lanyard-mocklab-vault-*` or `lanyard-vault-*`).  
- Does **not** `aws s3 rm` the destination prefix; sync is additive (no `--delete`).  
- Never prints secret material.

### Verification details

| Check | Mechanism |
|-------|-----------|
| File count | Count of regular files under source vs dest (empty dirs ignored) |
| Checksums | Manifest lines: `<sha256>  <relative/path>` sorted by path; `cmp` equality |
| S3 verify | After sync, re-download prefix to a temp tree and hash (content, not ETag-only) |
| Report | `$MANIFEST_DIR/verify-report.txt` with `result=PASS` / `FAIL` |

Exit non-zero on count or checksum mismatch. Keep source and dest manifests for the operator ticket.

## End-to-end operator checklist

```text
[1] Confirm tenant_id, s3_vault_prefix, EC2 VAULT_ROOT, bucket
        ↓
[2] Freeze EC2 vault writes (one-writer window)
        ↓
[3] Dry-run inventory (file count + preview)
        ↓
[4] --execute --verify (local mirror or S3)
        ↓ verify-report result=PASS
[5] Optional --verify-only soak re-check
        ↓
[6] Unfreeze EC2; leave runtime_kind=ec2 until cutover
        ↓
[7] Hand off to lp-6h8 (flip daytona) — do not decommission EC2 yet
```

## Rollback

Vault copy is **additive and non-destructive** to the EC2 source:

| Situation | Action |
|-----------|--------|
| Verify **FAIL** before cutover | Abort. Keep `runtime_kind=ec2`. EC2 vault remains source of truth. Fix freeze/path issues and re-run copy. |
| Bad objects under S3 prefix | Do **not** destroy the bucket. Optionally delete only the bad keys under the tenant prefix (operator judgment), or leave them and re-sync after fix. Never `aws s3 rb`. |
| Cutover already flipped (`runtime_kind=daytona`) and vault wrong | Follow **`lp-ky7`**: flip instance back to `runtime_kind=ec2`, stop ephemeral sandbox if any, keep EC2 vault as SoT. Re-copy after root-cause. |
| Partial sync | Safe to re-run `--execute --verify`; rsync/s3 sync is idempotent for unchanged files. |

**Do not** delete the EC2 vault tree as part of this bead. Decommission is `lp-u00` after successful cutover soak.

## Offline dry-run evidence (fixtures)

No live AWS / no lab EC2 required for this bead’s offline path.

```bash
bash deploy/scripts/smoke-copy-vault-ec2-to-s3.sh
```

Expected:

| Check | Pass criteria |
|-------|----------------|
| Syntax | `bash -n` on copy script |
| Runbook coverage | freeze, checksum, file count, rollback, residual, dry-run |
| Dry-run | Plans N files; writes no dest objects; emits `dry-run-summary.txt` |
| S3 dry-run | States live AWS not invoked |
| Execute + verify | File count match + sha256 match; `result=PASS` |
| Mismatch | `--verify-only` fails on tampered dest |
| AWS | Not invoked (`aws_invoked=0`) |

**Residual for live lab** (not blocking offline close of tooling):

- [ ] Operator freeze window on real pilot EC2 host  
- [ ] `--execute --verify` against `s3://lanyard-mocklab-vault-…/tenants/{pilot}/vault/` with `AWS_PROFILE=lanyard-main`  
- [ ] Attach verify-report + file counts to the cutover ticket (`lp-6h8` / [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md))  

Track residual under Phase 7 / cutover ops when lab access is available. Do not bypass OPERATOR HOLD to force staging re-enable.

## Safety

- No secrets in argv, logs, or manifests (hashes + relative paths only).  
- Do not copy `BACKEND_HOME` secrets (`.env.secrets`, `auth.json`, `oauth.enc`) — those are not vault.  
- Do not use employee vault paths.  
- Respect pilot bucket “do not destroy” (`lp-d26`).  
- Prefer thrifty lab usage; no thrash sync loops.

## See also

- Dual-run field: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md) (`lp-gu2`)  
- Prefix layout: [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md)  
- Pilot bucket: [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) (`lp-d26`)  
- Daytona provision (no EC2 TF): [provision-runbook-daytona.md](./provision-runbook-daytona.md)  
- Next: cutover checklist **`lp-6h8`**: [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) · rollback `lp-ky7` · EC2 decommission `lp-u00`
