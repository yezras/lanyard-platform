# Ops runbook: enable tenant chat corpus (L10)

| Field | Value |
|-------|--------|
| **Bead** | `lp-gkh.6` (0011.6) |
| **Epic** | `lp-gkh` — Tenant chat corpus |
| **Related** | [decision-l10](./decision-l10-chat-corpus-policy.md), [overview](./overview.md), [full operator enablement + training export runbook](./operator-enablement-training-export-runbook.md) (`lp-gkh.10`) |
| **Default** | **off** (`chat_corpus_enabled: false`) — fail closed |

No secrets, account IDs, or customer vault content appear in this document.

## What this controls

| Field | Meaning | Default |
|-------|---------|---------|
| `chat_corpus_enabled` | When true, BFF CorpusWriter may append full chat turn bodies to tenant-partitioned S3 (L10) | `false` |
| `chat_corpus_retention_days` | Optional TTL override in days (bucket lifecycle / export tooling) | `null` → **90** days when enabled |

**Not the same as L5** (`interaction_export_enabled` / `retention_mode`): L5 is metadata-only interaction export. Enabling L5 does **not** enable L10. Enabling L10 does **not** write full bodies to CloudWatch or L5 export.

## Prerequisites (before production enablement)

1. **Human / legal gate** on [decision-l10-chat-corpus-policy.md](./decision-l10-chat-corpus-policy.md) accepted for this tenant (or environment policy covers it).
2. Client data-handling policy §4 includes a **Chat corpus (L10)** row when required by contract.
3. Corpus bucket / IAM applied for the environment (`lp-gkh.3` / `deploy/modules/chat-corpus-infra` when merged).
4. BFF has `CONTROL_PLANE_URL` and `INTERNAL_OPS_TOKEN` (or `CONTROL_PLANE_INTERNAL_TOKEN`) so it can read the retention snapshot.
5. Operator holds `INTERNAL_OPS_TOKEN` for control-plane ops routes (never commit or paste into tickets).

## API surface

```text
GET  /internal/tenants/:tenant_id/retention
PATCH /internal/tenants/:tenant_id/retention
Header: x-internal-ops-token: <INTERNAL_OPS_TOKEN>
Optional: x-lanyard-actor: <operator-id>
```

Response shape (metadata only — no message bodies):

```json
{
  "tenant_id": "…",
  "interaction_export_enabled": false,
  "retention_mode": "none",
  "chat_corpus_enabled": false,
  "chat_corpus_retention_days": null
}
```

### Validation

| Field | Rules |
|-------|--------|
| `chat_corpus_enabled` | boolean |
| `chat_corpus_retention_days` | integer **30–3650**, or `null` to clear override |
| PATCH body | at least one retention field must be present |

## Enable a tenant (lab or approved prod)

```bash
# Resolve tenant_id (example: by slug via ops tooling / CP admin)
TENANT_ID="<uuid>"
CP_URL="${CONTROL_PLANE_URL}"   # e.g. https://cp.internal.example
# INTERNAL_OPS_TOKEN from secret store — do not echo

# 1) Confirm default off
curl -sS -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq .

# 2) Enable L10 with optional retention override (omit days → null → 90d effective)
curl -sS -X PATCH \
  -H "content-type: application/json" \
  -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  -H "x-lanyard-actor: $USER" \
  -d '{"chat_corpus_enabled":true,"chat_corpus_retention_days":90}' \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq .

# 3) Verify
curl -sS -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq '{chat_corpus_enabled,chat_corpus_retention_days}'
```

Audit: CP writes `tenant.retention_updated` with flag metadata only (no chat bodies).

## Disable (stop new writes)

```bash
curl -sS -X PATCH \
  -H "content-type: application/json" \
  -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  -H "x-lanyard-actor: $USER" \
  -d '{"chat_corpus_enabled":false}' \
  "$CP_URL/internal/tenants/$TENANT_ID/retention" | jq .
```

- **Stops new corpus writes** immediately (BFF `shouldWriteChatCorpus` → false).
- Existing S3 objects follow lifecycle until expiry, purge job, or legal hold.
- Purge-on-disable is **not** default; handle as a separate ticketed request.

## BFF behavior

| Module | Role |
|--------|------|
| `packages/bff/src/chat-corpus.ts` | `shouldWriteChatCorpus(tenantId)` — fail closed |
| `packages/bff/src/chat-corpus-capture.ts` | Buffer user turn + SSE-tee finalize → CorpusWriter (`lp-gkh.5`) |
| `ControlPlaneAuthClient.getTenantRetention` | Typed GET of retention snapshot |
| CorpusWriter tee (`lp-gkh.5`) | Must call the gate before full-body S3 put; metric `chat_corpus_write_failed` |
| Writer metrics / retry / DLQ (`lp-gkh.7`) | Package metrics `chat_corpus_write_{success,failure,latency,bytes}`; retry transient S3; optional `failed/` DLQ |

If CP is unreachable or the flag is missing/false, **no corpus write**. Chat path still succeeds (fail open for user turns; fail closed for enablement).

### Observability (`lp-gkh.7`)

- **Policy + dashboard notes:** [metrics-retry-dlq.md](./metrics-retry-dlq.md)
- **Retry:** 3 attempts, exponential backoff (50ms base, 1s cap) on transient S3 only
- **DLQ (opt-in):** `tenants/{tid}/chat-corpus/v1/failed/year=…/turn={turn_id}.json` (excluded from training export)
- **SQS DLQ:** deferred; `failed/` prefix is the v1 poison path
- Wire host metrics from `createCorpusMetricsHooks` / `InMemoryCorpusMetrics` when deploying the BFF writer

## MockLab / staging checklist

```text
[ ] chat_corpus_enabled defaults false for new tenants
[ ] PATCH enable returns chat_corpus_enabled true
[ ] BFF unit tests: default off; L5-on does not enable L10
[ ] After lp-gkh.5: one chat turn with flag on → corpus object; flag off → no object
[ ] lp-gkh.9 live proof: bash deploy/scripts/prove-mocklab-chat-corpus.sh
[ ] Evidence: artifacts/mocklab/lp-gkh.9/live-proof-evidence-latest.json
[ ] Do not enable production tenants until L10 human gate is recorded
```

## MockLab live proof (lp-gkh.9)

Offline-by-default lab proof (no AWS corpus bucket apply required):

```bash
bash deploy/scripts/prove-mocklab-chat-corpus.sh
# Evidence: artifacts/mocklab/lp-gkh.9/live-proof-evidence-latest.json
# Asserts: object key under tenants/{tid}/chat-corpus/v1/; redacted record shape
#          with user+assistant roles; BFF restart independence via durable FS store
```

### BFF host wiring (lab)

| Env | Purpose |
|-----|---------|
| `CHAT_CORPUS_BUCKET` | Bare bucket name (e.g. `lanyard-chat-corpus-lab`) |
| `CHAT_CORPUS_FS_ROOT` | Durable directory for `FsCorpusObjectStore` (`{root}/{bucket}/{key}`) |

Without both env vars, BFF does **not** attach a CorpusWriter (fail closed / capture no-op). Tenant `chat_corpus_enabled` still gates writes when a writer is present.

Restart proof: stop and start BFF with the **same** `CHAT_CORPUS_FS_ROOT`; objects remain on disk under the corpus key layout.

## Related

- Policy SoT: [portal/docs/policies/log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md)
- Infra: `lp-gkh.3` (bucket / IAM / lifecycle)
- Training export CLI: `lp-gkh.8` / full operator runbook: [operator-enablement-training-export-runbook.md](./operator-enablement-training-export-runbook.md) (`lp-gkh.10`)
