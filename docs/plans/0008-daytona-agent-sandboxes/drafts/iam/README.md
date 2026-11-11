# IAM policy templates (sandbox vault mount)

**Beads:** `lp-kng.2.5` (offline draft) · **`lp-t86`** (Phase 3 template + cross-tenant review) · **`lp-zuh.9.1`** (TF apply: shared base role + CP AssumeRole)  
**Normative design:** [../../iam-scoped-s3-mount-policy.md](../../iam-scoped-s3-mount-policy.md)  
**Prefix layout:** [../../s3-vault-prefix-layout.md](../../s3-vault-prefix-layout.md)  
**Terraform (applied):** `deploy/modules/sandbox-vault-mount-iam/` · lab root `deploy/deployments/lab-sandbox-vault-mount-iam/`  
**Offline smoke:** `bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh`  
**Live smoke (lab):** `SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1 bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh`

These JSON files are **policy templates** for per-tenant S3 vault Mountpoint credentials (session / identity / trust sketches). The **applied** shared base role and CP task grant live in Terraform (`lp-zuh.9.1`). **Do not** commit secrets, long-lived keys, or session tokens.

| File | Use |
|------|-----|
| `sandbox-vault-mount-session-policy.json` | STS session policy scoped to `tenants/{tenant_id}/vault/` (recommended; mirrored in TF `templates/session-policy.json`) |
| `sandbox-vault-mount-identity-policy.json` | Per-tenant identity sketch (shared base uses upper-bound `tenants/*/vault/*` in TF) |
| `sandbox-vault-mount-trust-policy.json` | Trust sketch: orchestrator AssumeRole only |
| `platform-vault-seed-policy.json` | Platform seed/admin (**never** guest-injected) |

Placeholders: `${LANYARD_VAULT_BUCKET}`, `${TENANT_ID}`, `${ORCHESTRATOR_ROLE_ARN}`, `${OPTIONAL_EXTERNAL_ID}`.

**Apply:** `deploy/modules/sandbox-vault-mount-iam` via lab root (or compose into platform env). CI runs offline smoke only — no keys in git.
