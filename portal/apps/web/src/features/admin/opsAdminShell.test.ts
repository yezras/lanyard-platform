import { describe, expect, it } from "vitest";

import {
  adminHashFor,
  defaultAdminPage,
  parseAdminHash,
  resolveAdminLocation,
  sidenavItemPages,
  sidenavSections,
} from "./opsAdminShell.js";

describe("admin sidenav by role (lp-hdzm.3)", () => {
  it("shows only Connectors/Users for a tenant admin", () => {
    expect(sidenavItemPages({ role: "tenant_admin", hasTenant: true })).toEqual([
      "connectors",
      "users",
    ]);
  });

  it("never offers Tenants, Registry, or Ops items to a tenant admin", () => {
    const pages = sidenavItemPages({ role: "tenant_admin", hasTenant: true });
    expect(pages).not.toContain("tenants");
    expect(pages).not.toContain("registry");
    expect(pages).not.toContain("instances");
    expect(pages).not.toContain("roles");
    expect(pages).not.toContain("audit");
    expect(pages).not.toContain("secrets");
    expect(pages).not.toContain("home");
  });

  it("shows only Tenants and Registry for a superadmin with no tenant", () => {
    const sections = sidenavSections({ role: "superadmin", hasTenant: false });
    expect(sections[0]?.items.map((item) => item.page)).toEqual([
      "tenants",
      "registry",
    ]);
    expect(sidenavItemPages({ role: "superadmin", hasTenant: false })).toEqual([
      "tenants",
      "registry",
    ]);
  });

  it("adds Connectors, Users, and Ops once a tenant is selected", () => {
    expect(sidenavItemPages({ role: "superadmin", hasTenant: true })).toEqual([
      "tenants",
      "registry",
      "connectors",
      "users",
      "instances",
      "roles",
      "audit",
      "secrets",
    ]);
  });

  it("groups Instances/Hermes roles/Audit/Provider secrets under Ops", () => {
    const sections = sidenavSections({ role: "superadmin", hasTenant: true });
    const ops = sections.find((section) => section.title === "Ops");
    expect(ops?.items.map((item) => item.page)).toEqual([
      "instances",
      "roles",
      "audit",
      "secrets",
    ]);
    expect(ops?.items.map((item) => item.label)).toEqual([
      "Instances",
      "Hermes roles",
      "Audit",
      "Provider secrets",
    ]);
  });

  it("does not include Home in any sidenav", () => {
    expect(
      sidenavItemPages({ role: "superadmin", hasTenant: true }),
    ).not.toContain("home");
    expect(
      sidenavItemPages({ role: "tenant_admin", hasTenant: true }),
    ).not.toContain("home");
  });

  it("lands a superadmin without a tenant on Tenants, everyone else on Connectors", () => {
    expect(defaultAdminPage({ role: "superadmin", hasTenant: false })).toBe(
      "tenants",
    );
    expect(defaultAdminPage({ role: "superadmin", hasTenant: true })).toBe(
      "connectors",
    );
    expect(defaultAdminPage({ role: "tenant_admin", hasTenant: true })).toBe(
      "connectors",
    );
  });
});

describe("admin hash deep links (lp-hdzm.3)", () => {
  it("parses platform hashes with no slug", () => {
    expect(parseAdminHash("#/tenants")).toEqual({
      tenantSlug: null,
      page: "tenants",
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/registry")).toEqual({
      tenantSlug: null,
      page: "registry",
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#tenants")).toEqual({
      tenantSlug: null,
      page: "tenants",
      connectorId: null,
      userId: null,
    });
  });

  it("parses tenant-scoped hashes and detail ids", () => {
    expect(parseAdminHash("#/mocklab/connectors")).toEqual({
      tenantSlug: "mocklab",
      page: "connectors",
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/mocklab/connectors/hubspot")).toEqual({
      tenantSlug: "mocklab",
      page: "connector-detail",
      connectorId: "hubspot",
      userId: null,
    });
    expect(parseAdminHash("#/mocklab/users/u1")).toEqual({
      tenantSlug: "mocklab",
      page: "users",
      connectorId: null,
      userId: "u1",
    });
  });

  it("rejects reserved slugs, extra platform path, and garbage", () => {
    expect(parseAdminHash("#/registry/connectors")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/admin/connectors")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/admin")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/MOCKLAB/connectors")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/mocklab/../secrets")).toEqual({
      tenantSlug: "mocklab",
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/nope")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
    expect(parseAdminHash("#/home")).toEqual({
      tenantSlug: null,
      page: null,
      connectorId: null,
      userId: null,
    });
  });

  it("builds hashes that drop the slug on Registry and Tenants", () => {
    expect(adminHashFor("registry", "mocklab")).toBe("#/registry");
    expect(adminHashFor("tenants", "mocklab")).toBe("#/tenants");
    expect(adminHashFor("users", "mocklab")).toBe("#/mocklab/users");
    expect(
      adminHashFor("connector-detail", "mocklab", { connectorId: "hubspot" }),
    ).toBe("#/mocklab/connectors/hubspot");
    expect(adminHashFor("users", "acme-health", { userId: "u1" })).toBe(
      "#/acme-health/users/u1",
    );
    expect(parseAdminHash(adminHashFor("users", "acme-health"))).toEqual({
      tenantSlug: "acme-health",
      page: "users",
      connectorId: null,
      userId: null,
    });
  });

  it("bounces unknown or unscoped hashes to Tenants for superadmin", () => {
    const known = new Set(["mocklab"]);
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/nope"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "tenants",
      tenantSlug: null,
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/connectors"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "tenants",
      tenantSlug: null,
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/ghost/connectors"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "tenants",
      tenantSlug: null,
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/admin/connectors"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "tenants",
      tenantSlug: null,
      connectorId: null,
      userId: null,
    });
  });

  it("resolves a known tenant workspace and platform registry", () => {
    const known = new Set(["mocklab"]);
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/mocklab/connectors"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "connectors",
      tenantSlug: "mocklab",
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/registry"),
        role: "superadmin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "registry",
      tenantSlug: null,
      connectorId: null,
      userId: null,
    });
  });

  it("keeps a tenant admin inside Connectors/Users of their tenant", () => {
    const known = new Set(["mocklab"]);
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/tenants"),
        role: "tenant_admin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "connectors",
      tenantSlug: "mocklab",
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/registry"),
        role: "tenant_admin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "connectors",
      tenantSlug: "mocklab",
      connectorId: null,
      userId: null,
    });
    expect(
      resolveAdminLocation({
        parsed: parseAdminHash("#/mocklab/users"),
        role: "tenant_admin",
        knownTenantSlugs: known,
      }),
    ).toEqual({
      page: "users",
      tenantSlug: "mocklab",
      connectorId: null,
      userId: null,
    });
  });
});
