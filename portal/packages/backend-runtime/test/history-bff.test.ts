/**
 * lp-ye4.7 — Brain RPC history and head read APIs (BFF + fake host).
 *
 * Covers:
 * - happy-path history.list + heads.artifact + heads.workspace
 * - path ACL filtering / forbidden outside prefixes
 * - unsupported capability → method_not_found
 * - Fake Brain RPC invoker implements methods when advertised
 */

import { describe, expect, it } from "vitest";

import {
  BackendRuntimeError,
  FakeBackendRuntimeService,
  bodyHashFromUtf8,
  createFakeBrainRpcInvoker,
  createProductionHermesBackendRuntimeService,
  getArtifactHeadRead,
  getWorkspaceHeadRead,
  historyErrorToHttp,
  historyListIsAdvertised,
  headsArtifactIsAdvertised,
  listArtifactHistory,
  revisionFromUtf8,
  type BackendRuntimeContext,
  type OperationActor,
} from "../src/index.js";

const HUMAN: OperationActor = {
  kind: "human",
  subject_id: "usr_test",
  portal_user_id: "usr_test",
  display_name: "Test Human",
};

function ctx(pathPrefixes: string[]): BackendRuntimeContext {
  return {
    tenantId: "ten_test",
    instanceId: "inst_test",
    userId: "usr_test",
    sessionId: "sess_test",
    profile: { name: "contributor", pathPrefixes },
    roles: ["contributor"],
  };
}

function seedMemoLedger(backend: FakeBackendRuntimeService): void {
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
  // Outside ACL for contributor limited to /Projects/Legal
  const secretRev = revisionFromUtf8("secret");
  backend.commitLedgerMutation({
    kind: "file_create",
    actor: HUMAN,
    path: "/Secrets/note.md",
    revision: secretRev,
    bodyHash: bodyHashFromUtf8("secret"),
    vaultWriteMode: "create_new",
    idempotencyKey: "create-secret",
  });
}

describe("history / heads BFF (lp-ye4.7)", () => {
  it("happy path: history.list + artifact head + workspace head", async () => {
    const backend = new FakeBackendRuntimeService({
      supportLedgerReads: true,
      ledger: { tenantId: "ten_test", instanceId: "inst_test" },
    });
    seedMemoLedger(backend);

    const c = ctx(["/Projects/Legal"]);
    const history = await listArtifactHistory(backend, c, {
      path: "/Projects/Legal/memo.md",
    });
    expect(history.path).toBe("/Projects/Legal/memo.md");
    expect(history.events.length).toBe(2);
    expect(history.events.every((e) => e.target.path === "/Projects/Legal/memo.md")).toBe(
      true,
    );
    expect(history.truncated).toBe(false);
    expect(history.source).toBe("brain_rpc");

    const head = await getArtifactHeadRead(backend, c, {
      path: "/Projects/Legal/memo.md",
    });
    expect(head.record_type).toBe("artifact_head");
    expect(head.path).toBe("/Projects/Legal/memo.md");
    expect(head.operation_id).toBe(history.events[1]!.operation_id);
    expect(head.revision.token).toBe(revisionFromUtf8("memo v2").token);
    expect(head.source).toBe("brain_rpc");

    const ws = await getWorkspaceHeadRead(backend, c, { workspaceId: "default" });
    expect(ws.record_type).toBe("workspace_head");
    expect(ws.workspace_id).toBe("default");
    expect(ws.tree_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ws.operation_id).toBeTruthy();
  });

  it("ACL: forbids history and head reads outside pathPrefixes", async () => {
    const backend = new FakeBackendRuntimeService({
      supportLedgerReads: true,
    });
    seedMemoLedger(backend);
    const c = ctx(["/Projects/Legal"]);

    await expect(
      listArtifactHistory(backend, c, { path: "/Secrets/note.md" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      getArtifactHeadRead(backend, c, { path: "/Secrets/note.md" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Allowed path does not leak secret events
    const history = await listArtifactHistory(backend, c, {
      path: "/Projects/Legal/memo.md",
    });
    expect(
      history.events.some((e) => e.target.path.startsWith("/Secrets")),
    ).toBe(false);
  });

  it("unsupported capability: method_not_found when not advertised", async () => {
    const backend = new FakeBackendRuntimeService({
      supportLedgerReads: false,
    });
    seedMemoLedger(backend);
    const c = ctx(["/"]);

    const caps = await backend.capabilities(c);
    expect(historyListIsAdvertised(caps)).toBe(false);
    expect(headsArtifactIsAdvertised(caps)).toBe(false);

    await expect(
      listArtifactHistory(backend, c, { path: "/Projects/Legal/memo.md" }),
    ).rejects.toMatchObject({ code: "method_not_found" });

    await expect(
      getArtifactHeadRead(backend, c, { path: "/Projects/Legal/memo.md" }),
    ).rejects.toMatchObject({ code: "method_not_found" });

    await expect(getWorkspaceHeadRead(backend, c)).rejects.toMatchObject({
      code: "method_not_found",
    });

    const mapped = historyErrorToHttp(
      new BackendRuntimeError("method_not_found", "not advertised", {
        retryable: false,
        details: { method: "history.list" },
      }),
    );
    expect(mapped.status).toBe(404);
    expect(mapped.body.unavailable).toBe(true);
  });

  it("Fake Brain RPC implements history/head methods for local tests", async () => {
    const invoke = createFakeBrainRpcInvoker({
      supportLedgerReads: true,
      ledger: { tenantId: "ten_test", instanceId: "inst_test" },
    });
    seedMemoLedger(invoke.backend);

    const methods = invoke.supportedMethods();
    expect(methods).toContain("history.list");
    expect(methods).toContain("heads.artifact");
    expect(methods).toContain("heads.workspace");

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const c = ctx(["/Projects/Legal"]);

    const history = await listArtifactHistory(service, c, {
      path: "/Projects/Legal/memo.md",
      limit: 10,
    });
    expect(history.events.length).toBe(2);

    const head = await getArtifactHeadRead(service, c, {
      path: "/Projects/Legal/memo.md",
    });
    expect(head.operation_id).toBe(history.events[1]!.operation_id);

    const ws = await getWorkspaceHeadRead(service, c);
    expect(ws.tree_root_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("Fake Brain RPC returns method_not_found when ledger reads off", async () => {
    const invoke = createFakeBrainRpcInvoker({
      supportLedgerReads: false,
    });
    const c = ctx(["/"]);
    await expect(
      invoke({
        method: "history.list",
        params: { path: "/Projects/Legal/memo.md" },
        ctx: c,
      }),
    ).rejects.toMatchObject({ code: "method_not_found" });
  });

  it("capabilities advertise history/head only when supportLedgerReads", async () => {
    const off = new FakeBackendRuntimeService({ supportLedgerReads: false });
    const on = new FakeBackendRuntimeService({ supportLedgerReads: true });
    const c = ctx(["/"]);

    const offCaps = await off.capabilities(c);
    expect(offCaps.features.history_read).toBe(false);
    expect(offCaps.features.heads_read).toBe(false);
    expect(offCaps.brain_rpc_methods).not.toContain("history.list");

    const onCaps = await on.capabilities(c);
    expect(onCaps.features.history_read).toBe(true);
    expect(onCaps.features.heads_read).toBe(true);
    expect(onCaps.brain_rpc_methods).toEqual(
      expect.arrayContaining([
        "history.list",
        "heads.artifact",
        "heads.workspace",
      ]),
    );
  });
});
