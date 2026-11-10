import { clampBrainRpcTimeoutMs, isBrainRpcRequestFrame } from "@lanyard/shared";
import type { BrainRpcRequestFrame, MessageEvent } from "@lanyard/shared";

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ChatDeliveryHub, ChatOutboundEvent } from "./chat-delivery-hub.js";
import type { RelaySessionServer } from "./relay-session-server.js";
import type { SecretStore } from "./secret-store.js";

export const RELAY_INTERNAL_TOKEN_HEADER = "x-relay-internal-token";

/**
 * Cap for internal JSON request bodies (deliver-inbound, brain-rpc, etc.).
 * Control-plane-style frames; not customer vault bodies (those use WS).
 * Overridable via RELAY_INTERNAL_JSON_MAX_BYTES.
 */
export const DEFAULT_INTERNAL_JSON_MAX_BYTES = 1_048_576; // 1 MiB

export class InternalBodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "InternalBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

export type RelayInternalHttpOptions = {
  internalToken?: string;
  sessionServer: RelaySessionServer;
  chatHub: ChatDeliveryHub;
  secretStore: SecretStore;
  /** Max JSON body bytes for POST /internal/* (default 1 MiB). */
  maxJsonBodyBytes?: number;
};

function resolveMaxJsonBodyBytes(options: RelayInternalHttpOptions): number {
  if (
    typeof options.maxJsonBodyBytes === "number" &&
    Number.isFinite(options.maxJsonBodyBytes) &&
    options.maxJsonBodyBytes > 0
  ) {
    return Math.floor(options.maxJsonBodyBytes);
  }
  const fromEnv = Number(process.env.RELAY_INTERNAL_JSON_MAX_BYTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_INTERNAL_JSON_MAX_BYTES;
}

/**
 * Constant-time compare of internal token strings (via SHA-256 digests so
 * unequal lengths still compare safely).
 */
export function internalTokenMatches(
  expected: string,
  presented: string,
): boolean {
  try {
    const a = createHash("sha256").update(expected, "utf8").digest();
    const b = createHash("sha256").update(presented, "utf8").digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Read a JSON body with an early abort once the byte cap is exceeded.
 * Rejects with {@link InternalBodyTooLargeError} without buffering the rest.
 */
export function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_INTERNAL_JSON_MAX_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      // Stop reading further data when oversized.
      req.resume();
      reject(error);
    };

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        fail(new InternalBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", fail);
  });
}

function requireInternalToken(
  options: RelayInternalHttpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const expected = options.internalToken?.trim();
  if (!expected) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Relay internal token not configured" }));
    return false;
  }

  const presented = req.headers[RELAY_INTERNAL_TOKEN_HEADER];
  const token = Array.isArray(presented) ? presented[0] : presented;
  if (!token || !internalTokenMatches(expected, token)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }

  return true;
}

function writeBodyTooLarge(res: ServerResponse, maxBytes: number): void {
  res.writeHead(413, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Request body too large",
      max_bytes: maxBytes,
    }),
  );
}

function writeSseEvent(res: ServerResponse, event: ChatOutboundEvent): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  try {
    // Non-blocking write; if the socket buffers fill under multi-chat load,
    // Node still queues until drain — never throw into the publisher.
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    // Subscriber socket already closed; unsubscribe happens on req "close".
  }
}

export async function handleRelayInternalHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: RelayInternalHttpOptions,
): Promise<boolean> {
  const maxJsonBodyBytes = resolveMaxJsonBodyBytes(options);

  if (req.method === "POST" && url.pathname === "/internal/deliver-inbound") {
    if (!requireInternalToken(options, req, res)) return true;

    let body: { instance_id?: string; tenant_id?: string; event?: MessageEvent };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const instanceId = body.instance_id?.trim();
    const event = body.event;
    if (!instanceId || !event?.text || !event.source?.chat_id) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "instance_id and event (text, source.chat_id) are required",
        }),
      );
      return true;
    }

    const record = options.secretStore.getByInstanceId(instanceId);
    if (record && body.tenant_id && !record.tenantId) {
      options.secretStore.setTenantId(instanceId, body.tenant_id);
    }

    const delivered = await options.sessionServer.deliverInbound(
      instanceId,
      event,
    );
    if (!delivered) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Gateway not connected or handshake incomplete",
          instance_id: instanceId,
        }),
      );
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, instance_id: instanceId }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/internal/interrupt-inbound") {
    if (!requireInternalToken(options, req, res)) return true;

    let body: {
      instance_id?: string;
      session_key?: string;
      chat_id?: string;
    };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const instanceId = body.instance_id?.trim();
    const sessionKey = body.session_key?.trim();
    const chatId = body.chat_id?.trim();
    if (!instanceId || !sessionKey || !chatId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "instance_id, session_key, and chat_id are required",
        }),
      );
      return true;
    }

    const delivered = await options.sessionServer.deliverInterruptInbound(
      instanceId,
      sessionKey,
      chatId,
    );
    if (!delivered) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Gateway not connected or handshake incomplete",
          instance_id: instanceId,
        }),
      );
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, instance_id: instanceId }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/internal/mailbox-halt") {
    if (!requireInternalToken(options, req, res)) return true;

    let body: { instance_id?: string; thread_id?: string };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const instanceId = body.instance_id?.trim();
    const threadId = body.thread_id?.trim();
    if (!instanceId || !threadId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "instance_id and thread_id are required" }),
      );
      return true;
    }

    const halted = options.sessionServer.haltMailbox(instanceId, threadId);
    if (!halted) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "thread_id is required" }));
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        instance_id: instanceId,
        thread_id: threadId,
        frozen: true,
      }),
    );
    return true;
  }

  if (req.method === "POST" && url.pathname === "/internal/mailbox-thaw") {
    if (!requireInternalToken(options, req, res)) return true;

    let body: { instance_id?: string; thread_id?: string };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const instanceId = body.instance_id?.trim();
    const threadId = body.thread_id?.trim();
    if (!instanceId || !threadId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "instance_id and thread_id are required" }),
      );
      return true;
    }

    const thawed = options.sessionServer.thawMailbox(instanceId, threadId);
    if (!thawed) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "thread_id is required" }));
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        instance_id: instanceId,
        thread_id: threadId,
        frozen: false,
      }),
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/internal/mailbox-freeze") {
    if (!requireInternalToken(options, req, res)) return true;
    const threadId = url.searchParams.get("thread_id")?.trim();
    if (!threadId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "thread_id is required" }));
      return true;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        thread_id: threadId,
        frozen: options.sessionServer.isMailboxFrozen(threadId),
      }),
    );
    return true;
  }

  // G6: owner lookup for BFF SSE/history stickiness.
  const instanceOwnerMatch = url.pathname.match(
    /^\/internal\/instances\/([^/]+)\/owner$/,
  );
  if (req.method === "GET" && instanceOwnerMatch) {
    if (!requireInternalToken(options, req, res)) return true;

    const instanceId = decodeURIComponent(instanceOwnerMatch[1] ?? "").trim();
    if (!instanceId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "instance_id required" }));
      return true;
    }

    const cluster = options.sessionServer.getCluster?.();
    if (!cluster) {
      // No cluster injected — process-local only; report local session if present.
      const session = options.sessionServer.getSession(instanceId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          instance_id: instanceId,
          node_id: null,
          advertise_url: null,
          connected: Boolean(session?.info.handshakeComplete),
          mode: "single",
        }),
      );
      return true;
    }

    const owner = await cluster.getOwner(instanceId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        instance_id: instanceId,
        node_id: owner?.node_id ?? null,
        advertise_url: owner?.advertise_url ?? null,
        tenant_id: owner?.tenant_id ?? null,
        connected_at: owner?.connected_at ?? null,
        connected: owner != null,
        mode: cluster.mode,
      }),
    );
    return true;
  }

  // G3.3: Portal BFF → customer host brain RPC (brain.ping vertical slice et al.)
  if (req.method === "POST" && url.pathname === "/internal/brain-rpc") {
    if (!requireInternalToken(options, req, res)) return true;

    let body: {
      instance_id?: string;
      tenant_id?: string;
      request?: BrainRpcRequestFrame;
    };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const instanceId = body.instance_id?.trim();
    const request = body.request;
    if (!instanceId || !request || !isBrainRpcRequestFrame(request)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "instance_id and request (type=brain_rpc_request) are required",
        }),
      );
      return true;
    }

    if (!request.request_id?.trim() || !request.method?.trim()) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "request.request_id and request.method are required",
        }),
      );
      return true;
    }

    // Optional L1 stamp: bind tenant on secret store when BFF provides it.
    const record = options.secretStore.getByInstanceId(instanceId);
    if (record && body.tenant_id && !record.tenantId) {
      options.secretStore.setTenantId(instanceId, body.tenant_id);
    }

    const normalized: BrainRpcRequestFrame = {
      ...request,
      type: "brain_rpc_request",
      timeout_ms: clampBrainRpcTimeoutMs(request.timeout_ms),
    };

    const delivered = await options.sessionServer.deliverBrainRpc(
      instanceId,
      normalized,
    );

    if (!delivered.ok) {
      const status =
        delivered.reason === "timeout"
          ? 504
          : delivered.reason === "socket_closed"
            ? 502
            : 503;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: delivered.message,
          reason: delivered.reason,
          instance_id: instanceId,
          request_id: request.request_id,
        }),
      );
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        instance_id: instanceId,
        result: delivered.result,
      }),
    );
    return true;
  }

  // lp-3a1.3: register/update gateway secrets for multi-instance (Daytona) without
  // re-seeding solo RELAY_GATEWAY_ID / RELAY_DEV_SECRETS. CP calls this after
  // register/rotate so a second instance can connect and rotate avoids SSM+relay redeploy race.
  const instanceCredentialsMatch = url.pathname.match(
    /^\/internal\/instances\/([^/]+)\/credentials$/,
  );
  if (req.method === "POST" && instanceCredentialsMatch) {
    if (!requireInternalToken(options, req, res)) return true;

    const instanceId = decodeURIComponent(
      instanceCredentialsMatch[1] ?? "",
    ).trim();
    if (!instanceId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "instance_id required" }));
      return true;
    }

    let body: {
      gateway_id?: string;
      secret?: string;
      rotation_secret?: string;
      secrets?: string[];
      tenant_id?: string;
    };
    try {
      body = (await readJsonBody(req, maxJsonBodyBytes)) as typeof body;
    } catch (error) {
      if (error instanceof InternalBodyTooLargeError) {
        writeBodyTooLarge(res, error.maxBytes);
        return true;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    // gateway_id defaults to instance_id (production: GATEWAY_RELAY_ID === instance_id).
    const gatewayId = (body.gateway_id?.trim() || instanceId).trim();
    const tenantId = body.tenant_id?.trim() || undefined;

    let secrets: string[] = [];
    if (Array.isArray(body.secrets) && body.secrets.length > 0) {
      secrets = body.secrets
        .filter((s): s is string => typeof s === "string")
        .map((s) => s)
        .filter((s) => s.length > 0);
    } else if (typeof body.secret === "string" && body.secret.length > 0) {
      secrets = [body.secret];
      if (
        typeof body.rotation_secret === "string" &&
        body.rotation_secret.length > 0 &&
        body.rotation_secret !== body.secret
      ) {
        secrets.push(body.rotation_secret);
      }
    }

    if (!gatewayId || secrets.length === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "gateway_id (or path instance_id) and secret or secrets[] are required",
        }),
      );
      return true;
    }

    try {
      options.secretStore.register({
        gatewayId,
        instanceId,
        secrets,
        tenantId,
      });
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Invalid credentials payload",
        }),
      );
      return true;
    }

    // Never echo secret material.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        instance_id: instanceId,
        gateway_id: gatewayId,
        secrets_count: secrets.length,
        revoked: false,
        tenant_id: tenantId ?? null,
      }),
    );
    return true;
  }

  // G2.3 / G6: force-revoke live gateway access. CP deprovision alone is not enough
  // for already-connected sockets — operators/BFF must call this after CP revoke.
  // In bus mode any task may be hit; handler writes shared marker + fans out.
  const instanceRevokeMatch = url.pathname.match(
    /^\/internal\/instances\/([^/]+)\/revoke$/,
  );
  if (req.method === "POST" && instanceRevokeMatch) {
    if (!requireInternalToken(options, req, res)) return true;

    const instanceId = decodeURIComponent(instanceRevokeMatch[1] ?? "").trim();
    if (!instanceId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "instance_id required" }));
      return true;
    }

    const result = await options.sessionServer.revokeInstance(instanceId);
    const cluster = options.sessionServer.getCluster?.();
    const busMode = cluster?.mode === "bus";

    // Single-node: 404 when unknown. Bus mode: cluster-wide revoke always succeeds
    // (shared marker) even if this task never saw the instance.
    if (
      !result.secret_revoked &&
      result.sessions_closed === 0 &&
      !result.cluster_revoked &&
      !busMode
    ) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "instance not found",
          instance_id: instanceId,
        }),
      );
      return true;
    }

    if (
      busMode &&
      !result.secret_revoked &&
      result.sessions_closed === 0 &&
      !result.cluster_revoked
    ) {
      // Unexpected: bus revoke should set cluster_revoked. Still report ok for fan-out.
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        instance_id: result.instance_id,
        secret_revoked: result.secret_revoked,
        sessions_closed: result.sessions_closed,
        close_code: result.close_code,
        cluster_revoked: result.cluster_revoked ?? false,
        relay_behavior:
          "Live gateway WebSocket sessions for this instance are closed with code 4401; subsequent upgrades are rejected.",
      }),
    );
    return true;
  }

  const chatEventsMatch = url.pathname.match(
    /^\/internal\/chat\/([^/]+)\/events$/,
  );
  if (req.method === "GET" && chatEventsMatch) {
    if (!requireInternalToken(options, req, res)) return true;

    const chatId = decodeURIComponent(chatEventsMatch[1] ?? "");
    if (!chatId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "chat_id required" }));
      return true;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const unsubscribe = options.chatHub.subscribe(chatId, (event) => {
      writeSseEvent(res, event);
    });

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return true;
  }

  const chatHistoryMatch = url.pathname.match(
    /^\/internal\/chat\/([^/]+)\/history$/,
  );
  if (req.method === "GET" && chatHistoryMatch) {
    if (!requireInternalToken(options, req, res)) return true;

    const chatId = decodeURIComponent(chatHistoryMatch[1] ?? "");
    if (!chatId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "chat_id required" }));
      return true;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        chat_id: chatId,
        events: options.chatHub.listHistory(chatId),
      }),
    );
    return true;
  }

  return false;
}
