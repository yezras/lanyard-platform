import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { ChatDeliveryHub } from "../src/chat-delivery-hub.js";
import {
  DEFAULT_INTERNAL_JSON_MAX_BYTES,
  handleRelayInternalHttp,
  internalTokenMatches,
  readJsonBody,
  RELAY_INTERNAL_TOKEN_HEADER,
  InternalBodyTooLargeError,
} from "../src/internal-http.js";
import { RelaySessionServerImpl } from "../src/relay-session-server.js";
import { InMemorySecretStore } from "../src/secret-store.js";

const INTERNAL_TOKEN = "test-relay-internal-token-p37";

describe("internalTokenMatches (constant-time)", () => {
  it("matches equal tokens and rejects mismatches", () => {
    expect(internalTokenMatches(INTERNAL_TOKEN, INTERNAL_TOKEN)).toBe(true);
    expect(internalTokenMatches(INTERNAL_TOKEN, "wrong-token")).toBe(false);
    expect(internalTokenMatches(INTERNAL_TOKEN, "")).toBe(false);
    expect(internalTokenMatches("a", "b")).toBe(false);
  });
});

describe("readJsonBody size cap", () => {
  it("parses small JSON bodies", async () => {
    const { req, write, end } = makeMockRequest();
    const pending = readJsonBody(req, 1024);
    write(JSON.stringify({ ok: true, n: 1 }));
    end();
    await expect(pending).resolves.toEqual({ ok: true, n: 1 });
  });

  it("aborts early when body exceeds the cap", async () => {
    const { req, write, end } = makeMockRequest();
    const pending = readJsonBody(req, 64);
    // Stream chunks that exceed the cap without waiting for end first.
    write("x".repeat(40));
    write("y".repeat(40));
    // Oversized should reject on the second chunk before end.
    end();
    await expect(pending).rejects.toBeInstanceOf(InternalBodyTooLargeError);
  });
});

describe("POST /internal/* oversized body (lp-p37.8)", () => {
  let closeServer: (() => Promise<void>) | undefined;
  let port = 0;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = undefined;
    }
  });

  async function startServer(maxJsonBodyBytes = 256): Promise<void> {
    const secretStore = new InMemorySecretStore();
    const chatHub = new ChatDeliveryHub();
    const sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      void handleRelayInternalHttp(req, res, url, {
        internalToken: INTERNAL_TOKEN,
        sessionServer,
        chatHub,
        secretStore,
        maxJsonBodyBytes,
      }).then((handled) => {
        if (!handled) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("failed to bind test server");
    }
    port = addr.port;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  }

  it("returns 413 for oversized internal JSON bodies", async () => {
    await startServer(128);
    const huge = JSON.stringify({
      instance_id: "00000000-0000-0000-0000-000000000001",
      event: {
        text: "x".repeat(500),
        source: { chat_id: "c1" },
      },
    });
    expect(Buffer.byteLength(huge, "utf8")).toBeGreaterThan(128);

    const res = await fetch(
      `http://127.0.0.1:${port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: huge,
      },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; max_bytes: number };
    expect(body.error).toMatch(/too large/i);
    expect(body.max_bytes).toBe(128);
  });

  it("still authenticates before accepting a normal-sized body", async () => {
    await startServer(DEFAULT_INTERNAL_JSON_MAX_BYTES);
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: "not-the-token",
        },
        body: JSON.stringify({
          instance_id: "00000000-0000-0000-0000-000000000001",
          event: { text: "hi", source: { chat_id: "c1" } },
        }),
      },
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /internal/instances/:id/credentials (lp-3a1.3)", () => {
  let closeServer: (() => Promise<void>) | undefined;
  let port = 0;
  let secretStore: InMemorySecretStore;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = undefined;
    }
  });

  async function startServer(opts?: {
    internalToken?: string | undefined;
  }): Promise<void> {
    secretStore = new InMemorySecretStore();
    const chatHub = new ChatDeliveryHub();
    const sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
    });

    const token =
      opts && "internalToken" in opts ? opts.internalToken : INTERNAL_TOKEN;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      void handleRelayInternalHttp(req, res, url, {
        internalToken: token,
        sessionServer,
        chatHub,
        secretStore,
      }).then((handled) => {
        if (!handled) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("failed to bind test server");
    }
    port = addr.port;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  }

  it("fail-closed: 503 when internal token is not configured", async () => {
    await startServer({ internalToken: undefined });
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-1/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: "anything",
        },
        body: JSON.stringify({ secret: "s1" }),
      },
    );
    expect(res.status).toBe(503);
  });

  it("rejects missing or wrong internal token with 401", async () => {
    await startServer();
    const noHeader = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-1/credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "s1" }),
      },
    );
    expect(noHeader.status).toBe(401);

    const wrong = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-1/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: "wrong-token",
        },
        body: JSON.stringify({ secret: "s1" }),
      },
    );
    expect(wrong.status).toBe(401);
  });

  it("registers credentials and makes them lookupable (second instance)", async () => {
    await startServer();

    const first = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-a/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          gateway_id: "inst-a",
          secret: "secret-a",
          tenant_id: "tenant-1",
        }),
      },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      ok: boolean;
      instance_id: string;
      secrets_count: number;
      secret?: string;
    };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.instance_id).toBe("inst-a");
    expect(firstBody.secrets_count).toBe(1);
    // Never echo secret material.
    expect(firstBody.secret).toBeUndefined();

    const second = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-b/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          gateway_id: "inst-b",
          secrets: ["secret-b"],
        }),
      },
    );
    expect(second.status).toBe(200);

    expect(secretStore.getByInstanceId("inst-a")?.secrets).toEqual([
      "secret-a",
    ]);
    expect(secretStore.getByGatewayId("inst-b")?.secrets).toEqual(["secret-b"]);
    expect(secretStore.list()).toHaveLength(2);
  });

  it("updates secrets on rotate (dual-accept list)", async () => {
    await startServer();
    const instanceId = "inst-rotate";

    await fetch(
      `http://127.0.0.1:${port}/internal/instances/${instanceId}/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({ secret: "old" }),
      },
    );

    const rotated = await fetch(
      `http://127.0.0.1:${port}/internal/instances/${instanceId}/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          secret: "new",
          rotation_secret: "old",
        }),
      },
    );
    expect(rotated.status).toBe(200);
    expect(secretStore.getByInstanceId(instanceId)?.secrets).toEqual([
      "new",
      "old",
    ]);
  });

  it("defaults gateway_id to path instance_id", async () => {
    await startServer();
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/instances/same-id/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({ secret: "solo" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gateway_id: string };
    expect(body.gateway_id).toBe("same-id");
    expect(secretStore.getByGatewayId("same-id")?.instanceId).toBe("same-id");
  });

  it("returns 400 when secret material is missing", async () => {
    await startServer();
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/instances/inst-1/credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });
});


/** Minimal streaming request double for unit tests. */
function makeMockRequest(): {
  req: IncomingMessage;
  write: (chunk: string | Buffer) => void;
  end: () => void;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    data: [],
    end: [],
    error: [],
  };

  const req = {
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
      return req;
    },
    removeAllListeners(event?: string) {
      if (event) {
        listeners[event] = [];
      } else {
        for (const key of Object.keys(listeners)) {
          listeners[key] = [];
        }
      }
      return req;
    },
    resume() {
      // no-op for mock
    },
  } as unknown as IncomingMessage;

  return {
    req,
    write(chunk) {
      for (const cb of listeners.data ?? []) {
        cb(chunk);
      }
    },
    end() {
      for (const cb of listeners.end ?? []) {
        cb();
      }
    },
  };
}
