/**
 * lp-hdzm.23 — member subset PUT stores tool names on (tenant, connector).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
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
      spec: {
        ...STRIPE_OPENAPI_FIXTURE,
        paths: {
          ...STRIPE_OPENAPI_FIXTURE.paths,
          "/v1/customers": {
            ...STRIPE_OPENAPI_FIXTURE.paths["/v1/customers"],
            post: {
              operationId: "CreateCustomer",
              summary: "Create a customer",
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { email: { type: "string" } },
                    },
                  },
                },
              },
              responses: { "200": { description: "ok" } },
            },
          },
        },
      },
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

describe("connector member subset (lp-hdzm.23)", () => {
  let store: Awaited<ReturnType<typeof createTestStore>>;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "subset-tenant",
      display_name: "Subset Tenant",
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
  });

  afterEach(async () => {
    await store.close();
  });

  it("PUTs a classified tool allowlist and reads it back", async () => {
    const put = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/stripe/member-subset`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ allowed_tools: ["GetCustomers"] }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenant_id: tenantId,
      connector_id: "stripe",
      kind: "allowlist",
      allowed_tools: ["GetCustomers"],
    });
    expect(put.body.tools).toEqual(
      expect.arrayContaining([
        { name: "GetCustomers", group: "read" },
        { name: "CreateCustomer", group: "write" },
      ]),
    );

    const get = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/stripe/member-subset`,
      { headers: serviceHeaders() },
    );
    expect(get.status).toBe(200);
    expect(get.body.allowed_tools).toEqual(["GetCustomers"]);

    const unknown = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/stripe/member-subset`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ allowed_tools: ["mystery_widget"] }),
      },
    );
    expect(unknown.status).toBe(400);
  });
});
