import { describe, expect, it, vi } from "vitest";

import {
  parseOpsAdminContext,
  fetchOpsAdminContext,
} from "./opsAdminContext.js";

describe("parseOpsAdminContext", () => {
  it("parses a superadmin context", () => {
    expect(parseOpsAdminContext({ role: "superadmin" })).toEqual({
      role: "superadmin",
    });
  });

  it("parses a well-formed tenant_admin context", () => {
    expect(
      parseOpsAdminContext({
        role: "tenant_admin",
        tenant: {
          tenant_id: "t1",
          tenant_slug: "mocklab",
          display_name: "MockLab",
        },
      }),
    ).toEqual({
      role: "tenant_admin",
      tenant: {
        tenant_id: "t1",
        tenant_slug: "mocklab",
        display_name: "MockLab",
      },
    });
  });

  it("throws on a tenant_admin claim with a malformed tenant (fail closed)", () => {
    expect(() =>
      parseOpsAdminContext({ role: "tenant_admin", tenant: { tenant_id: "t1" } }),
    ).toThrow();
    expect(() => parseOpsAdminContext({ role: "tenant_admin" })).toThrow();
  });

  it("throws on unknown roles and non-object bodies", () => {
    expect(() => parseOpsAdminContext({ role: "ops" })).toThrow();
    expect(() => parseOpsAdminContext(null)).toThrow();
    expect(() => parseOpsAdminContext("superadmin")).toThrow();
  });
});

describe("fetchOpsAdminContext", () => {
  it("falls back to superadmin when the endpoint is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    try {
      expect(await fetchOpsAdminContext()).toEqual({ role: "superadmin" });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/context");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("falls back to superadmin on network failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    try {
      expect(await fetchOpsAdminContext()).toEqual({ role: "superadmin" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws on a malformed tenant_admin payload instead of downgrading", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ role: "tenant_admin" }), { status: 200 }),
    );
    try {
      await expect(fetchOpsAdminContext()).rejects.toThrow();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
