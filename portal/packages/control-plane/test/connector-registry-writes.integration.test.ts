/**
 * lp-hdzm.19 — promote/custom/delete canonical registry writes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  ConnectorOnboardedError,
  ConnectorRegistryConflictError,
} from "../src/connector-registry.js";
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
      slug: "stripe-mcp",
      label: "Stripe MCP",
      runnability: "runnable" as const,
      initialize_url: "https://mcp.stripe.com",
      transport: "streamable-http" as const,
    },
  ],
};

describe("canonical registry writes (lp-hdzm.19)", () => {
  let store: Awaited<ReturnType<typeof createTestStoreWithSchema>>["store"];
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
  });

  afterEach(async () => {
    await store.close();
  });

  it("inserts a compiled snapshot and 409s on collision", async () => {
    const created = await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: runnableSnapshot,
    });
    expect(created.id).toBe("stripe");
    expect(created.snapshot).toMatchObject({
      runnability: "runnable",
      source: "integrations.sh",
    });

    await expect(
      store.insertCanonicalConnector({
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        source: "integrations.sh",
        source_entry_id: "integrations.sh:stripe.com",
        snapshot: runnableSnapshot,
      }),
    ).rejects.toBeInstanceOf(ConnectorRegistryConflictError);
  });

  it("409s google alias promote and reserved custom slugs", async () => {
    await expect(
      store.insertCanonicalConnector({
        id: "workspace",
        domain: "gmail.com",
        label: "Gmail",
        source: "integrations.sh",
        source_entry_id: "integrations.sh:gmail.com",
        snapshot: { ...runnableSnapshot, domain: "gmail.com", source: "integrations.sh" },
      }),
    ).rejects.toMatchObject({ reason: "alias" });

    await expect(
      store.insertCanonicalConnector({
        id: "registry",
        domain: "linear.app",
        label: "Registry",
        source: "custom",
        snapshot: { ...runnableSnapshot, source: "custom", domain: "linear.app" },
      }),
    ).rejects.toMatchObject({ reason: "reserved" });
  });

  it("DELETE 409s while onboarded and reserves the id after archive", async () => {
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: runnableSnapshot,
    });
    const tenant = await store.createTenant({
      slug: "mocklab",
      display_name: "Mock Lab",
    });
    const stripeId = await store.parseConnectorId("stripe");
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenant.tenant_id,
      connector_id: stripeId,
      enabled: true,
    });

    await expect(
      store.archiveCanonicalConnector({ id: "stripe" }),
    ).rejects.toBeInstanceOf(ConnectorOnboardedError);

    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenant.tenant_id,
      connector_id: stripeId,
      enabled: false,
    });
    const archived = await store.archiveCanonicalConnector({ id: "stripe" });
    expect(archived.archived).toBe(true);

    await expect(
      store.insertCanonicalConnector({
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        source: "custom",
        snapshot: { ...runnableSnapshot, source: "custom" },
      }),
    ).rejects.toMatchObject({ reason: "collision" });
  });

  it("HTTP promote path stores snapshot; graphql snapshot is 400", async () => {
    const created = await app.request("/internal/canonical-connectors", {
      method: "POST",
      headers: {
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        source: "integrations.sh",
        source_entry_id: "integrations.sh:stripe.com",
        snapshot: runnableSnapshot,
      }),
    });
    expect(created.status).toBe(201);

    const graphql = await app.request("/internal/canonical-connectors", {
      method: "POST",
      headers: {
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "gql",
        label: "GQL",
        source: "custom",
        snapshot: {
          version: 1,
          source: "custom",
          domain: null,
          compiled_at: "2026-08-26T00:00:00.000Z",
          runnability: "runnable",
          surfaces: [
            {
              kind: "graphql",
              slug: "gql",
              label: "GQL",
              runnability: "runnable",
            },
          ],
        },
      }),
    });
    expect(graphql.status).toBe(400);
    const body = (await graphql.json()) as { error: string };
    expect(body.error).toMatch(/GraphQL/i);
  });
});
