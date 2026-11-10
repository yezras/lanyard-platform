/**
 * BFF L10 chat corpus capture tee (lp-gkh.5 / plan 0011).
 *
 * Flow (portal-c0q.1 SSE path):
 * 1. After user message is accepted on POST …/messages → buffer input
 * 2. When durable assistant outbound is known (SSE tee of `message_send`) →
 *    assemble ChatTurnRecord and fire-and-forget CorpusWriter.writeTurn
 *
 * Contracts:
 * - Fail **open for chat**: never throw into HTTP / SSE paths; writer failures
 *   and unexpected throws only bump `chat_corpus_write_failed`.
 * - Fail **closed for enablement**: re-check `chat_corpus_enabled` before put;
 *   default off (no full-body writes).
 * - Identity fields on every record: tenant_id, user_id, thread_id, instance_id.
 */

import {
  withContentHashes,
  type CorpusWriteResult,
  type CorpusWriter,
  type ModelRef,
  type ToolEvent,
} from "@lanyard/chat-corpus";
import { createLogger } from "@lanyard/shared";

import { shouldWriteChatCorpus } from "./chat-corpus.js";

const log = createLogger({ service: "bff" });

/** Default write timeout — corpus must not hang the SSE tee. */
export const DEFAULT_CHAT_CORPUS_WRITE_TIMEOUT_MS = 5_000;

/** Bound pending turns per thread (memory safety if assistant never replies). */
const MAX_PENDING_PER_THREAD = 32;

/** Metric name for failed / timed-out corpus writes (lp-gkh.5 / lp-gkh.7). */
export const CHAT_CORPUS_WRITE_FAILED_METRIC = "chat_corpus_write_failed";

export type BufferedUserTurn = {
  turn_id: string;
  tenant_id: string;
  user_id: string;
  instance_id: string;
  thread_id: string;
  /** Hermes/relay session key when known. */
  session_key?: string;
  /** RFC3339 when the user message was accepted. */
  created_at: string;
  content: string;
  request_id?: string;
  /** Progressive assistant body (message_edit / non-final message_send). */
  assistant_content?: string;
  assistant_model?: string;
  assistant_metadata?: Record<string, unknown>;
  tool_events: ToolEvent[];
};

export type ChatCorpusCaptureMetricsSnapshot = {
  write_ok: number;
  /** Failures including timeout, writer Result.ok=false, and thrown errors. */
  write_failed: number;
  write_skipped_disabled: number;
  write_skipped_no_pending: number;
  write_timeout: number;
  buffered: number;
  completed: number;
};

export type ChatCorpusCaptureOptions = {
  /**
   * Injected writer (FakeCorpusWriter in tests; S3CorpusWriter in prod).
   * When null/undefined, capture is a no-op.
   */
  writer?: CorpusWriter | null;
  /**
   * Per-tenant enablement gate. Defaults to {@link shouldWriteChatCorpus}.
   * Tests inject a constant true/false.
   */
  isEnabled?: (tenantId: string) => boolean | Promise<boolean>;
  /** Max wait for writeTurn (default 5s). */
  writeTimeoutMs?: number;
  now?: () => Date;
  /** Structured metric hook (name is stable: chat_corpus_write_failed). */
  onMetric?: (name: string, labels?: Record<string, string>) => void;
};

export type DurableOutboundForCorpus = {
  type: string;
  chat_id?: string;
  message_id?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  model?: string;
  tool_label?: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: string;
  tool_target?: string;
  duration?: string;
  error_message?: string;
  errorMessage?: string;
  created_at?: string;
};

/**
 * Parse a ModelRef from outbound model string / metadata.
 * Schema requires provider+name; unknown is used when host omits stamps.
 */
export function modelRefFromOutbound(
  model?: string,
  metadata?: Record<string, unknown>,
): ModelRef {
  const metaModel = metadata?.model;
  if (metaModel && typeof metaModel === "object" && !Array.isArray(metaModel)) {
    const m = metaModel as Record<string, unknown>;
    const provider =
      typeof m.provider === "string" && m.provider.trim()
        ? m.provider.trim()
        : undefined;
    const name =
      typeof m.name === "string" && m.name.trim()
        ? m.name.trim()
        : typeof m.model === "string" && m.model.trim()
          ? m.model.trim()
          : undefined;
    if (provider && name) {
      const apiId =
        typeof m.api_id === "string" && m.api_id.trim()
          ? m.api_id.trim()
          : undefined;
      return apiId
        ? { provider, name, api_id: apiId }
        : { provider, name };
    }
    if (name) {
      return { provider: "unknown", name };
    }
  }
  if (typeof model === "string" && model.trim()) {
    const trimmed = model.trim();
    const slash = trimmed.indexOf("/");
    if (slash > 0 && slash < trimmed.length - 1) {
      return {
        provider: trimmed.slice(0, slash),
        name: trimmed.slice(slash + 1),
      };
    }
    return { provider: "unknown", name: trimmed };
  }
  return { provider: "unknown", name: "unknown" };
}

/**
 * Whether an assistant message event is non-final (progressive stream).
 * Aligns with portal web `isNonFinalAssistantEvent` (message_edit open;
 * message_send final unless metadata marks streaming / finalize:false).
 */
export function isNonFinalAssistantOutbound(
  event: DurableOutboundForCorpus,
): boolean {
  if (event.type === "message_edit") {
    return true;
  }
  if (event.type !== "message_send") {
    return false;
  }
  const meta = event.metadata;
  if (!meta || typeof meta !== "object") {
    return false;
  }
  if (meta.finalize === false || meta.final === false) {
    return true;
  }
  if (meta.streaming === true) {
    return true;
  }
  return false;
}

function parseDurationMs(raw: string | undefined): number | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/.exec(trimmed);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (m[2] === "s") return Math.round(n * 1000);
  return Math.round(n);
}

function toolEventFromOutbound(
  event: DurableOutboundForCorpus,
  nowIso: string,
): ToolEvent | null {
  const toolCallId =
    (typeof event.tool_call_id === "string" && event.tool_call_id.trim()) ||
    (typeof event.message_id === "string" && event.message_id.trim()) ||
    "";
  const toolName =
    (typeof event.tool_name === "string" && event.tool_name.trim()) ||
    (typeof event.tool_label === "string" && event.tool_label.trim()) ||
    "";
  if (!toolCallId || !toolName) {
    return null;
  }

  const rawStatus = (event.tool_status ?? "").toLowerCase();
  let status: ToolEvent["status"] = "running";
  if (
    rawStatus === "complete" ||
    rawStatus === "completed" ||
    rawStatus === "success" ||
    rawStatus === "done"
  ) {
    status = "complete";
  } else if (rawStatus === "error" || rawStatus === "failed") {
    status = "error";
  } else if (rawStatus === "pending") {
    status = "pending";
  } else if (rawStatus === "running") {
    status = "running";
  }

  const durationMs = parseDurationMs(event.duration);
  const err =
    event.error_message ??
    event.errorMessage ??
    (typeof event.metadata?.error_message === "string"
      ? event.metadata.error_message
      : undefined);

  const te: ToolEvent = {
    tool_call_id: toolCallId,
    tool_name: toolName,
    status,
  };
  if (typeof event.tool_target === "string" && event.tool_target) {
    te.target = event.tool_target;
  }
  if (durationMs !== undefined) {
    te.duration_ms = durationMs;
  }
  if (typeof err === "string" && err) {
    te.error_message = err;
  }
  if (status === "complete" || status === "error") {
    te.finished_at = event.created_at ?? nowIso;
  } else {
    te.started_at = event.created_at ?? nowIso;
  }
  return te;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * In-process capture coordinator. Safe to call from chat HTTP + SSE tee;
 * all public methods are fail-open (never throw).
 */
export class ChatCorpusCapture {
  private readonly writer: CorpusWriter | null;
  private readonly isEnabled: (tenantId: string) => boolean | Promise<boolean>;
  private readonly writeTimeoutMs: number;
  private readonly now: () => Date;
  private readonly onMetric?: (
    name: string,
    labels?: Record<string, string>,
  ) => void;
  /** thread_id → FIFO of buffered user turns awaiting assistant finalize. */
  private readonly pending = new Map<string, BufferedUserTurn[]>();
  private readonly metrics: ChatCorpusCaptureMetricsSnapshot = {
    write_ok: 0,
    write_failed: 0,
    write_skipped_disabled: 0,
    write_skipped_no_pending: 0,
    write_timeout: 0,
    buffered: 0,
    completed: 0,
  };

  constructor(options: ChatCorpusCaptureOptions = {}) {
    this.writer = options.writer ?? null;
    this.isEnabled =
      options.isEnabled ??
      ((tenantId: string) => shouldWriteChatCorpus(tenantId));
    this.writeTimeoutMs =
      options.writeTimeoutMs ?? DEFAULT_CHAT_CORPUS_WRITE_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.onMetric = options.onMetric;
  }

  /** True when a writer is configured (capture path active). */
  isActive(): boolean {
    return this.writer !== null;
  }

  metricsSnapshot(): ChatCorpusCaptureMetricsSnapshot {
    return { ...this.metrics };
  }

  /** Test helper: pending turn count for a thread. */
  pendingCount(threadId: string): number {
    return this.pending.get(threadId)?.length ?? 0;
  }

  /** Test helper: clear pending + metrics. */
  reset(): void {
    this.pending.clear();
    this.metrics.write_ok = 0;
    this.metrics.write_failed = 0;
    this.metrics.write_skipped_disabled = 0;
    this.metrics.write_skipped_no_pending = 0;
    this.metrics.write_timeout = 0;
    this.metrics.buffered = 0;
    this.metrics.completed = 0;
  }

  /**
   * Buffer user input after POST …/messages succeeds.
   * No-op without a writer. Never throws.
   */
  bufferUserTurn(input: Omit<BufferedUserTurn, "tool_events"> & {
    tool_events?: ToolEvent[];
  }): void {
    try {
      if (!this.writer) {
        return;
      }
      if (!input.turn_id?.trim() || !input.tenant_id?.trim()) {
        return;
      }
      if (!input.thread_id?.trim() || !input.user_id?.trim()) {
        return;
      }
      if (!input.instance_id?.trim()) {
        return;
      }

      const turn: BufferedUserTurn = {
        turn_id: input.turn_id,
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        instance_id: input.instance_id,
        thread_id: input.thread_id,
        created_at: input.created_at || this.now().toISOString(),
        content: input.content ?? "",
        tool_events: input.tool_events ? [...input.tool_events] : [],
      };
      if (input.session_key) turn.session_key = input.session_key;
      if (input.request_id) turn.request_id = input.request_id;

      const queue = this.pending.get(turn.thread_id) ?? [];
      queue.push(turn);
      while (queue.length > MAX_PENDING_PER_THREAD) {
        queue.shift();
      }
      this.pending.set(turn.thread_id, queue);
      this.metrics.buffered += 1;
    } catch (err) {
      log.warn("chat corpus buffer failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Observe a durable outbound event from the SSE tee (portal-c0q.1).
   * Finalizing `message_send` assembles + fire-and-forget writes.
   * Never throws; never blocks the SSE proxy beyond scheduling the write.
   */
  onDurableOutbound(
    threadId: string,
    event: DurableOutboundForCorpus,
  ): void {
    try {
      if (!this.writer) {
        return;
      }
      const queue = this.pending.get(threadId);
      if (!queue || queue.length === 0) {
        // No matching user turn — common for late/reconnect frames.
        if (
          event.type === "message_send" &&
          !isNonFinalAssistantOutbound(event)
        ) {
          this.metrics.write_skipped_no_pending += 1;
        }
        return;
      }

      const head = queue[0]!;
      const nowIso = this.now().toISOString();

      if (event.type === "tool_progress") {
        const te = toolEventFromOutbound(event, nowIso);
        if (te) {
          const idx = head.tool_events.findIndex(
            (t) => t.tool_call_id === te.tool_call_id,
          );
          if (idx >= 0) {
            head.tool_events[idx] = { ...head.tool_events[idx], ...te };
          } else {
            head.tool_events.push(te);
          }
        }
        return;
      }

      if (event.type === "message_edit" || event.type === "message_send") {
        if (typeof event.content === "string") {
          head.assistant_content = event.content;
        }
        if (typeof event.model === "string" && event.model.trim()) {
          head.assistant_model = event.model.trim();
        }
        if (event.metadata && typeof event.metadata === "object") {
          head.assistant_metadata = event.metadata;
        }

        if (isNonFinalAssistantOutbound(event)) {
          // Progressive stream — keep buffering until final message_send.
          return;
        }

        if (event.type === "message_send") {
          // Finalize: dequeue and write asynchronously.
          queue.shift();
          if (queue.length === 0) {
            this.pending.delete(threadId);
          }
          this.metrics.completed += 1;
          void this.fireWrite(head, event, nowIso);
        }
      }
    } catch (err) {
      log.warn("chat corpus outbound observe failed", {
        thread_id: threadId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.recordWriteFailed("observe_error");
    }
  }

  private recordWriteFailed(reason: string): void {
    this.metrics.write_failed += 1;
    try {
      this.onMetric?.(CHAT_CORPUS_WRITE_FAILED_METRIC, { reason });
    } catch {
      // metrics hooks must not break capture
    }
  }

  private async fireWrite(
    pending: BufferedUserTurn,
    event: DurableOutboundForCorpus,
    completedAt: string,
  ): Promise<void> {
    const writer = this.writer;
    if (!writer) {
      return;
    }

    try {
      let enabled = false;
      try {
        enabled = (await this.isEnabled(pending.tenant_id)) === true;
      } catch {
        enabled = false;
      }
      if (!enabled) {
        this.metrics.write_skipped_disabled += 1;
        return;
      }

      const outputContent =
        typeof event.content === "string"
          ? event.content
          : (pending.assistant_content ?? "");
      const model = modelRefFromOutbound(
        event.model ?? pending.assistant_model,
        event.metadata ?? pending.assistant_metadata,
      );

      const createdMs = Date.parse(pending.created_at);
      const completedMs = Date.parse(completedAt);
      const durationMs =
        Number.isFinite(createdMs) && Number.isFinite(completedMs)
          ? Math.max(0, Math.round(completedMs - createdMs))
          : undefined;

      const meta: Record<string, unknown> = {
        client: "portal_web",
      };
      if (pending.request_id) meta.request_id = pending.request_id;
      if (durationMs !== undefined) meta.duration_ms = durationMs;

      const draft = {
        schema_version: 1 as const,
        record_type: "chat_turn" as const,
        tenant_id: pending.tenant_id,
        user_id: pending.user_id,
        instance_id: pending.instance_id,
        thread_id: pending.thread_id,
        turn_id: pending.turn_id,
        created_at: pending.created_at,
        completed_at: completedAt,
        model,
        input: {
          role: "user" as const,
          content: pending.content,
        },
        output: {
          role: "assistant" as const,
          content: outputContent,
          finish_reason: "stop",
        },
        tool_events: pending.tool_events,
        meta,
        ...(pending.session_key
          ? { session_key: pending.session_key }
          : {}),
      };

      const record = withContentHashes(draft);

      let result: CorpusWriteResult;
      try {
        result = await withTimeout(
          writer.writeTurn(record),
          this.writeTimeoutMs,
          "chat_corpus_write",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("timed out")) {
          this.metrics.write_timeout += 1;
          this.recordWriteFailed("timeout");
        } else {
          // Writer threw (contract violation) or unexpected rejection.
          this.recordWriteFailed("throw");
        }
        log.warn("chat corpus write failed", {
          metric: CHAT_CORPUS_WRITE_FAILED_METRIC,
          turn_id: pending.turn_id,
          tenant_id: pending.tenant_id,
          thread_id: pending.thread_id,
          error: message,
        });
        return;
      }

      if (!result.ok) {
        this.recordWriteFailed(result.code || "write_err");
        log.warn("chat corpus write failed", {
          metric: CHAT_CORPUS_WRITE_FAILED_METRIC,
          turn_id: pending.turn_id,
          tenant_id: pending.tenant_id,
          thread_id: pending.thread_id,
          code: result.code,
          error: result.error,
        });
        return;
      }

      this.metrics.write_ok += 1;
    } catch (err) {
      // Absolute fail-open: never surface to SSE/HTTP.
      this.recordWriteFailed("unexpected");
      log.warn("chat corpus write unexpected failure", {
        metric: CHAT_CORPUS_WRITE_FAILED_METRIC,
        turn_id: pending.turn_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Build a capture instance from optional writer + gate overrides.
 * Returns null when no writer is configured (lab default).
 */
export function createChatCorpusCapture(
  options: ChatCorpusCaptureOptions,
): ChatCorpusCapture | null {
  if (!options.writer) {
    return null;
  }
  return new ChatCorpusCapture(options);
}
