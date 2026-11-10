/**
 * lp-hdzm.31 — harness-side 6-tuple without Postgres: one read, guest empty,
 * member omit fail-closed.
 */
import { describe, expect, it } from "vitest";

import { REDACTED } from "@lanyard/shared";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  assertClassCNotOnGuestFs,
  buildClassCHttpAttach,
  type ClassCHttpRequest,
} from "../src/class-c-attach.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import {
  dispatchHarnessOpenApiTool,
  filterHarnessExposedTools,
  listHarnessExposedTools,
} from "../src/harness-tool-dispatch.js";
import {
  MOCK_LAB_STRIPE_CONNECTOR_ID,
  MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
  mockLabStripeConnectorId,
  mockLabStripeOpenApiSnapshot,
} from "../src/mocklab-stripe-six-tuple.js";
import { fromSpec } from "../src/openapi-adapter.js";

const TOKEN = "sk_test_lp_hdzm31_restricted";

function attach() {
  return buildClassCHttpAttach({
    tenant_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    connector_id: mockLabStripeConnectorId(),
    surface_id: "api",
    payload: { auth_kind: "bearer", value: TOKEN },
  });
}

describe("Mock Lab Stripe residual harness (lp-hdzm.31)", () => {
  it("calls GET /v1/customers with Class C attach and leaves the guest empty", async () => {
    const snapshot = mockLabStripeOpenApiSnapshot();
    const spec = fromSpec(snapshot.surfaces[0]!.spec ?? {});
    expect(spec.kind).toBe("exposed");
    if (spec.kind !== "exposed") {
      throw new Error("expected exposed");
    }
    const list = spec.tools.find((tool) => tool.name === "GetCustomers");
    const other = spec.tools.find((tool) => tool.name === "GetAccount");
    expect(list?.path).toBe("/v1/customers");
    expect(list?.method).toBe("get");
    expect(other).toBeDefined();

    const seen: ClassCHttpRequest[] = [];
    const guest = createInMemoryGuestConnectorStore();
    const fetch = async (req: ClassCHttpRequest) => {
      seen.push(req);
      return { status: 200, headers: {}, body: '{"data":[]}' };
    };
    const caller = {
      onboarded: true,
      granted: true,
      role: "member" as const,
      subsetKind: "allowlist" as const,
      allowlist: ["GetCustomers"],
    };

    const first = await dispatchHarnessOpenApiTool({
      caller,
      connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
      tool: list!,
      args: { limit: 1 },
      attach: attach(),
      fetch,
      baseUrl: spec.base_url ?? "https://api.stripe.com",
      guest,
      sandbox_id: "sbx-wake",
    });
    expect(first.call.response.status).toBe(200);
    expect(seen[0]?.url).toBe("https://api.stripe.com/v1/customers?limit=1");
    expect(seen[0]?.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(first.call.logged.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      REDACTED,
    );
    expect(guest.listFiles("sbx-wake")).toEqual([]);
    assertClassCNotOnGuestFs(guest, "sbx-wake", attach());

    await guest.wipe("sbx-wake");
    const rewakeGuest = createInMemoryGuestConnectorStore();
    const second = await dispatchHarnessOpenApiTool({
      caller,
      connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
      tool: list!,
      args: { limit: 1 },
      attach: attach(),
      fetch,
      baseUrl: spec.base_url ?? "https://api.stripe.com",
      guest: rewakeGuest,
      sandbox_id: "sbx-rewake",
    });
    expect(second.call.response.status).toBe(200);
    expect(rewakeGuest.listFiles("sbx-rewake")).toEqual([]);

    const tree = filterHarnessExposedTools(
      caller,
      listHarnessExposedTools({
        connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
        snapshot,
      }),
    );
    expect(tree.map((tool) => tool.name)).toEqual(["GetCustomers"]);

    const before = seen.length;
    await expect(
      dispatchHarnessOpenApiTool({
        caller,
        connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
        tool: other!,
        args: {},
        attach: attach(),
        fetch,
        baseUrl: spec.base_url ?? "https://api.stripe.com",
      }),
    ).rejects.toMatchObject({
      name: "HarnessToolForbiddenError",
      http_status: 403,
      reason: "member_subset",
    });
    expect(seen).toHaveLength(before);
    expect(JSON.stringify(MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE)).not.toContain(
      TOKEN,
    );
  });
});
