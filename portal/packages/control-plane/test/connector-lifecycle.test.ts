/**
 * lp-xhf4.12 — connector lifecycle table and apply reducer.
 */
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_LIFECYCLE_EVENTS,
  CONNECTOR_LIFECYCLE_TABLE,
  applyConnectorLifecycle,
  createDefaultConnectorOauthProvider,
  planForLifecycleEvent,
  providerActionFor,
  ConnectorOauthNotConfiguredError,
  ConnectorRefreshError,
  type ConnectorLifecyclePorts,
  type ConnectorLifecycleTarget,
} from "../src/index.js";
import {
  ConnectorConnectionNotFoundError as NotFound,
  type ConnectorId,
  type ConnectorConnectionPublic,
  type ConnectorSecrets,
} from "../src/connectors.js";

const TENANT = "tenant-a";
const ALICE = "user-alice";
const BOB = "user-bob";

function publicRow(
  user_id: string,
  connector_id: ConnectorId,
  status: ConnectorConnectionPublic["status"] = "connected",
): ConnectorConnectionPublic {
  return {
    tenant_id: TENANT,
    user_id,
    connector_id,
    status,
    account_label: `${user_id}@example.com`,
    hubspot_portal_id: null,
    sticky: {},
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  };
}

function oauthSecrets(overrides: Partial<ConnectorSecrets> = {}): ConnectorSecrets {
  return {
    oauth_access: "access-old",
    oauth_refresh: "refresh-old",
    oauth_expiry: "2026-08-21T01:00:00.000Z",
    oauth_scopes: ["gmail.readonly"],
    whatsapp_session_db: null,
    ...overrides,
  };
}

function createFakePorts(init?: {
  rows?: ConnectorConnectionPublic[];
  secrets?: Map<string, ConnectorSecrets>;
  losingRole?: string[];
  refresh?: ConnectorLifecyclePorts["refreshOauth"];
  revoke?: ConnectorLifecyclePorts["revokeOauth"];
  logout?: ConnectorLifecyclePorts["logoutWhatsApp"];
}): ConnectorLifecyclePorts & {
  deleted: ConnectorLifecycleTarget[];
  revoked: ConnectorId[];
  loggedOut: string[];
  dropped: ConnectorLifecycleTarget[];
  rows: Map<string, ConnectorConnectionPublic>;
  secrets: Map<string, ConnectorSecrets>;
} {
  const key = (user_id: string, connector_id: ConnectorId) =>
    `${user_id}:${connector_id}`;
  const rows = new Map(
    (init?.rows ?? []).map((row) => [key(row.user_id, row.connector_id), row]),
  );
  const secrets =
    init?.secrets ??
    new Map(
      (init?.rows ?? []).map((row) => [
        key(row.user_id, row.connector_id),
        oauthSecrets(),
      ]),
    );
  const deleted: ConnectorLifecycleTarget[] = [];
  const revoked: ConnectorId[] = [];
  const loggedOut: string[] = [];
  const dropped: ConnectorLifecycleTarget[] = [];

  const ports: ConnectorLifecyclePorts & {
    deleted: ConnectorLifecycleTarget[];
    revoked: ConnectorId[];
    loggedOut: string[];
    dropped: ConnectorLifecycleTarget[];
    rows: Map<string, ConnectorConnectionPublic>;
    secrets: Map<string, ConnectorSecrets>;
  } = {
    deleted,
    revoked,
    loggedOut,
    dropped,
    rows,
    secrets,
    getConnection: async (tenant_id, user_id, connector_id) =>
      rows.get(key(user_id, connector_id)) ?? null,
    getSecrets: async (tenant_id, user_id, connector_id) => {
      const found = secrets.get(key(user_id, connector_id));
      if (!found) {
        throw new NotFound(tenant_id, user_id, connector_id);
      }
      return found;
    },
    deleteConnection: async (input) => {
      const k = key(input.user_id, input.connector_id);
      if (!rows.has(k)) return false;
      rows.delete(k);
      secrets.delete(k);
      deleted.push({ user_id: input.user_id, connector_id: input.connector_id });
      return true;
    },
    upsertConnection: async (input) => {
      const k = key(input.user_id, input.connector_id);
      const prev = rows.get(k) ?? publicRow(input.user_id, input.connector_id);
      const next = {
        ...prev,
        status: input.status ?? prev.status,
      };
      rows.set(k, next);
      if (input.secrets) {
        const base = secrets.get(k) ?? oauthSecrets({ oauth_refresh: null, oauth_access: null, oauth_expiry: null, oauth_scopes: [] });
        secrets.set(k, {
          oauth_access: input.secrets.oauth_access ?? base.oauth_access,
          oauth_refresh: input.secrets.oauth_refresh ?? base.oauth_refresh,
          oauth_expiry: input.secrets.oauth_expiry ?? base.oauth_expiry,
          oauth_scopes: input.secrets.oauth_scopes ?? base.oauth_scopes,
          whatsapp_session_db:
            input.secrets.whatsapp_session_db ?? base.whatsapp_session_db,
        });
      }
      return next;
    },
    listConnectionsForConnector: async (_tenant, connector_id) =>
      [...rows.values()]
        .filter((row) => row.connector_id === connector_id)
        .map((row) => ({ user_id: row.user_id, connector_id: row.connector_id })),
    listConnectionsForUser: async (_tenant, user_id) =>
      [...rows.values()]
        .filter((row) => row.user_id === user_id)
        .map((row) => ({ user_id: row.user_id, connector_id: row.connector_id })),
    listUsersLosingRoleGrant: async () => init?.losingRole ?? [ALICE],
    dropGuestCache: async (input) => {
      dropped.push({ user_id: input.user_id, connector_id: input.connector_id });
      return true;
    },
    revokeOauth:
      init?.revoke ??
      (async (input) => {
        revoked.push(input.connector_id);
      }),
    refreshOauth:
      init?.refresh ??
      (async () => ({
        oauth_access: "access-new",
        oauth_refresh: "refresh-old",
        oauth_expiry: "2099-01-01T00:00:00.000Z",
      })),
    logoutWhatsApp:
      init?.logout ??
      (async (input) => {
        loggedOut.push(input.user_id);
      }),
  };
  return ports;
}

describe("connector lifecycle table (lp-xhf4.12)", () => {
  it("covers every architecture §7 event", () => {
    expect([...CONNECTOR_LIFECYCLE_EVENTS].sort()).toEqual(
      [
        "clear_hubspot_pin",
        "refresh",
        "refresh_fail",
        "role_grant_off",
        "tenant_entitlement_off",
        "user_disconnect",
        "user_removed",
      ].sort(),
    );
    for (const kind of CONNECTOR_LIFECYCLE_EVENTS) {
      expect(planForLifecycleEvent(kind).event).toBe(kind);
    }
  });

  it("maps google disconnect to revoke + delete + drop cache", () => {
    const plan = CONNECTOR_LIFECYCLE_TABLE.user_disconnect;
    expect(plan.row).toBe("delete");
    expect(providerActionFor(plan, "google")).toBe("revoke");
    expect(plan.sandbox).toBe("drop_cache");
    expect(plan.wizard).toBe(false);
  });

  it("maps whatsapp disconnect to wacli logout", () => {
    expect(
      providerActionFor(CONNECTOR_LIFECYCLE_TABLE.user_disconnect, "whatsapp"),
    ).toBe("wacli_logout");
  });

  it("maps refresh fail to keep row + wizard", () => {
    const plan = CONNECTOR_LIFECYCLE_TABLE.refresh_fail;
    expect(plan.row).toBe("keep_needs_reauth");
    expect(plan.sandbox).toBe("wizard");
    expect(plan.wizard).toBe(true);
  });

  it("maps clear hubspot pin to keep tokens", () => {
    const plan = CONNECTOR_LIFECYCLE_TABLE.clear_hubspot_pin;
    expect(plan.row).toBe("keep");
    expect(plan.provider).toBe("none");
  });
});

describe("applyConnectorLifecycle", () => {
  it("disconnects google: row gone, revoke attempted, inject cache dropped", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "google")],
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "user_disconnect",
        tenant_id: TENANT,
        user_id: ALICE,
        connector_id: "google",
      },
      ports,
    );
    expect(result.deleted).toEqual([
      {
        user_id: ALICE,
        connector_id: "google",
        revoke_attempted: true,
        cache_dropped: true,
      },
    ]);
    expect(ports.revoked).toEqual(["google"]);
    expect(ports.dropped).toEqual([{ user_id: ALICE, connector_id: "google" }]);
    expect(ports.rows.size).toBe(0);
    expect(ports.secrets.size).toBe(0);
  });

  it("still deletes when provider revoke throws", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "google")],
      revoke: async () => {
        throw new Error("provider down");
      },
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "user_disconnect",
        tenant_id: TENANT,
        user_id: ALICE,
        connector_id: "google",
      },
      ports,
    );
    expect(result.deleted[0]?.revoke_attempted).toBe(true);
    expect(ports.rows.size).toBe(0);
  });

  it("grant off google deletes only users who lose access", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "google"), publicRow(BOB, "google")],
      losingRole: [ALICE],
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "role_grant_off",
        tenant_id: TENANT,
        role_id: "role-member",
        connector_id: "google",
      },
      ports,
    );
    expect(result.deleted.map((row) => row.user_id)).toEqual([ALICE]);
    expect(ports.rows.has(`${BOB}:google`)).toBe(true);
    expect(ports.rows.has(`${ALICE}:google`)).toBe(false);
  });

  it("tenant entitlement off deletes every matching row", async () => {
    const ports = createFakePorts({
      rows: [
        publicRow(ALICE, "google"),
        publicRow(BOB, "google"),
        publicRow(ALICE, "hubspot"),
      ],
    });
    await applyConnectorLifecycle(
      {
        kind: "tenant_entitlement_off",
        tenant_id: TENANT,
        connector_id: "google",
      },
      ports,
    );
    expect([...ports.rows.keys()]).toEqual([`${ALICE}:hubspot`]);
  });

  it("user removed deletes all their connection rows", async () => {
    const ports = createFakePorts({
      rows: [
        publicRow(ALICE, "google"),
        publicRow(ALICE, "whatsapp"),
        publicRow(BOB, "google"),
      ],
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "user_removed",
        tenant_id: TENANT,
        user_id: ALICE,
      },
      ports,
    );
    expect(result.deleted.map((row) => row.connector_id).sort()).toEqual([
      "google",
      "whatsapp",
    ]);
    expect(ports.loggedOut).toEqual([ALICE]);
    expect(ports.rows.has(`${BOB}:google`)).toBe(true);
  });

  it("refresh success rotates access and keeps the row", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "google")],
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "refresh",
        tenant_id: TENANT,
        user_id: ALICE,
        connector_id: "google",
      },
      ports,
    );
    expect(result.wizard).toBe(false);
    expect(result.refreshed[0]).toMatchObject({
      status: "connected",
      wizard: false,
    });
    expect(ports.rows.get(`${ALICE}:google`)?.status).toBe("connected");
    expect(ports.secrets.get(`${ALICE}:google`)?.oauth_access).toBe("access-new");
    expect(ports.secrets.get(`${ALICE}:google`)?.oauth_refresh).toBe("refresh-old");
  });

  it("refresh fail: status needs_reauth, wizard, row remains", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "google")],
      refresh: async () => {
        throw new ConnectorRefreshError("invalid_grant");
      },
    });
    const result = await applyConnectorLifecycle(
      {
        kind: "refresh",
        tenant_id: TENANT,
        user_id: ALICE,
        connector_id: "google",
      },
      ports,
    );
    expect(result.wizard).toBe(true);
    expect(result.refreshed[0]).toMatchObject({
      status: "needs_reauth",
      wizard: true,
    });
    expect(ports.rows.get(`${ALICE}:google`)?.status).toBe("needs_reauth");
    expect(ports.secrets.get(`${ALICE}:google`)?.oauth_refresh).toBe("refresh-old");
    expect(ports.deleted).toEqual([]);
  });

  it("clear hubspot pin does not delete tokens", async () => {
    const ports = createFakePorts({
      rows: [publicRow(ALICE, "hubspot")],
    });
    const result = await applyConnectorLifecycle(
      { kind: "clear_hubspot_pin", tenant_id: TENANT },
      ports,
    );
    expect(result.deleted).toEqual([]);
    expect(ports.rows.size).toBe(1);
    expect(ports.secrets.get(`${ALICE}:hubspot`)?.oauth_refresh).toBe("refresh-old");
  });

  it("user disconnect of a missing row is not found", async () => {
    const ports = createFakePorts({ rows: [] });
    await expect(
      applyConnectorLifecycle(
        {
          kind: "user_disconnect",
          tenant_id: TENANT,
          user_id: ALICE,
          connector_id: "google",
        },
        ports,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("default OAuth provider", () => {
  it("revokes google with the refresh token", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const provider = createDefaultConnectorOauthProvider({
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          method: String(init?.method ?? "GET"),
          body: String(init?.body ?? ""),
        });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await provider.revokeOauth({
      connector_id: "google",
      secrets: oauthSecrets(),
    });
    expect(calls[0]?.url).toContain("oauth2.googleapis.com/revoke");
    expect(calls[0]?.body).toContain("token=refresh-old");
  });

  it("refresh without Google client secrets is not needs_reauth", async () => {
    const provider = createDefaultConnectorOauthProvider({
      googleClientId: "",
      googleClientSecret: "",
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    await expect(
      provider.refreshOauth({
        connector_id: "google",
        secrets: oauthSecrets(),
      }),
    ).rejects.toBeInstanceOf(ConnectorOauthNotConfiguredError);
  });
});
