# `@lanyard/chat-corpus`

TypeScript write-boundary for **ChatTurnRecord v1** + **CorpusWriter** + **training export** list/read (L10 tenant chat corpus).

**Contract SoT:** [`contracts/chat-corpus-v1/`](../../../contracts/chat-corpus-v1/)  
**Plan:** [`docs/plans/0011-tenant-chat-corpus/overview.md`](../../../docs/plans/0011-tenant-chat-corpus/overview.md)  
**Beads:** `lp-gkh.2` (schema), `lp-gkh.4` (CorpusWriter), `lp-gkh.5` (BFF capture tee), `lp-gkh.7` (metrics / retry / DLQ), `lp-gkh.8` (training export)

## Usage

```ts
import {
  parseChatTurnRecord,
  safeParseChatTurnRecord,
  contentSha256,
  withContentHashes,
  verifyContentHashes,
  CHAT_TURN_SCHEMA_VERSION,
  FakeCorpusWriter,
  S3CorpusWriter,
  FakeCorpusObjectStore,
  InMemoryCorpusMetrics,
  createCorpusMetricsHooks,
  buildChatCorpusObjectKeyFromRecord,
  listCorpusTurns,
  readCorpusTurn,
  CorpusTrainingExporter,
} from "@lanyard/chat-corpus";

// Build a record with correct content_sha256 fields
const draft = withContentHashes({
  schema_version: CHAT_TURN_SCHEMA_VERSION,
  record_type: "chat_turn",
  tenant_id: "...",
  // ...
  input: { role: "user", content: "hello" },
  output: { role: "assistant", content: "hi" },
  tool_events: [],
  meta: { client: "portal_web" },
});

// Write boundary: reject invalid / wrong-hash records before S3 PUT
const record = parseChatTurnRecord(draft);

// Unit tests / dry-run: in-memory writer
const fake = new FakeCorpusWriter();
await fake.writeTurn(record); // Result — never throws

// Production path: inject object store (no @aws-sdk in this package)
const store = /* live adapter or */ new FakeCorpusObjectStore();
const metrics = new InMemoryCorpusMetrics();
const writer = new S3CorpusWriter({
  bucket: "lanyard-chat-corpus-lab",
  store,
  hooks: createCorpusMetricsHooks(metrics),
  retry: { maxAttempts: 3 }, // transient S3 errors; see metrics-retry-dlq.md
  dlq: { enabled: true }, // optional failed/ prefix poison path
});
const result = await writer.writeTurn(record);
if (!result.ok) {
  // Fail open for chat: log/metric; do not fail the user turn
  // result.attempts / result.dlq_key / result.latency_ms available
}

// MockLab / local live proof (lp-gkh.9): durable FS store survives BFF restart
import { FsCorpusObjectStore } from "@lanyard/chat-corpus";
const fsStore = new FsCorpusObjectStore({ rootDir: "/var/lib/lanyard/chat-corpus" });
const labWriter = new S3CorpusWriter({
  bucket: "lanyard-chat-corpus-lab",
  store: fsStore,
});
```

**BFF env (lab):** `CHAT_CORPUS_BUCKET` + `CHAT_CORPUS_FS_ROOT` → `S3CorpusWriter` over `FsCorpusObjectStore`. Tenant still needs `chat_corpus_enabled=true`. Live proof: `bash deploy/scripts/prove-mocklab-chat-corpus.sh` → `artifacts/mocklab/lp-gkh.9/`.

## S3 key (v1)

```text
tenants/{tenant_id}/chat-corpus/v1/year={YYYY}/month={MM}/day={DD}/thread={thread_id}/turn={turn_id}.json
```

Hive partitions are **UTC** from `created_at`. Same `turn_id` → same key → idempotent PutObject.

## Training export (lp-gkh.8)

Offline / ops path to **list** and **read** turn objects by tenant + inclusive UTC date range for training pipelines.

| Rule | Detail |
|------|--------|
| Auth | **Ops / training-pipeline reader role only** (IAM: `drafts/iam/corpus-reader-policy.json`) |
| Not in v1 | Tenant browser API, customer-admin download, guest roles |
| Secrets | Never pass access keys on the CLI; use instance role / default credential chain in host adapters |

### CLI dry-run (fake S3 — no credentials)

```bash
cd portal

# List expected keys under tenants/{tid}/chat-corpus for a date range
pnpm --filter @lanyard/chat-corpus export:training -- --fake \
  --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode list

# Stream ChatTurnRecord JSONL (one object per line) for the same range
pnpm --filter @lanyard/chat-corpus export:training -- --fake \
  --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode jsonl
```

`--fake` seeds a small in-memory corpus (including an out-of-range day and another tenant) so dry-run **lists only in-range keys for the requested tenant**. No AWS account, env secrets, or tokens are required.

### Programmatic list / read

```ts
import {
  FakeCorpusObjectStore,
  CorpusTrainingExporter,
  listCorpusTurns,
  readCorpusTurn,
} from "@lanyard/chat-corpus";

const store = new FakeCorpusObjectStore(); // or host AWS adapter with listObjects+getObject
const exporter = new CorpusTrainingExporter({
  bucket: "lanyard-chat-corpus-lab",
  store,
});

const listed = await exporter.listTurns({
  tenant_id: "tenant-1",
  from: "2026-08-01",
  to: "2026-08-07",
});
if (listed.ok) {
  for (const { key } of listed.keys) {
    const row = await exporter.readTurn(key);
    // row.record is a validated ChatTurnRecord when row.ok
  }
}

// Or stream for JSONL training batches:
for await (const row of exporter.iterateTurns({
  tenant_id: "tenant-1",
  from: "2026-08-01",
  to: "2026-08-07",
})) {
  if (row.ok) {
    process.stdout.write(`${JSON.stringify(row.record)}\n`);
  }
}
```

Live AWS is **not** bundled here (no `@aws-sdk`). Host ops jobs inject a `CorpusObjectStore` that implements `listObjects` + `getObject` using the **corpus reader** role. Do not grant corpus reader vault paths; do not expose list/get to the Portal browser session.

Full operator enablement + export runbook: [`docs/plans/0011-tenant-chat-corpus/operator-enablement-training-export-runbook.md`](../../../docs/plans/0011-tenant-chat-corpus/operator-enablement-training-export-runbook.md) (`lp-gkh.10`).

## API

| Export | Role |
|--------|------|
| `ChatTurnRecordSchema` | Zod schema (`schema_version` required, const `1`) |
| `parseChatTurnRecord` | Throws on invalid input |
| `safeParseChatTurnRecord` | Zod safe parse |
| `contentSha256` | UTF-8 SHA-256 → 64 lowercase hex |
| `withContentHashes` | Fill `input`/`output` `content_sha256` |
| `verifyContentHashes` | Check digests match bodies |
| `CorpusWriter` | Interface: `writeTurn(record) → Promise<CorpusWriteResult>` |
| `FakeCorpusWriter` | In-memory store for tests |
| `S3CorpusWriter` | PutObject via injected `CorpusObjectStore` |
| `FakeCorpusObjectStore` | In-memory S3 port for unit tests (get/put/list) |
| `FsCorpusObjectStore` | Durable FS S3 port for MockLab live proof (lp-gkh.9); survives process restart |
| `buildChatCorpusObjectKey` / `…FromRecord` | Normative object key builder |
| `buildChatCorpusDayPrefix` / `…DayPrefixesForRange` | UTC day list prefixes for export |
| `listCorpusTurns` | List turn keys by tenant + inclusive date range |
| `readCorpusTurn` | Get + parse one turn JSON object |
| `iterateCorpusTurns` | Async iterable list→get for JSONL export |
| `CorpusTrainingExporter` | Bound bucket+store helper for ops jobs |

### Fail-open contract (writer)

`writeTurn` **never throws** to the caller. Invalid records, key errors, and store failures return `{ ok: false, code, error }`. Callers keep the chat path green and surface drops via metrics / retry / DLQ (`lp-gkh.7`).

Enablement (`chat_corpus_enabled`) is a **caller** concern (`lp-gkh.5` / `lp-gkh.6`) — do not invoke the writer when the tenant flag is off.

Export list/read also return Result objects (`ok: false` on errors) and never throw to the CLI path.

## Metrics, retry, DLQ (lp-gkh.7)

| Concern | Default | Detail |
|---------|---------|--------|
| Metrics | hooks / `InMemoryCorpusMetrics` | `chat_corpus_write_success`, `_failure`, `_latency`, `_bytes` (+ `_retry`, `_dlq`) |
| Retry | 3 attempts, 50ms base, 1000ms cap | Transient S3 only (`SlowDown`, timeouts, network…); not `AccessDenied` |
| DLQ | **off** until `dlq: { enabled: true }` | S3 `…/chat-corpus/v1/failed/year=…/turn={id}.json`; SQS deferred |

Full policy + dashboard notes: [`docs/plans/0011-tenant-chat-corpus/metrics-retry-dlq.md`](../../../docs/plans/0011-tenant-chat-corpus/metrics-retry-dlq.md).

### API (resilience)

| Export | Role |
|--------|------|
| `InMemoryCorpusMetrics` | Test / dry-run counters (success, failure, latency, bytes, retry, dlq) |
| `createCorpusMetricsHooks` | Fan-out to collector + optional host sink |
| `CORPUS_METRIC_WRITE_*` | Stable metric name constants |
| `normalizeCorpusRetryPolicy` / `isTransientCorpusStoreError` | Retry policy helpers |
| `buildChatCorpusDlqObjectKey` / `enqueueCorpusDlq` | `failed/` prefix DLQ |
| `S3CorpusWriter` options `retry` / `dlq` | Wire resilience on the S3 writer |

## Tests

```bash
pnpm test
# includes CLI dry-run: fake S3 lists expected keys (lp-gkh.8)
```
