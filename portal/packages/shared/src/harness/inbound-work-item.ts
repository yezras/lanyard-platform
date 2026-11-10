/**
 * Inbound work spine envelope (plan 0019 §4.1 / lp-k5c4.2).
 *
 * Wraps TurnRequest plus source, sandbox_need, correlation_id, enqueue_at.
 * Unknown source and unknown sandbox_need reject at parse. Do not fail-closed
 * to none. Classification of none vs toolbox is not this module.
 */

import { parseTurnRequest, type TurnRequest } from "./turn.js";

export const INBOUND_WORK_SOURCES = [
  "web",
  "slack",
  "email",
  "whatsapp",
  "cron",
  "mailbox",
] as const;

export type InboundWorkSource = (typeof INBOUND_WORK_SOURCES)[number];

/** Same union as BFF `HarnessSandboxNeed`. Classifier lives in BFF §4.2. */
export const INBOUND_SANDBOX_NEEDS = ["none", "toolbox"] as const;

export type InboundSandboxNeed = (typeof INBOUND_SANDBOX_NEEDS)[number];

export type InboundWorkItem = TurnRequest & {
  source: InboundWorkSource;
  sandbox_need: InboundSandboxNeed;
  correlation_id: string;
  enqueue_at: number;
};

const SOURCE_SET = new Set<string>(INBOUND_WORK_SOURCES);
const SANDBOX_NEED_SET = new Set<string>(INBOUND_SANDBOX_NEEDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUnion<T extends string>(
  value: unknown,
  field: "source" | "sandbox_need",
  allowed: readonly T[],
  set: Set<string>,
): T {
  if (typeof value !== "string") {
    throw new TypeError(`InboundWorkItem.${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!set.has(trimmed)) {
    throw new TypeError(
      `InboundWorkItem.${field} must be one of ${allowed.join(" | ")}`,
    );
  }
  return trimmed as T;
}

function requiredCorrelationId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("InboundWorkItem.correlation_id must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError(
      "InboundWorkItem.correlation_id must be a non-empty string",
    );
  }
  return trimmed;
}

function requiredEnqueueAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("InboundWorkItem.enqueue_at must be a finite number");
  }
  return value;
}

export function parseInboundWorkItem(value: unknown): InboundWorkItem {
  if (!isRecord(value)) {
    throw new TypeError("InboundWorkItem must be an object");
  }
  const turn = parseTurnRequest(value);
  return {
    ...turn,
    source: requiredUnion(
      value.source,
      "source",
      INBOUND_WORK_SOURCES,
      SOURCE_SET,
    ),
    sandbox_need: requiredUnion(
      value.sandbox_need,
      "sandbox_need",
      INBOUND_SANDBOX_NEEDS,
      SANDBOX_NEED_SET,
    ),
    correlation_id: requiredCorrelationId(value.correlation_id),
    enqueue_at: requiredEnqueueAt(value.enqueue_at),
  };
}

export function isInboundWorkItem(value: unknown): value is InboundWorkItem {
  try {
    parseInboundWorkItem(value);
    return true;
  } catch {
    return false;
  }
}
