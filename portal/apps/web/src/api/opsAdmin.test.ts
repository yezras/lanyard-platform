import { describe, expect, it, vi } from "vitest";

import {
  fetchOpsTenantAudit,
  fetchOpsTenantInstances,
  fetchOpsTenants,
  parseOpsAuditEntries,
  parseOpsInstances,
  parseOpsRoles,
  parseOpsTenants,
} from "./opsAdmin.js";

describe("opsAdmin parsers", () => {
  it("parses tenant summaries and drops malformed rows", () => {
    const tenants = parseOpsTenants({
      tenants: [
        { tenant_id: "t1", tenant_slug: "demo", display_name: "Demo" },
        { tenant_id: "", tenant_slug: "x", display_name: "Bad" },
        { tenant_id: "t2", tenant_slug: 7, display_name: "Bad" },
        "junk",
      ],
    });
    expect(tenants).toEqual([
      { tenant_id: "t1", tenant_slug: "demo", display_name: "Demo" },
    ]);
    expect(parseOpsTenants(null)).toEqual([]);
    expect(parseOpsTenants({})).toEqual([]);
  });

  it("parses gateway instance rows with public fields only", () => {
    const instances = parseOpsInstances({
      instances: [
        {
          instance_id: "i1",
          created_at: "2026-08-01T00:00:00Z",
          label: null,
          health_status: "healthy",
          runtime_kind: "daytona",
          presence: "online",
          sandbox_id: "sbx-1",
          revoked_at: null,
          last_activity_at: null,
          secret_hash: "should-not-matter-here",
        },
        { instance_id: "" },
      ],
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      instance_id: "i1",
      runtime_kind: "daytona",
      presence: "online",
      sandbox_id: "sbx-1",
      label: null,
      revoked_at: null,
    });
    expect(parseOpsInstances({})).toEqual([]);
  });

  it("parses role rows including path prefixes", () => {
    const roles = parseOpsRoles({
      roles: [
        {
          role_id: "r1",
          name: "admin",
          hermes_profile: "workspace",
          path_prefixes: ["/projects", "/skills"],
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    expect(roles).toEqual([
      {
        role_id: "r1",
        name: "admin",
        hermes_profile: "workspace",
        path_prefixes: ["/projects", "/skills"],
        created_at: "2026-08-01T00:00:00Z",
      },
    ]);
    expect(parseOpsRoles({ roles: [{ role_id: "" }] })).toEqual([]);
  });

  it("parses audit entry rows", () => {
    const entries = parseOpsAuditEntries({
      entries: [
        {
          audit_id: "a1",
          action: "instance.provisioned",
          actor: "ops@lanyard.example",
          result: "success",
          created_at: "2026-08-02T00:00:00Z",
          instance_id: "i1",
        },
      ],
    });
    expect(entries).toEqual([
      {
        audit_id: "a1",
        action: "instance.provisioned",
        actor: "ops@lanyard.example",
        result: "success",
        created_at: "2026-08-02T00:00:00Z",
        instance_id: "i1",
      },
    ]);
    expect(parseOpsAuditEntries({ entries: [] })).toEqual([]);
  });

  it("fetch helpers hit bare /api/admin paths via BFF", async () => {
    const calls: string[] = [];
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        calls.push(new URL(raw, "http://localhost").pathname);
        return new Response(JSON.stringify({ tenants: [] }), { status: 200 });
      });

    await fetchOpsTenants();
    await fetchOpsTenantInstances("t/1");
    spy.mockRestore();

    expect(calls).toEqual(["/api/admin/tenants", "/api/admin/tenants/t%2F1/instances"]);
  });

  it("fetch helpers throw the API error message on failure", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
        }),
      );
    try {
      await expect(fetchOpsTenantAudit("t1")).rejects.toThrow(
        "Not authenticated",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
