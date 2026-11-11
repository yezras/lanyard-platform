/**
 * lp-9o6 — Optional client-core seed bootstrap (fake S3, no network).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  ensureTenantVaultPrefix,
  ensureVaultPrefixForDaytonaProvision,
} from "../src/vault-prefix.js";
import {
  bootstrapTenantVaultSeed,
  bootstrapVaultForDaytonaProvision,
  buildVaultSeedAgentsMdKey,
  buildVaultSeedBootstrapMarkerKey,
  buildVaultSeedObjectKey,
  minimalClientCoreSeedFixture,
  mockLabVaultSeedPack,
  VAULT_SEED_BOOTSTRAP_MARKER_REL,
  VAULT_SEED_BOOTSTRAP_VERSION,
  VAULT_SEED_GATE_REL,
  VAULT_SEED_PROVENANCE_REL,
  VaultSeedError,
} from "../src/vault-seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const seedSrc = readFileSync(join(__dirname, "../src/vault-seed.ts"), "utf8");

const BUCKET = "lanyard-mocklab-vault-test";
const TENANT = "mocklab";
const FIXED_NOW = () => new Date("2026-08-04T15:30:00.000Z");

describe("vault seed path helpers (lp-9o6)", () => {
  it("builds platform bootstrap marker outside mounted vault root", () => {
    const key = buildVaultSeedBootstrapMarkerKey(TENANT);
    expect(key).toBe(`tenants/${TENANT}/${VAULT_SEED_BOOTSTRAP_MARKER_REL}`);
    expect(key.startsWith(`tenants/${TENANT}/vault/`)).toBe(false);
    expect(key).toContain("/_platform/");
  });

  it("builds AGENTS.md gate under vault prefix", () => {
    expect(buildVaultSeedAgentsMdKey(TENANT)).toBe(
      `tenants/${TENANT}/vault/${VAULT_SEED_GATE_REL}`,
    );
  });

  it("resolves seed object keys under tenant vault only", () => {
    expect(buildVaultSeedObjectKey(TENANT, "AGENTS.md")).toBe(
      "tenants/mocklab/vault/AGENTS.md",
    );
    expect(buildVaultSeedObjectKey(TENANT, "Knowledge/INDEX.md")).toBe(
      "tenants/mocklab/vault/Knowledge/INDEX.md",
    );
  });

  it("rejects path traversal and absolute/URI seed paths", () => {
    for (const bad of [
      "",
      "/",
      "/AGENTS.md",
      "../escape",
      "foo/../bar",
      "a//b",
      "tenants/other/vault/x",
      "s3://bucket/key",
      "a\\b",
      ".",
      "..",
    ]) {
      expect(() => buildVaultSeedObjectKey(TENANT, bad)).toThrow(VaultSeedError);
    }
  });
});

describe("bootstrapTenantVaultSeed optional + idempotent (fake S3)", () => {
  it("skips when no seed pack (empty vault remains usable)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    await ensureTenantVaultPrefix({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      now: FIXED_NOW,
    });
    const result = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      now: FIXED_NOW,
    });
    expect(result.seeded).toBe(false);
    expect(result.skippedReason).toBe("no_seed_pack");
    expect(result.objectsWritten).toBe(0);
    expect(result.bootstrapMarkerWritten).toBe(false);
    // Only the jt5 platform prefix marker exists — no vault content required.
    expect(store.listKeys(BUCKET)).toEqual([
      "tenants/mocklab/_platform/vault-prefix-ensured.json",
    ]);
  });

  it("writes client-core seed under tenant vault prefix", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const pack = minimalClientCoreSeedFixture();
    const result = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: pack,
      seedVersion: "fixture-0.0.1",
      seedSource: "minimalClientCoreSeedFixture",
      now: FIXED_NOW,
    });

    expect(result.seeded).toBe(true);
    expect(result.s3_vault_prefix).toBe("tenants/mocklab/vault/");
    expect(result.bootstrapMarkerWritten).toBe(true);
    // pack objects + provenance
    expect(result.objectsWritten).toBe(pack.length + 1);
    expect(store.has(BUCKET, "tenants/mocklab/vault/AGENTS.md")).toBe(true);
    expect(store.has(BUCKET, "tenants/mocklab/vault/index.yaml")).toBe(true);
    expect(store.has(BUCKET, "tenants/mocklab/vault/Knowledge/INDEX.md")).toBe(
      true,
    );
    expect(
      store.has(BUCKET, `tenants/mocklab/vault/${VAULT_SEED_PROVENANCE_REL}`),
    ).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/_platform/bootstrap.json"),
    ).toBe(true);

    const marker = store.get(BUCKET, result.bootstrapMarkerKey);
    const body = JSON.parse(marker!.body) as {
      version: number;
      tenant_id: string;
      s3_vault_prefix: string;
      seed_version: string;
      seeded_at: string;
    };
    expect(body.version).toBe(VAULT_SEED_BOOTSTRAP_VERSION);
    expect(body.tenant_id).toBe(TENANT);
    expect(body.s3_vault_prefix).toBe("tenants/mocklab/vault/");
    expect(body.seed_version).toBe("fixture-0.0.1");
    expect(body.seeded_at).toBe("2026-08-04T15:30:00.000Z");
  });

  it("fills missing kitchen-sink files when AGENTS.md already exists (lp-oop.38.18)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      "tenants/mocklab/vault/AGENTS.md",
      "# existing live vault\n",
    );
    const pack = mockLabVaultSeedPack();
    const result = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: pack,
      now: FIXED_NOW,
    });
    expect(result.seeded).toBe(true);
    expect(result.skippedReason).toBeUndefined();
    expect(store.has(BUCKET, "tenants/mocklab/vault/config.yaml")).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/vault/workflows/research-lite.yaml"),
    ).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/vault/skills/mocklab-research/SKILL.md"),
    ).toBe(true);
    const agents = store.get(BUCKET, "tenants/mocklab/vault/AGENTS.md");
    expect(agents?.body).toBe("# existing live vault\n");
  });

  it("second call is a no-op (AGENTS.md gate — seed-vault.sh parity)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const pack = minimalClientCoreSeedFixture();
    const first = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: pack,
      now: FIXED_NOW,
    });
    const putsAfterFirst = store.getPutCount();
    const second = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: pack,
      now: FIXED_NOW,
    });
    expect(first.seeded).toBe(true);
    expect(second.seeded).toBe(false);
    expect(second.skippedReason).toBe("agents_md_present");
    expect(store.getPutCount()).toBe(putsAfterFirst);
  });

  it("skips when bootstrap marker exists even without AGENTS.md", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      buildVaultSeedBootstrapMarkerKey(TENANT),
      JSON.stringify({ version: 1 }),
    );
    const result = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      now: FIXED_NOW,
    });
    expect(result.seeded).toBe(false);
    expect(result.skippedReason).toBe("bootstrap_marker_present");
    expect(store.getPutCount()).toBe(0);
  });

  it("force re-seeds without deleting extra live objects", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      now: FIXED_NOW,
    });
    // Tenant-created object (must survive re-seed).
    store.seed(BUCKET, "tenants/mocklab/vault/Clients/acme/notes.md", "live");
    const forced = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: [
        {
          relativePath: "AGENTS.md",
          body: "# AGENTS.md reseeded\n",
        },
      ],
      force: true,
      seedVersion: "reseed",
      now: FIXED_NOW,
    });
    expect(forced.seeded).toBe(true);
    expect(store.get(BUCKET, "tenants/mocklab/vault/AGENTS.md")?.body).toContain(
      "reseeded",
    );
    expect(
      store.get(BUCKET, "tenants/mocklab/vault/Clients/acme/notes.md")?.body,
    ).toBe("live");
  });

  it("rejects seed pack missing AGENTS.md", async () => {
    const store = new FakeS3ObjectStore();
    await expect(
      bootstrapTenantVaultSeed({
        bucket: BUCKET,
        tenantId: TENANT,
        store,
        seedObjects: [{ relativePath: "INDEX.md", body: "# only\n" }],
      }),
    ).rejects.toMatchObject({ code: "SEED_PACK_MISSING_AGENTS_MD" });
    expect(store.getPutCount()).toBe(0);
  });
});

describe("no cross-tenant copy bugs (lp-9o6)", () => {
  it("seeds only the target tenant prefix", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: "tenant-a",
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      seedSource: "pack-a",
      now: FIXED_NOW,
    });
    await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: "tenant-b",
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      seedSource: "pack-b",
      now: FIXED_NOW,
    });

    const keys = store.listKeys(BUCKET);
    const aKeys = keys.filter((k) => k.startsWith("tenants/tenant-a/"));
    const bKeys = keys.filter((k) => k.startsWith("tenants/tenant-b/"));
    expect(aKeys.length).toBeGreaterThan(0);
    expect(bKeys.length).toBeGreaterThan(0);
    // No key under tenant-a mentions tenant-b path, and vice versa.
    for (const k of aKeys) {
      expect(k.startsWith("tenants/tenant-a/")).toBe(true);
      expect(k.includes("tenant-b")).toBe(false);
    }
    for (const k of bKeys) {
      expect(k.startsWith("tenants/tenant-b/")).toBe(true);
      expect(k.includes("tenant-a")).toBe(false);
    }
    // Seeding B did not remove or rewrite A's AGENTS.md.
    expect(store.has(BUCKET, "tenants/tenant-a/vault/AGENTS.md")).toBe(true);
    expect(store.has(BUCKET, "tenants/tenant-b/vault/AGENTS.md")).toBe(true);
  });

  it("never copies objects from another tenant prefix as the seed source", async () => {
    // Seed source is always caller-supplied bytes — not S3 list/copy.
    // Assert the module does not implement GetObject/List/Copy as a seed path.
    expect(seedSrc).not.toMatch(/copyObject|listObjects|getObject/i);
    expect(seedSrc).toMatch(/never lists or copies another tenant/);
    expect(seedSrc).toContain("lp-9o6");
  });

  it("rejects relative paths that try to escape into another tenant", async () => {
    const store = new FakeS3ObjectStore();
    await expect(
      bootstrapTenantVaultSeed({
        bucket: BUCKET,
        tenantId: TENANT,
        store,
        seedObjects: [
          { relativePath: "AGENTS.md", body: "# ok\n" },
          // Would resolve under vault/ only if naive join; our validator rejects `..`
          { relativePath: "../other/vault/secret.md", body: "x" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_SEED_PATH" });
    expect(store.getPutCount()).toBe(0);
  });
});

describe("provision path: bootstrapVaultForDaytonaProvision", () => {
  it("ensures prefix then optionally seeds (empty pack = empty vault)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const result = await bootstrapVaultForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      now: FIXED_NOW,
    });
    expect(result.prefix.created).toBe(true);
    expect(result.prefix.s3_vault_prefix).toBe("tenants/mocklab/vault/");
    expect(result.seed.seeded).toBe(false);
    expect(result.seed.skippedReason).toBe("no_seed_pack");
    // Agent-usable: prefix marker present; vault content optional.
    expect(
      store.has(BUCKET, "tenants/mocklab/_platform/vault-prefix-ensured.json"),
    ).toBe(true);
  });

  it("ensures prefix + seeds fixture pack in one provision call", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const result = await bootstrapVaultForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      seedVersion: "v-test",
      now: FIXED_NOW,
    });
    expect(result.prefix.s3_vault_prefix).toBe(result.seed.s3_vault_prefix);
    expect(result.seed.seeded).toBe(true);
    expect(store.has(BUCKET, "tenants/mocklab/vault/AGENTS.md")).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/_platform/bootstrap.json"),
    ).toBe(true);

    // Idempotent provision retry
    const retry = await bootstrapVaultForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      now: FIXED_NOW,
    });
    expect(retry.prefix.created).toBe(false);
    expect(retry.seed.seeded).toBe(false);
    expect(retry.seed.skippedReason).toBe("agents_md_present");
  });

  it("refuses ec2 runtime_kind", async () => {
    const store = new FakeS3ObjectStore();
    await expect(
      bootstrapVaultForDaytonaProvision({
        tenantId: TENANT,
        runtimeKind: "ec2",
        bucket: BUCKET,
        store,
        seedObjects: minimalClientCoreSeedFixture(),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_KIND_NOT_DAYTONA" });
    expect(store.getPutCount()).toBe(0);
  });

  it("composes with ensureVaultPrefixForDaytonaProvision (jt5 then 9o6)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    await ensureVaultPrefixForDaytonaProvision({
      tenantId: TENANT,
      runtimeKind: "daytona",
      bucket: BUCKET,
      store,
      now: FIXED_NOW,
    });
    const seed = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: minimalClientCoreSeedFixture(),
      now: FIXED_NOW,
    });
    expect(seed.seeded).toBe(true);
  });
});

describe("package surface (lp-9o6)", () => {
  it("exports seed helpers from package index", () => {
    expect(indexSrc).toContain("bootstrapTenantVaultSeed");
    expect(indexSrc).toContain("bootstrapVaultForDaytonaProvision");
    expect(indexSrc).toContain("minimalClientCoreSeedFixture");
    expect(indexSrc).toContain("mockLabVaultSeedPack");
    expect(indexSrc).toContain("MOCKLAB_KITCHEN_SINK_CONFIG_YAML");
    expect(indexSrc).toContain("buildVaultSeedObjectKey");
  });

  it("documents optional seed and no @aws-sdk", () => {
    expect(seedSrc).toMatch(/No @aws-sdk/);
    expect(seedSrc).toMatch(/optional/i);
    expect(seedSrc).toContain("lp-9o6");
  });
});

describe("mockLabVaultSeedPack (lp-zuh.9.5)", () => {
  it("includes AGENTS gate, skills, Workspace welcome, default primary_path", async () => {
    const pack = mockLabVaultSeedPack();
    const paths = pack.map((o) => o.relativePath);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("Projects/Workspace/welcome.md");
    expect(paths).toContain("skills/mocklab-research/SKILL.md");
    expect(paths).toContain(".seed/default-projects.json");
    expect(paths).toContain("config.yaml");
    expect(paths).toContain("workflows/research-lite.yaml");

    const welcome = pack.find(
      (o) => o.relativePath === "Projects/Workspace/welcome.md",
    );
    expect(welcome?.body).toMatch(/seeded read target/i);

    const defaults = pack.find(
      (o) => o.relativePath === ".seed/default-projects.json",
    );
    const doc = JSON.parse(defaults!.body) as {
      projects: Array<{ primary_path: string }>;
    };
    expect(doc.projects[0].primary_path).toBe(
      "/mnt/vault/Projects/Workspace",
    );

    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const result = await bootstrapTenantVaultSeed({
      bucket: BUCKET,
      tenantId: TENANT,
      store,
      seedObjects: pack,
      seedVersion: "lp-zuh.9.5",
      seedSource: "mockLabVaultSeedPack",
      now: FIXED_NOW,
    });
    expect(result.seeded).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/vault/AGENTS.md"),
    ).toBe(true);
    expect(
      store.has(
        BUCKET,
        "tenants/mocklab/vault/Projects/Workspace/welcome.md",
      ),
    ).toBe(true);
    expect(
      store.has(
        BUCKET,
        "tenants/mocklab/vault/skills/mocklab-research/SKILL.md",
      ),
    ).toBe(true);
    expect(store.has(BUCKET, "tenants/mocklab/vault/config.yaml")).toBe(true);
    expect(
      store.has(BUCKET, "tenants/mocklab/vault/workflows/research-lite.yaml"),
    ).toBe(true);
  });

  it("seeds kitchen-sink harness flags (lp-oop.38.18)", () => {
    const pack = mockLabVaultSeedPack();
    const cfg = pack.find((o) => o.relativePath === "config.yaml");
    expect(cfg).toBeDefined();
    const body = cfg!.body;
    expect(body).toMatch(/^subagents:\n(?:  .*\n)*  enabled: true$/m);
    expect(body).toMatch(/^mempalace:\n(?:  .*\n)*  enabled: true$/m);
    expect(body).toMatch(/^workflow:\n(?:  .*\n)*  enabled: true$/m);
    expect(body).toMatch(/^cron:\n(?:  .*\n)*  enabled: true$/m);
    expect(body).toMatch(
      /^tools:\n(?:  .*\n)*  catalog_search:\n(?:  .*\n)*    enabled: true$/m,
    );
    expect(body).toMatch(/^skills:\n(?:  .*\n)*  disabled: \[\]$/m);
    expect(body).not.toMatch(/lanyard-agent\//);
    expect(body).not.toMatch(/api_key:\s*['\"]?[A-Za-z0-9]/);

    const wf = pack.find((o) => o.relativePath === "workflows/research-lite.yaml");
    expect(wf?.body).toMatch(/MockLab research lite/);
  });

  it("keeps config.yaml in lockstep with the deploy artifact", () => {
    const artifact = readFileSync(
      join(
        __dirname,
        "../../../../deploy/artifacts/mocklab-vault-seed/config.yaml",
      ),
      "utf8",
    );
    const pack = mockLabVaultSeedPack();
    const cfg = pack.find((o) => o.relativePath === "config.yaml");
    expect(cfg?.body.replace(/\s+$/, "")).toBe(artifact.replace(/\s+$/, ""));
  });
});
