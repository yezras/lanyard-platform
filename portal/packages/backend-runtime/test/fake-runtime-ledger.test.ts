/**
 * lp-ye4.6 — Fake runtime ledger and current-head harness.
 *
 * Proves:
 * - append-only events + materialized artifact/workspace heads in memory
 * - idempotency replay returns the original event and head values
 * - CAS conflict records operation_rejected without advancing heads
 * - workspace tree root changes on create / replace / rename / delete
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FakeBackendRuntimeService,
  FakeRuntimeLedger,
  FakeRuntimeLedgerError,
  bodyHashFromUtf8,
  parseSignedOperationEventOnly,
  revisionFromUtf8,
  type OperationActor,
  type SignedOperationEvent,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(
  HERE,
  "../../../../contracts/backend-runtime-v1/examples",
);

function loadEvent(name: string): SignedOperationEvent {
  const raw = JSON.parse(
    readFileSync(join(EXAMPLES_DIR, name), "utf8"),
  ) as unknown;
  return parseSignedOperationEventOnly(raw);
}

const HUMAN: OperationActor = {
  kind: "human",
  subject_id: "usr_test",
  portal_user_id: "usr_test",
  display_name: "Test Human",
};

const AGENT: OperationActor = {
  kind: "agent",
  subject_id: "agent:main",
  agent_id: "agent:main",
  run_id: "run-1",
};

describe("FakeRuntimeLedger (lp-ye4.6)", () => {
  it("stores append-only events and materializes artifact + workspace heads", () => {
    const ledger = new FakeRuntimeLedger({
      tenantId: "ten_test",
      instanceId: "inst_test",
    });

    const rev1 = revisionFromUtf8("hello v1");
    const r1 = ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/Projects/Legal/memo.md",
      revision: rev1,
      bodyHash: bodyHashFromUtf8("hello v1"),
      vaultWriteMode: "create_new",
      idempotencyKey: "create-memo-v1",
    });

    expect(r1.event.result.status).toBe("committed");
    expect(r1.event.kind).toBe("file_create");
    expect(r1.event.operation_id.startsWith("op_")).toBe(true);
    expect(r1.event.operation_id).not.toBe(rev1.token);
    expect(r1.event.advances_artifact_head).toBe(true);
    expect(r1.event.advances_workspace_head).toBe(true);

    const art = ledger.getArtifactHead("/Projects/Legal/memo.md");
    expect(art).toBeDefined();
    expect(art!.revision.token).toBe(rev1.token);
    expect(art!.operation_id).toBe(r1.event.operation_id);
    expect(art!.head_kind).toBe("canonical");

    const ws = ledger.getWorkspaceHead();
    expect(ws).toBeDefined();
    expect(ws!.tree_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ws!.operation_id).toBe(r1.event.operation_id);
    expect(ws!.entry_count).toBe(1);

    expect(ledger.listEvents()).toHaveLength(1);
    expect(ledger.listEvents()[0]!.operation_id).toBe(r1.event.operation_id);
  });

  it("idempotency replay returns the original ledger event and head values", () => {
    const ledger = new FakeRuntimeLedger();
    const rev = revisionFromUtf8("body-a");
    const input = {
      kind: "file_create" as const,
      actor: HUMAN,
      path: "/Projects/A/note.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("body-a"),
      idempotencyKey: "idem-note-1",
      vaultWriteMode: "create_new" as const,
    };

    const first = ledger.commit(input);
    expect(first.idempotentReplay).toBe(false);
    const headAfterFirst = ledger.getArtifactHead("/Projects/A/note.md");
    const wsAfterFirst = ledger.getWorkspaceHead();
    expect(headAfterFirst).toBeDefined();
    expect(wsAfterFirst).toBeDefined();

    // Mutate nothing; second commit with same key + fingerprint is a replay.
    const second = ledger.commit(input);
    expect(second.idempotentReplay).toBe(true);
    expect(second.event.operation_id).toBe(first.event.operation_id);
    expect(second.event.result.revision?.token).toBe(rev.token);
    expect(second.event.result.idempotent_replay).toBe(true);
    expect(second.artifactHead?.operation_id).toBe(headAfterFirst!.operation_id);
    expect(second.artifactHead?.revision.token).toBe(headAfterFirst!.revision.token);
    expect(second.workspaceHead?.tree_root_hash).toBe(
      wsAfterFirst!.tree_root_hash,
    );
    expect(second.workspaceHead?.operation_id).toBe(wsAfterFirst!.operation_id);

    // No second event appended.
    expect(ledger.listEvents()).toHaveLength(1);
    // Heads unchanged.
    expect(ledger.getArtifactHead("/Projects/A/note.md")!.revision.token).toBe(
      rev.token,
    );
    expect(ledger.getWorkspaceHead()!.tree_root_hash).toBe(
      wsAfterFirst!.tree_root_hash,
    );
  });

  it("idempotency key conflict when fingerprint differs", () => {
    const ledger = new FakeRuntimeLedger();
    ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/x.md",
      revision: revisionFromUtf8("a"),
      idempotencyKey: "same-key",
    });
    expect(() =>
      ledger.commit({
        kind: "file_create",
        actor: HUMAN,
        path: "/x.md",
        revision: revisionFromUtf8("b"),
        idempotencyKey: "same-key",
      }),
    ).toThrow(FakeRuntimeLedgerError);
  });

  it("CAS conflict records rejected operation without advancing heads", () => {
    const ledger = new FakeRuntimeLedger();
    const base = revisionFromUtf8("base-body");
    const created = ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/Projects/Legal/memo.md",
      revision: base,
      vaultWriteMode: "create_new",
    });
    const headToken = ledger.getArtifactHead("/Projects/Legal/memo.md")!
      .revision.token;
    const wsHash = ledger.getWorkspaceHead()!.tree_root_hash;
    const eventCount = ledger.listEvents().length;

    const staleExpected = revisionFromUtf8("stale-never-was-head");
    const conflict = ledger.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/Projects/Legal/memo.md",
      revision: revisionFromUtf8("attacker-body"),
      expectedRevision: staleExpected,
      vaultWriteMode: "replace_if_match",
      bodyHash: bodyHashFromUtf8("attacker-body"),
      idempotencyKey: "stale-replace-1",
    });

    expect(conflict.event.kind).toBe("operation_rejected");
    expect(conflict.event.result.status).toBe("rejected");
    expect(conflict.event.result.reason).toBe("revision_mismatch");
    expect(conflict.event.advances_artifact_head).toBe(false);
    expect(conflict.event.advances_workspace_head).toBe(false);
    expect(conflict.event.result.prior_revision?.token).toBe(
      staleExpected.token,
    );
    expect(conflict.event.result.actual_revision?.token).toBe(headToken);
    // Rejected events are still in the append-only log.
    expect(ledger.listEvents()).toHaveLength(eventCount + 1);

    // Heads unchanged.
    expect(ledger.getArtifactHead("/Projects/Legal/memo.md")!.revision.token).toBe(
      headToken,
    );
    expect(ledger.getArtifactHead("/Projects/Legal/memo.md")!.operation_id).toBe(
      created.event.operation_id,
    );
    expect(ledger.getWorkspaceHead()!.tree_root_hash).toBe(wsHash);
    expect(ledger.getWorkspaceHead()!.operation_id).toBe(
      created.event.operation_id,
    );
  });

  it("successful replace advances artifact head and workspace tree root", () => {
    const ledger = new FakeRuntimeLedger();
    const base = revisionFromUtf8("v1");
    ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/doc.md",
      revision: base,
    });
    const hash1 = ledger.getWorkspaceHead()!.tree_root_hash;

    const next = revisionFromUtf8("v2");
    const r = ledger.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/doc.md",
      revision: next,
      expectedRevision: base,
      vaultWriteMode: "replace_if_match",
    });
    expect(r.event.kind).toBe("file_replace");
    expect(r.event.result.status).toBe("committed");
    expect(ledger.getArtifactHead("/doc.md")!.revision.token).toBe(next.token);
    expect(ledger.getWorkspaceHead()!.tree_root_hash).not.toBe(hash1);
    expect(ledger.getWorkspaceHead()!.operation_id).toBe(r.event.operation_id);
  });

  it("workspace tree root changes on create, replace, rename, and delete", () => {
    const ledger = new FakeRuntimeLedger();
    const roots: string[] = [];

    const a1 = revisionFromUtf8("a1");
    ledger.commit({
      kind: "file_create",
      actor: AGENT,
      path: "/Projects/A/one.md",
      revision: a1,
    });
    roots.push(ledger.getWorkspaceHead()!.tree_root_hash);
    expect(ledger.getWorkspaceHead()!.entry_count).toBe(1);

    const b1 = revisionFromUtf8("b1");
    ledger.commit({
      kind: "file_create",
      actor: AGENT,
      path: "/Projects/A/two.md",
      revision: b1,
    });
    roots.push(ledger.getWorkspaceHead()!.tree_root_hash);
    expect(ledger.getWorkspaceHead()!.entry_count).toBe(2);

    const a2 = revisionFromUtf8("a2");
    ledger.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/Projects/A/one.md",
      revision: a2,
      expectedRevision: a1,
    });
    roots.push(ledger.getWorkspaceHead()!.tree_root_hash);

    ledger.commit({
      kind: "file_rename",
      actor: HUMAN,
      path: "/Projects/A/one-renamed.md",
      sourcePath: "/Projects/A/one.md",
    });
    roots.push(ledger.getWorkspaceHead()!.tree_root_hash);
    expect(ledger.getArtifactHead("/Projects/A/one.md")).toBeUndefined();
    expect(ledger.getArtifactHead("/Projects/A/one-renamed.md")).toBeDefined();
    expect(
      ledger.getArtifactHead("/Projects/A/one-renamed.md")!.revision.token,
    ).toBe(a2.token);
    expect(ledger.getWorkspaceHead()!.entry_count).toBe(2);

    ledger.commit({
      kind: "file_delete",
      actor: HUMAN,
      path: "/Projects/A/two.md",
    });
    roots.push(ledger.getWorkspaceHead()!.tree_root_hash);
    expect(ledger.getArtifactHead("/Projects/A/two.md")).toBeUndefined();
    expect(ledger.getWorkspaceHead()!.entry_count).toBe(1);

    // Every structural mutation must change the tree fingerprint.
    const unique = new Set(roots);
    expect(unique.size).toBe(roots.length);
  });

  it("checkpoint advances checkpoint path head without touching source path head", () => {
    const ledger = new FakeRuntimeLedger();
    const canonical = revisionFromUtf8("canonical-bytes");
    ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/Projects/Acme/proposal.docx",
      revision: canonical,
    });
    const srcHead = ledger.getArtifactHead("/Projects/Acme/proposal.docx")!;
    const wsBefore = ledger.getWorkspaceHead()!.tree_root_hash;

    const cpRev = revisionFromUtf8("checkpoint-bytes");
    const r = ledger.commit({
      kind: "file_checkpoint",
      actor: AGENT,
      path: "/.lanyard/checkpoints/proposal.docx.cp1",
      sourcePath: "/Projects/Acme/proposal.docx",
      revision: cpRev,
      vaultWriteMode: "write_checkpoint",
    });
    expect(r.event.kind).toBe("file_checkpoint");
    expect(r.event.result.write_kind).toBe("checkpoint");
    expect(
      ledger.getArtifactHead("/.lanyard/checkpoints/proposal.docx.cp1")!
        .head_kind,
    ).toBe("checkpoint");
    expect(
      ledger.getArtifactHead("/.lanyard/checkpoints/proposal.docx.cp1")!
        .source_path,
    ).toBe("/Projects/Acme/proposal.docx");
    // Source canonical head unchanged.
    expect(
      ledger.getArtifactHead("/Projects/Acme/proposal.docx")!.revision.token,
    ).toBe(srcHead.revision.token);
    expect(
      ledger.getArtifactHead("/Projects/Acme/proposal.docx")!.operation_id,
    ).toBe(srcHead.operation_id);
    // Workspace advances (checkpoint path is in the tree fingerprint).
    expect(ledger.getWorkspaceHead()!.tree_root_hash).not.toBe(wsBefore);
  });

  it("appendEvent materializes heads from contract fixtures", () => {
    const ledger = new FakeRuntimeLedger();
    // Seed a synthetic prior head so the human-write replace has a parent
    // path identity, then apply fixtures that advance heads.
    const tree = loadEvent("signed-operation.workspace-tree-advance.json");
    const human = loadEvent("signed-operation.human-write.json");
    const conflict = loadEvent("signed-operation.conflict.json");

    // Workspace-tree-advance fixture is a file_create — apply first.
    const a1 = ledger.appendEvent(tree);
    expect(a1.event.kind).toBe("file_create");
    expect(ledger.getArtifactHead(tree.target.path)?.operation_id).toBe(
      tree.operation_id,
    );
    const hashAfterCreate = ledger.getWorkspaceHead()!.tree_root_hash;

    // Human write targets a different path — will create a new head via
    // advances flags even though kind is file_replace (fixture assumes prior).
    // For materialization, file_replace with advances will set head at path.
    // Our applyHeadAdvances for file_replace sets the head from result.revision.
    // But decideOutcome is not used — appendEvent uses applyHeadAdvances which
    // handles file_replace. Good.
    // However human-write may fail tenant check if we locked — we didn't.
    // Different tenant is fine for empty ledger adoption on first event only.
    // First event was tree with ten_example — second must match.
    expect(human.tenant_id).toBe(tree.tenant_id);
    const a2 = ledger.appendEvent(human);
    expect(a2.event.kind).toBe("file_replace");
    expect(ledger.getArtifactHead(human.target.path)?.revision.token).toBe(
      human.result.revision!.token,
    );
    expect(ledger.getWorkspaceHead()!.tree_root_hash).not.toBe(hashAfterCreate);
    const hashAfterHuman = ledger.getWorkspaceHead()!.tree_root_hash;
    const humanOp = ledger.getArtifactHead(human.target.path)!.operation_id;

    const a3 = ledger.appendEvent(conflict);
    expect(a3.event.kind).toBe("operation_rejected");
    // Heads must not move on conflict fixture.
    expect(ledger.getArtifactHead(human.target.path)!.operation_id).toBe(
      humanOp,
    );
    expect(ledger.getWorkspaceHead()!.tree_root_hash).toBe(hashAfterHuman);
    expect(ledger.listEvents()).toHaveLength(3);
  });
});

describe("FakeBackendRuntimeService ledger harness (lp-ye4.6)", () => {
  it("exposes ledger storage and commit helpers on the fake service", () => {
    const service = new FakeBackendRuntimeService({
      ledger: { tenantId: "ten_svc", instanceId: "inst_svc" },
    });

    expect(service.listLedgerEvents()).toEqual([]);
    expect(service.getWorkspaceHead()).toBeUndefined();

    const rev = revisionFromUtf8("svc-body");
    const r = service.commitLedgerMutation({
      kind: "file_create",
      actor: HUMAN,
      path: "/svc/file.md",
      revision: rev,
      idempotencyKey: "svc-create-1",
    });
    expect(r.event.tenant_id).toBe("ten_svc");
    expect(service.listLedgerEvents()).toHaveLength(1);
    expect(service.getArtifactHead("/svc/file.md")!.revision.token).toBe(
      rev.token,
    );
    expect(service.getWorkspaceHead()!.entry_count).toBe(1);

    // Replay via service surface.
    const replay = service.commitLedgerMutation({
      kind: "file_create",
      actor: HUMAN,
      path: "/svc/file.md",
      revision: rev,
      idempotencyKey: "svc-create-1",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(service.listLedgerEvents()).toHaveLength(1);

    // CAS conflict via service.
    const bad = service.commitLedgerMutation({
      kind: "file_replace",
      actor: HUMAN,
      path: "/svc/file.md",
      revision: revisionFromUtf8("nope"),
      expectedRevision: revisionFromUtf8("wrong-base"),
    });
    expect(bad.event.kind).toBe("operation_rejected");
    expect(service.getArtifactHead("/svc/file.md")!.revision.token).toBe(
      rev.token,
    );
    expect(service.listLedgerEvents()).toHaveLength(2);
  });

  it("appendLedgerEvent accepts contract conflict fixture without advancing heads", () => {
    const service = new FakeBackendRuntimeService();
    const tree = loadEvent("signed-operation.workspace-tree-advance.json");
    const conflict = loadEvent("signed-operation.conflict.json");
    // Align conflict parents path context: seed a head at conflict target first
    // using a create with matching tenant by appending tree then a local create.
    service.appendLedgerEvent(tree);
    // Force a head at conflict path with matching tenant by commit (same tenant
    // was adopted from fixture).
    const serviceLedgerTenant = service.listLedgerEvents()[0]!.tenant_id;
    // commit uses service.ledger tenant which was adopted — good.
    // Create head at conflict path:
    const seedRev = {
      token: conflict.result.actual_revision!.token,
      kind: conflict.result.actual_revision!.kind as "content_hash",
      size_bytes: conflict.result.actual_revision!.size_bytes,
    };
    // Direct seed so operation_id stays independent of the conflict fixture.
    service.ledger.seedArtifactHead({
      path: conflict.target.path,
      revision: seedRev,
      operationId: "op_01PRIORHUMAN0001",
      recomputeWorkspace: true,
    });
    const headBefore = service.getArtifactHead(conflict.target.path)!;
    const wsBefore = service.getWorkspaceHead()!.tree_root_hash;

    service.appendLedgerEvent(conflict);
    expect(service.listLedgerEvents().map((e) => e.kind)).toContain(
      "operation_rejected",
    );
    expect(service.getArtifactHead(conflict.target.path)!.operation_id).toBe(
      headBefore.operation_id,
    );
    expect(service.getWorkspaceHead()!.tree_root_hash).toBe(wsBefore);
    expect(serviceLedgerTenant).toBe("ten_example");
  });
});
