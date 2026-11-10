import { afterEach, describe, expect, it } from "vitest";

import {
  InMemorySecretStore,
  loadDevSecretsFromEnv,
} from "../src/secret-store.js";

describe("InMemorySecretStore.register (lp-3a1.3)", () => {
  it("registers secrets by gatewayId and instanceId", () => {
    const store = new InMemorySecretStore();
    store.register({
      gatewayId: "gw-1",
      instanceId: "inst-1",
      secrets: ["secret-a"],
      tenantId: "tenant-1",
    });

    const byGw = store.getByGatewayId("gw-1");
    const byInst = store.getByInstanceId("inst-1");
    expect(byGw).toBeDefined();
    expect(byInst).toBe(byGw);
    expect(byGw?.secrets).toEqual(["secret-a"]);
    expect(byGw?.tenantId).toBe("tenant-1");
    expect(byGw?.revoked).toBe(false);
  });

  it("updates secrets for an existing instance (rotate)", () => {
    const store = new InMemorySecretStore();
    store.register({
      gatewayId: "gw-1",
      instanceId: "inst-1",
      secrets: ["old-secret"],
    });
    store.register({
      gatewayId: "gw-1",
      instanceId: "inst-1",
      secrets: ["new-secret", "old-secret"],
    });

    const record = store.getByInstanceId("inst-1");
    expect(record?.secrets).toEqual(["new-secret", "old-secret"]);
    expect(record?.revoked).toBe(false);
  });

  it("clears revoked flag on re-register", () => {
    const store = new InMemorySecretStore();
    store.register({
      gatewayId: "gw-1",
      instanceId: "inst-1",
      secrets: ["s1"],
    });
    expect(store.revoke("inst-1")).toBe(true);
    expect(store.getByInstanceId("inst-1")?.revoked).toBe(true);

    store.register({
      gatewayId: "gw-1",
      instanceId: "inst-1",
      secrets: ["s2"],
    });
    expect(store.getByInstanceId("inst-1")?.revoked).toBe(false);
    expect(store.getByInstanceId("inst-1")?.secrets).toEqual(["s2"]);
  });

  it("supports a second instance without overwriting the first", () => {
    const store = new InMemorySecretStore();
    store.register({
      gatewayId: "inst-a",
      instanceId: "inst-a",
      secrets: ["secret-a"],
    });
    store.register({
      gatewayId: "inst-b",
      instanceId: "inst-b",
      secrets: ["secret-b"],
    });

    expect(store.getByInstanceId("inst-a")?.secrets).toEqual(["secret-a"]);
    expect(store.getByInstanceId("inst-b")?.secrets).toEqual(["secret-b"]);
    expect(store.list()).toHaveLength(2);
  });

  it("drops stale gateway map when instance is re-bound", () => {
    const store = new InMemorySecretStore();
    store.register({
      gatewayId: "old-gw",
      instanceId: "inst-1",
      secrets: ["s1"],
    });
    store.register({
      gatewayId: "new-gw",
      instanceId: "inst-1",
      secrets: ["s2"],
    });

    expect(store.getByGatewayId("old-gw")).toBeUndefined();
    expect(store.getByGatewayId("new-gw")?.instanceId).toBe("inst-1");
    expect(store.getByInstanceId("inst-1")?.gatewayId).toBe("new-gw");
  });

  it("rejects empty secrets", () => {
    const store = new InMemorySecretStore();
    expect(() =>
      store.register({
        gatewayId: "gw",
        instanceId: "inst",
        secrets: [],
      }),
    ).toThrow(/secret/i);
  });
});

describe("loadDevSecretsFromEnv", () => {
  const original = {
    RELAY_DEV_SECRETS: process.env.RELAY_DEV_SECRETS,
    RELAY_GATEWAY_ID: process.env.RELAY_GATEWAY_ID,
    RELAY_GATEWAY_SECRET: process.env.RELAY_GATEWAY_SECRET,
    RELAY_INSTANCE_ID: process.env.RELAY_INSTANCE_ID,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("still seeds solo RELAY_GATEWAY_ID path for lab", () => {
    delete process.env.RELAY_DEV_SECRETS;
    process.env.RELAY_GATEWAY_ID = "solo-gw";
    process.env.RELAY_GATEWAY_SECRET = "solo-secret";
    process.env.RELAY_INSTANCE_ID = "solo-inst";

    const store = loadDevSecretsFromEnv(new InMemorySecretStore());
    expect(store.getByGatewayId("solo-gw")?.secrets).toEqual(["solo-secret"]);
    expect(store.getByInstanceId("solo-inst")?.gatewayId).toBe("solo-gw");
  });

  it("still seeds RELAY_DEV_SECRETS JSON for multi-lab", () => {
    delete process.env.RELAY_GATEWAY_ID;
    delete process.env.RELAY_GATEWAY_SECRET;
    process.env.RELAY_DEV_SECRETS = JSON.stringify([
      {
        gatewayId: "g1",
        instanceId: "i1",
        secret: "s1",
        rotationSecret: "s0",
        tenantId: "t1",
      },
    ]);

    const store = loadDevSecretsFromEnv(new InMemorySecretStore());
    expect(store.getByInstanceId("i1")?.secrets).toEqual(["s1", "s0"]);
    expect(store.getByInstanceId("i1")?.tenantId).toBe("t1");
  });
});
