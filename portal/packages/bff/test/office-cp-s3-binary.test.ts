/**
 * lp-oop.12 — Office binary via CP getObject for signed GET.
 * Streams fake CP bytes. No full base64 log. No gRPC. No Brain RPC chunked read.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
import { VAULT_HTTP_API_PATHS } from "../../control-plane/src/vault-http.js";
import { buildS3VaultPrefix } from "../../control-plane/src/vault-prefix.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
} from "../src/control-plane-client.js";
import {
  createCpS3OfficeBinaryContentSource,
  MemoryOfficeDocumentSessionStore,
  type CreateOfficeDocumentSessionInput,
  type DocumentRevision,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import { VAULT_CP_HTTP_PATHS } from "../src/vault/cp-s3-provider.js";
import type { TenantContext } from "../src/types.js";
import { createTestBindings } from "./test-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, "../src/office/cp-s3-binary-source.ts");
const sourceSrc = readFileSync(sourcePath, "utf8");
const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const testSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
const bffPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT);
const OTHER_PREFIX = buildS3VaultPrefix(OTHER_TENANT);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");
const CP_BASE = "http://control-plane.test";
const SERVICE_TOKEN = "test-cp-service-token";

const OFFICE_PATH = "/Projects/Acme/proposal.docx";
const OFFICE_UNIQUE = "PK-fake-office-cp-s3-bytes-lp-oop.12-UNIQUE-payload";
const OFFICE_BYTES = new TextEncoder().encode(OFFICE_UNIQUE);
const OFFICE_B64 = Buffer.from(OFFICE_BYTES).toString("base64");
const OFFICE_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const REVISION: DocumentRevision = {
  token: "rev-etag-office-cp-s3",
  kind: "etag",
  size_bytes: OFFICE_BYTES.byteLength,
};

const tenant: TenantContext = {
  tenant_id: TENANT,
  tenant_slug: "office-cp",
  display_name: "Office CP",
  host: "office-cp.withlanyard.com",
};

function mockStore(): ControlPlaneStore {
  return {} as unknown as ControlPlaneStore;
}

function pathnameOf(input: string): { path: string; search: string } {
  const url = new URL(input, "http://unused.test");
  return { path: url.pathname, search: url.search };
}

function headerGet(
  headers: HeadersInit | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  return new Headers(headers).get(name);
}

function seedOfficeVault(store: FakeS3ObjectStore): void {
  store.seed(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`, OFFICE_UNIQUE, OFFICE_MIME);
  store.seed(
    BUCKET,
    `${OTHER_PREFIX}Projects/Acme/proposal.docx`,
    "other-tenant-secret-docx",
    OFFICE_MIME,
  );
}

function wiredCp(store: FakeS3ObjectStore) {
  const ensureOnline = vi.fn(async () => {
    throw new Error("Daytona wake must not run on Office CP getObject (lp-oop.12)");
  });
  const app = createControlPlaneApp(mockStore(), {
    devOpen: true,
    vaultObjectStore: store,
    vaultBucket: BUCKET,
    instanceOrchestrator: {
      ensureOnline,
      stop: vi.fn(),
    },
  });
  const calls: Array<{
    path: string;
    search: string;
    method: string;
    tenantHeader: string | null;
    serviceToken: string | null;
  }> = [];
  const requestFn = (input: string, init?: RequestInit) => {
    const parsed = pathnameOf(String(input));
    calls.push({
      path: parsed.path,
      search: parsed.search,
      method: init?.method ?? "GET",
      tenantHeader: headerGet(init?.headers, "x-lanyard-tenant-id"),
      serviceToken: headerGet(
        init?.headers,
        CONTROL_PLANE_SERVICE_TOKEN_HEADER,
      ),
    });
    return app.request(parsed.path + parsed.search, init);
  };
  return { app, ensureOnline, calls, requestFn };
}

function sourceFor(store: FakeS3ObjectStore, tenantId: string = TENANT) {
  const wired = wiredCp(store);
  return {
    ...wired,
    source: createCpS3OfficeBinaryContentSource({
      tenantId,
      baseUrl: CP_BASE,
      requestFn: wired.requestFn,
      serviceToken: SERVICE_TOKEN,
    }),
  };
}

function baseCreate(
  overrides: Partial<CreateOfficeDocumentSessionInput> = {},
): CreateOfficeDocumentSessionInput {
  return {
    tenant_id: TENANT,
    user_id: "user-office-cp",
    path: OFFICE_PATH,
    revision: REVISION,
    mode: "edit",
    file_type: "docx",
    document_key: "dk-v1-office-cp-proposal",
    download_token: "download-token-office-cp-s3",
    callback_nonce: "callback-nonce-office-cp-s3",
    download_ttl_seconds: 120,
    ...overrides,
  };
}

describe("CpS3 Office binary catalog (lp-oop.12)", () => {
  it("calls CP vault/get (getObject) and is not the default plane", () => {
    expect(VAULT_CP_HTTP_PATHS.get(TENANT)).toBe(VAULT_HTTP_API_PATHS.get(TENANT));
    expect(sourceSrc).toMatch(/getObject/);
    expect(sourceSrc).toMatch(/Never log the file body/);
    expect(sourceSrc).not.toMatch(/read_chunk\(/);
    expect(sourceSrc).not.toMatch(/invokeBrainRpc/);
    expect(sourceSrc).not.toMatch(/from ["']@grpc/);
    expect(appSrc).toMatch(/createCpS3OfficeBinarySource/);
    expect(indexSrc).toMatch(/createCpS3OfficeBinaryContentSource/);
    expect(loadConfig({ CONTROL_PLANE_URL: "http://cp.test" }).vaultPlane).toBe(
      "fs",
    );
  });

  it("does not add an S3 AWS SDK or gRPC client to BFF", () => {
    const deps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(deps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(deps["@grpc/grpc-js"]).toBeUndefined();
    expect(sourceSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(sourceSrc).not.toMatch(/from ["']@grpc/);
    expect(testSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(testSrc).not.toMatch(/read_chunk\(/);
  });
});

describe("createCpS3OfficeBinaryContentSource vs fake CP", () => {
  it("reads FakeS3 getObject bytes (utf-8 wire)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { source, ensureOnline, calls } = sourceFor(store);

    const result = await source.read({
      path: OFFICE_PATH,
      file_type: "docx",
      max_bytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.bytes).equals(Buffer.from(OFFICE_BYTES))).toBe(
      true,
    );
    expect(result.mime_type).toContain("wordprocessingml");
    expect(result.size_bytes).toBe(OFFICE_BYTES.byteLength);
    expect(result.path).toBe(OFFICE_PATH);
    expect(store.getGetCount()).toBeGreaterThan(0);
    expect(ensureOnline).not.toHaveBeenCalled();
    expect(calls.every((c) => !c.path.includes("ensure-online"))).toBe(true);
    expect(calls[0]?.path).toBe(VAULT_HTTP_API_PATHS.get(TENANT));
    expect(calls[0]?.tenantHeader).toBe(TENANT);
    expect(calls[0]?.serviceToken).toBe(SERVICE_TOKEN);
  });

  it("decodes base64 CP bodies without treating them as utf-8", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const wired = wiredCp(store);
    const requestFn = async (input: string, init?: RequestInit) => {
      const parsed = pathnameOf(String(input));
      if (parsed.path.endsWith("/vault/get")) {
        return new Response(
          JSON.stringify({
            tenant_id: TENANT,
            path: OFFICE_PATH,
            kind: "file",
            body: OFFICE_B64,
            encoding: "base64",
            content_type: OFFICE_MIME,
            size_bytes: OFFICE_BYTES.byteLength,
            s3_vault_prefix: PREFIX,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return wired.requestFn(input, init);
    };
    const source = createCpS3OfficeBinaryContentSource({
      tenantId: TENANT,
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    });
    const result = await source.read({
      path: OFFICE_PATH,
      file_type: "docx",
      max_bytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.bytes).equals(Buffer.from(OFFICE_BYTES))).toBe(
      true,
    );
  });

  it("returns missing_file for absent paths and directories", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { source } = sourceFor(store);
    expect(
      await source.read({
        path: "/Projects/Acme/missing.docx",
        file_type: "docx",
        max_bytes: 1024,
      }),
    ).toEqual({ ok: false, reason: "missing_file" });
    expect(
      await source.read({
        path: "/Projects/Acme",
        file_type: "docx",
        max_bytes: 1024,
      }),
    ).toEqual({ ok: false, reason: "missing_file" });
  });

  it("rejects oversized known size before CP get", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { source } = sourceFor(store);
    const result = await source.read({
      path: OFFICE_PATH,
      file_type: "docx",
      max_bytes: 8,
      known_size_bytes: 64,
    });
    expect(result).toEqual({ ok: false, reason: "oversized" });
    expect(store.getGetCount()).toBe(0);
  });

  it("rejects oversized CP payload", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`, "x".repeat(64), OFFICE_MIME);
    const { source } = sourceFor(store);
    const result = await source.read({
      path: OFFICE_PATH,
      file_type: "docx",
      max_bytes: 16,
    });
    expect(result).toEqual({ ok: false, reason: "oversized" });
  });

  it("does not return another tenant's object", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { source } = sourceFor(store);
    const result = await source.read({
      path: "/secret.docx",
      file_type: "docx",
      max_bytes: 1024,
    });
    expect(result).toEqual({ ok: false, reason: "missing_file" });
  });

  it("propagates CP cross-tenant prefix denial", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { requestFn } = wiredCp(store);
    const source = createCpS3OfficeBinaryContentSource({
      tenantId: TENANT,
      baseUrl: CP_BASE,
      requestFn: async (input, init) => {
        const parsed = pathnameOf(String(input));
        const url = new URL(parsed.path + parsed.search, CP_BASE);
        url.searchParams.set("prefix", OTHER_PREFIX);
        return requestFn(url.toString(), init);
      },
      serviceToken: SERVICE_TOKEN,
    });
    await expect(
      source.read({ path: OFFICE_PATH, file_type: "docx", max_bytes: 1024 }),
    ).rejects.toBeInstanceOf(ControlPlaneRequestError);
    await expect(
      source.read({ path: OFFICE_PATH, file_type: "docx", max_bytes: 1024 }),
    ).rejects.toMatchObject({ status: 403, code: "VAULT_CROSS_TENANT" });
  });
});

describe("GET /api/office/sessions/:id/content via CP getObject", () => {
  let store: OfficeDocumentSessionStore;

  afterEach(async () => {
    await store?.clear();
  });

  async function bootDownload() {
    const s3 = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(s3);
    const wired = wiredCp(s3);
    store = new MemoryOfficeDocumentSessionStore();
    const created = await store.create(baseCreate());
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          officeDocumentSessions: store,
          vaultPlane: "cp_s3",
          createCpS3OfficeBinarySource: (tenantId) =>
            createCpS3OfficeBinaryContentSource({
              tenantId,
              baseUrl: CP_BASE,
              requestFn: wired.requestFn,
              serviceToken: SERVICE_TOKEN,
            }),
        },
      ),
    );
    return { app, created, wired, s3 };
  }

  it("streams fake CP bytes for a signed GET", async () => {
    const { app, created, wired, s3 } = await bootDownload();
    const url = `/api/office/sessions/${created.session.session_id}/content?token=${encodeURIComponent(created.download_token)}`;
    const res = await app.request(url, {
      headers: { host: tenant.host },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(body).equals(Buffer.from(OFFICE_BYTES))).toBe(true);
    expect(Buffer.from(body).toString("utf8")).toBe(OFFICE_UNIQUE);
    expect(s3.getGetCount()).toBeGreaterThan(0);
    expect(wired.ensureOnline).not.toHaveBeenCalled();
    expect(wired.calls.some((c) => c.path.endsWith("/vault/get"))).toBe(true);
    expect(
      wired.calls.every((c) => !c.path.includes("ensure-online")),
    ).toBe(true);
  });

  it("does not log the full base64 body on success", async () => {
    const lines: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => String(a)).join(" "));
      });
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => String(a)).join(" "));
      });
    try {
      const { app, created } = await bootDownload();
      const url = `/api/office/sessions/${created.session.session_id}/content?token=${encodeURIComponent(created.download_token)}`;
      const res = await app.request(url, {
        headers: { host: tenant.host },
      });
      expect(res.status).toBe(200);
      const streamed = Buffer.from(await res.arrayBuffer());
      expect(streamed.equals(Buffer.from(OFFICE_BYTES))).toBe(true);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
    const dumped = lines.join("\n");
    expect(dumped).not.toContain(OFFICE_B64);
    expect(dumped).not.toContain(OFFICE_UNIQUE);
    expect(dumped).not.toContain("download-token-office-cp-s3");
  });

  it("explicit officeBinarySource still wins on the default vault plane", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const created = await store.create(baseCreate());
    const s3 = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(s3);
    const wired = wiredCp(s3);
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          officeDocumentSessions: store,
          officeBinarySource: createCpS3OfficeBinaryContentSource({
            tenantId: TENANT,
            baseUrl: CP_BASE,
            requestFn: wired.requestFn,
            serviceToken: SERVICE_TOKEN,
          }),
        },
      ),
    );
    // Explicit officeBinarySource wins even when vaultPlane is default fs.
    const res = await app.request(
      `/api/office/sessions/${created.session.session_id}/content?token=${encodeURIComponent(created.download_token)}`,
      { headers: { host: tenant.host } },
    );
    expect(res.status).toBe(200);
    expect(s3.getGetCount()).toBeGreaterThan(0);
  });
});
