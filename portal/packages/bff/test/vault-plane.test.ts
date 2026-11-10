/**
 * lp-oop.11 — VaultPlane flag wiring (default unchanged; cp_s3 tree
 * does not call ensureOnline).
 */
import { describe, expect, it, vi } from "vitest";

import { FakeBackendRuntimeService } from "@lanyard/backend-runtime";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
import { buildS3VaultPrefix } from "../../control-plane/src/vault-prefix.js";
import { createApp } from "../src/app.js";
import {
  DEFAULT_VAULT_PLANE,
  loadConfig,
  parseVaultPlane,
  resolveVaultPlane,
} from "../src/config.js";
import { SessionStore } from "../src/session.js";
import {
  createCpS3VaultContentProvider,
} from "../src/vault/cp-s3-provider.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT_ID);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");
const CP_BASE = "http://control-plane.test";
const SERVICE_TOKEN = "test-cp-service-token";

const tenant: TenantContext = {
  tenant_id: TENANT_ID,
  tenant_slug: "vault-plane",
  display_name: "Vault Plane",
  host: "vault-plane.withlanyard.com",
};
const userId = "user-vault-plane";

describe("VAULT_PLANE flag (lp-oop.11)", () => {
  it("defaults to today's path when unset", () => {
    expect(DEFAULT_VAULT_PLANE).toBe("fs");
    expect(parseVaultPlane(undefined)).toBeUndefined();
    expect(parseVaultPlane("")).toBeUndefined();
    expect(parseVaultPlane("   ")).toBeUndefined();
    expect(resolveVaultPlane(undefined, false)).toBe("fs");
    expect(resolveVaultPlane(undefined, true)).toBe("brain_rpc");
    expect(loadConfig({ CONTROL_PLANE_URL: "http://cp.test" }).vaultPlane).toBe(
      "fs",
    );
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        BRAIN_RPC_ENABLED: "1",
      }).vaultPlane,
    ).toBe("brain_rpc");
  });

  it("accepts fs, brain_rpc, and cp_s3 (case-insensitive)", () => {
    expect(parseVaultPlane("fs")).toBe("fs");
    expect(parseVaultPlane("FS")).toBe("fs");
    expect(parseVaultPlane(" brain_rpc ")).toBe("brain_rpc");
    expect(parseVaultPlane("BRAIN_RPC")).toBe("brain_rpc");
    expect(parseVaultPlane("cp_s3")).toBe("cp_s3");
    expect(parseVaultPlane("CP_S3")).toBe("cp_s3");
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "cp_s3",
      }).vaultPlane,
    ).toBe("cp_s3");
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "fs",
        BRAIN_RPC_ENABLED: "1",
      }).vaultPlane,
    ).toBe("fs");
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "brain_rpc",
      }).vaultPlane,
    ).toBe("brain_rpc");
  });

  it("fail-closes unknown values to today's implicit plane", () => {
    expect(parseVaultPlane("typo")).toBeUndefined();
    expect(parseVaultPlane("s3")).toBeUndefined();
    expect(parseVaultPlane("true")).toBeUndefined();
    expect(resolveVaultPlane("typo", false)).toBe("fs");
    expect(resolveVaultPlane("typo", true)).toBe("brain_rpc");
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "typo",
      }).vaultPlane,
    ).toBe("fs");
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "typo",
        BRAIN_RPC_ENABLED: "1",
      }).vaultPlane,
    ).toBe("brain_rpc");
  });

  it("lets explicit cp_s3 win over BRAIN_RPC_ENABLED", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        VAULT_PLANE: "cp_s3",
        BRAIN_RPC_ENABLED: "1",
      }).vaultPlane,
    ).toBe("cp_s3");
  });
});

function mockStore(): ControlPlaneStore {
  return {} as unknown as ControlPlaneStore;
}

async function bootCpS3TreeRoute() {
  const store = new FakeS3ObjectStore({ now: FIXED_NOW });
  store.seed(BUCKET, `${PREFIX}AGENTS.md`, "# tenant A\n", "text/markdown");
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Alpha/readme.md`,
    "hello alpha\n",
    "text/markdown",
  );
  const cpEnsureOnline = vi.fn(async () => {
    throw new Error("CP ensureOnline must not run on VaultPlane=cp_s3 tree");
  });
  const cpApp = createControlPlaneApp(mockStore(), {
    devOpen: true,
    vaultObjectStore: store,
    vaultBucket: BUCKET,
    instanceOrchestrator: {
      ensureOnline: cpEnsureOnline,
      stop: vi.fn(),
    },
  });
  const requestFn = (input: string, init?: RequestInit) => {
    const url = new URL(String(input), CP_BASE);
    return cpApp.request(url.pathname + url.search, init);
  };

  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "vault-plane@example.com",
  });
  const bffEnsureOnline = vi.fn(async () => {
    throw new Error("BFF ensureOnline must not run on VaultPlane=cp_s3 tree");
  });
  const getPrimaryGatewayInstance = vi.fn(async () => {
    throw new Error(
      "instance lookup must not run on VaultPlane=cp_s3 GET /api/vault/tree",
    );
  });
  const invokeBrainRpc = vi.fn(async () => {
    throw new Error("Brain RPC must not run on VaultPlane=cp_s3 tree");
  });
  const createCpS3VaultProvider = vi.fn((tenantId: string) =>
    createCpS3VaultContentProvider({
      tenantId,
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    }),
  );

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        vaultPlane: "cp_s3",
        brainRpcEnabled: true,
        ensureOnlineOnBrainRpc: true,
        createCpS3VaultProvider,
        authClient: {
          getUserRbac: async () => ({
            user_id: userId,
            tenant_id: tenant.tenant_id,
            hermes_profile: "default",
            allowed_path_prefixes: ["/"],
            role_names: ["member"],
          }),
          getPrimaryGatewayInstance,
          ensureOnline: bffEnsureOnline,
          listProjects: async () => [
            {
              project_id: "proj-alpha",
              tenant_id: tenant.tenant_id,
              parent_project_id: null,
              name: "Alpha",
              vault_path: "/Projects/Alpha",
              created_at: "2026-08-18T00:00:00.000Z",
              updated_at: "2026-08-18T00:00:00.000Z",
            },
          ],
        } as never,
        relayClient: {
          invokeBrainRpc,
        } as never,
      },
    ),
  );

  return {
    app,
    cookies: { lanyard_session: session.sessionId },
    cpEnsureOnline,
    bffEnsureOnline,
    getPrimaryGatewayInstance,
    invokeBrainRpc,
    createCpS3VaultProvider,
  };
}

describe("GET /api/vault/tree VaultPlane=cp_s3 (lp-oop.11)", () => {
  it("lists CP S3 without calling ensureOnline or Brain RPC", async () => {
    const ctx = await bootCpS3TreeRoute();
    const res = await ctx.app.request("/api/vault/tree", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ path: string; kind: string }>;
      source?: string;
    };
    expect(body.source).not.toBe("brain_rpc");
    expect(body.roots.map((n) => n.path)).toEqual(["/Projects", "/AGENTS.md"]);
    expect(ctx.createCpS3VaultProvider).toHaveBeenCalledWith(tenant.tenant_id);
    expect(ctx.cpEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.bffEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.getPrimaryGatewayInstance).not.toHaveBeenCalled();
    expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("lists Directory from CP projects without Brain RPC or ensureOnline", async () => {
    const ctx = await bootCpS3TreeRoute();
    const res = await ctx.app.request("/api/agent/projects", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: Array<{ id: string; name: string; primary_path: string | null }>;
    };
    expect(body.projects).toEqual([
      {
        id: "proj-alpha",
        slug: "proj-alpha",
        name: "Alpha",
        primary_path: "/Projects/Alpha",
        folders: [{ path: "/Projects/Alpha", is_primary: true }],
      },
    ]);
    expect(ctx.cpEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.bffEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.getPrimaryGatewayInstance).not.toHaveBeenCalled();
    expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("GET /api/settings/snapshot on cp_s3 skips Brain RPC and ensureOnline", async () => {
    const ctx = await bootCpS3TreeRoute();
    const res = await ctx.app.request("/api/settings/snapshot", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source?: string;
      skills?: unknown[];
      crons?: unknown[];
    };
    // Honesty: fixture/discover source, not leftover fixture-as-host / Brain RPC.
    expect(body.source).toBe("fixture");
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.crons)).toBe(true);
    expect(ctx.cpEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.bffEnsureOnline).not.toHaveBeenCalled();
    expect(ctx.getPrimaryGatewayInstance).not.toHaveBeenCalled();
    expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("default plane still uses the local fixture tree (no factory)", async () => {
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "vault-plane-default@example.com",
    });
    const ensureOnline = vi.fn(async () => {
      throw new Error("ensureOnline must not run on default vault plane");
    });
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "profile-a",
              allowed_path_prefixes: ["/Projects/A"],
              role_names: ["member"],
            }),
            ensureOnline,
          } as never,
        },
      ),
    );
    const res = await app.request("/api/vault/tree", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader({ lanyard_session: session.sessionId }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ path: string }>;
      source?: string;
    };
    expect(body.source).not.toBe("brain_rpc");
    expect(body.roots.map((n) => n.path)).toEqual(["/Projects/A"]);
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("implicit default with BRAIN_RPC still uses Brain RPC vault handlers", async () => {
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "vault-plane-brain@example.com",
    });
    const ensureOnline = vi.fn(async () => ({
      instance_id: "inst-vault-plane",
      tenant_id: tenant.tenant_id,
      presence: "online" as const,
      sandbox_id: "sbx-vault-plane",
      runtime_kind: "daytona" as const,
      already_online: true,
    }));
    const backend = new FakeBackendRuntimeService({
      files: [
        {
          path: "/Projects/Legal/memo.md",
          content: "host memo",
          mime_type: "text/markdown",
        },
      ],
    });
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          brainRpcEnabled: true,
          backendRuntimeService: backend,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "contributor",
              allowed_path_prefixes: ["/Projects/Legal"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-vault-plane",
            }),
            ensureOnline,
          } as never,
        },
      ),
    );
    const res = await app.request("/api/vault/tree", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader({ lanyard_session: session.sessionId }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ path: string }>;
      source?: string;
    };
    expect(body.source).toBe("brain_rpc");
    expect(body.roots.map((n) => n.path)).toEqual(["/Projects/Legal"]);
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("GET /api/context exposes vault_plane + chat_delivery for honesty (lp-oop.37.8)", async () => {
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          vaultPlane: "cp_s3",
          chatDelivery: "harness",
        },
      ),
    );
    const res = await app.request("/api/context", {
      headers: { host: tenant.host },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vault_plane?: string;
      chat_delivery?: string;
    };
    expect(body.vault_plane).toBe("cp_s3");
    expect(body.chat_delivery).toBe("harness");
  });
});

