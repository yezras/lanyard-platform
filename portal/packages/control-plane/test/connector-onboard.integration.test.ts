/**
 * lp-hdzm.21 — onboard PUT surfaces and last-off deletes Class C slots.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { ConnectorId } from "../src/connectors.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

const SERVICE_TOKEN = "test-cp-service-token";

const runnableSnapshot = {
  version: 1 as const,
  source: "integrations.sh" as const,
  domain: "stripe.com",
  compiled_at: "2026-08-26T00:00:00.000Z",
  runnability: "runnable" as const,
  surfaces: [
    {
      kind: "mcp" as const,
      slug: "mcp",
      label: "MCP",
      runnability: "runnable" as const,
      initialize_url: "https://mcp.stripe.com",
      transport: "streamable-http" as const,
    },
    {
      kind: "openapi" as const,
      slug: "api",
      label: "API",
      runnability: "runnable" as const,
      spec: { openapi: "3.0.0", info: { title: "Stripe", version: "1" }, paths: {} },
    },
  ],
};

describe("connector onboard (lp-hdzm.21)", () => {
  let store: Awaited<ReturnType<typeof createTestStoreWithSchema>>["store"];
  let app: ReturnType<typeof createApp>;
  let tenantId = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "onboard-tenant",
      display_name: "Onboard Tenant",
    });
    tenantId = tenant.tenant_id;
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: runnableSnapshot,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  function headers(extra?: HeadersInit): Headers {
    const next = new Headers(extra);
    next.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
    return next;
  }

  it("onboards surfaces and last-off deletes that Class C slot", async () => {
    const onboard = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/stripe`,
      {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ surfaces: ["mcp", "api"] }),
      },
    );
    expect(onboard.status).toBe(200);
    expect(await onboard.json()).toMatchObject({
      connector_id: "stripe",
      enabled: true,
      surfaces: ["mcp", "api"],
    });

    await store.upsertClassCSecret({
      tenant_id: tenantId,
      connector_id: "stripe" as ConnectorId,
      surface_id: "api",
      payload: { auth_kind: "bearer", value: "sk_test_drop_me" },
    });
    const before = await store.listClassCSecretStatuses(
      tenantId,
      "stripe" as ConnectorId,
    );
    expect(before.find((row) => row.surface_id === "api")?.present).toBe(true);

    const lastOff = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/stripe`,
      {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ surfaces: ["mcp"] }),
      },
    );
    expect(lastOff.status).toBe(200);
    expect(await lastOff.json()).toMatchObject({
      enabled: true,
      surfaces: ["mcp"],
    });
    const after = await store.listClassCSecretStatuses(
      tenantId,
      "stripe" as ConnectorId,
    );
    expect(after.find((row) => row.surface_id === "api")?.present).toBe(false);
    expect(after.find((row) => row.surface_id === "mcp")?.present).toBe(false);
  });

  it("refuses not_runnable and graphql surface ids", async () => {
    const graphql = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/stripe`,
      {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ surfaces: ["graphql"] }),
      },
    );
    expect(graphql.status).toBe(400);
    expect(await graphql.json()).toMatchObject({ error: expect.any(String) });

    await store.insertCanonicalConnector({
      id: "linear",
      domain: "linear.app",
      label: "Linear",
      source: "custom",
      snapshot: {
        ...runnableSnapshot,
        domain: "linear.app",
        source: "custom",
        runnability: "not_runnable",
        surfaces: [
          {
            kind: "mcp",
            slug: "mcp",
            label: "MCP",
            runnability: "not_runnable",
          },
        ],
      },
    });
    const blocked = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/linear`,
      {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(blocked.status).toBe(400);
  });
});
