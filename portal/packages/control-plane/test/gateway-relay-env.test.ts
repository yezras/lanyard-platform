/**
 * lp-9my / lp-3a1.2 — Gateway Relay env builder + material stores.
 * No Postgres / network / Daytona. Secret values never asserted via logs.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyGatewayRelayEnvToCreateParams,
  buildGatewayRelayEnv,
  createEncryptedFileInstanceSecretMaterialStore,
  createInMemoryInstanceSecretMaterialStore,
  createSecretsManagerInstanceSecretMaterialStore,
  GATEWAY_ENV_RELAY_ID,
  GATEWAY_ENV_RELAY_INSTANCE_ID,
  GATEWAY_ENV_RELAY_SECRET,
  GATEWAY_ENV_RELAY_URL,
  GATEWAY_RELAY_ENV_KEYS,
  GatewayRelayEnvError,
  INSTANCE_SECRET_MATERIAL_KEY_ENV,
  INSTANCE_SECRET_MATERIAL_PATH_ENV,
  INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV,
  isEphemeralInstanceSecretMaterialPath,
  materialFromIssued,
  parseInstanceSecretMaterialKey,
  resolveInstanceSecretMaterialStore,
  summarizeInstanceSecretMaterialStoreForLog,
  type InstanceSecretMaterialSecretsManagerSdk,
} from "../src/gateway-relay-env.js";
import type { CreateSandboxParams } from "../src/daytona-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RELAY_URL = "wss://relay.example.test/relay";
/** Throwaway lab secret — never a production value. */
const THROW_AWAY_SECRET = "test-only-secret-lp9my-not-for-prod";
/** Fixed test AES key (64 hex = 32 bytes) — not a production secret. */
const TEST_MATERIAL_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("buildGatewayRelayEnv (lp-9my / spike-4l5)", () => {
  it("builds parity GATEWAY_RELAY_* map with permanent instance_id", () => {
    const env = buildGatewayRelayEnv({
      instanceId: INSTANCE_ID,
      relayWssUrl: RELAY_URL,
      secret: THROW_AWAY_SECRET,
    });

    expect(env[GATEWAY_ENV_RELAY_URL]).toBe(RELAY_URL);
    expect(env[GATEWAY_ENV_RELAY_ID]).toBe(INSTANCE_ID);
    expect(env[GATEWAY_ENV_RELAY_INSTANCE_ID]).toBe(INSTANCE_ID);
    expect(env[GATEWAY_ENV_RELAY_SECRET]).toBe(THROW_AWAY_SECRET);
    // Both identity keys equal permanent instance_id (never sandbox_id).
    expect(env[GATEWAY_ENV_RELAY_ID]).toBe(env[GATEWAY_ENV_RELAY_INSTANCE_ID]);
    for (const key of GATEWAY_RELAY_ENV_KEYS) {
      expect(env[key]).toBeTruthy();
    }
  });

  it("rejects missing instance_id / url / secret", () => {
    expect(() =>
      buildGatewayRelayEnv({
        instanceId: "",
        relayWssUrl: RELAY_URL,
        secret: THROW_AWAY_SECRET,
      }),
    ).toThrow(GatewayRelayEnvError);

    expect(() =>
      buildGatewayRelayEnv({
        instanceId: INSTANCE_ID,
        relayWssUrl: "  ",
        secret: THROW_AWAY_SECRET,
      }),
    ).toThrow(/relay_wss_url/);

    expect(() =>
      buildGatewayRelayEnv({
        instanceId: INSTANCE_ID,
        relayWssUrl: RELAY_URL,
        secret: "",
      }),
    ).toThrow(/secret is required/);
  });
});

describe("materialFromIssued + InMemoryInstanceSecretMaterialStore", () => {
  it("put/get/delete and overwrite on rotate-like put", async () => {
    const store = createInMemoryInstanceSecretMaterialStore();
    const first = materialFromIssued({
      instance_id: INSTANCE_ID,
      tenant_id: TENANT_ID,
      secret: THROW_AWAY_SECRET,
      relay_wss_url: RELAY_URL,
      relay_tier: "shared",
      issued_at: "2026-08-05T00:00:00.000Z",
    });

    await store.put(first);
    expect(store.size()).toBe(1);
    expect(store.getSecretForTest(INSTANCE_ID)).toBe(THROW_AWAY_SECRET);

    const got = await store.get(INSTANCE_ID);
    expect(got).toEqual(first);
    // get returns a copy
    expect(got).not.toBe(first);

    const rotatedSecret = "test-only-rotated-secret-lp9my";
    await store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: rotatedSecret,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    expect(store.size()).toBe(1);
    expect(store.getSecretForTest(INSTANCE_ID)).toBe(rotatedSecret);

    await store.delete(INSTANCE_ID);
    expect(await store.get(INSTANCE_ID)).toBeNull();
    expect(store.size()).toBe(0);
  });
});

describe("applyGatewayRelayEnvToCreateParams", () => {
  it("merges relay env without dropping existing vault env", () => {
    const base: CreateSandboxParams = {
      snapshotId: "snap-1",
      env: { VAULT_ROOT: "/mnt/vault", OTHER: "x" },
    };
    const relayEnv = buildGatewayRelayEnv({
      instanceId: INSTANCE_ID,
      relayWssUrl: RELAY_URL,
      secret: THROW_AWAY_SECRET,
    });
    const merged = applyGatewayRelayEnvToCreateParams(base, relayEnv);

    expect(merged.env?.VAULT_ROOT).toBe("/mnt/vault");
    expect(merged.env?.OTHER).toBe("x");
    expect(merged.env?.[GATEWAY_ENV_RELAY_SECRET]).toBe(THROW_AWAY_SECRET);
    expect(merged.env?.[GATEWAY_ENV_RELAY_INSTANCE_ID]).toBe(INSTANCE_ID);
  });
});

describe("encrypted file material store (lp-3a1.2)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function tempStorePath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "lp-3a1.2-material-"));
    tempDirs.push(dir);
    return join(dir, "instance-secrets.enc.json");
  }

  it("parseInstanceSecretMaterialKey accepts hex and passphrase", () => {
    const fromHex = parseInstanceSecretMaterialKey(TEST_MATERIAL_KEY);
    expect(fromHex).toHaveLength(32);

    const fromPass = parseInstanceSecretMaterialKey(
      "lab-only-passphrase-16+",
    );
    expect(fromPass).toHaveLength(32);
    // Same passphrase → same key
    expect(
      parseInstanceSecretMaterialKey("lab-only-passphrase-16+").equals(
        fromPass,
      ),
    ).toBe(true);

    expect(() => parseInstanceSecretMaterialKey("short")).toThrow(
      GatewayRelayEnvError,
    );
  });

  it("put/get/delete round-trip; ciphertext has no plaintext secret", async () => {
    const path = await tempStorePath();
    const store = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: TEST_MATERIAL_KEY,
    });
    const material = materialFromIssued({
      instance_id: INSTANCE_ID,
      tenant_id: TENANT_ID,
      secret: THROW_AWAY_SECRET,
      relay_wss_url: RELAY_URL,
      relay_tier: "shared",
      issued_at: "2026-08-05T00:00:00.000Z",
    });

    await store.put(material);
    const got = await store.get(INSTANCE_ID);
    expect(got).toEqual(material);
    expect(got).not.toBe(material);

    const onDisk = await readFile(path, "utf8");
    expect(onDisk).not.toContain(THROW_AWAY_SECRET);
    expect(onDisk).not.toContain(INSTANCE_ID); // identity is inside ciphertext
    const envelope = JSON.parse(onDisk) as {
      v: number;
      alg: string;
      iv: string;
      tag: string;
      ct: string;
    };
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe("aes-256-gcm");
    expect(envelope.iv).toBeTruthy();
    expect(envelope.tag).toBeTruthy();
    expect(envelope.ct).toBeTruthy();

    await store.delete(INSTANCE_ID);
    expect(await store.get(INSTANCE_ID)).toBeNull();
  });

  it("survives process replacement (new store handle, same path+key)", async () => {
    const path = await tempStorePath();
    const first = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: TEST_MATERIAL_KEY,
    });
    await first.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );

    // Simulate CP task replacement: drop first handle, open a new store.
    const afterRedeploy = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: TEST_MATERIAL_KEY,
    });
    const got = await afterRedeploy.get(INSTANCE_ID);
    expect(got?.secret).toBe(THROW_AWAY_SECRET);
    expect(got?.instance_id).toBe(INSTANCE_ID);
    expect(got?.relay_wss_url).toBe(RELAY_URL);
  });

  it("overwrite on rotate-like put keeps single latest secret", async () => {
    const path = await tempStorePath();
    const store = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: TEST_MATERIAL_KEY,
    });
    await store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    const rotated = "test-only-rotated-secret-lp3a12";
    await store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: rotated,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    expect((await store.get(INSTANCE_ID))?.secret).toBe(rotated);
    const onDisk = await readFile(path, "utf8");
    expect(onDisk).not.toContain(rotated);
    expect(onDisk).not.toContain(THROW_AWAY_SECRET);
  });

  it("wrong key fails closed on get", async () => {
    const path = await tempStorePath();
    const writer = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: TEST_MATERIAL_KEY,
    });
    await writer.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    const otherKey =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const reader = createEncryptedFileInstanceSecretMaterialStore({
      path,
      key: otherKey,
    });
    await expect(reader.get(INSTANCE_ID)).rejects.toThrow(GatewayRelayEnvError);
  });
});

describe("resolveInstanceSecretMaterialStore (lp-3a1.2)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults to in-memory when durable env unset", () => {
    const resolved = resolveInstanceSecretMaterialStore({});
    expect(resolved.kind).toBe("memory");
    expect(resolved.path).toBeUndefined();
  });

  it("selects encrypted_file when PATH and KEY are both set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lp-3a1.2-resolve-"));
    tempDirs.push(dir);
    const path = join(dir, "mat.enc");
    const resolved = resolveInstanceSecretMaterialStore({
      [INSTANCE_SECRET_MATERIAL_PATH_ENV]: path,
      [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
    });
    expect(resolved.kind).toBe("encrypted_file");
    expect(resolved.path).toBe(path);

    await resolved.store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    // Second resolve = redeploy
    const again = resolveInstanceSecretMaterialStore({
      [INSTANCE_SECRET_MATERIAL_PATH_ENV]: path,
      [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
    });
    expect((await again.store.get(INSTANCE_ID))?.secret).toBe(
      THROW_AWAY_SECRET,
    );
  });

  it("fails closed on partial durable env", () => {
    expect(() =>
      resolveInstanceSecretMaterialStore({
        [INSTANCE_SECRET_MATERIAL_PATH_ENV]: "/tmp/only-path",
      }),
    ).toThrow(/both be set/);
    expect(() =>
      resolveInstanceSecretMaterialStore({
        [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
      }),
    ).toThrow(/both be set/);
  });

  it("marks /tmp file paths ephemeral (Fargate wipe)", () => {
    expect(
      isEphemeralInstanceSecretMaterialPath(
        "/tmp/control-plane/instance-secret-material.bin",
      ),
    ).toBe(true);
    expect(isEphemeralInstanceSecretMaterialPath("/var/tmp/x")).toBe(true);
    expect(
      isEphemeralInstanceSecretMaterialPath("/mnt/durable/instance-secrets.enc"),
    ).toBe(false);

    const resolved = resolveInstanceSecretMaterialStore({
      [INSTANCE_SECRET_MATERIAL_PATH_ENV]:
        "/tmp/control-plane/instance-secret-material.bin",
      [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
    });
    expect(resolved.kind).toBe("encrypted_file");
    expect(resolved.ephemeralPath).toBe(true);
    expect(summarizeInstanceSecretMaterialStoreForLog(resolved)).toEqual({
      kind: "encrypted_file",
      path_configured: true,
      path_ephemeral: true,
      sm_configured: false,
    });
  });
});

describe("secrets manager material store catalog (lp-oop.37.6)", () => {
  it("adds @aws-sdk/client-secrets-manager to CP only — not BFF", () => {
    const cpPkg = JSON.parse(
      readFileSync(join(__dirname, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const bffPkg = JSON.parse(
      readFileSync(join(__dirname, "../../bff/package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(cpPkg.dependencies?.["@aws-sdk/client-secrets-manager"]).toMatch(
      /^\^3\./,
    );
    const bffDeps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(bffDeps["@aws-sdk/client-secrets-manager"]).toBeUndefined();
  });

  it("reuses the lp-3a1.2 AES-256-GCM envelope (no second store format)", () => {
    const src = readFileSync(
      join(__dirname, "../src/gateway-relay-env.ts"),
      "utf8",
    );
    expect(src).toContain("aes-256-gcm");
    expect(src).toContain("createSecretsManagerInstanceSecretMaterialStore");
    expect(src).toContain("encryptPayload");
    expect(src).toContain("decryptPayload");
    expect(src).toContain("Same ciphertext envelope");
    expect(src).toContain("Same AES-256-GCM envelope");
  });
});

describe("secrets manager material store (lp-oop.37.6)", () => {
  const SECRET_ID =
    "lanyard/staging/portal/control-plane/instance-secret-material";

  class FakeNotFoundError extends Error {
    readonly name = "ResourceNotFoundException";
    readonly $metadata = { httpStatusCode: 404 };

    constructor() {
      super("Secrets Manager can't find the specified secret.");
    }
  }

  function createFakeSm(options: {
    initial?: string;
    missing?: boolean;
    failGet?: string;
    failPut?: string;
  } = {}): InstanceSecretMaterialSecretsManagerSdk & {
    values: Map<string, string>;
    getCalls: number;
    putCalls: number;
  } {
    const values = new Map<string, string>();
    if (options.initial !== undefined) {
      values.set(SECRET_ID, options.initial);
    }
    let getCalls = 0;
    let putCalls = 0;
    return {
      values,
      get getCalls() {
        return getCalls;
      },
      get putCalls() {
        return putCalls;
      },
      async getSecretValue(input) {
        getCalls += 1;
        if (options.failGet) {
          throw new Error(options.failGet);
        }
        if (options.missing || !values.has(input.SecretId)) {
          throw new FakeNotFoundError();
        }
        return { SecretString: values.get(input.SecretId) };
      },
      async putSecretValue(input) {
        putCalls += 1;
        if (options.failPut) {
          throw new Error(options.failPut);
        }
        if (options.missing || !values.has(input.SecretId)) {
          throw new FakeNotFoundError();
        }
        values.set(input.SecretId, input.SecretString);
      },
    };
  }

  it("put/get/delete round-trip; SM body has no plaintext secret", async () => {
    const sdk = createFakeSm({ initial: "{}" });
    const store = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    const material = materialFromIssued({
      instance_id: INSTANCE_ID,
      tenant_id: TENANT_ID,
      secret: THROW_AWAY_SECRET,
      relay_wss_url: RELAY_URL,
      relay_tier: "shared",
      issued_at: "2026-08-05T00:00:00.000Z",
    });

    await store.put(material);
    const got = await store.get(INSTANCE_ID);
    expect(got).toEqual(material);
    expect(got).not.toBe(material);

    const onSm = sdk.values.get(SECRET_ID) ?? "";
    expect(onSm).not.toContain(THROW_AWAY_SECRET);
    expect(onSm).not.toContain(INSTANCE_ID);
    const envelope = JSON.parse(onSm) as {
      v: number;
      alg: string;
      iv: string;
      tag: string;
      ct: string;
    };
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe("aes-256-gcm");
    expect(envelope.iv).toBeTruthy();
    expect(envelope.tag).toBeTruthy();
    expect(envelope.ct).toBeTruthy();

    await store.delete(INSTANCE_ID);
    expect(await store.get(INSTANCE_ID)).toBeNull();
  });

  it("survives process replacement (new store handle, same secret+key)", async () => {
    const sdk = createFakeSm({ initial: "{}" });
    const first = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    await first.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );

    // Simulate CP force-new-deployment: drop first handle, open a new store.
    const afterRedeploy = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    const got = await afterRedeploy.get(INSTANCE_ID);
    expect(got?.secret).toBe(THROW_AWAY_SECRET);
    expect(got?.instance_id).toBe(INSTANCE_ID);
    expect(got?.relay_wss_url).toBe(RELAY_URL);
  });

  it("overwrite on rotate-like put keeps single latest secret", async () => {
    const sdk = createFakeSm({ initial: "{}" });
    const store = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    await store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    const rotated = "test-only-rotated-secret-lpoop376";
    await store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: rotated,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    expect((await store.get(INSTANCE_ID))?.secret).toBe(rotated);
    const onSm = sdk.values.get(SECRET_ID) ?? "";
    expect(onSm).not.toContain(rotated);
    expect(onSm).not.toContain(THROW_AWAY_SECRET);
  });

  it("wrong key fails closed on get", async () => {
    const sdk = createFakeSm({ initial: "{}" });
    const writer = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    await writer.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    const otherKey =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const reader = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: otherKey,
      sdk,
    });
    await expect(reader.get(INSTANCE_ID)).rejects.toThrow(GatewayRelayEnvError);
  });

  it("missing SM secret fails closed (ops must create first)", async () => {
    const sdk = createFakeSm({ missing: true });
    const store = createSecretsManagerInstanceSecretMaterialStore({
      secretId: SECRET_ID,
      key: TEST_MATERIAL_KEY,
      sdk,
    });
    await expect(store.get(INSTANCE_ID)).rejects.toThrow(
      /does not exist/,
    );
    await expect(
      store.put(
        materialFromIssued({
          instance_id: INSTANCE_ID,
          tenant_id: TENANT_ID,
          secret: THROW_AWAY_SECRET,
          relay_wss_url: RELAY_URL,
          relay_tier: "shared",
        }),
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("log summary never includes KEY, secret, or SM body", () => {
    const sdk = createFakeSm({ initial: "{}" });
    const resolved = resolveInstanceSecretMaterialStore(
      {
        [INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]: SECRET_ID,
        [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
      },
      { secretsManagerSdk: sdk },
    );
    const summary = summarizeInstanceSecretMaterialStoreForLog(resolved);
    const dumped = JSON.stringify(summary);
    expect(dumped).not.toContain(TEST_MATERIAL_KEY);
    expect(dumped).not.toContain(THROW_AWAY_SECRET);
    expect(dumped).not.toContain(SECRET_ID);
    expect(summary).toEqual({
      kind: "secrets_manager",
      path_configured: false,
      path_ephemeral: false,
      sm_configured: true,
    });
  });

  it("resolve selects secrets_manager when SM id + KEY are set", async () => {
    const sdk = createFakeSm({ initial: "{}" });
    const resolved = resolveInstanceSecretMaterialStore(
      {
        [INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]: SECRET_ID,
        [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
      },
      { secretsManagerSdk: sdk },
    );
    expect(resolved.kind).toBe("secrets_manager");
    expect(resolved.secretIdConfigured).toBe(true);

    await resolved.store.put(
      materialFromIssued({
        instance_id: INSTANCE_ID,
        tenant_id: TENANT_ID,
        secret: THROW_AWAY_SECRET,
        relay_wss_url: RELAY_URL,
        relay_tier: "shared",
      }),
    );
    const again = resolveInstanceSecretMaterialStore(
      {
        [INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]: SECRET_ID,
        [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
      },
      { secretsManagerSdk: sdk },
    );
    expect((await again.store.get(INSTANCE_ID))?.secret).toBe(THROW_AWAY_SECRET);
  });

  it("fails closed when SM id and PATH are both set", () => {
    expect(() =>
      resolveInstanceSecretMaterialStore({
        [INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]: SECRET_ID,
        [INSTANCE_SECRET_MATERIAL_PATH_ENV]: "/tmp/control-plane/x.bin",
        [INSTANCE_SECRET_MATERIAL_KEY_ENV]: TEST_MATERIAL_KEY,
      }),
    ).toThrow(/not both/);
  });

  it("fails closed when SM id is set without KEY", () => {
    expect(() =>
      resolveInstanceSecretMaterialStore({
        [INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]: SECRET_ID,
      }),
    ).toThrow(/both be set/);
  });
});
