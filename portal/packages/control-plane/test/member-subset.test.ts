/**
 * lp-hdzm.23 — member subset is a tool-name allowlist on (tenant, connector).
 */
import { describe, expect, it } from "vitest";

import {
  classifyMcpToolName,
  classifySnapshotTools,
  memberSubsetKindForConnector,
  parseAllowedToolNames,
  personMayCallTool,
} from "../src/member-subset.js";
import { STRIPE_OPENAPI_FIXTURE } from "./fixtures/openapi-stripe.js";

const stripeSnapshot = {
  version: 1 as const,
  source: "custom" as const,
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
    {
      kind: "mcp" as const,
      slug: "mcp",
      label: "MCP",
      runnability: "runnable" as const,
      initialize_url: "https://mcp.stripe.com",
      transport: "streamable-http" as const,
      tools: [
        { name: "get_stripe_account_info" },
        { name: "create_payment_intent" },
        { name: "mystery_widget" },
      ],
    },
  ],
};

describe("member subset domain (lp-hdzm.23)", () => {
  it("treats first-class CLIs as grant on/off only", () => {
    expect(memberSubsetKindForConnector("google")).toBe("grant_only");
    expect(memberSubsetKindForConnector("hubspot")).toBe("grant_only");
    expect(memberSubsetKindForConnector("whatsapp")).toBe("grant_only");
    expect(memberSubsetKindForConnector("github")).toBe("grant_only");
    expect(memberSubsetKindForConnector("stripe")).toBe("allowlist");
  });

  it("classifies OpenAPI GET as read, mutating methods as write, and omits unsupported ops", () => {
    const tools = classifySnapshotTools(stripeSnapshot);
    expect(tools).toEqual(
      expect.arrayContaining([
        { name: "GetCustomers", group: "read" },
        { name: "GetCustomer", group: "read" },
        { name: "GetAccount", group: "read" },
        { name: "CreateCustomer", group: "write" },
        { name: "get_stripe_account_info", group: "read" },
        { name: "create_payment_intent", group: "write" },
      ]),
    );
    expect(tools.find((row) => row.name === "PostFiles")).toBeUndefined();
    expect(tools.find((row) => row.name === "mystery_widget")).toBeUndefined();
    expect(tools.find((row) => row.name === "OptionsCustomers")).toBeUndefined();
  });

  it("omits unclassified MCP names", () => {
    expect(classifyMcpToolName("get_stripe_account_info")).toBe("read");
    expect(classifyMcpToolName("CreateCustomer")).toBe("write");
    expect(classifyMcpToolName("mystery_widget")).toBeNull();
  });

  it("lets granted admins skip the allowlist and members fail closed", () => {
    const allowlist = ["GetCustomers"];
    expect(
      personMayCallTool({
        onboarded: true,
        granted: true,
        role: "tenant_admin",
        subsetKind: "allowlist",
        toolName: "CreateCustomer",
        allowlist,
      }),
    ).toBe(true);
    expect(
      personMayCallTool({
        onboarded: true,
        granted: true,
        role: "member",
        subsetKind: "allowlist",
        toolName: "GetCustomers",
        allowlist,
      }),
    ).toBe(true);
    expect(
      personMayCallTool({
        onboarded: true,
        granted: true,
        role: "member",
        subsetKind: "allowlist",
        toolName: "CreateCustomer",
        allowlist,
      }),
    ).toBe(false);
    expect(
      personMayCallTool({
        onboarded: true,
        granted: true,
        role: "member",
        subsetKind: "grant_only",
        toolName: "gws",
        allowlist: [],
      }),
    ).toBe(true);
    expect(
      personMayCallTool({
        onboarded: true,
        granted: false,
        role: "tenant_admin",
        subsetKind: "allowlist",
        toolName: "GetCustomers",
        allowlist,
      }),
    ).toBe(false);
  });

  it("parses allowed tool names and rejects blanks", () => {
    expect(parseAllowedToolNames(["GetCustomers", "GetCustomers"])).toEqual([
      "GetCustomers",
    ]);
    expect(() => parseAllowedToolNames([" "])).toThrow(/Invalid tool name/);
    expect(() => parseAllowedToolNames("GetCustomers")).toThrow(/array/);
  });
});
