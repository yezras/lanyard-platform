import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { dedicatedRelayWssUrlForSlug } from "../src/relay-tier.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const OPS_TOKEN = "test-internal-ops-token";
const SHARED_POOL_URL = "wss://relay.shared-pool.test";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("control-plane relay tier (#18)", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore({ sharedRelayWssUrl: SHARED_POOL_URL });
    app = createApp(store, { internalOpsToken: OPS_TOKEN, devOpen: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it("defaults new tenants to shared relay tier", async () => {
    const created = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "shared-default", display_name: "Shared" }),
    });

    const tenantId = created.body.tenant_id as string;
    const fetched = await jsonRequest(app, `/tenants/${tenantId}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.relay).toEqual({
      relay_tier: "shared",
      dedicated_relay_wss_url: null,
      relay_wss_url: SHARED_POOL_URL,
    });
  });

  it("returns shared pool relay_wss_url at provision for standard tenants", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "standard", display_name: "Standard" }),
    });

    const provision = await jsonRequest(
      app,
      `/tenants/${tenant.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );

    expect(provision.status).toBe(201);
    expect(provision.body.relay_tier).toBe("shared");
    expect(provision.body.relay_wss_url).toBe(SHARED_POOL_URL);
  });

  it("routes dedicated tenants to tenant-specific relay_wss_url at provision", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "compliance-co", display_name: "Compliance" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const updated = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/relay-tier`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({ relay_tier: "dedicated" }),
      },
    );

    expect(updated.status).toBe(200);
    expect(updated.body.relay_tier).toBe("dedicated");
    expect(updated.body.relay_wss_url).toBe(
      dedicatedRelayWssUrlForSlug("compliance-co"),
    );

    const provision = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/provision`,
      { method: "POST" },
    );

    expect(provision.status).toBe(201);
    expect(provision.body.relay_tier).toBe("dedicated");
    expect(provision.body.relay_wss_url).toBe(
      "wss://relay-compliance-co.withlanyard.com",
    );
    expect(provision.body.relay_wss_url).not.toBe(SHARED_POOL_URL);
  });

  it("assigns different relay_wss_url to two tenants on different pools", async () => {
    const sharedTenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "pool-shared", display_name: "Pool Shared" }),
    });
    const dedicatedTenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "pool-dedicated",
        display_name: "Pool Dedicated",
      }),
    });

    await jsonRequest(
      app,
      `/internal/tenants/${dedicatedTenant.body.tenant_id}/relay-tier`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({ relay_tier: "dedicated" }),
      },
    );

    const sharedProvision = await jsonRequest(
      app,
      `/tenants/${sharedTenant.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );
    const dedicatedProvision = await jsonRequest(
      app,
      `/tenants/${dedicatedTenant.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );

    expect(sharedProvision.body.relay_wss_url).toBe(SHARED_POOL_URL);
    expect(dedicatedProvision.body.relay_wss_url).toBe(
      "wss://relay-pool-dedicated.withlanyard.com",
    );
    expect(sharedProvision.body.relay_wss_url).not.toBe(
      dedicatedProvision.body.relay_wss_url,
    );
  });

  it("accepts ops override for dedicated relay host", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "custom-host", display_name: "Custom Host" }),
    });
    const tenantId = tenant.body.tenant_id as string;
    const customUrl = "wss://relay-custom.example.com";

    const updated = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/relay-tier`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({
          relay_tier: "dedicated",
          dedicated_relay_wss_url: customUrl,
        }),
      },
    );

    expect(updated.status).toBe(200);
    expect(updated.body.relay_wss_url).toBe(customUrl);

    const provision = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/provision`,
      { method: "POST" },
    );

    expect(provision.body.relay_wss_url).toBe(customUrl);
  });

  it("rejects relay tier updates without internal ops token", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "ops-gate", display_name: "Ops Gate" }),
    });

    const denied = await jsonRequest(
      app,
      `/internal/tenants/${tenant.body.tenant_id}/relay-tier`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relay_tier: "dedicated" }),
      },
    );

    expect(denied.status).toBe(401);
  });

  it("records relay tier changes in audit metadata without secrets", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "audit-relay", display_name: "Audit Relay" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    await jsonRequest(app, `/tenants/${tenantId}/instances/provision`, {
      method: "POST",
    });

    await jsonRequest(app, `/internal/tenants/${tenantId}/relay-tier`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-internal-ops-token": OPS_TOKEN,
      },
      body: JSON.stringify({ relay_tier: "dedicated" }),
    });

    const entries = await store.listAuditEntries(tenantId);
    const relayAudit = entries.find(
      (entry) => entry.action === "tenant.relay_tier_updated",
    );
    const provisionAudit = entries.find(
      (entry) => entry.action === "instance.provisioned",
    );

    expect(relayAudit?.metadata).toMatchObject({
      tenant_slug: "audit-relay",
      relay_tier: "dedicated",
      relay_wss_url: "wss://relay-audit-relay.withlanyard.com",
    });
    expect(provisionAudit?.metadata).toMatchObject({
      relay_tier: "shared",
      relay_wss_url: SHARED_POOL_URL,
    });
    expect(JSON.stringify(entries)).not.toContain("secret");
  });
});