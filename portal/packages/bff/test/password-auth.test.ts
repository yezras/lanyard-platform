import { describe, expect, it, vi } from "vitest";

import { FakeCognitoPasswordAuth } from "../src/cognito-fake.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { authenticatePassword, registerPassword } from "../src/password-auth.js";
import type { BffBindings, TenantContext } from "../src/types.js";

const tenant: TenantContext = {
  tenant_id: "tenant-1",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

function bindings(overrides: Partial<BffBindings> = {}): BffBindings {
  return {
    tenantResolver: {
      async resolveBySlug() {
        return tenant;
      },
      async resolveById() {
        return tenant;
      },
    },
    authClient: new ControlPlaneAuthClient("http://control-plane.test"),
    cognito: new FakeCognitoPasswordAuth(),
    relayClient: {} as BffBindings["relayClient"],
    chatThreads: {} as BffBindings["chatThreads"],
    sessions: {} as BffBindings["sessions"],
    vaultContentProvider: {} as BffBindings["vaultContentProvider"],
    vaultIndexProvider: {} as BffBindings["vaultIndexProvider"],
    stagingStorageProvider: {} as BffBindings["stagingStorageProvider"],
    settingsSnapshotPath: "/tmp/settings.json",
    config: {
      sessionSecret: "test",
      secureCookies: false,
      googleRedirectPath: "/api/auth/google/callback",
      relayUrl: "http://relay.test",
      relayInternalToken: "token",
      stagingMaxUploadBytes: 1024,
    },
    ...overrides,
  };
}

describe("password-auth without Cognito", () => {
  it("fails closed outside local-dev", async () => {
    const prev = process.env.BFF_ALLOW_LOCAL_PASSWORD;
    delete process.env.BFF_ALLOW_LOCAL_PASSWORD;
    try {
      const b = bindings({ cognito: undefined });
      await expect(
        authenticatePassword(b, tenant, "a@b.c", "password123"),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      if (prev === undefined) {
        delete process.env.BFF_ALLOW_LOCAL_PASSWORD;
      } else {
        process.env.BFF_ALLOW_LOCAL_PASSWORD = prev;
      }
    }
  });
});

describe("password-auth with FakeCognito", () => {
  it("authenticates against Cognito then resolves the portal user by email", async () => {
    const cognito = new FakeCognitoPasswordAuth();
    await cognito.register("dev@demo.local", "password123");
    const getUserByEmail = vi.fn().mockResolvedValue({
      user_id: "user-1",
      email: "dev@demo.local",
      tenant_id: tenant.tenant_id,
    });
    const b = bindings({
      cognito,
      authClient: { getUserByEmail } as BffBindings["authClient"],
    });

    await expect(
      authenticatePassword(b, tenant, "dev@demo.local", "password123"),
    ).resolves.toEqual({
      user_id: "user-1",
      email: "dev@demo.local",
      tenant_id: tenant.tenant_id,
    });
    expect(getUserByEmail).toHaveBeenCalledWith(tenant.tenant_id, "dev@demo.local");
  });

  it("rejects when Cognito succeeds but no portal account exists", async () => {
    const cognito = new FakeCognitoPasswordAuth();
    await cognito.register("ghost@demo.local", "password123");
    const b = bindings({
      cognito,
      authClient: {
        getUserByEmail: vi.fn().mockResolvedValue(null),
      } as unknown as BffBindings["authClient"],
    });

    await expect(
      authenticatePassword(b, tenant, "ghost@demo.local", "password123"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("registers in Cognito then creates the control-plane user", async () => {
    const cognito = new FakeCognitoPasswordAuth();
    const registerUser = vi.fn().mockResolvedValue({
      user_id: "user-2",
      email: "new@demo.local",
      tenant_id: tenant.tenant_id,
    });
    const b = bindings({
      cognito,
      authClient: { registerUser } as BffBindings["authClient"],
    });

    await expect(
      registerPassword(b, tenant, "new@demo.local", "password123"),
    ).resolves.toEqual({
      user_id: "user-2",
      email: "new@demo.local",
      tenant_id: tenant.tenant_id,
    });
    expect(registerUser).toHaveBeenCalledWith({
      tenantId: tenant.tenant_id,
      email: "new@demo.local",
      password: "password123",
    });
    await expect(cognito.authenticate("new@demo.local", "password123")).resolves.toMatchObject({
      email: "new@demo.local",
    });
  });
});
