/**
 * cbd-mta.3.3 — deployment/resource registry + audit boundary.
 *
 * Proves tenant-scoped registry metadata, foreign-tenant rejection,
 * secret-ARN-only fields, rotation lifecycle timestamps, audit first-class
 * fields (no vault bodies), and offboarding soft-retire.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  ControlPlaneStore,
  CrossTenantResourceRefError,
  InvalidDeploymentInputError,
} from "../src/store.js";
import { openDatabase, resolveDatabaseUrl } from "../src/db.js";
import { migrateControlPlaneSchema } from "../src/migrate.js";

describe("deployment/resource registry (cbd-mta.3.3)", () => {
  let store: ControlPlaneStore;
  let tenantAId: string;
  let tenantBId: string;
  let instanceAId: string;

  beforeEach(async () => {
    const schema = `cp_reg_${randomUUID().replace(/-/g, "")}`;
    store = await ControlPlaneStore.create({ schema });

    const tenantA = await store.createTenant({
      slug: "reg-alpha",
      display_name: "Registry Alpha",
    });
    const tenantB = await store.createTenant({
      slug: "reg-beta",
      display_name: "Registry Beta",
    });
    tenantAId = tenantA.tenant_id;
    tenantBId = tenantB.tenant_id;

    const provisioned = await store.provisionInstance({
      tenant_id: tenantAId,
      actor: "test",
    });
    instanceAId = provisioned.instance_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("upserts tenant deployment metadata (not tfstate)", async () => {
    const dep = await store.upsertTenantDeployment({
      tenant_id: tenantAId,
      hosting_track: "lanyard_hosted",
      isolation_mode: "vpc_interim",
      aws_account_id: "123456789012",
      aws_region: "us-east-1",
      project_name: "reg-alpha-brain",
      status: "active",
      client_core_version: "v0.1.0-g7c2",
      hermes_version: "v0.1.0-g7h2",
      primary_instance_id: instanceAId,
      actor: "ops",
      request_id: "req-deploy-1",
    });

    expect(dep.tenant_id).toBe(tenantAId);
    expect(dep.hosting_track).toBe("lanyard_hosted");
    expect(dep.aws_account_id).toBe("123456789012");
    expect(dep.primary_instance_id).toBe(instanceAId);
    expect(dep).not.toHaveProperty("tfstate");
    expect(dep).not.toHaveProperty("private_key");

    const loaded = await store.getTenantDeployment(tenantAId);
    expect(loaded?.status).toBe("active");
    expect(loaded?.hermes_version).toBe("v0.1.0-g7h2");
  });

  it("rejects non-12-digit aws_account_id", async () => {
    await expect(
      store.upsertTenantDeployment({
        tenant_id: tenantAId,
        hosting_track: "customer_account",
        isolation_mode: "customer_account",
        aws_account_id: "not-an-account",
      }),
    ).rejects.toBeInstanceOf(InvalidDeploymentInputError);
  });

  it("rejects primary_instance_id from another tenant", async () => {
    await expect(
      store.upsertTenantDeployment({
        tenant_id: tenantBId,
        hosting_track: "lanyard_hosted",
        isolation_mode: "account",
        primary_instance_id: instanceAId,
      }),
    ).rejects.toBeInstanceOf(CrossTenantResourceRefError);
  });

  it("stores resource refs with secret ARN only (never secret values)", async () => {
    const ref = await store.upsertTenantResourceRef({
      tenant_id: tenantAId,
      resource_kind: "ssm_parameter",
      name: "gateway-relay-secret",
      secret_arn:
        "arn:aws:ssm:us-east-1:123456789012:parameter/company-brain/reg-alpha/relay",
      aws_region: "us-east-1",
      actor: "ops",
      request_id: "req-res-1",
    });

    expect(ref.secret_arn).toMatch(/^arn:aws:ssm:/);
    expect(ref.tenant_id).toBe(tenantAId);

    await expect(
      store.upsertTenantResourceRef({
        tenant_id: tenantAId,
        resource_kind: "ssm_parameter",
        name: "bad-secret",
        secret_arn: "GATEWAY_RELAY_SECRET=supersecretvalue",
      }),
    ).rejects.toBeInstanceOf(InvalidDeploymentInputError);
  });

  it("rejects retiring a resource ref from another tenant", async () => {
    const ref = await store.upsertTenantResourceRef({
      tenant_id: tenantAId,
      resource_kind: "ec2_instance",
      name: "brain",
      aws_id: "i-0123456789abcdef0",
    });

    await expect(
      store.retireTenantResourceRef({
        tenant_id: tenantBId,
        resource_ref_id: ref.resource_ref_id,
      }),
    ).rejects.toBeInstanceOf(CrossTenantResourceRefError);
  });

  it("updates instance registry health and secret_param_arn", async () => {
    const updated = await store.updateInstanceRegistry({
      tenant_id: tenantAId,
      instance_id: instanceAId,
      health_status: "healthy",
      last_seen_at: new Date().toISOString(),
      secret_param_arn:
        "arn:aws:ssm:us-east-1:123456789012:parameter/company-brain/reg-alpha/relay",
      ec2_instance_id: "i-0abc123def4567890",
      aws_region: "us-east-1",
      actor: "health-probe",
      request_id: "req-health-1",
    });

    expect(updated.health_status).toBe("healthy");
    expect(updated.ec2_instance_id).toBe("i-0abc123def4567890");
    expect(updated.secret_param_arn).toMatch(/^arn:aws:ssm:/);

    const listed = await store.listActiveInstances(tenantAId);
    expect(listed[0]?.health_status).toBe("healthy");
    expect(listed[0]).not.toHaveProperty("secret_hash");
    expect(listed[0]).not.toHaveProperty("secret");
  });

  it("persists lp-nye dual-run fields (runtime_kind, sandbox_id, presence, snapshot, s3 prefix)", async () => {
    const provisioned = await store.getInstance(instanceAId);
    expect(provisioned?.runtime_kind).toBe("ec2");
    expect(provisioned?.presence).toBe("offline");
    expect(provisioned?.sandbox_id).toBeNull();
    expect(provisioned?.agent_snapshot_id).toBeNull();
    expect(provisioned?.s3_vault_prefix).toBeNull();
    expect(provisioned?.chat_delivery).toBeNull();

    // lp-3a1.1: prefix must use CP tenant_id segment (not slug); s3:// shell ok.
    const updated = await store.updateInstanceRegistry({
      tenant_id: tenantAId,
      instance_id: instanceAId,
      runtime_kind: "daytona",
      sandbox_id: "sbox-test-abc123",
      presence: "online",
      agent_snapshot_id: "snap-agent-offline-v1",
      s3_vault_prefix: `s3://lanyard-vault/tenants/${tenantAId}/vault/`,
      chat_delivery: "harness",
      // EC2 host id is not the auth identity; may clear on daytona path
      ec2_instance_id: null,
      actor: "orchestrator-offline",
      request_id: "req-lp-nye-1",
    });

    expect(updated.runtime_kind).toBe("daytona");
    expect(updated.sandbox_id).toBe("sbox-test-abc123");
    expect(updated.presence).toBe("online");
    expect(updated.agent_snapshot_id).toBe("snap-agent-offline-v1");
    // Stored as normative relative form after tenant bind.
    expect(updated.s3_vault_prefix).toBe(`tenants/${tenantAId}/vault/`);
    expect(updated.ec2_instance_id).toBeNull();
    expect(updated.chat_delivery).toBe("harness");

    const reloaded = await store.getInstance(instanceAId);
    expect(reloaded?.runtime_kind).toBe("daytona");
    expect(reloaded?.sandbox_id).toBe("sbox-test-abc123");
    expect(reloaded?.presence).toBe("online");
    expect(reloaded?.s3_vault_prefix).toBe(`tenants/${tenantAId}/vault/`);
    expect(reloaded?.chat_delivery).toBe("harness");

    const listed = await store.listActiveInstances(tenantAId);
    const pub = listed.find((r) => r.instance_id === instanceAId);
    expect(pub?.runtime_kind).toBe("daytona");
    expect(pub?.presence).toBe("online");
    expect(pub?.sandbox_id).toBe("sbox-test-abc123");
    expect(pub?.chat_delivery).toBe("harness");
  });

  it("rejects invalid runtime_kind and presence values", async () => {
    await expect(
      store.updateInstanceRegistry({
        tenant_id: tenantAId,
        instance_id: instanceAId,
        runtime_kind: "k8s",
      }),
    ).rejects.toBeInstanceOf(InvalidDeploymentInputError);

    await expect(
      store.updateInstanceRegistry({
        tenant_id: tenantAId,
        instance_id: instanceAId,
        chat_delivery: "grpc",
      }),
    ).rejects.toBeInstanceOf(InvalidDeploymentInputError);

    await expect(
      store.updateInstanceRegistry({
        tenant_id: tenantAId,
        instance_id: instanceAId,
        presence: "booting",
      }),
    ).rejects.toBeInstanceOf(InvalidDeploymentInputError);
  });

  it("records credential_rotated_at on rotate and first-class audit fields", async () => {
    const rotated = await store.rotateInstance({
      tenant_id: tenantAId,
      instance_id: instanceAId,
      grace_period_seconds: 0,
      actor: "ops",
    });
    expect(rotated.secret).toBeTruthy();

    const instance = await store.getInstance(instanceAId);
    expect(instance?.credential_rotated_at).toBeTruthy();

    const audits = await store.listAuditEntries(tenantAId);
    const rotateAudit = audits.find((a) => a.action === "instance.rotated");
    expect(rotateAudit).toBeTruthy();
    expect(rotateAudit?.instance_id).toBe(instanceAId);
    expect(rotateAudit?.result).toBe("success");
    expect(rotateAudit?.actor).toBe("ops");
    // No secret body in metadata
    expect(JSON.stringify(rotateAudit?.metadata)).not.toMatch(
      rotated.secret.slice(0, 8),
    );
  });

  it("audit entries include actor, tenant, instance, action, result, request_id without bodies", async () => {
    await store.updateInstanceRegistry({
      tenant_id: tenantAId,
      instance_id: instanceAId,
      health_status: "degraded",
      actor: "probe",
      request_id: "req-audit-boundary",
    });

    const audits = await store.listAuditEntries(tenantAId);
    const entry = audits.find((a) => a.action === "instance.registry_updated");
    expect(entry).toMatchObject({
      tenant_id: tenantAId,
      action: "instance.registry_updated",
      actor: "probe",
      instance_id: instanceAId,
      result: "success",
      request_id: "req-audit-boundary",
    });
    expect(entry?.metadata).not.toHaveProperty("vault_body");
    expect(entry?.metadata).not.toHaveProperty("secret");
    expect(entry?.metadata).not.toHaveProperty("file_body");
  });

  it("offboarding via deprovision retires resources and marks deployment", async () => {
    await store.upsertTenantDeployment({
      tenant_id: tenantAId,
      hosting_track: "lanyard_hosted",
      isolation_mode: "vpc_interim",
      status: "active",
    });
    await store.upsertTenantResourceRef({
      tenant_id: tenantAId,
      resource_kind: "ebs_volume",
      name: "vault-disk",
      aws_id: "vol-0123456789abcdef0",
    });
    await store.upsertTenantResourceRef({
      tenant_id: tenantAId,
      resource_kind: "kms_key",
      name: "ebs-cmk",
      arn: "arn:aws:kms:us-east-1:123456789012:key/abcd",
    });

    const deprov = await store.deprovisionTenant({
      tenant_id: tenantAId,
      actor: "ops",
    });
    expect(deprov.revoked_instance_count).toBe(1);

    const active = await store.listTenantResourceRefs(tenantAId);
    expect(active).toHaveLength(0);

    const all = await store.listTenantResourceRefs(tenantAId, {
      include_retired: true,
    });
    expect(all.every((r) => r.status === "retired")).toBe(true);

    const dep = await store.getTenantDeployment(tenantAId);
    expect(dep?.status).toBe("offboarding");
    expect(dep?.retired_at).toBeTruthy();
  });

  it("schema has registry tables and no vault-body tables", async () => {
    const schema = `cp_reg_schema_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      await migrateControlPlaneSchema(db); // idempotent

      const tables = await db.all<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      const names = tables.map((t) => t.table_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "tenant_deployments",
          "tenant_resource_refs",
          "gateway_instances",
          "audit_log",
        ]),
      );
      for (const forbidden of [
        "vault_files",
        "file_bodies",
        "tfstate",
        "terraform_state",
      ]) {
        expect(names).not.toContain(forbidden);
      }

      const auditCols = await db.all<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'audit_log'`,
      );
      const auditNames = auditCols.map((c) => c.column_name);
      expect(auditNames).toEqual(
        expect.arrayContaining([
          "actor",
          "tenant_id",
          "instance_id",
          "action",
          "result",
          "request_id",
          "metadata_json",
        ]),
      );

      const giCols = await db.all<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gateway_instances'`,
      );
      const giNames = giCols.map((c) => c.column_name);
      expect(giNames).toEqual(
        expect.arrayContaining([
          "secret_hash",
          "health_status",
          "credential_rotated_at",
          "secret_param_arn",
          "last_seen_at",
          // lp-nye dual-run / Daytona fields
          "runtime_kind",
          "sandbox_id",
          "presence",
          "agent_snapshot_id",
          "s3_vault_prefix",
          // lp-omt presence store idle clock
          "last_activity_at",
        ]),
      );
      expect(giNames).not.toContain("secret");
      expect(giNames).not.toContain("plaintext_secret");
    } finally {
      await db.close();
    }
  });
});
