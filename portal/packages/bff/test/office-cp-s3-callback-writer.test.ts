/**
 * lp-zuh.12.7 — Office callback vault.write via CP vault/put (VaultPlane=cp_s3).
 * CAS on FakeS3. No @aws-sdk in BFF. No Brain RPC vault.write.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
import { VAULT_HTTP_API_PATHS } from "../../control-plane/src/vault-http.js";
import { buildS3VaultPrefix } from "../../control-plane/src/vault-prefix.js";
import { createApp } from "../src/app.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/control-plane-client.js";
import {
  createCpS3OfficeCallbackVaultWriter,
  handleOfficeCallback,
  MemoryOfficeDocumentSessionStore,
  type CreateOfficeDocumentSessionInput,
  type DocumentRevision,
  type OfficeCallbackFetcher,
} from "../src/office/index.js";
import { VAULT_CP_HTTP_PATHS } from "../src/vault/cp-s3-provider.js";
import type { TenantContext } from "../src/types.js";
import { createTestBindings } from "./test-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const writerSrc = readFileSync(
  join(__dirname, "../src/office/cp-s3-callback-writer.ts"),
  "utf8",
);
const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const testSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
const bffPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT);
const OTHER_PREFIX = buildS3VaultPrefix(OTHER_TENANT);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");
const CP_BASE = "http://control-plane.test";
const SERVICE_TOKEN = "test-cp-service-token";

const OFFICE_PATH = "/Projects/Acme/proposal.docx";
const OFFICE_V1 = "PK-fake-office-cp-s3-v1-UNIQUE";
const OFFICE_V2 = "PK-fake-office-cp-s3-v2-AFTER-SAVE";
const OFFICE_BYTES_V2 = new TextEncoder().encode(OFFICE_V2);
const OFFICE_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function contentHash(body: string): string {
  return createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
}

const REVISION: DocumentRevision = {
  token: contentHash(OFFICE_V1),
  kind: "content_hash",
  size_bytes: Buffer.byteLength(OFFICE_V1, "utf8"),
};

const tenant: TenantContext = {
  tenant_id: TENANT,
  tenant_slug: "office-cp-put",
  display_name: "Office CP Put",
  host: "office-cp-put.withlanyard.com",
};

const ALLOWLIST = {
  hosts: ["onlyoffice", "documentserver", "localhost"],
  schemes: ["http", "https"],
};

const DS_URL = "http://onlyoffice/cache/files/output.docx";

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
  store.seed(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`, OFFICE_V1, OFFICE_MIME);
  store.seed(
    BUCKET,
    `${OTHER_PREFIX}Projects/Acme/proposal.docx`,
    "other-tenant-secret-docx",
    OFFICE_MIME,
  );
}

function wiredCp(store: FakeS3ObjectStore) {
  const ensureOnline = vi.fn(async () => {
    throw new Error("Daytona wake must not run on vault put (lp-zuh.12.7)");
  });
  const cp = createControlPlaneApp(mockStore(), {
    devOpen: true,
    vaultObjectStore: store,
    vaultBucket: BUCKET,
    instanceOrchestrator: {
      ensureOnline,
      stop: vi.fn(),
    },
  });
  const calls: Array<{
    method: string;
    path: string;
    tenantHeader: string | null;
    serviceToken: string | null;
  }> = [];
  const requestFn = async (input: string, init?: RequestInit) => {
    const parsed = pathnameOf(String(input));
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: parsed.path,
      tenantHeader: headerGet(init?.headers, "x-lanyard-tenant-id"),
      serviceToken: headerGet(
        init?.headers,
        CONTROL_PLANE_SERVICE_TOKEN_HEADER,
      ),
    });
    const url = `http://cp.local${parsed.path}${parsed.search}`;
    return cp.request(url, init);
  };
  return { requestFn, ensureOnline, calls };
}

function baseCreate(
  overrides: Partial<CreateOfficeDocumentSessionInput> = {},
): CreateOfficeDocumentSessionInput {
  return {
    tenant_id: TENANT,
    user_id: "user-1",
    path: OFFICE_PATH,
    revision: REVISION,
    mode: "edit",
    file_type: "docx",
    document_key: "dk-v1-office-cp-put",
    download_token: "download-token-secret-value",
    callback_nonce: "callback-nonce-office-cp-put",
    download_ttl_seconds: 120,
    ...overrides,
  };
}

describe("CpS3 Office callback writer catalog (lp-zuh.12.7)", () => {
  it("wires CP vault/put and is selected on VaultPlane=cp_s3", () => {
    expect(VAULT_CP_HTTP_PATHS.put(TENANT)).toBe(VAULT_HTTP_API_PATHS.put(TENANT));
    expect(writerSrc).toMatch(/vault\/put/);
    expect(writerSrc).toMatch(/Never log the file body/);
    expect(writerSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(writerSrc).not.toMatch(/invokeBrainRpc/);
    expect(appSrc).toMatch(/createCpS3OfficeCallbackVaultWriter/);
    expect(indexSrc).toMatch(/createCpS3OfficeCallbackVaultWriter/);
  });

  it("does not add an S3 AWS SDK to BFF", () => {
    const deps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(deps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(testSrc).not.toMatch(/from ["']@aws-sdk/);
  });
});

describe("createCpS3OfficeCallbackVaultWriter vs fake CP", () => {
  it("replace_if_match writes new DocumentRevision via CP put", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { requestFn, ensureOnline, calls } = wiredCp(store);
    const writer = createCpS3OfficeCallbackVaultWriter({
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    });

    const sessionStore = new MemoryOfficeDocumentSessionStore();
    const { session } = await sessionStore.create(baseCreate());

    const result = await writer({
      session,
      params: {
        path: OFFICE_PATH,
        mode: "replace_if_match",
        expectedRevision: REVISION,
        ifMatch: REVISION.token,
        encoding: "base64",
        content: Buffer.from(OFFICE_BYTES_V2).toString("base64"),
        mimeType: OFFICE_MIME,
        sizeBytes: OFFICE_BYTES_V2.byteLength,
        idempotencyKey: "office-cb:sess-cp-put-1:2:deadbeef",
      },
    });

    expect(result.source).toBe("cp_s3");
    expect(result.revision.kind).toBe("content_hash");
    expect(result.revision.token).toBe(contentHash(OFFICE_V2));
    expect(result.revision.token).not.toBe(REVISION.token);
    expect(store.get(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`)?.body).toBe(
      OFFICE_V2,
    );
    expect(ensureOnline).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "PUT" && c.path.endsWith("/vault/put"))).toBe(
      true,
    );
    expect(calls[0]?.tenantHeader).toBe(TENANT);
    expect(calls[0]?.serviceToken).toBe(SERVICE_TOKEN);
  });

  it("maps CP CAS conflict to writer conflict", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { requestFn } = wiredCp(store);
    const writer = createCpS3OfficeCallbackVaultWriter({
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    });
    const sessionStore = new MemoryOfficeDocumentSessionStore();
    const { session } = await sessionStore.create(baseCreate());

    await expect(
      writer({
        session,
        params: {
          path: OFFICE_PATH,
          mode: "replace_if_match",
          ifMatch: "wrong-token",
          encoding: "base64",
          content: Buffer.from(OFFICE_BYTES_V2).toString("base64"),
          sizeBytes: OFFICE_BYTES_V2.byteLength,
          idempotencyKey: "office-cb:conflict:2:x",
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("office callback pipeline with cp_s3 writer (lp-zuh.12.7)", () => {
  it("status 2 save produces new DocumentRevision on vault path", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { requestFn } = wiredCp(store);
    const writer = createCpS3OfficeCallbackVaultWriter({
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    });
    const sessionStore = new MemoryOfficeDocumentSessionStore();
    const { session } = await sessionStore.create(baseCreate());

    const fetchBytes: OfficeCallbackFetcher = async () => ({
      ok: true,
      bytes: OFFICE_BYTES_V2,
    });

    const result = await handleOfficeCallback({
      tenant_id: TENANT,
      session_id: session.session_id,
      nonce: session.callback_nonce,
      rawBody: { status: 2, url: DS_URL, key: session.document_key },
      store: sessionStore,
      allowlist: ALLOWLIST,
      fetchBytes,
      writeVault: writer,
      maxBytes: 1024 * 1024,
    });

    expect(result.body.error).toBe(0);
    expect(result.body.code).toBe("saved");
    expect(result.save?.status).toBe("saved");
    expect(result.save?.new_revision?.token).toBe(contentHash(OFFICE_V2));
    expect(store.get(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`)?.body).toBe(
      OFFICE_V2,
    );

    const after = await sessionStore.get(session.session_id);
    expect(after?.lifecycle).toBe("saved");
    expect(after?.saved_revision?.token).toBe(contentHash(OFFICE_V2));
  });

  it("createApp uses cp_s3 writer when vaultPlane=cp_s3 (not Brain RPC)", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedOfficeVault(store);
    const { requestFn, calls } = wiredCp(store);
    const sessionStore = new MemoryOfficeDocumentSessionStore();
    const { session } = await sessionStore.create(baseCreate());

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          vaultPlane: "cp_s3",
          officeDocumentSessions: sessionStore,
          officeCanVaultEdit: true,
          officeDocumentServerAllowlist: ALLOWLIST,
          officeCallbackFetcher: async () => ({
            ok: true,
            bytes: OFFICE_BYTES_V2,
          }),
          createCpS3OfficeCallbackVaultWriter: () =>
            createCpS3OfficeCallbackVaultWriter({
              baseUrl: CP_BASE,
              requestFn,
              serviceToken: SERVICE_TOKEN,
            }),
        },
      ),
    );

    const res = await app.request(
      `/api/office/callback?session_id=${encodeURIComponent(session.session_id)}&nonce=${encodeURIComponent(session.callback_nonce)}`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: 2,
          url: DS_URL,
          key: session.document_key,
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: number; code?: string };
    expect(body.error).toBe(0);
    expect(body.code).toBe("saved");
    expect(calls.some((c) => c.path.endsWith("/vault/put"))).toBe(true);
    expect(store.get(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`)?.body).toBe(
      OFFICE_V2,
    );
  });
});
