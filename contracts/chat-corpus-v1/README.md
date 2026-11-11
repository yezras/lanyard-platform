# Chat corpus v1 — ChatTurnRecord

**Plan:** [docs/plans/0011-tenant-chat-corpus/overview.md](../../docs/plans/0011-tenant-chat-corpus/overview.md)  
**Policy:** L10 Chat corpus — [decision-l10-chat-corpus-policy.md](../../docs/plans/0011-tenant-chat-corpus/decision-l10-chat-corpus-policy.md)  
**Beads:** `lp-gkh.2` (schema); `lp-gkh.4` (CorpusWriter interface + fake + S3 put); `lp-gkh.7` (metrics / retry / DLQ); `lp-gkh.8` (training export list/read)

## Purpose

Versioned JSON shape for a **single chat turn** archived to tenant-partitioned S3:

- Full user **input** and assistant **output** bodies
- **content_sha256** integrity digests on bodies
- Structured **tool_events**
- Operational **meta** (request id, duration, client, sandbox)

This is the durable training / behavior-analysis SoT. It is **not** the Portal UI hydrate store (BFF `ChatThreadStore` remains temporary).

## Files

| Path | Role |
|------|------|
| [`chat-turn-record.schema.json`](./chat-turn-record.schema.json) | JSON Schema (Draft 2020-12) for ChatTurnRecord v1 |
| [`examples/chat-turn.minimal.json`](./examples/chat-turn.minimal.json) | Minimal valid record (no tools) |
| [`examples/chat-turn.with-tools.json`](./examples/chat-turn.with-tools.json) | Record with tool_events + optional fields |

## Required fields

`schema_version` (**const `1`**), `record_type` (`chat_turn`), `tenant_id`, `user_id`, `instance_id`, `thread_id`, `turn_id`, `created_at`, `model`, `input`, `output`, `tool_events`, `meta`.

`input` / `output` each require `role`, `content`, and `content_sha256` (64 lowercase hex chars, SHA-256 of UTF-8 `content`).

## TypeScript write boundary

Runtime parse, hash helpers, CorpusWriter, and training export for BFF / platform capture / ops:

```text
portal/packages/chat-corpus  (@lanyard/chat-corpus)
```

```ts
import {
  parseChatTurnRecord,
  contentSha256,
  withContentHashes,
  FakeCorpusWriter,
  S3CorpusWriter,
  buildChatCorpusObjectKeyFromRecord,
  listCorpusTurns,
  CorpusTrainingExporter,
} from "@lanyard/chat-corpus";

const record = parseChatTurnRecord(raw); // throws ZodError on invalid
// CorpusWriter.writeTurn never throws — returns Result (fail-open for chat)
// Training export: listCorpusTurns / CorpusTrainingExporter (ops reader role only)
```

Zod validation is the **write boundary**: reject bad records before S3 PUT.

CLI dry-run (no secrets): `pnpm --filter @lanyard/chat-corpus export:training -- --fake --tenant tenant-1 --from 2026-08-06 --to 2026-08-08`

## S3 object layout (v1)

```text
s3://{bucket}/tenants/{tenant_id}/chat-corpus/v1/year=…/month=…/day=…/thread={thread_id}/turn={turn_id}.json
```

Object body = one ChatTurnRecord. Idempotent key = `turn_id`.

## Validation

```bash
# Offline contract examples + negative cases
python3 scripts/validate-chat-turn-record.py

# TS unit tests (good/bad records, hash integrity)
cd portal/packages/chat-corpus && pnpm test
```

## Non-goals (v1)

- UI hydrate from S3
- Guest/sandbox as corpus writer
- Per-user S3 partition roots (`user_id` is a field only)
- Streaming partial turns (v1 assumes input+output known)
