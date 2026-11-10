import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchTenantRetention,
  shouldPersistInteraction,
} from "../src/retention.js";

describe("relay retention hook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults to false when control plane URL is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const persist = await shouldPersistInteraction("tenant-1");

    expect(persist).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to false when control plane returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
      })),
    );

    const persist = await shouldPersistInteraction("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      defaultEnabled: false,
    });

    expect(persist).toBe(false);
  });

  it("sends internal ops token to the retention endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tenant_id: "tenant-1",
        interaction_export_enabled: false,
        retention_mode: "none",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await shouldPersistInteraction("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://control-plane.test/internal/tenants/tenant-1/retention",
      {
        headers: { "x-internal-ops-token": "ops-token" },
      },
    );
  });

  it("fetchTenantRetention returns null without a control plane URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const policy = await fetchTenantRetention("tenant-1");

    expect(policy).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to false when export is not enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tenant_id: "tenant-1",
          interaction_export_enabled: false,
          retention_mode: "none",
        }),
      })),
    );

    const persist = await shouldPersistInteraction("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(persist).toBe(false);
  });

  it("returns true only when ops has enabled interaction export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tenant_id: "tenant-1",
          interaction_export_enabled: true,
          retention_mode: "interaction_export",
        }),
      })),
    );

    const persist = await shouldPersistInteraction("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(persist).toBe(true);
  });

  it("falls back to default false when control plane is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const persist = await shouldPersistInteraction("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      defaultEnabled: false,
    });

    expect(persist).toBe(false);
  });

  it("retention snapshot is metadata-only (no message body fields) — lp-p37.13", async () => {
    // Interaction export (L5) may enqueue metadata jobs when enabled, but the
    // CP retention API surface must never carry chat message bodies.
    const body = {
      tenant_id: "tenant-1",
      interaction_export_enabled: true,
      retention_mode: "interaction_export",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => body,
      })),
    );

    const policy = await fetchTenantRetention("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(policy).toEqual(body);
    const keys = Object.keys(policy ?? {});
    expect(keys).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "interaction_export_enabled",
        "retention_mode",
      ]),
    );
    for (const forbidden of [
      "content",
      "message",
      "message_body",
      "body",
      "transcript",
      "events",
      "history",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // Gate still respects export enabled for enqueue decision only.
    await expect(
      shouldPersistInteraction("tenant-1", {
        controlPlaneUrl: "http://control-plane.test",
        internalOpsToken: "ops-token",
      }),
    ).resolves.toBe(true);
  });
});