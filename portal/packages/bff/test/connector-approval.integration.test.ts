import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const SECRET_REFRESH = "rtok-secret-do-not-leak";

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
  if (init.host) {
    headers.set("host", init.host);
  }
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }
  const response = await app.request(path, { ...init, headers });
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, raw, cookies };
}

describe("bff tool.approval gate (lp-xhf4.9)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};
  let memberUserId = "";

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });
    const createdDemo = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenantDemo = {
      tenant_id: createdDemo.tenant_id,
      tenant_slug: createdDemo.tenant_slug,
      display_name: createdDemo.display_name,
      host: createdDemo.host,
    };
    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );
    bffApp = createApp(
      createTestBindings({ demo: tenantDemo }, { authClient }),
    );
    const memberRole = await store.createRole({
      tenant_id: tenantDemo.tenant_id,
      name: "member",
      hermes_profile: "contributor",
      path_prefixes: ["/"],
    });
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const memberReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@demo.test",
        password: "password123",
      }),
    });
    expect(memberReg.status).toBe(201);
    memberUserId = memberReg.body.user_id as string;
    memberCookies = memberReg.cookies;
    await store.setUserRoles({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      role_ids: [memberRole.role_id],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "google",
      enabled: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "google",
      granted: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      role_id: memberRole.role_id,
      connector_id: "google",
      enabled: true,
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
      sticky: {},
      secrets: {
        oauth_refresh: SECRET_REFRESH,
        oauth_access: "atok-secret",
        oauth_expiry: "2026-08-21T01:00:00.000Z",
        oauth_scopes: ["gmail.compose"],
        whatsapp_session_db: null,
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  async function evaluate(argv: string[]) {
    return jsonRequest(bffApp, "/api/connectors/approval/evaluate", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ argv, thread_id: "thr-1" }),
    });
  }

  async function decide(approvalId: string, decision: string) {
    return jsonRequest(
      bffApp,
      `/api/connectors/approval/${approvalId}/decide`,
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
  }

  it("first gmail.draft is Always / Reject; later chats skip", async () => {
    const first = await evaluate([
      "gws",
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("prompt");
    expect(first.body.run).toBe(false);
    expect(first.body.portal_event).toBe("tool.approval");
    expect(first.body.choices).toEqual([
      { id: "always", label: "Always" },
      { id: "reject", label: "Reject" },
    ]);
    const approvalId = first.body.approval_id as string;
    const always = await decide(approvalId, "always");
    expect(always.status).toBe(200);
    expect(always.body).toMatchObject({
      outcome: "allow",
      run: true,
      disconnected: false,
      persist_sticky: "gmail.draft",
    });

    const later = await evaluate([
      "gws",
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
    expect(later.body).toMatchObject({
      outcome: "allow",
      run: true,
      action_class: "gmail.draft",
    });
  });

  it("gmail.send always offers Approve this call / Reject and rejects Always", async () => {
    const first = await evaluate([
      "gws",
      "gmail",
      "users",
      "messages",
      "send",
    ]);
    expect(first.status).toBe(200);
    expect(first.body.run).toBe(false);
    expect(first.body.choices).toEqual([
      { id: "approve_this_call", label: "Approve this call" },
      { id: "reject", label: "Reject" },
    ]);
    const always = await decide(first.body.approval_id as string, "always");
    expect(always.status).toBe(400);
    expect(always.body.error ?? always.body.message).toMatch(/Always/i);

    const again = await evaluate([
      "gws",
      "gmail",
      "users",
      "messages",
      "send",
    ]);
    const approved = await decide(
      again.body.approval_id as string,
      "approve_this_call",
    );
    expect(approved.body).toMatchObject({
      outcome: "allow",
      run: true,
      persist_sticky: null,
      disconnected: false,
    });
    const third = await evaluate([
      "gws",
      "gmail",
      "users",
      "messages",
      "send",
    ]);
    expect(third.body.outcome).toBe("prompt");
    expect(third.body.run).toBe(false);
  });

  it("does not run an unmapped gws subcommand until approved", async () => {
    const first = await evaluate([
      "gws",
      "gmail",
      "users",
      "messages",
      "batchDelete",
    ]);
    expect(first.body).toMatchObject({
      outcome: "prompt",
      run: false,
      mapped: false,
      gate: "every_call",
      action_class: null,
    });
  });

  it("Reject skips the tool and does not Disconnect", async () => {
    const first = await evaluate([
      "gws",
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
    const rejected = await decide(first.body.approval_id as string, "reject");
    expect(rejected.body).toEqual({
      outcome: "skip",
      run: false,
      disconnected: false,
      persist_sticky: null,
    });

    const list = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    expect(list.status).toBe(200);
    const google = (
      list.body.connectors as Array<Record<string, unknown>>
    ).find((row) => row.connector_id === "google");
    expect(google).toMatchObject({
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(list.raw).not.toContain(SECRET_REFRESH);
  });

  it("clears one sticky class without Disconnect", async () => {
    const first = await evaluate([
      "gws",
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
    await decide(first.body.approval_id as string, "always");
    const cleared = await jsonRequest(
      bffApp,
      "/api/connectors/google/sticky",
      {
        method: "PATCH",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action_class: "gmail.draft", enabled: false }),
      },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe("connected");
    expect(cleared.body.sticky).toEqual({});
    expect(cleared.body.account_label).toBe("alice@gmail.com");

    const next = await evaluate([
      "gws",
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
    expect(next.body.outcome).toBe("prompt");
  });
});
