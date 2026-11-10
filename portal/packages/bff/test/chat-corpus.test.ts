import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CHAT_CORPUS_RETENTION_DAYS,
  effectiveChatCorpusRetentionDays,
  fetchTenantChatCorpusPolicy,
  shouldWriteChatCorpus,
} from "../src/chat-corpus.js";

describe("BFF chat corpus gate (lp-gkh.6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.BFF_CHAT_CORPUS_DEFAULT;
    delete process.env.CONTROL_PLANE_URL;
    delete process.env.INTERNAL_OPS_TOKEN;
    delete process.env.CONTROL_PLANE_INTERNAL_TOKEN;
  });

  it("defaults to false when control plane URL is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const write = await shouldWriteChatCorpus("tenant-1");

    expect(write).toBe(false);
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

    const write = await shouldWriteChatCorpus("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      defaultEnabled: false,
    });

    expect(write).toBe(false);
  });

  it("sends internal ops token to the retention endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tenant_id: "tenant-1",
        interaction_export_enabled: false,
        retention_mode: "none",
        chat_corpus_enabled: false,
        chat_corpus_retention_days: null,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await shouldWriteChatCorpus("tenant-1", {
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

  it("fetchTenantChatCorpusPolicy returns null without a control plane URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const policy = await fetchTenantChatCorpusPolicy("tenant-1");

    expect(policy).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to false when chat_corpus_enabled is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tenant_id: "tenant-1",
          interaction_export_enabled: true,
          retention_mode: "interaction_export",
          chat_corpus_enabled: false,
          chat_corpus_retention_days: null,
        }),
      })),
    );

    // L5 on must not enable L10
    const write = await shouldWriteChatCorpus("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(write).toBe(false);
  });

  it("returns true only when ops has enabled chat_corpus_enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tenant_id: "tenant-1",
          interaction_export_enabled: false,
          retention_mode: "none",
          chat_corpus_enabled: true,
          chat_corpus_retention_days: 90,
        }),
      })),
    );

    const write = await shouldWriteChatCorpus("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(write).toBe(true);
  });

  it("falls back to default false when control plane is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const write = await shouldWriteChatCorpus("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      defaultEnabled: false,
    });

    expect(write).toBe(false);
  });

  it("retention snapshot is metadata-only (no message body fields)", async () => {
    const body = {
      tenant_id: "tenant-1",
      interaction_export_enabled: false,
      retention_mode: "none",
      chat_corpus_enabled: true,
      chat_corpus_retention_days: 120,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => body,
      })),
    );

    const policy = await fetchTenantChatCorpusPolicy("tenant-1", {
      controlPlaneUrl: "http://control-plane.test",
      internalOpsToken: "ops-token",
    });

    expect(policy).toEqual(body);
    const keys = Object.keys(policy ?? {});
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
  });

  it("effectiveChatCorpusRetentionDays uses platform default when null", () => {
    expect(
      effectiveChatCorpusRetentionDays({
        chat_corpus_enabled: false,
        chat_corpus_retention_days: 90,
      }),
    ).toBeNull();
    expect(
      effectiveChatCorpusRetentionDays({
        chat_corpus_enabled: true,
        chat_corpus_retention_days: null,
      }),
    ).toBe(DEFAULT_CHAT_CORPUS_RETENTION_DAYS);
    expect(
      effectiveChatCorpusRetentionDays({
        chat_corpus_enabled: true,
        chat_corpus_retention_days: 180,
      }),
    ).toBe(180);
  });
});
