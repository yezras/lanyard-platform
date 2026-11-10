/**
 * lp-hdzm.31 — Mock Lab Stripe 6-tuple parse and one-surface guard.
 */
import { describe, expect, it } from "vitest";

import {
  MOCK_LAB_STRIPE_MCP_TOOL,
  MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
  MOCK_LAB_STRIPE_OPENAPI_TOOL,
  MockLabStripeSixTupleError,
  assertOneRemoteSurface,
  mockLabStripeOpenApiSnapshot,
  parseMockLabStripeSixTuple,
  publicSixTuple,
} from "../src/mocklab-stripe-six-tuple.js";
import type { CompiledSnapshot } from "../src/connector-registry.js";

describe("Mock Lab Stripe 6-tuple (lp-hdzm.31)", () => {
  it("locks stripe.com, one OpenAPI surface, tenant key, GET /v1/customers", () => {
    const tuple = parseMockLabStripeSixTuple(MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE);
    expect(tuple.domain).toBe("stripe.com");
    expect(tuple.connector_id).toBe("stripe");
    expect(tuple.tenant_slug).toBe("mocklab");
    expect(tuple.principal).toBe("tenant");
    expect(tuple.auth_kind).toBe("bearer");
    expect(tuple.paste).toBe("superadmin");
    expect(tuple.surface).toEqual({
      kind: "openapi",
      surface_id: "api",
      tool: MOCK_LAB_STRIPE_OPENAPI_TOOL,
    });
    expect(publicSixTuple(tuple)).toEqual({
      domain: "stripe.com",
      connector_id: "stripe",
      tenant_slug: "mocklab",
      principal: "tenant",
      auth_kind: "bearer",
      paste: "superadmin",
      surface: "openapi",
      surface_id: "api",
      tool: "GET /v1/customers",
      group: "read",
    });
  });

  it("accepts the MCP arm with get_stripe_account_info", () => {
    const tuple = parseMockLabStripeSixTuple({
      ...MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
      auth_kind: "api_key",
      surface: {
        kind: "mcp",
        surface_id: "mcp",
        tool: MOCK_LAB_STRIPE_MCP_TOOL,
      },
    });
    expect(tuple.auth_kind).toBe("api_key");
    expect(tuple.surface.kind).toBe("mcp");
    expect(publicSixTuple(tuple).tool).toBe("get_stripe_account_info");
  });

  it("rejects dual surfaces and off-lock fields", () => {
    expect(() =>
      parseMockLabStripeSixTuple({
        ...MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
        domain: "slack.com",
      }),
    ).toThrow(MockLabStripeSixTupleError);
    expect(() =>
      parseMockLabStripeSixTuple({
        ...MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
        principal: "user",
      }),
    ).toThrow(/tenant/);
    expect(() =>
      parseMockLabStripeSixTuple({
        ...MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
        surface: { kind: "cli", surface_id: "cli", tool: { name: "stripe" } },
      }),
    ).toThrow(/MCP or pinned OpenAPI/);

    const dual: CompiledSnapshot = {
      ...mockLabStripeOpenApiSnapshot(),
      surfaces: [
        ...mockLabStripeOpenApiSnapshot().surfaces,
        {
          kind: "mcp",
          slug: "mcp",
          label: "MCP",
          runnability: "runnable",
          initialize_url: "https://mcp.stripe.com",
          transport: "streamable-http",
        },
      ],
    };
    expect(() => assertOneRemoteSurface(dual)).toThrow(/one remote surface/);
  });

  it("pins a single OpenAPI surface on the Mock Lab snapshot", () => {
    const snapshot = mockLabStripeOpenApiSnapshot();
    expect(snapshot.domain).toBe("stripe.com");
    expect(snapshot.surfaces).toHaveLength(1);
    expect(assertOneRemoteSurface(snapshot).kind).toBe("openapi");
  });
});
