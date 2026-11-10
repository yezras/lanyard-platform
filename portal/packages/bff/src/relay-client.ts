import type {
  BrainRpcRequestFrame,
  BrainRpcResultFrame,
  McqChoice,
  MessageEvent,
} from "@lanyard/shared";

export const RELAY_INTERNAL_TOKEN_HEADER = "x-relay-internal-token";

export type RelayChatEvent = {
  type:
    | "message_send"
    | "message_edit"
    | "typing"
    | "tool_progress"
    | "reasoning"
    | "mcq";
  chat_id: string;
  message_id?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  tool_label?: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: string;
  tool_target?: string;
  duration?: string;
  error_message?: string;
  errorMessage?: string;
  additions?: number;
  deletions?: number;
  node?: string;
  tool_kind?: string;
  subagent_name?: string;
  result?: string;
  result_detail?: string;
  mcq_id?: string;
  choices?: McqChoice[];
  model?: string;
  citations?: Array<{ path: string; title: string }>;
  created_at?: string;
};

export type RelayInstanceOwner = {
  instance_id: string;
  node_id: string | null;
  advertise_url: string | null;
  connected: boolean;
  mode?: string;
};

export type RelayRequestFn = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class RelayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly requestFn: RelayRequestFn = fetch,
  ) {}

  private headers(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra ?? undefined);
    headers.set(RELAY_INTERNAL_TOKEN_HEADER, this.internalToken);
    return headers;
  }

  /**
   * Resolve the relay task that owns the gateway session (G6).
   * Returns null advertise_url when no owner / single-node without registry.
   * lp-8sh4.6: a network-level failure (gateway offline) is a structured
   * result, never a thrown TypeError — callers must decide on fallbacks.
   */
  async getInstanceOwner(
    instanceId: string,
  ): Promise<
    | { ok: true; owner: RelayInstanceOwner }
    | { ok: false; status: number; error: string }
  > {
    let response: Response;
    try {
      response = await this.requestFn(
        `${this.baseUrl}/internal/instances/${encodeURIComponent(instanceId)}/owner`,
        {
          method: "GET",
          headers: this.headers({ accept: "application/json" }),
        },
      );
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay owner lookup failed",
      };
    }

    const body = (await response.json()) as RelayInstanceOwner;
    return {
      ok: true,
      owner: {
        instance_id: body.instance_id ?? instanceId,
        node_id: body.node_id ?? null,
        advertise_url: body.advertise_url ?? null,
        connected: Boolean(body.connected),
        mode: body.mode,
      },
    };
  }

  /**
   * Base URL for owner-local chat hub routes (SSE/history).
   * Falls back to cluster service URL when no owner advertise_url.
   * lp-8sh4.6: owner lookup failure also falls back — history/SSE must not
   * 500 just because the owner registry is unreachable.
   */
  async resolveChatBaseUrl(instanceId?: string): Promise<string> {
    if (!instanceId) return this.baseUrl;
    const owner = await this.getInstanceOwner(instanceId);
    if (owner.ok && owner.owner.advertise_url) {
      return owner.owner.advertise_url.replace(/\/$/, "");
    }
    return this.baseUrl;
  }

  async deliverInbound(input: {
    instanceId: string;
    tenantId: string;
    event: MessageEvent;
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    // Deliver always targets the service URL (any task); bus routes to owner.
    // lp-8sh4.6: a network-level failure (gateway offline) is a structured
    // 503, never an unhandled throw — the composer must show an honest,
    // actionable error instead of "Internal server error".
    let response: Response;
    try {
      response = await this.requestFn(`${this.baseUrl}/internal/deliver-inbound`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          instance_id: input.instanceId,
          tenant_id: input.tenantId,
          event: input.event,
        }),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl} — start the gateway (or set ChatDelivery=harness) and retry.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay deliver-inbound failed",
      };
    }

    return { ok: true };
  }

  /**
   * Mid-turn stop: connector → Hermes interrupt_inbound (CLI Esc / /stop equivalent).
   */
  async interruptInbound(input: {
    instanceId: string;
    sessionKey: string;
    chatId: string;
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    let response: Response;
    try {
      response = await this.requestFn(
        `${this.baseUrl}/internal/interrupt-inbound`,
        {
          method: "POST",
          headers: this.headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            instance_id: input.instanceId,
            session_key: input.sessionKey,
            chat_id: input.chatId,
          }),
        },
      );
    } catch {
      // lp-8sh4.6: gateway offline is a structured 503, not a thrown 500.
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay interrupt-inbound failed",
      };
    }

    return { ok: true };
  }

  /**
   * Halt: abort is interruptInbound; this sets the gateway freeze bit for
   * thread_id until the next human message (lp-v62i.3.7).
   */
  async haltMailbox(input: {
    instanceId: string;
    threadId: string;
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    return this.postMailboxFreeze("/internal/mailbox-halt", {
      instance_id: input.instanceId,
      thread_id: input.threadId,
      freeze: true,
    });
  }

  /** Jack spoke in the room: clear the gateway freeze bit. */
  async thawMailbox(input: {
    instanceId: string;
    threadId: string;
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    return this.postMailboxFreeze("/internal/mailbox-thaw", {
      instance_id: input.instanceId,
      thread_id: input.threadId,
    });
  }

  async isMailboxFrozen(input: {
    instanceId: string;
    threadId: string;
  }): Promise<
    | { ok: true; frozen: boolean }
    | { ok: false; status: number; error: string }
  > {
    const url = new URL(`${this.baseUrl}/internal/mailbox-freeze`);
    url.searchParams.set("thread_id", input.threadId);
    url.searchParams.set("instance_id", input.instanceId);
    let response: Response;
    try {
      response = await this.requestFn(url.toString(), {
        method: "GET",
        headers: this.headers({ accept: "application/json" }),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      frozen?: boolean;
    };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay mailbox-freeze lookup failed",
      };
    }
    return { ok: true, frozen: body.frozen === true };
  }

  private async postMailboxFreeze(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    let response: Response;
    try {
      response = await this.requestFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload.error ?? "Relay mailbox freeze failed",
      };
    }
    return { ok: true };
  }

  /**
   * Opens relay SSE stream for a chat thread. Caller must consume/abort the body.
   * When instanceId is provided, sticks to owner advertise_url (G6 chat hub locality).
   * lp-8sh4.6: network-level failure returns a synthetic 503 Response so
   * callers keep their single `!response.ok` handling path (no throw).
   */
  async openChatEventStream(
    chatId: string,
    signal?: AbortSignal,
    options?: { instanceId?: string },
  ): Promise<Response> {
    const base = await this.resolveChatBaseUrl(options?.instanceId);
    try {
      return await this.requestFn(
        `${base}/internal/chat/${encodeURIComponent(chatId)}/events`,
        {
          method: "GET",
          headers: this.headers({ accept: "text/event-stream" }),
          signal,
        },
      );
    } catch {
      return new Response(null, {
        status: 503,
        statusText: "Agent gateway unreachable",
      });
    }
  }

  /**
   * Durable outbound events retained by the relay hub (for reload hydrate).
   * When instanceId is provided, sticks to owner advertise_url (G6).
   * lp-8sh4.6: gateway offline is `{ok:false}` — never an unhandled throw.
   * The history route merges BFF-store events and flags outbound_incomplete,
   * so reload hydrate keeps working while the gateway is down.
   */
  async fetchChatHistory(
    chatId: string,
    options?: { instanceId?: string },
  ): Promise<
    { ok: true; events: RelayChatEvent[] } | { ok: false; status: number; error: string }
  > {
    let response: Response;
    try {
      const base = await this.resolveChatBaseUrl(options?.instanceId);
      response = await this.requestFn(
        `${base}/internal/chat/${encodeURIComponent(chatId)}/history`,
        {
          method: "GET",
          headers: this.headers({ accept: "application/json" }),
        },
      );
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay chat history failed",
      };
    }

    const body = (await response.json()) as { events?: RelayChatEvent[] };
    return { ok: true, events: body.events ?? [] };
  }

  /**
   * G3.3: invoke a host brain RPC method via the relay-connected Hermes gateway.
   * Fail-closed: non-2xx or missing result → error (no local host fallback).
   * lp-8sh4.6: gateway offline is a structured 503 result, not a throw —
   * brain RPC routes map it to 503 unavailable like any other transport miss.
   */
  async invokeBrainRpc(input: {
    instanceId: string;
    tenantId: string;
    request: BrainRpcRequestFrame;
  }): Promise<
    | { ok: true; result: BrainRpcResultFrame }
    | { ok: false; status: number; error: string; reason?: string }
  > {
    let response: Response;
    try {
      response = await this.requestFn(`${this.baseUrl}/internal/brain-rpc`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          instance_id: input.instanceId,
          tenant_id: input.tenantId,
          request: input.request,
        }),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent gateway unreachable at ${this.baseUrl}.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
      result?: BrainRpcResultFrame;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Relay brain-rpc failed",
        reason: body.reason,
      };
    }

    if (!body.result || body.result.type !== "brain_rpc_result") {
      return {
        ok: false,
        status: 502,
        error: "Relay brain-rpc response missing result frame",
      };
    }

    return { ok: true, result: body.result };
  }
}

/** Parse one SSE `data:` line into a relay chat event (ignores comments/heartbeats). */
export function parseRelaySseDataLine(line: string): RelayChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as RelayChatEvent;
  } catch {
    return null;
  }
}
