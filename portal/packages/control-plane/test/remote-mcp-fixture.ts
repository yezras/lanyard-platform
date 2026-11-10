/**
 * In-process remote MCP fixture servers for lp-hdzm.26.
 *
 * streamable-http: JSON-RPC POST (initialize, tools/list, tools/call).
 * sse-only: GET event-stream, POST refused.
 * oauth: 401 + WWW-Authenticate (MCP OAuth, not implemented this epic).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FIXTURE_TOOL_NAME = "get_account_info";
export const FIXTURE_TOKEN = "sk_test_remote_mcp_fixture";
export const FIXTURE_ACCOUNT_ID = "acct_fixture";

export type RemoteMcpFixtureMode = "streamable-http" | "sse-only" | "oauth";

export type RemoteMcpFixtureServer = {
  url: string;
  mode: RemoteMcpFixtureMode;
  posts: Array<{ method: string; authorization: string | undefined }>;
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(extra ?? {}),
  });
  res.end(JSON.stringify(body));
}

function rpcResult(
  res: ServerResponse,
  id: unknown,
  result: unknown,
  extra?: Record<string, string>,
): void {
  json(res, 200, { jsonrpc: "2.0", id, result }, extra);
}

async function handleStreamable(
  req: IncomingMessage,
  res: ServerResponse,
  posts: RemoteMcpFixtureServer["posts"],
  expectedBearer: string,
): Promise<void> {
  if (req.method === "DELETE") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST, DELETE" });
    res.end();
    return;
  }
  const authorization = req.headers.authorization;
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await readBody(req);
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json(res, 400, { error: "invalid_json" });
    return;
  }
  const method = typeof parsed.method === "string" ? parsed.method : "";
  posts.push({ method, authorization });
  if (authorization !== expectedBearer) {
    json(
      res,
      401,
      { error: "unauthorized" },
      {
        "www-authenticate":
          'Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="https://mcp.fixture.test/.well-known/oauth-protected-resource"',
      },
    );
    return;
  }
  const id = parsed.id ?? null;
  if (method === "initialize") {
    rpcResult(
      res,
      id,
      {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "lanyard-mcp-fixture", version: "1" },
      },
      { "mcp-session-id": "sess_fixture" },
    );
    return;
  }
  if (method === "notifications/initialized") {
    res.writeHead(202);
    res.end();
    return;
  }
  if (method === "tools/list") {
    rpcResult(res, id, {
      tools: [
        {
          name: FIXTURE_TOOL_NAME,
          description: "Read the fixture account",
          inputSchema: {
            type: "object",
            properties: {
              api_key: { type: "string" },
              limit: { type: "integer" },
            },
          },
        },
      ],
    });
    return;
  }
  if (method === "tools/call") {
    const params =
      parsed.params && typeof parsed.params === "object"
        ? (parsed.params as Record<string, unknown>)
        : {};
    if (params.name !== FIXTURE_TOOL_NAME) {
      json(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool ${String(params.name)}` },
      });
      return;
    }
    rpcResult(res, id, {
      content: [{ type: "text", text: JSON.stringify({ id: FIXTURE_ACCOUNT_ID }) }],
    });
    return;
  }
  json(res, 200, {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method ${method}` },
  });
}

function handleSseOnly(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write("event: endpoint\ndata: /messages?sessionId=sse_only\n\n");
    return;
  }
  res.writeHead(405, { allow: "GET" });
  res.end();
}

function handleOauth(res: ServerResponse): void {
  json(
    res,
    401,
    { error: "unauthorized" },
    {
      "www-authenticate":
        'Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="https://mcp.oauth.test/.well-known/oauth-protected-resource"',
    },
  );
}

export async function startRemoteMcpFixture(
  mode: RemoteMcpFixtureMode,
  options?: { token?: string },
): Promise<RemoteMcpFixtureServer> {
  const posts: RemoteMcpFixtureServer["posts"] = [];
  const expectedBearer = `Bearer ${options?.token ?? FIXTURE_TOKEN}`;
  const server = createServer((req, res) => {
    void (async () => {
      if (mode === "sse-only") {
        handleSseOnly(req, res);
        return;
      }
      if (mode === "oauth") {
        handleOauth(res);
        return;
      }
      await handleStreamable(req, res, posts, expectedBearer);
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("remote MCP fixture failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    mode,
    posts,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
