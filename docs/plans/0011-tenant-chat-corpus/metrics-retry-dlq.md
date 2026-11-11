# Metrics, retry, and DLQ for corpus writes

**Bead:** `lp-gkh.7`  
**Epic:** `lp-gkh` — Tenant chat corpus (S3)  
**Package:** [`portal/packages/chat-corpus`](../../../portal/packages/chat-corpus/) (`@lanyard/chat-corpus`)  
**Depends on:** `lp-gkh.4` (CorpusWriter), `lp-gkh.5` (BFF capture tee)  
**Date:** 2026-08-13

## Status

| Item | State |
|------|--------|
| Metric names + in-memory collector | **Shipped** — `src/metrics.ts` |
| Retry with exponential backoff | **Shipped** — `src/retry.ts` + `S3CorpusWriter` |
| DLQ `failed/` prefix path | **Shipped** — `src/dlq.ts` (opt-in) |
| SQS / redrive consumer | **Deferred** — see below |
| Dashboard notes for ops | **This document** |

## Acceptance (`lp-gkh.7`)

| Criterion | Evidence |
|-----------|----------|
| Metrics emitted in tests or fake | `test/corpus-resilience.test.ts` + `InMemoryCorpusMetrics` |
| Retry policy documented | § Retry policy below + code defaults |
| DLQ path or explicit defer note | § DLQ — `failed/` path live; SQS deferred |

## Principles

- **Fail open for chat:** user turn / SSE never blocked by corpus failures.
- **Fail closed for silent drop:** every outcome increments success **or** failure metrics; retries and optional DLQ make drops recoverable.
- **Idempotent keys:** retries of the same `turn_id` remain safe (`written` / `idempotent_skip`).

## Metric names (stable)

| Name | Type | Meaning |
|------|------|---------|
| `chat_corpus_write_success` | counter | `writeTurn` returned `ok: true` (`written` or `idempotent_skip`) |
| `chat_corpus_write_failure` | counter | `writeTurn` returned `ok: false` after retries |
| `chat_corpus_write_latency` | timing (ms) | End-to-end `writeTurn` wall time including retries |
| `chat_corpus_write_bytes` | counter / size | UTF-8 byte length of serialized turn body (0 if never serialized) |
| `chat_corpus_write_retry` | counter | Extra attempts after the first (`attempts - 1`) |
| `chat_corpus_write_dlq` | counter | DLQ enqueue attempted (ok or error — label `dlq=ok\|error`) |

BFF capture still emits `chat_corpus_write_failed` on the tee path (`lp-gkh.5`) when the Result is not ok or the write times out. Package-level metrics above are the writer SoT for success/latency/bytes; hosts may dual-emit.

### Labels (recommended)

| Label | Values |
|-------|--------|
| `status` | `written` \| `idempotent_skip` (success only) |
| `code` | `S3_PUT_FAILED`, `S3_GET_FAILED`, `INVALID_RECORD`, … (failure only) |
| `tenant_id` | optional high-cardinality — prefer sampled dashboards |
| `dlq` | `ok` \| `error` on DLQ counter |

### Code API

```ts
import {
  S3CorpusWriter,
  FakeCorpusObjectStore,
  InMemoryCorpusMetrics,
  createCorpusMetricsHooks,
  CORPUS_METRIC_WRITE_SUCCESS,
} from "@lanyard/chat-corpus";

const metrics = new InMemoryCorpusMetrics();
const hooks = createCorpusMetricsHooks(metrics, (name, value, labels) => {
  // Wire to Prometheus / CloudWatch / OpenTelemetry in the host.
});

const writer = new S3CorpusWriter({
  bucket: process.env.LANYARD_CHAT_CORPUS_BUCKET!,
  store: /* AWS adapter */,
  hooks,
  retry: { maxAttempts: 3 },
  dlq: { enabled: true },
});
```

Unit tests use `InMemoryCorpusMetrics.snapshot()` — no network, no credentials.

## Retry policy

| Parameter | Default | Cap / notes |
|-----------|---------|-------------|
| `maxAttempts` | **3** | Hard max 10 in normalizer |
| `baseDelayMs` | **50** | First backoff after attempt 1 fails |
| `maxDelayMs` | **1000** | Exponential: 50 → 100 → 200 … capped |
| Formula | `min(base * 2^attempt, maxDelay)` | Same spirit as BFF Redis G5 |

### What is retried

| Class | Examples | Retry? |
|-------|----------|--------|
| **Transient store** | `SlowDown`, `ServiceUnavailable`, `InternalError`, timeouts, `ECONNRESET`, `network *`, 429/500/503 | **Yes** |
| **Permanent store** | `AccessDenied`, `NoSuchBucket`, `InvalidAccessKey`, 403 Forbidden | **No** (fail fast) |
| **Client / schema** | `INVALID_RECORD`, key path errors | **No** |
| **Unknown store error** | Unrecognized message | **Yes** (prefer retry over silent drop) |

`S3CorpusWriter` retries **getObject** and **putObject** independently. Injectable `sleep` supports deterministic unit tests.

### Chat path timeout interaction

BFF capture uses a **5s** fire-and-forget timeout around `writeTurn` (`DEFAULT_CHAT_CORPUS_WRITE_TIMEOUT_MS`). With default backoff (≤ ~150ms extra across two sleeps), three attempts fit comfortably inside 5s for typical S3 RTTs. If hosts raise `maxAttempts` or delays, raise the capture timeout accordingly or fail open with `chat_corpus_write_failed{reason=timeout}`.

## DLQ

### v1 path (shipped): S3 `failed/` prefix

After retries are exhausted (or on permanent store failure when DLQ is enabled), the writer may put a **DLQ envelope** (not a training turn):

```text
s3://{bucket}/tenants/{tenant_id}/chat-corpus/v1/failed/year={YYYY}/month={MM}/day={DD}/turn={turn_id}.json
```

| Property | Rule |
|----------|------|
| Opt-in | `dlq: { enabled: true }` on `S3CorpusWriter` (default **off**) |
| IAM | Covered by existing writer PutObject on `tenants/*/chat-corpus/v1/*` |
| Training export | **Excluded** — key has no `thread=` segment; `isChatCorpusTurnObjectKey` is false |
| Envelope | `record_type: "chat_turn_dlq"`, `code`, `error`, `attempts`, `original_key`, optional full `record` for redrive |
| Invalid records | Envelope may include truncated `raw_preview` when schema parse fails |

### Deferred: SQS (or EventBridge) DLQ

| Item | Status |
|------|--------|
| Dedicated SQS queue + DLQ redrive policy | **Deferred** — not required for `lp-gkh.7` acceptance |
| Lambda / worker to redrive `failed/` → primary key | **Follow-on** (ops / `lp-gkh.10` runbook territory) |
| Cross-account training consumer of DLQ | **Out of scope** for v1 |

**Rationale:** `failed/` prefix needs no new infra, stays under existing writer IAM, and is listable by ops with the corpus reader role. SQS adds operational surface (KMS, alarms, redrive) without unblocking metrics/retry. Revisit when redrive volume or multi-writer coordination requires a queue.

## Dashboard notes (ops)

### Golden signals

1. **Success rate** — `write_success / (write_success + write_failure)` over 5m. Alert if &lt; 99% for enabled tenants.
2. **Failure rate by code** — stack `write_failure` by `code` (`S3_PUT_FAILED`, `S3_GET_FAILED`, `INVALID_RECORD`, timeout from BFF).
3. **Latency p50/p95** — `write_latency` histogram. Watch for saturation (retries show as higher latency + `write_retry` spikes).
4. **Bytes** — `write_bytes` rate; sudden drops with steady chat traffic imply enablement off or capture not finalizing.
5. **DLQ depth** — count objects under `…/chat-corpus/v1/failed/` (S3 Inventory or periodic List). Non-zero warrants investigation; growing depth = poison or outage.

### Suggested CloudWatch / Grafana panels

| Panel | Query idea |
|-------|------------|
| Write success vs failure | `sum(rate(chat_corpus_write_success[5m]))` vs failure |
| Retry pressure | `sum(rate(chat_corpus_write_retry[5m]))` |
| Latency | heatmap / p95 of `chat_corpus_write_latency` |
| DLQ enqueues | `sum(rate(chat_corpus_write_dlq[5m]))` |
| BFF tee failures | existing `chat_corpus_write_failed` from capture |

### Alert sketches

| Condition | Severity | Action |
|-----------|----------|--------|
| failure rate &gt; 1% for 15m while corpus enabled | page-ish | Check S3/IAM/KMS; inspect `failed/` prefix |
| `AccessDenied` / `NoSuchBucket` any volume | high | Misconfig — do not burn retries |
| DLQ list count rising 1h | medium | Redrive or fix poison schema |
| latency p95 &gt; 2s | medium | S3 throttle / network; scale or backoff |

### Enablement reminder

Metrics alone do not write corpus. Tenant flag `chat_corpus_enabled` must be true (`lp-gkh.6`). When flag is off, expect **no** writer metrics (capture skips before put).

## Verification

```bash
cd portal/packages/chat-corpus && pnpm test
# includes test/corpus-resilience.test.ts (metrics, retry, DLQ)
```

## Related

- Writer interface: `lp-gkh.4` / `src/writer.ts`
- BFF capture tee: `lp-gkh.5` / `packages/bff/src/chat-corpus-capture.ts`
- Infra IAM: `lp-gkh.3` / `deploy/modules/chat-corpus-infra/`
- Ops enablement: [ops-enablement-runbook.md](./ops-enablement-runbook.md)
- Overview: [overview.md](./overview.md)
