# Infra: corpus bucket / prefix layout, KMS, lifecycle, IAM

**Bead:** `lp-gkh.3`  
**Epic:** `lp-gkh` — Tenant chat corpus (S3)  
**Depends on:** [decision-l10-chat-corpus-policy.md](./decision-l10-chat-corpus-policy.md) (`lp-gkh.1`)  
**Related:** [overview.md](./overview.md), vault layout [s3-vault-prefix-layout.md](../0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md)  
**Module:** [`deploy/modules/chat-corpus-infra/`](../../../deploy/modules/chat-corpus-infra/)  
**Offline smoke:** `bash deploy/scripts/smoke-chat-corpus-infra.sh`  
**Date:** 2026-08-13  

## Status

| Item | State |
|------|--------|
| **Layout lock** | **Locked** — `tenants/{tenant_id}/chat-corpus/v1/…` |
| **Terraform module** | **Present** — `infra_ready`, not auto-applied |
| **IAM drafts** | **Present** — `drafts/iam/` + module `iam.tf` |
| **Lifecycle documented** | **Yes** — L10 default 90d, floor 30d |
| **Live lab apply** | **Not required for this bead** — operator apply is follow-on under human gate for full-body corpus |
| **Separate from vault** | **Required** — dedicated corpus bucket preferred |

## Acceptance (`lp-gkh.3`)

| Criterion | Evidence |
|-----------|----------|
| TF plan or lab docs | Module under `deploy/modules/chat-corpus-infra/` + this doc |
| Bucket or prefix `tenants/{tid}/chat-corpus/v1/` | Layout section + `corpus_prefix_template` default |
| Encryption at rest | SSE-S3 default; optional SSE-KMS / module CMK |
| Lifecycle TTL from config | `retention_days` (default 90) + lifecycle rule `expire-chat-corpus-objects` |
| Writer role: PutObject on corpus prefix only | `iam.tf` + `drafts/iam/corpus-writer-policy.json` |
| Reader role: training export | `iam.tf` + `drafts/iam/corpus-reader-policy.json` |
| No public access | PAB all four ON; BucketOwnerEnforced; TLS-only bucket policy |
| Separate from vault (blast radius) | Dedicated bucket; IAM Deny vault paths |
| IAM deny vault paths from corpus role | `DenyVaultPathsBlastRadius` + list-prefix deny |

## Normative prefix layout

```text
s3://{lanyard_chat_corpus_bucket}/
  tenants/{tenant_id}/
    chat-corpus/
      v1/
        year={YYYY}/month={MM}/day={DD}/
          thread={thread_id}/
            turn={turn_id}.json
```

| Field | Rule |
|-------|------|
| Bucket | Platform-owned, **dedicated** chat corpus bucket (not vault, not product-artifacts) |
| Partition | **tenant_id** only at path level; `user_id` is a field inside the turn record |
| Version segment | `v1` for schema/layout generation |
| Object key | Includes stable `turn_id` for idempotent PUT (`lp-gkh.4`) |
| Trailing slash | Prefix strings used for IAM/List always end with `/` where applicable |

Optional later (not v1 writer path):

```text
…/chat-corpus/v1/firehose/year=…/month=…/day=…/hour=…/part-{n}.jsonl
```

### Rejected layouts

| Layout | Why rejected |
|--------|----------------|
| `tenants/{tid}/vault/…` chat logs | Pollutes company vault; ACL mismatch |
| Same bucket as vault without hard IAM walls | Blast radius if policy mistake |
| Per-user top-level prefix | Product partition is tenant; user is metadata |
| Guest-writable prefix | Wrong trust boundary |

## Separate from vault (blast radius)

| Store | Bucket (product naming) | Prefix |
|-------|-------------------------|--------|
| **Vault** (V1b) | `lanyard-vault-{env}` / lab `lanyard-mocklab-vault-*` | `tenants/{tid}/vault/` |
| **Chat corpus (L10)** | `lanyard-chat-corpus-{env}` | `tenants/{tid}/chat-corpus/v1/` |

Corpus IAM roles **Deny**:

- Object resources matching `…/tenants/*/vault` and `…/tenants/*/vault/*` (any bucket ARN pattern via module input defaults)
- `ListBucket` with `s3:prefix` like `tenants/*/vault*` on the corpus bucket

Writer/reader **Allow** only:

- Objects: `{corpus_bucket}/tenants/*/chat-corpus/v1/*`
- List: `s3:prefix` values under `tenants/…/chat-corpus/…`

## Encryption (KMS)

| Mode | When | Module inputs |
|------|------|----------------|
| **SSE-S3 (`AES256`)** | Lab / default | `s3_sse_algorithm = "AES256"` |
| **SSE-KMS external CMK** | Prod preferred | `s3_sse_algorithm = "aws:kms"`, `s3_kms_key_id = "arn:aws:kms:…"` |
| **SSE-KMS module CMK** | Prod isolation | `s3_sse_algorithm = "aws:kms"`, `create_kms_key = true` |

- Bucket key enabled when KMS.
- Module CMK: rotation on, 30-day deletion window, alias `alias/{name_prefix}-chat-corpus`.
- No public ACLs; Block Public Access all ON.

Draft bucket policy (TLS + public ACL deny): [`drafts/s3/corpus-bucket-policy.json`](./drafts/s3/corpus-bucket-policy.json).

## Lifecycle TTL

From L10 decision (`lp-gkh.1`):

| Control | Default | Module |
|---------|---------|--------|
| Default TTL when L10 enabled | **90 days** | `retention_days = 90` |
| Minimum TTL | **30 days** | validation floor on `retention_days` |
| Longer / indefinite | Written client acceptance + ops | Not automated; do not set huge TTL without gate |
| Legal hold | Documented legal process | Ops suspends deletion outside TF |
| Disable `chat_corpus_enabled` | Stops **new** writes | Lifecycle still expires existing objects |

Module rules (bucket lifecycle configuration):

1. **`expire-chat-corpus-objects`** — expire current versions under prefix `tenants/` after `retention_days`.
2. **`expire-noncurrent-versions`** — optional, when versioning enabled.
3. **`abort-incomplete-multipart`** — default 7 days.

**Note:** S3 lifecycle filters are literal prefixes (no `*` wildcards). The dedicated corpus bucket must **not** store non-corpus keys under `tenants/`. Per-tenant retention overrides may add extra prefix rules later (`tenants/{specific-id}/chat-corpus/v1/`).

## IAM roles

### Writer — CorpusWriter (`lp-gkh.4`)

| | |
|--|--|
| Purpose | Platform BFF (primary) async put of turn objects |
| Allow | `s3:PutObject`, multipart abort/list parts on corpus objects; list with corpus prefixes |
| Deny | Vault paths (blast-radius wall) |
| Not granted | `GetObject`, `DeleteObject` (append-oriented; idempotent overwrite via Put only) |
| Trust | Only when `writer_principal_arns` non-empty (fail-closed) |

Template: [`drafts/iam/corpus-writer-policy.json`](./drafts/iam/corpus-writer-policy.json).

### Reader — training export (`lp-gkh.8`)

| | |
|--|--|
| Purpose | Offline training / analytics export jobs |
| Allow | `s3:GetObject`, `GetObjectVersion`; list with corpus prefixes |
| Deny | Vault paths |
| Not granted | `PutObject`, `DeleteObject` |
| Trust | Only when `reader_principal_arns` non-empty |

Template: [`drafts/iam/corpus-reader-policy.json`](./drafts/iam/corpus-reader-policy.json).

### Explicitly out of scope for these roles

- Browser / customer admin download
- Guest sandbox roles
- Vault mount roles
- Product-artifact publisher roles

## Lab / plan coordinates (no live apply in this bead)

```text
# Product naming (operator replaces env + uniqueness suffix)
s3://lanyard-chat-corpus-{env}/tenants/{tenant_id}/chat-corpus/v1/

# Example lab shape (not provisioned by this bead)
s3://lanyard-chat-corpus-lab-REPLACE/tenants/mocklab/chat-corpus/v1/
```

| Field | Value |
|-------|--------|
| Module path | `deploy/modules/chat-corpus-infra/` |
| Example tfvars | `deploy/modules/chat-corpus-infra/terraform.tfvars.example` |
| Lab vault (do **not** reuse) | `lanyard-mocklab-vault-123456789012` |
| Enablement default | `chat_corpus_enabled=false` until CP + policy gate (`lp-gkh.6`, human) |

### Terraform plan (operator, offline/CI-friendly)

```bash
cd deploy/modules/chat-corpus-infra
# Optional: terraform init + validate when AWS provider can resolve region
# terraform init -backend=false
# terraform validate
# Full plan requires credentials + real bucket name (never commit live IDs)
```

Offline contract checks (no AWS):

```bash
bash deploy/scripts/smoke-chat-corpus-infra.sh
```

## Platform config sketch (consumers)

```text
chat_corpus.bucket           = lanyard-chat-corpus-{env}
chat_corpus.region           = <platform region>
chat_corpus.prefix_template  = tenants/{tenant_id}/chat-corpus/v1/
chat_corpus.retention_days   = 90
chat_corpus.sse              = AES256 | aws:kms
chat_corpus.writer_role_arn  = <module output writer_role_arn>
chat_corpus.reader_role_arn  = <module output reader_role_arn>
```

CP stores per-tenant enablement/retention (`lp-gkh.6`); bucket name stays platform config.

## What this bead does **not** do

- Apply the module to lab or staging  
- Enable any production tenant (`chat_corpus_enabled` stays fail-closed)  
- Implement CorpusWriter or BFF tee (`lp-gkh.4`, `lp-gkh.5`)  
- Implement training export CLI (`lp-gkh.8`)  
- Share the vault bucket or grant corpus roles vault access  
- Commit secrets, account IDs, or live principal ARNs  

## Validation

```bash
bash deploy/scripts/smoke-chat-corpus-infra.sh
bash scripts/validate.sh   # includes corpus infra smoke when present
```

## Unblocks

- `lp-gkh.4` CorpusWriter interface + S3 put by `turn_id`  
- `lp-gkh.8` Training export list/read  
- `lp-gkh.9` Live MockLab proof (needs apply + enablement)  
