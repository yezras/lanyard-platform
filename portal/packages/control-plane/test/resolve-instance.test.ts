/**
 * lp-oop.18 — Pure tenant+user → instance_id resolver.
 * 0010-shaped fixtures only. No Daytona, no wake, no schema migration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INSTANCE_SCOPES,
  InvalidSandboxKeyError,
  isInstanceScope,
  NoResolvableInstanceError,
  parseSandboxKey,
  requireInstanceIdForUser,
  resolveInstanceIdForUser,
  tenantPrimaryRecord,
  userScopeRecord,
  type SandboxKey,
  type ScopedInstanceRecord,
} from "../src/resolve-instance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolverSrc = readFileSync(
  join(__dirname, "../src/resolve-instance.ts"),
  "utf8",
);
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");

const TENANT = "tenant-acme";
const OTHER_TENANT = "tenant-other";
const USER_A = "user-ada";
const USER_B = "user-bob";
const INST_PRIMARY = "inst-tenant-primary";
const INST_A = "inst-user-ada";
const INST_B = "inst-user-bob";

function key(user_id: string, tenant_id = TENANT): SandboxKey {
  return { tenant_id, user_id };
}

function twoUserFixtures(): ScopedInstanceRecord[] {
  return [
    tenantPrimaryRecord({ instance_id: INST_PRIMARY, tenant_id: TENANT }),
    userScopeRecord({
      instance_id: INST_A,
      tenant_id: TENANT,
      owner_user_id: USER_A,
    }),
    userScopeRecord({
      instance_id: INST_B,
      tenant_id: TENANT,
      owner_user_id: USER_B,
    }),
  ];
}

describe("resolve-instance catalog (lp-oop.18)", () => {
  it("exports tenant|user scopes", () => {
    expect(INSTANCE_SCOPES).toEqual(["tenant", "user"]);
    expect(isInstanceScope("tenant")).toBe(true);
    expect(isInstanceScope("user")).toBe(true);
    expect(isInstanceScope("chat")).toBe(false);
  });

  it("is exported from the package index", () => {
    expect(indexSrc).toContain('from "./resolve-instance.js"');
    expect(indexSrc).toContain("resolveInstanceIdForUser");
  });

  it("does not wake: no orchestrator or Daytona imports", () => {
    expect(resolverSrc).not.toMatch(/^import /m);
    expect(resolverSrc).not.toMatch(/from ["']\.\//);
  });
});

describe("parseSandboxKey", () => {
  it("trims and accepts non-empty tenant+user", () => {
    expect(parseSandboxKey({ tenant_id: " t ", user_id: " u " })).toEqual({
      tenant_id: "t",
      user_id: "u",
    });
  });

  it("rejects empty or non-string ids", () => {
    expect(parseSandboxKey({ tenant_id: "", user_id: USER_A })).toBeNull();
    expect(parseSandboxKey({ tenant_id: TENANT, user_id: "  " })).toBeNull();
    expect(parseSandboxKey({ tenant_id: 1, user_id: USER_A })).toBeNull();
  });
});

describe("fallback to tenant primary", () => {
  it("returns tenant primary when no user-scope instance exists", () => {
    const instances = [
      tenantPrimaryRecord({ instance_id: INST_PRIMARY, tenant_id: TENANT }),
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toEqual({
      ok: true,
      instance_id: INST_PRIMARY,
      source: "tenant_primary",
    });
    expect(resolveInstanceIdForUser(key(USER_B), instances)).toEqual({
      ok: true,
      instance_id: INST_PRIMARY,
      source: "tenant_primary",
    });
  });

  it("ignores another user's instance and still falls back to primary", () => {
    const instances = [
      tenantPrimaryRecord({ instance_id: INST_PRIMARY, tenant_id: TENANT }),
      userScopeRecord({
        instance_id: INST_B,
        tenant_id: TENANT,
        owner_user_id: USER_B,
      }),
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toEqual({
      ok: true,
      instance_id: INST_PRIMARY,
      source: "tenant_primary",
    });
  });

  it("ignores revoked user instance and falls back to primary", () => {
    const instances = [
      tenantPrimaryRecord({ instance_id: INST_PRIMARY, tenant_id: TENANT }),
      userScopeRecord({
        instance_id: INST_A,
        tenant_id: TENANT,
        owner_user_id: USER_A,
        revoked_at: "2026-08-14T00:00:00.000Z",
      }),
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toEqual({
      ok: true,
      instance_id: INST_PRIMARY,
      source: "tenant_primary",
    });
  });

  it("does not use another tenant's primary", () => {
    const instances = [
      tenantPrimaryRecord({
        instance_id: "inst-other",
        tenant_id: OTHER_TENANT,
      }),
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toEqual({
      ok: false,
      code: "no_instance",
      httpStatus: 404,
      message: expect.stringContaining(TENANT),
    });
  });
});

describe("two-user 0010-shaped fixtures", () => {
  it("each user resolves to their own instance_id", () => {
    const instances = twoUserFixtures();
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toEqual({
      ok: true,
      instance_id: INST_A,
      source: "user",
    });
    expect(resolveInstanceIdForUser(key(USER_B), instances)).toEqual({
      ok: true,
      instance_id: INST_B,
      source: "user",
    });
    expect(INST_A).not.toBe(INST_B);
  });

  it("user instance wins over tenant primary for the same user", () => {
    const resolved = resolveInstanceIdForUser(key(USER_A), twoUserFixtures());
    expect(resolved).toMatchObject({ ok: true, source: "user" });
    if (resolved.ok) {
      expect(resolved.instance_id).not.toBe(INST_PRIMARY);
    }
  });
});

describe("neither returns error", () => {
  it("empty fixture list is no_instance", () => {
    const result = resolveInstanceIdForUser(key(USER_A), []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no_instance");
      expect(result.httpStatus).toBe(404);
      expect(result.message).toMatch(/No user instance or tenant primary/);
    }
  });

  it("revoked primary and no user instance is no_instance", () => {
    const instances = [
      tenantPrimaryRecord({
        instance_id: INST_PRIMARY,
        tenant_id: TENANT,
        revoked_at: "2026-08-14T00:00:00.000Z",
      }),
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toMatchObject({
      ok: false,
      code: "no_instance",
    });
  });

  it("tenant instance that is not primary is not a fallback", () => {
    const instances: ScopedInstanceRecord[] = [
      {
        instance_id: "inst-secondary",
        tenant_id: TENANT,
        scope: "tenant",
        owner_user_id: null,
        is_primary: false,
        revoked_at: null,
      },
    ];
    expect(resolveInstanceIdForUser(key(USER_A), instances)).toMatchObject({
      ok: false,
      code: "no_instance",
    });
  });

  it("invalid key is invalid_key", () => {
    expect(resolveInstanceIdForUser(key("  "), [])).toEqual({
      ok: false,
      code: "invalid_key",
      httpStatus: 400,
      message: "SandboxKey requires non-empty tenant_id and user_id",
    });
  });

  it("requireInstanceIdForUser throws typed errors", () => {
    expect(() => requireInstanceIdForUser(key(USER_A), [])).toThrow(
      NoResolvableInstanceError,
    );
    expect(() => requireInstanceIdForUser(key(""), [])).toThrow(
      InvalidSandboxKeyError,
    );
    const ok = requireInstanceIdForUser(key(USER_A), [
      tenantPrimaryRecord({ instance_id: INST_PRIMARY, tenant_id: TENANT }),
    ]);
    expect(ok.instance_id).toBe(INST_PRIMARY);
    expect(ok.source).toBe("tenant_primary");
  });
});
