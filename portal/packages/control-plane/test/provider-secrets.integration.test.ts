import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROVIDER_WAKE_ENV_KEYS } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import { fingerprintSecretValue } from "../src/daytona-env-redact.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";
const PLAIN_XAI = "xai-live-key-plain-value";
const PLAIN_POOLSIDE = "poolside-live-key-plain-value";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody; raw: string }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  return { status: response.status, body, raw };
}

function serviceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  return headers;
}

describe("control-plane tenant provider secrets (lp-2qs.4)", () => {
  let store: ControlPlaneStore;
  let schema = "";
  let app: ReturnType<typeof createApp>;
  let tenantId = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    schema = created.schema;
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "secrets-tenant",
      display_name: "Secrets Tenant",
    });
    tenantId = tenant.tenant_id;
  });

  afterEach(async () => {
    await store.close();
    void schema;
  });

  it("lists the closed slot allowlist with absent statuses by default", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets`,
      { headers: serviceHeaders() },
    );
    expect(res.status).toBe(200);
    const slots = res.body.slots as Array<{
      slot: { kind: string; env_name?: string; provider_id?: string };
      present: boolean;
      fingerprint: string | null;
    }>;
    expect(slots.map((row) => row.slot)).toHaveLength(
      PROVIDER_WAKE_ENV_KEYS.length + 3,
    );
    expect(slots.every((row) => row.present === false)).toBe(true);
    expect(slots.every((row) => row.fingerprint === null)).toBe(true);
    expect(res.raw).not.toContain(PLAIN_XAI);
  });

  it("stores a key via PUT without persisting plaintext and reports a fingerprint", async () => {
    const put = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets/XAI_API_KEY`,
      {
        method: "PUT",
        headers: serviceHeaders({
          "content-type": "application/json",
          "x-lanyard-actor": "ops@example.com",
        }),
        body: JSON.stringify({ value: PLAIN_XAI }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenant_id: tenantId,
      present: true,
      fingerprint: fingerprintSecretValue(PLAIN_XAI),
    });
    expect(put.raw).not.toContain(PLAIN_XAI);

    // Raw row holds ciphertext only.
    const rawRows = await store.listTenantProviderSecretStatuses(tenantId);
    expect(
      rawRows.find(
        (r) => r.slot.kind === "env_key" && r.slot.env_name === "XAI_API_KEY",
      )?.present,
    ).toBe(true);
    expect(JSON.stringify(rawRows)).not.toContain(PLAIN_XAI);

    // Audit metadata records slot + actor, never the value.
    const audit = await store.listAuditEntries(tenantId);
    const entry = audit.find(
      (e) => e.action === "tenant.provider_secret_upserted",
    );
    expect(entry?.actor).toBe("ops@example.com");
    expect(entry?.metadata).toEqual({
      slot_id: "XAI_API_KEY",
      kind: "env_key",
    });
  });

  it("rotates an existing key (new fingerprint) and deletes it", async () => {
    await store.upsertTenantProviderSecret({
      tenant_id: tenantId,
      slot: { kind: "env_key", env_name: "POOLSIDE_API_KEY" },
      value: PLAIN_POOLSIDE,
    });
    const rotated = await store.upsertTenantProviderSecret({
      tenant_id: tenantId,
      slot: { kind: "env_key", env_name: "POOLSIDE_API_KEY" },
      value: "poolside-rotated-value",
    });
    expect(rotated.rotated_at).not.toBeNull();
    expect(rotated.fingerprint).not.toBe(fingerprintSecretValue(PLAIN_POOLSIDE));

    const delRoute = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets/POOLSIDE_API_KEY`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(delRoute.status).toBe(200);
    expect(delRoute.body).toEqual({ ok: true, deleted: true });

    const after = await store.listTenantProviderSecretStatuses(tenantId);
    expect(
      after.find(
        (r) =>
          r.slot.kind === "env_key" && r.slot.env_name === "POOLSIDE_API_KEY",
      )?.present,
    ).toBe(false);

    const delAgain = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets/POOLSIDE_API_KEY`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(delAgain.body).toEqual({ ok: true, deleted: false });
  });

  it("rejects unknown slots and empty values with 400", async () => {
    const badSlot = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets/NOT_A_REAL_SLOT`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ value: "v" }),
      },
    );
    expect(badSlot.status).toBe(400);

    const emptyValue = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/provider-secrets/XAI_API_KEY`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ value: "   " }),
      },
    );
    expect(emptyValue.status).toBe(400);
  });

  it("fails closed on writes when KMS is not configured (503, no plaintext row)", async () => {
    const openStore = await ControlPlaneStore.create({
      databaseUrl: undefined,
      schema: `${schema}_nokms`,
      connectorKms: null,
    });
    try {
      const tenant = await openStore.createTenant({
        slug: "no-kms",
        display_name: "No KMS",
      });
      const noKmsApp = createApp(openStore, { serviceToken: SERVICE_TOKEN });
      const res = await jsonRequest(
        noKmsApp,
        `/internal/tenants/${tenant.tenant_id}/provider-secrets/XAI_API_KEY`,
        {
          method: "PUT",
          headers: serviceHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ value: PLAIN_XAI }),
        },
      );
      expect(res.status).toBe(503);
      await expect(
        openStore.getTenantProviderWakeEnvValues(tenant.tenant_id),
      ).rejects.toThrow();
    } finally {
      await openStore.close();
    }
  });

  it("decrypts env-kind rows for wake inject and skips OAuth slots", async () => {
    await store.upsertTenantProviderSecret({
      tenant_id: tenantId,
      slot: { kind: "env_key", env_name: "XAI_API_KEY" },
      value: PLAIN_XAI,
    });
    await store.upsertTenantProviderSecret({
      tenant_id: tenantId,
      slot: { kind: "oauth_slot", provider_id: "openai-codex" },
      value: '{"access_token":"codex-oauth-token"}',
    });

    const env = await store.getTenantProviderWakeEnvValues(tenantId);
    expect(env).toEqual({ XAI_API_KEY: PLAIN_XAI });
  });
});

