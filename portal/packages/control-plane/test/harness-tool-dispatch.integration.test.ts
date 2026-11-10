/**
 * lp-hdzm.27 — harness tool dispatch HTTP: member omit fail-closes with 403.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { ConnectorId } from "../src/connectors.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";
import { STRIPE_OPENAPI_FIXTURE } from "./fixtures/openapi-stripe.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";

const stripeSnapshot = {
  version: 1 as const,
  source: "integrations.sh" as const,
  domain: "stripe.com",
  compiled_at: "2026-08-26T00:00:00.000Z",
  runnability: "runnable" as const,
  surfaces: [
    {
      kind: "openapi" as const,
      slug: "api",
      label: "API",
      runnability: "runnable" as const,
      spec: STRIPE_OPENAPI_FIXTURE,
    },
  ],
};

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  const body = JSON.parse(raw || "{}") as JsonBody;
  return { status: response.status, body };
}

function serviceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  return headers;
}

describe("harness tool dispatch HTTP (lp-hdzm.27)", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let memberId = "";
  let adminId = "";

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "dispatch-tenant",
      display_name: "Dispatch Tenant",
    });
    tenantId = tenant.tenant_id;
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: stripeSnapshot,
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantId,
      connector_id: "stripe" as ConnectorId,
      enabled: true,
      surfaces: ["api"],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantId,
      connector_id: "google",
      enabled: true,
      surfaces: ["cli"],
    });
    const admin = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Ada Admin",
      email: "ada@dispatch.test",
      role: "tenant_admin",
    });
    adminId = admin.user_id;
    const member = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Pat Member",
      email: "pat@dispatch.test",
      role: "member",
    });
    memberId = member.user_id;
    await store.setPersonConnectorGrant({
      tenant_id: tenantId,
      user_id: memberId,
      connector_id: "stripe",
      granted: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantId,
      user_id: adminId,
      connector_id: "stripe",
      granted: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantId,
      user_id: memberId,
      connector_id: "google",
      granted: true,
    });
    await store.setConnectorMemberSubset({
      tenant_id: tenantId,
      connector_id: "stripe",
      allowed_tools: ["GetCustomers"],
    });
  });

  afterEach(async () => {
    await store?.close();
  });

  it("403s a member harness call when the tool is not in the allowlist", async () => {
    const denied = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/stripe/tools/GetAccount`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      reason: "member_subset",
      tool_name: "GetAccount",
      connector_id: "stripe",
    });

    const allowed = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/stripe/tools/GetCustomers`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      status: "allowed",
      kind: "allowlist",
      tool_name: "GetCustomers",
    });

    const tree = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/stripe/tools`,
      { headers: serviceHeaders() },
    );
    expect(tree.status).toBe(200);
    expect(tree.body.kind).toBe("allowlist");
    expect(tree.body.tools).toEqual([
      { kind: "allowlist", name: "GetCustomers", group: "read" },
    ]);

    const adminCall = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${adminId}/connectors/stripe/tools/GetAccount`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(adminCall.status).toBe(200);
    expect(adminCall.body).toMatchObject({
      status: "allowed",
      tool_name: "GetAccount",
    });
  });

  it("grants first-class CLIs on/off only and never as read-only", async () => {
    const gws = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/google/tools/gws`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(gws.status).toBe(200);
    expect(gws.body).toMatchObject({
      status: "allowed",
      kind: "grant_only",
      cli: "gws",
      tool_name: "gws",
    });
    expect(gws.body).not.toHaveProperty("group");

    const tree = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/google/tools`,
      { headers: serviceHeaders() },
    );
    expect(tree.status).toBe(200);
    expect(tree.body).toMatchObject({ kind: "grant_only" });
    expect(tree.body.tools).toEqual([{ kind: "grant_only", name: "gws" }]);
    expect(JSON.stringify(tree.body.tools)).not.toMatch(/"group"/);

    await store.setPersonConnectorGrant({
      tenant_id: tenantId,
      user_id: memberId,
      connector_id: "google",
      granted: false,
    });
    const ungranted = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${memberId}/connectors/gws/tools/gws`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(ungranted.status).toBe(403);
    expect(ungranted.body.reason).toBe("not_granted");
  });
});
