/**
 * lp-5q6.38 — Offline localhost-proof substitute: full product chain
 *
 *   agent vault write (revision A)
 *     → pane would refresh (revision token recorded)
 *     → human mints Office edit session on that path
 *     → DS signed download serves vault bytes (rev A)
 *     → human save callback writes edited bytes (rev B)
 *     → re-mint + re-download serves vault bytes (rev B), NOT DS cache URL
 *
 * Fixture vault + memory DS fetcher only (offline substitute for BFF vault path).
 * Live GO requires through-DS forcesave in deploy/scripts/prove-localhost-office-e2e.sh
 * (lab-shared-compose-ds + real DocsAPI). Offline alone is insufficient for FULL PRODUCT GO.
 *
 * Scope: localhost mocklab + lab Document Server. Does NOT authorize AWS
 * staging or production customer Office edit.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VaultWriteHttpBody } from "@lanyard/backend-runtime";

import { createApp } from "../src/app.js";
import {
  MemoryOfficeDocumentSessionStore,
  officeMetrics,
  type OfficeBinaryContentSource,
  type OfficeCallbackFetcher,
  type OfficeCallbackVaultWriter,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import type { VaultContentProvider } from "../src/vault/types.js";
import type { TenantContext } from "../src/types.js";
import { SessionStore } from "../src/session.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";
import type { UserRbac } from "../src/control-plane-client.js";

const JWT_SECRET = "localhost-e2e-jwt-secret-not-for-production";
const PUBLIC_BASE = "http://host.docker.internal:4100";
const DS_ASSEMBLED_HOST = "http://lab-onlyoffice-ds:80";

const tenant: TenantContext = {
  tenant_id: "tenant-lab",
  tenant_slug: "lab",
  display_name: "Lab Localhost",
  // Host header drives tenant slug resolution (legacy subdomain form).
  host: "lab.withlanyard.com",
};

const rbac: UserRbac = {
  user_id: "user-lab-1",
  tenant_id: "tenant-lab",
  hermes_profile: "default",
  allowed_path_prefixes: ["/Projects"],
  role_names: ["member"],
};

const PATH = "/Projects/Lab/e2e-proof.docx";

/** Agent-written DOCX (revision A). */
const AGENT_BYTES = new TextEncoder().encode(
  "PK\x03\x04-agent-docx-rev-A-lp-5q6.38-localhost-e2e",
);
/** Human-edited DOCX assembled by Document Server (revision B). */
const HUMAN_BYTES = new TextEncoder().encode(
  "PK\x03\x04-human-EDITED-docx-rev-B-lp-5q6.38-localhost-e2e",
);
/** Poison cache: DS still holds old assembly — vault must win on re-open. */
const DS_STALE_CACHE = new TextEncoder().encode(
  "PK\x03\x04-DS-STALE-CACHE-MUST-NOT-BE-SERVED-lp-5q6.38",
);

export type LocalhostE2eChainEvidence = {
  bead_id: "lp-5q6.38";
  environment: "localhost_mocklab_lab_ds";
  path: string;
  agent_revision_token: string;
  agent_download_bytes: number;
  human_save_revision_token: string;
  human_save_size_bytes: number;
  reopen_download_bytes: number;
  reopen_bytes_match_human: boolean;
  reopen_bytes_not_ds_stale_cache: boolean;
  request_ids: string[];
  session_ids: string[];
  document_keys: string[];
};

export const localhostE2eChainEvidence: LocalhostE2eChainEvidence[] = [];

function parseQuery(url: string): URLSearchParams {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function extractToken(url: string): string {
  const token = parseQuery(url).get("token");
  if (!token) throw new Error(`no token in ${url}`);
  return token;
}

function extractNonce(url: string): string {
  const nonce = parseQuery(url).get("nonce");
  if (!nonce) throw new Error(`no nonce in ${url}`);
  return nonce;
}

/**
 * Mutable vault: agent write + human callback both update the same map.
 * Binary source and vault content provider read from it so re-open is vault-sourced.
 */
function mutableVault(initial: Record<string, Uint8Array>) {
  const files: Record<string, Uint8Array> = { ...initial };
  const revisions = new Map<string, string>();

  const provider: VaultContentProvider = {
    async listEntries() {
      return [];
    },
    async readFile(path: string) {
      const bytes = files[path];
      if (!bytes) return null;
      return {
        path,
        kind: "file" as const,
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        encoding: "base64" as const,
        content: Buffer.from(bytes).toString("base64"),
        size_bytes: bytes.byteLength,
      };
    },
    async getTree() {
      return [];
    },
  };

  const binary: OfficeBinaryContentSource = {
    async read(input) {
      const bytes = files[input.path];
      if (!bytes) return { ok: false as const, reason: "missing_file" as const };
      return {
        ok: true as const,
        bytes,
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: bytes.byteLength,
        path: input.path,
      };
    },
  };

  const writer: OfficeCallbackVaultWriter = async ({ params }) => {
    const content =
      typeof params.content === "string"
        ? Buffer.from(params.content, "base64")
        : null;
    if (!content) {
      throw new Error("writer expects base64 content");
    }
    files[params.path] = new Uint8Array(content);
    const token = `rev-localhost-e2e-${params.sizeBytes}-${Date.now()}`;
    revisions.set(params.path, token);
    const result: VaultWriteHttpBody = {
      path: params.path,
      revision: {
        token,
        kind: "content_hash",
        size_bytes: params.sizeBytes,
      },
      size_bytes: params.sizeBytes,
      mime_type: params.mimeType ?? "application/octet-stream",
      written_at: new Date().toISOString(),
      created: false,
      source: "brain_rpc",
    };
    return result;
  };

  return { files, provider, binary, writer, revisions };
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

describe("lp-5q6.38 localhost e2e chain (BFF vault-proven)", () => {
  let officeStore: OfficeDocumentSessionStore;

  beforeEach(() => {
    officeMetrics.reset();
    officeStore = new MemoryOfficeDocumentSessionStore();
  });

  afterEach(async () => {
    await officeStore.clear();
  });

  it("agent write → human Office save → reopen serves vault bytes not DS cache", async () => {
    // --- Agent creates/updates DOCX in vault (revision A) ---
    const vault = mutableVault({ [PATH]: AGENT_BYTES });
    vault.revisions.set(PATH, "sha256:agent-rev-A");

    const sessions = new SessionStore();
    const session = await sessions.create({
      userId: "user-lab-1",
      tenantId: "tenant-lab",
      email: "lab-user@example.com",
    });

    // DS assemble URL used only during callback; after save it is intentionally
    // poisoned so re-open cannot accidentally read DS cache.
    const assembleUrl = `${DS_ASSEMBLED_HOST}/cache/files/e2e-edited.docx`;
    const fetchMap: Record<string, Uint8Array> = {
      [assembleUrl]: HUMAN_BYTES,
    };

    const app = createApp(
      createTestBindings(
        { lab: tenant },
        {
          sessions,
          officeDocumentSessions: officeStore,
          officeCanVaultEdit: true,
          officeJwtSecret: JWT_SECRET,
          officePublicBaseUrl: PUBLIC_BASE,
          officeBinarySource: vault.binary,
          officeCallbackFetcher: memoryFetcher(fetchMap),
          officeCallbackVaultWriter: vault.writer,
          officeDocumentServerAllowlist: {
            hosts: [
              "lab-onlyoffice-ds",
              "onlyoffice",
              "localhost",
              "127.0.0.1",
              "host.docker.internal",
            ],
            schemes: ["http", "https"],
          },
          vaultContentProvider: vault.provider,
          authClient: {
            getUserRbac: async () => rbac,
          } as never,
        },
      ),
    );

    const csrf = "localhost-e2e-csrf";
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: csrf,
    };
    const requestIds: string[] = [];
    const sessionIds: string[] = [];
    const documentKeys: string[] = [];

    // --- Human opens chat Office edit on agent artifact path ---
    const mintReqId = "localhost-e2e-mint-1";
    requestIds.push(mintReqId);
    const mintRes = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
        "x-request-id": mintReqId,
      },
      body: JSON.stringify({ path: PATH, mode: "edit" }),
    });
    expect(mintRes.status).toBe(201);
    const mint1 = (await mintRes.json()) as {
      session_id: string;
      document_key: string;
      base_revision: { token: string };
      editor_config: {
        document: { url: string; key: string };
        editorConfig: { callbackUrl: string };
      };
    };
    sessionIds.push(mint1.session_id);
    documentKeys.push(mint1.document_key);
    expect(JSON.stringify(mint1)).not.toContain(JWT_SECRET);

    // DS opens document — must be agent vault bytes (rev A)
    const token1 = extractToken(mint1.editor_config.document.url);
    const dlReqId = "localhost-e2e-dl-agent";
    requestIds.push(dlReqId);
    const dl1 = await app.request(
      `/api/office/sessions/${encodeURIComponent(mint1.session_id)}/content?token=${encodeURIComponent(token1)}`,
      {
        method: "GET",
        headers: { host: tenant.host, "x-request-id": dlReqId },
      },
    );
    expect(dl1.status).toBe(200);
    const agentDl = new Uint8Array(await dl1.arrayBuffer());
    expect(Buffer.from(agentDl).equals(Buffer.from(AGENT_BYTES))).toBe(true);

    // --- Human save via ONLYOFFICE callback → vault.write rev B ---
    const nonce = extractNonce(mint1.editor_config.editorConfig.callbackUrl);
    const cbReqId = "localhost-e2e-callback-human";
    requestIds.push(cbReqId);
    const cbRes = await app.request(
      `/api/office/callback?session_id=${encodeURIComponent(mint1.session_id)}&nonce=${encodeURIComponent(nonce)}`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          "x-request-id": cbReqId,
        },
        body: JSON.stringify({
          status: 2,
          url: assembleUrl,
          key: mint1.document_key,
        }),
      },
    );
    expect(cbRes.status).toBe(200);
    const cbBody = (await cbRes.json()) as { error: number; code: string };
    expect(cbBody.error).toBe(0);
    expect(cbBody.code).toBe("saved");

    // Vault now holds human bytes
    expect(
      Buffer.from(vault.files[PATH]!).equals(Buffer.from(HUMAN_BYTES)),
    ).toBe(true);

    // Poison DS cache so any accidental cache read would fail the assertion
    fetchMap[assembleUrl] = DS_STALE_CACHE;

    // --- Reload / reopen: new Office session downloads from vault, not DS ---
    const mint2ReqId = "localhost-e2e-mint-reopen";
    requestIds.push(mint2ReqId);
    const mint2Res = await app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrf,
        "x-request-id": mint2ReqId,
      },
      body: JSON.stringify({ path: PATH, mode: "view" }),
    });
    expect(mint2Res.status).toBe(201);
    const mint2 = (await mint2Res.json()) as {
      session_id: string;
      document_key: string;
      base_revision: { token: string };
      editor_config: { document: { url: string } };
    };
    sessionIds.push(mint2.session_id);
    documentKeys.push(mint2.document_key);
    // New document key after revision change (invalidation policy)
    expect(mint2.document_key).not.toBe(mint1.document_key);

    const token2 = extractToken(mint2.editor_config.document.url);
    const dl2ReqId = "localhost-e2e-dl-reopen";
    requestIds.push(dl2ReqId);
    const dl2 = await app.request(
      `/api/office/sessions/${encodeURIComponent(mint2.session_id)}/content?token=${encodeURIComponent(token2)}`,
      {
        method: "GET",
        headers: { host: tenant.host, "x-request-id": dl2ReqId },
      },
    );
    expect(dl2.status).toBe(200);
    const reopenBytes = new Uint8Array(await dl2.arrayBuffer());
    expect(Buffer.from(reopenBytes).equals(Buffer.from(HUMAN_BYTES))).toBe(
      true,
    );
    expect(
      Buffer.from(reopenBytes).equals(Buffer.from(DS_STALE_CACHE)),
    ).toBe(false);
    expect(
      Buffer.from(reopenBytes).equals(Buffer.from(AGENT_BYTES)),
    ).toBe(false);

    const bound = await officeStore.get(mint1.session_id);
    expect(bound?.last_save_status).toBe("saved");

    const evidence: LocalhostE2eChainEvidence = {
      bead_id: "lp-5q6.38",
      environment: "localhost_mocklab_lab_ds",
      path: PATH,
      agent_revision_token: "sha256:agent-rev-A",
      agent_download_bytes: agentDl.byteLength,
      human_save_revision_token: vault.revisions.get(PATH) ?? "unknown",
      human_save_size_bytes: HUMAN_BYTES.byteLength,
      reopen_download_bytes: reopenBytes.byteLength,
      reopen_bytes_match_human: true,
      reopen_bytes_not_ds_stale_cache: true,
      request_ids: requestIds,
      // prefixes only in durable evidence shape
      session_ids: sessionIds.map((id) =>
        id.length <= 12 ? id : `${id.slice(0, 12)}…`,
      ),
      document_keys: documentKeys.map((k) =>
        k.length <= 16 ? k : `${k.slice(0, 16)}…`,
      ),
    };
    localhostE2eChainEvidence.push(evidence);

    // Secrets / bodies must not appear in evidence JSON shape
    const safe = JSON.stringify(evidence);
    expect(safe).not.toContain(JWT_SECRET);
    expect(safe).not.toContain(token1);
    expect(safe).not.toContain(token2);
    expect(safe).not.toContain(nonce);
    expect(safe).not.toContain(Buffer.from(HUMAN_BYTES).toString("base64"));
  });
});
