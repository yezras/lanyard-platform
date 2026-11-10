/**
 * lp-hdzm.24 — Class C harness attach. Authorization on the HTTP client,
 * secrets stripped from tool schema, never buildProviderWakeEnv, never a
 * token file on the fake guest fs.
 */
import { describe, expect, it } from "vitest";

import { REDACTED } from "@lanyard/shared";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  ClassCGuestInjectError,
  applyClassCHarnessHttp,
  assertClassCNotInProviderWakeEnv,
  assertClassCNotOnGuestFs,
  attachClassCAuthorization,
  authorizationValueFor,
  buildClassCHttpAttach,
  classCTokenFromAttach,
  redactClassCHeaders,
  redactClassCHttpRequest,
  refuseClassCGuestInject,
  stripSecretFieldsFromToolSchema,
  toolSchemaHasSecretFields,
  type ClassCHttpRequest,
} from "../src/class-c-attach.js";
import type { ClassCSecretPayload } from "../src/class-c-secrets.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import type { ConnectorId } from "../src/connectors.js";
import {
  applyProviderWakeEnvToCreateParams,
  buildProviderWakeEnv,
} from "../src/provider-wake-env.js";

const TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CONNECTOR_ID = "stripe" as ConnectorId;
const TOKEN = "sk_test_class_c_stripe_restricted";

const payload: ClassCSecretPayload = {
  auth_kind: "bearer",
  value: TOKEN,
};

function attach() {
  return buildClassCHttpAttach({
    tenant_id: TENANT_ID,
    connector_id: CONNECTOR_ID,
    surface_id: "api",
    payload,
  });
}

describe("Class C HTTP attach", () => {
  it("builds Authorization Bearer for bearer and api_key", () => {
    expect(authorizationValueFor(payload)).toBe(`Bearer ${TOKEN}`);
    expect(
      authorizationValueFor({ auth_kind: "api_key", value: TOKEN }),
    ).toBe(`Bearer ${TOKEN}`);
    expect(
      authorizationValueFor({
        auth_kind: "bearer",
        value: `Bearer ${TOKEN}`,
      }),
    ).toBe(`Bearer ${TOKEN}`);
    expect(attach().headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("puts Authorization on the harness HTTP client", async () => {
    const seen: ClassCHttpRequest[] = [];
    const result = await applyClassCHarnessHttp({
      attach: attach(),
      request: {
        url: "https://api.stripe.com/v1/customers",
        method: "GET",
        headers: { Accept: "application/json" },
      },
      fetch: async (req) => {
        seen.push(req);
        return { status: 200, headers: {}, body: "{}" };
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(result.sent.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(result.response.status).toBe(200);
  });

  it("redacts Authorization in logged headers", async () => {
    const result = await applyClassCHarnessHttp({
      attach: attach(),
      request: { url: "https://api.stripe.com/v1/account" },
      fetch: async () => ({ status: 200, headers: {}, body: "{}" }),
    });
    expect(result.logged.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      REDACTED,
    );
    expect(JSON.stringify(result.logged)).not.toContain(TOKEN);
    expect(redactClassCHeaders({ Authorization: `Bearer ${TOKEN}` })).toEqual({
      Authorization: REDACTED,
    });
    const redacted = redactClassCHttpRequest(
      attachClassCAuthorization(
        { url: "https://example.test", headers: { Accept: "application/json" } },
        attach(),
      ),
    );
    expect(redacted.headers?.Authorization).toBe(REDACTED);
    expect(redacted.headers?.Accept).toBe("application/json");
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
  });
});

describe("Class C tool schema", () => {
  it("strips secret fields and OpenAPI security from tool schema", () => {
    const schema = {
      name: "get_stripe_account_info",
      description: "Read account",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          api_key: { type: "string" },
          authorization: { type: "string" },
          token: { type: "string" },
        },
        required: ["limit"],
      },
      security: [{ bearerAuth: [] }],
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    };
    expect(toolSchemaHasSecretFields(schema)).toBe(true);
    const stripped = stripSecretFieldsFromToolSchema(schema) as {
      parameters: { properties: Record<string, unknown> };
      security?: unknown;
      securitySchemes?: unknown;
    };
    expect(stripped.parameters.properties).toEqual({
      limit: { type: "integer" },
    });
    expect(stripped.security).toBeUndefined();
    expect(stripped.securitySchemes).toBeUndefined();
    expect(toolSchemaHasSecretFields(stripped)).toBe(false);
    expect(JSON.stringify(stripped)).not.toContain(TOKEN);
    expect(JSON.stringify(stripped)).not.toMatch(/api_key|authorization/i);
  });
});

describe("Class C never buildProviderWakeEnv", () => {
  it("does not copy Class C tokens into provider wake env", () => {
    const env = assertClassCNotInProviderWakeEnv(attach(), {
      STRIPE_SECRET_KEY: TOKEN,
      STRIPE_API_KEY: TOKEN,
      OPENAI_API_KEY: "sk-openai-not-class-c",
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(env).toEqual({ OPENAI_API_KEY: "sk-openai-not-class-c" });
    expect(env).not.toHaveProperty("STRIPE_SECRET_KEY");
    expect(JSON.stringify(env)).not.toContain(TOKEN);

    const params = applyProviderWakeEnvToCreateParams(
      { snapshotId: "snap", env: { VAULT_ROOT: "/mnt/vault" } },
      env,
    );
    expect(params.env?.VAULT_ROOT).toBe("/mnt/vault");
    expect(JSON.stringify(params.env)).not.toContain(TOKEN);
    expect(buildProviderWakeEnv({ XAI_API_KEY: "xai" }).XAI_API_KEY).toBe("xai");
  });
});

describe("Class C never on guest fs", () => {
  it("fake guest fs has no token file after harness attach", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const sandbox_id = "sbx-class-c";
    const result = await applyClassCHarnessHttp({
      attach: attach(),
      request: { url: "https://api.stripe.com/v1/account" },
      fetch: async (req) => {
        expect(req.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
        return { status: 200, headers: {}, body: '{"id":"acct_1"}' };
      },
      guest,
      sandbox_id,
    });
    expect(result.response.status).toBe(200);
    expect(guest.listFiles(sandbox_id)).toEqual([]);
    expect(guest.printenv(sandbox_id)).toEqual({});
    expect(guest.sandboxCount()).toBe(0);
    assertClassCNotOnGuestFs(guest, sandbox_id, attach());
    expect(classCTokenFromAttach(attach())).toBe(TOKEN);
  });

  it("refuses Class C guest inject as a type-level dead end", () => {
    expect(() => refuseClassCGuestInject()).toThrow(ClassCGuestInjectError);
  });
});
