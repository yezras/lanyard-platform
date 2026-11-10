import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createChatThreadShare,
  listChatThreadShares,
  listOrgMembers,
  revokeChatThreadShare,
} from "./sessionShares.js";
import type { OrgMember, SessionShareGrant } from "./types.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

const grant: SessionShareGrant = {
  grant_id: "grant-1",
  tenant_id: "tenant-1",
  thread_id: "thread-1",
  owner_user_id: "owner-1",
  grantee_user_id: "user-2",
  mode: "read",
  created_at: "2026-07-15T00:00:00.000Z",
  revoked_at: null,
};

const members: OrgMember[] = [
  { user_id: "user-2", email: "bob@demo.test" },
  { user_id: "user-3", email: "carol@demo.test" },
];

describe("listOrgMembers", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs /api/org/members and returns members", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_id: "tenant-1",
        members,
      }),
    } as Response);

    await expect(listOrgMembers()).resolves.toEqual(members);

    expect(apiFetch).toHaveBeenCalledWith("/api/org/members");
  });

  it("forwards optional q search param", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_id: "tenant-1",
        members: [members[0]],
      }),
    } as Response);

    await expect(listOrgMembers({ q: " bob " })).resolves.toEqual([
      members[0],
    ]);

    expect(apiFetch).toHaveBeenCalledWith("/api/org/members?q=bob");
  });

  it("throws when the API returns an error payload", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Not authenticated" }),
    } as Response);

    await expect(listOrgMembers()).rejects.toThrow("Not authenticated");
  });

  it("returns empty array when members is omitted", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ tenant_id: "tenant-1" }),
    } as Response);

    await expect(listOrgMembers()).resolves.toEqual([]);
  });
});

describe("createChatThreadShare", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs grantee_email and mode to the shares route", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => grant,
    } as Response);

    await expect(
      createChatThreadShare({
        threadId: "thread-1",
        granteeEmail: "bob@demo.test",
        mode: "read",
      }),
    ).resolves.toEqual(grant);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/shares",
      {
        method: "POST",
        body: JSON.stringify({
          grantee_email: "bob@demo.test",
          mode: "read",
        }),
      },
    );
  });

  it("supports collaborate mode", async () => {
    const collabGrant: SessionShareGrant = {
      ...grant,
      mode: "collaborate",
    };
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => collabGrant,
    } as Response);

    await createChatThreadShare({
      threadId: "thread-1",
      granteeEmail: "carol@demo.test",
      mode: "collaborate",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/shares",
      {
        method: "POST",
        body: JSON.stringify({
          grantee_email: "carol@demo.test",
          mode: "collaborate",
        }),
      },
    );
  });

  it("throws when create fails with error payload", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Grantee not found in tenant" }),
    } as Response);

    await expect(
      createChatThreadShare({
        threadId: "thread-1",
        granteeEmail: "missing@demo.test",
        mode: "read",
      }),
    ).rejects.toThrow("Grantee not found in tenant");
  });

  it("falls back to status message when error body is empty", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({}),
    } as Response);

    await expect(
      createChatThreadShare({
        threadId: "thread-1",
        granteeEmail: "bob@demo.test",
        mode: "read",
      }),
    ).rejects.toThrow("Failed to create share (409)");
  });
});

describe("listChatThreadShares", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs owner share list for a thread", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ grants: [grant] }),
    } as Response);

    await expect(listChatThreadShares("thread-1")).resolves.toEqual([grant]);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/shares",
    );
  });

  it("returns empty array when grants is omitted", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await expect(listChatThreadShares("thread-1")).resolves.toEqual([]);
  });

  it("throws when the API returns an error payload", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Chat thread not found" }),
    } as Response);

    await expect(listChatThreadShares("missing")).rejects.toThrow(
      "Chat thread not found",
    );
  });
});

describe("revokeChatThreadShare", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("DELETEs the share by grantee user id", async () => {
    const revoked: SessionShareGrant = {
      ...grant,
      revoked_at: "2026-07-15T12:00:00.000Z",
    };
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => revoked,
    } as Response);

    await expect(
      revokeChatThreadShare({
        threadId: "thread-1",
        granteeUserId: "user-2",
      }),
    ).resolves.toEqual(revoked);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/shares/user-2",
      { method: "DELETE" },
    );
  });

  it("throws when revoke fails with error payload", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Share grant not found" }),
    } as Response);

    await expect(
      revokeChatThreadShare({
        threadId: "thread-1",
        granteeUserId: "user-missing",
      }),
    ).rejects.toThrow("Share grant not found");
  });

  it("falls back to status message when error body is empty", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);

    await expect(
      revokeChatThreadShare({
        threadId: "thread-1",
        granteeUserId: "user-2",
      }),
    ).rejects.toThrow("Failed to revoke share (403)");
  });
});
