/**
 * Corpus write metrics (lp-gkh.7).
 *
 * Stable metric names for BFF / ops dashboards. Emit via
 * {@link InMemoryCorpusMetrics} in tests or wire `onMetric` to Prometheus /
 * CloudWatch in the host process.
 *
 * Dashboard notes: docs/plans/0011-tenant-chat-corpus/metrics-retry-dlq.md
 */

import type { CorpusWriteResult } from "./writer.js";

/** Counter: successful writes (written + idempotent_skip). */
export const CORPUS_METRIC_WRITE_SUCCESS = "chat_corpus_write_success";

/** Counter: failed writes after retries (and before/without DLQ success). */
export const CORPUS_METRIC_WRITE_FAILURE = "chat_corpus_write_failure";

/**
 * Histogram / timing sample: end-to-end writeTurn latency in milliseconds
 * (includes retries). Value is the latency; labels may include status/code.
 */
export const CORPUS_METRIC_WRITE_LATENCY = "chat_corpus_write_latency";

/**
 * Counter / distribution: UTF-8 body bytes of the serialized turn (or 0 on
 * invalid record). Emitted on every attempt outcome (success or failure).
 */
export const CORPUS_METRIC_WRITE_BYTES = "chat_corpus_write_bytes";

/** Counter: individual retry attempts after the first failure. */
export const CORPUS_METRIC_WRITE_RETRY = "chat_corpus_write_retry";

/** Counter: poison / exhausted messages enqueued to DLQ (`failed/` prefix). */
export const CORPUS_METRIC_WRITE_DLQ = "chat_corpus_write_dlq";

/** All stable metric names (for dashboards / allow-lists). */
export const CORPUS_METRIC_NAMES = [
  CORPUS_METRIC_WRITE_SUCCESS,
  CORPUS_METRIC_WRITE_FAILURE,
  CORPUS_METRIC_WRITE_LATENCY,
  CORPUS_METRIC_WRITE_BYTES,
  CORPUS_METRIC_WRITE_RETRY,
  CORPUS_METRIC_WRITE_DLQ,
] as const;

export type CorpusMetricName = (typeof CORPUS_METRIC_NAMES)[number];

/**
 * Rich write-path event for metrics hooks (lp-gkh.7).
 * Supplements the legacy `onWriteResult(result)` hook.
 */
export type CorpusWriteMetricsEvent = {
  result: CorpusWriteResult;
  /** Wall-clock ms for the full writeTurn (including retries). */
  latency_ms: number;
  /** Serialized body bytes (0 when record never serialized). */
  bytes: number;
  /** 1-based attempts used. */
  attempts: number;
  /** True when attempts > 1. */
  retried: boolean;
  /** Present when a DLQ enqueue was attempted. */
  dlq?: {
    ok: boolean;
    key?: string;
    error?: string;
  };
};

export type CorpusMetricLabels = Record<string, string>;

/**
 * Host metric sink. `value` is used for latency (ms) and bytes;
 * counters may omit value (treated as +1).
 */
export type CorpusMetricSink = (
  name: CorpusMetricName | string,
  value?: number,
  labels?: CorpusMetricLabels,
) => void;

export type CorpusMetricsSnapshot = {
  write_success: number;
  write_failure: number;
  /** Sum of latency samples (ms). */
  write_latency_ms_sum: number;
  /** Number of latency samples. */
  write_latency_ms_count: number;
  /** Total body bytes observed across outcomes. */
  write_bytes: number;
  write_retry: number;
  write_dlq: number;
  last_latency_ms?: number;
  last_bytes?: number;
  last_status?: string;
  last_code?: string;
};

/**
 * In-memory metrics collector for unit tests and local dry-runs.
 * Also usable as a {@link CorpusMetricSink} / writer hook target.
 */
export class InMemoryCorpusMetrics {
  private readonly snap: CorpusMetricsSnapshot = {
    write_success: 0,
    write_failure: 0,
    write_latency_ms_sum: 0,
    write_latency_ms_count: 0,
    write_bytes: 0,
    write_retry: 0,
    write_dlq: 0,
  };

  /** Observe a full write event (preferred). */
  observe(event: CorpusWriteMetricsEvent): void {
    const latency = Math.max(0, Math.round(event.latency_ms));
    const bytes = Math.max(0, Math.round(event.bytes));
    this.snap.write_latency_ms_sum += latency;
    this.snap.write_latency_ms_count += 1;
    this.snap.write_bytes += bytes;
    this.snap.last_latency_ms = latency;
    this.snap.last_bytes = bytes;

    if (event.result.ok) {
      this.snap.write_success += 1;
      this.snap.last_status = event.result.status;
      this.snap.last_code = undefined;
    } else {
      this.snap.write_failure += 1;
      this.snap.last_status = undefined;
      this.snap.last_code = event.result.code;
    }

    if (event.retried && event.attempts > 1) {
      // Count retries as (attempts - 1).
      this.snap.write_retry += event.attempts - 1;
    }

    if (event.dlq) {
      this.snap.write_dlq += 1;
    }
  }

  /**
   * Name/value sink compatible with BFF-style `onMetric`.
   * Counters without value increment by 1; latency/bytes use value.
   */
  record(
    name: string,
    value?: number,
    _labels?: CorpusMetricLabels,
  ): void {
    switch (name) {
      case CORPUS_METRIC_WRITE_SUCCESS:
        this.snap.write_success += value === undefined ? 1 : value;
        break;
      case CORPUS_METRIC_WRITE_FAILURE:
        this.snap.write_failure += value === undefined ? 1 : value;
        break;
      case CORPUS_METRIC_WRITE_LATENCY: {
        const v = value === undefined ? 0 : Math.max(0, value);
        this.snap.write_latency_ms_sum += v;
        this.snap.write_latency_ms_count += 1;
        this.snap.last_latency_ms = v;
        break;
      }
      case CORPUS_METRIC_WRITE_BYTES: {
        const v = value === undefined ? 0 : Math.max(0, value);
        this.snap.write_bytes += v;
        this.snap.last_bytes = v;
        break;
      }
      case CORPUS_METRIC_WRITE_RETRY:
        this.snap.write_retry += value === undefined ? 1 : value;
        break;
      case CORPUS_METRIC_WRITE_DLQ:
        this.snap.write_dlq += value === undefined ? 1 : value;
        break;
      default:
        break;
    }
  }

  /** Average latency in ms, or 0 when no samples. */
  averageLatencyMs(): number {
    if (this.snap.write_latency_ms_count === 0) {
      return 0;
    }
    return this.snap.write_latency_ms_sum / this.snap.write_latency_ms_count;
  }

  snapshot(): CorpusMetricsSnapshot {
    return { ...this.snap };
  }

  reset(): void {
    this.snap.write_success = 0;
    this.snap.write_failure = 0;
    this.snap.write_latency_ms_sum = 0;
    this.snap.write_latency_ms_count = 0;
    this.snap.write_bytes = 0;
    this.snap.write_retry = 0;
    this.snap.write_dlq = 0;
    delete this.snap.last_latency_ms;
    delete this.snap.last_bytes;
    delete this.snap.last_status;
    delete this.snap.last_code;
  }
}

/**
 * Build writer hooks that fan out to an in-memory collector and optional sink.
 */
export function createCorpusMetricsHooks(
  metrics: InMemoryCorpusMetrics,
  sink?: CorpusMetricSink,
): {
  onWriteEvent: (event: CorpusWriteMetricsEvent) => void;
} {
  return {
    onWriteEvent(event: CorpusWriteMetricsEvent): void {
      metrics.observe(event);
      if (!sink) {
        return;
      }
      try {
        const labels: CorpusMetricLabels = {};
        if (event.result.ok) {
          labels.status = event.result.status;
          sink(CORPUS_METRIC_WRITE_SUCCESS, 1, labels);
        } else {
          labels.code = event.result.code;
          sink(CORPUS_METRIC_WRITE_FAILURE, 1, labels);
        }
        sink(CORPUS_METRIC_WRITE_LATENCY, event.latency_ms, labels);
        sink(CORPUS_METRIC_WRITE_BYTES, event.bytes, labels);
        if (event.retried && event.attempts > 1) {
          sink(CORPUS_METRIC_WRITE_RETRY, event.attempts - 1, labels);
        }
        if (event.dlq) {
          sink(
            CORPUS_METRIC_WRITE_DLQ,
            1,
            event.dlq.ok
              ? { ...labels, dlq: "ok" }
              : { ...labels, dlq: "error" },
          );
        }
      } catch {
        // Metrics must never break the write path.
      }
    },
  };
}
