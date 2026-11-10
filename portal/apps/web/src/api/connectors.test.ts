import { afterEach, describe, expect, it, vi } from "vitest";

import { resetCsrfToken } from "./client.js";
import {
  beginConnectorChatUse,
  clearHubSpotPin,
  disconnectConnector,
  fetchConnectors,
  fetchConnectorsTeam,
  isConnectorOAuthMessage,
  parseConnectorChatUse,
  parseConnectorDisconnect,
  parseConnectorOAuthStart,
  parseConnectorPendingResume,
  parseConnectorRefresh,
  parseConnectorsList,
  putConnectorGrant,
  refreshConnector,
  startConnectorOAuth,
} from "./connectors.js";

describe("parseConnectorsList", () => {
  it("keeps allowlisted fields and fail-closes malformed ids and flags", () => {
    const parsed = parseConnectorsList({
      connectors: [
        {
          connector_id: "google",
          status: "not_connected",
          account_label: "ada@example.com",
          sticky: { "gmail.read": true, skip: false },
          entitled: true,
          role_granted: true,
          hubspot_portal_id: null,
          oauth_refresh: "leaked",
        },
        {
          connector_id: "Not A Connector",
          status: "connected",
          entitled: true,
          role_granted: true,
        },
        {
          connector_id: "slack",
          label: "Slack",
          status: "not_connected",
          entitled: true,
          role_granted: true,
        },
        {
          connector_id: "hubspot",
          status: "bogus",
        },
      ],
    });
    expect(parsed.connectors).toEqual([
      {
        connector_id: "google",
        status: "not_connected",
        account_label: "ada@example.com",
        sticky: { "gmail.read": true },
        entitled: true,
        role_granted: true,
        hubspot_portal_id: null,
      },
      {
        connector_id: "slack",
        label: "Slack",
        status: "not_connected",
        account_label: null,
        sticky: {},
        entitled: true,
        role_granted: true,
        hubspot_portal_id: null,
      },
      {
        connector_id: "hubspot",
        status: "not_connected",
        account_label: null,
        sticky: {},
        entitled: false,
        role_granted: false,
        hubspot_portal_id: null,
      },
    ]);
  });
});

describe("fetchConnectors", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("GETs /api/connectors and parses the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          connectors: [
            {
              connector_id: "whatsapp",
              status: "pairing",
              entitled: true,
              role_granted: true,
            },
          ],
        }),
      }),
    );

    await expect(fetchConnectors()).resolves.toEqual({
      connectors: [
        {
          connector_id: "whatsapp",
          status: "pairing",
          account_label: null,
          sticky: {},
          entitled: true,
          role_granted: true,
          hubspot_portal_id: null,
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith("/api/connectors", {
      credentials: "include",
    });
  });

  it("throws the server message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Not authenticated" }),
      }),
    );
    await expect(fetchConnectors()).rejects.toThrow("Not authenticated");
  });
});


describe("connector lifecycle SPA parsers", () => {
  it("parses disconnect and rejects leaked refresh tokens", () => {
    expect(
      parseConnectorDisconnect({
        connector_id: "google",
        status: "not_connected",
        revoke_attempted: true,
      }),
    ).toEqual({
      connector_id: "google",
      status: "not_connected",
      revoke_attempted: true,
    });
    expect(() =>
      parseConnectorDisconnect({
        connector_id: "google",
        oauth_refresh: "leaked",
      }),
    ).toThrow(/secret/);
  });

  it("treats refresh fail as needs_reauth wizard", () => {
    expect(
      parseConnectorRefresh({
        connector_id: "google",
        status: "needs_reauth",
        account_label: "ada@example.com",
        wizard: true,
      }),
    ).toEqual({
      connector_id: "google",
      status: "needs_reauth",
      account_label: "ada@example.com",
      wizard: true,
    });
  });
});

describe("disconnectConnector / refreshConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs disconnect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          csrf_token: "csrf",
          connector_id: "google",
          status: "not_connected",
          revoke_attempted: true,
        }),
      }),
    );
    await expect(disconnectConnector("google")).resolves.toMatchObject({
      connector_id: "google",
      status: "not_connected",
      revoke_attempted: true,
    });
  });

  it("POSTs refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          csrf_token: "csrf",
          connector_id: "google",
          status: "needs_reauth",
          wizard: true,
        }),
      }),
    );
    await expect(refreshConnector("google")).resolves.toMatchObject({
      connector_id: "google",
      status: "needs_reauth",
      wizard: true,
    });
  });
});

describe("fetchConnectorsTeam", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("returns null on 403 so members cannot open Team", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "Connector grants require tenant admin" }),
      }),
    );
    await expect(fetchConnectorsTeam()).resolves.toBeNull();
  });

  it("parses admin team status without keeping ciphertext", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          hubspot_portal_id: "123456",
          oauth_refresh: "leaked",
          members: [
            {
              user_id: "u1",
              email: "alice@demo.test",
              connectors: [
                {
                  connector_id: "google",
                  status: "connected",
                  account_label: "alice@gmail.com",
                },
              ],
            },
          ],
          grants: [
            {
              role_id: "role-member",
              role_name: "member",
              connector_id: "google",
              enabled: true,
            },
          ],
        }),
      }),
    );

    const team = await fetchConnectorsTeam();
    expect(team?.hubspot_portal_id).toBe("123456");
    expect(JSON.stringify(team)).not.toContain("leaked");
    expect(fetch).toHaveBeenCalledWith("/api/connectors/team", {
      credentials: "include",
    });
  });
});

describe("putConnectorGrant", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("PUTs CSRF-backed (role, connector) grants", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/csrf")) {
        return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/connectors/grants")) {
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-1");
        expect(JSON.parse(String(init?.body))).toEqual({
          role_id: "role-member",
          connector_id: "hubspot",
          enabled: true,
        });
        return new Response(
          JSON.stringify({
            role_id: "role-member",
            connector_id: "hubspot",
            enabled: true,
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      putConnectorGrant({
        role_id: "role-member",
        connector_id: "hubspot",
        enabled: true,
      }),
    ).resolves.toEqual({
      role_id: "role-member",
      connector_id: "hubspot",
      enabled: true,
    });
  });
});

describe("clearHubSpotPin", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("PUTs null pin only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/csrf")) {
        return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/connectors/hubspot/pin")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          hubspot_portal_id: null,
        });
        return new Response(JSON.stringify({ hubspot_portal_id: null }), {
          status: 200,
        });
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(clearHubSpotPin()).resolves.toEqual({
      hubspot_portal_id: null,
    });
  });
});

describe("startConnectorOAuth", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("POSTs start and rejects leaked refresh tokens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
          status: 200,
        });
      }
      expect(url).toContain("/api/connectors/google/oauth/start");
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          connector_id: "google",
          url: "https://accounts.google.com/o/oauth2/v2/auth?scope=gmail.send",
          oauth_refresh: "leaked",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startConnectorOAuth("google")).rejects.toThrow(/leaked/);
  });

  it("returns the authorize url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            connector_id: "google",
            url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
          }),
          { status: 200 },
        );
      }),
    );
    await expect(startConnectorOAuth("google")).resolves.toEqual({
      connector_id: "google",
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    });
    expect(
      parseConnectorOAuthStart({
        connector_id: "google",
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
      }).url,
    ).toContain("accounts.google.com");
  });

  it("POSTs HubSpot start and rejects leaked refresh tokens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
          status: 200,
        });
      }
      expect(url).toContain("/api/connectors/hubspot/oauth/start");
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          connector_id: "hubspot",
          url: "https://app.hubspot.com/oauth/authorize?scope=crm.objects.contacts.read",
          oauth_refresh: "leaked",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startConnectorOAuth("hubspot")).rejects.toThrow(/leaked/);
  });

  it("returns the HubSpot authorize url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            connector_id: "hubspot",
            url: "https://app.hubspot.com/oauth/authorize?state=abc",
          }),
          { status: 200 },
        );
      }),
    );
    await expect(startConnectorOAuth("hubspot")).resolves.toEqual({
      connector_id: "hubspot",
      url: "https://app.hubspot.com/oauth/authorize?state=abc",
    });
    expect(
      parseConnectorOAuthStart({
        connector_id: "hubspot",
        url: "https://app.hubspot.com/oauth/authorize?state=abc",
      }).url,
    ).toContain("app.hubspot.com");
  });

  it("ignores postMessage from another origin", () => {
    expect(
      isConnectorOAuthMessage("https://evil.example", "https://app.withlanyard.com", {
        type: "lanyard.connector.oauth",
        connector_id: "google",
        status: "connected",
      }),
    ).toBe(false);
    expect(
      isConnectorOAuthMessage(
        "https://app.withlanyard.com",
        "https://app.withlanyard.com",
        {
          type: "lanyard.connector.oauth",
          connector_id: "google",
          status: "connected",
          account_label: "ada@example.com",
        },
      ),
    ).toBe(true);
    expect(
      isConnectorOAuthMessage(
        "https://app.withlanyard.com",
        "https://app.withlanyard.com",
        {
          type: "lanyard.connector.oauth",
          connector_id: "hubspot",
          status: "connected",
          account_label: "ada@example.com (62515)",
        },
      ),
    ).toBe(true);
  });
});

describe("connector chat-use (lp-xhf4.8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses needs_auth instead of a dead 403 body", () => {
    const parsed = parseConnectorChatUse({
      kind: "needs_auth",
      connector_id: "google",
      wizard: {
        portal_event: "needs_auth",
        mcq_id: "cc-needs_auth-google-th-1",
        content: "Connect Google",
        choices: [
          { id: "connect", label: "Connect Google" },
          { id: "cancel", label: "Cancel" },
        ],
      },
      pending: {
        tool: "gws",
        args: ["gmail", "users", "drafts", "create"],
        action_class: "gmail.draft",
        expires_at: 99,
        thread_id: "th-1",
      },
    });
    expect(parsed.kind).toBe("needs_auth");
    if (parsed.kind !== "needs_auth") return;
    expect(parsed.pending.args).toEqual([
      "gmail",
      "users",
      "drafts",
      "create",
    ]);
  });

  it("parses resume of only stored tool args", () => {
    expect(
      parseConnectorPendingResume({
        kind: "resume",
        connector_id: "google",
        tool: "gws",
        args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
        thread_id: "th-1",
      }),
    ).toEqual({
      kind: "resume",
      connector_id: "google",
      tool: "gws",
      args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
      thread_id: "th-1",
    });
  });

  it("refuses to treat chat-use 403 as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
        });
      }),
    );
    await expect(
      beginConnectorChatUse("google", {
        thread_id: "th-1",
        args: ["gws", "gmail", "users", "drafts", "create"],
      }),
    ).rejects.toThrow(/403/);
  });
});
