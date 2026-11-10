/**
 * Agent backend connection (lp-bhcg.2).
 *
 * Three fields: base_url, api_key, protocol (`openai_chat` | `lanyard_harness`).
 * The API key is a bearer token. This path does not call Cognito, Secrets
 * Manager, Relay, or a Hermes default model.
 */

import { randomUUID } from "node:crypto";

import {
  parseHarnessSseDataLine,
  type TurnRequest,
} from "@lanyard/shared";

export const AGENT_BACKEND_PROTOCOLS = ["openai_chat", "lanyard_harness"] as const;

export type AgentBackendProtocol = (typeof AGENT_BACKEND_PROTOCOLS)[number];

export type AgentBackendConfig = {
  baseUrl: string;
  apiKey: string;
  protocol: AgentBackendProtocol;
  /** OpenAI chat model name. One model is enough. */
  model: string;
};

export type AgentBackendTurnResult =
  | {
      ok: true;
      content: string;
      message_id: string;
      created_at: string;
    }
  | { ok: false; status: number; error: string };

export type AgentBackendFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const HARNESS_TURNS_PATH = "/internal/turns";

export function loadAgentBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentBackendConfig | undefined {
  const baseUrl = env.AGENT_BACKEND_BASE_URL?.trim() || "";
  const apiKey = env.AGENT_BACKEND_API_KEY?.trim() || "";
  const protocolRaw = env.AGENT_BACKEND_PROTOCOL?.trim() || "";
  if (!baseUrl && !apiKey && !protocolRaw) return undefined;
  if (!baseUrl || !apiKey || !protocolRaw) {
    throw new Error(
      "AGENT_BACKEND_BASE_URL, AGENT_BACKEND_API_KEY, and AGENT_BACKEND_PROTOCOL must be set together",
    );
  }
  if (!isAgentBackendProtocol(protocolRaw)) {
    throw new Error(
      "AGENT_BACKEND_PROTOCOL must be openai_chat or lanyard_harness",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("AGENT_BACKEND_BASE_URL must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AGENT_BACKEND_BASE_URL must be an http(s) URL");
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    protocol: protocolRaw,
    model: env.AGENT_BACKEND_MODEL?.trim() || "default",
  };
}

export function isAgentBackendProtocol(
  value: string,
): value is AgentBackendProtocol {
  return (AGENT_BACKEND_PROTOCOLS as readonly string[]).includes(value);
}

function bearerHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  return headers;
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as { error?: unknown };
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
    if (record.error && typeof record.error === "object") {
      const message = (record.error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  if (status === 401 || status === 403) {
    return "Agent backend rejected the API key";
  }
  return `Agent backend request failed (${status})`;
}

function openaiAssistantText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function success(content: string): AgentBackendTurnResult {
  return {
    ok: true,
    content,
    message_id: `msg_${randomUUID()}`,
    created_at: new Date().toISOString(),
  };
}

async function completeOpenAiChat(input: {
  config: AgentBackendConfig;
  message: string;
  fetchImpl: AgentBackendFetch;
}): Promise<AgentBackendTurnResult> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.config.baseUrl, {
      method: "POST",
      headers: bearerHeaders(input.config.apiKey),
      body: JSON.stringify({
        model: input.config.model,
        messages: [{ role: "user", content: input.message }],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error:
        error instanceof Error
          ? error.message
          : "Agent backend is unreachable",
    };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: errorText(body, response.status),
    };
  }
  const content = openaiAssistantText(body);
  if (!content) {
    return {
      ok: false,
      status: 502,
      error: "Agent backend completed without an assistant message",
    };
  }
  return success(content);
}

async function completeLanyardHarness(input: {
  config: AgentBackendConfig;
  turn: TurnRequest;
  fetchImpl: AgentBackendFetch;
}): Promise<AgentBackendTurnResult> {
  const origin = input.config.baseUrl;
  let started: Response;
  try {
    started = await input.fetchImpl(`${origin}${HARNESS_TURNS_PATH}`, {
      method: "POST",
      headers: bearerHeaders(input.config.apiKey),
      body: JSON.stringify(input.turn),
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error:
        error instanceof Error
          ? error.message
          : "Agent backend is unreachable",
    };
  }
  const startBody = await readJson(started);
  if (!started.ok) {
    return {
      ok: false,
      status: started.status,
      error: errorText(startBody, started.status),
    };
  }
  const turnId =
    startBody &&
    typeof startBody === "object" &&
    typeof (startBody as { turn_id?: unknown }).turn_id === "string"
      ? (startBody as { turn_id: string }).turn_id.trim()
      : "";
  if (!turnId) {
    return {
      ok: false,
      status: 502,
      error: "Agent backend start turn response missing turn_id",
    };
  }

  let events: Response;
  try {
    events = await input.fetchImpl(
      `${origin}${HARNESS_TURNS_PATH}/${encodeURIComponent(turnId)}/events`,
      {
        method: "GET",
        headers: bearerHeaders(input.config.apiKey),
      },
    );
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error:
        error instanceof Error
          ? error.message
          : "Agent backend event stream is unreachable",
    };
  }
  if (!events.ok) {
    const body = await readJson(events);
    return {
      ok: false,
      status: events.status,
      error: errorText(body, events.status),
    };
  }
  const sse = await events.text();
  for (const line of sse.split("\n")) {
    const event = parseHarnessSseDataLine(line);
    if (event?.type === "message_send" && event.content?.trim()) {
      return success(event.content);
    }
  }
  return {
    ok: false,
    status: 502,
    error: "Agent backend completed without an assistant message",
  };
}

/**
 * One chat turn against the configured backend. A rejected key returns the
 * backend error. There is no Hermes/LiteLLM fallback.
 */
export async function completeAgentBackendTurn(input: {
  config: AgentBackendConfig;
  turn: TurnRequest;
  fetchImpl?: AgentBackendFetch;
}): Promise<AgentBackendTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.config.protocol === "openai_chat") {
    return completeOpenAiChat({
      config: input.config,
      message: input.turn.message,
      fetchImpl,
    });
  }
  return completeLanyardHarness({
    config: input.config,
    turn: input.turn,
    fetchImpl,
  });
}

export type AgentBackendSettingsRuntime = {
  snapshot(ctx: unknown): Promise<Record<string, unknown>>;
};

/**
 * Hermes-named settings go through BackendRuntimeService (`settings.snapshot`).
 * This helper does not read HERMES_HOME. When the runtime is off, the caller
 * gets the offline fixture instead of a Hermes default tree.
 */
export async function resolveAgentBackendSettings(input: {
  runtime: AgentBackendSettingsRuntime | null;
  ctx: unknown;
  loadFixture: () => Promise<Record<string, unknown>>;
}): Promise<{ source: "backend_runtime" | "fixture"; snapshot: Record<string, unknown> }> {
  if (input.runtime) {
    return {
      source: "backend_runtime",
      snapshot: await input.runtime.snapshot(input.ctx),
    };
  }
  return { source: "fixture", snapshot: await input.loadFixture() };
}
