/**
 * Daytona webhook receiver: sandbox.state.updated + HMAC verify (lp-04r).
 *
 * Owns:
 *   - `sandbox.state.updated` payload shape (Daytona docs)
 *   - HMAC-SHA256 verify with shared secret (`DAYTONA_WEBHOOK_SECRET`)
 *   - Map sandbox newState → presence reason → OrchestratorInstanceStore
 *   - HTTP receiver path + status mapping (POST `/webhooks/daytona`)
 *
 * Offline parse/map/HMAC tests: lp-kng.2.3. HTTP wiring: this module + app.ts.
 *
 * Payload shape (Daytona):
 *   https://www.daytona.io/docs/en/webhooks
 * Presence graph:
 *   docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 * Identity reverse map (sandbox_id → instance_id):
 *   docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 *
 * Auth: HMAC only (public-unauthenticated at service-token layer). CP remains
 * private-network (G1.3); signature is defense-in-depth for the webhook edge.
 *
 * Idempotency: replaying a verified event is safe — intent map no-ops when
 * presence already matches, and post-stop clears sandbox_id so a second stop
 * becomes unknown_sandbox (still HTTP 200 ACK so Daytona does not retry).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  OrchestratorInstancePatch,
  OrchestratorInstanceRecord,
  OrchestratorInstanceStore,
} from "./instance-orchestrator.js";
import {
  applyPresenceReason,
  type PresenceTransitionReason,
} from "./presence.js";
import type { InstancePresence } from "./types.js";

/** Canonical event type for sandbox lifecycle state changes. */
export const DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED =
  "sandbox.state.updated" as const;

/**
 * HTTP path for the Daytona webhook receiver (lp-04r).
 * Mounted without service-token gate; HMAC is the sole app-layer credential.
 */
export const DAYTONA_WEBHOOK_PATH = "/webhooks/daytona";

/**
 * HTTP header carrying the HMAC-SHA256 of the raw body.
 * Value may be raw hex or `sha256=<hex>` (GitHub-style).
 * Live Daytona may use a vendor-specific scheme (e.g. Svix); adapt header
 * parsing here if the managed product differs from this offline contract.
 */
export const DAYTONA_WEBHOOK_SIGNATURE_HEADER = "x-daytona-signature";

/** Env var name for the shared webhook HMAC secret (never commit values). */
export const DAYTONA_WEBHOOK_SECRET_ENV = "DAYTONA_WEBHOOK_SECRET";

/**
 * `sandbox.state.updated` body (Daytona webhook payload format).
 * States are strings as delivered; normalize with {@link normalizeDaytonaWebhookState}.
 */
export type DaytonaSandboxStateUpdatedPayload = {
  event: typeof DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED;
  /** ISO-8601 when the event occurred. */
  timestamp: string;
  /** Daytona sandbox id (`sandbox_id` in CP). */
  id: string;
  organizationId: string;
  oldState: string;
  newState: string;
  /** ISO-8601 when the sandbox was last updated. */
  updatedAt: string;
};

/** Thrown when JSON body is not a valid sandbox.state.updated payload. */
export class DaytonaWebhookParseError extends Error {
  readonly code = "DAYTONA_WEBHOOK_PARSE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "DaytonaWebhookParseError";
  }
}

/** Thrown when HMAC is missing, malformed, or does not match. */
export class DaytonaWebhookSignatureError extends Error {
  readonly code = "DAYTONA_WEBHOOK_SIGNATURE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "DaytonaWebhookSignatureError";
  }
}

/** Normalize Daytona state labels (docs use Title Case; API examples lowercase). */
export function normalizeDaytonaWebhookState(state: string): string {
  return state.trim().toLowerCase().replace(/\s+/g, "_");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse unknown JSON into a typed `sandbox.state.updated` payload.
 * @throws {DaytonaWebhookParseError}
 */
export function parseSandboxStateUpdatedPayload(
  body: unknown,
): DaytonaSandboxStateUpdatedPayload {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DaytonaWebhookParseError(
      "sandbox.state.updated payload must be a JSON object",
    );
  }
  const o = body as Record<string, unknown>;

  if (o.event !== DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED) {
    throw new DaytonaWebhookParseError(
      `expected event "${DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED}", got ${String(o.event)}`,
    );
  }
  if (!isNonEmptyString(o.timestamp)) {
    throw new DaytonaWebhookParseError("missing or empty timestamp");
  }
  if (!isNonEmptyString(o.id)) {
    throw new DaytonaWebhookParseError("missing or empty sandbox id");
  }
  if (!isNonEmptyString(o.organizationId)) {
    throw new DaytonaWebhookParseError("missing or empty organizationId");
  }
  if (!isNonEmptyString(o.oldState)) {
    throw new DaytonaWebhookParseError("missing or empty oldState");
  }
  if (!isNonEmptyString(o.newState)) {
    throw new DaytonaWebhookParseError("missing or empty newState");
  }
  if (!isNonEmptyString(o.updatedAt)) {
    throw new DaytonaWebhookParseError("missing or empty updatedAt");
  }

  return {
    event: DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED,
    timestamp: o.timestamp.trim(),
    id: o.id.trim(),
    organizationId: o.organizationId.trim(),
    oldState: o.oldState.trim(),
    newState: o.newState.trim(),
    updatedAt: o.updatedAt.trim(),
  };
}

/**
 * Compute hex HMAC-SHA256 over the raw webhook body (UTF-8 string or Buffer).
 * Test helper and production signer share this so vectors stay stable.
 */
export function signDaytonaWebhookBody(
  rawBody: string | Buffer,
  secret: string,
): string {
  if (!secret) {
    throw new TypeError("Daytona webhook secret must be non-empty");
  }
  const h = createHmac("sha256", secret);
  if (typeof rawBody === "string") {
    h.update(rawBody, "utf8");
  } else {
    h.update(rawBody);
  }
  return h.digest("hex");
}

/**
 * Format signature header value as `sha256=<hex>` (preferred wire form).
 */
export function formatDaytonaWebhookSignatureHeader(hexDigest: string): string {
  const hex = hexDigest.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new TypeError("signature digest must be even-length hex");
  }
  return `sha256=${hex}`;
}

/**
 * Extract hex digest from header value (`sha256=<hex>` or raw hex).
 * Returns null when the header is empty/malformed (not a length mismatch).
 */
export function parseDaytonaWebhookSignatureHeader(
  headerValue: string | null | undefined,
): string | null {
  if (headerValue === null || headerValue === undefined) {
    return null;
  }
  const raw = headerValue.trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  const prefixed = lower.startsWith("sha256=")
    ? lower.slice("sha256=".length).trim()
    : lower;
  // Strip optional surrounding quotes
  const hex = prefixed.replace(/^"+|"+$/g, "");
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    return null;
  }
  return hex;
}

/**
 * Timing-safe HMAC verify. Returns true when the header matches the body.
 * Does not throw on mismatch (caller / assert helper rejects).
 */
export function verifyDaytonaWebhookHmac(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret) {
    return false;
  }
  const presented = parseDaytonaWebhookSignatureHeader(signatureHeader);
  if (!presented) {
    return false;
  }
  const expected = signDaytonaWebhookBody(rawBody, secret);
  try {
    const a = Buffer.from(presented, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Assert HMAC; throw {@link DaytonaWebhookSignatureError} on failure.
 * Use at the HTTP boundary (lp-04r) and in unit tests for invalid vectors.
 */
export function assertDaytonaWebhookHmac(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): void {
  if (!verifyDaytonaWebhookHmac(rawBody, signatureHeader, secret)) {
    throw new DaytonaWebhookSignatureError(
      "invalid or missing Daytona webhook HMAC signature",
    );
  }
}

/**
 * Intent derived from webhook newState + current presence.
 * `reason === null` means ignore (no store write).
 */
export type SandboxWebhookPresenceIntent = {
  /** Normalized newState. */
  new_state: string;
  /**
   * Lifecycle reason to apply, or null when the event is ignored
   * (transitional states, illegal jumps, already-matching presence).
   */
  reason: PresenceTransitionReason | null;
  /** Expected next presence when reason is non-null. */
  next_presence: InstancePresence | null;
  /**
   * Clear sandbox_id binding when compute is gone
   * (stopped / archived / deleted / error after terminal loss).
   */
  clear_sandbox_id: boolean;
  /** Human-readable why (tests / logs). */
  note: string;
};

/**
 * Map Daytona sandbox newState → presence transition intent.
 *
 * Rules (presence-state-machine.md, offline):
 * - started (+ resuming-like) while waking → wake_succeeded → online
 * - started while online → no-op (already online)
 * - started while offline|error → ignore (must not skip waking; ensure_online owns wake)
 * - stopped|archived|deleted|paused while online|waking|error → offline
 * - error|build_failed while waking → wake_failed → error
 * - error|build_failed while online → runtime_error → error
 * - creating|starting|… transitional → ignore (stay waking/current)
 */
export function mapSandboxStateToPresenceIntent(
  newState: string,
  currentPresence: InstancePresence,
): SandboxWebhookPresenceIntent {
  const state = normalizeDaytonaWebhookState(newState);

  // Terminal-ish compute-up
  if (state === "started") {
    if (currentPresence === "waking") {
      return {
        new_state: state,
        reason: "wake_succeeded",
        next_presence: "online",
        clear_sandbox_id: false,
        note: "sandbox started during wake → online",
      };
    }
    if (currentPresence === "online") {
      return {
        new_state: state,
        reason: null,
        next_presence: null,
        clear_sandbox_id: false,
        note: "already online; started is no-op",
      };
    }
    return {
      new_state: state,
      reason: null,
      next_presence: null,
      clear_sandbox_id: false,
      note: "started while offline/error ignored (wake must go through waking)",
    };
  }

  // Compute down / gone
  if (
    state === "stopped" ||
    state === "archived" ||
    state === "deleted" ||
    state === "paused"
  ) {
    if (
      currentPresence === "online" ||
      currentPresence === "waking" ||
      currentPresence === "error"
    ) {
      // Prefer runtime-ish stop: online → offline via idle_stop vocabulary is fine
      // for external stop; wake abandon for mid-wake.
      const reason: PresenceTransitionReason =
        currentPresence === "waking" ? "wake_abandoned" : "idle_stop";
      return {
        new_state: state,
        reason,
        next_presence: "offline",
        clear_sandbox_id: true,
        note: `sandbox ${state} → offline (clear sandbox_id)`,
      };
    }
    return {
      new_state: state,
      reason: null,
      next_presence: null,
      clear_sandbox_id: false,
      note: "already offline; stop-like state is no-op",
    };
  }

  // Error-like
  if (state === "error" || state === "build_failed") {
    if (currentPresence === "waking") {
      return {
        new_state: state,
        reason: "wake_failed",
        next_presence: "error",
        clear_sandbox_id: false,
        note: "sandbox error during wake → error",
      };
    }
    if (currentPresence === "online") {
      return {
        new_state: state,
        reason: "runtime_error",
        next_presence: "error",
        clear_sandbox_id: false,
        note: "sandbox error while online → error",
      };
    }
    if (currentPresence === "error") {
      return {
        new_state: state,
        reason: null,
        next_presence: null,
        clear_sandbox_id: false,
        note: "already error; error state is no-op",
      };
    }
    return {
      new_state: state,
      reason: null,
      next_presence: null,
      clear_sandbox_id: false,
      note: "error while offline ignored",
    };
  }

  // Transitional / unknown: no presence mutation
  return {
    new_state: state,
    reason: null,
    next_presence: null,
    clear_sandbox_id: false,
    note: `transitional or unmapped state "${state}" ignored`,
  };
}

/** Result of applying a verified webhook to the presence store. */
export type ApplySandboxStateWebhookResult = {
  /** Parsed payload (always set when parse succeeded). */
  payload: DaytonaSandboxStateUpdatedPayload;
  /** Instance row matched by sandbox_id, or null if unknown sandbox. */
  instance: OrchestratorInstanceRecord | null;
  /** Mapping intent used. */
  intent: SandboxWebhookPresenceIntent | null;
  /** Whether the store was written. */
  applied: boolean;
  /** Updated row when applied. */
  updated: OrchestratorInstanceRecord | null;
  /** Skip / miss reason for tests and logs. */
  outcome:
    | "applied"
    | "ignored"
    | "unknown_sandbox"
    | "sandbox_id_mismatch";
};

/**
 * Find instance rows that currently bind the given sandbox_id.
 * Offline store has no reverse index — scan via {@link OrchestratorInstanceStore.list}.
 */
export async function findInstancesBySandboxId(
  store: OrchestratorInstanceStore,
  sandboxId: string,
): Promise<OrchestratorInstanceRecord[]> {
  const id = sandboxId.trim();
  if (!id) {
    return [];
  }
  const rows = await store.list();
  return rows.filter((r) => r.sandbox_id === id);
}

/**
 * Map a verified `sandbox.state.updated` payload into the presence store.
 *
 * Does **not** verify HMAC (caller must {@link assertDaytonaWebhookHmac} first
 * when handling HTTP). Pure store side-effect for unit tests + future route.
 */
export async function applySandboxStateUpdatedToStore(
  store: OrchestratorInstanceStore,
  payload: DaytonaSandboxStateUpdatedPayload,
): Promise<ApplySandboxStateWebhookResult> {
  const sandboxId = payload.id.trim();
  const matches = await findInstancesBySandboxId(store, sandboxId);

  if (matches.length === 0) {
    return {
      payload,
      instance: null,
      intent: null,
      applied: false,
      updated: null,
      outcome: "unknown_sandbox",
    };
  }

  // One sandbox_id should bind at most one instance; apply first match.
  const instance = matches[0]!;
  if (instance.sandbox_id !== sandboxId) {
    return {
      payload,
      instance,
      intent: null,
      applied: false,
      updated: null,
      outcome: "sandbox_id_mismatch",
    };
  }

  const intent = mapSandboxStateToPresenceIntent(
    payload.newState,
    instance.presence,
  );

  if (intent.reason === null || intent.next_presence === null) {
    return {
      payload,
      instance,
      intent,
      applied: false,
      updated: null,
      outcome: "ignored",
    };
  }

  // Validate via presence reason table (throws if inconsistent — should not).
  const nextPresence = applyPresenceReason(instance.presence, intent.reason);

  const patch: OrchestratorInstancePatch = {
    presence: nextPresence,
  };
  if (intent.clear_sandbox_id) {
    patch.sandbox_id = null;
  }

  // CAS when possible so concurrent ensure_online cannot be clobbered blindly.
  const cas = await store.compareAndUpdate(
    instance.instance_id,
    instance.presence,
    patch,
  );
  if (cas) {
    return {
      payload,
      instance,
      intent,
      applied: true,
      updated: cas,
      outcome: "applied",
    };
  }

  // Lost race: fall back to unconditional update of latest row if still same sandbox.
  const latest = await store.get(instance.instance_id);
  if (!latest || latest.sandbox_id !== sandboxId) {
    return {
      payload,
      instance,
      intent,
      applied: false,
      updated: null,
      outcome: "sandbox_id_mismatch",
    };
  }
  const retryIntent = mapSandboxStateToPresenceIntent(
    payload.newState,
    latest.presence,
  );
  if (retryIntent.reason === null || retryIntent.next_presence === null) {
    return {
      payload,
      instance: latest,
      intent: retryIntent,
      applied: false,
      updated: null,
      outcome: "ignored",
    };
  }
  const retryPresence = applyPresenceReason(
    latest.presence,
    retryIntent.reason,
  );
  const retryPatch: OrchestratorInstancePatch = {
    presence: retryPresence,
  };
  if (retryIntent.clear_sandbox_id) {
    retryPatch.sandbox_id = null;
  }
  const updated = await store.update(latest.instance_id, retryPatch);
  return {
    payload,
    instance: latest,
    intent: retryIntent,
    applied: true,
    updated,
    outcome: "applied",
  };
}

/**
 * Full path: verify HMAC → parse JSON → apply to store.
 * Used by unit tests and the HTTP receiver ({@link handleDaytonaWebhookRequest}).
 */
export async function processSandboxStateUpdatedWebhook(options: {
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
  secret: string;
  store: OrchestratorInstanceStore;
  /** Pre-parsed body; when omitted, JSON.parse(rawBody). */
  bodyJson?: unknown;
}): Promise<ApplySandboxStateWebhookResult> {
  assertDaytonaWebhookHmac(
    options.rawBody,
    options.signatureHeader,
    options.secret,
  );

  let body: unknown = options.bodyJson;
  if (body === undefined) {
    const text =
      typeof options.rawBody === "string"
        ? options.rawBody
        : options.rawBody.toString("utf8");
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new DaytonaWebhookParseError("webhook body is not valid JSON");
    }
  }

  const payload = parseSandboxStateUpdatedPayload(body);
  return applySandboxStateUpdatedToStore(options.store, payload);
}

// ---------------------------------------------------------------------------
// HTTP receiver (lp-04r)
// ---------------------------------------------------------------------------

/** Safe JSON body returned by the webhook HTTP handler (no secrets). */
export type DaytonaWebhookHttpBody = {
  ok: boolean;
  outcome:
    | "applied"
    | "ignored"
    | "unknown_sandbox"
    | "sandbox_id_mismatch"
    | "unsupported_event"
    | "signature_invalid"
    | "parse_error"
    | "not_configured";
  applied: boolean;
  /** Event type when body was parseable as JSON object. */
  event?: string | null;
  /** Matched instance when known (never invents rows). */
  instance_id?: string | null;
  /** Presence after apply, or current when ignored with a match. */
  presence?: InstancePresence | null;
  /** sandbox_id after apply (null when cleared). */
  sandbox_id?: string | null;
  /** Short non-secret note for logs/tests. */
  note?: string;
};

export type DaytonaWebhookHttpResult = {
  status: 200 | 400 | 401 | 503;
  body: DaytonaWebhookHttpBody;
};

function rawBodyText(rawBody: string | Buffer): string {
  return typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
}

/**
 * HTTP-facing receiver: verify HMAC, map `sandbox.state.updated` into presence,
 * ACK other verified events as ignored (so Daytona does not retry forever).
 *
 * Status mapping:
 * - 503 — webhook secret not configured
 * - 401 — invalid / missing HMAC (reject bad sigs)
 * - 400 — body not JSON or invalid `sandbox.state.updated` shape
 * - 200 — verified; applied / ignored / unknown_sandbox / unsupported_event
 *
 * Replay-safe: a second identical delivery after a successful transition is
 * still 200 (`ignored` or `unknown_sandbox`), never a store clobber.
 */
export async function handleDaytonaWebhookRequest(options: {
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
  secret: string | null | undefined;
  store: OrchestratorInstanceStore;
}): Promise<DaytonaWebhookHttpResult> {
  const secret = options.secret?.trim() ?? "";
  if (!secret) {
    return {
      status: 503,
      body: {
        ok: false,
        outcome: "not_configured",
        applied: false,
        note: `${DAYTONA_WEBHOOK_SECRET_ENV} is not configured`,
      },
    };
  }

  if (
    !verifyDaytonaWebhookHmac(
      options.rawBody,
      options.signatureHeader,
      secret,
    )
  ) {
    return {
      status: 401,
      body: {
        ok: false,
        outcome: "signature_invalid",
        applied: false,
        note: "invalid or missing Daytona webhook HMAC signature",
      },
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBodyText(options.rawBody)) as unknown;
  } catch {
    return {
      status: 400,
      body: {
        ok: false,
        outcome: "parse_error",
        applied: false,
        note: "webhook body is not valid JSON",
      },
    };
  }

  const eventName =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).event === "string"
      ? String((body as Record<string, unknown>).event)
      : null;

  // Verified but not the event we apply — ACK so vendor retries stop.
  if (eventName !== DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED) {
    return {
      status: 200,
      body: {
        ok: true,
        outcome: "unsupported_event",
        applied: false,
        event: eventName,
        note: eventName
          ? `event "${eventName}" ignored (only ${DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED} updates presence)`
          : "missing event field; ignored",
      },
    };
  }

  try {
    const result = await processSandboxStateUpdatedWebhook({
      rawBody: options.rawBody,
      signatureHeader: options.signatureHeader,
      secret,
      store: options.store,
      bodyJson: body,
    });

    const instanceId =
      result.updated?.instance_id ?? result.instance?.instance_id ?? null;
    const presence =
      result.updated?.presence ?? result.instance?.presence ?? null;
    const sandboxId =
      result.updated !== null
        ? result.updated.sandbox_id
        : (result.instance?.sandbox_id ?? null);

    return {
      status: 200,
      body: {
        ok: true,
        outcome: result.outcome,
        applied: result.applied,
        event: result.payload.event,
        instance_id: instanceId,
        presence,
        sandbox_id: sandboxId,
        note: result.intent?.note,
      },
    };
  } catch (err) {
    if (err instanceof DaytonaWebhookSignatureError) {
      // Defensive: process path re-verifies; should not hit after pre-check.
      return {
        status: 401,
        body: {
          ok: false,
          outcome: "signature_invalid",
          applied: false,
          event: eventName,
          note: err.message,
        },
      };
    }
    if (err instanceof DaytonaWebhookParseError) {
      return {
        status: 400,
        body: {
          ok: false,
          outcome: "parse_error",
          applied: false,
          event: eventName,
          note: err.message,
        },
      };
    }
    throw err;
  }
}
