/**
 * lp-5q6.28 — Lab go/no-go: ONLYOFFICE open / edit / save / callback round trip.
 *
 * Exercises the real BFF HTTP path Document Server uses (not unit-only helpers):
 *   1. Browser/session mint → POST /api/office/sessions
 *   2. Document Server open → GET /api/office/sessions/:id/content?token=…
 *   3. Document Server save → POST /api/office/callback (status 2 / 6)
 *   4. Fixture vault write with new revision + metrics/latency
 *   5. Failed callback → last_save_status failed + user-facing error mapping
 *
 * Fixture vault only. No production Brain RPC. No document body in logs/evidence.
 *
 * Evidence writer: deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VaultWriteHttpBody, VaultWriteParams } from "@lanyard/backend-runtime";

import { createApp } from "../src/app.js";
import {
  MemoryOfficeDocumentSessionStore,
  createMemoryOfficeBinaryContentSource,
  officeMetrics,
  buildOfficeSafeLogFields,
  classifyOfficeError,
  type OfficeCallbackFetcher,
  type OfficeCallbackVaultWriter,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import type { VaultContentProvider } from "../src/vault/types.js";
import type { TenantContext } from "../src/types.js";
import { SessionStore } from "../src/session.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";
import type { UserRbac } from "../src/control-plane-client.js";

const JWT_SECRET = "lab-jwt-secret-placeholder";
const PUBLIC_BASE = "http://host.docker.internal:4000";
const DS_ASSEMBLED_HOST = "http://onlyoffice";

const tenantA: TenantContext = {
  tenant_id: "tenant-lab",
  tenant_slug: "lab",
  display_name: "Lab",
  host: "lab.withlanyard.com",
};

const rbac: UserRbac = {
  user_id: "user-lab-1",
  tenant_id: "tenant-lab",
  hermes_profile: "default",
  allowed_path_prefixes: ["/Projects"],
  role_names: ["member"],
};

/** Minimal OOXML-looking fixtures (PK zip signature + lab marker). Not real Office XML. */
const DOCX_OPEN_BYTES = new TextEncoder().encode(
  "PK\x03\x04-lab-docx-open-fixture-lp-5q6.28",
);
const DOCX_EDITED_BYTES = new TextEncoder().encode(
  "PK\x03\x04-lab-docx-EDITED-bytes-lp-5q6.28-v2",
);
const XLSX_OPEN_BYTES = new TextEncoder().encode(
  "PK\x03\x04-lab-xlsx-open-fixture-lp-5q6.28",
);
const XLSX_EDITED_BYTES = new TextEncoder().encode(
  "PK\x03\x04-lab-xlsx-EDITED-bytes-lp-5q6.28-v2",
);

const DOCX_PATH = "/Projects/Lab/roundtrip.docx";
const XLSX_PATH = "/Projects/Lab/roundtrip.xlsx";

type RoundTripEvidence = {
  file_type: "docx" | "xlsx";
  path: string;
  session_id: string;
  document_key: string;
  base_revision_token: string;
  download_status: number;
  download_bytes: number;
  download_latency_ms: number;
  callback_status: number;
  callback_code: string;
  callback_latency_ms: number;
  new_revision_token: string;
  new_revision_size_bytes: number;
  last_save_status: string;
  lifecycle: string;
  write_count: number;
  /** Safe log sample — never includes body or secrets. */
  safe_log_sample: Record<string, unknown>;
};

/** Exported for the prove script to import via vitest reporter / shared collector. */
export const labRoundTripEvidence: RoundTripEvidence[] = [];

function memoryVault(
  files: Record<string, Uint8Array>,
): VaultContentProvider {
  return {
    async listEntries() {
      return [];
    },
    async readFile(path: string) {
      const bytes = files[path];
      if (!bytes) return null;
      return {
        path,
        kind: "file" as const,
        mime_type: "application/octet-stream",
        encoding: "base64" as const,
        content: Buffer.from(bytes).toString("base64"),
        size_bytes: bytes.byteLength,
      };
    },
    async getTree() {
      return [];
    },
  };
}

function parseQuery(url: string): URLSearchParams {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function extractSessionIdFromDownloadUrl(url: string): string {
  const m = /\/api\/office\/sessions\/([^/]+)\/content/.exec(url);
  if (!m?.[1]) throw new Error(`no session id in download url: ${url}`);
  return decodeURIComponent(m[1]);
}

function extractSessionIdFromCallbackUrl(url: string): string {
  const params = parseQuery(url);
  const id = params.get("session_id");
  if (!id) throw new Error(`no session_id in callback url`);
  return id;
}

function extractNonceFromCallbackUrl(url: string): string {
  const params = parseQuery(url);
  const nonce = params.get("nonce");
  if (!nonce) throw new Error(`no nonce in callback url`);
  return nonce;
}

function extractTokenFromDownloadUrl(url: string): string {
  const params = parseQuery(url);
  const token = params.get("token");
  if (!token) throw new Error(`no token in download url`);
  return token;
}

function trackingWriter(): {
  writer: OfficeCallbackVaultWriter;
  calls: Array<{ params: VaultWriteParams; session_id: string }>;
  lastResult: VaultWriteHttpBody | null;
} {
  const state = {
    calls: [] as Array<{ params: VaultWriteParams; session_id: string }>,
    lastResult: null as VaultWriteHttpBody | null,
  };
  const lastByKey = new Map<string, VaultWriteHttpBody>();

  const writer: OfficeCallbackVaultWriter = async ({ session, params }) => {
    state.calls.push({ params, session_id: session.session_id });
    const prior = lastByKey.get(params.idempotencyKey);
    if (prior) {
      return { ...prior, idempotent_replay: true };
    }
    const result: VaultWriteHttpBody = {
      path: params.path,
      revision: {
        token: `rev-lab-after-${state.calls.length}-${params.sizeBytes}`,
        kind: "content_hash",
        size_bytes: params.sizeBytes,
      },
      size_bytes: params.sizeBytes,
      mime_type: params.mimeType ?? "application/octet-stream",
      written_at: new Date().toISOString(),
      created: false,
      source: "brain_rpc",
    };
    lastByKey.set(params.idempotencyKey, result);
    state.lastResult = result;
    return result;
  };

  return Object.assign(state, { writer });
}

function assembledUrl(fileType: "docx" | "xlsx"): string {
  return `${DS_ASSEMBLED_HOST}/cache/files/lab-edited.${fileType}`;
}

function memoryFetcher(
  map: Record<string, Uint8Array>,
): OfficeCallbackFetcher {
  return async ({ url, maxBytes }) => {
    if (!url.startsWith(DS_ASSEMBLED_HOST)) {
      return { ok: false, reason: "bad_url" };
    }
    const bytes = map[url];
    if (!bytes) return { ok: false, reason: "fetch_failed" };
    if (bytes.byteLength > maxBytes) return { ok: false, reason: "oversized" };
    return { ok: true, bytes };
  };
}

/**
 * User-facing copy (mirrors web onlyOfficeEditorErrors.callback_save_issue).
 * Kept here so BFF lab proof does not depend on unmerged web editor host.
 */
export function userFacingCallbackSaveError(code: string): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const operator = classifyOfficeError(code);
  switch (operator) {
    case "host_write_conflict":
      return {
        code: "callback_save_issue",
        message:
          "This document changed while you were editing. Reload to see the latest version, then re-apply your edits.",
        retryable: true,
      };
    case "document_server_unreachable":
      return {
        code: "callback_save_issue",
        message:
          "Could not reach Document Server to finish saving. Check the lab Document Server and try save again.",
        retryable: true,
      };
    case "bff_callback_rejected":
      return {
        code: "callback_save_issue",
        message:
          "Save was rejected by the server. Your latest changes may not be stored — try save again or reload.",
        retryable: true,
      };
    case "write_failed":
    default:
      return {
        code: "callback_save_issue",
        message:
          "The editor reported a save problem. Your latest changes may not be on the server — try save again or reload.",
        retryable: true,
      };
  }
}

describe("lp-5q6.28 lab ONLYOFFICE open/edit/save/callback round trip", () => {
  let officeStore: OfficeDocumentSessionStore;
  let vaultFiles: Record<string, Uint8Array>;

  beforeEach(() => {
    officeMetrics.reset();
    officeStore = new MemoryOfficeDocumentSessionStore();
    vaultFiles = {
      [DOCX_PATH]: DOCX_OPEN_BYTES,
      [XLSX_PATH]: XLSX_OPEN_BYTES,
    };
  });

  afterEach(async () => {
    await officeStore.clear();
  });

  async function makeLabApp(options: {
    editedByUrl: Record<string, Uint8Array>;
  }) {
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId: "user-lab-1",
      tenantId: "tenant-lab",
      email: "lab@example.com",
    });

    const tracked = trackingWriter();
    const binary = createMemoryOfficeBinaryContentSource(
      Object.fromEntries(
        Object.entries(vaultFiles).map(([path, bytes]) => [
          path,
          { bytes, mime_type: "application/octet-stream" },
        ]),
      ),
    );

    const app = createApp(
      createTestBindings(
        { lab: tenantA },
        {
          sessions,
          officeDocumentSessions: officeStore,
          officeCanVaultEdit: true,
          officeJwtSecret: JWT_SECRET,
          officePublicBaseUrl: PUBLIC_BASE,
          officeBinarySource: binary,
          officeCallbackFetcher: memoryFetcher(options.editedByUrl),
          officeCallbackVaultWriter: tracked.writer,
          officeDocumentServerAllowlist: {
            hosts: [
              "onlyoffice",
              "documentserver",
              "localhost",
              "host.docker.internal",
            ],
            schemes: ["http", "https"],
          },
          vaultContentProvider: memoryVault(vaultFiles),
          authClient: {
            getUserRbac: async () => rbac,
          } as never,
        },
      ),
    );

    const csrf = "lab-csrf-token-lp-5q6.28";
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: csrf,
    };

    return { app, cookies, csrf, tracked };
  }

  async function roundTrip(fileType: "docx" | "xlsx"): Promise<RoundTripEvidence> {
    const path = fileType === "docx" ? DOCX_PATH : XLSX_PATH;
    const openBytes = fileType === "docx" ? DOCX_OPEN_BYTES : XLSX_OPEN_BYTES;
    const editedBytes =
      fileType === "docx" ? DOCX_EDITED_BYTES : XLSX_EDITED_BYTES;
    const dsUrl = assembledUrl(fileType);

    const { app, cookies, csrf, tracked } = await makeLabApp({
      editedByUrl: { [dsUrl]: editedBytes },
    });

    // --- 1. Mint editor config (open path starts here) ---
    const mintStarted = Date.now();
    const mintRes = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
        "x-request-id": `lab-mint-${fileType}`,
      },
      body: JSON.stringify({ path, mode: "edit" }),
    });
    expect(mintRes.status).toBe(201);
    const mintBody = (await mintRes.json()) as {
      session_id: string;
      document_key: string;
      base_revision: { token: string; size_bytes?: number };
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
          user: { id: string };
        };
        token: string;
      };
    };
    const mintLatency = Date.now() - mintStarted;
    expect(mintLatency).toBeGreaterThanOrEqual(0);

    expect(mintBody.editor_config.document.fileType).toBe(fileType);
    expect(mintBody.editor_config.document.permissions.edit).toBe(true);
    expect(mintBody.editor_config.document.url).toContain(
      "host.docker.internal",
    );
    expect(mintBody.editor_config.document.url).toContain("token=");
    expect(mintBody.editor_config.editorConfig.callbackUrl).toContain("nonce=");
    // Secrets must not leak into JSON string form of JWT secret
    expect(JSON.stringify(mintBody)).not.toContain(JWT_SECRET);

    const downloadUrl = mintBody.editor_config.document.url;
    const callbackUrl = mintBody.editor_config.editorConfig.callbackUrl;
    const sessionId = mintBody.session_id;
    expect(extractSessionIdFromDownloadUrl(downloadUrl)).toBe(sessionId);
    expect(extractSessionIdFromCallbackUrl(callbackUrl)).toBe(sessionId);
    const token = extractTokenFromDownloadUrl(downloadUrl);
    const nonce = extractNonceFromCallbackUrl(callbackUrl);

    // --- 2. Document Server "opens" document via signed download ---
    // Use relative path as createApp serves /api/* on the test app.
    const contentPath = `/api/office/sessions/${encodeURIComponent(sessionId)}/content?token=${encodeURIComponent(token)}`;
    const dlStarted = Date.now();
    const dlRes = await app.request(contentPath, {
      method: "GET",
      headers: {
        host: tenantA.host,
        "x-request-id": `lab-dl-${fileType}`,
      },
    });
    const download_latency_ms = Date.now() - dlStarted;
    expect(dlRes.status).toBe(200);
    const dlBytes = new Uint8Array(await dlRes.arrayBuffer());
    expect(dlBytes.byteLength).toBe(openBytes.byteLength);
    expect(Buffer.from(dlBytes).equals(Buffer.from(openBytes))).toBe(true);
    // Content-Type should be Office MIME
    const ct = dlRes.headers.get("content-type") ?? "";
    if (fileType === "docx") {
      expect(ct).toMatch(/wordprocessingml|octet-stream/);
    } else {
      expect(ct).toMatch(/spreadsheetml|octet-stream/);
    }

    // --- 3. Document Server callback with edited bytes (status 2 = ready for save) ---
    const beforeWrites = tracked.calls.length;
    const cbStarted = Date.now();
    const cbRes = await app.request(
      `/api/office/callback?session_id=${encodeURIComponent(sessionId)}&nonce=${encodeURIComponent(nonce)}`,
      {
        method: "POST",
        headers: {
          host: tenantA.host,
          "content-type": "application/json",
          "x-request-id": `lab-cb-${fileType}`,
        },
        body: JSON.stringify({
          status: 2,
          url: dsUrl,
          key: mintBody.document_key,
        }),
      },
    );
    const callback_latency_ms = Date.now() - cbStarted;
    expect(cbRes.status).toBe(200);
    const cbBody = (await cbRes.json()) as { error: number; code: string };
    expect(cbBody.error).toBe(0);
    expect(cbBody.code).toBe("saved");

    expect(tracked.calls.length).toBe(beforeWrites + 1);
    const write = tracked.calls[tracked.calls.length - 1]!;
    expect(write.params.path).toBe(path);
    expect(write.params.sizeBytes).toBe(editedBytes.byteLength);
    // Path/revision come from session — not client-controlled callback body
    expect(write.params.expectedRevision?.token).toBe(
      mintBody.base_revision.token,
    );
    // Written content is the edited DS assembly (base64 in params when used)
    if (write.params.content !== undefined) {
      const written = Buffer.from(write.params.content, "base64");
      expect(written.equals(Buffer.from(editedBytes))).toBe(true);
    }

    const newRev = tracked.lastResult?.revision;
    expect(newRev?.token).toBeTruthy();
    expect(newRev?.token).not.toBe(mintBody.base_revision.token);
    expect(newRev?.size_bytes).toBe(editedBytes.byteLength);

    const bound = await officeStore.get(sessionId);
    expect(bound).toBeTruthy();
    expect(bound!.last_save_status).toBe("saved");
    expect(bound!.lifecycle).toBe("saved");

    const metrics = officeMetrics.snapshot();
    expect(metrics.download_total).toBeGreaterThanOrEqual(1);
    expect(metrics.callback_total).toBeGreaterThanOrEqual(1);
    expect(metrics.write_success_total).toBeGreaterThanOrEqual(1);
    expect(metrics.callback_by_onlyoffice_status["2"]).toBeGreaterThanOrEqual(1);

    const safe_log_sample = buildOfficeSafeLogFields({
      event: "office_callback",
      request_id: `lab-cb-${fileType}`,
      tenant_id: tenantA.tenant_id,
      office_session_id: sessionId,
      route: "/api/office/callback",
      status: 200,
      latency_ms: callback_latency_ms,
      size_bytes: editedBytes.byteLength,
      size_bucket: "lt_1kb",
      outcome: "success",
      file_type: fileType,
      mode: "edit",
      onlyoffice_status: 2,
      error_code: undefined,
    });
    // Forbidden keys must not appear
    expect(safe_log_sample).not.toHaveProperty("token");
    expect(safe_log_sample).not.toHaveProperty("nonce");
    expect(safe_log_sample).not.toHaveProperty("body");
    expect(safe_log_sample).not.toHaveProperty("url");
    expect(JSON.stringify(safe_log_sample)).not.toContain(token);
    expect(JSON.stringify(safe_log_sample)).not.toContain(nonce);
    expect(JSON.stringify(safe_log_sample)).not.toContain(
      Buffer.from(editedBytes).toString("base64").slice(0, 24),
    );

    const evidence: RoundTripEvidence = {
      file_type: fileType,
      path,
      session_id: sessionId,
      document_key: mintBody.document_key,
      base_revision_token: mintBody.base_revision.token,
      download_status: 200,
      download_bytes: dlBytes.byteLength,
      download_latency_ms,
      callback_status: 200,
      callback_code: cbBody.code,
      callback_latency_ms,
      new_revision_token: newRev!.token,
      new_revision_size_bytes: newRev!.size_bytes ?? editedBytes.byteLength,
      last_save_status: bound!.last_save_status,
      lifecycle: bound!.lifecycle,
      write_count: tracked.calls.length,
      safe_log_sample,
    };
    labRoundTripEvidence.push(evidence);
    return evidence;
  }

  it("DOCX: open (signed download) → edit callback → changed bytes + new revision", async () => {
    const evidence = await roundTrip("docx");
    expect(evidence.file_type).toBe("docx");
    expect(evidence.new_revision_token).toMatch(/^rev-lab-after-/);
    expect(evidence.callback_code).toBe("saved");
    expect(evidence.download_latency_ms).toBeGreaterThanOrEqual(0);
    expect(evidence.callback_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("XLSX: open (signed download) → edit callback → changed bytes + new revision", async () => {
    const evidence = await roundTrip("xlsx");
    expect(evidence.file_type).toBe("xlsx");
    expect(evidence.new_revision_token).toMatch(/^rev-lab-after-/);
    expect(evidence.callback_code).toBe("saved");
  });

  it("records callback status codes and latency on metrics path", async () => {
    await roundTrip("docx");
    const snap = officeMetrics.snapshot();
    expect(snap.callback_by_code.saved).toBeGreaterThanOrEqual(1);
    expect(snap.callback_by_onlyoffice_status["2"]).toBeGreaterThanOrEqual(1);
    expect(snap.write_success_total).toBeGreaterThanOrEqual(1);
    // Safe log builder always includes integer latency_ms when provided
    const fields = buildOfficeSafeLogFields({
      event: "office_callback",
      latency_ms: 42.7,
      onlyoffice_status: 2,
      outcome: "success",
    });
    expect(fields.latency_ms).toBe(43);
    expect(fields.onlyoffice_status).toBe(2);
  });

  it("failed callback (status 3) records failed save and user-facing error", async () => {
    const { app, cookies, csrf } = await makeLabApp({
      editedByUrl: {},
    });

    const mintRes = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ path: DOCX_PATH, mode: "edit" }),
    });
    expect(mintRes.status).toBe(201);
    const mintBody = (await mintRes.json()) as {
      session_id: string;
      editor_config: { editorConfig: { callbackUrl: string } };
    };
    const nonce = extractNonceFromCallbackUrl(
      mintBody.editor_config.editorConfig.callbackUrl,
    );

    const cbStarted = Date.now();
    const cbRes = await app.request(
      `/api/office/callback?session_id=${encodeURIComponent(mintBody.session_id)}&nonce=${encodeURIComponent(nonce)}`,
      {
        method: "POST",
        headers: {
          host: tenantA.host,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: 3 }),
      },
    );
    const latency_ms = Date.now() - cbStarted;
    expect(cbRes.status).toBe(200);
    const cbBody = (await cbRes.json()) as { error: number; code: string };
    // ONLYOFFICE expects error:0 ack even for save_error so DS does not retry forever
    expect(cbBody.error).toBe(0);
    expect(cbBody.code).toBe("save_error");

    const bound = await officeStore.get(mintBody.session_id);
    expect(bound!.last_save_status).toBe("failed");

    const userError = userFacingCallbackSaveError("save_error");
    expect(userError.code).toBe("callback_save_issue");
    expect(userError.message.length).toBeGreaterThan(20);
    expect(userError.message.toLowerCase()).toMatch(/save|changes|server/);
    expect(userError.message).not.toMatch(/token|nonce|jwt|PK\\x03/i);
    expect(userError.retryable).toBe(true);

    const safe = buildOfficeSafeLogFields({
      event: "office_callback",
      office_session_id: mintBody.session_id,
      latency_ms,
      onlyoffice_status: 3,
      error_code: "save_error",
      operator_class: classifyOfficeError("save_error"),
      outcome: "error",
    });
    expect(safe.operator_class).toBe("write_failed");
    expect(safe.latency_ms).toBe(latency_ms);
  });

  it("failed callback (bad nonce) returns non-zero error with clear code", async () => {
    const { app, cookies, csrf, tracked } = await makeLabApp({
      editedByUrl: {},
    });

    const mintRes = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenantA.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ path: DOCX_PATH, mode: "edit" }),
    });
    const mintBody = (await mintRes.json()) as { session_id: string };

    const cbRes = await app.request(
      `/api/office/callback?session_id=${encodeURIComponent(mintBody.session_id)}&nonce=definitely-wrong-nonce-xx`,
      {
        method: "POST",
        headers: {
          host: tenantA.host,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: 2,
          url: assembledUrl("docx"),
          key: "k",
        }),
      },
    );
    expect(cbRes.status).toBe(403);
    const cbBody = (await cbRes.json()) as { error: number; code: string };
    expect(cbBody.error).toBe(1);
    expect(cbBody.code).toBe("invalid_nonce");
    expect(tracked.calls).toHaveLength(0);

    const userError = userFacingCallbackSaveError("invalid_nonce");
    expect(userError.message).toMatch(/rejected|save|changes/i);
    expect(userError.message).not.toContain("definitely-wrong-nonce");
  });
});
