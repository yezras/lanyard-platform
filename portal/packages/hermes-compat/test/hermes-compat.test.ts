import { describe, expect, it } from "vitest";

import {
  ENV_ALIAS_PAIRS,
  EnvAliasConflictError,
  HERMES_COMPAT_REMOVAL_CRITERIA,
  HERMES_ENDPOINT_DEPRECATIONS,
  LEGACY_HERMES_PROJECT_ROUTES,
  PREFERRED_AGENT_PROJECT_ROUTES,
  REMOVAL_POLICY,
  UnknownEnvAliasError,
  canRemoveSurface,
  criteriaForSurface,
  deprecationHeadersForLegacyPath,
  deprecationNoteForPath,
  deprecationsForPath,
  dualMountPlan,
  dualWriteEnvAlias,
  evaluateRemovalCriteria,
  isLegacyHermesEndpoint,
  isLegacyHermesEnvName,
  isPreferredBackendEnvName,
  legacyEnvNameFor,
  legacyEnvOnlyWarning,
  preferredEnvNameFor,
  preferredPathForLegacy,
  removalChecklistMarkdown,
  resolveAllEnvAliases,
  resolveBackendHome,
  resolveBackendInstallPath,
  resolveEnvAlias,
} from "../src/index.js";

describe("ENV_ALIAS_PAIRS catalog", () => {
  it("maps HERMES_* to BACKEND_* for home, install, and artifact pins", () => {
    const preferred = ENV_ALIAS_PAIRS.map((p) => p.preferred);
    const legacy = ENV_ALIAS_PAIRS.map((p) => p.legacy);
    expect(preferred).toContain("BACKEND_HOME");
    expect(preferred).toContain("BACKEND_INSTALL_PATH");
    expect(preferred).toContain("BACKEND_ARTIFACT_URL");
    expect(preferred).toContain("BACKEND_ARTIFACT_VERSION");
    expect(preferred).toContain("BACKEND_ARTIFACT_SHA256");
    expect(legacy).toContain("HERMES_HOME");
    expect(legacy).toContain("HERMES_INSTALL_PATH");
    expect(legacy).toContain("HERMES_ARTIFACT_URL");
  });

  it("classifies preferred vs legacy names", () => {
    expect(isPreferredBackendEnvName("BACKEND_HOME")).toBe(true);
    expect(isLegacyHermesEnvName("HERMES_HOME")).toBe(true);
    expect(isLegacyHermesEnvName("BACKEND_HOME")).toBe(false);
    expect(legacyEnvNameFor("BACKEND_HOME")).toBe("HERMES_HOME");
    expect(preferredEnvNameFor("HERMES_HOME")).toBe("BACKEND_HOME");
  });
});

describe("resolveEnvAlias — existing HERMES_* still work", () => {
  it("accepts HERMES_HOME when BACKEND_HOME is unset", () => {
    expect(
      resolveEnvAlias("BACKEND_HOME", { HERMES_HOME: "/home/hermes/.hermes" }),
    ).toBe("/home/hermes/.hermes");
    expect(
      resolveBackendHome({ HERMES_HOME: "/var/lib/company-brain-backend" }),
    ).toBe("/var/lib/company-brain-backend");
  });

  it("prefers BACKEND_HOME when only preferred is set", () => {
    expect(
      resolveBackendHome({ BACKEND_HOME: "/var/lib/company-brain-backend" }),
    ).toBe("/var/lib/company-brain-backend");
  });

  it("returns shared value when both agree", () => {
    expect(
      resolveEnvAlias("BACKEND_HOME", {
        BACKEND_HOME: "/var/lib/company-brain-backend",
        HERMES_HOME: "/var/lib/company-brain-backend",
      }),
    ).toBe("/var/lib/company-brain-backend");
  });

  it("throws EnvAliasConflictError when values disagree", () => {
    expect(() =>
      resolveEnvAlias("BACKEND_HOME", {
        BACKEND_HOME: "/a",
        HERMES_HOME: "/b",
      }),
    ).toThrow(EnvAliasConflictError);
  });

  it("treats UNCONFIGURED / empty as unset", () => {
    expect(
      resolveEnvAlias("BACKEND_ARTIFACT_URL", {
        BACKEND_ARTIFACT_URL: "UNCONFIGURED",
        HERMES_ARTIFACT_URL: "s3://bucket/backends/hermes-lanyard/v1/backend.tar.gz",
      }),
    ).toBe("s3://bucket/backends/hermes-lanyard/v1/backend.tar.gz");
    expect(
      resolveEnvAlias("BACKEND_HOME", {
        BACKEND_HOME: "  ",
        HERMES_HOME: "",
      }),
    ).toBeNull();
  });

  it("resolves install path and artifact aliases", () => {
    expect(
      resolveBackendInstallPath({
        HERMES_INSTALL_PATH: "/opt/hermes-lanyard",
      }),
    ).toBe("/opt/hermes-lanyard");
    expect(
      resolveEnvAlias("BACKEND_ARTIFACT_VERSION", {
        HERMES_ARTIFACT_VERSION: "v0.1.0-g7h2",
      }),
    ).toBe("v0.1.0-g7h2");
  });

  it("dual-writes both names to the effective value", () => {
    const result = dualWriteEnvAlias("BACKEND_HOME", {
      HERMES_HOME: "/home/hermes/.hermes",
    });
    expect(result.effective).toBe("/home/hermes/.hermes");
    expect(result.preferred).toBe("/home/hermes/.hermes");
    expect(result.legacy).toBe("/home/hermes/.hermes");
    expect(result.usedLegacyOnly).toBe(true);
    expect(legacyEnvOnlyWarning("BACKEND_HOME")).toMatch(/HERMES_HOME/);
  });

  it("resolveAllEnvAliases maps every pair and tracks legacy-only", () => {
    const { values, usedLegacyOnly, dualWrite } = resolveAllEnvAliases({
      HERMES_HOME: "/h",
      BACKEND_INSTALL_PATH: "/opt/company-brain-backend",
    });
    expect(values.BACKEND_HOME).toBe("/h");
    expect(values.BACKEND_INSTALL_PATH).toBe("/opt/company-brain-backend");
    expect(usedLegacyOnly).toContain("BACKEND_HOME");
    expect(usedLegacyOnly).not.toContain("BACKEND_INSTALL_PATH");
    expect(dualWrite.HERMES_HOME).toBe("/h");
    expect(dualWrite.BACKEND_HOME).toBe("/h");
  });

  it("rejects unknown preferred names", () => {
    expect(() => resolveEnvAlias("NOT_A_REAL_VAR", {})).toThrow(
      UnknownEnvAliasError,
    );
  });
});

describe("endpoint deprecation notes", () => {
  it("catalogs /api/hermes/projects with preferred /api/agent/projects", () => {
    expect(HERMES_ENDPOINT_DEPRECATIONS.length).toBeGreaterThanOrEqual(2);
    for (const entry of HERMES_ENDPOINT_DEPRECATIONS) {
      expect(entry.legacyPath).toMatch(/^\/api\/hermes\//);
      expect(entry.preferredPath).toMatch(/^\/api\//);
      expect(entry.preferredPath).not.toMatch(/\/hermes\//);
      expect(entry.deprecationNote.toLowerCase()).toContain("deprecated");
      expect(entry.status).toBe("deprecated_alias");
    }
  });

  it("detects legacy paths with or without /api prefix", () => {
    expect(isLegacyHermesEndpoint("/api/hermes/projects")).toBe(true);
    expect(isLegacyHermesEndpoint("/hermes/projects")).toBe(true);
    expect(isLegacyHermesEndpoint("/api/agent/projects")).toBe(false);
    expect(preferredPathForLegacy("/hermes/projects")).toBe(
      "/api/agent/projects",
    );
  });

  it("returns deprecation notes and headers for legacy routes", () => {
    const note = deprecationNoteForPath("/api/hermes/projects");
    expect(note).toMatch(/\/api\/agent\/projects/);
    const headers = deprecationHeadersForLegacyPath("/hermes/projects");
    expect(headers).not.toBeNull();
    expect(headers!.Deprecation).toBe("true");
    expect(headers!.Link).toContain('/api/agent/projects');
    expect(headers!.Link).toContain('rel="successor-version"');
    expect(headers!["X-Lanyard-Deprecation-Note"]).toMatch(/Deprecated/i);
  });

  it("does not attach deprecation headers on preferred paths", () => {
    expect(deprecationHeadersForLegacyPath("/api/agent/projects")).toBeNull();
    expect(deprecationNoteForPath("/api/agent/projects")).toBeNull();
  });

  it("dual-mount plan lists preferred + legacy bff mounts", () => {
    const plan = dualMountPlan();
    expect(plan.length).toBeGreaterThanOrEqual(1);
    const projects = plan.find((p) => p.legacyPath === "/api/hermes/projects");
    expect(projects).toBeDefined();
    expect(projects!.preferredBffMount).toBe("/agent/projects");
    expect(projects!.legacyBffMount).toBe("/hermes/projects");
    expect(projects!.methods).toEqual(expect.arrayContaining(["GET", "POST"]));
    expect(projects!.deprecationNote).toMatch(/Deprecated/i);
  });

  it("exports stable route constants for BFF registration", () => {
    expect(LEGACY_HERMES_PROJECT_ROUTES.list.path).toBe("/api/hermes/projects");
    expect(PREFERRED_AGENT_PROJECT_ROUTES.list.path).toBe(
      "/api/agent/projects",
    );
    expect(deprecationsForPath("/api/hermes/projects").length).toBe(2);
  });
});

describe("removal criteria checklist", () => {
  it("defines criteria covering env, endpoint, control_plane, wire, deploy, docs", () => {
    const surfaces = new Set(
      HERMES_COMPAT_REMOVAL_CRITERIA.map((c) => c.surface),
    );
    expect(surfaces).toEqual(
      new Set([
        "env",
        "endpoint",
        "control_plane",
        "wire_field",
        "deploy",
        "docs",
      ]),
    );
    expect(HERMES_COMPAT_REMOVAL_CRITERIA.length).toBeGreaterThanOrEqual(8);
    for (const c of HERMES_COMPAT_REMOVAL_CRITERIA) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.gate.length).toBeGreaterThan(0);
      expect(c.keeps.length).toBeGreaterThan(0);
      expect(c.related.length).toBeGreaterThan(0);
    }
  });

  it("defaults to unmet — compatibility must remain", () => {
    const result = evaluateRemovalCriteria();
    expect(result.allMet).toBe(false);
    expect(result.metCount).toBe(0);
    expect(result.unmet).toHaveLength(result.total);
    expect(canRemoveSurface("env")).toBe(false);
    expect(canRemoveSurface("endpoint")).toBe(false);
  });

  it("reports allMet only when every id is true", () => {
    const met: Record<string, boolean> = {};
    for (const c of HERMES_COMPAT_REMOVAL_CRITERIA) {
      met[c.id] = true;
    }
    const result = evaluateRemovalCriteria(met);
    expect(result.allMet).toBe(true);
    expect(result.metCount).toBe(result.total);
    expect(result.unmet).toHaveLength(0);
    expect(canRemoveSurface("env", met)).toBe(true);
  });

  it("canRemoveSurface requires all criteria on that surface", () => {
    const envIds = criteriaForSurface("env").map((c) => c.id);
    expect(envIds.length).toBeGreaterThanOrEqual(1);
    const partial: Record<string, boolean> = { [envIds[0]!]: true };
    expect(canRemoveSurface("env", partial)).toBe(envIds.length === 1);
    const full: Record<string, boolean> = {};
    for (const id of envIds) full[id] = true;
    expect(canRemoveSurface("env", full)).toBe(true);
    expect(canRemoveSurface("endpoint", full)).toBe(false);
  });

  it("emits a markdown checklist with unchecked boxes by default", () => {
    const md = removalChecklistMarkdown();
    expect(md).toContain("# Hermes compatibility removal criteria");
    expect(md).toContain("lp-k7g.8.7");
    expect(md).toMatch(/- \[ \]/);
    expect(md).toContain("env.preferred-names-in-all-units");
    expect(md).toContain("endpoint.clients-on-preferred-paths");
    expect(md).toContain("Compatibility layer must remain");
    expect(REMOVAL_POLICY.package).toBe("@lanyard/hermes-compat");
    expect(REMOVAL_POLICY.rule).toMatch(/Never remove/);
  });

  it("marks checked boxes when criteria are met", () => {
    const md = removalChecklistMarkdown({
      "env.preferred-names-in-all-units": true,
    });
    expect(md).toContain("- [x] **`env.preferred-names-in-all-units`**");
  });
});
