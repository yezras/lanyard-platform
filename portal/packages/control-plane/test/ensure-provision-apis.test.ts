/**
 * lp-zoh.3 / plan 0010 — idempotent ensure-provision APIs (Fake store).
 *
 * POST /tenants/:id/instances/ensure-tenant-primary
 * POST /internal/tenants/:tenantId/users/:userId/instances/ensure-user
 *
 * Acceptance:
 *   - first call created:true; second call returns SAME instance_id with
 *     created:false WITHOUT provisioning again (spy)
 *   - prefixes assigned; presence offline; sandbox_id null
 *   - user ensure passes owner_user_id through
 *   - unknown tenant / user → 404; invalid body → 400
 *
 * DB behavior lives in ensure-provision-apis.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { UserNotFoundError } from "../src/rbac.js";
import { TenantNotFoundError } from "../src/store.js";
import type { ControlPlaneStore } from "../src/store.js";
import type {
  EnsuredInstance,
  EnsuredUserInstance,
} from "../src/types.js";

type JsonBody = Record<string, unknown>;

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const USER = "user-ada";
const INSTANCE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function tenantFixture(overrides: Partial<EnsuredInstance> = {}): EnsuredInstance {
  return {
    instance_id: INSTANCE,
    tenant_id: TENANT,
    runtime_kind: "daytona",
    agent_snapshot_id: "snap-agent-v1",
    s3_vault_prefix: `tenants/${TENANT}/vault/`,
    s3_shared_vault_prefix: `tenants/${TENANT}/vault/shared/`,
    s3_personal_vault_prefix: null,
    is_primary: true,
    presence: "offline",
    sandbox_id: null,
    scope: "tenant",
    owner_user_id: null,
    created: true,
    ...overrides,
  };
}

function userFixture(
  overrides: Partial<EnsuredUserInstance> = {},
): EnsuredUserInstance {
  return {
    ...tenantFixture({
      instance_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      s3_personal_vault_prefix: `tenants/${TENANT}/users/${USER}/vault/`,
      is_primary: false,
    }),
    scope: "user",
    owner_user_id: USER,
    ...overrides,
  };
}

/**
 * Fake store whose ensure methods model the idempotent contract with a spy on
 * the underlying provision step (pattern: ensure-online-by-user.test.ts mock
 * store cast).
 */
function createFakeStore(input: {
  tenantEnsure?: ControlPlaneStore["ensureTenantPrimaryInstance"];
  userEnsure?: ControlPlaneStore["ensureUserSandboxInstance"];
}): ControlPlaneStore {
  return {
    ensureTenantPrimaryInstance:
      input.tenantEnsure ?? (async () => tenantFixture()),
    ensureUserSandboxInstance:
      input.userEnsure ?? (async () => userFixture()),
  } as unknown as ControlPlaneStore;
}

/** Idempotent tenant-primary fake: provision runs at most once per tenant. */
function idempotentTenantEnsure() {
  const rows = new Map<string, EnsuredInstance>();
  const provision = vi.fn(async (tenantId: string) => {
    const row = tenantFixture({ tenant_id: tenantId });
    rows.set(tenantId, row);
    return row;
  });
  const ensure = vi.fn(async (input: { tenant_id: string }) => {
    if (!rows.has(input.tenant_id)) {
      await provision(input.tenant_id);
      return { ...rows.get(input.tenant_id)!, created: true };
    }
    return { ...rows.get(input.tenant_id)!, created: false };
  });
  return { ensure, provision };
}

async function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return { status: response.status, body: (await response.json()) as JsonBody };
}

describe("POST /tenants/:id/instances/ensure-tenant-primary (lp-zoh.3)", () => {
  let fake: ReturnType<typeof idempotentTenantEnsure>;

  beforeEach(() => {
    fake = idempotentTenantEnsure();
  });

  it("is idempotent: second call returns same instance_id without provisioning again", async () => {
    const app = createApp(createFakeStore({ tenantEnsure: fake.ensure }), {
      devOpen: true,
    });

    const first = await postJson(app, `/tenants/${TENANT}/instances/ensure-tenant-primary`);
    const second = await postJson(app, `/tenants/${TENANT}/instances/ensure-tenant-primary`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(false);
    expect(second.body.instance_id).toBe(first.body.instance_id);
    expect(fake.provision).toHaveBeenCalledTimes(1);
  });

  it("returns prefixes, offline presence, null sandbox, tenant scope", async () => {
    const app = createApp(createFakeStore({ tenantEnsure: fake.ensure }), {
      devOpen: true,
    });
    const { status, body } = await postJson(
      app,
      `/tenants/${TENANT}/instances/ensure-tenant-primary`,
    );

    expect(status).toBe(200);
    expect(body.scope).toBe("tenant");
    expect(body.owner_user_id).toBeNull();
    expect(body.is_primary).toBe(true);
    expect(body.s3_vault_prefix).toBe(`tenants/${TENANT}/vault/`);
    expect(body.s3_shared_vault_prefix).toBe(`tenants/${TENANT}/vault/shared/`);
    expect(body.s3_personal_vault_prefix).toBeNull();
    expect(body.presence).toBe("offline");
    expect(body.sandbox_id).toBeNull();
  });

  it("accepts an empty body (defaults inherit like register)", async () => {
    const app = createApp(createFakeStore({ tenantEnsure: fake.ensure }), {
      devOpen: true,
    });
    const { status } = await postJson(
      app,
      `/tenants/${TENANT}/instances/ensure-tenant-primary`,
    );
    expect(status).toBe(200);
  });

  it("unknown tenant → 404", async () => {
    const app = createApp(
      createFakeStore({
        tenantEnsure: async () =>
          Promise.reject(new TenantNotFoundError(OTHER_TENANT)),
      }),
      { devOpen: true },
    );
    const { status } = await postJson(
      app,
      `/tenants/${OTHER_TENANT}/instances/ensure-tenant-primary`,
    );
    expect(status).toBe(404);
  });

  it("invalid runtime_kind → 400", async () => {
    const app = createApp(createFakeStore({ tenantEnsure: fake.ensure }), {
      devOpen: true,
    });
    const { status } = await postJson(
      app,
      `/tenants/${TENANT}/instances/ensure-tenant-primary`,
      { runtime_kind: "bogus" },
    );
    expect(status).toBe(400);
  });
});

describe("POST /internal/tenants/:tenantId/users/:userId/instances/ensure-user (lp-zoh.3)", () => {
  it("passes owner_user_id through and returns user-scoped shape", async () => {
    const userEnsure = vi.fn(
      async (_input: {
        tenant_id: string;
        owner_user_id: string;
      }): Promise<EnsuredUserInstance> => Promise.resolve(userFixture()),
    );
    const app = createApp(createFakeStore({ userEnsure }), { devOpen: true });

    const { status, body } = await postJson(
      app,
      `/internal/tenants/${TENANT}/users/${USER}/instances/ensure-user`,
    );

    expect(status).toBe(200);
    expect(userEnsure).toHaveBeenCalledTimes(1);
    expect(userEnsure.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: TENANT,
      owner_user_id: USER,
    });
    expect(body.instance_id).toBeTruthy();
    expect(body.scope).toBe("user");
    expect(body.owner_user_id).toBe(USER);
    expect(body.is_primary).toBe(false);
    expect(body.s3_shared_vault_prefix).toBe(`tenants/${TENANT}/vault/shared/`);
    expect(body.s3_personal_vault_prefix).toBe(
      `tenants/${TENANT}/users/${USER}/vault/`,
    );
    expect(body.presence).toBe("offline");
    expect(body.sandbox_id).toBeNull();
  });

  it("is idempotent: second call returns same instance_id without provisioning again", async () => {
    const stored = new Map<string, EnsuredUserInstance>();
    const provision = vi.fn();
    const app = createApp(
      createFakeStore({
        userEnsure: async (input) => {
          if (!stored.has(input.owner_user_id)) {
            await provision();
            stored.set(input.owner_user_id, userFixture());
            return { ...stored.get(input.owner_user_id)!, created: true };
          }
          return { ...stored.get(input.owner_user_id)!, created: false };
        },
      }),
      { devOpen: true },
    );

    const first = await postJson(
      app,
      `/internal/tenants/${TENANT}/users/${USER}/instances/ensure-user`,
    );
    const second = await postJson(
      app,
      `/internal/tenants/${TENANT}/users/${USER}/instances/ensure-user`,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(false);
    expect(second.body.instance_id).toBe(first.body.instance_id);
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("unknown user → 404", async () => {
    const app = createApp(
      createFakeStore({
        userEnsure: async (input) =>
          Promise.reject(new UserNotFoundError(input.owner_user_id)),
      }),
      { devOpen: true },
    );
    const { status } = await postJson(
      app,
      `/internal/tenants/${TENANT}/users/user-missing/instances/ensure-user`,
    );
    expect(status).toBe(404);
  });

  it("unknown tenant → 404", async () => {
    const app = createApp(
      createFakeStore({
        userEnsure: async (input) =>
          Promise.reject(new TenantNotFoundError(input.tenant_id)),
      }),
      { devOpen: true },
    );
    const { status } = await postJson(
      app,
      `/internal/tenants/${OTHER_TENANT}/users/${USER}/instances/ensure-user`,
    );
    expect(status).toBe(404);
  });
});
