/**
 * lp-oop.24 — Daytona toolbox process/execute client.
 * Offline: injectable fake fetch only. No live network / SM / paid org.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REDACTED,
  isToolboxClient,
  parseToolboxExec,
  type ToolboxExec,
} from "@lanyard/shared";

import { DaytonaSandboxNotFoundError } from "../src/daytona-client.js";
import { type DaytonaConfig } from "../src/daytona-config.js";
import {
  DAYTONA_AUTH_HEADER,
  DAYTONA_ORG_HEADER,
  DaytonaHttpError,
  DaytonaTimeoutError,
} from "../src/daytona-sdk-client.js";
import {
  createDaytonaToolboxClient,
  DEFAULT_DAYTONA_TOOLBOX_BASE_URL,
  DaytonaToolboxClient,
  joinToolboxArgv,
  type DaytonaToolboxLogEvent,
} from "../src/daytona-toolbox-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(
  join(__dirname, "../src/daytona-toolbox-client.ts"),
  "utf8",
);
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");

const THROW_AWAY_API_KEY = "test-throwaway-daytona-api-key-not-for-prod";
const THROW_AWAY_SECRET = "test-throwaway-relay-secret-not-for-prod";

function readyConfig(overrides: Partial<DaytonaConfig> = {}): DaytonaConfig {
  return {
    enabled: true,
    apiKey: THROW_AWAY_API_KEY,
    orgId: "org-test-oop24",
    region: "us",
    defaultSnapshotId: "offline:agent-default",
    tenantAllowlist: ["tenant-a"],
    domainAllowList: [],
    autoStopIntervalMinutes: 90,
    warmPoolEnabled: false,
    warmPoolTenantAllowlist: [],
    warmPoolSize: 2,
    archiveRestoreOnWake: false,
    retainSandboxOnStop: true,
    ...overrides,
  };
}

const SECRET_EXEC: ToolboxExec = {
  sandbox_id: "sb-oop24-1",
  argv: ["bash", "-lc", `export GATEWAY_RELAY_SECRET=${THROW_AWAY_SECRET}`],
  cwd: "/mnt/vault",
  timeout_ms: 15_000,
};

type FakeRoute = {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
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

    const parsed = new URL(url);
    const path = parsed.pathname;

    for (const route of routes) {
      if (route.method.toUpperCase() !== method) continue;
      const match =
        typeof route.path === "string"
          ? path === route.path
          : route.path.test(path);
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

    return new Response(
      JSON.stringify({ message: `no route for ${method} ${path}` }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

describe("DaytonaToolboxClient (lp-oop.24)", () => {
  it("implements ToolboxClient and uses the spike toolbox host", () => {
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([]),
    });
    expect(isToolboxClient(client)).toBe(true);
    expect(client).toBeInstanceOf(DaytonaToolboxClient);
    expect(client.toolboxUrl).toBe(DEFAULT_DAYTONA_TOOLBOX_BASE_URL);
    expect(parseToolboxExec(SECRET_EXEC).sandbox_id).toBe("sb-oop24-1");
  });

  it("POSTs process/execute with quoted argv and maps exitCode/result", async () => {
    let seen: {
      url: string;
      headers: Headers;
      bodyText: string | null;
    } | null = null;

    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          body: { exitCode: 0, result: "hello-from-toolbox\n" },
          onRequest: (req) => {
            seen = req;
          },
        },
      ]),
    });

    const result = await client.execute({
      sandbox_id: "sb-oop24-1",
      argv: ["echo", "hello-from-toolbox"],
      cwd: "/mnt/vault",
      timeout_ms: 30_000,
    });

    expect(result).toEqual({
      stdout: "hello-from-toolbox\n",
      stderr: "",
      exit_code: 0,
    });
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe(
      `${DEFAULT_DAYTONA_TOOLBOX_BASE_URL}/toolbox/sb-oop24-1/process/execute`,
    );
    expect(seen!.headers.get(DAYTONA_AUTH_HEADER)).toBe(
      `Bearer ${THROW_AWAY_API_KEY}`,
    );
    expect(seen!.headers.get(DAYTONA_ORG_HEADER)).toBe("org-test-oop24");
    const body = JSON.parse(seen!.bodyText ?? "{}") as Record<string, unknown>;
    expect(body.command).toBe("echo hello-from-toolbox");
    expect(body.cwd).toBe("/mnt/vault");
    expect(body.timeout).toBe(30);
  });

  it("quotes argv that would break a shell join", async () => {
    let command = "";
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          body: { exitCode: 0, result: "" },
          onRequest: (req) => {
            command = (JSON.parse(req.bodyText ?? "{}") as { command?: string })
              .command ?? "";
          },
        },
      ]),
    });
    await client.execute({
      sandbox_id: "sb-oop24-1",
      argv: ["printf", "%s", "hello world"],
      cwd: "/tmp",
      timeout_ms: 5_000,
    });
    expect(command).toBe("printf '%s' 'hello world'");
    expect(joinToolboxArgv(["echo", "it's"])).toBe("echo 'it'\\''s'");
  });

  it("maps stdout/stderr when the API returns them separately", async () => {
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          body: { exit_code: 1, stdout: "out", stderr: "err" },
        },
      ]),
    });
    await expect(client.execute(SECRET_EXEC)).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exit_code: 1,
    });
  });

  it("logSafe never includes raw argv, command, or throwaway secrets", async () => {
    const events: DaytonaToolboxLogEvent[] = [];
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          body: {
            exitCode: 0,
            result: `leaked=${THROW_AWAY_SECRET}`,
          },
        },
      ]),
      logSafe: (event) => {
        events.push(event);
      },
    });

    await client.execute(SECRET_EXEC);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.sandbox_id).toBe("sb-oop24-1");
    expect(event.argv_count).toBe(3);
    expect(event.argv).toBe(REDACTED);
    expect(event.cwd).toBe("/mnt/vault");
    expect(event.exit_code).toBe(0);
    expect(event.stdout_bytes).toBeGreaterThan(0);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(THROW_AWAY_SECRET);
    expect(serialized).not.toContain(THROW_AWAY_API_KEY);
    expect(serialized).not.toContain("GATEWAY_RELAY_SECRET");
    expect(serialized).not.toContain("bash");
    expect(serialized).not.toMatch(/"command"/);
    expect(serialized).not.toContain("leaked=");
  });

  it("maps 404 to DaytonaSandboxNotFoundError without leaking argv", async () => {
    const events: DaytonaToolboxLogEvent[] = [];
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([]),
      logSafe: (event) => {
        events.push(event);
      },
    });
    await expect(client.execute(SECRET_EXEC)).rejects.toBeInstanceOf(
      DaytonaSandboxNotFoundError,
    );
    expect(JSON.stringify(events)).not.toContain(THROW_AWAY_SECRET);
  });

  it("maps non-2xx to DaytonaHttpError", async () => {
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          status: 500,
          body: { message: "toolbox unavailable" },
        },
      ]),
    });
    await expect(client.execute(SECRET_EXEC)).rejects.toBeInstanceOf(
      DaytonaHttpError,
    );
  });

  it("times out via AbortSignal without a live host", async () => {
    const client = createDaytonaToolboxClient({
      config: readyConfig(),
      httpSlackMs: 20,
      fetch: createFakeFetch([
        {
          method: "POST",
          path: "/toolbox/sb-oop24-1/process/execute",
          delayMs: 5_000,
          body: { exitCode: 0, result: "late" },
        },
      ]),
    });
    await expect(
      client.execute({ ...SECRET_EXEC, timeout_ms: 10 }),
    ).rejects.toBeInstanceOf(DaytonaTimeoutError);
  });

  it("client source logs only via redact helpers", () => {
    expect(clientSrc).toContain("redactToolboxExecForLog");
    expect(clientSrc).toContain("redactToolboxLogFields");
    expect(clientSrc).toContain("redactToolboxExecResultForLog");
    expect(indexSrc).toContain("createDaytonaToolboxClient");
    expect(indexSrc).toContain("lp-oop.24");
  });
});
