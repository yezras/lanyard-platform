/**
 * lp-oop.13 — HTTP integration: tree/entries/content + office mint/download
 * on VaultPlane=cp_s3. Fake CP + FakeS3 only. No Daytona wake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
import { VAULT_HTTP_API_PATHS } from "../../control-plane/src/vault-http.js";
import { buildS3VaultPrefix } from "../../control-plane/src/vault-prefix.js";
import { createApp } from "../src/app.js";
import type { UserRbac } from "../src/control-plane-client.js";
import {
  createCpS3OfficeBinaryContentSource,
  MemoryOfficeDocumentSessionStore,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import { SessionStore } from "../src/session.js";
import { createCpS3VaultContentProvider } from "../src/vault/cp-s3-provider.js";
import { createCpS3WorkflowRunVaultPersist } from "../src/workflow-run-vault-persist.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT_ID);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");
const CP_BASE = "http://control-plane.test";
const SERVICE_TOKEN = "test-cp-service-token";
const JWT_SECRET = "test-onlyoffice-jwt-secret-lp-oop.13";
const PUBLIC_BASE = "http://bff.test:4000";

const OFFICE_PATH = "/Projects/Acme/proposal.docx";
const OFFICE_UNIQUE = "PK-fake-office-cp-s3-bytes-lp-oop.13-UNIQUE-payload";
const OFFICE_B64 = Buffer.from(OFFICE_UNIQUE, "utf8").toString("base64");
const OFFICE_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const tenant: TenantContext = {
  tenant_id: TENANT_ID,
  tenant_slug: "vault-office-cp",
  display_name: "Vault Office CP",
  host: "vault-office-cp.withlanyard.com",
};
const userId = "user-vault-office-cp";

type RecordedCall = {
  path: string;
  search: string;
  method: string;
};

function mockStore(): ControlPlaneStore {
  return {} as unknown as ControlPlaneStore;
}

function pathnameOf(input: string): { path: string; search: string } {
  const url = new URL(String(input), "http://unused.test");
  return { path: url.pathname, search: url.search };
}

function seedVault(store: FakeS3ObjectStore): void {
  store.seed(BUCKET, `${PREFIX}AGENTS.md`, "# tenant A\n", "text/markdown");
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Alpha/readme.md`,
    "hello alpha\n",
    "text/markdown",
  );
  store.seed(
    BUCKET,
    `${PREFIX}Projects/A/notes.md`,
    "team A notes\n",
    "text/markdown",
  );
  store.seed(
    BUCKET,
    `${PREFIX}Projects/B/secret.md`,
    "team B only\n",
    "text/plain",
  );
  store.seed(BUCKET, `${PREFIX}Projects/Acme/proposal.docx`, OFFICE_UNIQUE, OFFICE_MIME);
}

function rbacFor(prefixes: string[]): UserRbac {
  return {
    user_id: userId,
    tenant_id: TENANT_ID,
    hermes_profile: "default",
    allowed_path_prefixes: prefixes,
    role_names: ["member"],
  };
}

async function bootCpS3Routes(
  options: { prefixes?: string[]; vault_edit?: boolean } = {},
) {
  const store = new FakeS3ObjectStore({ now: FIXED_NOW });
  seedVault(store);
  const cpEnsureOnline = vi.fn(async () => {
    throw new Error("CP ensureOnline must not run on VaultPlane=cp_s3");
  });
  const cpApp = createControlPlaneApp(mockStore(), {
    devOpen: true,
    vaultObjectStore: store,
    vaultBucket: BUCKET,
    instanceOrchestrator: {
      ensureOnline: cpEnsureOnline,
      stop: vi.fn(),
    },
  });
  const calls: RecordedCall[] = [];
  const requestFn = (input: string, init?: RequestInit) => {
    const parsed = pathnameOf(String(input));
    calls.push({
      path: parsed.path,
      search: parsed.search,
      method: init?.method ?? "GET",
    });
    return cpApp.request(parsed.path + parsed.search, init);
  };

  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "vault-office-cp@example.com",
  });
  const bffEnsureOnline = vi.fn(async () => {
    throw new Error("BFF ensureOnline must not run on VaultPlane=cp_s3");
  });
  const getPrimaryGatewayInstance = vi.fn(async () => {
    throw new Error("instance lookup must not run on VaultPlane=cp_s3");
  });
  const invokeBrainRpc = vi.fn(async () => {
    throw new Error("Brain RPC must not run on VaultPlane=cp_s3");
  });
  const createCpS3VaultProvider = vi.fn((tenantId: string) =>
    createCpS3VaultContentProvider({
      tenantId,
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    }),
  );
  const createCpS3OfficeBinarySource = vi.fn((tenantId: string) =>
    createCpS3OfficeBinaryContentSource({
      tenantId,
      baseUrl: CP_BASE,
      requestFn,
      serviceToken: SERVICE_TOKEN,
    }),
  );
  const officeDocumentSessions = new MemoryOfficeDocumentSessionStore();
  const csrf = "test-csrf-token-lp-oop.13";
  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: csrf,
  };

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        vaultPlane: "cp_s3",
        brainRpcEnabled: true,
        ensureOnlineOnBrainRpc: true,
        createCpS3VaultProvider,
        createCpS3OfficeBinarySource,
        workflowRunVaultPersist: createCpS3WorkflowRunVaultPersist({
          baseUrl: CP_BASE,
          serviceToken: SERVICE_TOKEN,
          requestFn,
          now: FIXED_NOW,
        }),
        officeDocumentSessions,
        officeCanVaultEdit: options.vault_edit ?? true,
        officeJwtSecret: JWT_SECRET,
        officePublicBaseUrl: PUBLIC_BASE,
        authClient: {
          getUserRbac: async () => rbacFor(options.prefixes ?? ["/"]),
          getPrimaryGatewayInstance,
          ensureOnline: bffEnsureOnline,
        } as never,
        relayClient: {
          invokeBrainRpc,
        } as never,
      },
    ),
  );

  return {
    app,
    cookies,
    csrf,
    store,
    calls,
    officeDocumentSessions,
    cpEnsureOnline,
    bffEnsureOnline,
    getPrimaryGatewayInstance,
    invokeBrainRpc,
    createCpS3VaultProvider,
    createCpS3OfficeBinarySource,
  };
}

function assertNoWake(ctx: {
  cpEnsureOnline: ReturnType<typeof vi.fn>;
  bffEnsureOnline: ReturnType<typeof vi.fn>;
  getPrimaryGatewayInstance: ReturnType<typeof vi.fn>;
  invokeBrainRpc: ReturnType<typeof vi.fn>;
  calls: RecordedCall[];
}): void {
  expect(ctx.cpEnsureOnline).not.toHaveBeenCalled();
  expect(ctx.bffEnsureOnline).not.toHaveBeenCalled();
  expect(ctx.getPrimaryGatewayInstance).not.toHaveBeenCalled();
  expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
  expect(ctx.calls.every((c) => !c.path.includes("ensure-online"))).toBe(true);
}

describe("Vault + Office HTTP on VaultPlane=cp_s3 (lp-oop.13)", () => {
  let officeStore: OfficeDocumentSessionStore | undefined;

  afterEach(async () => {
    await officeStore?.clear();
    officeStore = undefined;
  });

  it("GET /api/vault/tree lists CP S3 without calling ensure_online", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    const res = await ctx.app.request("/api/vault/tree", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ path: string; kind: string }>;
      source?: string;
    };
    expect(body.source).not.toBe("brain_rpc");
    expect(body.roots.map((n) => n.path)).toEqual(["/Projects", "/AGENTS.md"]);
    expect(ctx.createCpS3VaultProvider).toHaveBeenCalledWith(tenant.tenant_id);
    expect(ctx.calls.some((c) => c.path === VAULT_HTTP_API_PATHS.list(TENANT_ID))).toBe(
      true,
    );
    assertNoWake(ctx);
  });

  it("GET /api/vault/entries lists a directory without calling ensure_online", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    const res = await ctx.app.request("/api/vault/entries?path=/Projects/Alpha", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      entries: Array<{ path: string; kind: string; name: string }>;
      truncated: boolean;
      next_cursor: string | null;
    };
    expect(body.path).toBe("/Projects/Alpha");
    expect(body.truncated).toBe(false);
    expect(body.next_cursor).toBeNull();
    expect(body.entries).toEqual([
      {
        name: "readme.md",
        path: "/Projects/Alpha/readme.md",
        kind: "file",
        mime_type: "text/markdown",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("secret.md");
    assertNoWake(ctx);
  });

  it("GET /api/vault/content reads a file without calling ensure_online", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    const res = await ctx.app.request(
      "/api/vault/content?path=/Projects/Alpha/readme.md",
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      encoding: string;
      content: string;
      mime_type: string;
    };
    expect(body.path).toBe("/Projects/Alpha/readme.md");
    expect(body.encoding).toBe("utf-8");
    expect(body.mime_type).toBe("text/markdown");
    expect(body.content).toBe("hello alpha\n");
    expect(ctx.calls.some((c) => c.path === VAULT_HTTP_API_PATHS.get(TENANT_ID))).toBe(
      true,
    );
    expect(ctx.calls[0]?.path).not.toContain("ensure-online");
    assertNoWake(ctx);
  });

  it("GET /api/vault/content denies ACL and missing paths without waking", async () => {
    const ctx = await bootCpS3Routes({ prefixes: ["/Projects/A"] });
    officeStore = ctx.officeDocumentSessions;

    const denied = await ctx.app.request(
      "/api/vault/content?path=/Projects/B/secret.md",
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(denied.status).toBe(403);

    const missing = await ctx.app.request(
      "/api/vault/content?path=/Projects/A/missing.md",
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(missing.status).toBe(404);
    assertNoWake(ctx);
  });

  it("GET /api/vault/content materializes missing workflow state.json (lp-oop.38.22)", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    const path = "/workflows/runs/wf_03e3fb5b2224a1d2/state.json";
    const res = await ctx.app.request(
      `/api/vault/content?path=${encodeURIComponent(path)}`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/json/i);
    const body = (await res.json()) as {
      path: string;
      content: string;
      mime_type: string;
    };
    expect(body.path).toBe(path);
    expect(() => JSON.parse(body.content)).not.toThrow();
    expect(JSON.parse(body.content)).toMatchObject({
      run_id: "wf_03e3fb5b2224a1d2",
      source: "bff_workflow_event",
    });
    expect(ctx.calls.some((c) => c.method === "PUT")).toBe(true);

    const again = await ctx.app.request(
      `/api/vault/content?path=${encodeURIComponent(path)}`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { content: string };
    expect(JSON.parse(againBody.content).run_id).toBe("wf_03e3fb5b2224a1d2");
    assertNoWake(ctx);
  });

  it("POST /api/office/sessions mints from CP S3 without ensure_online", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    const res = await ctx.app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(ctx.cookies),
        "x-csrf-token": ctx.csrf,
      },
      body: JSON.stringify({ path: OFFICE_PATH, mode: "view" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      session_id: string;
      document_key: string;
      path: string;
      mode: string;
      file_type: string;
      editor_config: {
        documentType: string;
        document: {
          fileType: string;
          title: string;
          url: string;
          key: string;
          permissions: { edit: boolean };
        };
        token: string;
      };
    };
    expect(body.path).toBe(OFFICE_PATH);
    expect(body.mode).toBe("view");
    expect(body.file_type).toBe("docx");
    expect(body.session_id).toBeTruthy();
    expect(body.document_key).toHaveLength(64);
    expect(body.editor_config.documentType).toBe("word");
    expect(body.editor_config.document.fileType).toBe("docx");
    expect(body.editor_config.document.title).toBe("proposal.docx");
    expect(body.editor_config.document.url).toContain(
      `/api/office/sessions/${body.session_id}/content?token=`,
    );
    expect(body.editor_config.document.permissions.edit).toBe(false);
    expect(body.editor_config.token.split(".")).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain(JWT_SECRET);
    expect(JSON.stringify(body)).not.toContain(OFFICE_UNIQUE);
    expect(ctx.createCpS3VaultProvider).toHaveBeenCalledWith(tenant.tenant_id);
    expect(ctx.calls.some((c) => c.path === VAULT_HTTP_API_PATHS.get(TENANT_ID))).toBe(
      true,
    );
    assertNoWake(ctx);
  });

  it("mint + signed GET streams FakeS3 bytes without ensure_online or full body log", async () => {
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

    let downloadToken = "";
    try {
      const ctx = await bootCpS3Routes();
      officeStore = ctx.officeDocumentSessions;
      const mint = await ctx.app.request("/api/office/sessions", {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(ctx.cookies),
          "x-csrf-token": ctx.csrf,
        },
        body: JSON.stringify({ path: OFFICE_PATH, mode: "view" }),
      });
      expect(mint.status).toBe(201);
      const minted = (await mint.json()) as {
        session_id: string;
        editor_config: { document: { url: string } };
      };
      const url = new URL(minted.editor_config.document.url);
      downloadToken = url.searchParams.get("token") ?? "";
      expect(downloadToken.length).toBeGreaterThan(8);

      const res = await ctx.app.request(
        `/api/office/sessions/${minted.session_id}/content?token=${encodeURIComponent(downloadToken)}`,
        { headers: { host: tenant.host } },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("wordprocessingml");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.toString("utf8")).toBe(OFFICE_UNIQUE);
      expect(ctx.store.getGetCount()).toBeGreaterThan(0);
      expect(ctx.createCpS3OfficeBinarySource).toHaveBeenCalledWith(
        tenant.tenant_id,
      );
      expect(
        ctx.calls.some((c) => c.path === VAULT_HTTP_API_PATHS.get(TENANT_ID)),
      ).toBe(true);
      assertNoWake(ctx);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }

    const dumped = lines.join("\n");
    expect(dumped).not.toContain(OFFICE_B64);
    expect(dumped).not.toContain(OFFICE_UNIQUE);
    expect(dumped).not.toContain(downloadToken);
    expect(dumped).not.toContain(JWT_SECRET);
  });

  it("lp-oop.38.9: chat citation markdown + office mint stay on CP S3 (no guest)", async () => {
    const ctx = await bootCpS3Routes();
    officeStore = ctx.officeDocumentSessions;
    ctx.store.seed(
      BUCKET,
      `${PREFIX}Notes/memo.md`,
      "# memo\n",
      "text/markdown",
    );
    const citedOffice =
      "/Projects/Workspace/office/brief.docx";
    ctx.store.seed(
      BUCKET,
      `${PREFIX}Projects/Workspace/office/brief.docx`,
      OFFICE_UNIQUE,
      OFFICE_MIME,
    );

    const md = await ctx.app.request("/api/vault/content?path=/Notes/memo.md", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(md.status).toBe(200);
    const mdBody = (await md.json()) as { path: string; content: string };
    expect(mdBody.path).toBe("/Notes/memo.md");
    expect(mdBody.content).toBe("# memo\n");

    const mint = await ctx.app.request("/api/office/sessions", {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(ctx.cookies),
        "x-csrf-token": ctx.csrf,
      },
      body: JSON.stringify({ path: citedOffice, mode: "view" }),
    });
    expect(mint.status).toBe(201);
    const minted = (await mint.json()) as {
      path: string;
      session_id: string;
      editor_config: { document: { url: string; fileType: string } };
    };
    expect(minted.path).toBe(citedOffice);
    expect(minted.editor_config.document.fileType).toBe("docx");
    const url = new URL(minted.editor_config.document.url);
    const token = url.searchParams.get("token") ?? "";
    const download = await ctx.app.request(
      `/api/office/sessions/${minted.session_id}/content?token=${encodeURIComponent(token)}`,
      { headers: { host: tenant.host } },
    );
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).toString("utf8")).toBe(
      OFFICE_UNIQUE,
    );
    expect(ctx.createCpS3VaultProvider).toHaveBeenCalled();
    expect(ctx.createCpS3OfficeBinarySource).toHaveBeenCalled();
    assertNoWake(ctx);
  });
});
