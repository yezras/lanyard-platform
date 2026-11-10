/**
 * lp-ye4.11 — BFF HTTP routes for history.list / heads.artifact.
 *
 * Offline unit/integration style: FakeBackendRuntimeService + mock auth
 * (no Postgres). Covers happy path, ACL denied, capability unavailable.
 */
import { describe, expect, it } from "vitest";
import {
  bodyHashFromUtf8,
  FakeBackendRuntimeService,
  revisionFromUtf8,
  type OperationActor,
} from "@lanyard/backend-runtime";

import { createApp } from "../src/app.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-history-ux",
  tenant_slug: "history-ux",
  display_name: "History UX",
  host: "history-ux.withlanyard.com",
};
const userId = "user-history-ux";

const HUMAN: OperationActor = {
  kind: "human",
  subject_id: userId,
  portal_user_id: userId,
  display_name: "History Human",
};

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  cookies: Record<string, string>,
): Promise<{ status: number; body: JsonBody }> {
  const headers = new Headers({
    host: tenant.host,
    cookie: cookieHeader(cookies),
  });
  const response = await app.request(path, { headers });
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

function seedLedger(backend: FakeBackendRuntimeService): void {
  const rev1 = revisionFromUtf8("memo v1");
  backend.commitLedgerMutation({
    kind: "file_create",
    actor: HUMAN,
    path: "/Projects/Legal/memo.md",
    revision: rev1,
    bodyHash: bodyHashFromUtf8("memo v1"),
    vaultWriteMode: "create_new",
    idempotencyKey: "create-memo",
  });
  const rev2 = revisionFromUtf8("memo v2");
  backend.commitLedgerMutation({
    kind: "file_replace",
    actor: HUMAN,
    path: "/Projects/Legal/memo.md",
    revision: rev2,
    bodyHash: bodyHashFromUtf8("memo v2"),
    expectedRevision: rev1,
    vaultWriteMode: "replace_if_match",
    idempotencyKey: "replace-memo-v2",
  });
  backend.commitLedgerMutation({
    kind: "file_create",
    actor: HUMAN,
    path: "/Secrets/note.md",
    revision: revisionFromUtf8("secret"),
    bodyHash: bodyHashFromUtf8("secret"),
    vaultWriteMode: "create_new",
    idempotencyKey: "create-secret",
  });
}

async function boot(options?: {
  supportLedgerReads?: boolean;
  pathPrefixes?: string[];
}) {
  const supportLedgerReads = options?.supportLedgerReads !== false;
  const pathPrefixes = options?.pathPrefixes ?? ["/Projects/Legal"];

  const backend = new FakeBackendRuntimeService({
    supportLedgerReads,
    ledger: {
      tenantId: tenant.tenant_id,
      instanceId: "inst_history_ux",
    },
  });
  if (supportLedgerReads) {
    seedLedger(backend);
  }

  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "history@example.com",
  });

  const authClient = {
    getUserRbac: async () => ({
      user_id: userId,
      tenant_id: tenant.tenant_id,
      hermes_profile: "contributor",
      allowed_path_prefixes: pathPrefixes,
      role_names: ["legal-reader"],
    }),
    getPrimaryGatewayInstance: async () => ({
      instance_id: "inst_history_ux",
    }),
    getActiveSessionShare: async () => null,
  };

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        authClient: authClient as never,
        backendRuntimeService: backend,
        brainRpcEnabled: true,
      },
    ),
  );

  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: "test-csrf-history",
  };

  return { app, cookies, backend };
}

describe("bff vault history / heads HTTP (lp-ye4.11)", () => {
  it("history happy path returns ACL-filtered events", async () => {
    const { app, cookies } = await boot();
    const res = await jsonRequest(
      app,
      "/api/vault/history?path=/Projects/Legal/memo.md",
      cookies,
    );
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/Projects/Legal/memo.md");
    const events = res.body.events as Array<Record<string, unknown>>;
    expect(events.length).toBe(2);
    expect(
      events.every(
        (e) =>
          (e.target as { path?: string } | undefined)?.path ===
          "/Projects/Legal/memo.md",
      ),
    ).toBe(true);
    expect(res.body.source).toBe("brain_rpc");
  });

  it("artifact head happy path returns operation_id + revision", async () => {
    const { app, cookies } = await boot();
    const res = await jsonRequest(
      app,
      "/api/vault/heads/artifact?path=/Projects/Legal/memo.md",
      cookies,
    );
    expect(res.status).toBe(200);
    expect(res.body.record_type).toBe("artifact_head");
    expect(res.body.path).toBe("/Projects/Legal/memo.md");
    expect(res.body.operation_id).toMatch(/^op_/);
    expect((res.body.revision as { token: string }).token).toBe(
      revisionFromUtf8("memo v2").token,
    );
    expect(res.body.head_kind).toBe("canonical");
  });

  it("history denied path outside ACL returns forbidden", async () => {
    const { app, cookies } = await boot();
    const res = await jsonRequest(
      app,
      "/api/vault/history?path=/Secrets/note.md",
      cookies,
    );
    expect(res.status).toBe(403);
    // assertVaultPathAccess throws HTTPException (message only); history-bff
    // would also return code: forbidden for the same path when reached.
    expect(String(res.body.error ?? res.body.message ?? "")).toMatch(
      /not permitted|forbidden/i,
    );
  });

  it("heads denied path outside ACL returns forbidden", async () => {
    const { app, cookies } = await boot();
    const res = await jsonRequest(
      app,
      "/api/vault/heads/artifact?path=/Secrets/note.md",
      cookies,
    );
    expect(res.status).toBe(403);
    expect(String(res.body.error ?? res.body.message ?? "")).toMatch(
      /not permitted|forbidden/i,
    );
  });

  it("history returns method_not_found when ledger reads not advertised", async () => {
    const { app, cookies } = await boot({ supportLedgerReads: false });
    const res = await jsonRequest(
      app,
      "/api/vault/history?path=/Projects/Legal/memo.md",
      cookies,
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("method_not_found");
    expect(res.body.unavailable).toBe(true);
  });
});
