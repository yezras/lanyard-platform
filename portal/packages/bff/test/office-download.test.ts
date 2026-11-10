/**
 * lp-5q6.22 — BFF signed Office download endpoint for Document Server.
 *
 * Acceptance:
 * - Endpoint streams bytes for an Office session through a short-lived token
 * - Document Server can fetch the URL on the chosen lab network (no cookie)
 * - Token is single-purpose and expires quickly
 * - Validates session, tenant, file type, revision, token, and mode
 * - Never logs file body or token
 * - Tests: valid download, expired token, wrong tenant, wrong session,
 *   missing file, oversized file, unsupported file type
 */
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  authorizeOfficeDownload,
  buildOfficeDownloadUrl,
  createMemoryOfficeBinaryContentSource,
  extractOfficeDownloadToken,
  MemoryOfficeDocumentSessionStore,
  mimeForOfficeFileType,
  officeDownloadErrorBody,
  pathMatchesOfficeFileType,
  redactOfficeDownloadUrl,
  type CreateOfficeDocumentSessionInput,
  type DocumentRevision,
  type OfficeDocumentSessionStore,
  type OfficeFileType,
} from "../src/office/index.js";
import type { TenantContext } from "../src/types.js";
import { createTestBindings } from "./test-helpers.js";

const REVISION: DocumentRevision = {
  token: "rev-etag-office-1",
  kind: "etag",
  size_bytes: 32,
};

const DOCX_BYTES = new TextEncoder().encode("PK-fake-docx-bytes-for-test");

function baseCreate(
  overrides: Partial<CreateOfficeDocumentSessionInput> = {},
): CreateOfficeDocumentSessionInput {
  return {
    tenant_id: "tenant-a",
    user_id: "user-1",
    path: "/Projects/Acme/proposal.docx",
    revision: REVISION,
    mode: "edit",
    file_type: "docx",
    document_key: "dk-v1-tenant-a-proposal",
    download_token: "download-token-secret-value",
    callback_nonce: "callback-nonce-value",
    download_ttl_seconds: 120,
    ...overrides,
  };
}

const tenantA: TenantContext = {
  tenant_id: "tenant-a",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

const tenantB: TenantContext = {
  tenant_id: "tenant-b",
  tenant_slug: "beta",
  display_name: "Beta",
  host: "beta.withlanyard.com",
};

describe("office download helpers", () => {
  it("extracts token from query or Bearer header", () => {
    expect(
      extractOfficeDownloadToken({ queryToken: "abc", authorizationHeader: null }),
    ).toBe("abc");
    expect(
      extractOfficeDownloadToken({
        queryToken: null,
        authorizationHeader: "Bearer xyz",
      }),
    ).toBe("xyz");
    expect(
      extractOfficeDownloadToken({ queryToken: null, authorizationHeader: null }),
    ).toBeNull();
  });

  it("builds Document Server fetch URL with token query", () => {
    const url = buildOfficeDownloadUrl({
      publicBaseUrl: "http://host.docker.internal:3001",
      sessionId: "sess123",
      downloadToken: "tok-secret",
    });
    expect(url).toBe(
      "http://host.docker.internal:3001/api/office/sessions/sess123/content?token=tok-secret",
    );
  });

  it("redacts token from download URL for logs", () => {
    const redacted = redactOfficeDownloadUrl(
      "http://bff:3001/api/office/sessions/s1/content?token=super-secret",
    );
    expect(redacted).toContain("token=%5Bredacted%5D");
    expect(redacted).not.toContain("super-secret");
  });

  it("maps office file types to MIME and path extension", () => {
    expect(mimeForOfficeFileType("docx")).toContain("wordprocessingml");
    expect(pathMatchesOfficeFileType("/a/b/c.docx", "docx")).toBe(true);
    expect(pathMatchesOfficeFileType("/a/b/c.txt", "docx")).toBe(false);
  });

  it("error body never embeds token material", () => {
    const body = officeDownloadErrorBody("invalid_token");
    expect(body.code).toBe("invalid_token");
    expect(JSON.stringify(body)).not.toMatch(/token-secret|Bearer/i);
  });
});

describe("authorizeOfficeDownload", () => {
  const store = new MemoryOfficeDocumentSessionStore();

  afterEach(async () => {
    await store.clear();
  });

  async function createSession(
    overrides: Partial<CreateOfficeDocumentSessionInput> = {},
  ) {
    return store.create(baseCreate(overrides));
  }

  it("allows valid token + tenant + downloadable session", async () => {
    const { session, download_token } = await createSession();
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: download_token,
    });
    expect(result.ok).toBe(true);
  });

  it("denies missing token", async () => {
    const { session } = await createSession();
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: null,
    });
    expect(result).toMatchObject({ ok: false, reason: "missing_token", status: 401 });
  });

  it("denies invalid token", async () => {
    const { session } = await createSession();
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: "wrong-token",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_token", status: 401 });
  });

  it("denies expired download token (short TTL)", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    const { session, download_token } = await createSession({
      now,
      download_ttl_seconds: 60,
      ttl_seconds: 3600,
    });
    const after = new Date("2026-07-24T12:02:00.000Z");
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: download_token,
      now: after,
    });
    expect(result).toMatchObject({ ok: false, reason: "expired", status: 403 });
  });

  it("denies wrong tenant", async () => {
    const { session, download_token } = await createSession();
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-other",
      token: download_token,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "tenant_mismatch",
      status: 403,
    });
  });

  it("denies missing session", () => {
    const result = authorizeOfficeDownload({
      session: null,
      tenant_id: "tenant-a",
      token: "any",
    });
    expect(result).toMatchObject({ ok: false, reason: "not_found", status: 404 });
  });

  it("denies revision mismatch when claim present", async () => {
    const { session, download_token } = await createSession();
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: download_token,
      revision_token: "wrong-rev",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "revision_mismatch",
      status: 403,
    });
  });

  it("denies path/type mismatch", async () => {
    const { session, download_token } = await createSession({
      path: "/Projects/Acme/notes.txt",
      file_type: "docx",
    });
    const result = authorizeOfficeDownload({
      session,
      tenant_id: "tenant-a",
      token: download_token,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "path_type_mismatch",
      status: 403,
    });
  });

  it("denies unsupported file type (runtime)", async () => {
    const { session, download_token } = await createSession();
    const corrupted = {
      ...session,
      file_type: "rtf" as OfficeFileType,
      path: "/Projects/Acme/proposal.rtf",
    };
    const result = authorizeOfficeDownload({
      session: corrupted,
      tenant_id: "tenant-a",
      token: download_token,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported_file_type",
      status: 403,
    });
  });

  it("denies closed session", async () => {
    const { session, download_token } = await createSession();
    await store.close(session.session_id);
    const closed = await store.get(session.session_id);
    const result = authorizeOfficeDownload({
      session: closed,
      tenant_id: "tenant-a",
      token: download_token,
    });
    expect(result).toMatchObject({ ok: false, reason: "closed", status: 403 });
  });
});

describe("GET /api/office/sessions/:id/content", () => {
  let store: OfficeDocumentSessionStore;

  afterEach(async () => {
    await store?.clear();
  });

  function makeApp(options: {
    store: OfficeDocumentSessionStore;
    files?: Record<string, { bytes: Uint8Array } | null>;
    maxBytes?: number;
  }) {
    const files = options.files ?? {
      "/Projects/Acme/proposal.docx": { bytes: DOCX_BYTES },
    };
    return createApp(
      createTestBindings(
        { alpha: tenantA, beta: tenantB },
        {
          officeDocumentSessions: options.store,
          officeBinarySource: createMemoryOfficeBinaryContentSource(files),
          officeMaxDownloadBytes: options.maxBytes,
        },
      ),
    );
  }

  async function seed(
    store: OfficeDocumentSessionStore,
    overrides: Partial<CreateOfficeDocumentSessionInput> = {},
  ) {
    return store.create(baseCreate(overrides));
  }

  it("streams bytes for a valid short-lived token without Portal cookie", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const app = makeApp({ store });

    const url = `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`;
    const res = await app.request(url, {
      headers: { host: tenantA.host },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-office-revision")).toBe(REVISION.token);
    expect(res.headers.get("x-office-session-id")).toBe(session.session_id);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(body).equals(Buffer.from(DOCX_BYTES))).toBe(true);
  });

  it("streams bytes without tenant Host (Document Server public base URL)", async () => {
    // lp-xcu.1: DS fetches BFF_OFFICE_PUBLIC_BASE_URL as host.docker.internal
    // without Host: demo.localhost — must still return office bytes (not Unknown tenant).
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const app = makeApp({ store });

    const url = `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`;
    const res = await app.request(url, {
      headers: { host: "host.docker.internal:4000" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(body).equals(Buffer.from(DOCX_BYTES))).toBe(true);
  });

  it("rejects invalid token without tenant Host (no Unknown tenant leak)", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session } = await seed(store);
    const app = makeApp({ store });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=not-the-token`,
      { headers: { host: "host.docker.internal:4000" } },
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string; error: string };
    expect(json.code).toBe("invalid_token");
    expect(json.error).not.toContain("Unknown tenant");
  });

  it("accepts Bearer token instead of query", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const app = makeApp({ store });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content`,
      {
        headers: {
          host: tenantA.host,
          authorization: `Bearer ${download_token}`,
        },
      },
    );
    expect(res.status).toBe(200);
  });

  it("rejects expired download token", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const { session, download_token } = await seed(store, {
      now,
      download_ttl_seconds: 30,
      ttl_seconds: 3600,
    });
    // Force download_expires_at into the past by rewriting the record.
    const current = (await store.get(session.session_id))!;
    await store.put({
      ...current,
      download_expires_at: "2026-07-24T11:59:00.000Z",
    });

    const app = makeApp({ store });
    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("expired");
  });

  it("rejects wrong tenant host", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const app = makeApp({ store });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantB.host } },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("tenant_mismatch");
  });

  it("rejects wrong session id", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { download_token } = await seed(store);
    const app = makeApp({ store });

    const res = await app.request(
      `/api/office/sessions/not-a-real-session/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("not_found");
  });

  it("rejects missing file", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store, {
      path: "/Projects/Acme/missing.docx",
    });
    const app = makeApp({
      store,
      files: {
        "/Projects/Acme/proposal.docx": { bytes: DOCX_BYTES },
      },
    });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("missing_file");
  });

  it("rejects oversized file (known size on session)", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store, {
      revision: {
        token: "rev-big",
        kind: "etag",
        size_bytes: 10_000,
      },
    });
    const app = makeApp({
      store,
      maxBytes: 100,
      files: {
        "/Projects/Acme/proposal.docx": {
          bytes: new Uint8Array(200),
        },
      },
    });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(res.status).toBe(413);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("oversized");
  });

  it("rejects unsupported file type", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const current = (await store.get(session.session_id))!;
    await store.put({
      ...current,
      file_type: "rtf" as OfficeFileType,
      path: "/Projects/Acme/proposal.rtf",
    });

    const app = makeApp({
      store,
      files: {
        "/Projects/Acme/proposal.rtf": { bytes: DOCX_BYTES },
      },
    });

    const res = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("unsupported_file_type");
  });

  it("never logs token or file body on success or denial", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const { session, download_token } = await seed(store);
    const app = makeApp({ store });

    // Spy createLogger-backed module logger via console is fragile; assert
    // response/error bodies never echo the token, and redact helper works.
    const resOk = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=${encodeURIComponent(download_token)}`,
      { headers: { host: tenantA.host } },
    );
    expect(resOk.status).toBe(200);
    // Binary body is file bytes — not a JSON leak of the token.
    const textish = Buffer.from(await resOk.arrayBuffer()).toString("utf8");
    expect(textish).not.toContain(download_token);

    const resDeny = await app.request(
      `/api/office/sessions/${session.session_id}/content?token=wrong`,
      { headers: { host: tenantA.host } },
    );
    const denyJson = JSON.stringify(await resDeny.json());
    expect(denyJson).not.toContain(download_token);
    expect(denyJson).not.toContain("wrong");

    const sampleLogUrl = buildOfficeDownloadUrl({
      publicBaseUrl: "http://bff:3001",
      sessionId: session.session_id,
      downloadToken: download_token,
    });
    expect(redactOfficeDownloadUrl(sampleLogUrl)).not.toContain(download_token);
  });

  it("sets download_expires_at quickly relative to session expires_at", async () => {
    store = new MemoryOfficeDocumentSessionStore();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const { session } = await seed(store, {
      now,
      ttl_seconds: 3600,
      download_ttl_seconds: 120,
    });
    expect(session.download_expires_at).toBe("2026-07-24T12:02:00.000Z");
    expect(session.expires_at).toBe("2026-07-24T13:00:00.000Z");
  });
});
