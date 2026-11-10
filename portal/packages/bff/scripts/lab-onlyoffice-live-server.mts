/**
 * lp-5q6.28 / lp-5q6.38 — Live lab BFF for ONLYOFFICE Document Server open/edit/save.
 *
 * Real HTTP server (not in-process app.request):
 *   - Fixture vault DOCX + XLSX under /Projects/Lab/
 *   - Path-based tenant /lab/api/… so DS→host.docker.internal resolves tenant
 *   - Signed download + callback writeback with tracked revisions
 *   - Static DocsAPI host page for Playwright
 *   - lp-5q6.38: product-chain e2e path with through-DS human save (forcesave)
 *
 * Usage (repo portal/ or packages/bff):
 *   pnpm --filter @lanyard/bff exec tsx scripts/lab-onlyoffice-live-server.mts
 *
 * Env:
 *   LAB_BFF_PORT          default 4100
 *   LAB_DS_URL            browser-reachable DS origin, default http://127.0.0.1:8080
 *   LAB_BFF_PUBLIC_BASE   DS-reachable BFF base, default http://host.docker.internal:$PORT
 *   BFF_OFFICE_JWT_SECRET must match Document Server JWT_SECRET
 */
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import type { VaultWriteHttpBody } from "@lanyard/backend-runtime";

import { createApp } from "../src/app.js";
import {
  MemoryOfficeDocumentSessionStore,
  createDefaultOfficeCallbackFetcher,
  officeMetrics,
  type OfficeBinaryContentSource,
  type OfficeCallbackVaultWriter,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import type { VaultContentProvider } from "../src/vault/types.js";
import type { UserRbac } from "../src/control-plane-client.js";
import { cookieHeader, createTestBindings } from "../test/test-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../fixtures/lab-office");

const PORT = Number(process.env.LAB_BFF_PORT ?? process.env.PORT ?? 4100);
const DS_URL = (process.env.LAB_DS_URL ?? "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const PUBLIC_BASE = (
  process.env.LAB_BFF_PUBLIC_BASE ??
  process.env.BFF_OFFICE_PUBLIC_BASE_URL ??
  `http://host.docker.internal:${PORT}`
).replace(/\/$/, "");
const JWT_SECRET =
  process.env.BFF_OFFICE_JWT_SECRET ??
  process.env.ONLYOFFICE_JWT_SECRET ??
  "lab-jwt-secret-placeholder";

const DOCX_PATH = "/Projects/Lab/roundtrip.docx";
const XLSX_PATH = "/Projects/Lab/roundtrip.xlsx";
/** lp-5q6.38 product-chain path (agent write → through-DS human save → vault reopen). */
const E2E_PATH = "/Projects/Lab/e2e-proof.docx";

const tenantLab: TenantContext = {
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

type WriteRecord = {
  at: string;
  path: string;
  size_bytes: number;
  session_id: string;
  revision_token: string;
  content_sha256_prefix: string;
};

function loadFixture(name: string): Uint8Array {
  const p = join(FIXTURE_DIR, name);
  if (!existsSync(p)) {
    throw new Error(`Missing fixture ${p}`);
  }
  return new Uint8Array(readFileSync(p));
}

function sha256Prefix(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function memoryVault(files: Record<string, Uint8Array>): VaultContentProvider {
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

function liveBinarySource(
  vaultFiles: Record<string, Uint8Array>,
): OfficeBinaryContentSource {
  return {
    async read(input) {
      const bytes = vaultFiles[input.path];
      if (!bytes) {
        return { ok: false, reason: "missing_file" };
      }
      if (bytes.byteLength > input.max_bytes) {
        return { ok: false, reason: "oversized" };
      }
      const mime =
        input.file_type === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      return {
        ok: true,
        bytes,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        path: input.path,
      };
    },
  };
}

function trackingWriter(state: {
  writes: WriteRecord[];
  vaultFiles: Record<string, Uint8Array>;
}): OfficeCallbackVaultWriter {
  const lastByKey = new Map<string, VaultWriteHttpBody>();
  return async ({ session, params }) => {
    const prior = lastByKey.get(params.idempotencyKey);
    if (prior) {
      return { ...prior, idempotent_replay: true };
    }
    let bodyBytes = new Uint8Array(0);
    if (params.content && params.encoding === "base64") {
      bodyBytes = new Uint8Array(Buffer.from(params.content, "base64"));
    } else if (params.content && params.encoding === "utf-8") {
      bodyBytes = new TextEncoder().encode(params.content);
    }
    state.vaultFiles[params.path] = bodyBytes;
    const revToken = `rev-live-${state.writes.length + 1}-${params.sizeBytes}`;
    const result: VaultWriteHttpBody = {
      path: params.path,
      revision: {
        token: revToken,
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
    state.writes.push({
      at: result.written_at,
      path: params.path,
      size_bytes: params.sizeBytes,
      session_id: session.session_id,
      revision_token: revToken,
      content_sha256_prefix: sha256Prefix(bodyBytes),
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "lab_vault_write",
        path: params.path,
        size_bytes: params.sizeBytes,
        revision_token: revToken,
        session_id: session.session_id,
      }),
    );
    return result;
  };
}

function sessionIdPrefix(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 12)}…`;
}

function labHostPageHtml(opts: {
  dsUrl: string;
  editorConfigJson: string;
  fileType: string;
  sessionId: string;
  documentKey: string;
  path: string;
}): string {
  const sidPrefix = sessionIdPrefix(opts.sessionId);
  const keyPrefix =
    opts.documentKey.length <= 16
      ? opts.documentKey
      : `${opts.documentKey.slice(0, 16)}…`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>lp-5q6.38 lab DocsAPI host (${opts.fileType})</title>
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #bar { padding: 8px 12px; background: #0f172a; color: #e2e8f0; font-size: 13px; }
    #placeholder { height: calc(100vh - 36px); width: 100%; background: #f1f5f9; }
    #status { margin-left: 12px; color: #94a3b8; }
  </style>
</head>
<body
  data-testid="lab-oo-body"
  data-document-key="${opts.documentKey.replace(/"/g, "")}"
  data-session-prefix="${sidPrefix.replace(/"/g, "")}"
  data-path="${opts.path.replace(/"/g, "")}"
  data-file-type="${opts.fileType}"
>
  <div id="bar" data-testid="lab-oo-bar">
    ONLYOFFICE lab host · ${opts.fileType} · session ${sidPrefix} · key ${keyPrefix}
    <span id="status" data-testid="lab-oo-status">loading api.js…</span>
  </div>
  <div id="placeholder" data-testid="lab-oo-placeholder"></div>
  <script>
    window.__LAB_EVENTS__ = [];
    window.__LAB_READY__ = false;
    window.__LAB_DOC_READY__ = false;
    window.__LAB_ERROR__ = null;
    window.__LAB_DOCUMENT_KEY__ = ${JSON.stringify(opts.documentKey)};
    window.__LAB_PATH__ = ${JSON.stringify(opts.path)};
    window.__LAB_DIRTY__ = false;
    window.__LAB_CONNECTOR_OK__ = false;
    function setStatus(t) {
      var el = document.getElementById('status');
      if (el) el.textContent = t;
      window.__LAB_EVENTS__.push({ t: Date.now(), status: t });
    }
    var editorConfig = ${opts.editorConfigJson};
    var s = document.createElement('script');
    s.src = ${JSON.stringify(opts.dsUrl + "/web-apps/apps/api/documents/api.js")};
    s.onload = function () {
      setStatus('api.js loaded; creating DocEditor…');
      if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
        setStatus('DocsAPI missing');
        window.__LAB_ERROR__ = 'DocsAPI missing';
        return;
      }
      var cfg = Object.assign({}, editorConfig, {
        width: '100%',
        height: '100%',
        events: {
          onAppReady: function () {
            window.__LAB_READY__ = true;
            setStatus('onAppReady');
          },
          onDocumentReady: function () {
            window.__LAB_DOC_READY__ = true;
            setStatus('onDocumentReady');
            document.body.setAttribute('data-doc-ready', '1');
          },
          onError: function (e) {
            window.__LAB_ERROR__ = JSON.stringify(e && e.data != null ? e.data : e);
            setStatus('onError');
            document.body.setAttribute('data-doc-error', '1');
          },
          onDocumentStateChange: function (e) {
            window.__LAB_DIRTY__ = !!(e && e.data);
            setStatus(e && e.data ? 'dirty' : 'clean');
            document.body.setAttribute('data-dirty', e && e.data ? '1' : '0');
          }
        }
      });
      try {
        window.__LAB_EDITOR__ = new window.DocsAPI.DocEditor('placeholder', cfg);
        setStatus('DocEditor constructed');
      } catch (err) {
        window.__LAB_ERROR__ = String(err);
        setStatus('construct failed');
      }
    };
    s.onerror = function () {
      window.__LAB_ERROR__ = 'api.js load failed';
      setStatus('api.js load failed');
    };
    document.head.appendChild(s);

    /** Insert human-edit text via connector (DocsAPI). */
    window.__LAB_MAKE_DIRTY__ = function (text) {
      return new Promise(function (resolve) {
        var settled = false;
        function done(result) {
          if (settled) return;
          settled = true;
          resolve(result);
        }
        try {
          if (!window.__LAB_EDITOR__ || !window.__LAB_EDITOR__.createConnector) {
            done({ ok: false, reason: 'no_connector' });
            return;
          }
          var connector = window.__LAB_EDITOR__.createConnector();
          window.__LAB_CONNECTOR__ = connector;
          var payload = text || ('HUMAN_EDIT_lp-5q6.38_' + Date.now());
          if (connector.executeMethod) {
            connector.executeMethod('PasteText', [payload], function () {
              window.__LAB_CONNECTOR_OK__ = true;
              done({ ok: true, method: 'PasteText' });
            });
            setTimeout(function () {
              // Method may not invoke callback in all builds; still attempt forcesave.
              done({ ok: true, method: 'PasteText_nofn' });
            }, 4000);
            return;
          }
          done({ ok: false, reason: 'no_executeMethod' });
        } catch (err) {
          done({ ok: false, reason: String(err) });
        }
      });
    };
  </script>
</body>
</html>`;
}

async function main() {
  const docxBytes = loadFixture("roundtrip.docx");
  const xlsxBytes = loadFixture("roundtrip.xlsx");
  // Real OOXML seed so Document Server can open + assemble (not fake markers).
  const vaultFiles: Record<string, Uint8Array> = {
    [DOCX_PATH]: docxBytes,
    [XLSX_PATH]: xlsxBytes,
    [E2E_PATH]: new Uint8Array(docxBytes),
  };
  const writes: WriteRecord[] = [];
  /** Sanitized last assembled fetch (host only; no query tokens). */
  let lastE2eRevisionToken: string | undefined;
  let lastAssembledFetch: {
    at: string;
    host: string;
    pathname_prefix: string;
    size_bytes?: number;
    source: "document_server" | "lab_fixture" | "other";
  } | null = null;
  const officeStore: OfficeDocumentSessionStore =
    new MemoryOfficeDocumentSessionStore();
  officeMetrics.reset();

  const sessions = new SessionStore();
  const session = await sessions.create({
    userId: "user-lab-1",
    tenantId: "tenant-lab",
    email: "lab@example.com",
  });
  const csrf = "lab-csrf-live-lp-5q6.28";

  const allowlist = {
    hosts: [
      "127.0.0.1",
      "localhost",
      "lab-onlyoffice-ds",
      "onlyoffice",
      "host.docker.internal",
      "documentserver",
    ],
    schemes: ["http", "https"],
  };

  /**
   * Hybrid fetcher: lab fixture URLs resolve in-process (avoid same-port
   * self-fetch deadlock during callback). Real DS cache hosts use HTTP.
   */
  const httpFetcher = createDefaultOfficeCallbackFetcher(allowlist);
  /**
   * Map Document Server assemble URLs to a host-reachable origin.
   * DS often emits http://127.0.0.1/cache/... (container port 80) while the
   * lab publish port is 8080 on the developer host.
   */
  function rewriteDsAssembleUrl(raw: string): string {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const dsPublish = new URL(DS_URL);
      const containerHosts = new Set([
        "lab-onlyoffice-ds",
        "onlyoffice",
        "onlyoffice-documentserver",
        "documentserver",
      ]);
      if (containerHosts.has(host)) {
        u.protocol = dsPublish.protocol;
        u.hostname = dsPublish.hostname;
        u.port = dsPublish.port;
        return u.toString();
      }
      if (
        (host === "127.0.0.1" || host === "localhost") &&
        (u.port === "" || u.port === "80") &&
        dsPublish.port &&
        dsPublish.port !== "80"
      ) {
        // Only rewrite when path looks like DS cache/assemble, not lab BFF.
        if (
          u.pathname.includes("/cache/") ||
          u.pathname.includes("/Archive") ||
          u.pathname.includes("/files/")
        ) {
          u.port = dsPublish.port;
          return u.toString();
        }
      }
    } catch {
      // keep original
    }
    return raw;
  }

  const hybridFetcher: typeof httpFetcher = async (input) => {
    const fetchUrl = rewriteDsAssembleUrl(input.url);
    try {
      const u = new URL(fetchUrl);
      const host = u.hostname.toLowerCase();
      const isLoopback = host === "127.0.0.1" || host === "localhost";
      const fixtureMatch = u.pathname.match(
        /\/lab\/fixtures\/(roundtrip\.(docx|xlsx))$/,
      );
      const isDsPath =
        u.pathname.includes("/cache/") ||
        u.pathname.includes("/files/") ||
        u.pathname.includes("/Archive");
      const isDsHost =
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "lab-onlyoffice-ds" ||
        host === "onlyoffice" ||
        host === "documentserver" ||
        host === "onlyoffice-documentserver";
      const isFixturePath = u.pathname.includes("/lab/fixtures/");
      lastAssembledFetch = {
        at: new Date().toISOString(),
        host,
        pathname_prefix: u.pathname.slice(0, 48),
        source: isFixturePath
          ? "lab_fixture"
          : isDsHost && (isDsPath || !isFixturePath)
            ? "document_server"
            : isDsHost
              ? "document_server"
              : "other",
      };
      if (isLoopback && fixtureMatch) {
        const name = fixtureMatch[1]!;
        const bytes = loadFixture(name);
        if (bytes.byteLength > input.maxBytes) {
          return { ok: false, reason: "oversized" };
        }
        lastAssembledFetch.size_bytes = bytes.byteLength;
        lastAssembledFetch.source = "lab_fixture";
        return { ok: true, bytes };
      }
    } catch {
      // fall through to HTTP
    }
    const result = await httpFetcher({ ...input, url: fetchUrl });
    if (result.ok && lastAssembledFetch) {
      lastAssembledFetch.size_bytes = result.bytes.byteLength;
    }
    return result;
  };

  const app = createApp(
    createTestBindings(
      { lab: tenantLab },
      {
        sessions,
        devTenantSlug: "lab",
        appHosts: [
          "localhost",
          "127.0.0.1",
          "host.docker.internal",
          "app.withlanyard.com",
        ],
        officeDocumentSessions: officeStore,
        officeCanVaultEdit: true,
        officeJwtSecret: JWT_SECRET,
        officePublicBaseUrl: PUBLIC_BASE,
        officeBinarySource: liveBinarySource(vaultFiles),
        officeCallbackFetcher: hybridFetcher,
        officeCallbackVaultWriter: trackingWriter({ writes, vaultFiles }),
        officeDocumentServerAllowlist: allowlist,
        vaultContentProvider: memoryVault(vaultFiles),
        authClient: {
          getUserRbac: async () => rbac,
        } as never,
      },
    ),
  );

  async function mintSession(
    path: string,
    opts?: { mode?: string; revision_token?: string },
  ) {
    const mode = opts?.mode ?? "edit";
    const body: Record<string, unknown> = { path, mode };
    // Unique revision_token forces a unique document_key (DS hangs on key reuse).
    if (opts?.revision_token) {
      body.revision = {
        token: opts.revision_token,
        kind: "content_hash",
      };
    }
    const res = await app.request("/lab/api/office/sessions", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        cookie: cookieHeader({
          lanyard_session: session.sessionId,
          lanyard_csrf: csrf,
        }),
        "x-csrf-token": csrf,
        "x-request-id": `lab-mint-${Date.now()}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json as Record<string, unknown> };
  }

  app.get("/lab/health", (c) =>
    c.json({
      ok: true,
      bead: "lp-5q6.28",
      e2e_bead: "lp-5q6.38",
      public_base: PUBLIC_BASE,
      ds_url: DS_URL,
      writes: writes.length,
      e2e_path: E2E_PATH,
    }),
  );

  app.get("/lab/evidence", (c) => {
    const snap = officeMetrics.snapshot();
    const e2eBytes = vaultFiles[E2E_PATH];
    const agentBytes = docxBytes; // agent seed baseline
    return c.json({
      bead: "lp-5q6.28",
      e2e_bead: "lp-5q6.38",
      // session_id is PREFIX ONLY — never full token in evidence
      writes: writes.map((w) => ({
        at: w.at,
        path: w.path,
        size_bytes: w.size_bytes,
        session_id_prefix: sessionIdPrefix(w.session_id),
        revision_token: w.revision_token,
        content_sha256_prefix: w.content_sha256_prefix,
      })),
      metrics: {
        callback_total: snap.callback_total,
        download_total: snap.download_total,
        config_mint_total: snap.config_mint_total,
        callback_by_code: snap.callback_by_code,
        download_by_outcome: snap.download_by_outcome,
        config_mint_by_outcome: snap.config_mint_by_outcome,
      },
      open_sizes: {
        docx: vaultFiles[DOCX_PATH]?.byteLength ?? 0,
        xlsx: vaultFiles[XLSX_PATH]?.byteLength ?? 0,
        e2e: e2eBytes?.byteLength ?? 0,
      },
      last_assembled_fetch: lastAssembledFetch,
      e2e: {
        path: E2E_PATH,
        vault_sha256_prefix: e2eBytes ? sha256Prefix(e2eBytes) : null,
        vault_size_bytes: e2eBytes?.byteLength ?? 0,
        agent_sha256_prefix: sha256Prefix(agentBytes),
        vault_matches_agent: e2eBytes
          ? Buffer.from(e2eBytes).equals(Buffer.from(agentBytes))
          : false,
        vault_differs_from_agent: e2eBytes
          ? !Buffer.from(e2eBytes).equals(Buffer.from(agentBytes))
          : false,
      },
    });
  });

  /** Seed agent bytes on the e2e path (real OOXML from roundtrip fixture). */
  let agentWriteSeq = 0;
  app.post("/lab/e2e/agent-write", (c) => {
    vaultFiles[E2E_PATH] = new Uint8Array(docxBytes);
    agentWriteSeq += 1;
    // Unique revision token so subsequent mints get a fresh document_key.
    const revision_token = `sha256:agent-${sha256Prefix(docxBytes)}-${Date.now()}-${agentWriteSeq}`;
    lastE2eRevisionToken = revision_token;
    return c.json({
      ok: true,
      path: E2E_PATH,
      size_bytes: docxBytes.byteLength,
      sha256_prefix: sha256Prefix(docxBytes),
      revision_token,
    });
  });

  /**
   * Sign ONLYOFFICE Command Service JWT for forcesave (lab only).
   * Body never returns the raw secret. Caller posts token to DS CommandService.
   */
  app.post("/lab/e2e/command-token", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      c?: string;
      key?: string;
      userdata?: string;
    };
    const cmd = body.c ?? "forcesave";
    const key = body.key?.trim();
    if (!key) {
      return c.json({ ok: false, error: "key required" }, 400);
    }
    const payload = {
      c: cmd,
      key,
      userdata: body.userdata ?? "lp-5q6.38-through-ds",
    };
    const secretKey = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secretKey);
    return c.json({
      ok: true,
      // ONLYOFFICE JWT_IN_BODY: post { token } to CommandService.ashx
      command_body: { token },
      // Also provide unsigned payload for debugging (no secret)
      command: payload,
      ds_command_url: `${DS_URL}/coauthoring/CommandService.ashx`,
    });
  });

  app.post("/lab/mint", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      mode?: string;
      revision_token?: string;
    };
    const path = body.path ?? DOCX_PATH;
    let revision_token = body.revision_token;
    const mode = body.mode ?? "edit";
    if (!revision_token && path === E2E_PATH) {
      const bytes = vaultFiles[E2E_PATH] ?? docxBytes;
      // view/reopen: content-hash only so document_key tracks vault revision.
      // edit: unique open token so Document Server does not hang on key reuse.
      if (mode === "view") {
        revision_token = `sha256:${sha256Prefix(bytes)}`;
      } else {
        revision_token = `sha256:${sha256Prefix(bytes)}-edit-${Date.now()}`;
        lastE2eRevisionToken = revision_token;
      }
    }
    const minted = await mintSession(path, {
      mode,
      revision_token,
    });
    return c.json(
      { http_status: minted.status, body: minted.body },
      minted.status === 201 || minted.status === 200 ? 200 : 500,
    );
  });

  app.get("/lab/editor", async (c) => {
    const fileType = (c.req.query("type") ?? "docx").toLowerCase();
    let path = DOCX_PATH;
    let displayType = fileType;
    if (fileType === "xlsx") {
      path = XLSX_PATH;
    } else if (fileType === "e2e" || fileType === "e2e-proof") {
      path = E2E_PATH;
      displayType = "docx";
    } else if (c.req.query("path")) {
      path = String(c.req.query("path"));
    }
    let revision_token: string | undefined;
    if (path === E2E_PATH) {
      const bytes = vaultFiles[E2E_PATH] ?? docxBytes;
      // Always unique document_key per editor open (DS key reuse hangs DocsAPI).
      revision_token = `sha256:${sha256Prefix(bytes)}-open-${Date.now()}`;
      lastE2eRevisionToken = revision_token;
    }
    const minted = await mintSession(path, { revision_token });
    if (minted.status !== 201 && minted.status !== 200) {
      return c.html(
        `<pre data-testid="lab-mint-error">mint failed ${minted.status}: ${JSON.stringify(minted.body)}</pre>`,
        500,
      );
    }
    const sessionId = String(minted.body.session_id ?? "");
    const documentKey = String(minted.body.document_key ?? "");
    const editorConfig = minted.body.editor_config as Record<string, unknown>;
    const html = labHostPageHtml({
      dsUrl: DS_URL,
      editorConfigJson: JSON.stringify(editorConfig),
      fileType: displayType,
      sessionId,
      documentKey,
      path,
    });
    return c.html(html);
  });

  app.get("/lab/fixtures/:name", (c) => {
    const name = c.req.param("name");
    if (name !== "roundtrip.docx" && name !== "roundtrip.xlsx") {
      return c.text("not found", 404);
    }
    const bytes = loadFixture(name);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
    });
  });

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "lab_bff_listening",
        port: info.port,
        public_base: PUBLIC_BASE,
        ds_url: DS_URL,
        editor_docx: `http://127.0.0.1:${info.port}/lab/editor?type=docx`,
        editor_xlsx: `http://127.0.0.1:${info.port}/lab/editor?type=xlsx`,
        editor_e2e: `http://127.0.0.1:${info.port}/lab/editor?type=e2e`,
        evidence: `http://127.0.0.1:${info.port}/lab/evidence`,
        health: `http://127.0.0.1:${info.port}/lab/health`,
      }),
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
