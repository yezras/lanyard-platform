import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  completeAgentBackendTurn,
  loadAgentBackendConfig,
  resolveAgentBackendSettings,
  type AgentBackendConfig,
} from "../src/agent-backend.js";

const turn = {
  tenant_id: "ten_1",
  user_id: "usr_1",
  instance_id: "ins_1",
  thread_id: "thr_1",
  message: "hello from localhost",
};

function listen(handler: http.RequestListener): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

describe("loadAgentBackendConfig", () => {
  it("requires the three fields together", () => {
    expect(loadAgentBackendConfig({})).toBeUndefined();
    expect(() =>
      loadAgentBackendConfig({ AGENT_BACKEND_BASE_URL: "http://127.0.0.1:9" }),
    ).toThrow(/must be set together/);
  });

  it("rejects an unknown protocol", () => {
    expect(() =>
      loadAgentBackendConfig({
        AGENT_BACKEND_BASE_URL: "http://127.0.0.1:9/v1/chat/completions",
        AGENT_BACKEND_API_KEY: "sk-test",
        AGENT_BACKEND_PROTOCOL: "hermes",
      }),
    ).toThrow(/openai_chat or lanyard_harness/);
  });
});

describe("completeAgentBackendTurn", () => {
  it("openai_chat posts the chat completions URL with the bearer key", async () => {
    let auth = "";
    let body = "";
    const server = await listen(async (req, res) => {
      auth = req.headers.authorization ?? "";
      body = await readBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "openai says hi" } }],
        }),
      );
    });
    try {
      const config: AgentBackendConfig = {
        baseUrl: `${server.url}/v1/chat/completions`,
        apiKey: "sk-good",
        protocol: "openai_chat",
        model: "default",
      };
      const result = await completeAgentBackendTurn({ config, turn });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe("openai says hi");
      expect(auth).toBe("Bearer sk-good");
      expect(JSON.parse(body)).toMatchObject({
        model: "default",
        messages: [{ role: "user", content: "hello from localhost" }],
      });
    } finally {
      await server.close();
    }
  });

  it("openai_chat surfaces a bad API key and does not invent a Hermes reply", async () => {
    const calls: string[] = [];
    const server = await listen(async (req, res) => {
      calls.push(req.url ?? "");
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });
    try {
      const result = await completeAgentBackendTurn({
        config: {
          baseUrl: `${server.url}/v1/chat/completions`,
          apiKey: "sk-bad",
          protocol: "openai_chat",
          model: "default",
        },
        turn,
      });
      expect(result).toMatchObject({
        ok: false,
        status: 401,
        error: "invalid api key",
      });
      expect(calls).toEqual(["/v1/chat/completions"]);
      expect(JSON.stringify(result).toLowerCase()).not.toContain("hermes");
    } finally {
      await server.close();
    }
  });

  it("lanyard_harness posts the turn and reads message_send", async () => {
    let sawBearer = false;
    const server = await listen(async (req, res) => {
      sawBearer = req.headers.authorization === "Bearer harness-key";
      if (req.method === "POST" && req.url === "/internal/turns") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ turn_id: "turn_test" }));
        return;
      }
      if (req.method === "GET" && req.url === "/internal/turns/turn_test/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({
            type: "message_send",
            chat_id: "thr_1",
            content: "harness says hi",
          })}\n\n`,
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const result = await completeAgentBackendTurn({
        config: {
          baseUrl: server.url,
          apiKey: "harness-key",
          protocol: "lanyard_harness",
          model: "default",
        },
        turn,
      });
      expect(sawBearer).toBe(true);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe("harness says hi");
    } finally {
      await server.close();
    }
  });

  it("lanyard_harness fails visibly on a bad API key", async () => {
    const server = await listen((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    try {
      const result = await completeAgentBackendTurn({
        config: {
          baseUrl: server.url,
          apiKey: "nope",
          protocol: "lanyard_harness",
          model: "default",
        },
        turn,
      });
      expect(result).toMatchObject({
        ok: false,
        status: 401,
        error: "unauthorized",
      });
    } finally {
      await server.close();
    }
  });
});

describe("resolveAgentBackendSettings", () => {
  it("reads Hermes-named settings through the backend runtime snapshot", async () => {
    const result = await resolveAgentBackendSettings({
      runtime: {
        snapshot: async () => ({
          exported_at: "2026-10-15T00:00:00Z",
          source: "backend_runtime",
          crons: [],
        }),
      },
      ctx: { tenant_id: "ten_1" },
      loadFixture: async () => {
        throw new Error("fixture must not run when the runtime is present");
      },
    });
    expect(result.source).toBe("backend_runtime");
    expect(result.snapshot.source).toBe("backend_runtime");
  });

  it("uses the offline fixture when the runtime is off and does not import Hermes discovery", async () => {
    const source = readFileSync(
      new URL("../src/agent-backend.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("discoverSettingsFromHermes");
    expect(source).not.toMatch(/from ["']@aws-sdk/);
    expect(source).not.toMatch(/cognito-identity|SecretsManager|secretsmanager/);
    const result = await resolveAgentBackendSettings({
      runtime: null,
      ctx: {},
      loadFixture: async () => ({ exported_at: "fixture", crons: [] }),
    });
    expect(result.source).toBe("fixture");
  });
});
