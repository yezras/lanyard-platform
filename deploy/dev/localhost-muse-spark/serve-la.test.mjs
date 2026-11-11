import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SCHEDULED_TASK_CREATE_TOOL_NAME,
  SCHEDULED_TASK_TOOL_NAME,
  applyLocalhostScheduledTaskEnv,
  ensureScheduledTaskTools,
  hasScheduledTaskTool,
  startMuseSparkHarness,
} from "./serve-la.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

describe("serve-la.mjs source contract", () => {
  it("does not ship a Meta complete() wrapper", () => {
    const src = readFileSync(join(DIR, "serve-la.mjs"), "utf8");
    assert.doesNotMatch(src, /function\s+metaComplete/);
    assert.doesNotMatch(src, /fetch\(\s*["']https:\/\/api\.meta\.ai/);
    assert.match(src, /createEnvLiteLlmTurnRunner/);
    assert.match(src, /is never passed/);
  });
});

describe("startMuseSparkHarness", () => {
  it("binds createEnvLiteLlmTurnRunner without complete and starts the server", async () => {
    const factoryCalls = [];
    const servers = [];
    const fakeRunner = { run: async () => {} };
    const mod = {
      createEnvLiteLlmTurnRunner: (env, options) => {
        factoryCalls.push({ env, options });
        return fakeRunner;
      },
      createHarnessTurnServer: (opts) => {
        assert.equal(opts.runner, fakeRunner);
        assert.equal(opts.complete, undefined);
        const server = {
          boundPort: 0,
          async start() {
            servers.push(server);
          },
          async stop() {},
        };
        return server;
      },
    };

    const started = await startMuseSparkHarness({
      env: {
        LITELLM_BASE_URL: "https://api.meta.ai/v1",
        LITELLM_API_KEY: "test-not-a-secret",
        HARNESS_MODEL: "muse-spark-1.2-contributor",
        LANYARD_HARNESS_PORT: "0",
      },
      modulePath: "/does-not-matter",
      mod,
    });
    assert.equal(started.baseUrl, "https://api.meta.ai");
    assert.equal(started.model, "muse-spark-1.2-contributor");
    assert.equal(factoryCalls.length, 1);
    assert.equal(factoryCalls[0].options, undefined);
    assert.equal(factoryCalls[0].env.LITELLM_BASE_URL, "https://api.meta.ai");
    assert.equal(servers.length, 1);
    assert.equal(started.runnerKind, "litellm");
  });

  it("prefers createEnvToolsTurnRunner so scheduled_task can be advertised", async () => {
    const toolsCalls = [];
    const liteCalls = [];
    const toolsRunner = { run: async () => {} };
    const mod = {
      createEnvToolsTurnRunner: (env, options) => {
        toolsCalls.push({ env, options });
        return toolsRunner;
      },
      createEnvLiteLlmTurnRunner: (env, options) => {
        liteCalls.push({ env, options });
        return { run: async () => {} };
      },
      createHarnessTurnServer: (opts) => {
        assert.equal(opts.complete, undefined);
        assert.equal(typeof opts.runner.run, "function");
        assert.ok(
          opts.runner.toolNames.includes(SCHEDULED_TASK_CREATE_TOOL_NAME) ||
            opts.runner.toolNames.includes(SCHEDULED_TASK_TOOL_NAME),
        );
        return {
          boundPort: 0,
          async start() {},
          async stop() {},
        };
      },
    };

    const started = await startMuseSparkHarness({
      env: {
        LITELLM_BASE_URL: "https://api.meta.ai",
        LITELLM_API_KEY: "test-not-a-secret",
        BACKEND_HOME: "/tmp/muse-spark-backend",
        LANYARD_HARNESS_PORT: "0",
      },
      modulePath: "/does-not-matter",
      mod,
    });
    assert.equal(started.runnerKind, "tools");
    assert.equal(toolsCalls.length, 1);
    assert.equal(toolsCalls[0].options.backendHome, "/tmp/muse-spark-backend");
    assert.equal(liteCalls.length, 0);
    assert.ok(toolsCalls[0].env.CONTROL_PLANE_URL);
    assert.ok(toolsCalls[0].env.CONTROL_PLANE_SERVICE_TOKEN);
    assert.ok(
      started.toolNames.includes(SCHEDULED_TASK_CREATE_TOOL_NAME) ||
        started.toolNames.includes(SCHEDULED_TASK_TOOL_NAME),
      `tool names should include scheduled_task, got ${JSON.stringify(started.toolNames)}`,
    );
  });

  it("does not silently fall back to LiteLLM when the tools runner throws", async () => {
    let liteCalls = 0;
    const mod = {
      createEnvToolsTurnRunner: () => {
        throw new Error("cron host missing");
      },
      createEnvLiteLlmTurnRunner: () => {
        liteCalls += 1;
        return { run: async () => {} };
      },
      createHarnessTurnServer: () => {
        throw new Error("should not start");
      },
    };
    await assert.rejects(
      () =>
        startMuseSparkHarness({
          env: {
            LITELLM_BASE_URL: "https://api.meta.ai",
            LITELLM_API_KEY: "test-not-a-secret",
            LANYARD_HARNESS_PORT: "0",
          },
          modulePath: "/does-not-matter",
          mod,
        }),
      /not falling back to LiteLLM/,
    );
    assert.equal(liteCalls, 0);
  });
});

describe("localhost scheduled_task advertise", () => {
  it("fills CONTROL_PLANE_URL + token so LA can register scheduled_task", () => {
    const applied = applyLocalhostScheduledTaskEnv({
      LITELLM_API_KEY: "test-not-a-secret",
      DEMO_ENV_PATH: "/no-such-demo-env",
      LANYARD_DEMO_ENV: "/no-such-demo-env",
    });
    assert.equal(applied.CONTROL_PLANE_URL, "http://127.0.0.1:3100");
    assert.ok(applied.CONTROL_PLANE_SERVICE_TOKEN);
  });

  it("ensureScheduledTaskTools injects scheduled_task.create when missing", () => {
    const tools = ensureScheduledTaskTools([]);
    assert.equal(hasScheduledTaskTool(tools), true);
    assert.ok(
      tools.some((tool) => tool.function.name === SCHEDULED_TASK_CREATE_TOOL_NAME),
    );
  });
});
