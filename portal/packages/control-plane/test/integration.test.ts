import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  ControlPlaneStore,
  validateInstanceSecret,
} from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

const OPS_TOKEN = "test-internal-ops-token";

describe("control-plane integration", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { internalOpsToken: OPS_TOKEN, devOpen: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it("resolves tenant by slug via internal API", async () => {
    await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "lookup", display_name: "Lookup Tenant" }),
    });

    const found = await jsonRequest(app, "/internal/tenants/by-slug/lookup");
    expect(found.status).toBe(200);
    expect(found.body.tenant_slug).toBe("lookup");
    expect(found.body.host).toBe("lookup.withlanyard.com");

    const missing = await jsonRequest(
      app,
      "/internal/tenants/by-slug/does-not-exist",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("Unknown tenant slug");
  });

  it("creates tenant mapped to tenant_slug.withlanyard.com", async () => {
    const { status, body } = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "Acme-Corp",
        display_name: "Acme Corporation",
      }),
    });

    expect(status).toBe(201);
    expect(body.tenant_slug).toBe("acme-corp");
    expect(body.host).toBe("acme-corp.withlanyard.com");
    expect(body.display_name).toBe("Acme Corporation");
  });

  it("registers instance credentials once for deploy (canonical path)", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo", display_name: "Demo Tenant" }),
    });

    const tenantId = tenant.body.tenant_id as string;
    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );

    expect(registered.status).toBe(201);
    expect(registered.body.instance_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(registered.body.tenant_id).toBe(tenantId);
    expect(typeof registered.body.secret).toBe("string");
    expect((registered.body.secret as string).length).toBeGreaterThan(20);
    expect(registered.body.relay_tier).toBe("shared");
    expect(typeof registered.body.relay_wss_url).toBe("string");
    expect((registered.body.relay_wss_url as string).length).toBeGreaterThan(0);
    expect(registered.body.relay_close_code_on_revoke).toBe(4401);

    const secret = registered.body.secret as string;
    const instanceId = registered.body.instance_id as string;

    const validate = await jsonRequest(app, "/internal/instances/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, secret }),
    });
    expect(validate.status).toBe(200);
    expect(validate.body.valid).toBe(true);
    expect(validate.body.tenant_id).toBe(tenantId);
    expect(validate.body.instance_id).toBe(instanceId);
  });

  it("provision alias matches register response contract", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "compat", display_name: "Compat Tenant" }),
    });

    const tenantId = tenant.body.tenant_id as string;
    const provision = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/provision`,
      { method: "POST" },
    );

    expect(provision.status).toBe(201);
    expect(provision.body).toMatchObject({
      tenant_id: tenantId,
      relay_close_code_on_revoke: 4401,
    });
    expect(provision.body.instance_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(typeof provision.body.secret).toBe("string");
    expect(typeof provision.body.relay_tier).toBe("string");
    expect(typeof provision.body.relay_wss_url).toBe("string");
  });

  it("does not return secret on list or primary-instance GET after register", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "no-leak", display_name: "No Leak" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const secret = registered.body.secret as string;
    const instanceId = registered.body.instance_id as string;
    expect(secret.length).toBeGreaterThan(20);

    const listed = await jsonRequest(
      app,
      `/tenants/${tenantId}/gateway-instances`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.tenant_id).toBe(tenantId);
    const instances = listed.body.instances as Array<Record<string, unknown>>;
    expect(instances).toHaveLength(1);
    expect(instances[0].instance_id).toBe(instanceId);
    expect(instances[0]).not.toHaveProperty("secret");
    expect(instances[0]).not.toHaveProperty("secret_hash");
    expect(instances[0]).not.toHaveProperty("secret_salt");
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const primary = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/primary-instance`,
    );
    expect(primary.status).toBe(200);
    expect(primary.body.instance_id).toBe(instanceId);
    expect(primary.body).not.toHaveProperty("secret");
    expect(JSON.stringify(primary.body)).not.toContain(secret);

    const tenantGet = await jsonRequest(app, `/tenants/${tenantId}`);
    expect(tenantGet.status).toBe(200);
    expect(JSON.stringify(tenantGet.body)).not.toContain(secret);
  });

  it("isolates tenants: secrets do not cross tenant boundaries", async () => {
    const tenantA = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", display_name: "Alpha" }),
    });
    const tenantB = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "beta", display_name: "Beta" }),
    });

    const provisionA = await jsonRequest(
      app,
      `/tenants/${tenantA.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );
    const provisionB = await jsonRequest(
      app,
      `/tenants/${tenantB.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );

    const instanceA = provisionA.body.instance_id as string;
    const secretA = provisionA.body.secret as string;
    const instanceB = provisionB.body.instance_id as string;
    const secretB = provisionB.body.secret as string;

    expect(
      (await validateInstanceSecret(store, instanceA, secretA)).valid,
    ).toBe(true);
    expect(
      (await validateInstanceSecret(store, instanceB, secretB)).valid,
    ).toBe(true);

    const crossAtoB = await validateInstanceSecret(store, instanceB, secretA);
    expect(crossAtoB.valid).toBe(false);
    if (!crossAtoB.valid) {
      expect(crossAtoB.reason).toBe("invalid_secret");
      expect(crossAtoB.tenant_id).toBe(tenantB.body.tenant_id);
    }

    const crossBtoA = await validateInstanceSecret(store, instanceA, secretB);
    expect(crossBtoA.valid).toBe(false);
    if (!crossBtoA.valid) {
      expect(crossBtoA.reason).toBe("invalid_secret");
      expect(crossBtoA.tenant_id).toBe(tenantA.body.tenant_id);
    }
  });

  it("deprovisions tenant and rejects revoked secrets with 4401 semantics", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "revoke-me", display_name: "Revoke Me" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const provision = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/provision`,
      { method: "POST" },
    );
    const instanceId = provision.body.instance_id as string;
    const secret = provision.body.secret as string;

    const deprovision = await jsonRequest(
      app,
      `/tenants/${tenantId}/deprovision`,
      { method: "POST" },
    );

    expect(deprovision.status).toBe(200);
    expect(deprovision.body.revoked_instance_count).toBe(1);
    expect(deprovision.body.revoked_instance_ids).toEqual([instanceId]);
    expect(deprovision.body.relay_close_code).toBe(4401);
    expect(String(deprovision.body.relay_revoke_hint)).toContain(
      "/internal/instances/",
    );

    const revoked = await validateInstanceSecret(store, instanceId, secret);
    expect(revoked.valid).toBe(false);
    if (!revoked.valid) {
      expect(revoked.reason).toBe("revoked");
    }

    const validateHttp = await jsonRequest(
      app,
      "/internal/instances/validate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instance_id: instanceId, secret }),
      },
    );
    expect(validateHttp.status).toBe(401);
    expect(validateHttp.body.valid).toBe(false);
    expect(validateHttp.body.reason).toBe("revoked");
  });

  it("revokes a single instance secret and keeps sibling instances active", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "single-revoke",
        display_name: "Single Revoke",
      }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const first = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const second = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const instanceA = first.body.instance_id as string;
    const secretA = first.body.secret as string;
    const instanceB = second.body.instance_id as string;
    const secretB = second.body.secret as string;

    const revoke = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${instanceA}/revoke`,
      { method: "POST" },
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({
      tenant_id: tenantId,
      instance_id: instanceA,
      already_revoked: false,
      relay_close_code: 4401,
      relay_revoke_path: `/internal/instances/${instanceA}/revoke`,
    });
    expect(String(revoke.body.relay_revoke_hint)).toContain(
      "x-relay-internal-token",
    );

    const a = await validateInstanceSecret(store, instanceA, secretA);
    expect(a.valid).toBe(false);
    if (!a.valid) expect(a.reason).toBe("revoked");

    const b = await validateInstanceSecret(store, instanceB, secretB);
    expect(b.valid).toBe(true);

    const again = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${instanceA}/revoke`,
      { method: "POST" },
    );
    expect(again.status).toBe(200);
    expect(again.body.already_revoked).toBe(true);

    const audit = await store.listAuditEntries(tenantId);
    expect(audit.some((e) => e.action === "instance.revoked")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(secretA);

    const missing = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${crypto.randomUUID()}/revoke`,
      { method: "POST" },
    );
    expect(missing.status).toBe(404);
  });

  it("records audit metadata only (no message bodies or secrets)", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "audit", display_name: "Audit Tenant" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const instanceId = registered.body.instance_id as string;
    const secret = registered.body.secret as string;

    await jsonRequest(app, "/internal/instances/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, secret }),
    });

    const entries = await store.listAuditEntries(tenantId);
    const serialized = JSON.stringify(entries);
    const provisionAudit = entries.find(
      (e) => e.action === "instance.provisioned",
    );

    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("message_body");
    expect(entries.some((e) => e.action === "tenant.created")).toBe(true);
    expect(provisionAudit).toBeDefined();
    expect(provisionAudit?.metadata).toMatchObject({
      instance_id: instanceId,
      tenant_slug: "audit",
    });
    expect(provisionAudit?.metadata).not.toHaveProperty("secret");
    expect(JSON.stringify(provisionAudit?.metadata)).not.toContain(secret);
    expect(
      entries.some((e) => e.action === "instance.secret_validated"),
    ).toBe(true);
  });

  it("redacts vault/body secrets if a caller passes them into recordAudit (G2b.2)", async () => {
    await store.recordAudit({
      tenant_id: null,
      action: "tenant.created",
      actor: "test",
      metadata: {
        instance_id: "i-leak-check",
        secret: "plaintext-must-never-land",
        password: "hunter2",
        body: { text: "vault or chat dump" },
        content: "TOP SECRET FILE",
        vault_content: "do-not-store",
      },
    });

    const entries = await store.listAuditEntries();
    const last = entries[entries.length - 1];
    expect(last?.metadata.instance_id).toBe("i-leak-check");
    expect(last?.metadata.secret).toBe("[REDACTED]");
    expect(last?.metadata.password).toBe("[REDACTED]");
    expect(last?.metadata.body).toBe("[REDACTED]");
    expect(last?.metadata.content).toBe("[REDACTED]");
    expect(last?.metadata.vault_content).toBe("[REDACTED]");

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("plaintext-must-never-land");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("vault or chat dump");
    expect(serialized).not.toContain("TOP SECRET FILE");
    expect(serialized).not.toContain("do-not-store");
  });

  it("defaults retention policy to export off", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "retain-off", display_name: "Retain Off" }),
    });

    const tenantId = tenant.body.tenant_id as string;
    const fetched = await jsonRequest(app, `/tenants/${tenantId}`, {
      method: "GET",
    });

    expect(fetched.status).toBe(200);
    expect(fetched.body.retention).toEqual({
      interaction_export_enabled: false,
      retention_mode: "none",
      // L10 chat corpus defaults fail closed (lp-gkh.6)
      chat_corpus_enabled: false,
      chat_corpus_retention_days: null,
    });

    const internal = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "GET",
        headers: { "x-internal-ops-token": OPS_TOKEN },
      },
    );

    expect(internal.status).toBe(200);
    expect(internal.body.interaction_export_enabled).toBe(false);
    expect(internal.body.retention_mode).toBe("none");
    expect(internal.body.chat_corpus_enabled).toBe(false);
    expect(internal.body.chat_corpus_retention_days).toBeNull();
  });

  it("rejects retention updates without internal ops token", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "ops-auth", display_name: "Ops Auth" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const denied = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interaction_export_enabled: true }),
      },
    );

    expect(denied.status).toBe(401);

    const enabled = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
          "x-lanyard-actor": "lanyard-ops",
        },
        body: JSON.stringify({
          interaction_export_enabled: true,
          retention_mode: "interaction_export",
        }),
      },
    );

    expect(enabled.status).toBe(200);
    expect(enabled.body.interaction_export_enabled).toBe(true);
    expect(enabled.body.retention_mode).toBe("interaction_export");
    // L10 remains off when only L5 is patched
    expect(enabled.body.chat_corpus_enabled).toBe(false);
    expect(enabled.body.chat_corpus_retention_days).toBeNull();

    const entries = await store.listAuditEntries(tenantId);
    const retentionAudit = entries.find(
      (entry) => entry.action === "tenant.retention_updated",
    );

    expect(retentionAudit).toBeDefined();
    expect(retentionAudit?.metadata).toEqual({
      tenant_slug: "ops-auth",
      interaction_export_enabled: true,
      retention_mode: "interaction_export",
      chat_corpus_enabled: false,
      chat_corpus_retention_days: null,
    });
    expect(JSON.stringify(retentionAudit)).not.toContain("message_body");
  });

  it("GET/PATCH chat_corpus_enabled + retention_days (lp-gkh.6)", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "corpus-gate",
        display_name: "Corpus Gate",
      }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const before = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "GET",
        headers: { "x-internal-ops-token": OPS_TOKEN },
      },
    );
    expect(before.status).toBe(200);
    expect(before.body.chat_corpus_enabled).toBe(false);
    expect(before.body.chat_corpus_retention_days).toBeNull();

    const tooShort = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({
          chat_corpus_enabled: true,
          chat_corpus_retention_days: 7,
        }),
      },
    );
    expect(tooShort.status).toBe(400);

    const enabled = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
          "x-lanyard-actor": "lanyard-ops",
        },
        body: JSON.stringify({
          chat_corpus_enabled: true,
          chat_corpus_retention_days: 90,
        }),
      },
    );
    expect(enabled.status).toBe(200);
    expect(enabled.body.chat_corpus_enabled).toBe(true);
    expect(enabled.body.chat_corpus_retention_days).toBe(90);
    // L5 unchanged when only L10 is patched
    expect(enabled.body.interaction_export_enabled).toBe(false);
    expect(enabled.body.retention_mode).toBe("none");

    const after = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "GET",
        headers: { "x-internal-ops-token": OPS_TOKEN },
      },
    );
    expect(after.status).toBe(200);
    expect(after.body.chat_corpus_enabled).toBe(true);
    expect(after.body.chat_corpus_retention_days).toBe(90);

    const tenantGet = await jsonRequest(app, `/tenants/${tenantId}`, {
      method: "GET",
    });
    expect(tenantGet.status).toBe(200);
    expect(
      (tenantGet.body.retention as Record<string, unknown>).chat_corpus_enabled,
    ).toBe(true);

    const disabled = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
          "x-lanyard-actor": "lanyard-ops",
        },
        body: JSON.stringify({ chat_corpus_enabled: false }),
      },
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.chat_corpus_enabled).toBe(false);
    // Retention days retained for re-enable; ops may clear with null
    expect(disabled.body.chat_corpus_retention_days).toBe(90);

    const cleared = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/retention`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({ chat_corpus_retention_days: null }),
      },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.chat_corpus_retention_days).toBeNull();

    const entries = await store.listAuditEntries(tenantId);
    const corpusAudit = entries.find(
      (entry) =>
        entry.action === "tenant.retention_updated" &&
        (entry.metadata as { chat_corpus_enabled?: boolean })
          ?.chat_corpus_enabled === true,
    );
    expect(corpusAudit).toBeDefined();
    expect(JSON.stringify(corpusAudit)).not.toContain("message_body");
  });

  it("GET/PATCH chat_delivery so MockLab can flip alone (lp-oop.29)", async () => {
    const mocklab = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "mocklab", display_name: "MockLab" }),
    });
    const sibling = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "acme", display_name: "Acme" }),
    });
    const mocklabId = mocklab.body.tenant_id as string;
    const siblingId = sibling.body.tenant_id as string;

    expect(mocklab.body.chat_delivery).toBeNull();
    expect(sibling.body.chat_delivery).toBeNull();

    const denied = await jsonRequest(
      app,
      `/internal/tenants/${mocklabId}/chat-delivery`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_delivery: "harness" }),
      },
    );
    expect(denied.status).toBe(401);

    const flipped = await jsonRequest(
      app,
      `/internal/tenants/${mocklabId}/chat-delivery`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
          "x-lanyard-actor": "lanyard-ops",
        },
        body: JSON.stringify({ chat_delivery: "harness" }),
      },
    );
    expect(flipped.status).toBe(200);
    expect(flipped.body.chat_delivery).toBe("harness");

    const after = await jsonRequest(
      app,
      `/internal/tenants/${mocklabId}/chat-delivery`,
      {
        method: "GET",
        headers: { "x-internal-ops-token": OPS_TOKEN },
      },
    );
    expect(after.status).toBe(200);
    expect(after.body.chat_delivery).toBe("harness");

    const mocklabGet = await jsonRequest(app, `/tenants/${mocklabId}`, {
      method: "GET",
    });
    expect(mocklabGet.body.chat_delivery).toBe("harness");

    const siblingGet = await jsonRequest(app, `/tenants/${siblingId}`, {
      method: "GET",
    });
    expect(siblingGet.body.chat_delivery).toBeNull();

    const bySlug = await jsonRequest(app, "/internal/tenants/by-slug/mocklab", {
      method: "GET",
    });
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.chat_delivery).toBe("harness");

    const cleared = await jsonRequest(
      app,
      `/internal/tenants/${mocklabId}/chat-delivery`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-internal-ops-token": OPS_TOKEN,
        },
        body: JSON.stringify({ chat_delivery: null }),
      },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.chat_delivery).toBeNull();

    const entries = await store.listAuditEntries(mocklabId);
    const deliveryAudits = entries.filter(
      (entry) => entry.action === "tenant.chat_delivery_updated",
    );
    expect(deliveryAudits).toHaveLength(2);
    expect(deliveryAudits[0]?.metadata).toMatchObject({
      tenant_slug: "mocklab",
      chat_delivery: "harness",
    });
    expect(deliveryAudits[1]?.metadata).toMatchObject({
      tenant_slug: "mocklab",
      chat_delivery: null,
    });
  });

  it("rotates instance secret with dual-accept grace (default)", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "rotate-me", display_name: "Rotate Me" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const instanceId = registered.body.instance_id as string;
    const oldSecret = registered.body.secret as string;

    const rotated = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${instanceId}/rotate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lanyard-actor": "ops-rotate",
        },
        body: JSON.stringify({}),
      },
    );

    expect(rotated.status).toBe(200);
    expect(rotated.body.instance_id).toBe(instanceId);
    expect(rotated.body.tenant_id).toBe(tenantId);
    expect(typeof rotated.body.secret).toBe("string");
    expect(rotated.body.secret).not.toBe(oldSecret);
    expect((rotated.body.secret as string).length).toBeGreaterThan(20);
    expect(rotated.body.grace_period_seconds).toBe(15 * 60);
    expect(rotated.body.rotation_policy).toBe("dual_accept_grace");
    expect(typeof rotated.body.previous_secret_accepted_until).toBe("string");
    expect(rotated.body.relay_close_code_on_revoke).toBe(4401);

    const newSecret = rotated.body.secret as string;

    // Both secrets valid during grace (SSM overwrite window).
    const oldStillValid = await jsonRequest(
      app,
      "/internal/instances/validate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instance_id: instanceId, secret: oldSecret }),
      },
    );
    expect(oldStillValid.status).toBe(200);
    expect(oldStillValid.body.valid).toBe(true);

    const newValid = await jsonRequest(app, "/internal/instances/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, secret: newSecret }),
    });
    expect(newValid.status).toBe(200);
    expect(newValid.body.valid).toBe(true);

    // List/GET never expose secrets (old or new).
    const listed = await jsonRequest(
      app,
      `/tenants/${tenantId}/gateway-instances`,
    );
    expect(JSON.stringify(listed.body)).not.toContain(oldSecret);
    expect(JSON.stringify(listed.body)).not.toContain(newSecret);

    const entries = await store.listAuditEntries(tenantId);
    const rotateAudit = entries.find((e) => e.action === "instance.rotated");
    expect(rotateAudit).toBeDefined();
    expect(rotateAudit?.actor).toBe("ops-rotate");
    expect(rotateAudit?.metadata).toMatchObject({
      instance_id: instanceId,
      grace_period_seconds: 15 * 60,
    });
    expect(JSON.stringify(entries)).not.toContain(oldSecret);
    expect(JSON.stringify(entries)).not.toContain(newSecret);
  });

  it("rotates with grace_period_seconds 0 and immediately invalidates old secret", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "rotate-immediate",
        display_name: "Rotate Immediate",
      }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const instanceId = registered.body.instance_id as string;
    const oldSecret = registered.body.secret as string;

    const rotated = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${instanceId}/rotate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grace_period_seconds: 0 }),
      },
    );

    expect(rotated.status).toBe(200);
    expect(rotated.body.rotation_policy).toBe("immediate_invalidate");
    expect(rotated.body.grace_period_seconds).toBe(0);
    expect(rotated.body.previous_secret_accepted_until).toBeNull();

    const newSecret = rotated.body.secret as string;

    const oldRejected = await validateInstanceSecret(store, instanceId, oldSecret);
    expect(oldRejected.valid).toBe(false);
    if (!oldRejected.valid) {
      expect(oldRejected.reason).toBe("invalid_secret");
    }

    const newOk = await validateInstanceSecret(store, instanceId, newSecret);
    expect(newOk.valid).toBe(true);
  });

  it("rejects rotate for missing instance, wrong tenant, or revoked instance", async () => {
    const tenantA = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "rot-a", display_name: "Rot A" }),
    });
    const tenantB = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "rot-b", display_name: "Rot B" }),
    });
    const tenantAId = tenantA.body.tenant_id as string;
    const tenantBId = tenantB.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantAId}/instances/register`,
      { method: "POST" },
    );
    const instanceId = registered.body.instance_id as string;

    const missing = await jsonRequest(
      app,
      `/tenants/${tenantAId}/instances/00000000-0000-4000-8000-000000000099/rotate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(missing.status).toBe(404);

    const wrongTenant = await jsonRequest(
      app,
      `/tenants/${tenantBId}/instances/${instanceId}/rotate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(wrongTenant.status).toBe(404);

    await jsonRequest(app, `/tenants/${tenantAId}/deprovision`, {
      method: "POST",
    });

    const revoked = await jsonRequest(
      app,
      `/tenants/${tenantAId}/instances/${instanceId}/rotate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(revoked.status).toBe(409);
  });

  it("expires previous secret after grace window ends", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "rot-grace", display_name: "Rot Grace" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const registered = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/register`,
      { method: "POST" },
    );
    const instanceId = registered.body.instance_id as string;
    const oldSecret = registered.body.secret as string;

    // 1s grace so the test can wait for expiry without flaking on long sleeps.
    const rotated = await jsonRequest(
      app,
      `/tenants/${tenantId}/instances/${instanceId}/rotate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grace_period_seconds: 1 }),
      },
    );
    expect(rotated.status).toBe(200);
    const newSecret = rotated.body.secret as string;

    expect((await validateInstanceSecret(store, instanceId, oldSecret)).valid).toBe(
      true,
    );
    expect((await validateInstanceSecret(store, instanceId, newSecret)).valid).toBe(
      true,
    );

    expect((await store.getInstance(instanceId))?.previous_secret_expires_at).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const oldAfter = await validateInstanceSecret(store, instanceId, oldSecret);
    expect(oldAfter.valid).toBe(false);
    if (!oldAfter.valid) {
      expect(oldAfter.reason).toBe("invalid_secret");
    }
    expect((await validateInstanceSecret(store, instanceId, newSecret)).valid).toBe(
      true,
    );
  });

  it("deprovision on one tenant does not revoke another tenant", async () => {
    const tenantA = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "keep", display_name: "Keep" }),
    });
    const tenantB = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "drop", display_name: "Drop" }),
    });

    const provisionA = await jsonRequest(
      app,
      `/tenants/${tenantA.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );
    const provisionB = await jsonRequest(
      app,
      `/tenants/${tenantB.body.tenant_id}/instances/provision`,
      { method: "POST" },
    );

    await jsonRequest(app, `/tenants/${tenantB.body.tenant_id}/deprovision`, {
      method: "POST",
    });

    const stillValid = await validateInstanceSecret(
      store,
      provisionA.body.instance_id as string,
      provisionA.body.secret as string,
    );
    const nowRevoked = await validateInstanceSecret(
      store,
      provisionB.body.instance_id as string,
      provisionB.body.secret as string,
    );

    expect(stillValid.valid).toBe(true);
    expect(nowRevoked.valid).toBe(false);
    if (!nowRevoked.valid) {
      expect(nowRevoked.reason).toBe("revoked");
    }
  });
});