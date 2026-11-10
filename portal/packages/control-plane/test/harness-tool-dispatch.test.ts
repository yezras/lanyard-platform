/**
 * lp-hdzm.27 — member subset omit + fail-closed harness dispatch.
 * First-class CLIs (gws, gh, wacli) are grant on/off only, not read-only.
 */
import { describe, expect, it } from "vitest";

import { REDACTED } from "@lanyard/shared";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  buildClassCHttpAttach,
  type ClassCHttpRequest,
} from "../src/class-c-attach.js";
import type { ClassCSecretPayload } from "../src/class-c-secrets.js";
import type { ConnectorId } from "../src/connectors.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import {
  FIRST_CLASS_CLI_BINS,
  FIRST_CLASS_CLI_CONNECTOR,
  HarnessToolForbiddenError,
  dispatchHarnessFirstClassCli,
  dispatchHarnessOpenApiTool,
  filterHarnessExposedTools,
  listHarnessExposedTools,
  parseHarnessConnectorId,
  parseHarnessToolRef,
  type HarnessToolCaller,
} from "../src/harness-tool-dispatch.js";
import { connectorIsOnboarded } from "../src/connector-onboard.js";
import { fromSpec } from "../src/openapi-adapter.js";
import { STRIPE_OPENAPI_FIXTURE } from "./fixtures/openapi-stripe.js";

const TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TOKEN = "sk_test_class_c_stripe_restricted";
const payload: ClassCSecretPayload = {
  auth_kind: "bearer",
  value: TOKEN,
};

function attach() {
  return buildClassCHttpAttach({
    tenant_id: TENANT_ID,
    connector_id: "stripe" as ConnectorId,
    surface_id: "api",
    payload,
  });
}

function memberCaller(allowlist: readonly string[]): HarnessToolCaller {
  return {
    onboarded: true,
    granted: true,
    role: "member",
    subsetKind: "allowlist",
    allowlist,
  };
}

function adminCaller(allowlist: readonly string[] = []): HarnessToolCaller {
  return {
    onboarded: true,
    granted: true,
    role: "tenant_admin",
    subsetKind: "allowlist",
    allowlist,
  };
}

function grantOnlyMember(): HarnessToolCaller {
  return {
    onboarded: true,
    granted: true,
    role: "member",
    subsetKind: "grant_only",
    allowlist: [],
  };
}

function stripeTools() {
  const result = fromSpec(STRIPE_OPENAPI_FIXTURE);
  expect(result.kind).toBe("exposed");
  if (result.kind !== "exposed") {
    throw new Error("expected exposed");
  }
  return result;
}

describe("harness tool dispatch (lp-hdzm.27)", () => {
  it("treats empty surfaces as not onboarded", () => {
    expect(connectorIsOnboarded(null)).toBe(false);
    expect(connectorIsOnboarded({ enabled: true, surfaces: [] })).toBe(false);
    expect(connectorIsOnboarded({ enabled: false, surfaces: ["api"] })).toBe(
      false,
    );
    expect(connectorIsOnboarded({ enabled: true, surfaces: ["api"] })).toBe(
      true,
    );
  });

  it("maps first-class CLI bins to grant-only connectors", () => {
    expect(FIRST_CLASS_CLI_BINS).toEqual(["gws", "gh", "wacli"]);
    expect(parseHarnessConnectorId("gws")).toBe("google");
    expect(parseHarnessConnectorId("gh")).toBe("github");
    expect(parseHarnessConnectorId("wacli")).toBe("whatsapp");
    expect(FIRST_CLASS_CLI_CONNECTOR.gws).toBe("google");
    expect(parseHarnessToolRef({ connector_id: "gws", tool_name: "gws" })).toEqual({
      connector_id: "google",
      tool_name: "gws",
      cli: "gws",
    });
    expect(
      parseHarnessToolRef({
        connector_id: "stripe",
        tool_name: "stripe.GetCustomers",
      }),
    ).toEqual({
      connector_id: "stripe",
      tool_name: "GetCustomers",
      cli: null,
    });
  });

  it("omits tools not on the member allowlist from the tree", () => {
    const tools = listHarnessExposedTools({
      connector_id: "stripe",
      snapshot: {
        version: 1,
        source: "custom",
        domain: "stripe.com",
        compiled_at: "2026-08-26T00:00:00.000Z",
        runnability: "runnable",
        surfaces: [
          {
            kind: "openapi",
            slug: "api",
            label: "API",
            runnability: "runnable",
            spec: STRIPE_OPENAPI_FIXTURE,
          },
        ],
      },
    });
    expect(tools).toEqual(
      expect.arrayContaining([
        { kind: "allowlist", name: "GetCustomers", group: "read" },
        { kind: "allowlist", name: "GetCustomer", group: "read" },
        { kind: "allowlist", name: "GetAccount", group: "read" },
      ]),
    );
    const omitted = filterHarnessExposedTools(memberCaller(["GetCustomers"]), tools);
    expect(omitted.map((tool) => tool.name)).toEqual(["GetCustomers"]);
    expect(
      filterHarnessExposedTools(memberCaller([]), tools).map((tool) => tool.name),
    ).toEqual([]);
    expect(
      filterHarnessExposedTools(adminCaller(["GetCustomers"]), tools).map(
        (tool) => tool.name,
      ),
    ).toEqual(tools.map((tool) => tool.name));
  });

  it("does not claim gws/gh/wacli as a read-only subset", () => {
    expect(
      listHarnessExposedTools({ connector_id: "google", snapshot: {} }),
    ).toEqual([{ kind: "grant_only", name: "gws" }]);
    expect(
      listHarnessExposedTools({ connector_id: "github", snapshot: {} }),
    ).toEqual([{ kind: "grant_only", name: "gh" }]);
    expect(
      listHarnessExposedTools({ connector_id: "whatsapp", snapshot: {} }),
    ).toEqual([{ kind: "grant_only", name: "wacli" }]);
    expect(
      listHarnessExposedTools({ connector_id: "hubspot", snapshot: {} }),
    ).toEqual([]);
    for (const tool of [
      ...listHarnessExposedTools({ connector_id: "google", snapshot: {} }),
      ...listHarnessExposedTools({ connector_id: "github", snapshot: {} }),
      ...listHarnessExposedTools({ connector_id: "whatsapp", snapshot: {} }),
    ]) {
      expect(tool).not.toHaveProperty("group");
      expect(tool.kind).toBe("grant_only");
    }

    const gws = dispatchHarnessFirstClassCli({
      caller: grantOnlyMember(),
      connector_id: "google",
      cli: "gws",
    });
    expect(gws).toMatchObject({
      status: "allowed",
      kind: "grant_only",
      cli: "gws",
      tool_name: "gws",
    });
    expect(gws).not.toHaveProperty("group");
    expect(
      dispatchHarnessFirstClassCli({
        caller: grantOnlyMember(),
        connector_id: "github",
        cli: "gh",
      }).kind,
    ).toBe("grant_only");
    expect(
      dispatchHarnessFirstClassCli({
        caller: grantOnlyMember(),
        connector_id: "whatsapp",
        cli: "wacli",
      }).kind,
    ).toBe("grant_only");
  });

  it("403s a member harness OpenAPI call when the tool is omitted", async () => {
    const exposed = stripeTools();
    const create = exposed.tools.find((tool) => tool.name === "GetAccount");
    const list = exposed.tools.find((tool) => tool.name === "GetCustomers");
    expect(create).toBeDefined();
    expect(list).toBeDefined();

    const seen: ClassCHttpRequest[] = [];
    const fetch = async (req: ClassCHttpRequest) => {
      seen.push(req);
      return { status: 200, headers: {}, body: '{"data":[]}' };
    };
    const guest = createInMemoryGuestConnectorStore();

    await expect(
      dispatchHarnessOpenApiTool({
        caller: memberCaller(["GetCustomers"]),
        connector_id: "stripe",
        tool: create!,
        args: {},
        attach: attach(),
        fetch,
        baseUrl: exposed.base_url ?? "https://api.stripe.com",
        guest,
        sandbox_id: "sbx-dispatch",
      }),
    ).rejects.toMatchObject({
      name: "HarnessToolForbiddenError",
      code: "HARNESS_TOOL_FORBIDDEN",
      http_status: 403,
      reason: "member_subset",
      tool_name: "GetAccount",
    });
    expect(seen).toEqual([]);

    try {
      await dispatchHarnessOpenApiTool({
        caller: memberCaller(["GetCustomers"]),
        connector_id: "stripe",
        tool: create!,
        args: {},
        attach: attach(),
        fetch,
        baseUrl: exposed.base_url ?? "https://api.stripe.com",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessToolForbiddenError);
      expect((error as HarnessToolForbiddenError).http_status).toBe(403);
    }

    const allowed = await dispatchHarnessOpenApiTool({
      caller: memberCaller(["GetCustomers"]),
      connector_id: "stripe",
      tool: list!,
      args: { limit: 3 },
      attach: attach(),
      fetch,
      baseUrl: exposed.base_url ?? "https://api.stripe.com",
      guest,
      sandbox_id: "sbx-dispatch",
    });
    expect(allowed.authorized.status).toBe("allowed");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(allowed.call.logged.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      REDACTED,
    );
    expect(guest.listFiles("sbx-dispatch")).toEqual([]);
  });
});
