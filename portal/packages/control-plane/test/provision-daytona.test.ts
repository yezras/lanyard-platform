/**
 * lp-6jx — Provision runtime_kind=daytona (CP-first, no TF EC2, no live Daytona).
 *
 * Pure unit tests + package surface checks. No Postgres / AWS / Daytona network.
 * Fake S3 used only when exercising optional prefix-ensure composition.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  buildDaytonaProvisionFields,
  buildGatewayInstanceProvisionFields,
  isLazyDaytonaProvision,
  InvalidProvisionInputError,
  parseProvisionRuntimeKind,
} from "../src/provision-daytona.js";
import { ensureVaultPrefixForDaytonaProvision } from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const storeSrc = readFileSync(join(__dirname, "../src/store.ts"), "utf8");
const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
const typesSrc = readFileSync(join(__dirname, "../src/types.ts"), "utf8");

const TENANT = "00000000-0000-4000-8000-0000000000aa";
const BUCKET = "lanyard-mocklab-vault-test";

describe("parseProvisionRuntimeKind (lp-6jx)", () => {
  it("defaults empty/undefined to ec2", () => {
    expect(parseProvisionRuntimeKind(undefined)).toBe("ec2");
    expect(parseProvisionRuntimeKind(null)).toBe("ec2");
    expect(parseProvisionRuntimeKind("")).toBe("ec2");
  });

  it("accepts ec2 and daytona", () => {
    expect(parseProvisionRuntimeKind("ec2")).toBe("ec2");
    expect(parseProvisionRuntimeKind("daytona")).toBe("daytona");
  });

  it("rejects unknown kinds (no silent coerce)", () => {
    expect(() => parseProvisionRuntimeKind("k8s")).toThrow(
      InvalidProvisionInputError,
    );
    expect(() => parseProvisionRuntimeKind("lambda")).toThrow(
      /runtime_kind must be one of/,
    );
  });
});

describe("buildGatewayInstanceProvisionFields — ec2 default", () => {
  it("keeps EC2 path with null prefix and no sandbox", () => {
    const fields = buildGatewayInstanceProvisionFields({ tenantId: TENANT });
    expect(fields).toEqual({
      runtime_kind: "ec2",
      sandbox_id: null,
      presence: "offline",
      agent_snapshot_id: null,
      s3_vault_prefix: null,
      ec2_instance_id: null,
    });
    expect(isLazyDaytonaProvision(fields)).toBe(false);
  });

  it("rejects s3_vault_prefix on ec2 path", () => {
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "ec2",
        s3VaultPrefix: "tenants/x/vault/",
      }),
    ).toThrow(InvalidProvisionInputError);
  });
});

describe("buildGatewayInstanceProvisionFields — daytona (lp-6jx §4.11)", () => {
  it("sets runtime_kind=daytona, assigns s3_vault_prefix, sandbox null, no EC2", () => {
    const fields = buildGatewayInstanceProvisionFields({
      tenantId: TENANT,
      runtimeKind: "daytona",
    });

    expect(fields.runtime_kind).toBe("daytona");
    expect(fields.sandbox_id).toBeNull();
    expect(fields.presence).toBe("offline");
    expect(fields.ec2_instance_id).toBeNull();
    expect(fields.s3_vault_prefix).toBe(`tenants/${TENANT}/vault/`);
    expect(fields.agent_snapshot_id).toBeNull();
    expect(isLazyDaytonaProvision(fields)).toBe(true);
  });

  it("accepts optional agent_snapshot_id pin", () => {
    const fields = buildGatewayInstanceProvisionFields({
      tenantId: TENANT,
      runtimeKind: "daytona",
      agentSnapshotId: "offline:agent-default",
    });
    expect(fields.agent_snapshot_id).toBe("offline:agent-default");
    expect(fields.sandbox_id).toBeNull();
  });

  it("rejects control chars in agent_snapshot_id", () => {
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "daytona",
        agentSnapshotId: "bad\npin",
      }),
    ).toThrow(InvalidProvisionInputError);
  });

  it("allows s3_vault_prefix override equal to default (trailing slash normalize)", () => {
    // Override must match tenants/{tenant_id}/vault/ (lp-3a1.1 tenant bind).
    const fields = buildGatewayInstanceProvisionFields({
      tenantId: TENANT,
      runtimeKind: "daytona",
      s3VaultPrefix: `tenants/${TENANT}/vault`,
    });
    expect(fields.s3_vault_prefix).toBe(`tenants/${TENANT}/vault/`);
  });

  it("allows multi-instance form override under same tenant_id", () => {
    const instanceId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const fields = buildGatewayInstanceProvisionFields({
      tenantId: TENANT,
      runtimeKind: "daytona",
      s3VaultPrefix: `tenants/${TENANT}/instances/${instanceId}/vault`,
    });
    expect(fields.s3_vault_prefix).toBe(
      `tenants/${TENANT}/instances/${instanceId}/vault/`,
    );
  });

  it("rejects cross-tenant s3_vault_prefix override (lp-3a1.1)", () => {
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "daytona",
        s3VaultPrefix: "tenants/custom/vault",
      }),
    ).toThrow(InvalidProvisionInputError);
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "daytona",
        s3VaultPrefix: "tenants/other-tenant/vault/",
      }),
    ).toThrow(/tenant segment must match/);
  });

  it("rejects malformed s3_vault_prefix override", () => {
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "daytona",
        s3VaultPrefix: "/absolute/not/a/key",
      }),
    ).toThrow(InvalidProvisionInputError);
    expect(() =>
      buildGatewayInstanceProvisionFields({
        tenantId: TENANT,
        runtimeKind: "daytona",
        s3VaultPrefix: "not-a-layout/prefix/",
      }),
    ).toThrow(InvalidProvisionInputError);
  });
});

describe("buildDaytonaProvisionFields dedicated helper", () => {
  it("forces daytona lazy posture without EC2 or sandbox", () => {
    const fields = buildDaytonaProvisionFields({ tenantId: "mocklab" });
    expect(fields.runtime_kind).toBe("daytona");
    expect(fields.s3_vault_prefix).toBe("tenants/mocklab/vault/");
    expect(fields.sandbox_id).toBeNull();
    expect(fields.ec2_instance_id).toBeNull();
    expect(fields.presence).toBe("offline");
    expect(isLazyDaytonaProvision(fields)).toBe(true);
  });
});

describe("provision composition with fake S3 (no live AWS)", () => {
  it("assign fields then ensureVaultPrefix — no Daytona client involved", async () => {
    const fields = buildDaytonaProvisionFields({ tenantId: "mocklab" });
    const store = new FakeS3ObjectStore();

    // Optional Phase 3 ensure (not required for CP row mint); proves composition.
    const ensured = await ensureVaultPrefixForDaytonaProvision({
      tenantId: "mocklab",
      runtimeKind: fields.runtime_kind,
      bucket: BUCKET,
      store,
    });

    expect(ensured.s3_vault_prefix).toBe(fields.s3_vault_prefix);
    expect(ensured.created).toBe(true);
    // Still lazy compute — sandbox never created at provision.
    expect(fields.sandbox_id).toBeNull();
    expect(fields.ec2_instance_id).toBeNull();
    // Fake S3 only — no AWS network.
    expect(store.listKeys(BUCKET).length).toBe(1);
  });
});

describe("package / API surface (lp-6jx)", () => {
  it("exports provision helpers from package index", () => {
    expect(indexSrc).toContain("buildDaytonaProvisionFields");
    expect(indexSrc).toContain("buildGatewayInstanceProvisionFields");
    expect(indexSrc).toContain("isLazyDaytonaProvision");
    expect(indexSrc).toContain("InvalidProvisionInputError");
  });

  it("store provisionInstance accepts runtime_kind and provisionDaytonaInstance exists", () => {
    expect(storeSrc).toContain("runtime_kind?: RuntimeKind");
    expect(storeSrc).toContain("async provisionDaytonaInstance");
    expect(storeSrc).toContain("buildGatewayInstanceProvisionFields");
    // Hardcoded ec2-only INSERT must be gone.
    expect(storeSrc).not.toMatch(
      /VALUES \(\?, \?, \?, \?, \?, NULL, NULL, NULL, 'unknown', NULL, NULL, NULL, NULL,\s*'ec2', NULL, 'offline', NULL, NULL, NULL\)/,
    );
  });

  it("register/provision HTTP paths accept runtime_kind body", () => {
    expect(appSrc).toContain("registerInstanceSchema");
    expect(appSrc).toContain("runtime_kind: z.enum(RUNTIME_KINDS).optional()");
    expect(appSrc).toContain("s3_vault_prefix: registered.s3_vault_prefix");
    expect(appSrc).toContain("sandbox_id: registered.sandbox_id");
  });

  it("ProvisionedInstance type includes dual-run provision fields", () => {
    expect(typesSrc).toContain("runtime_kind: RuntimeKind");
    expect(typesSrc).toContain("s3_vault_prefix: string | null");
    // Secret show-once type still has secret.
    expect(typesSrc).toMatch(/export type ProvisionedInstance = \{[\s\S]*secret: string/);
  });
});
