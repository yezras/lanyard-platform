/**
 * lp-012 — Daytona SDK HTTP wrapper (create/start/stop/archive/get/list).
 * Offline: injectable fake fetch only. No live network / SM / paid org.
 */
import { describe, expect, it } from "vitest";

import {
  DaytonaClientError,
  DaytonaSandboxNotFoundError,
  DaytonaSandboxStateError,
  isDaytonaClient,
  type DaytonaSandbox,
} from "../src/daytona-client.js";
import {
  DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
  type DaytonaConfig,
} from "../src/daytona-config.js";
import { DAYTONA_ENV_REDACTED } from "../src/daytona-env-redact.js";
import {
  createDaytonaSdkClient,
  DAYTONA_AUTH_HEADER,
  DAYTONA_ORG_HEADER,
  DEFAULT_DAYTONA_API_BASE_URL,
  DaytonaHttpError,
  DaytonaSdkClient,
  DaytonaTimeoutError,
  type DaytonaSdkLogEvent,
} from "../src/daytona-sdk-client.js";
import { createInstanceOrchestrator } from "../src/instance-orchestrator.js";

const THROW_AWAY_SECRET = "test-throwaway-relay-secret-not-for-prod";
const THROW_AWAY_API_KEY = "test-throwaway-daytona-api-key-not-for-prod";

function readyConfig(overrides: Partial<DaytonaConfig> = {}): DaytonaConfig {
  return {
    enabled: true,
    apiKey: THROW_AWAY_API_KEY,
    orgId: "org-test-012",
    region: "us",
    defaultSnapshotId: "offline:agent-default",
    tenantAllowlist: ["tenant-a"],
    domainAllowList: [],
    autoStopIntervalMinutes: 90,
    ...overrides,
  };
}

type FakeRoute = {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
  /** Capture last request for assertions. */
  onRequest?: (req: {
    method: string;
    url: string;
    headers: Headers;
    bodyText: string | null;
  }) => void;
};

function createFakeFetch(routes: FakeRoute[]): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body == null
          ? null
          : String(init.body);

    const path = new URL(url).pathname.replace(/^\/api/, "") || "/";
    // baseUrl is https://app.daytona.io/api → pathname /api/sandbox
    const fullPath = new URL(url).pathname;
    const apiPath = fullPath.startsWith("/api")
      ? fullPath.slice(4) || "/"
      : fullPath;

    for (const route of routes) {
      if (route.method.toUpperCase() !== method) continue;
      const match =
        typeof route.path === "string"
          ? apiPath === route.path || fullPath === route.path
          : route.path.test(apiPath) || route.path.test(fullPath);
      if (!match) continue;

      route.onRequest?.({ method, url, headers, bodyText });

      if (route.delayMs && route.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, route.delayMs);
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              clearTimeout(t);
              reject(abortError());
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(abortError());
              },
              { once: true },
            );
          }
        });
      }

      if (route.rawBody !== undefined) {
        return new Response(route.rawBody, {
          status: route.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        route.body === undefined ? "" : JSON.stringify(route.body),
        {
          status: route.status ?? 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ message: `no route for ${method} ${apiPath}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function sandboxBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = "2026-08-04T12:00:00.000Z";
  return {
    id: "sb-012-1",
    state: "started",
    snapshot: "snap-agent-v1",
    target: "us",
    labels: { instance_id: "inst-1", tenant_id: "ten-a" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("DaytonaSdkClient (lp-012)", () => {
  it("implements DaytonaClient and rejects incomplete config", () => {
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([]),
    });
    expect(isDaytonaClient(client)).toBe(true);
    expect(client).toBeInstanceOf(DaytonaSdkClient);
    expect(client.apiBaseUrl).toBe(DEFAULT_DAYTONA_API_BASE_URL);

    expect(() =>
      createDaytonaSdkClient({
        config: readyConfig({ apiKey: "" }),
        fetch: createFakeFetch([]),
      }),
    ).toThrow(/DAYTONA_API_KEY|missing/i);
  });

  it("create → get → list lifecycle with auth headers from config", async () => {
    const captured: Array<{
      method: string;
      url: string;
      headers: Headers;
      bodyText: string | null;
    }> = [];

    const store = new Map<string, Record<string, unknown>>();
    // Handler that echoes env + labels from create request
    const smartFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const bodyText =
        typeof init?.body === "string" ? init.body : null;
      captured.push({ method, url, headers, bodyText });

      const apiPath = new URL(url).pathname.replace(/^\/api/, "") || "/";

      if (method === "POST" && apiPath === "/sandbox") {
        const req = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
        const created = sandboxBody({
          id: "sb-012-create",
          snapshot: req.snapshot,
          target: req.target,
          labels: req.labels ?? {},
          env: req.env ?? {},
          domainAllowList: req.domainAllowList,
        });
        store.set("sb-012-create", created);
        return json(created);
      }
      if (method === "GET" && apiPath === "/sandbox/sb-012-create") {
        return json(store.get("sb-012-create") ?? sandboxBody({ id: "sb-012-create" }));
      }
      if (method === "GET" && apiPath.startsWith("/sandbox")) {
        return json({ items: [...store.values()], total: store.size });
      }
      return json({ message: "not found" }, 404);
    };

    const logs: DaytonaSdkLogEvent[] = [];
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: smartFetch,
      domainAllowList: "relay.withlanyard.com",
      autoStopIntervalMinutes: 30,
      autoDeleteIntervalMinutes: 0,
      logSafe: (e) => logs.push(e),
    });

    const created = await client.create({
      snapshotId: "snap-agent-v1",
      labels: { instance_id: "inst-1", tenant_id: "ten-a" },
      env: {
        GATEWAY_RELAY_INSTANCE_ID: "inst-1",
        GATEWAY_RELAY_SECRET: THROW_AWAY_SECRET,
      },
      mounts: [
        {
          s3Prefix: "tenants/ten-a/vault/",
          mountPath: "/opt/company-brain",
        },
      ],
    });

    assertSandboxShape(created);
    expect(created.sandboxId).toBe("sb-012-create");
    expect(created.state).toBe("started");
    expect(created.snapshotId).toBe("snap-agent-v1");
    expect(created.region).toBe("us");
    expect(created.labels.instance_id).toBe("inst-1");
    // Public record must not expose env
    expect((created as { env?: unknown }).env).toBeUndefined();
    // Mounts preserved from create params when API omits them
    expect(created.mounts).toEqual([
      {
        s3Prefix: "tenants/ten-a/vault/",
        mountPath: "/opt/company-brain",
      },
    ]);

    // Auth + org from config only
    const createReq = captured.find((c) => c.method === "POST");
    expect(createReq).toBeTruthy();
    expect(createReq!.headers.get(DAYTONA_AUTH_HEADER)).toBe(
      `Bearer ${THROW_AWAY_API_KEY}`,
    );
    expect(createReq!.headers.get(DAYTONA_ORG_HEADER)).toBe("org-test-012");
    const createBody = JSON.parse(createReq!.bodyText!) as Record<string, unknown>;
    expect(createBody.snapshot).toBe("snap-agent-v1");
    expect(createBody.target).toBe("us");
    expect(createBody.domainAllowList).toBe("relay.withlanyard.com");
    expect(createBody.autoStopInterval).toBe(30);
    expect(createBody.autoDeleteInterval).toBe(0);
    // No s3Bucket on mount → volumes omitted (env-only path)
    expect(createBody.volumes).toBeUndefined();

    const got = await client.get(created.sandboxId);
    expect(got.sandboxId).toBe(created.sandboxId);

    const listed = await client.list({
      label: { key: "instance_id", value: "inst-1" },
    });
    expect(listed.some((r) => r.sandboxId === created.sandboxId)).toBe(true);

    // Redaction on parse: log must not contain raw secret
    const createLog = logs.find((l) => l.op === "create");
    expect(createLog).toBeTruthy();
    expect(createLog!.envSummary?.keys).toContain("GATEWAY_RELAY_SECRET");
    expect(JSON.stringify(createLog)).not.toContain(THROW_AWAY_SECRET);
    expect(JSON.stringify(createLog)).not.toContain(THROW_AWAY_API_KEY);
    const bodyForLog = createLog!.bodyForLog as {
      env?: Record<string, string>;
    };
    expect(bodyForLog.env?.GATEWAY_RELAY_SECRET).toBe(DAYTONA_ENV_REDACTED);
  });

  it("lp-zuh.9.4: create body omits volumes[] for S3 vault (Mountpoint env path)", async () => {
    const PREFIX = "tenants/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/vault/";
    const BUCKET = "lanyard-mocklab-vault-123456789012";
    const captured: { bodyText: string | null }[] = [];
    const logs: DaytonaSdkLogEvent[] = [];
    const fetchCapture: typeof fetch = async (_input, init) => {
      captured.push({ bodyText: (init?.body as string | undefined) ?? null });
      const req = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      return json(
        sandboxBody({
          id: "sb-zuh94-env-mount",
          snapshot: "snap-agent-v1",
          target: "us",
          volumes: req.volumes ?? [],
          env: req.env ?? {},
        }),
      );
    };
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: fetchCapture,
      logSafe: (e) => logs.push(e),
    });

    const created = await client.create({
      snapshotId: "snap-agent-v1",
      env: {
        VAULT_ROOT: "/mnt/vault",
        S3_VAULT_PREFIX: PREFIX,
        LANYARD_VAULT_BUCKET: BUCKET,
        GATEWAY_RELAY_SECRET: THROW_AWAY_SECRET,
      },
      mounts: [
        {
          s3Prefix: PREFIX,
          mountPath: "/mnt/vault",
          s3Bucket: BUCKET,
        },
      ],
    });

    expect(captured).toHaveLength(1);
    const createBody = JSON.parse(captured[0]!.bodyText!) as {
      volumes?: Array<{
        volumeId: string;
        mountPath: string;
        subpath: string;
      }>;
      env?: Record<string, string>;
    };
    // S3 bucket must not be sent as Daytona volumeId (create 404).
    expect(createBody.volumes).toBeUndefined();
    expect(createBody.env?.VAULT_ROOT).toBe("/mnt/vault");
    expect(createBody.env?.S3_VAULT_PREFIX).toBe(PREFIX);
    expect(createBody.env?.LANYARD_VAULT_BUCKET).toBe(BUCKET);

    // Public mounts metadata still from create params when API volumes empty
    expect(created.sandboxId).toBe("sb-zuh94-env-mount");

    // Redacted logs: secret never in log payload
    const createLog = logs.find((l) => l.op === "create");
    expect(createLog).toBeTruthy();
    expect(JSON.stringify(createLog)).not.toContain(THROW_AWAY_SECRET);
    expect(JSON.stringify(createLog)).not.toContain(THROW_AWAY_API_KEY);
  });

  it("lp-4f2: platform default autoStop (90m) is sent on create as safety net", async () => {
    const captured: { bodyText: string | null }[] = [];
    const fetchCapture: typeof fetch = async (_input, init) => {
      captured.push({ bodyText: (init?.body as string | undefined) ?? null });
      return json(
        sandboxBody({
          id: "sb-autostop-90",
          snapshot: "snap-agent-v1",
          target: "us",
        }),
      );
    };
    const cfg = readyConfig();
    expect(cfg.autoStopIntervalMinutes).toBe(
      DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
    );
    const client = createDaytonaSdkClient({
      config: cfg,
      // Mirror server.ts: pass resolved CP config into create options.
      autoStopIntervalMinutes: cfg.autoStopIntervalMinutes,
      fetch: fetchCapture,
    });
    await client.create({ snapshotId: "snap-agent-v1" });
    const createBody = JSON.parse(captured[0]!.bodyText!) as Record<
      string,
      unknown
    >;
    expect(createBody.autoStopInterval).toBe(90);
    expect(createBody.autoStopInterval).toBe(
      DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
    );
  });

  it("start / stop / archive map to REST paths and return sandbox records", async () => {
    let state = "stopped";
    const id = "sb-lifecycle";
    const fetchSmart: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const apiPath = new URL(url).pathname.replace(/^\/api/, "") || "/";
      if (method === "POST" && apiPath === `/sandbox/${id}/start`) {
        state = "started";
        return json(sandboxBody({ id, state }));
      }
      if (method === "POST" && apiPath === `/sandbox/${id}/stop`) {
        state = "stopped";
        return json(sandboxBody({ id, state }));
      }
      if (method === "POST" && apiPath === `/sandbox/${id}/archive`) {
        state = "archived";
        return json(sandboxBody({ id, state }));
      }
      if (method === "GET" && apiPath === `/sandbox/${id}`) {
        return json(sandboxBody({ id, state }));
      }
      return json({ message: "nope" }, 404);
    };

    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: fetchSmart,
    });

    expect((await client.start(id)).state).toBe("started");
    expect((await client.stop(id)).state).toBe("stopped");
    expect((await client.archive(id)).state).toBe("archived");
    // empty body start → get fallback
    const emptyStartFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const apiPath = new URL(url).pathname.replace(/^\/api/, "") || "/";
      if (method === "POST" && apiPath.endsWith("/start")) {
        return new Response("", { status: 200 });
      }
      if (method === "GET") {
        return json(sandboxBody({ id, state: "started" }));
      }
      return json({}, 404);
    };
    const client2 = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: emptyStartFetch,
    });
    expect((await client2.start(id)).state).toBe("started");
  });

  it("maps 404 to DaytonaSandboxNotFoundError", async () => {
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "GET",
          path: "/sandbox/missing",
          status: 404,
          body: { message: "Sandbox not found" },
        },
      ]),
    });
    await expect(client.get("missing")).rejects.toBeInstanceOf(
      DaytonaSandboxNotFoundError,
    );
  });

  it("maps HTTP errors and timeouts clearly", async () => {
    const httpClient = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/sandbox",
          status: 500,
          body: { message: "internal boom" },
        },
      ]),
    });
    await expect(
      httpClient.create({ snapshotId: "snap" }),
    ).rejects.toMatchObject({
      name: "DaytonaHttpError",
      code: "DAYTONA_HTTP_ERROR",
      status: 500,
    } satisfies Partial<DaytonaHttpError>);

    const slow = createDaytonaSdkClient({
      config: readyConfig(),
      timeoutMs: 30,
      fetch: createFakeFetch([
        {
          method: "GET",
          path: "/sandbox/sb-slow",
          delayMs: 500,
          body: sandboxBody({ id: "sb-slow" }),
        },
      ]),
    });
    await expect(slow.get("sb-slow")).rejects.toBeInstanceOf(DaytonaTimeoutError);
    try {
      await slow.get("sb-slow");
    } catch (e) {
      expect(e).toBeInstanceOf(DaytonaTimeoutError);
      const t = e as DaytonaTimeoutError;
      expect(t.code).toBe("DAYTONA_TIMEOUT");
      expect(t.timeoutMs).toBe(30);
      expect(t.operation).toBe("get");
      expect(t.message).toMatch(/timed out/i);
      // must not leak api key
      expect(t.message).not.toContain(THROW_AWAY_API_KEY);
    }
  });

  it("maps archive conflict to DaytonaSandboxStateError when message hints", async () => {
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/sandbox/sb-arch/start",
          status: 400,
          body: { message: "Cannot start archived sandbox without restore" },
        },
      ]),
    });
    await expect(client.start("sb-arch")).rejects.toBeInstanceOf(
      DaytonaSandboxStateError,
    );
  });

  it("create requires snapshotId", async () => {
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([]),
    });
    await expect(
      client.create({ snapshotId: "  " }),
    ).rejects.toBeInstanceOf(DaytonaClientError);
  });

  it("binds to InstanceOrchestrator boundary", async () => {
    const id = "sb-orch";
    let state = "started";
    const fetchSmart: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const apiPath = new URL(url).pathname.replace(/^\/api/, "") || "/";
      if (method === "POST" && apiPath === "/sandbox") {
        state = "started";
        return json(sandboxBody({ id, state, snapshot: "snap-orch" }));
      }
      if (method === "POST" && apiPath === `/sandbox/${id}/stop`) {
        state = "stopped";
        return json(sandboxBody({ id, state }));
      }
      if (method === "POST" && apiPath === `/sandbox/${id}/start`) {
        state = "started";
        return json(sandboxBody({ id, state }));
      }
      if (method === "POST" && apiPath === `/sandbox/${id}/archive`) {
        state = "archived";
        return json(sandboxBody({ id, state }));
      }
      if (method === "GET" && apiPath === `/sandbox/${id}`) {
        return json(sandboxBody({ id, state }));
      }
      if (method === "GET" && apiPath.startsWith("/sandbox")) {
        return json({ items: [sandboxBody({ id, state })] });
      }
      return json({ message: "nf" }, 404);
    };

    const daytona = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: fetchSmart,
    });
    const orch = createInstanceOrchestrator({ daytona });
    const created = await orch.createSandbox({ snapshotId: "snap-orch" });
    expect(created.snapshotId).toBe("snap-orch");
    await orch.stopSandbox(created.sandboxId);
    expect((await orch.getSandbox(created.sandboxId)).state).toBe("stopped");
    await orch.startSandbox(created.sandboxId);
    expect((await orch.getSandbox(created.sandboxId)).state).toBe("started");
    await orch.archiveSandbox(created.sandboxId);
    expect((await orch.getSandbox(created.sandboxId)).state).toBe("archived");
  });

  it("uses config region when create omits region", async () => {
    let target: string | undefined;
    const client = createDaytonaSdkClient({
      config: readyConfig({ region: "eu" }),
      fetch: async (input, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        target = body.target as string;
        return json(
          sandboxBody({ id: "sb-eu", target: body.target, snapshot: body.snapshot }),
        );
      },
    });
    const s = await client.create({ snapshotId: "snap-1" });
    expect(target).toBe("eu");
    expect(s.region).toBe("eu");
  });

  it("redacts secret-shaped keys in error body snippets", async () => {
    const client = createDaytonaSdkClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/sandbox",
          status: 400,
          rawBody: JSON.stringify({
            message: "bad",
            env: { GATEWAY_RELAY_SECRET: THROW_AWAY_SECRET },
          }),
        },
      ]),
    });
    try {
      await client.create({ snapshotId: "s" });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DaytonaHttpError);
      const err = e as DaytonaHttpError;
      expect(err.bodySnippet ?? "").not.toContain(THROW_AWAY_SECRET);
      expect(err.message).not.toContain(THROW_AWAY_SECRET);
      expect(err.message).not.toContain(THROW_AWAY_API_KEY);
    }
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assertSandboxShape(s: DaytonaSandbox): void {
  expect(typeof s.sandboxId).toBe("string");
  expect(s.sandboxId.length).toBeGreaterThan(0);
  expect(typeof s.state).toBe("string");
  expect(typeof s.snapshotId).toBe("string");
  expect(typeof s.region).toBe("string");
  expect(s.labels).toBeTypeOf("object");
  expect(Array.isArray(s.mounts)).toBe(true);
  expect(typeof s.createdAt).toBe("string");
  expect(typeof s.updatedAt).toBe("string");
}

