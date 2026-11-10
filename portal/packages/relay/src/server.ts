import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { RELAY_UNAUTHORIZED_CLOSE_CODE } from "@lanyard/shared";
import type { ChatDeliveryHub } from "./chat-delivery-hub.js";
import {
  handleRelayInternalHttp,
  type RelayInternalHttpOptions,
} from "./internal-http.js";
import type { RelaySessionServer, RelaySessionServerImpl } from "./relay-session-server.js";
import type { SecretStore } from "./secret-store.js";

export interface RelayServerConfig {
  host?: string;
  port?: number;
  relayPath?: string;
  sessionServer: RelaySessionServer;
  chatHub: ChatDeliveryHub;
  secretStore: SecretStore;
  internalToken?: string;
}

export interface RelayServerHandle {
  host: string;
  port: number;
  relayPath: string;
  close(): Promise<void>;
}

function normalizeRelayPath(path: string): string {
  const trimmed = path.trim() || "/relay";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function createRelayServer(
  config: RelayServerConfig,
): Promise<RelayServerHandle> {
  const relayPath = normalizeRelayPath(config.relayPath ?? "/relay");
  const sessionServer = config.sessionServer;

  // Start cluster bus subscriptions before accepting traffic (G6).
  if (
    "startCluster" in sessionServer &&
    typeof (sessionServer as RelaySessionServerImpl).startCluster === "function"
  ) {
    await (sessionServer as RelaySessionServerImpl).startCluster();
  }

  const internalOptions: RelayInternalHttpOptions = {
    internalToken: config.internalToken ?? process.env.RELAY_INTERNAL_TOKEN,
    sessionServer,
    chatHub: config.chatHub,
    secretStore: config.secretStore,
  };

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res, relayPath, internalOptions, sessionServer);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== relayPath) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    void (async () => {
      const auth = await sessionServer.authenticateUpgrade(req);
      if (!auth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, auth.gatewayId);
      });
    })().catch(() => {
      try {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      } catch {
        // ignore
      }
      socket.destroy();
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, gatewayId: string) => {
    try {
      sessionServer.acceptConnection(ws, gatewayId);
    } catch {
      ws.close(RELAY_UNAUTHORIZED_CLOSE_CODE, "unauthorized");
    }
  });

  const host = config.host ?? "0.0.0.0";
  const port = config.port ?? 0;

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind relay server");
  }

  return {
    host,
    port: address.port,
    relayPath,
    close: async () => {
      if (
        "stopCluster" in sessionServer &&
        typeof (sessionServer as RelaySessionServerImpl).stopCluster ===
          "function"
      ) {
        await (sessionServer as RelaySessionServerImpl).stopCluster();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((wssErr) => {
          if (wssErr) reject(wssErr);
          else {
            httpServer.close((httpErr) => {
              if (httpErr) reject(httpErr);
              else resolve();
            });
          }
        });
      });
    },
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  relayPath: string,
  internalOptions: RelayInternalHttpOptions,
  sessionServer: RelaySessionServer,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  const handled = await handleRelayInternalHttp(req, res, url, internalOptions);
  if (handled) return;

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "relay" }));
    return;
  }

  // G6 readiness: single mode always ready; bus mode requires Redis PING.
  if (req.method === "GET" && url.pathname === "/ready") {
    const cluster = sessionServer.getCluster?.();
    if (!cluster || cluster.mode === "single") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          service: "relay",
          mode: cluster?.mode ?? "single",
        }),
      );
      return;
    }

    const ok = await cluster.ready();
    if (!ok) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "not_ready",
          service: "relay",
          mode: "bus",
          error: "redis_unavailable",
        }),
      );
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ready",
        service: "relay",
        mode: "bus",
        node_id: cluster.nodeId,
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === relayPath) {
    res.writeHead(426, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "upgrade_required",
        message: "WebSocket upgrade required",
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}
