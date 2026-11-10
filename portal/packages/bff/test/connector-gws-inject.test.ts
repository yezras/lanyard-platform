import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { cookieHeader, createTestBindings, parseSetCookie } from "./test-helpers.js";
import { createTestBindings as _createTestBindings } from "./test-helpers.js";

import type { TenantContext } from "../src/types.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  raw: string;
  cookies: Record<string, string>;
}> {
  const headers = new Headers(init.headers);
  if (init.host) headers.set("host", init.host);
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }
  const response = await app.request(path, { ...init, headers });
  const raw = await response.text();
  const body = (raw ? JSON.parse(raw) : {}) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, raw, cookies };
}

/**
 * lp-xhf4.21: after Connect Google, first agent use injects
 * GOOGLE_WORKSPACE_CLI_TOKEN onto the user sandbox, not the tenant box.
 * gws on the box reads that token. Tenant printenv stays clean.
 *
 * Hypothesis: CP inject exists + BFF client exists, but no chat/send caller.
 * This test proves the BFF chat-use / approval / pending-resume paths now
 * call injectUserConnector onto the user sandbox before the agent runs gws.
 *
 * No Postgres needed: fake authClient records inject calls and simulates
 * healthy "connected" status. Guest isolation is proven in CP unit test
 * connector-user-sandbox.test.ts; here we prove BFF wiring.
 */
describe("bff gws first-use inject wiring (lp-xhf4.21)", () => {
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};
  let bffApp: ReturnType<typeof createApp>;
  let injectSpy: ReturnType<typeof vi.fn>;
  let getAccessMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    injectSpy = vi.fn(async () => ({
      instance_id: "inst-user",
      owner_user_id: "u1",
      connector_id: "google" as const,
      sandbox_id: "sbx-user-456",
      injected: true,
      reason: "injected",
      skip_oauth: true,
      files: ["/var/lib/company-brain-backend/gws/token_cache.json"],
      post_commands: [],
    }));

    // Healthy google connection for "ready" path; not_connected for needs_auth
    let connected = true;
    getAccessMock = vi.fn(async ({ connectorId }: { connectorId: string }) => {
      if (connectorId !== "google") {
        return {
          connection: null,
          entitled: false,
          role_granted: false,
          account_label: null,
          status: "not_connected",
        };
      }
      return {
        connection: connected
          ? {
              connector_id: "google",
              status: "connected" as const,
              account_label: "alice@gmail.com",
              sticky: {},
            }
          : null,
        entitled: connected,
        role_granted: connected,
        account_label: connected ? "alice@gmail.com" : null,
        status: connected ? "connected" : "not_connected",
      } as unknown as Record<string, unknown>;
    }) as unknown as ReturnType<typeof vi.fn>;
    (getAccessMock as unknown as { setConnected: (v: boolean) => void }).setConnected =
      (v: boolean) => {
        connected = v;
      };

    const tenantId = "tenant-demo-id";
    tenantDemo = {
      tenant_id: tenantId,
      tenant_slug: "demo",
      display_name: "Demo",
      host: "demo.withlanyard.com",
    };

    const fakeAuthClient = {
      getUserConnectorAccess: getAccessMock,
      injectUserConnector: injectSpy,
      getUserRbac: vi.fn(async () => ({ roles: [], profile: "contributor" })),
      getUserConnectorConnection: vi.fn(),
      upsertUserConnector: vi.fn(async () => ({
        connector_id: "google",
        status: "connected",
        account_label: "alice@gmail.com",
        sticky: {},
      })),
      listUserConnectors: vi.fn(async () => []),
      listTenantMembers: vi.fn(async () => []),
      listRoles: vi.fn(async () => ({ roles: [] })),
      listConnectorEntitlements: vi.fn(async () => []),
      listRoleConnectorGrants: vi.fn(async () => []),
      upsertRoleConnectorGrant: vi.fn(),
      upsertConnectorEntitlement: vi.fn(),
      completeConnectorOAuth: vi.fn(),
      deleteUserConnector: vi.fn(),
      refreshUserConnector: vi.fn(),
      listUserConnectorsByTenant: vi.fn(),
    } as unknown as import("../src/control-plane-client.js").ControlPlaneAuthClient;

    const sessions = new (await import("../src/session.js")).SessionStore();
    const bindings = createTestBindings({ demo: tenantDemo }, { authClient: fakeAuthClient as unknown as import("../src/control-plane-client.js").ControlPlaneAuthClient, sessions });
    bffApp = createApp(bindings);

    // Create session directly without /api/auth/register (which needs DB-backed authClient)
    const csrfRes = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const csrfToken = csrfRes.cookies.lanyard_csrf ?? "csrf-test";
    const session = await sessions.create({
      userId: "u-alice",
      tenantId: tenantDemo.tenant_id,
      email: "alice@demo.test",
    });
    memberCookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: csrfToken,
    };
  });

  it("chat-use ready triggers injectUserConnector onto user sandbox", async () => {
    const res = await jsonRequest(bffApp, "/api/connectors/google/chat-use", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: "th-gws-1",
        args: ["gws", "gmail", "+triage"],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("ready");
    expect(injectSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantDemo.tenant_id,
        connectorId: "google",
      }),
    );
    const call = injectSpy.mock.calls[0][0] as { tenantId: string; userId: string };
    expect(call.userId).toBeTruthy();
    expect(call.tenantId).toBe(tenantDemo.tenant_id);
  });

  it("pending resume after OAuth triggers inject", async () => {
    (getAccessMock as unknown as { setConnected: (v: boolean) => void }).setConnected(false);
    const needsAuth = await jsonRequest(bffApp, "/api/connectors/google/chat-use", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: "th-pending-1",
        args: ["gws", "gmail", "users", "drafts", "create", "--to", "bob@example.com"],
      }),
    });
    expect(needsAuth.body.kind).toBe("needs_auth");
    expect(injectSpy).not.toHaveBeenCalled();

    (getAccessMock as unknown as { setConnected: (v: boolean) => void }).setConnected(true);
    injectSpy.mockClear();

    const resume = await jsonRequest(bffApp, "/api/connectors/google/pending/resume", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(resume.status).toBe(200);
    expect(resume.body.kind).toBe("resume");
    expect(injectSpy).toHaveBeenCalledTimes(1);
  });

  it("approval evaluate allow triggers inject", async () => {
    getAccessMock.mockImplementation(async () => ({
      connection: {
        connector_id: "google",
        status: "connected" as const,
        account_label: "alice@gmail.com",
        sticky: { "calendar.read": true },
      },
      entitled: true,
      role_granted: true,
      account_label: "alice@gmail.com",
      status: "connected",
    }) as unknown as Record<string, unknown>);

    injectSpy.mockClear();
    const allowRes = await jsonRequest(bffApp, "/api/connectors/approval/evaluate", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        argv: ["gws", "calendar", "+agenda"],
        thread_id: "th-cal-1",
      }),
    });
    expect(allowRes.status).toBe(200);
    expect(allowRes.body.outcome).toBe("allow");
    expect(injectSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: "google" }),
    );
  });

  it("gws stub reads GOOGLE_WORKSPACE_CLI_TOKEN, tenant stays clean", async () => {
    const { spawnSync } = await import("node:child_process");
    const gwsPath = "/tmp/lanyard-lp-xhf4.21/deploy/daytona/agent-gateway/gws";
    const userToken = "gws-access-token-123";
    const ok = spawnSync("bash", [gwsPath, "gmail", "+triage"], {
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: userToken },
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("action_class=gmail.read");
    expect(ok.stdout).not.toContain(userToken);
    expect(ok.stdout).toContain("token=");

    const missing = spawnSync("bash", [gwsPath, "gmail", "+triage"], {
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: "" },
      encoding: "utf8",
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("missing GOOGLE_WORKSPACE_CLI_TOKEN");

    const driveOk = spawnSync("bash", [gwsPath, "drive", "files", "list"], {
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: userToken },
      encoding: "utf8",
    });
    expect(driveOk.status).toBe(0);
    expect(driveOk.stdout).toContain("drive.read");

    const calendarOk = spawnSync("bash", [gwsPath, "calendar", "+agenda"], {
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: userToken },
      encoding: "utf8",
    });
    expect(calendarOk.status).toBe(0);
    expect(calendarOk.stdout).toContain("calendar.read");
  });
});
