/**
 * lp-hdzm.25 — OpenAPI fromSpec adapter. Fixture → tools + skipped;
 * Authorization on the HTTP client, absent from tool schema; over-cap
 * refuses expose without CodeMode.
 */
import { describe, expect, it } from "vitest";

import { REDACTED } from "@lanyard/shared";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  buildClassCHttpAttach,
  toolSchemaHasSecretFields,
  type ClassCHttpRequest,
} from "../src/class-c-attach.js";
import type { ClassCSecretPayload } from "../src/class-c-secrets.js";
import type { ConnectorId } from "../src/connectors.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import {
  InvalidOpenApiSpecError,
  NATIVE_TOOL_CAP,
  buildOpenApiRequest,
  callOpenApiTool,
  fromCompiledSurface,
  fromSpec,
} from "../src/openapi-adapter.js";
import {
  STRIPE_OPENAPI_FIXTURE,
  openApiSpecOverCap,
} from "./fixtures/openapi-stripe.js";

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

function exposedTools() {
  const result = fromSpec(STRIPE_OPENAPI_FIXTURE);
  expect(result.kind).toBe("exposed");
  if (result.kind !== "exposed") {
    throw new Error("expected exposed");
  }
  return result;
}

describe("fromSpec fixture", () => {
  it("emits one tool per supported operation and skips the rest with reasons", () => {
    const result = exposedTools();
    expect(result.base_url).toBe("https://api.stripe.com");
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "GetAccount",
      "GetCustomer",
      "GetCustomers",
    ]);
    expect(result.tools).toHaveLength(3);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "options",
          path: "/v1/customers",
          operation_id: "OptionsCustomers",
          reason: "unsupported_method",
        }),
        expect.objectContaining({
          method: "post",
          path: "/v1/files",
          operation_id: "PostFiles",
          reason: "unsupported_content_type",
        }),
      ]),
    );
    expect(result.skipped).toHaveLength(2);

    const list = result.tools.find((tool) => tool.name === "GetCustomers");
    expect(list?.method).toBe("get");
    expect(list?.path).toBe("/v1/customers");
    expect(list?.parameters.properties).toEqual({
      limit: { type: "integer" },
    });
    expect(list?.parameters.required).toEqual([]);
    expect(list?.locations).toEqual({ limit: "query" });

    const get = result.tools.find((tool) => tool.name === "GetCustomer");
    expect(get?.locations).toEqual({ customer: "path" });
    expect(get?.parameters.required).toEqual(["customer"]);
  });

  it("keeps auth on the client and out of the tool schema", async () => {
    const result = exposedTools();
    const list = result.tools.find((tool) => tool.name === "GetCustomers");
    expect(list).toBeDefined();
    const schemaJson = JSON.stringify(list);
    expect(schemaJson).not.toContain(TOKEN);
    expect(schemaJson).not.toMatch(/authorization|api_key|bearerAuth|securitySchemes/i);
    expect(toolSchemaHasSecretFields(list?.parameters)).toBe(false);
    expect(list?.parameters.properties).not.toHaveProperty("api_key");
    expect(list?.parameters.properties).not.toHaveProperty("Authorization");
    expect(list?.locations).not.toHaveProperty("Authorization");

    const guest = createInMemoryGuestConnectorStore();
    const seen: ClassCHttpRequest[] = [];
    const call = await callOpenApiTool({
      tool: list!,
      args: { limit: 3 },
      attach: attach(),
      baseUrl: result.base_url ?? "https://api.stripe.com",
      guest,
      sandbox_id: "sbx-openapi",
      fetch: async (req) => {
        seen.push(req);
        return { status: 200, headers: {}, body: '{"data":[]}' };
      },
    });

    expect(call.request.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBeUndefined();
    expect(JSON.stringify(call.request)).not.toContain(TOKEN);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(seen[0]?.url).toBe("https://api.stripe.com/v1/customers?limit=3");
    expect(call.sent.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(call.logged.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(REDACTED);
    expect(JSON.stringify(call.logged)).not.toContain(TOKEN);
    expect(guest.listFiles("sbx-openapi")).toEqual([]);
    expect(call.response.status).toBe(200);
  });

  it("exposes the compiler-inlined Stripe GET /v1/customers fragment", () => {
    const result = fromSpec({
      openapi: "3.0.0",
      info: { title: "Stripe", version: "1" },
      paths: {
        "/v1/customers": {
          get: { operationId: "listCustomers" },
        },
      },
    });
    expect(result.kind).toBe("exposed");
    if (result.kind !== "exposed") {
      throw new Error("expected exposed");
    }
    expect(result.tools).toEqual([
      expect.objectContaining({
        name: "listCustomers",
        method: "get",
        path: "/v1/customers",
      }),
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("reads a compiled openapi surface the same as a raw spec", () => {
    const fromSurface = fromCompiledSurface({
      kind: "openapi",
      slug: "stripe-api",
      label: "Stripe API",
      runnability: "runnable",
      spec: structuredClone(STRIPE_OPENAPI_FIXTURE) as Record<string, unknown>,
    });
    expect(fromSurface).toEqual(fromSpec(STRIPE_OPENAPI_FIXTURE));
  });

  it("rejects non-3.x specs at the boundary", () => {
    expect(() => fromSpec({ swagger: "2.0", paths: {} })).toThrow(
      InvalidOpenApiSpecError,
    );
    expect(() => fromSpec(null)).toThrow(InvalidOpenApiSpecError);
    expect(() =>
      fromCompiledSurface({
        kind: "mcp",
        slug: "stripe-mcp",
        label: "Stripe MCP",
        runnability: "runnable",
        initialize_url: "https://mcp.stripe.com",
        transport: "streamable-http",
      }),
    ).toThrow(InvalidOpenApiSpecError);
  });
});

describe("native tool cap", () => {
  it("refuses to expose more than 20 native tools without CodeMode", () => {
    const atCap = fromSpec(openApiSpecOverCap(NATIVE_TOOL_CAP));
    expect(atCap.kind).toBe("exposed");
    if (atCap.kind === "exposed") {
      expect(atCap.tools).toHaveLength(NATIVE_TOOL_CAP);
    }

    const over = fromSpec(openApiSpecOverCap(NATIVE_TOOL_CAP + 1));
    expect(over).toEqual({
      kind: "refused_over_cap",
      cap: 20,
      supported_count: 21,
      skipped: [],
      reason: "codemode_required",
    });
    expect(over.kind).toBe("refused_over_cap");
    if (over.kind === "refused_over_cap") {
      expect(over).not.toHaveProperty("tools");
    }
  });
});

describe("buildOpenApiRequest", () => {
  it("binds path params and never copies Authorization", () => {
    const result = exposedTools();
    const get = result.tools.find((tool) => tool.name === "GetCustomer");
    expect(get).toBeDefined();
    const request = buildOpenApiRequest({
      tool: get!,
      args: { customer: "cus_123" },
      baseUrl: "https://api.stripe.com",
    });
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.stripe.com/v1/customers/cus_123");
    expect(request.headers).toEqual({ Accept: "application/json" });
    expect(request.headers).not.toHaveProperty("Authorization");
  });
});
