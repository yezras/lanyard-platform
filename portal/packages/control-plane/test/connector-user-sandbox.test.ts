/**
 * lp-xhf4.6 — user sandbox binding + lazy inject (pure + in-memory guest).
 * Tenant printenv has no connector secrets. Two users do not share disks.
 */
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_GUEST_ENV_KEYS,
  CONNECTOR_GUEST_PATHS,
  TenantSandboxConnectorInjectError,
  assertNoConnectorSecretsOnTenantEnv,
  assertUserSandboxInjectAllowed,
  buildConnectorInjectPlan,
  connectorDurableMaterialValid,
  createInMemoryGuestConnectorStore,
  decideConnectorRestore,
  exportWhatsAppSessionFromGuest,
  injectUserConnector,
  parseUserSandboxTarget,
  shouldProvisionUserSandbox,
  whatsappSyncOutcome,
  CONNECTOR_GUEST_HOME,
} from "../src/connector-user-sandbox.js";
import {
  InvalidConnectorSecretsError,
  parseConnectorSecrets,
  type ConnectorSecrets,
} from "../src/connectors.js";

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ALICE = "user-alice";
const BOB = "user-bob";
const INST_ALICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INST_BOB = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const INST_TENANT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function oauthSecrets(overrides: Partial<ConnectorSecrets> = {}): ConnectorSecrets {
  return {
    oauth_access: "alice-access",
    oauth_refresh: "alice-refresh",
    oauth_expiry: "2099-01-01T00:00:00.000Z",
    oauth_scopes: ["gmail.readonly"],
    whatsapp_session_db: null,
    ...overrides,
  };
}

function waSecrets(session = Buffer.from("alice-session-db").toString("base64")): ConnectorSecrets {
  return {
    oauth_access: null,
    oauth_refresh: null,
    oauth_expiry: null,
    oauth_scopes: [],
    whatsapp_session_db: session,
  };
}

describe("user sandbox provision gating (lp-xhf4.6)", () => {
  it("provisions on first connect or pairing, not on not_connected", () => {
    expect(shouldProvisionUserSandbox("connected")).toBe(true);
    expect(shouldProvisionUserSandbox("pairing")).toBe(true);
    expect(shouldProvisionUserSandbox("not_connected")).toBe(false);
    expect(shouldProvisionUserSandbox("needs_reauth")).toBe(false);
  });
});

describe("inject target types (lp-xhf4.6)", () => {
  it("refuses tenant_sandbox as an inject target", () => {
    expect(() =>
      parseUserSandboxTarget({
        kind: "tenant_sandbox",
        tenant_id: TENANT,
        owner_user_id: ALICE,
        instance_id: INST_TENANT,
        sandbox_id: "sbx-tenant",
      }),
    ).toThrow(TenantSandboxConnectorInjectError);
  });

  it("refuses inject when instance scope is tenant", () => {
    expect(() =>
      assertUserSandboxInjectAllowed({
        scope: "tenant",
        owner_user_id: null,
        target_user_id: ALICE,
      }),
    ).toThrow(TenantSandboxConnectorInjectError);
  });

  it("refuses inject when owner_user_id is a different user", () => {
    expect(() =>
      assertUserSandboxInjectAllowed({
        scope: "user",
        owner_user_id: BOB,
        target_user_id: ALICE,
      }),
    ).toThrow(TenantSandboxConnectorInjectError);
  });
});

describe("inject plan (lp-xhf4.6)", () => {
  const target = parseUserSandboxTarget({
    kind: "user_sandbox",
    tenant_id: TENANT,
    owner_user_id: ALICE,
    instance_id: INST_ALICE,
    sandbox_id: "sbx-alice",
  });

  it("writes google access cache without refresh token", () => {
    const plan = buildConnectorInjectPlan({
      connector_id: "google",
      target,
      secrets: oauthSecrets(),
    });
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]?.path).toBe(CONNECTOR_GUEST_PATHS.google);
    expect(plan.files[0]?.mode).toBe(0o600);
    expect(plan.files[0]?.contents).toContain("alice-access");
    expect(plan.files[0]?.contents).not.toContain("alice-refresh");
    expect(plan.files[0]?.contents).not.toMatch(/refresh/i);
    expect(plan.env).toEqual({
      GOOGLE_WORKSPACE_CLI_TOKEN: "alice-access",
      GWS_ACCESS_TOKEN: "alice-access",
    });
  });

  it("writes only the requested connector", () => {
    const google = buildConnectorInjectPlan({
      connector_id: "google",
      target,
      secrets: {
        ...oauthSecrets(),
        whatsapp_session_db: Buffer.from("wa").toString("base64"),
      },
    });
    expect(google.files.map((f) => f.path)).toEqual([
      CONNECTOR_GUEST_PATHS.google,
    ]);
    expect(google.env).not.toHaveProperty("WACLI_STORE_DIR");
    expect(google.env).not.toHaveProperty("HUBSPOT_ACCESS_TOKEN");
  });

  it("writes whatsapp session.db as base64", () => {
    const session = Buffer.from("whatsmeow-keys").toString("base64");
    const plan = buildConnectorInjectPlan({
      connector_id: "whatsapp",
      target,
      secrets: waSecrets(session),
    });
    expect(plan.files).toEqual([
      {
        path: CONNECTOR_GUEST_PATHS.whatsapp,
        mode: 0o600,
        encoding: "base64",
        contents: session,
      },
    ]);
  });
});

describe("restore decision (lp-xhf4.6)", () => {
  it("skips oauth when refresh is still valid after destroy", () => {
    const decision = decideConnectorRestore({
      connector_id: "google",
      sandbox_destroyed: true,
      guest_has_material: false,
      secrets: oauthSecrets({ oauth_access: null }),
    });
    expect(decision).toEqual({
      action: "restore_from_cp",
      reason: "sandbox_destroyed",
      skip_oauth: true,
    });
  });

  it("skips new QR when whatsapp session.db is still on CP", () => {
    const decision = decideConnectorRestore({
      connector_id: "whatsapp",
      sandbox_destroyed: true,
      guest_has_material: false,
      secrets: waSecrets(),
    });
    expect(decision.skip_oauth).toBe(true);
    expect(decision.action).toBe("restore_from_cp");
  });

  it("needs reauth when refresh and session are gone", () => {
    expect(
      decideConnectorRestore({
        connector_id: "google",
        sandbox_destroyed: true,
        guest_has_material: false,
        secrets: oauthSecrets({ oauth_access: null, oauth_refresh: null }),
      }).action,
    ).toBe("needs_reauth");
    expect(
      decideConnectorRestore({
        connector_id: "whatsapp",
        sandbox_destroyed: true,
        guest_has_material: false,
        secrets: waSecrets(""),
      }).reason,
    ).toBe("session_invalid");
  });

  it("no-ops when this wake already hydrated the connector", () => {
    expect(
      decideConnectorRestore({
        connector_id: "hubspot",
        sandbox_destroyed: false,
        guest_has_material: true,
        secrets: oauthSecrets(),
      }),
    ).toEqual({
      action: "noop",
      reason: "already_hydrated",
      skip_oauth: true,
    });
  });

  it("treats unexpired access as durable even without a refresh", () => {
    expect(
      connectorDurableMaterialValid(
        "google",
        oauthSecrets({ oauth_refresh: null }),
      ),
    ).toBe(true);
  });
});

describe("two-user isolation + tenant printenv (lp-xhf4.6)", () => {
  it("injects Alice and Bob onto distinct disks; tenant env stays clean", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const aliceSecrets = oauthSecrets({ oauth_access: "tok-alice" });
    const bobSecrets = oauthSecrets({
      oauth_access: "tok-bob",
      oauth_refresh: "bob-refresh",
    });
    const instances = new Map([
      [
        INST_ALICE,
        {
          instance_id: INST_ALICE,
          tenant_id: TENANT,
          sandbox_id: "sbx-alice",
          scope: "user" as const,
          owner_user_id: ALICE,
        },
      ],
      [
        INST_BOB,
        {
          instance_id: INST_BOB,
          tenant_id: TENANT,
          sandbox_id: "sbx-bob",
          scope: "user" as const,
          owner_user_id: BOB,
        },
      ],
      [
        INST_TENANT,
        {
          instance_id: INST_TENANT,
          tenant_id: TENANT,
          sandbox_id: "sbx-tenant",
          scope: "tenant" as const,
          owner_user_id: null,
        },
      ],
    ]);
    const secrets = new Map<string, ConnectorSecrets>([
      [`${ALICE}:google`, aliceSecrets],
      [`${BOB}:google`, bobSecrets],
    ]);

    const portsFor = (userId: string, instanceId: string) => ({
      ensureBinding: async () => ({
        tenant_id: TENANT,
        owner_user_id: userId,
        instance_id: instanceId,
        scope: "user" as const,
      }),
      getInstance: async (id: string) => instances.get(id) ?? null,
      getSecrets: async (_t: string, uid: string, cid: string) => {
        const row = secrets.get(`${uid}:${cid}`);
        if (!row) throw new Error("missing secrets");
        return row;
      },
      guest,
    });

    const alice = await injectUserConnector({
      tenant_id: TENANT,
      user_id: ALICE,
      connector_id: "google",
      ports: portsFor(ALICE, INST_ALICE),
    });
    const bob = await injectUserConnector({
      tenant_id: TENANT,
      user_id: BOB,
      connector_id: "google",
      ports: portsFor(BOB, INST_BOB),
    });

    expect(alice.injected).toBe(true);
    expect(bob.injected).toBe(true);
    expect(alice.sandbox_id).not.toBe(bob.sandbox_id);
    expect(guest.printenv("sbx-alice").GOOGLE_WORKSPACE_CLI_TOKEN).toBe(
      "tok-alice",
    );
    expect(guest.printenv("sbx-bob").GOOGLE_WORKSPACE_CLI_TOKEN).toBe("tok-bob");
    expect(guest.printenv("sbx-alice").GWS_ACCESS_TOKEN).toBe("tok-alice");
    expect(guest.printenv("sbx-bob").GWS_ACCESS_TOKEN).toBe("tok-bob");
    expect(guest.printenv("sbx-alice").GOOGLE_WORKSPACE_CLI_TOKEN).not.toBe(
      guest.printenv("sbx-bob").GOOGLE_WORKSPACE_CLI_TOKEN,
    );

    const tenantCreateEnv = {
      VAULT_ROOT: "/mnt/vault",
      GATEWAY_RELAY_URL: "wss://relay.example",
    };
    assertNoConnectorSecretsOnTenantEnv(tenantCreateEnv);
    assertNoConnectorSecretsOnTenantEnv(guest.printenv("sbx-tenant"));
    expect(guest.listFiles("sbx-tenant")).toEqual([]);
    for (const key of CONNECTOR_GUEST_ENV_KEYS) {
      expect(tenantCreateEnv).not.toHaveProperty(key);
    }
    expect(() =>
      assertNoConnectorSecretsOnTenantEnv({
        GOOGLE_WORKSPACE_CLI_TOKEN: "must-not-land-on-create",
      }),
    ).toThrow(TenantSandboxConnectorInjectError);

    await expect(
      injectUserConnector({
        tenant_id: TENANT,
        user_id: ALICE,
        connector_id: "google",
        ports: {
          ...portsFor(ALICE, INST_TENANT),
          ensureBinding: async () => ({
            tenant_id: TENANT,
            owner_user_id: ALICE,
            instance_id: INST_TENANT,
            scope: "user",
          }),
        },
      }),
    ).rejects.toBeInstanceOf(TenantSandboxConnectorInjectError);
  });

  it("does not inject unused connectors on the same wake", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const target = parseUserSandboxTarget({
      kind: "user_sandbox",
      tenant_id: TENANT,
      owner_user_id: ALICE,
      instance_id: INST_ALICE,
      sandbox_id: "sbx-alice",
    });
    await guest.write(
      buildConnectorInjectPlan({
        connector_id: "google",
        target,
        secrets: oauthSecrets(),
      }),
    );
    expect(guest.hasConnector("sbx-alice", "google")).toBe(true);
    expect(guest.hasConnector("sbx-alice", "whatsapp")).toBe(false);
    expect(guest.listFiles("sbx-alice")).toEqual([CONNECTOR_GUEST_PATHS.google]);
    expect(guest.printenv("sbx-alice")).not.toHaveProperty("WACLI_STORE_DIR");
  });

  it("restores whatsapp session.db from CP after destroy without new oauth", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const session = Buffer.from("durable-session").toString("base64");
    const instance = {
      instance_id: INST_ALICE,
      tenant_id: TENANT,
      sandbox_id: "sbx-alice-1",
      scope: "user" as const,
      owner_user_id: ALICE,
    };
    const ports = {
      ensureBinding: async () => ({
        tenant_id: TENANT,
        owner_user_id: ALICE,
        instance_id: INST_ALICE,
        scope: "user" as const,
      }),
      getInstance: async () => instance,
      getSecrets: async () => waSecrets(session),
      guest,
    };

    const first = await injectUserConnector({
      tenant_id: TENANT,
      user_id: ALICE,
      connector_id: "whatsapp",
      ports,
    });
    expect(first.injected).toBe(true);
    expect(guest.read("sbx-alice-1")?.files.get(CONNECTOR_GUEST_PATHS.whatsapp)?.contents).toBe(
      session,
    );

    await guest.wipe("sbx-alice-1");
    instance.sandbox_id = "sbx-alice-2";

    const restored = await injectUserConnector({
      tenant_id: TENANT,
      user_id: ALICE,
      connector_id: "whatsapp",
      sandbox_destroyed: true,
      ports,
    });
    expect(restored.injected).toBe(true);
    expect(restored.skip_oauth).toBe(true);
    expect(restored.sandbox_id).toBe("sbx-alice-2");
    expect(
      guest.read("sbx-alice-2")?.files.get(CONNECTOR_GUEST_PATHS.whatsapp)?.contents,
    ).toBe(session);
    expect(guest.read("sbx-alice-1")).toBeNull();
    expect(restored.post_commands).toEqual([
      {
        argv: ["wacli", "sync"],
        env: { WACLI_STORE_DIR: `${CONNECTOR_GUEST_HOME}/wacli` },
      },
    ]);
    expect(restored.files).toEqual([CONNECTOR_GUEST_PATHS.whatsapp]);
    expect(restored.files.some((path) => path.endsWith("wacli.db"))).toBe(
      false,
    );
    expect(
      exportWhatsAppSessionFromGuest(guest, "sbx-alice-2"),
    ).toEqual({
      filename: "session.db",
      contents_base64: session,
    });
  });

  it("refuses to export wacli.db from the guest", async () => {
    const guest = createInMemoryGuestConnectorStore();
    await guest.write({
      connector_id: "whatsapp",
      target: {
        kind: "user_sandbox",
        tenant_id: TENANT,
        owner_user_id: ALICE,
        instance_id: INST_ALICE,
        sandbox_id: "sbx-alice",
      },
      files: [
        {
          path: `${CONNECTOR_GUEST_HOME}/wacli/wacli.db`,
          mode: 0o600,
          encoding: "base64",
          contents: Buffer.from("messages").toString("base64"),
        },
      ],
      env: {},
    });
    expect(() => exportWhatsAppSessionFromGuest(guest, "sbx-alice")).toThrow(
      /wacli\.db/,
    );
  });

  it("maps unlinked wacli sync to needs_reauth", () => {
    expect(
      whatsappSyncOutcome({
        exit_code: 1,
        stderr: "Not authenticated. Run `wacli auth`.",
      }),
    ).toBe("needs_reauth");
    expect(
      whatsappSyncOutcome({ exit_code: 0, stderr: "" }),
    ).toBe("ok");
  });

  it("rejects wacli.db on CP secrets payloads", () => {
    expect(() =>
      parseConnectorSecrets({
        whatsapp_session_db: Buffer.from("ok").toString("base64"),
        "wacli.db": Buffer.from("messages").toString("base64"),
      }),
    ).toThrow(InvalidConnectorSecretsError);
  });

  it("returns sandbox_not_online without writing files (connect does not wake)", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const result = await injectUserConnector({
      tenant_id: TENANT,
      user_id: ALICE,
      connector_id: "google",
      ports: {
        ensureBinding: async () => ({
          tenant_id: TENANT,
          owner_user_id: ALICE,
          instance_id: INST_ALICE,
          scope: "user",
        }),
        getInstance: async () => ({
          instance_id: INST_ALICE,
          tenant_id: TENANT,
          sandbox_id: null,
          scope: "user",
          owner_user_id: ALICE,
        }),
        getSecrets: async () => oauthSecrets(),
        guest,
      },
    });
    expect(result).toMatchObject({
      injected: false,
      reason: "sandbox_not_online",
      sandbox_id: null,
    });
    expect(guest.sandboxCount()).toBe(0);
  });

  it("wipeConnector drops only that connector's guest cache", async () => {
    const guest = createInMemoryGuestConnectorStore();
    const target = {
      kind: "user_sandbox" as const,
      tenant_id: TENANT,
      owner_user_id: ALICE,
      instance_id: INST_ALICE,
      sandbox_id: "sbx-alice",
    };
    await guest.write(
      buildConnectorInjectPlan({
        connector_id: "google",
        target,
        secrets: oauthSecrets(),
      }),
    );
    await guest.write(
      buildConnectorInjectPlan({
        connector_id: "whatsapp",
        target,
        secrets: waSecrets(),
      }),
    );
    await guest.wipeConnector("sbx-alice", "google");
    expect(guest.hasConnector("sbx-alice", "google")).toBe(false);
    expect(guest.hasConnector("sbx-alice", "whatsapp")).toBe(true);
    expect(guest.printenv("sbx-alice").GWS_ACCESS_TOKEN).toBeUndefined();
    expect(guest.printenv("sbx-alice").WACLI_STORE_DIR).toBeTruthy();
  });
});
