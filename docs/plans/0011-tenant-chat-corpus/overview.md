# Tenant chat corpus (S3) — durable request/response archive

**Status:** Plan / design (implementation via Beads epic)  
**Date:** 2026-08-07  
**Related:** [chat-transcript-durability](../../../portal/artifacts/chat-transcript-durability.md), [log-retention-and-access](../../../portal/docs/policies/log-retention-and-access.md), [L10 decision](./decision-l10-chat-corpus-policy.md) (`lp-gkh.1`), [operator enablement + training export runbook](./operator-enablement-training-export-runbook.md) (`lp-gkh.10`), BFF `ChatThreadStore`, Relay retention gate

## Context

Portal chat history today is for **UI hydrate**:

- BFF in-memory (optional host-local `CHAT_STORE_PATH` SQLite).
- Relay process-lifetime ring for SSE.
- Agent `sessions.db` on ephemeral guest disk.

Policy currently defaults **interaction export off** and, when on, **metadata-only** (no message bodies in L5). That is correct for ops logs; it is **not** a training/analytics corpus.

Product need: a **durable S3 corpus of every user request and agent response**, partitioned **per tenant** (not a separate S3 tree per user), for:

- Understanding user/agent behavior.
- Future model training / eval datasets.
- Auditable conversation history independent of BFF process lifetime.

BFF may remain a **temporary** UI cache. It must **not** be the perpetual source of truth for full bodies.

## Scope

### In

- Append-only (or immutable object) store of turn records: user input + agent output (+ structured tool events as needed).
- Tenant-partitioned S3 layout under platform bucket (or dedicated corpus bucket).
- Capture at platform boundary (BFF and/or Relay) after successful delivery, not from guest sandbox disk.
- Per-tenant enablement flag + retention TTL + encryption.
- Export tooling for training pipelines (batch list/read by tenant + time range).
- Policy update distinguishing **corpus store** from **ops log sinks** and from **UI hydrate**.

### Out

- Storing corpus inside Daytona sandbox or vault personal trees as SoT.
- Per-user S3 top-level partition (user_id is a **field** inside records; partition key is tenant).
- Real-time training loop (offline export is enough for v1).
- Replacing BFF history API with S3 GETs for interactive chat (hydrate stays local/fast).
- Cross-tenant analytics without aggregation jobs (out of band).

## Domain model

### Turn record (normative)

**Published schema:** [`contracts/chat-corpus-v1/chat-turn-record.schema.json`](../../../contracts/chat-corpus-v1/chat-turn-record.schema.json) (`lp-gkh.2`)  
**TS write boundary:** [`portal/packages/chat-corpus`](../../../portal/packages/chat-corpus) (`@lanyard/chat-corpus` — Zod parse + `content_sha256`)  
**Examples:** [`contracts/chat-corpus-v1/examples/`](../../../contracts/chat-corpus-v1/examples/)

```json
{
  "schema_version": 1,
  "record_type": "chat_turn",
  "tenant_id": "uuid",
  "user_id": "uuid",
  "instance_id": "uuid",
  "thread_id": "uuid",
  "turn_id": "uuid",
  "session_key": "agent:main:relay:dm:…",
  "created_at": "RFC3339",
  "model": { "provider": "poolside", "name": "laguna-s-2.1" },
  "input": {
    "role": "user",
    "content": "…",
    "content_sha256": "…"
  },
  "output": {
    "role": "assistant",
    "content": "…",
    "content_sha256": "…",
    "finish_reason": "stop"
  },
  "tool_events": [ ],
  "meta": {
    "request_id": "…",
    "duration_ms": 0,
    "sandbox_id": "…",
    "client": "portal_web"
  }
}
```

`schema_version` is **required** (const `1`). `input` / `output` require `content_sha256` (lowercase hex SHA-256 of UTF-8 body).

**Partitioning:** objects keyed by `tenant_id` (+ time). `user_id` is metadata for filtering, not a separate bucket prefix requirement.

### S3 layout

```text
s3://{lanyard_chat_corpus_bucket}/
  tenants/{tenant_id}/
    chat-corpus/
      v1/
        year={YYYY}/month={MM}/day={DD}/
          thread={thread_id}/
            turn={turn_id}.json
```

Optional: JSONL firehose per hour for cheaper bulk training reads:

```text
…/chat-corpus/v1/firehose/year=…/month=…/day=…/hour=…/part-{n}.jsonl
```

v1 recommendation: **one object per turn** for simple idempotent PUT; optional firehose as batch job later.

### Capture boundary

```text
User POST /api/chat/threads/:id/messages
  → BFF append UI history (temporary)
  → Relay deliver inbound → gateway
  → gateway outbound → Relay → SSE to client
  → **CorpusWriter** (async, after outbound known):
        put turn object (input + output + tools)
```

Prefer a **single writer** that sees both sides:

| Option | Pros | Cons |
|--------|------|------|
| BFF tee after SSE outbound known | One place with auth context | Must not block request path |
| Relay export path | Sees full frames | Today gated metadata-only; needs new body path |
| Agent guest upload | Has full session | Ephemeral; trust; wrong boundary |

**Chosen:** platform-side **CorpusWriter** invoked from BFF (primary) with optional Relay dual-write for frames BFF never sees. Fail **open for chat** (corpus write failure must not fail the user turn); fail **closed for silent drop** via metrics + DLQ/retry.

### Idempotency

- Object key includes `turn_id` (stable).
- PUT if-not-exists or overwrite same content hash.
- At-least-once delivery with content-addressed equality.

### Enablement and privacy

| Control | Default | Notes |
|---------|---------|-------|
| `chat_corpus_enabled` per tenant | **off** until ops/product enable | Align with client data-handling |
| Retention TTL | client policy (e.g. 90d–indefinite) | Lifecycle rules on prefix |
| Encryption | SSE-S3 or SSE-KMS per env | No public ACL |
| Redaction | optional strip secrets patterns pre-write | Does not replace client policy |
| Access | training/ops roles only; not tenant browser download by default | Separate export API later |

**Policy doctrine change:** keep L1–L4 ops defaults. Add **L10 Chat corpus** class: full bodies, tenant-partitioned S3, enablement-gated, **not** CloudWatch.

### Relationship to existing stores

| Store | Role after this ships |
|-------|------------------------|
| BFF ChatThreadStore | Temporary UI hydrate only |
| CHAT_STORE_PATH | Optional local durability for UI; not training SoT |
| Relay ring | Live SSE only |
| Agent sessions.db | Model context only |
| **Chat corpus S3** | **SoT for full I/O archive / training** |

## Alternatives

| Approach | Decision |
|----------|----------|
| Persist only in BFF SQLite forever | Reject — not multi-tenant durable ops, not training-friendly |
| Metadata-only interaction_export | Keep for ops; insufficient for training |
| Vault files for chat logs | Reject — pollutes company vault; ACL mismatch |
| Per-user S3 root | Reject as partition; user_id field is enough |
| Guest writes corpus to S3 | Reject — wrong trust boundary |

## Beads

| Id | Title |
|----|--------|
| **lp-gkh** | Epic: Tenant chat corpus S3 |
| lp-gkh.1 | Decision + policy L10 |
| lp-gkh.2 | Turn record schema v1 |
| lp-gkh.3 | Infra bucket/IAM/lifecycle |
| lp-gkh.4 | CorpusWriter + fake ([`@lanyard/chat-corpus`](../../../portal/packages/chat-corpus/)) |
| lp-gkh.5 | BFF capture tee ([`chat-corpus-capture.ts`](../../../portal/packages/bff/src/chat-corpus-capture.ts)) |
| lp-gkh.6 | Tenant enablement fields |
| lp-gkh.7 | Metrics / retry / DLQ ([metrics-retry-dlq.md](./metrics-retry-dlq.md), `@lanyard/chat-corpus`) |
| lp-gkh.8 | Training export CLI (`@lanyard/chat-corpus` list/read + `--fake` dry-run) |
| lp-gkh.9 | Live MockLab proof |
| lp-gkh.10 | Operator enablement + training export runbook ([operator-enablement-training-export-runbook.md](./operator-enablement-training-export-runbook.md)) |

Start ready leaf: `bd show lp-gkh.1`.

## Verification

- Unit: schema validation, key builder, idempotent put.  
- Integration: fake S3 receives turn after simulated chat.  
- Live: one MockLab chat → object exists with input/output; BFF restart does not delete corpus.  
  - Script: `bash deploy/scripts/prove-mocklab-chat-corpus.sh` (`lp-gkh.9`)  
  - Evidence: `artifacts/mocklab/lp-gkh.9/live-proof-evidence-latest.json`  
  - Lab store: `CHAT_CORPUS_BUCKET` + `CHAT_CORPUS_FS_ROOT` (`FsCorpusObjectStore`, same key layout as S3)  

## Principles applied

- **Boundary discipline:** capture at platform edge; guest is not corpus authority.  
- **Model the domain:** turn record as first-class schema.  
- **Make operations idempotent:** turn_id keys.  
- **Separate before serializing:** UI store ≠ corpus store.  
- **Prove it works:** live object existence, not only unit tests.  
- **Encode lessons in structure:** policy L10 + enablement flag, not tribal knowledge.  
