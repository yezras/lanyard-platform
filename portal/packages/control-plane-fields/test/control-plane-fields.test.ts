import { describe, expect, it } from "vitest";

import {
  AliasConflictError,
  CONTROL_PLANE_BACKEND_FIELD_MIGRATION,
  ENSURE_OPTIONAL_COLUMN_STATEMENTS,
  FIELD_MIGRATION_MAP,
  InvalidBackendKindError,
  LEGACY_HERMES_ALIASES,
  MissingBackendProfileError,
  PREFERRED_BACKEND_FIELDS,
  PREFERRED_TO_LEGACY_ALIAS,
  dualWriteBackendProfile,
  dualWriteBackendVersion,
  migrationSqlForApply,
  normalizeBackendCapabilities,
  parseBackendKind,
  parseDeploymentUpsertInput,
  parseRoleCreateInput,
  resolveBackendProfile,
  resolveBackendVersion,
  toDeploymentApiResponse,
  toRoleApiResponse,
  toUserRbacApiResponse,
} from "../src/index.js";

describe("preferred field catalog", () => {
  it("lists backend-neutral preferred names", () => {
    expect(PREFERRED_BACKEND_FIELDS).toEqual({
      kind: "backend_kind",
      version: "backend_version",
      profile: "backend_profile",
      capabilities: "backend_capabilities",
    });
  });

  it("maps version and profile to hermes_* aliases only", () => {
    expect(LEGACY_HERMES_ALIASES).toEqual({
      version: "hermes_version",
      profile: "hermes_profile",
    });
    expect(PREFERRED_TO_LEGACY_ALIAS.backend_version).toBe("hermes_version");
    expect(PREFERRED_TO_LEGACY_ALIAS.backend_profile).toBe("hermes_profile");
    expect(PREFERRED_TO_LEGACY_ALIAS.backend_kind).toBeUndefined();
    expect(PREFERRED_TO_LEGACY_ALIAS.backend_capabilities).toBeUndefined();
  });
});

describe("version alias resolution", () => {
  it("prefers backend_version when only preferred is set", () => {
    expect(
      resolveBackendVersion({ backend_version: "v1.2.3", hermes_version: null }),
    ).toBe("v1.2.3");
  });

  it("accepts hermes_version as legacy-only input", () => {
    expect(
      resolveBackendVersion({ backend_version: null, hermes_version: "v0.1.0" }),
    ).toBe("v0.1.0");
  });

  it("returns the shared value when both agree", () => {
    expect(
      resolveBackendVersion({
        backend_version: "v2.0.0",
        hermes_version: "v2.0.0",
      }),
    ).toBe("v2.0.0");
  });

  it("throws AliasConflictError when values disagree", () => {
    expect(() =>
      resolveBackendVersion({
        backend_version: "v2.0.0",
        hermes_version: "v1.0.0",
      }),
    ).toThrow(AliasConflictError);
  });

  it("dual-writes both columns to the effective value", () => {
    expect(
      dualWriteBackendVersion({ hermes_version: "v0.9.0" }),
    ).toEqual({
      backend_version: "v0.9.0",
      hermes_version: "v0.9.0",
    });
    expect(
      dualWriteBackendVersion({ backend_version: "v1.0.0" }),
    ).toEqual({
      backend_version: "v1.0.0",
      hermes_version: "v1.0.0",
    });
  });
});

describe("profile alias resolution", () => {
  it("resolves backend_profile or hermes_profile", () => {
    expect(
      resolveBackendProfile({ backend_profile: "admin", hermes_profile: null }),
    ).toBe("admin");
    expect(
      resolveBackendProfile({
        backend_profile: undefined,
        hermes_profile: "contributor",
      }),
    ).toBe("contributor");
  });

  it("dual-writes profile aliases", () => {
    expect(dualWriteBackendProfile({ backend_profile: "admin" })).toEqual({
      backend_profile: "admin",
      hermes_profile: "admin",
    });
  });

  it("throws on profile conflict", () => {
    expect(() =>
      resolveBackendProfile({
        backend_profile: "admin",
        hermes_profile: "contributor",
      }),
    ).toThrow(AliasConflictError);
  });
});

describe("backend_kind", () => {
  it("parses known kinds and null", () => {
    expect(parseBackendKind("hermes_lanyard")).toBe("hermes_lanyard");
    expect(parseBackendKind("lanyard_agent")).toBe("lanyard_agent");
    expect(parseBackendKind(null)).toBeNull();
  });

  it("rejects unknown kinds", () => {
    expect(() => parseBackendKind("not_a_backend")).toThrow(
      InvalidBackendKindError,
    );
  });
});

describe("backend_capabilities", () => {
  it("normalizes snapshots to schema_version 1", () => {
    const snap = normalizeBackendCapabilities({
      kind: "hermes_lanyard",
      features: { vault_read: true },
    });
    expect(snap).toMatchObject({
      schema_version: 1,
      kind: "hermes_lanyard",
      features: { vault_read: true },
    });
  });

  it("rejects non-objects and bad schema versions", () => {
    expect(() => normalizeBackendCapabilities([])).toThrow(TypeError);
    expect(() =>
      normalizeBackendCapabilities({ schema_version: 2 }),
    ).toThrow(TypeError);
  });
});

describe("deployment API shape", () => {
  it("parses upsert accepting hermes_version alias", () => {
    const resolved = parseDeploymentUpsertInput({
      hosting_track: "lanyard_hosted",
      isolation_mode: "account",
      hermes_version: "v0.1.0-g7h2",
      backend_kind: "hermes_lanyard",
      backend_capabilities: {
        schema_version: 1,
        kind: "hermes_lanyard",
        brain_rpc_methods: ["brain.health"],
      },
    });
    expect(resolved.backend_version).toBe("v0.1.0-g7h2");
    expect(resolved.hermes_version).toBe("v0.1.0-g7h2");
    expect(resolved.backend_kind).toBe("hermes_lanyard");
    expect(resolved.backend_capabilities?.schema_version).toBe(1);
  });

  it("parses upsert preferring backend_version", () => {
    const resolved = parseDeploymentUpsertInput({
      hosting_track: "lanyard_hosted",
      isolation_mode: "account",
      backend_version: "v2.0.0",
      backend_kind: "lanyard_agent",
    });
    expect(resolved).toMatchObject({
      backend_version: "v2.0.0",
      hermes_version: "v2.0.0",
      backend_kind: "lanyard_agent",
      backend_capabilities: null,
    });
  });

  it("dual-emits preferred + hermes_version on response", () => {
    const body = toDeploymentApiResponse({
      tenant_id: "t1",
      hosting_track: "lanyard_hosted",
      isolation_mode: "account",
      aws_account_id: null,
      aws_region: "us-west-2",
      project_name: "acme",
      status: "active",
      client_core_version: "v1.0.0",
      // Legacy-only row (pre-migration DB)
      hermes_version: "v0.1.0-g7h2",
      backend_kind: "hermes_lanyard",
      backend_capabilities: {
        schema_version: 1,
        kind: "hermes_lanyard",
      },
      primary_instance_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      retired_at: null,
    });

    expect(body.backend_version).toBe("v0.1.0-g7h2");
    expect(body.hermes_version).toBe("v0.1.0-g7h2");
    expect(body.backend_kind).toBe("hermes_lanyard");
    expect(body.backend_capabilities).toMatchObject({
      schema_version: 1,
      kind: "hermes_lanyard",
    });
  });
});

describe("role / rbac API shape", () => {
  it("accepts hermes_profile on role create and dual-writes", () => {
    const resolved = parseRoleCreateInput({
      name: "Team A",
      hermes_profile: "team-a",
      path_prefixes: ["/team-a"],
    });
    expect(resolved.backend_profile).toBe("team-a");
    expect(resolved.hermes_profile).toBe("team-a");
  });

  it("accepts backend_profile on role create", () => {
    const resolved = parseRoleCreateInput({
      name: "Admins",
      backend_profile: "admin",
      path_prefixes: ["/"],
    });
    expect(resolved.backend_profile).toBe("admin");
    expect(resolved.hermes_profile).toBe("admin");
  });

  it("requires a profile field", () => {
    expect(() =>
      parseRoleCreateInput({
        name: "Empty",
        path_prefixes: ["/"],
      }),
    ).toThrow(MissingBackendProfileError);
  });

  it("dual-emits backend_profile and hermes_profile on role response", () => {
    const role = toRoleApiResponse({
      role_id: "r1",
      tenant_id: "t1",
      name: "Admin",
      hermes_profile: "admin",
      path_prefixes: ["/"],
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(role.backend_profile).toBe("admin");
    expect(role.hermes_profile).toBe("admin");
  });

  it("dual-emits backend_profile on UserRbac response", () => {
    const rbac = toUserRbacApiResponse({
      user_id: "u1",
      tenant_id: "t1",
      hermes_profile: "contributor",
      allowed_path_prefixes: ["/docs"],
      role_names: ["Contributor"],
    });
    expect(rbac.backend_profile).toBe("contributor");
    expect(rbac.hermes_profile).toBe("contributor");
  });
});

describe("schema migration plan", () => {
  it("plans add_columns and backfill before any drop", () => {
    const phases = CONTROL_PLANE_BACKEND_FIELD_MIGRATION.map((s) => s.phase);
    expect(phases).toContain("add_columns");
    expect(phases).toContain("backfill");
    expect(phases).toContain("cutover_later");

    const applyIds = migrationSqlForApply();
    expect(applyIds.some((sql) => /DROP COLUMN/i.test(sql))).toBe(false);
    expect(
      CONTROL_PLANE_BACKEND_FIELD_MIGRATION.filter(
        (s) => s.phase === "cutover_later",
      ).every((s) => s.sql.includes("DEFERRED")),
    ).toBe(true);
  });

  it("covers all four preferred fields in FIELD_MIGRATION_MAP", () => {
    const preferred = FIELD_MIGRATION_MAP.map((f) => f.preferred);
    expect(preferred).toEqual(
      expect.arrayContaining([
        "backend_kind",
        "backend_version",
        "backend_capabilities",
        "backend_profile",
      ]),
    );
  });

  it("exports ensureOptionalColumns-style statements for migrate.ts merge", () => {
    expect(ENSURE_OPTIONAL_COLUMN_STATEMENTS).toEqual(
      expect.arrayContaining([
        expect.stringContaining("backend_kind"),
        expect.stringContaining("backend_version"),
        expect.stringContaining("backend_capabilities"),
        expect.stringContaining("backend_profile"),
      ]),
    );
  });

  it("documents hermes_version and hermes_profile as explicit aliases", () => {
    const version = FIELD_MIGRATION_MAP.find(
      (f) => f.preferred === "backend_version",
    );
    const profile = FIELD_MIGRATION_MAP.find(
      (f) => f.preferred === "backend_profile",
    );
    expect(version?.legacy).toBe("hermes_version");
    expect(profile?.legacy).toBe("hermes_profile");
  });
});
