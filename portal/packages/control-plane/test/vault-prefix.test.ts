/**
 * lp-jt5 — Idempotent tenant vault prefix ensure (fake S3, no network).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  assertS3PersonalVaultPrefixBoundToTenantUser,
  assertS3SharedVaultPrefixBoundToTenant,
  assertS3VaultPrefixBoundToTenant,
  assignS3VaultPrefixForProvision,
  assertValidTenantIdForVaultPrefix,
  buildPersonalVaultPrefix,
  buildSharedVaultPrefix,
  buildS3VaultPrefix,
  buildS3VaultPrefixForInstance,
  buildVaultPrefixMarkerKey,
  ensureTenantVaultPrefix,
  ensureVaultPrefixForDaytonaProvision,
  extractRelativeS3VaultPrefix,
  InvalidS3VaultPrefixError,
  InvalidTenantIdForVaultPrefixError,
  VAULT_PREFIX_MARKER_VERSION,
  VAULT_PREFIX_PLATFORM_MARKER_REL,
  VaultPrefixRuntimeKindError,
} from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const vaultSrc = readFileSync(join(__dirname, "../src/vault-prefix.ts"), "utf8");

const BUCKET = "lanyard-mocklab-vault-test";
const TENANT = "mocklab";
const FIXED_NOW = () => new Date("2026-08-04T12:00:00.000Z");

describe("vault prefix shape (lp-jt5)", () => {
  it("builds tenants/{tenant_id}/vault/ with trailing slash", () => {
    expect(buildS3VaultPrefix(TENANT)).toBe("tenants/mocklab/vault/");
    expect(buildS3VaultPrefix("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "tenants/a1b2c3d4-e5f6-7890-abcd-ef1234567890/vault/",
    );
  });

  it("marker key is platform-only sibling (not under vault/ mount root)", () => {
    const marker = buildVaultPrefixMarkerKey(TENANT);
    expect(marker).toBe(`tenants/${TENANT}/${VAULT_PREFIX_PLATFORM_MARKER_REL}`);
    expect(marker).toContain("/_platform/");
    expect(marker.startsWith(`tenants/${TENANT}/vault/`)).toBe(false);
  });

  it("rejects invalid tenant_id path segments", () => {
    for (const bad of ["", "  ", "a/b", "../x", "tenants/x", "a\\b", ".."]) {
      expect(() => assertValidTenantIdForVaultPrefix(bad)).toThrow(
        InvalidTenantIdForVaultPrefixError,
      );
    }
  });

  it("assignS3VaultPrefixForProvision is null for ec2, prefix for daytona", () => {
    expect(assignS3VaultPrefixForProvision(TENANT, "ec2")).toBeNull();
    expect(assignS3VaultPrefixForProvision(TENANT, "daytona")).toBe(
      "tenants/mocklab/vault/",
    );
  });
});

describe("assertS3VaultPrefixBoundToTenant (lp-3a1.1)", () => {
  const TENANT_UUID = "00000000-0000-4000-8000-0000000000aa";
  const INSTANCE_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("accepts default layout for tenant (with or without trailing slash)", () => {
    expect(assertS3VaultPrefixBoundToTenant(`tenants/${TENANT}/vault/`, TENANT)).toBe(
      "tenants/mocklab/vault/",
    );
    expect(
      assertS3VaultPrefixBoundToTenant(`tenants/${TENANT_UUID}/vault`, TENANT_UUID),
    ).toBe(`tenants/${TENANT_UUID}/vault/`);
  });

  it("accepts multi-instance form under same tenant", () => {
    expect(
      assertS3VaultPrefixBoundToTenant(
        buildS3VaultPrefixForInstance(TENANT_UUID, INSTANCE_UUID),
        TENANT_UUID,
      ),
    ).toBe(`tenants/${TENANT_UUID}/instances/${INSTANCE_UUID}/vault/`);
  });

  it("accepts s3:// URI shell and returns relative key prefix", () => {
    expect(
      assertS3VaultPrefixBoundToTenant(
        `s3://lanyard-vault/tenants/${TENANT}/vault/`,
        TENANT,
      ),
    ).toBe("tenants/mocklab/vault/");
    expect(
      extractRelativeS3VaultPrefix(`s3://bucket/tenants/${TENANT}/vault`),
    ).toBe("tenants/mocklab/vault/");
  });

  it("rejects foreign tenant prefix", () => {
    expect(() =>
      assertS3VaultPrefixBoundToTenant("tenants/other/vault/", TENANT),
    ).toThrow(InvalidS3VaultPrefixError);
    expect(() =>
      assertS3VaultPrefixBoundToTenant(
        `tenants/other/instances/${INSTANCE_UUID}/vault/`,
        TENANT_UUID,
      ),
    ).toThrow(/tenant segment must match/);
  });

  it("rejects wrong shape even when tenant string appears", () => {
    expect(() =>
      assertS3VaultPrefixBoundToTenant(`tenants/${TENANT}/_platform/`, TENANT),
    ).toThrow(InvalidS3VaultPrefixError);
    expect(() =>
      assertS3VaultPrefixBoundToTenant(`tenants/${TENANT}/vault/extra/`, TENANT),
    ).toThrow(InvalidS3VaultPrefixError);
    expect(() =>
      assertS3VaultPrefixBoundToTenant("/absolute/path/", TENANT),
    ).toThrow(InvalidS3VaultPrefixError);
  });
});

describe("ensureTenantVaultPrefix idempotent (fake S3)", () => {
  it("creates marker on first call", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const result = await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      now: FIXED_NOW,
    });

    expect(result.created).toBe(true);
    expect(result.s3_vault_prefix).toBe("tenants/mocklab/vault/");
    expect(result.markerKey).toBe(
      "tenants/mocklab/_platform/vault-prefix-ensured.json",
    );
    expect(result.bucket).toBe(BUCKET);
    expect(store.getPutCount()).toBe(1);
    expect(store.has(BUCKET, result.markerKey)).toBe(true);

    const rec = store.get(BUCKET, result.markerKey);
    expect(rec?.contentType).toBe("application/json");
    const body = JSON.parse(rec!.body) as {
      version: number;
      s3_vault_prefix: string;
      tenant_id: string;
      created_at: string;
    };
    expect(body.version).toBe(VAULT_PREFIX_MARKER_VERSION);
    expect(body.s3_vault_prefix).toBe(result.s3_vault_prefix);
    expect(body.tenant_id).toBe(TENANT);
    expect(body.created_at).toBe("2026-08-04T12:00:00.000Z");
  });

  it("second call is a no-op put (idempotent)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const first = await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      now: FIXED_NOW,
    });
    const second = await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      now: FIXED_NOW,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.s3_vault_prefix).toBe(first.s3_vault_prefix);
    expect(second.markerKey).toBe(first.markerKey);
    expect(store.getPutCount()).toBe(1);
    expect(store.getHeadCount()).toBe(2);
  });

  it("pre-seeded marker skips put", async () => {
    const store = new FakeS3ObjectStore();
    const key = buildVaultPrefixMarkerKey(TENANT);
    store.seed(BUCKET, key, '{"version":1}');
    const result = await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
    });
    expect(result.created).toBe(false);
    expect(store.getPutCount()).toBe(0);
  });

  it("isolates tenants (no cross-tenant marker reuse)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: "tenant-a",
      store,
      now: FIXED_NOW,
    });
    const b = await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: "tenant-b",
      store,
      now: FIXED_NOW,
    });
    expect(b.created).toBe(true);
    expect(store.getPutCount()).toBe(2);
    expect(store.has(BUCKET, "tenants/tenant-a/_platform/vault-prefix-ensured.json")).toBe(
      true,
    );
    expect(store.has(BUCKET, "tenants/tenant-b/_platform/vault-prefix-ensured.json")).toBe(
      true,
    );
    expect(b.s3_vault_prefix).toBe("tenants/tenant-b/vault/");
  });

  it("rejects bare s3:// or path-like bucket names", async () => {
    const store = new FakeS3ObjectStore();
    await expect(
      ensureTenantVaultPrefix({
        bucket: "s3://my-bucket",
        tenantId: TENANT,
        store,
      }),
    ).rejects.toMatchObject({ code: "INVALID_BUCKET" });
  });
});

describe("provision path callable (lp-jt5)", () => {
  it("ensureVaultPrefixForDaytonaProvision runs for daytona", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const result = await ensureVaultPrefixForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      now: FIXED_NOW,
    });
    expect(result.created).toBe(true);
    expect(result.s3_vault_prefix).toBe("tenants/mocklab/vault/");

    // Simulate provision retry (same tenant, same bucket).
    const retry = await ensureVaultPrefixForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      now: FIXED_NOW,
    });
    expect(retry.created).toBe(false);
    expect(store.getPutCount()).toBe(1);
  });

  it("provision helper refuses ec2 runtime_kind", async () => {
    const store = new FakeS3ObjectStore();
    await expect(
      ensureVaultPrefixForDaytonaProvision({
        tenantId: TENANT,
        runtimeKind: "ec2",
        bucket: BUCKET,
        store,
      }),
    ).rejects.toBeInstanceOf(VaultPrefixRuntimeKindError);
    expect(store.getPutCount()).toBe(0);
  });

  it("simulated provision sequence: assign prefix string + ensure marker", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const runtimeKind = "daytona" as const;
    const tenantId = TENANT;

    // What CP would persist on the instance row:
    const s3_vault_prefix = assignS3VaultPrefixForProvision(
      tenantId,
      runtimeKind,
    );
    expect(s3_vault_prefix).toBe("tenants/mocklab/vault/");

    // What provision path calls for empty-prefix ensure:
    const ensured = await ensureVaultPrefixForDaytonaProvision({
      tenantId,
      runtimeKind,
      bucket: BUCKET,
      store,
      now: FIXED_NOW,
    });
    expect(ensured.s3_vault_prefix).toBe(s3_vault_prefix);
    expect(ensured.created).toBe(true);

    // presence stays offline / sandbox_id null is CP concern; helper only S3.
    expect(store.listKeys(BUCKET)).toEqual([
      "tenants/mocklab/_platform/vault-prefix-ensured.json",
    ]);
  });
});

describe("package surface (lp-jt5)", () => {
  it("exports ensure helpers from package index", () => {
    expect(indexSrc).toContain("ensureTenantVaultPrefix");
    expect(indexSrc).toContain("ensureVaultPrefixForDaytonaProvision");
    expect(indexSrc).toContain("FakeS3ObjectStore");
    expect(indexSrc).toContain("buildS3VaultPrefix");
  });

  it("documents no @aws-sdk dependency in helper module", () => {
    expect(vaultSrc).toMatch(/No @aws-sdk/);
    expect(vaultSrc).toContain("lp-jt5");
  });
});

describe("dual vault prefix shapes (lp-zoh.2 / plan 0010)", () => {
  const TENANT_ID = "00000000-0000-4000-8000-0000000000a2";
  const USER_ID = "11111111-1111-4111-8111-111111111111";
  const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

  describe("buildSharedVaultPrefix", () => {
    it("builds tenants/{tid}/vault/shared/ with trailing slash", () => {
      expect(buildSharedVaultPrefix(TENANT_ID)).toBe(
        `tenants/${TENANT_ID}/vault/shared/`,
      );
      expect(buildSharedVaultPrefix(TENANT).endsWith("/")).toBe(true);
    });

    it("rejects invalid tenant ids (fail closed)", () => {
      for (const bad of ["", "  ", "..", "a/b", "../x"]) {
        expect(() => buildSharedVaultPrefix(bad)).toThrow(
          InvalidTenantIdForVaultPrefixError,
        );
      }
    });
  });

  describe("buildPersonalVaultPrefix", () => {
    it("builds tenants/{tid}/users/{uid}/vault/ with trailing slash", () => {
      expect(buildPersonalVaultPrefix(TENANT_ID, USER_ID)).toBe(
        `tenants/${TENANT_ID}/users/${USER_ID}/vault/`,
      );
    });

    it("rejects invalid tenant or user segments", () => {
      for (const [tid, uid] of [
        ["", USER_ID],
        [TENANT_ID, ""],
        ["..", USER_ID],
        [TENANT_ID, ".."],
        [`tenants/${TENANT_ID}`, USER_ID],
        [TENANT_ID, "a/b"],
      ] as const) {
        expect(() => buildPersonalVaultPrefix(tid, uid)).toThrow(
          InvalidTenantIdForVaultPrefixError,
        );
      }
    });
  });

  describe("assertS3SharedVaultPrefixBoundToTenant", () => {
    it("accepts the exact normative shape and returns it", () => {
      const prefix = `tenants/${TENANT_ID}/vault/shared/`;
      expect(assertS3SharedVaultPrefixBoundToTenant(prefix, TENANT_ID)).toBe(
        prefix,
      );
    });

    it("rejects foreign tenant binding", () => {
      expect(() =>
        assertS3SharedVaultPrefixBoundToTenant(
          `tenants/other-tenant/vault/shared/`,
          TENANT_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects legacy vault/ shape (missing shared/ segment)", () => {
      expect(() =>
        assertS3SharedVaultPrefixBoundToTenant(
          `tenants/${TENANT_ID}/vault/`,
          TENANT_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects missing trailing slash (exact shape only)", () => {
      expect(() =>
        assertS3SharedVaultPrefixBoundToTenant(
          `tenants/${TENANT_ID}/vault/shared`,
          TENANT_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects traversal, absolute paths, and empty values", () => {
      for (const bad of [
        `tenants/${TENANT_ID}/../${TENANT_ID}/vault/shared/`,
        `tenants/../etc/passwd/`,
        "/tenants/x/vault/shared/",
        "",
        "   ",
      ]) {
        expect(() =>
          assertS3SharedVaultPrefixBoundToTenant(bad, TENANT_ID),
        ).toThrow(InvalidS3VaultPrefixError);
      }
    });

    it("rejects personal shape passed as shared", () => {
      expect(() =>
        assertS3SharedVaultPrefixBoundToTenant(
          `tenants/${TENANT_ID}/users/${USER_ID}/vault/`,
          TENANT_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });
  });

  describe("assertS3PersonalVaultPrefixBoundToTenantUser", () => {
    it("accepts the exact normative shape and returns it", () => {
      const prefix = `tenants/${TENANT_ID}/users/${USER_ID}/vault/`;
      expect(
        assertS3PersonalVaultPrefixBoundToTenantUser(prefix, TENANT_ID, USER_ID),
      ).toBe(prefix);
    });

    it("rejects wrong user binding under same tenant", () => {
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/users/${OTHER_USER_ID}/vault/`,
          TENANT_ID,
          USER_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects wrong tenant binding even when user matches", () => {
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/other-tenant/users/${USER_ID}/vault/`,
          TENANT_ID,
          USER_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects shared shape passed as personal", () => {
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/vault/shared/`,
          TENANT_ID,
          USER_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects missing trailing slash, traversal, and empty values", () => {
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/users/${USER_ID}/vault`,
          TENANT_ID,
          USER_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/users/../users/${USER_ID}/vault/`,
          TENANT_ID,
          USER_ID,
        ),
      ).toThrow(InvalidS3VaultPrefixError);
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser("", TENANT_ID, USER_ID),
      ).toThrow(InvalidS3VaultPrefixError);
    });

    it("rejects invalid tenant/user id segments before shape compare", () => {
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/users/${USER_ID}/vault/`,
          "..",
          USER_ID,
        ),
      ).toThrow(InvalidTenantIdForVaultPrefixError);
      expect(() =>
        assertS3PersonalVaultPrefixBoundToTenantUser(
          `tenants/${TENANT_ID}/users/${USER_ID}/vault/`,
          TENANT_ID,
          "a/b",
        ),
      ).toThrow(InvalidTenantIdForVaultPrefixError);
    });
  });
});
