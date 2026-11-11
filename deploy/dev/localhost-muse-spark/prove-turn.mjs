#!/usr/bin/env node
/**
 * One harness turn through createEnvLiteLlmTurnRunner (lp-k5c4.17).
 *
 * Default: mock fetch (no network). LIVE=1 uses real Muse Spark.
 * Never logs API keys. Writes JSON evidence to stdout.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  MUSE_SPARK_LITELLM_BASE_URL,
  MUSE_SPARK_MODEL,
  applyMuseSparkLiteLlmEnv,
  liteLlmChatCompletionsUrl,
} from "./litellm-base-url.mjs";

const LIVE = /^(1|true|yes)$/i.test(String(process.env.LIVE || "").trim());

function fail(message) {
  console.error(`[prove-muse-spark] ${message}`);
  process.exit(1);
}

function resolveModule(env) {
  const requested = env.HARNESS_MODULE?.trim();
  const agentRoot = env.LANYARD_AGENT_ROOT?.trim();
  const candidates = [];
  if (requested) candidates.push(requested);
  if (agentRoot) {
    candidates.push(
      `${agentRoot}/packages/adapters-portal/dist/harness/index.js`,
      `${agentRoot}/packages/adapters-portal/dist/index.js`,
    );
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "";
}

function parseSseMessageSends(body) {
  const events = [];
  for (const block of body.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        events.push(JSON.parse(raw));
      } catch {
        // ignore non-JSON frames
      }
    }
  }
  return events.filter((event) => event && event.type === "message_send");
}

function mockFetchFactory(calls) {
  const expected = liteLlmChatCompletionsUrl(MUSE_SPARK_LITELLM_BASE_URL);
  return async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url,
      method: init?.method ?? "GET",
      has_authorization: headers.has("authorization"),
    });
    if (url !== expected) {
      return new Response(
        JSON.stringify({ error: { message: `unexpected url ${url}` } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const parsed = JSON.parse(body || "{}");
    const model = parsed.model || MUSE_SPARK_MODEL;
    return new Response(
      JSON.stringify({
        id: "cmpl_muse_spark_fixture",
        model,
        choices: [
          {
            message: {
              role: "assistant",
              content: "pong from muse spark fixture",
            },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function main() {
  const env = applyMuseSparkLiteLlmEnv(process.env);
  const modulePath = resolveModule(env);
  if (!modulePath) {
    fail("set LANYARD_AGENT_ROOT to a built lanyard-agent checkout");
  }

  const key =
    (typeof env.LITELLM_API_KEY === "string" && env.LITELLM_API_KEY.trim()) ||
    (typeof env.LITELLM_MASTER_KEY === "string" &&
      env.LITELLM_MASTER_KEY.trim()) ||
    "";
  if (LIVE && !key) {
    fail("LIVE=1 requires LITELLM_API_KEY or META_API_KEY");
  }
  if (!LIVE && !key) {
    env.LITELLM_API_KEY = "test-not-a-secret";
  }

  const mod = await import(pathToFileURL(modulePath).href);
  if (typeof mod.createEnvLiteLlmTurnRunner !== "function") {
    fail("createEnvLiteLlmTurnRunner not exported");
  }
  if (typeof mod.createHarnessTurnServer !== "function") {
    fail("createHarnessTurnServer not exported");
  }

  const calls = [];
  const runnerOptions = LIVE
    ? {}
    : { fetch: mockFetchFactory(calls) };
  const runner = mod.createEnvLiteLlmTurnRunner(env, runnerOptions);
  if (!runner) {
    fail("createEnvLiteLlmTurnRunner returned null");
  }

  const token = env.LANYARD_HARNESS_SERVICE_TOKEN || "placeholder-harness-service-token";
  const server = mod.createHarnessTurnServer({
    host: "127.0.0.1",
    port: 0,
    serviceToken: token,
    runner,
  });
  await server.start();
  const origin = `http://127.0.0.1:${server.boundPort}`;
  const header = mod.HARNESS_SERVICE_TOKEN_HEADER || "x-harness-service-token";
  const turnsPath = mod.HARNESS_TURNS_PATH || "/internal/turns";

  try {
    const created = await fetch(`${origin}${turnsPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [header]: token,
      },
      body: JSON.stringify({
        tenant_id: "ten_muse_spark",
        user_id: "usr_muse_spark",
        instance_id: "inst_muse_spark",
        thread_id: "thr_muse_spark",
        message: LIVE ? "Reply with the single word pong." : "hello",
      }),
    });
    if (created.status !== 200) {
      fail(`startTurn HTTP ${created.status}`);
    }
    const { turn_id: turnId } = (await created.json());
    const eventsPath =
      typeof mod.harnessTurnEventsPath === "function"
        ? mod.harnessTurnEventsPath(turnId)
        : `${turnsPath}/${turnId}/events`;
    const res = await fetch(`${origin}${eventsPath}`, {
      headers: { [header]: token },
    });
    const body = await res.text();
    const sends =
      typeof mod.parseHarnessSseBody === "function"
        ? mod.parseHarnessSseBody(body).filter((e) => e.type === "message_send")
        : parseSseMessageSends(body);
    const content = typeof sends[0]?.content === "string" ? sends[0].content.trim() : "";
    if (!content) {
      fail("message_send content was empty");
    }
    if (/^echo:/i.test(content)) {
      fail("message_send must not use echo: prefix");
    }
    if (!LIVE) {
      if (calls.length !== 1) fail(`expected 1 LiteLLM fetch, got ${calls.length}`);
      if (calls[0].url !== liteLlmChatCompletionsUrl(env.LITELLM_BASE_URL)) {
        fail(`LiteLLM posted ${calls[0].url}`);
      }
      if (calls[0].url.includes("/v1/v1/")) {
        fail("double /v1/v1 path");
      }
    }

    const evidence = {
      ok: true,
      bead_id: "lp-k5c4.17",
      live: LIVE,
      runner: "createEnvLiteLlmTurnRunner",
      complete: null,
      litellm_base_url: env.LITELLM_BASE_URL,
      chat_completions_url: liteLlmChatCompletionsUrl(env.LITELLM_BASE_URL),
      model: env.HARNESS_MODEL ?? env.LANYARD_DEFAULT_MODEL ?? null,
      message_send: {
        count: sends.length,
        content_len: content.length,
        content_preview: content.slice(0, 240),
        echo_prefix: false,
      },
      fetch_url: LIVE ? null : calls[0]?.url ?? null,
    };
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await server.stop();
  }
}

await main();
