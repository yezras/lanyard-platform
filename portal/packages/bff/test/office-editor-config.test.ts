/**
 * lp-5q6.26 — BFF: mint ONLYOFFICE editor config and JWT.
 *
 * Acceptance:
 * - BFF creates/retrieves Office session and returns editor config
 * - Config includes documentType, fileType, title, url, key, permissions,
 *   user, callbackUrl, and token
 * - JWT secret from config; rejected if missing in production mode
 * - Permissions from ui.can.vault_edit, user access, file type, session mode
 * - Tests: view-only, edit, unsupported type, missing write capability,
 *   bad path, JWT shape
 */
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  DEV_OFFICE_JWT_SECRET,
  DEV_OFFICE_PUBLIC_BASE_URL,
  buildOnlyOfficeEditorConfig,
  documentTypeForFileType,
  fileTypeFromPath,
  loadOfficeJwtSecret,
  loadOfficePublicBaseUrl,
  mintOfficeEditorSession,
  resolveOfficePermissions,
  verifyOnlyOfficeEditorJwt,
  MemoryOfficeDocumentSessionStore,
  type DocumentRevision,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import type { VaultContentProvider } from "../src/vault/types.js";
import type { TenantContext } from "../src/types.js";
import { SessionStore } from "../src/session.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";
import type { UserRbac } from "../src/control-plane-client.js";

const JWT_SECRET = "test-onlyoffice-jwt-secret-for-unit-tests";
const PUBLIC_BASE = "http://bff.test:4000";

const REVISION: DocumentRevision = {
  token: "rev-content-hash-abc123",
  kind: "content_hash",
  size_bytes: 64,
};

const DOCX_PATH = "/Projects/Acme/proposal.docx";
const PDF_PATH = "/Projects/Acme/overview.pdf";
const DOCX_BYTES = new TextEncoder().encode("PK-fake-docx-for-mint-test");

function memoryVault(
  files: Record<string, { content: string; encoding?: "utf-8" | "base64" }>,
): VaultContentProvider {
  return {
    async listEntries() {
      return [];
    },
    async readFile(path: string) {
      const entry = files[path];
      if (!entry) return null;
      const encoding = entry.encoding ?? "utf-8";
      const size =
        encoding === "base64"
          ? Buffer.from(entry.content, "base64").byteLength
          : Buffer.byteLength(entry.content, "utf8");
      return {
        path,
        kind: "file" as const,
        mime_type: "application/octet-stream",
        encoding,
        content: entry.content,
        size_bytes: size,
      };
    },
    async getTree() {
      return [];
    },
  };
}

const vaultWithDocx = memoryVault({
  [DOCX_PATH]: {
    content: Buffer.from(DOCX_BYTES).toString("base64"),
    encoding: "base64",
  },
  [PDF_PATH]: {
    content: Buffer.from("%PDF-1.4 mint-test").toString("base64"),
    encoding: "base64",
  },
});

describe("office editor config helpers", () => {
  it("maps file types to documentType", () => {
    expect(documentTypeForFileType("docx")).toBe("word");
    expect(documentTypeForFileType("xlsx")).toBe("cell");
    expect(documentTypeForFileType("pptx")).toBe("slide");
    expect(documentTypeForFileType("pdf")).toBe("pdf");
  });

  it("derives file type from path", () => {
    expect(fileTypeFromPath("/a/b/c.docx")).toBe("docx");
    expect(fileTypeFromPath("/a/b/c.txt")).toBeNull();
    expect(fileTypeFromPath("/a/b/noext")).toBeNull();
  });

  it("view mode never grants edit even when vault_edit is true", () => {
    const p = resolveOfficePermissions({
      mode: "view",
      vault_edit: true,
      file_type: "docx",
    });
    expect(p.edit).toBe(false);
    expect(p.download).toBe(true);
  });

  it("edit mode + vault_edit + docx grants edit", () => {
    const p = resolveOfficePermissions({
      mode: "edit",
      vault_edit: true,
      file_type: "docx",
    });
    expect(p.edit).toBe(true);
    expect(p.review).toBe(true);
  });

  it("pdf never grants edit permissions", () => {
    const p = resolveOfficePermissions({
      mode: "edit",
      vault_edit: true,
      file_type: "pdf",
    });
    expect(p.edit).toBe(false);
  });

  it("rejects missing JWT secret in production", () => {
    expect(() =>
      loadOfficeJwtSecret({ NODE_ENV: "production" }),
    ).toThrow(/BFF_OFFICE_JWT_SECRET/);
    expect(() =>
      loadOfficeJwtSecret({
        NODE_ENV: "production",
        BFF_OFFICE_JWT_SECRET: DEV_OFFICE_JWT_SECRET,
      }),
    ).toThrow(/non-development/);
  });

  it("allows lab default JWT secret outside production", () => {
    const cfg = loadOfficeJwtSecret({ NODE_ENV: "development" });
    expect(cfg.secret).toBe(DEV_OFFICE_JWT_SECRET);
    expect(cfg.isDevPlaceholder).toBe(true);
  });

  it("requires public base URL in production", () => {
    expect(() =>
      loadOfficePublicBaseUrl({ NODE_ENV: "production" }),
    ).toThrow(/BFF_OFFICE_PUBLIC_BASE_URL/);
  });

  it("defaults public base URL for lab", () => {
    expect(loadOfficePublicBaseUrl({ NODE_ENV: "development" })).toBe(
      DEV_OFFICE_PUBLIC_BASE_URL,
    );
  });

  it("builds config and JWT with required claims (JWT shape)", async () => {
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    const config = await buildOnlyOfficeEditorConfig({
      file_type: "docx",
      document_key: "a".repeat(64),
      title: "proposal.docx",
      document_url: `${PUBLIC_BASE}/api/office/sessions/s1/content?token=t`,
      callback_url: `${PUBLIC_BASE}/api/office/callback?session_id=s1&nonce=n`,
      mode: "edit",
      vault_edit: true,
      user_id: "user-1",
      user_name: "alice",
      expires_at: expires,
      jwt_secret: JWT_SECRET,
    });

    expect(config.documentType).toBe("word");
    expect(config.document.fileType).toBe("docx");
    expect(config.document.title).toBe("proposal.docx");
    expect(config.document.url).toContain("/content?token=");
    expect(config.document.key).toHaveLength(64);
    expect(config.document.permissions.edit).toBe(true);
    expect(config.editorConfig.callbackUrl).toContain("nonce=");
    expect(config.editorConfig.user).toEqual({ id: "user-1", name: "alice" });
    expect(config.editorConfig.mode).toBe("edit");
    expect(config.token.split(".")).toHaveLength(3);

    const claims = await verifyOnlyOfficeEditorJwt(config.token, JWT_SECRET);
    expect(claims.documentType).toBe("word");
    expect(claims.document.fileType).toBe("docx");
    expect(claims.document.permissions.edit).toBe(true);
    expect(claims.editorConfig.user.id).toBe("user-1");
    expect(claims.editorConfig.callbackUrl).toContain("callback");
    expect(claims.exp).toBeTypeOf("number");
    expect(claims.iat).toBeTypeOf("number");
    expect(claims.exp!).toBeGreaterThan(claims.iat!);
  });
});

describe("mintOfficeEditorSession", () => {
  let store: OfficeDocumentSessionStore;

  afterEach(async () => {
    await store?.clear();
  });

  function deps(
    overrides: Partial<Parameters<typeof mintOfficeEditorSession>[1]> = {},
  ) {
    store = new MemoryOfficeDocumentSessionStore();
    return {
      store,
      vaultContentProvider: vaultWithDocx,
      tenant_id: "tenant-a",
      user_id: "user-1",
      user_email: "alice@example.com",
      vault_edit: true,
      path_allowed: true,
      public_base_url: PUBLIC_BASE,
      jwt_secret: JWT_SECRET,
      ...overrides,
    };
  }

  it("returns view-only config when mode is view", async () => {
    const result = await mintOfficeEditorSession(
      { path: DOCX_PATH, mode: "view" },
      deps({ vault_edit: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mode).toBe("view");
    expect(result.editor_config.documentType).toBe("word");
    expect(result.editor_config.document.fileType).toBe("docx");
    expect(result.editor_config.document.title).toBe("proposal.docx");
    expect(result.editor_config.document.url).toContain(
      "/api/office/sessions/",
    );
    expect(result.editor_config.document.url).toContain("token=");
    expect(result.editor_config.document.key).toBe(result.document_key);
    expect(result.editor_config.document.permissions.edit).toBe(false);
    expect(result.editor_config.editorConfig.mode).toBe("view");
    expect(result.editor_config.editorConfig.callbackUrl).toContain(
      "session_id=",
    );
    expect(result.editor_config.editorConfig.user.id).toBe("user-1");
    expect(result.editor_config.token).toBeTruthy();

    const claims = await verifyOnlyOfficeEditorJwt(
      result.editor_config.token,
      JWT_SECRET,
    );
    expect(claims.document.permissions.edit).toBe(false);
  });

  it("returns edit config when mode is edit and vault_edit is true", async () => {
    const result = await mintOfficeEditorSession(
      { path: DOCX_PATH, mode: "edit", caller_key: "open-1" },
      deps({ vault_edit: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mode).toBe("edit");
    expect(result.editor_config.document.permissions.edit).toBe(true);
    expect(result.editor_config.editorConfig.mode).toBe("edit");
    expect(result.idempotent_replay).toBe(false);

    // Retrieve same session by caller_key
    const again = await mintOfficeEditorSession(
      { path: DOCX_PATH, mode: "edit", caller_key: "open-1" },
      deps({ store, vault_edit: true }),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.session_id).toBe(result.session_id);
    expect(again.idempotent_replay).toBe(true);
    expect(again.editor_config.document.url).toContain("token=");
  });

  it("denies unsupported file type", async () => {
    const result = await mintOfficeEditorSession(
      { path: "/Projects/Acme/notes.txt", mode: "view" },
      deps(),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported_file_type",
      status: 400,
    });
  });

  it("denies missing vault file with 422 (not 404 — CF SPA must not mask JSON)", async () => {
    const result = await mintOfficeEditorSession(
      { path: "/Projects/Acme/missing-report.docx", mode: "view" },
      deps({ vaultContentProvider: memoryVault({}) }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "missing_file",
      status: 422,
    });
  });

  it("denies edit mode when write capability is missing", async () => {
    const result = await mintOfficeEditorSession(
      { path: DOCX_PATH, mode: "edit" },
      deps({ vault_edit: false }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "missing_write_capability",
      status: 403,
    });
  });

  it("denies bad path (traversal)", async () => {
    const result = await mintOfficeEditorSession(
      { path: "/Projects/../etc/passwd.docx", mode: "view" },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_path");
    expect(result.status).toBe(400);
  });

  it("denies ACL when path not allowed", async () => {
    const result = await mintOfficeEditorSession(
      { path: DOCX_PATH, mode: "view" },
      deps({ path_allowed: false }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "acl_denied",
      status: 403,
    });
  });

  it("denies edit mode for pdf (not editable)", async () => {
    const result = await mintOfficeEditorSession(
      { path: PDF_PATH, mode: "edit" },
      deps({ vault_edit: true }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "file_type_not_editable",
      status: 400,
    });
  });

  it("allows pdf view-only", async () => {
    const result = await mintOfficeEditorSession(
      { path: PDF_PATH, mode: "view" },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.editor_config.documentType).toBe("pdf");
    expect(result.editor_config.document.permissions.edit).toBe(false);
  });

  it("uses client-supplied revision when provided", async () => {
    const result = await mintOfficeEditorSession(
      {
        path: DOCX_PATH,
        mode: "view",
        revision: REVISION,
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base_revision.token).toBe(REVISION.token);
    expect(result.document_key).toHaveLength(64);
  });
});

describe("POST /api/office/sessions", () => {
  const tenantA: TenantContext = {
    tenant_id: "tenant-a",
    tenant_slug: "alpha",
    display_name: "Alpha",
    host: "alpha.withlanyard.com",
  };

  const rbac: UserRbac = {
    user_id: "user-1",
    tenant_id: "tenant-a",
    hermes_profile: "default",
    allowed_path_prefixes: ["/Projects"],
    role_names: ["member"],
  };

  async function makeAuthedApp(options: {
    vault_edit: boolean;
    files?: VaultContentProvider;
  }) {
    const sessions = new SessionStore();
    const officeStore = new MemoryOfficeDocumentSessionStore();
    const session = await sessions.create({
      userId: "user-1",
      tenantId: "tenant-a",
      email: "alice@example.com",
    });

    const authClient = {
      getUserRbac: async () => rbac,
    };

    const app = createApp(
      createTestBindings(
        { alpha: tenantA },
        {
          sessions,
          officeDocumentSessions: officeStore,
          officeCanVaultEdit: options.vault_edit,
          officeJwtSecret: JWT_SECRET,
          officePublicBaseUrl: PUBLIC_BASE,
          vaultContentProvider: options.files ?? vaultWithDocx,
          authClient: authClient as never,
        },
      ),
    );

    const csrf = "test-csrf-token-office-mint";
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: csrf,
    };

    return { app, cookies, csrf, officeStore };
  }

  it("mints edit config for authorized user", async () => {
    const { app, cookies, csrf } = await makeAuthedApp({ vault_edit: true });
    const res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ path: DOCX_PATH, mode: "edit" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      session_id: string;
      document_key: string;
      editor_config: {
        documentType: string;
        document: {
          fileType: string;
          title: string;
          url: string;
          key: string;
          permissions: { edit: boolean };
        };
        editorConfig: {
          mode: string;
          callbackUrl: string;
          user: { id: string; name: string };
        };
        token: string;
      };
    };

    expect(body.session_id).toBeTruthy();
    expect(body.document_key).toHaveLength(64);
    expect(body.editor_config.documentType).toBe("word");
    expect(body.editor_config.document.fileType).toBe("docx");
    expect(body.editor_config.document.title).toBe("proposal.docx");
    expect(body.editor_config.document.url).toContain("token=");
    expect(body.editor_config.document.key).toBe(body.document_key);
    expect(body.editor_config.document.permissions.edit).toBe(true);
    expect(body.editor_config.editorConfig.callbackUrl).toContain("nonce=");
    expect(body.editor_config.editorConfig.user.id).toBe("user-1");
    expect(body.editor_config.token.split(".")).toHaveLength(3);

    // JWT must not appear in a way that equals download secrets accidentally
    expect(JSON.stringify(body)).not.toContain(JWT_SECRET);
  });

  it("returns 403 when edit requested without vault_edit", async () => {
    const { app, cookies, csrf } = await makeAuthedApp({ vault_edit: false });
    const res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ path: DOCX_PATH, mode: "edit" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string; error?: string };
    const msg = body.message ?? body.error ?? "";
    expect(msg.toLowerCase()).toMatch(/vault_edit|write|edit/);
  });

  it("returns 400 for unsupported type", async () => {
    const { app, cookies, csrf } = await makeAuthedApp({ vault_edit: true });
    const res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        path: "/Projects/Acme/notes.md",
        mode: "view",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for bad path", async () => {
    const { app, cookies, csrf } = await makeAuthedApp({ vault_edit: true });
    const res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        path: "/Projects/../../etc/shadow.docx",
        mode: "view",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when path outside ACL", async () => {
    const { app, cookies, csrf } = await makeAuthedApp({ vault_edit: true });
    const res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        path: "/Secrets/hidden.docx",
        mode: "view",
      }),
    });
    expect(res.status).toBe(403);
  });
});
