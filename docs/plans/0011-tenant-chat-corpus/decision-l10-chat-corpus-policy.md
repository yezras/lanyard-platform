# Decision: L10 chat corpus class, enablement defaults, retention

| Field | Value |
|-------|--------|
| **Bead** | `lp-gkh.1` (0011.1) |
| **Epic** | `lp-gkh` — Tenant chat corpus: durable S3 archive of request/response turns |
| **Status** | **Proposed** — product/policy draft; **human/legal gate required** before production enablement |
| **Date** | 2026-08-07 |
| **Needs human** | **true** — privacy, retention, and client data-handling alignment before any tenant is enabled in production |
| **Policy SoT** | [log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md) |
| **Plan** | [overview.md](./overview.md) |

No secrets, account IDs, or customer vault content appear in this document.

## Context

Portal chat history today is for **UI hydrate** only:

- **L4** — BFF thread store (in-memory or optional host-local SQLite via `CHAT_STORE_PATH`).
- **L3** — Relay process-lifetime ring for SSE.
- **L5** — Optional interaction export, **off by default**, **metadata-only** (no message bodies).

That posture is correct for shared ops sinks and compliance-light export. It is **not** a training or behavior-analysis corpus.

Product need (epic `lp-gkh`): a **durable, tenant-partitioned S3 corpus of full chat inputs and agent outputs**, captured at the platform boundary, enablement-gated, with explicit retention and access rules. BFF remains temporary UI cache — not perpetual source of truth for full bodies.

## Decision (normative for plan 0011)

### 1. New log class: **L10 Chat corpus**

| Attribute | Decision |
|-----------|----------|
| **Class ID** | **L10** |
| **What is stored** | Full turn bodies: user input, assistant output, optional structured tool events, content hashes, request meta |
| **Sink** | Tenant-partitioned **S3** under corpus prefix (not CloudWatch, not shared multi-tenant debug buckets) |
| **Partition key** | `tenant_id` (user_id is a **field** inside records, not a separate S3 root) |
| **Layout (v1)** | `tenants/{tenant_id}/chat-corpus/v1/year=…/month=…/day=…/thread={thread_id}/turn={turn_id}.json` |
| **Relationship to L1–L9** | Orthogonal. L10 does **not** relax L1 redaction or L5 metadata-only rules |

### 2. Distinct from L4 and L5 (must not be conflated)

| Class | Role | Bodies? | Default | Sink |
|-------|------|---------|---------|------|
| **L4** BFF chat hydrate | Temporary UI history / SSE hydrate | Yes (when durable store on) | Process lifetime or host-local file; **not** training SoT | BFF memory / optional `chat.db` |
| **L5** Interaction export | Ops / product interaction records | **No** — metadata only | **Off** (`interaction_export_enabled: false`, `retention_mode: "none"`) | Product export path |
| **L10** Chat corpus | Durable archive for training / behavior analysis | **Yes** — full I/O | **Off** (`chat_corpus_enabled: false`) | Tenant-partitioned S3 corpus |

**Normative:** Enabling L5 does **not** enable L10. Enabling L10 does **not** write full bodies to CloudWatch or L5 export. L4 remains UI-only and may be wiped without deleting L10 objects.

### 3. Enablement defaults — fail closed

| Control | Default | Notes |
|---------|---------|-------|
| `chat_corpus_enabled` (per tenant) | **`false` / off** | CorpusWriter **must not** write until explicitly enabled for that tenant |
| Global platform kill-switch (future env) | Prefer off / require explicit config | Implementation detail for `lp-gkh.4` / deploy; policy requires fail-closed |
| Chat path on corpus write failure | **Fail open for chat** | User turn succeeds; drop is visible via metrics / retry / DLQ (`lp-gkh.7`) |
| Silent drop without metrics | **Forbidden** | Fail closed for observability of corpus health |

**Fail closed** for enablement means: no tenant receives full-body S3 writes unless ops/product set `chat_corpus_enabled=true` **and** client data-handling policy allows it.

### 4. Retention lifecycle defaults + client override

| Control | Default | Override process |
|---------|---------|------------------|
| **Default TTL when L10 enabled** | **90 days** | Lifecycle rule on corpus prefix; shorter always allowed |
| **Minimum TTL when enabled** | **30 days** | Aligns with L5 floor; shorter only with written privacy rationale |
| **Maximum / indefinite** | Requires **written client acceptance** in per-client data-handling policy + platform ops approval | Same longer-than-default gate as G2b.1 TTL overrides |
| **Legal hold** | Suspend deletion under documented legal process; scope to tenant identifiers | Same as existing L1–L9 hold doctrine |
| **Disable corpus** | Setting `chat_corpus_enabled=false` **stops new writes**; existing objects follow lifecycle until purged or hold | Purge-on-disable is optional client request, not default |

Retention fields on tenant (implementation: `lp-gkh.6`) should expose at least:

- `chat_corpus_enabled` (bool, default false)
- `chat_corpus_retention_days` (int, default 90 when enabled; ignored when disabled)

### 5. Access control — not browser default

| Audience | L10 corpus access |
|----------|-------------------|
| **Customer tenant admins (browser)** | **No** default download/list of corpus objects |
| **End users (browser)** | **No** — chat UI uses L3/L4 hydrate only |
| **Lanyard training / ML pipeline roles** | Yes, via dedicated export path (`lp-gkh.8`), least privilege, tenant-scoped |
| **Lanyard platform ops (duty)** | Yes, need-to-know + ticketed break-glass; IAM on corpus bucket only |
| **Lanyard eng (non-duty)** | Staging yes; production via ticket |
| **Automated exporters** | Only training/export jobs with approved role + enabled tenant |
| **Third-party processors** | Only if listed in approved processors + client policy |

Access mechanisms (normative intent for infra `lp-gkh.3`):

- No public ACLs; SSE-S3 or SSE-KMS.
- IAM least privilege on `tenants/{tenant_id}/chat-corpus/*`.
- Training export is a **separate API/CLI**, not the browser chat history API.
- Guest sandboxes and vault personal trees are **not** corpus writers or SoT.

### 6. Capture boundary (policy-level)

- Capture at **platform boundary** (BFF primary CorpusWriter; optional Relay dual-write for frames BFF never sees).
- **Not** from Daytona guest disk or vault trees as source of truth.
- Idempotent object key includes stable `turn_id`.

### 7. Redaction posture

- L10 stores **full conversational bodies** by design when enabled.
- Optional pre-write secret-pattern strip is **defense in depth**, not a substitute for client policy or for keeping secrets out of chat.
- Shared **L1** sinks remain redacted; L10 must never be piped into CloudWatch as raw default.

## Alternatives considered

| Approach | Decision |
|----------|----------|
| Treat L5 export as training corpus | **Reject** — metadata-only; wrong product class |
| Perpetual BFF SQLite as corpus SoT | **Reject** — not multi-tenant durable ops, not training-friendly |
| Per-user S3 partition roots | **Reject** — tenant partition + user_id field |
| Guest writes corpus to S3 | **Reject** — wrong trust boundary |
| Default corpus on for all tenants | **Reject** — fails open on privacy; contradicts fail-closed |

## Human gate (required before production)

This decision is **Proposed** until a human (product + privacy/legal as needed) accepts:

1. **Default off** for `chat_corpus_enabled` is the production posture.
2. **90-day** default retention (when enabled) is acceptable, with client override process above.
3. Full bodies in tenant-partitioned S3 for enabled tenants is allowed under Lanyard + client data-handling templates.
4. Browser users do **not** get corpus download by default; training/ops roles only.
5. L10 is documented in the product log policy and per-client §4 retention rows when a tenant is enabled.

**Do not** enable production tenants or ship client-facing marketing of "chat archive / training corpus" until this gate is cleared. Implementation beads (`lp-gkh.2`–`lp-gkh.10`) may proceed on code paths that remain **fail closed** (default off).

## Consequences

- Policy document gains **L10** class, L4/L5/L10 comparison, access row, product hooks, and operator checklist items.
- Infra (`lp-gkh.3`), CP fields (`lp-gkh.6`), schema (`lp-gkh.2`), and writer (`lp-gkh.4`) must encode defaults **off** and tenant partition layout.
- Per-client data-handling templates should gain an optional **Chat corpus (L10)** row when first tenant is enabled.
- G2b ops-log doctrine (metadata over payloads on shared sinks) is **unchanged**.

## Linked sources

| Source | Role |
|--------|------|
| [overview.md](./overview.md) | Plan 0011 domain model, S3 layout, capture boundary |
| [log-retention-and-access.md](../../../portal/docs/policies/log-retention-and-access.md) | G2b.1 product log policy (L1–L9 + L10) |
| [log-redaction.md](../../../portal/docs/policies/log-redaction.md) | G2b.2 shared-sink redaction (L1 remains fail closed) |
| Epic `lp-gkh` | Beads definition of done for tenant chat corpus |

## Operator / implementer checklist (policy)

```text
[ ] chat_corpus_enabled defaults false in CP / config (fail closed)
[ ] No corpus writes when flag off
[ ] L10 objects never land in CloudWatch or shared debug buckets
[ ] Lifecycle default 90d when enabled; client override documented
[ ] IAM: training/ops only; no browser default list/get of corpus prefix
[ ] Human gate recorded before first production tenant enablement
[ ] Per-client data-handling §4 updated when a tenant enables L10
```
