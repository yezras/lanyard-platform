# Operator runbook: enable tenant chat corpus, verify writes, training export, disable

| Field | Value |
|-------|--------|
| **Bead** | `lp-gkh.10` (0011.10) |
| **Epic** | `lp-gkh` — Tenant chat corpus (S3) |
| **Plan** | [overview.md](./overview.md) (0011) |
| **Policy L10** | [decision-l10-chat-corpus-policy.md](./decision-l10-chat-corpus-policy.md) · product SoT [log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md) |
| **Enablement API detail** | [ops-enablement-runbook.md](./ops-enablement-runbook.md) (`lp-gkh.6`) |
| **Training export package** | [`@lanyard/chat-corpus`](../../../portal/packages/chat-corpus/) (`lp-gkh.8`) |
| **Default** | **off** (`chat_corpus_enabled: false`) — fail closed |

No secrets, account IDs, access keys, or customer vault / chat content appear in this document.

---

## Purpose

End-to-end **operator lifecycle** for **L10 Chat corpus**:

1. **Privacy / legal review** (required before production enable)
2. **Enable** a tenant for full-body corpus writes
3. **Verify** that chat turns land under the corpus prefix
4. **Export** a training batch (list / JSONL) for an approved job
5. **Disable** new writes (existing objects follow lifecycle)

This is the durable ops path for plan **0011**. Implementation code paths remain fail-closed until you explicitly enable a tenant.

---

## Privacy / legal review (production gate)

> **Do not enable production tenants** until the L10 human gate is recorded.

| Gate item | Why |
|-----------|-----|
| [decision-l10](./decision-l10-chat-corpus-policy.md) accepted (product + privacy/legal as needed) | Full bodies in S3 when enabled |
| Per-client data-handling policy §4 includes a **Chat corpus (L10)** row when contract requires it | Retention + purpose disclosure |
| Corpus bucket / IAM applied for the environment (`lp-gkh.3`) | No public ACL; writer/reader least privilege |
| Training/export audience is **ops or ML pipeline roles only** | No tenant browser download in v1 |
| Ticket or change record names the tenant, retention days, approver, and export purpose | Auditability |

**Lab / MockLab** may enable a non-production tenant for proof without client marketing claims. Production enablement is a **human** decision, not an automated flag flip.

Related: product log policy L10 class, L4 vs L5 vs L10 comparison, and access matrix in the decision doc and [log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md).

---

## Prerequisites (any environment)

| # | Requirement | Notes |
|---|-------------|--------|
| 1 | Control plane reachable | `CONTROL_PLANE_URL` |
| 2 | Operator holds `INTERNAL_OPS_TOKEN` | From secret store; never commit, paste into tickets, or echo into logs |
| 3 | BFF can read retention snapshot | `CONTROL_PLANE_URL` + `INTERNAL_OPS_TOKEN` (or `CONTROL_PLANE_INTERNAL_TOKEN`) on the BFF task |
| 4 | Corpus writer wiring | Lab: `CHAT_CORPUS_BUCKET` + `CHAT_CORPUS_FS_ROOT`. Prod/staging: S3 store + **corpus writer** IAM (`drafts/iam/corpus-writer-policy.json`) |
| 5 | Export job (when exporting) | **Corpus reader** IAM only (`drafts/iam/corpus-reader-policy.json`); no vault paths |

API surface for enable/disable: see [ops-enablement-runbook.md](./ops-enablement-runbook.md).

```text
GET  /internal/tenants/:tenant_id/retention
PATCH /internal/tenants/:tenant_id/retention
Header: x-internal-ops-token: <INTERNAL_OPS_TOKEN>
Optional: x-lanyard-actor: <operator-id>
```

---

## 1. Enable a tenant

Confirm default off, then enable L10 with optional retention override.

```bash
TENANT_ID="<uuid>"
CP_URL="${CONTROL_PLANE_URL}"
# INTERNAL_OPS_TOKEN from secret store — do not echo

# Confirm off
curl -sS -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" \
  | jq '{chat_corpus_enabled,chat_corpus_retention_days,interaction_export_enabled}'

# Enable (omit days → null → 90d effective when enabled)
curl -sS -X PATCH \
  -H "content-type: application/json" \
  -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  -H "x-lanyard-actor: $USER" \
  -d '{"chat_corpus_enabled":true,"chat_corpus_retention_days":90}' \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq .

# Verify
curl -sS -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" \
  | jq '{chat_corpus_enabled,chat_corpus_retention_days}'
```

| Field | Rules |
|-------|--------|
| `chat_corpus_enabled` | boolean; default **false** |
| `chat_corpus_retention_days` | integer **30–3650**, or `null` to clear override (effective **90** when enabled) |

**Not L5:** Enabling `interaction_export_enabled` does **not** enable L10. Enabling L10 does **not** write full bodies to CloudWatch or L5 export.

Audit: CP emits `tenant.retention_updated` with flag metadata only (no chat bodies).

---

## 2. Verify writes

After enablement, prove the platform CorpusWriter is putting turn objects for that tenant.

### Object layout (normative)

```text
s3://{lanyard_chat_corpus_bucket}/
  tenants/{tenant_id}/
    chat-corpus/
      v1/
        year={YYYY}/month={MM}/day={DD}/
          thread={thread_id}/
            turn={turn_id}.json
```

Hive day partitions are **UTC** from `created_at`. Same `turn_id` → same key → idempotent put.

### Lab / MockLab (preferred offline proof)

```bash
# Live proof (no AWS corpus bucket apply required when FS store is wired)
bash deploy/scripts/prove-mocklab-chat-corpus.sh
# Evidence: artifacts/mocklab/lp-gkh.9/live-proof-evidence-latest.json
```

BFF lab env:

| Env | Purpose |
|-----|---------|
| `CHAT_CORPUS_BUCKET` | Bare bucket name (e.g. `lanyard-chat-corpus-lab`) |
| `CHAT_CORPUS_FS_ROOT` | Durable root for `FsCorpusObjectStore` (`{root}/{bucket}/{key}`) |

Without both env vars, BFF does **not** attach a CorpusWriter (capture no-op). Tenant flag still gates writes when a writer is present.

### Staging / production checks

```text
[ ] Tenant retention shows chat_corpus_enabled=true
[ ] One complete chat turn as an authorized user of that tenant
[ ] Object exists under tenants/{tid}/chat-corpus/v1/year=…/month=…/day=…/thread=…/turn=….json
[ ] Record has schema_version=1, input.role=user, output.role=assistant, content_sha256 fields
[ ] chat_corpus_write_success (or lab FS list) increments; no silent drop without metrics
[ ] Flag off → no new objects for subsequent turns
```

Metrics / retry / DLQ: [metrics-retry-dlq.md](./metrics-retry-dlq.md). DLQ keys under `…/failed/` are **excluded** from training export list/read.

Chat path **fails open** if corpus write fails (user turn still succeeds). Enablement **fails closed** (no write when flag off or CP unreachable).

---

## 3. Training export (batch)

Offline / ops path only. **No tenant browser API** in v1. Auth is the **corpus reader** role (or Fake/FS store in lab). Never put access keys on the CLI argv or in tickets.

### Dry-run (fake S3 — no credentials)

```bash
cd portal

# List keys under tenants/{tid}/chat-corpus for an inclusive UTC date range
pnpm --filter @lanyard/chat-corpus export:training -- --fake \
  --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode list

# Stream ChatTurnRecord JSONL (one object per line)
pnpm --filter @lanyard/chat-corpus export:training -- --fake \
  --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode jsonl
```

`--fake` seeds a small in-memory corpus (including out-of-range and other-tenant objects) so dry-run proves **tenant + date filtering**. No AWS account or tokens required.

### Live export (approved ops job)

`@lanyard/chat-corpus` does **not** bundle `@aws-sdk`. Host jobs inject a `CorpusObjectStore` with `listObjects` + `getObject` using the **reader** role and default credential chain / instance profile.

```ts
import {
  CorpusTrainingExporter,
  // inject live store implementing listObjects + getObject
} from "@lanyard/chat-corpus";

const exporter = new CorpusTrainingExporter({
  bucket: process.env.LANYARD_CHAT_CORPUS_BUCKET!, // bare name
  store: liveStore,
});

const listed = await exporter.listTurns({
  tenant_id: tenantId,
  from: "2026-08-01",
  to: "2026-08-07",
});
if (!listed.ok) throw new Error(listed.error);

// JSONL training batch
for await (const row of exporter.iterateTurns({
  tenant_id: tenantId,
  from: "2026-08-01",
  to: "2026-08-07",
})) {
  if (row.ok) {
    process.stdout.write(`${JSON.stringify(row.record)}\n`);
  }
}
```

| Rule | Detail |
|------|--------|
| Scope | Single `tenant_id` + inclusive UTC day range |
| Keys | Only turn objects matching `…/thread=…/turn=….json` (not `failed/` DLQ) |
| IAM | Reader: GetObject + List under corpus prefix; **Deny** vault paths |
| Secrets | Instance role / default chain only — no long-lived keys on laptops for prod |
| Output handling | Training store must honor client retention and approved-processor rules; do not re-export full bodies to shared debug buckets |

Package README: [`portal/packages/chat-corpus/README.md`](../../../portal/packages/chat-corpus/README.md). IAM draft: [`drafts/iam/corpus-reader-policy.json`](./drafts/iam/corpus-reader-policy.json).

---

## 4. Disable (stop new writes)

```bash
curl -sS -X PATCH \
  -H "content-type: application/json" \
  -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  -H "x-lanyard-actor: $USER" \
  -d '{"chat_corpus_enabled":false}' \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq .
```

| Effect | Behavior |
|--------|----------|
| New writes | Stop immediately (`shouldWriteChatCorpus` → false) |
| Existing objects | Remain until lifecycle TTL, purge job, or legal hold |
| Purge-on-disable | **Not** default — ticket as a separate request |
| Training export | May still read remaining objects until they expire (reader role + policy) |

---

## Operator checklist (copy into change ticket)

```text
Privacy / production
[ ] L10 decision human/legal gate recorded (or lab-only scope stated)
[ ] Client data-handling §4 Chat corpus (L10) row updated if required
[ ] Export purpose + audience documented (training / eval / ticketed ops)

Infra
[ ] Corpus bucket + writer/reader IAM for environment (lp-gkh.3)
[ ] BFF writer wiring present (bucket + store); metrics hooks optional but recommended

Enable → verify
[ ] GET retention: chat_corpus_enabled was false (or intentional re-enable)
[ ] PATCH enable + GET confirm true (+ retention_days if set)
[ ] One chat turn → object under tenants/{tid}/chat-corpus/v1/…
[ ] Metrics or lab list confirms write (no silent drop)

Export
[ ] Dry-run: pnpm … export:training -- --fake … lists expected keys
[ ] Live job uses corpus reader role only; no vault access; no browser path
[ ] Output landings obey retention / approved processors

Disable
[ ] PATCH chat_corpus_enabled=false when done or on incident
[ ] Confirm no new objects after disable
[ ] Lifecycle / purge handled only if ticketed
```

---

## Related documents

| Doc | Role |
|-----|------|
| [overview.md](./overview.md) | Plan 0011 domain model, S3 layout, beads |
| [decision-l10-chat-corpus-policy.md](./decision-l10-chat-corpus-policy.md) | L10 class, defaults, access, human gate |
| [ops-enablement-runbook.md](./ops-enablement-runbook.md) | CP retention API + BFF gate detail |
| [infra-bucket-iam-lifecycle.md](./infra-bucket-iam-lifecycle.md) | Bucket, KMS, lifecycle, IAM |
| [metrics-retry-dlq.md](./metrics-retry-dlq.md) | Writer metrics, retry, failed/ DLQ |
| [log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md) | Product log classes including L10 |
| [`@lanyard/chat-corpus` README](../../../portal/packages/chat-corpus/README.md) | Writer + export library usage |
| `deploy/scripts/prove-mocklab-chat-corpus.sh` | MockLab live proof (`lp-gkh.9`) |
| `contracts/chat-corpus-v1/` | Turn record schema SoT |

---

## Acceptance (this bead)

| Criterion | Evidence |
|-----------|----------|
| Runbook covers enable → verify → export → disable | Sections 1–4 above |
| Links policy L10 + plan 0011 | Header table + Related |
| Privacy/legal review before production enable | § Privacy / legal review |
| Path linked from plan overview | `overview.md` |
| Path linked from portal docs index | `portal/docs/README.md` |
