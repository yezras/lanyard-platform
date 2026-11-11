import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("control-plane tenant member directory", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantAId = "";
  let tenantBId = "";
  let userA1Id = "";
  let userA2Id = "";
  let userBId = "";

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });

    const tenantA = await store.createTenant({
      slug: "alpha-dir",
      display_name: "Alpha Dir",
    });
    tenantAId = tenantA.tenant_id;

    const tenantB = await store.createTenant({
      slug: "beta-dir",
      display_name: "Beta Dir",
    });
    tenantBId = tenantB.tenant_id;

    const a1 = await store.registerUser({
      tenant_id: tenantAId,
      email: "alice@alpha.test",
      password: "password123",
    });
    userA1Id = a1.user_id;

    const a2 = await store.registerUser({
      tenant_id: tenantAId,
      email: "bob@alpha.test",
      password: "password123",
    });
    userA2Id = a2.user_id;

    const b1 = await store.registerUser({
      tenant_id: tenantBId,
      email: "carol@beta.test",
      password: "password123",
    });
    userBId = b1.user_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("lists same-tenant users with safe fields only", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantAId}/users`,
    );
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantAId);

    const members = res.body.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.email).sort()).toEqual([
      "alice@alpha.test",
      "bob@alpha.test",
    ]);
    expect(members.map((m) => m.user_id).sort()).toEqual(
      [userA1Id, userA2Id].sort(),
    );

    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual(["email", "user_id"]);
      expect(member).not.toHaveProperty("password_hash");
      expect(member).not.toHaveProperty("password_salt");
      expect(member).not.toHaveProperty("google_sub");
    }
  });

  it("never includes users from another tenant", async () => {
    const listA = await jsonRequest(
      app,
      `/internal/tenants/${tenantAId}/users`,
    );
    const listB = await jsonRequest(
      app,
      `/internal/tenants/${tenantBId}/users`,
    );

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);

    const membersA = listA.body.members as Array<{ user_id: string; email: string }>;
    const membersB = listB.body.members as Array<{ user_id: string; email: string }>;

    expect(membersA.map((m) => m.user_id)).not.toContain(userBId);
    expect(membersA.every((m) => m.email.endsWith("@alpha.test"))).toBe(true);

    expect(membersB).toHaveLength(1);
    expect(membersB[0]?.user_id).toBe(userBId);
    expect(membersB[0]?.email).toBe("carol@beta.test");
    expect(membersB.map((m) => m.user_id)).not.toContain(userA1Id);
    expect(membersB.map((m) => m.user_id)).not.toContain(userA2Id);
  });

  it("filters members by optional q email substring", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantAId}/users?q=bob`,
    );
    expect(res.status).toBe(200);
    const members = res.body.members as Array<{ email: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("bob@alpha.test");
  });

  it("returns 404 for unknown tenant", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/00000000-0000-4000-8000-000000000000/users`,
    );
    expect(res.status).toBe(404);
  });
});
