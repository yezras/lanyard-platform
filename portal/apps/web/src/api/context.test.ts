import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPortalContext } from "./context.js";

describe("fetchPortalContext", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tenant_id: "t1",
          tenant_slug: "mocklab",
          brain_rpc_enabled: false,
          chat_delivery: "harness",
          vault_plane: "cp_s3",
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns brain_rpc_enabled from GET /api/context", async () => {
    const ctx = await fetchPortalContext();
    expect(ctx.brain_rpc_enabled).toBe(false);
    expect(ctx.chat_delivery).toBe("harness");
    expect(ctx.vault_plane).toBe("cp_s3");
    expect(ctx.tenant_slug).toBe("mocklab");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/context$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns ui.can.vault_edit when present (lp-5q6.29)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "t1",
        brain_rpc_enabled: true,
        ui: { can: { vault_edit: true } },
      }),
    } as Response);

    const ctx = await fetchPortalContext();
    expect(ctx.ui?.can?.vault_edit).toBe(true);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" }),
    } as Response);

    await expect(fetchPortalContext()).rejects.toThrow(/unavailable|503/);
  });
});
