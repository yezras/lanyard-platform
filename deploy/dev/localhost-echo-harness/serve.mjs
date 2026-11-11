#!/usr/bin/env node
/**
 * Localhost echo harness for lp-bhcg.1.
 *
 * Implements the BFF harness HTTP contract enough for one signed-in chat
 * turn: POST /internal/turns returns { turn_id }, GET .../events emits one
 * message_send, and GET /internal/settings/snapshot includes exported_at.
 *
 * This is not a model and not Lanyard Agent. pnpm dev:mock-gateway was
 * removed, and the external harness needs @lanyard-agent/adapters-portal,
 * which is not in this checkout. Chat uses this process when HARNESS_URL
 * points here. Relay still runs for its health check; it is not the hop.
 */
import { randomUUID } from "node:crypto";
import http from "node:http";

const port = Number(process.env.ECHO_HARNESS_PORT ?? 4310);
const token =
  process.env.HARNESS_SERVICE_TOKEN?.trim() || "placeholder-harness-service-token";

/** @type {Map<string, { thread_id?: string, message?: string }>} */
const turns = new Map();

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
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
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const bearer = req.headers.authorization === `Bearer ${token}`;
  const authed =
    req.headers["x-harness-service-token"] === token || bearer;

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "localhost-echo-harness" });
    return;
  }

  if (!authed) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/turns") {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!threadId || !message) {
      sendJson(res, 400, { error: "thread_id and message are required" });
      return;
    }
    const turnId = `turn_${randomUUID()}`;
    turns.set(turnId, { thread_id: threadId, message });
    sendJson(res, 200, { turn_id: turnId });
    return;
  }

  const events = url.pathname.match(/^\/internal\/turns\/([^/]+)\/events$/);
  if (req.method === "GET" && events) {
    const turnId = decodeURIComponent(events[1]);
    const turn = turns.get(turnId);
    if (!turn) {
      sendJson(res, 404, { error: "unknown turn" });
      return;
    }
    const event = {
      type: "message_send",
      chat_id: turn.thread_id,
      message_id: `msg_${randomUUID()}`,
      content: `Echo harness: ${turn.message}`,
      created_at: new Date().toISOString(),
    };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
    return;
  }

  const interrupt = url.pathname.match(
    /^\/internal\/turns\/([^/]+)\/interrupt$/,
  );
  if (req.method === "POST" && interrupt) {
    sendJson(res, 200, { interrupted: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/internal/settings/snapshot") {
    sendJson(res, 200, {
      exported_at: new Date().toISOString(),
      source: "localhost-echo-harness",
      crons: [],
      skills: [],
      mcp_servers: [],
      models: [],
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      service: "localhost-echo-harness",
      port,
      chat_path: "harness",
    }),
  );
});
