/**
 * lp-oop.9 — CP HTTP vault list/stat/get on FakeS3.
 * Cross-tenant prefix rejected. No Daytona wake. No live S3.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import { TENANT_ID_HEADER } from "../src/tenant-authz.js";
import type { ControlPlaneStore } from "../src/store.js";
import {
  joinTenantVaultKey,
  resolveTenantVaultPrefix,
  VAULT_HTTP_API_PATHS,
  VAULT_HTTP_ROUTE_TEMPLATES,
  VaultHttpError,
} from "../src/vault-http.js";
import { buildS3VaultPrefix } from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const httpSrc = readFileSync(join(__dirname, "../src/vault-http.ts"), "utf8");
const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const testSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
const bffPkg = JSON.parse(
  readFileSync(join(__dirname, "../../bff/package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const cpPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT);
const OTHER_PREFIX = buildS3VaultPrefix(OTHER_TENANT);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");

type JsonBody = Record<string, unknown>;

function md5Hex(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function mockStore(): ControlPlaneStore {
  return {} as unknown as ControlPlaneStore;
}

function wiredApp(
  store: FakeS3ObjectStore,
  extras: {
    vaultObjectStore?: FakeS3ObjectStore | null;
    vaultBucket?: string | null;
    ensureOnline?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const ensureOnline =
    extras.ensureOnline ??
    vi.fn(async () => {
      throw new Error("Daytona wake must not run on vault HTTP (lp-oop.9)");
    });
  return {
    app: createApp(mockStore(), {
      devOpen: true,
      vaultObjectStore:
        extras.vaultObjectStore === undefined ? store : extras.vaultObjectStore,
      vaultBucket: extras.vaultBucket === undefined ? BUCKET : extras.vaultBucket,
      instanceOrchestrator: {
        ensureOnline,
        stop: vi.fn(),
      },
    }),
    ensureOnline,
  };
}

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

function seedTenantVault(store: FakeS3ObjectStore): void {
  store.seed(BUCKET, `${PREFIX}AGENTS.md`, "# tenant A\n", "text/markdown");
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Alpha/readme.md`,
    "hello alpha\n",
    "text/markdown",
  );
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Beta/note.md`,
    "café 🎉\n",
    "text/plain",
  );
  store.seed(
    BUCKET,
    `${OTHER_PREFIX}secret.md`,
    "tenant B only\n",
    "text/plain",
  );
}

describe("vault HTTP catalog (lp-oop.9 / lp-zuh.12.7)", () => {
  it("declares tenant-scoped list/stat/get/put routes", () => {
    expect(VAULT_HTTP_ROUTE_TEMPLATES.list).toBe(
      "/internal/tenants/:tenantId/vault/list",
    );
    expect(VAULT_HTTP_ROUTE_TEMPLATES.stat).toBe(
      "/internal/tenants/:tenantId/vault/stat",
    );
    expect(VAULT_HTTP_ROUTE_TEMPLATES.get).toBe(
      "/internal/tenants/:tenantId/vault/get",
    );
    expect(VAULT_HTTP_ROUTE_TEMPLATES.put).toBe(
      "/internal/tenants/:tenantId/vault/put",
    );
    expect(VAULT_HTTP_API_PATHS.list(TENANT)).toBe(
      `/internal/tenants/${TENANT}/vault/list`,
    );
    expect(VAULT_HTTP_API_PATHS.put(TENANT)).toBe(
      `/internal/tenants/${TENANT}/vault/put`,
    );
    expect(indexSrc).toContain("VAULT_HTTP_API_PATHS");
    expect(indexSrc).toContain("listTenantVault");
    expect(indexSrc).toContain("putTenantVault");
    expect(appSrc).toContain("VAULT_HTTP_ROUTE_TEMPLATES");
    expect(appSrc).toMatch(/app\.put\(VAULT_HTTP_ROUTE_TEMPLATES\.put/);
    expect(httpSrc).toMatch(/No Daytona wake/);
    expect(httpSrc).toMatch(/No @aws-sdk/);
  });

  it("does not add an S3 AWS SDK to BFF or this HTTP surface", () => {
    const bffDeps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(bffDeps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(httpSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(testSrc).not.toMatch(/from ["']@aws-sdk/);
    // Live S3 adapter lives in s3-vault-object-store.ts (lp-oop.37.1), not here.
    expect(cpPkg.dependencies?.["@aws-sdk/client-s3"]).toBeDefined();
  });
});

describe("tenant vault prefix ACL (lp-oop.9)", () => {
  it("defaults to the stamped tenants/{id}/vault/ prefix", () => {
    expect(resolveTenantVaultPrefix(TENANT)).toBe(PREFIX);
  });

  it("accepts the same-tenant prefix override", () => {
    expect(resolveTenantVaultPrefix(TENANT, PREFIX)).toBe(PREFIX);
    expect(
      resolveTenantVaultPrefix(
        TENANT,
        `tenants/${TENANT}/instances/dddddddd-dddd-dddd-dddd-dddddddddddd/vault/`,
      ),
    ).toBe(
      `tenants/${TENANT}/instances/dddddddd-dddd-dddd-dddd-dddddddddddd/vault/`,
    );
  });

  it("rejects a foreign-tenant prefix", () => {
    try {
      resolveTenantVaultPrefix(TENANT, OTHER_PREFIX);
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VaultHttpError);
      expect((error as VaultHttpError).code).toBe("VAULT_CROSS_TENANT");
      expect((error as VaultHttpError).httpStatus).toBe(403);
    }
  });

  it("joins vault-root paths under the tenant prefix", () => {
    expect(
      joinTenantVaultKey({
        tenantId: TENANT,
        prefix: PREFIX,
        vaultPath: "/Projects/Alpha/readme.md",
      }),
    ).toEqual({
      prefix: PREFIX,
      path: "/Projects/Alpha/readme.md",
      key: `${PREFIX}Projects/Alpha/readme.md`,
    });
  });

  it("rejects absolute S3 keys used as vault paths", () => {
    try {
      joinTenantVaultKey({
        tenantId: TENANT,
        prefix: PREFIX,
        vaultPath: `/tenants/${OTHER_TENANT}/vault/secret.md`,
      });
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VaultHttpError);
      expect((error as VaultHttpError).code).toBe("VAULT_CROSS_TENANT");
    }
  });
});

describe("HTTP list/stat/get on FakeS3 (lp-oop.9)", () => {
  it("lists the tenant vault root and child directories", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app, ensureOnline } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/`,
    );
    expect(status).toBe(200);
    expect(body.tenant_id).toBe(TENANT);
    expect(body.path).toBe("/");
    expect(body.s3_vault_prefix).toBe(PREFIX);
    expect(body.truncated).toBe(false);
    expect(body.entries).toEqual([
      { path: "/Projects", name: "Projects", kind: "directory" },
      {
        path: "/AGENTS.md",
        name: "AGENTS.md",
        kind: "file",
        size_bytes: Buffer.byteLength("# tenant A\n", "utf8"),
        etag: md5Hex("# tenant A\n"),
        mtime: "2026-08-14T00:00:00.000Z",
      },
    ]);
    expect(ensureOnline).not.toHaveBeenCalled();
    expect(store.getListCount()).toBe(1);
    expect(store.getGetCount()).toBe(0);
  });

  it("lists a subdirectory without leaking the other tenant", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=${encodeURIComponent("/Projects")}`,
    );
    expect(status).toBe(200);
    expect(body.entries).toEqual([
      { path: "/Projects/Alpha", name: "Alpha", kind: "directory" },
      { path: "/Projects/Beta", name: "Beta", kind: "directory" },
    ]);
    const listed = JSON.stringify(body.entries);
    expect(listed).not.toContain(OTHER_TENANT);
    expect(listed).not.toContain("secret.md");
  });

  it("stats a file and a directory", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app, ensureOnline } = wiredApp(store);

    const file = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.stat(TENANT)}?path=${encodeURIComponent("/Projects/Alpha/readme.md")}`,
    );
    expect(file.status).toBe(200);
    expect(file.body).toMatchObject({
      tenant_id: TENANT,
      path: "/Projects/Alpha/readme.md",
      name: "readme.md",
      kind: "file",
      size_bytes: Buffer.byteLength("hello alpha\n", "utf8"),
      etag: md5Hex("hello alpha\n"),
      s3_vault_prefix: PREFIX,
    });

    const dir = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.stat(TENANT)}?path=${encodeURIComponent("/Projects")}`,
    );
    expect(dir.status).toBe(200);
    expect(dir.body).toMatchObject({
      tenant_id: TENANT,
      path: "/Projects",
      name: "Projects",
      kind: "directory",
      s3_vault_prefix: PREFIX,
    });
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("gets file bytes from FakeS3", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app, ensureOnline } = wiredApp(store);
    const expected = "café 🎉\n";

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/Projects/Beta/note.md")}`,
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      tenant_id: TENANT,
      path: "/Projects/Beta/note.md",
      kind: "file",
      body: expected,
      encoding: "utf-8",
      content_type: "text/plain",
      size_bytes: Buffer.byteLength(expected, "utf8"),
      etag: md5Hex(expected),
      mtime: "2026-08-14T00:00:00.000Z",
      s3_vault_prefix: PREFIX,
    });
    expect(Buffer.from(String(body.body), "utf8").equals(Buffer.from(expected, "utf8"))).toBe(
      true,
    );
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing get/stat path", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const missingGet = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/missing.md")}`,
    );
    expect(missingGet.status).toBe(404);
    expect(missingGet.body.code).toBe("VAULT_OBJECT_NOT_FOUND");

    const missingStat = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.stat(TENANT)}?path=${encodeURIComponent("/nope")}`,
    );
    expect(missingStat.status).toBe(404);
    expect(missingStat.body.code).toBe("VAULT_OBJECT_NOT_FOUND");
  });

  it("rejects get of a directory", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/Projects")}`,
    );
    expect(status).toBe(400);
    expect(body.code).toBe("VAULT_NOT_A_FILE");
  });
});

describe("cross-tenant vault HTTP rejected (lp-oop.9)", () => {
  it("rejects a foreign prefix query on list/get", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app, ensureOnline } = wiredApp(store);

    const list = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/&prefix=${encodeURIComponent(OTHER_PREFIX)}`,
    );
    expect(list.status).toBe(403);
    expect(list.body.code).toBe("VAULT_CROSS_TENANT");
    expect(list.body.tenant_id).toBe(TENANT);

    const get = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/secret.md")}&prefix=${encodeURIComponent(OTHER_PREFIX)}`,
    );
    expect(get.status).toBe(403);
    expect(get.body.code).toBe("VAULT_CROSS_TENANT");
    expect(store.getGetCount()).toBe(0);
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("rejects a stamped-tenant header mismatch", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/`,
      { headers: { [TENANT_ID_HEADER]: OTHER_TENANT } },
    );
    expect(status).toBe(403);
    expect(String(body.error)).toMatch(/Cross-tenant/i);
  });

  it("rejects path traversal and absolute S3 keys", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const traversal = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/Projects/../../../tenants/" + OTHER_TENANT + "/vault/secret.md")}`,
    );
    expect(traversal.status).toBe(400);
    expect(traversal.body.code ?? traversal.body.error).toBeTruthy();

    const absolute = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/tenants/" + OTHER_TENANT + "/vault/secret.md")}`,
    );
    expect(absolute.status).toBe(403);
    expect(absolute.body.code).toBe("VAULT_CROSS_TENANT");
  });

  it("does not return another tenant's object via this tenant's get", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/secret.md")}`,
    );
    expect(status).toBe(404);
    expect(body.code).toBe("VAULT_OBJECT_NOT_FOUND");
    expect(body).not.toHaveProperty("body", "tenant B only\n");
  });
});

describe("vault HTTP fail-closed wiring (lp-oop.9)", () => {
  it("returns 501 when VaultObjectStore is not injected", async () => {
    const store = new FakeS3ObjectStore();
    const { app } = wiredApp(store, { vaultObjectStore: null });

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/`,
    );
    expect(status).toBe(501);
    expect(body.code).toBe("VAULT_OBJECT_STORE_NOT_CONFIGURED");
  });

  it("returns 503 when the vault bucket is missing", async () => {
    const store = new FakeS3ObjectStore();
    const { app } = wiredApp(store, { vaultBucket: null });

    const { status, body } = await jsonRequest(
      app,
      `${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/`,
    );
    expect(status).toBe(503);
    expect(body.code).toBe("VAULT_BUCKET_NOT_CONFIGURED");
  });
});

describe("vault HTTP put/CAS (lp-zuh.12.7)", () => {
  const OFFICE_PATH = "/Projects/Alpha/proposal.docx";
  const OFFICE_BODY_V1 = "PK-fake-docx-v1-unique";
  const OFFICE_BODY_V2 = "PK-fake-docx-v2-after-save";
  const OFFICE_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  function contentHash(body: string): string {
    return createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  }

  it("replace_if_match puts new bytes and returns a new DocumentRevision", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      `${PREFIX}Projects/Alpha/proposal.docx`,
      OFFICE_BODY_V1,
      OFFICE_MIME,
    );
    const { app, ensureOnline } = wiredApp(store);
    const ifMatch = contentHash(OFFICE_BODY_V1);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: OFFICE_PATH,
          body: Buffer.from(OFFICE_BODY_V2, "utf8").toString("base64"),
          encoding: "base64",
          content_type: OFFICE_MIME,
          mode: "replace_if_match",
          if_match: ifMatch,
          size_bytes: Buffer.byteLength(OFFICE_BODY_V2, "utf8"),
        }),
      },
    );

    expect(status).toBe(200);
    expect(body.path).toBe(OFFICE_PATH);
    expect(body.created).toBe(false);
    expect((body.revision as { token: string; kind: string }).kind).toBe(
      "content_hash",
    );
    expect((body.revision as { token: string }).token).toBe(
      contentHash(OFFICE_BODY_V2),
    );
    expect((body.revision as { token: string }).token).not.toBe(ifMatch);
    expect(store.get(BUCKET, `${PREFIX}Projects/Alpha/proposal.docx`)?.body).toBe(
      OFFICE_BODY_V2,
    );
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("CAS mismatch returns 409 VAULT_REVISION_CONFLICT", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      `${PREFIX}Projects/Alpha/proposal.docx`,
      OFFICE_BODY_V1,
      OFFICE_MIME,
    );
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: OFFICE_PATH,
          body: Buffer.from(OFFICE_BODY_V2, "utf8").toString("base64"),
          encoding: "base64",
          mode: "replace_if_match",
          if_match: "deadbeef".repeat(8),
        }),
      },
    );

    expect(status).toBe(409);
    expect(body.code).toBe("VAULT_REVISION_CONFLICT");
    expect(store.get(BUCKET, `${PREFIX}Projects/Alpha/proposal.docx`)?.body).toBe(
      OFFICE_BODY_V1,
    );
  });

  it("accepts etag as if_match", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      `${PREFIX}Projects/Alpha/proposal.docx`,
      OFFICE_BODY_V1,
      OFFICE_MIME,
    );
    const { app } = wiredApp(store);
    const etag = md5Hex(OFFICE_BODY_V1);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: OFFICE_PATH,
          body: OFFICE_BODY_V2,
          encoding: "utf-8",
          mode: "replace_if_match",
          if_match: etag,
        }),
      },
    );

    expect(status).toBe(200);
    expect((body.revision as { token: string }).token).toBe(
      contentHash(OFFICE_BODY_V2),
    );
  });

  it("rejects cross-tenant prefix on put", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: "/secret.md",
          body: "stolen",
          encoding: "utf-8",
          mode: "create_new",
          prefix: OTHER_PREFIX,
        }),
      },
    );

    expect(status).toBe(403);
    expect(body.code).toBe("VAULT_CROSS_TENANT");
  });

  it("create_new creates and returns 201", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const { app } = wiredApp(store);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: "/Projects/Alpha/new.md",
          body: "# new\n",
          encoding: "utf-8",
          content_type: "text/markdown",
          mode: "create_new",
        }),
      },
    );

    expect(status).toBe(201);
    expect(body.created).toBe(true);
    expect(store.get(BUCKET, `${PREFIX}Projects/Alpha/new.md`)?.body).toBe(
      "# new\n",
    );
  });

  it("identical body + matching CAS is idempotent_replay", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(
      BUCKET,
      `${PREFIX}Projects/Alpha/proposal.docx`,
      OFFICE_BODY_V1,
      OFFICE_MIME,
    );
    const { app } = wiredApp(store);
    const ifMatch = contentHash(OFFICE_BODY_V1);

    const { status, body } = await jsonRequest(
      app,
      VAULT_HTTP_API_PATHS.put(TENANT),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [TENANT_ID_HEADER]: TENANT,
        },
        body: JSON.stringify({
          path: OFFICE_PATH,
          body: OFFICE_BODY_V1,
          encoding: "utf-8",
          mode: "replace_if_match",
          if_match: ifMatch,
        }),
      },
    );

    expect(status).toBe(200);
    expect(body.idempotent_replay).toBe(true);
    expect((body.revision as { token: string }).token).toBe(ifMatch);
  });
});
