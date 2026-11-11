/**
 * Local real harness test env helper (lp-57ha — Subtract Before You Add).
 *
 * No fakes. Talks to the real lanyard-agent binary on 127.0.0.1 + local
 * Postgres + BFF 4000 + real LLM key. This is the sole harness for all
 * future pool tests (human-scoped 1:1, channel_context, longer-running work).
 *
 * Required env for a full run:
 *   lanyard-agent binary listening on HARNESS_URL (default http://127.0.0.1:4310)
 *   local Postgres at DATABASE_URL / CONTROL_PLANE_DATABASE_URL
 *   BFF at BFF_URL (default http://127.0.0.1:4000) — when testing via BFF
 *   real LLM key in the agent env (OPENAI_API_KEY / ANTHROPIC_API_KEY)
 *   HARNESS_SERVICE_TOKEN (default placeholder-harness-service-token — must match agent)
 *
 * Usage (vitest):
 *   import { startTurn, waitForTurnComplete, isHarnessReachable } from "../../../test/harness-local.js";
 *   // or from "../test/harness-local.js" depending on package depth
 *   if (!(await isHarnessReachable())) return; // skip when no harness
 *   const turnId = await startTurn({ tenant_id, user_id, instance_id, thread_id, message });
 *   const events = await waitForTurnComplete(turnId);
 *
 * Pure wake-policy logic (portal/packages/bff/src/wake-policy.ts) stays as
 * unit tests without this helper.
 */

import {
  HARNESS_SERVICE_TOKEN_HEADER,
  HARNESS_TURNS_PATH,
  harnessTurnEventsPath,
  type TurnId,
  type TurnRequest,
  type TurnEvent,
  type ChannelContext,
  isTurnEvent,
} from "@lanyard/shared";

// Resolve from env at call time sovitest setup can mutate process.env.
export function localHarnessUrl(): string {
  return (
    process.env.HARNESS_URL?.trim() ||
    process.env.LANYARD_HARNESS_URL?.trim() ||
    "http://127.0.0.1:4310"
  );
}

export function localHarnessToken(): string {
  return (
    process.env.HARNESS_SERVICE_TOKEN?.trim() ||
    process.env.HARNESS_TOKEN?.trim() ||
    "placeholder-harness-service-token"
  );
}

export function localBffUrl(): string {
  return process.env.BFF_URL?.trim() || "http://127.0.0.1:4000";
}

export function localPostgresUrl(): string {
  return (
    process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://lanyard:lanyard@127.0.0.1:5432/lanyard"
  );
}

function harnessUrl(path: string): string {
  const base = localHarnessUrl().replace(/\/+$/, "");
  return `${base}${path}`;
}

function harnessHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const token = localHarnessToken();
  if (token) headers.set(HARNESS_SERVICE_TOKEN_HEADER, token);
  return headers;
}

// Same parser as the former in-process test harness helper — kept here without the
// fake so BFF harness-client and contract tests can still parse SSE.
export function parseHarnessSseDataLine(line: string): TurnEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isTurnEvent(parsed) ? (parsed as TurnEvent) : null;
  } catch {
    return null;
  }
}

export function collectHarnessTurnEvents(sseText: string): TurnEvent[] {
  return sseText
    .split("\n")
    .map((line) => parseHarnessSseDataLine(line))
    .filter((event): event is TurnEvent => event !== null);
}

export type StartTurnResult =
  | { ok: true; turn_id: TurnId }
  | { ok: false; status: number; error: string };

export async function startTurn(
  request: TurnRequest,
  opts?: { harnessUrl?: string; token?: string; fetchImpl?: typeof fetch },
): Promise<StartTurnResult> {
  const url = `${(opts?.harnessUrl ?? localHarnessUrl()).replace(/\/+$/, "")}${HARNESS_TURNS_PATH}`;
  const token = opts?.token ?? localHarnessToken();
  const doFetch = opts?.fetchImpl ?? fetch;
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set(HARNESS_SERVICE_TOKEN_HEADER, token);

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: err instanceof Error ? err.message : "harness unreachable",
    };
  }

  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg = typeof rec.error === "string" ? rec.error : `harness POST ${res.status}`;
    return { ok: false, status: res.status, error: msg };
  }
  const turnId = typeof rec.turn_id === "string" ? rec.turn_id.trim() : "";
  if (!turnId) {
    return { ok: false, status: 502, error: "harness turn response missing turn_id" };
  }
  return { ok: true, turn_id: turnId as TurnId };
}

export type WaitForTurnCompleteOptions = {
  harnessUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Stop early once an event of this type is seen (e.g. message_send). */
  stopAfterTypes?: string[];
};

export async function waitForTurnComplete(
  turnId: string,
  opts?: WaitForTurnCompleteOptions,
): Promise<TurnEvent[]> {
  const base = (opts?.harnessUrl ?? localHarnessUrl()).replace(/\/+$/, "");
  const url = `${base}${harnessTurnEventsPath(turnId)}`;
  const token = opts?.token ?? localHarnessToken();
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const stop = new Set(opts?.stopAfterTypes ?? []);
  const doFetch = opts?.fetchImpl ?? fetch;

  const headers = new Headers({ accept: "text/event-stream" });
  if (token) headers.set(HARNESS_SERVICE_TOKEN_HEADER, token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new Error(`harness SSE timeout after ${timeoutMs}ms for turn ${turnId}`);
    }
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timeout);
    let errBody = "";
    try {
      errBody = await res.text();
    } catch {
      errBody = "";
    }
    throw new Error(`harness SSE ${res.status}: ${errBody || res.statusText}`);
  }

  if (!res.body) {
    clearTimeout(timeout);
    // Some runtimes buffer SSE as text; fall back to .text()
    const text = await res.text();
    return collectHarnessTurnEvents(text);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: TurnEvent[] = [];
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        let data = "";
        let eventType: string | undefined;
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = parseHarnessSseDataLine(`data: ${data}`);
        if (!parsed) continue;
        events.push(parsed);
        if (parsed.type && stop.has(parsed.type)) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          clearTimeout(timeout);
          return events;
        }
        if (eventType && stop.has(eventType)) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          clearTimeout(timeout);
          return events;
        }
        // Heuristic: harness streams end after the final message_send.
        // We do not assume a terminal event — caller can stopAfterTypes or
        // wait for stream close. For a full turn, stream close is the signal.
      }
    }
    // Drain any trailing buffer as one more SSE frame
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        const ev = parseHarnessSseDataLine(line);
        if (ev) events.push(ev);
      }
    }
  } finally {
    clearTimeout(timeout);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  return events;
}

export async function startTurnAndWait(
  request: TurnRequest,
  opts?: WaitForTurnCompleteOptions,
): Promise<{ turn_id: TurnId; events: TurnEvent[] }> {
  const started = await startTurn(request, opts);
  if (!started.ok) {
    throw new Error(`startTurn failed ${started.status}: ${started.error}`);
  }
  const events = await waitForTurnComplete(started.turn_id as string, opts);
  return { turn_id: started.turn_id, events };
}

/**
 * lp-692u: harness SessionState delta for channel_context.
 * BFF live fetch from context_pool table stamps read-only sibling excerpts;
 * harness SessionState holds the pool for the turn and renders [Context].
 */
export type HarnessSessionState = {
  tenant_id: string;
  channel_id: string;
  thread_id: string;
  channelContext: ChannelContext | null;
};

export function buildHarnessSessionState(input: {
  tenant_id: string;
  channel_id: string;
  thread_id: string;
  channelContext: ChannelContext | null;
}): HarnessSessionState {
  return {
    tenant_id: input.tenant_id,
    channel_id: input.channel_id,
    thread_id: input.thread_id,
    channelContext: input.channelContext,
  };
}

export function harnessSessionStateToContextBlock(state: HarnessSessionState): string | null {
  if (!state.channelContext) return null;
  const ctx = state.channelContext;
  const desc = ctx.channel_description?.trim() || "Group channel";
  const excerpts = ctx.excerpts
    .filter((e) => !ctx.delivered_event_ids.includes(e.event_id))
    .slice(-10)
    .map((e) => `- ${e.speaker}: ${e.text.slice(0, 200)}`)
    .join("\n");
  return `[Context] channel: ${desc}\nRevision: ${ctx.revision_id}\n${excerpts ? `Sibling excerpts:\n${excerpts}` : "No sibling excerpts yet."}`;
}

/** lp-692u A harness delta: apply channel_context to a TurnRequest */
export function withChannelContext(
  request: TurnRequest,
  channelContext: ChannelContext | null,
): TurnRequest {
  if (!channelContext) return request;
  return {
    ...request,
    metadata: {
      ...request.metadata,
      channel_context: channelContext,
    },
  };
}

export async function isHarnessReachable(opts?: {
  harnessUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const base = (opts?.harnessUrl ?? localHarnessUrl()).replace(/\/+$/, "");
  const token = opts?.token ?? localHarnessToken();
  const doFetch = opts?.fetchImpl ?? fetch;
  const headers = new Headers();
  if (token) headers.set(HARNESS_SERVICE_TOKEN_HEADER, token);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 3_000);
  try {
    // No health endpoint on harness; a 404 on a bogus turn is proof it is up.
    const res = await doFetch(`${base}${harnessTurnEventsPath("health-check")}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    // Any HTTP response (even 404) means the harness is listening.
    return res.status !== 0;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function isBffReachable(opts?: {
  bffUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const base = (opts?.bffUrl ?? localBffUrl()).replace(/\/+$/, "");
  const doFetch = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 3_000);
  try {
    const res = await doFetch(`${base}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
