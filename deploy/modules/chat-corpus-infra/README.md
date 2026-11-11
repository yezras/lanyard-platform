# chat-corpus-infra

Reusable Terraform module for **L10 tenant chat corpus** storage and IAM (`lp-gkh.3`, plan [0011-tenant-chat-corpus](../../../docs/plans/0011-tenant-chat-corpus/overview.md)).

| Resource | Purpose |
|----------|---------|
| Private **S3** bucket (dedicated) | Tenant-partitioned full-body chat turns |
| **SSE-S3** or **SSE-KMS** | Encryption at rest (optional module CMK) |
| **Lifecycle** | Expire objects after `retention_days` (L10 default **90**) |
| **Writer IAM role** | `PutObject` on `tenants/*/chat-corpus/v1/*` only |
| **Reader IAM role** | `GetObject` + `ListBucket` for training export (`lp-gkh.8`) |
| **Deny vault paths** | Corpus roles cannot touch `tenants/*/vault/*` |

**Status:** `infra_ready` — not auto-applied. Offline smoke: `deploy/scripts/smoke-chat-corpus-infra.sh`. Design + lab notes: [infra-bucket-iam-lifecycle.md](../../../docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md).

## What this enables

- Platform operators can plan/apply a **corpus bucket separate from the vault bucket** (blast-radius isolation).
- CorpusWriter (`lp-gkh.4`) and training export (`lp-gkh.8`) get least-privilege roles.
- Lifecycle documents the L10 retention default from `lp-gkh.1` / decision record.

## What this does **not** do

| Gated item | Why |
|------------|-----|
| Live lab/staging apply | Operator hold + human gate for full-body corpus |
| BFF CorpusWriter code | `lp-gkh.4` |
| Per-tenant CP enablement fields | `lp-gkh.6` (`chat_corpus_enabled` default **off**) |
| Training export CLI | `lp-gkh.8` |
| Per-tenant STS session policies | Optional follow-on (platform roles allow `tenants/*` corpus mid-path) |
| Browser download of corpus | Policy forbids default browser access |

## Normative layout

```text
s3://{lanyard_chat_corpus_bucket}/
  tenants/{tenant_id}/
    chat-corpus/
      v1/
        year={YYYY}/month={MM}/day={DD}/
          thread={thread_id}/
            turn={turn_id}.json
```

**Do not** colocate vault trees (`tenants/{tid}/vault/`) in this bucket. Prefer a dedicated `lanyard-chat-corpus-{env}` name — never the mocklab vault bucket.

## Usage

```hcl
module "chat_corpus" {
  source = "../../modules/chat-corpus-infra"

  name_prefix        = "lanyard-platform-lab"
  environment        = "lab"
  corpus_bucket_name = "lanyard-chat-corpus-lab-REPLACE"

  # L10 default TTL when corpus is enabled (lp-gkh.1)
  retention_days = 90

  # SSE-S3 lab default; for prod set s3_sse_algorithm = "aws:kms" + create_kms_key or s3_kms_key_id
  s3_sse_algorithm = "AES256"

  # Roles created only when principal ARNs are non-empty (fail-closed)
  create_iam_roles = true
  # writer_principal_arns = ["arn:aws:iam::ACCOUNT:role/portal-bff-task-REPLACE"]
  # reader_principal_arns = ["arn:aws:iam::ACCOUNT:role/training-export-REPLACE"]
}
```

Prefer **relative** module sources inside this monorepo. External consumers must pin a tag/commit — never `ref=main`.

## IAM contract

### Writer (CorpusWriter)

| Action | Scope |
|--------|--------|
| `s3:PutObject`, multipart abort/list parts | `…/tenants/*/chat-corpus/v1/*` |
| `s3:ListBucket`, `s3:GetBucketLocation` | Bucket, `s3:prefix` like corpus paths only |
| **Denied** | `tenants/*/vault/*` (and configured vault ARN patterns) |
| **Not granted** | `s3:GetObject`, `s3:DeleteObject` (append-oriented) |

### Reader (training export)

| Action | Scope |
|--------|--------|
| `s3:GetObject`, `s3:GetObjectVersion` | `…/tenants/*/chat-corpus/v1/*` |
| `s3:ListBucket`, `s3:GetBucketLocation` | Bucket, corpus prefixes only |
| **Denied** | Vault paths (same wall as writer) |

Policy document JSON is always exported (`writer_policy_json` / `reader_policy_json`) so operators can attach to existing task roles without creating module-managed roles.

## Lifecycle (documented)

| Rule | Default | Notes |
|------|---------|--------|
| Expire current objects under `tenants/` | **90 days** | L10 default; floor **30**; longer needs written client acceptance |
| Expire noncurrent versions | 90 days (if versioning on) | Hygiene after overwrite |
| Abort incomplete multipart | 7 days | Upload hygiene |
| Legal hold | Ops process | Not automated in this module |
| Disable corpus flag | Stops **new** writes | Existing objects still expire via lifecycle |

Per-tenant `chat_corpus_retention_days` (CP, `lp-gkh.6`) may require additional prefix-scoped lifecycle rules applied by ops for overrides; bucket default is the platform floor/default.

## Encryption / public access

- Block Public Access: **all four ON**
- Object ownership: **BucketOwnerEnforced** (no ACLs)
- Bucket policy: **TLS-only** (`aws:SecureTransport=false` → Deny) + deny public object ACLs
- SSE-S3 (`AES256`) default; optional SSE-KMS + module CMK (`create_kms_key`) or external `s3_kms_key_id`

## Offline validation

```bash
bash deploy/scripts/smoke-chat-corpus-infra.sh
```

## Related

- [infra-bucket-iam-lifecycle.md](../../../docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md)
- [decision-l10-chat-corpus-policy.md](../../../docs/plans/0011-tenant-chat-corpus/decision-l10-chat-corpus-policy.md) (`lp-gkh.1`)
- [overview.md](../../../docs/plans/0011-tenant-chat-corpus/overview.md)
- Vault layout (must stay separate): [s3-vault-prefix-layout.md](../../../docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md)
