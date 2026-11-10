/**
 * lp-ye4.11 — currentness, stale head, checkpoint offer, thread≠vault authority.
 */
import { describe, expect, it } from "vitest";

import {
  currentnessFromArtifactHead,
  evaluateStaleHead,
  filterHistoryEventsByAcl,
  formatCurrentnessActor,
  formatHistoryEventSummary,
  threadAccessGrantsVaultWrite,
  vaultAuthorityFromThreadAccess,
  type ArtifactHeadView,
  type HistoryEventView,
} from "./currentness.js";

const CANONICAL_HEAD: ArtifactHeadView = {
  record_type: "artifact_head",
  path: "/Projects/Legal/memo.md",
  operation_id: "op_01HUMANWRITE0001",
  revision: {
    token: "sha256:rev-v2",
    kind: "content_hash",
    sizeBytes: 48,
  },
  updated_at: "2026-07-12T00:00:02.000Z",
  head_kind: "canonical",
  actor: {
    kind: "human",
    subject_id: "usr_example",
    portal_user_id: "usr_example",
    display_name: "Ada",
  },
};

const CHECKPOINT_HEAD: ArtifactHeadView = {
  record_type: "artifact_head",
  path: "/Projects/Acme/.lanyard/checkpoints/proposal.docx/run-42.docx",
  operation_id: "op_01AGENTCHKPT0001",
  revision: {
    token: "sha256:chkpt",
    kind: "content_hash",
  },
  head_kind: "checkpoint",
  source_path: "/Projects/Acme/proposal.docx",
  actor: {
    kind: "agent",
    subject_id: "agent:main",
    agent_id: "agent:main",
    display_name: "Main agent",
  },
};

describe("currentnessFromArtifactHead (lp-ye4.11)", () => {
  it("shows revision, operation id, actor, and canonical status", () => {
    const view = currentnessFromArtifactHead(CANONICAL_HEAD);
    expect(view.revisionToken).toBe("sha256:rev-v2");
    expect(view.operationId).toBe("op_01HUMANWRITE0001");
    expect(view.actorLabel).toBe("Ada");
    expect(view.headKind).toBe("canonical");
    expect(view.headKindLabel).toBe("Canonical");
    expect(view.isCheckpoint).toBe(false);
  });

  it("labels checkpoint heads without treating payload as bytes", () => {
    const view = currentnessFromArtifactHead(CHECKPOINT_HEAD);
    expect(view.headKind).toBe("checkpoint");
    expect(view.headKindLabel).toBe("Checkpoint");
    expect(view.isCheckpoint).toBe(true);
    expect(view.sourcePath).toBe("/Projects/Acme/proposal.docx");
    expect(view.actorLabel).toBe("Main agent");
  });
});

describe("evaluateStaleHead", () => {
  it("returns none when known revision matches head", () => {
    const decision = evaluateStaleHead({
      openPath: CANONICAL_HEAD.path,
      knownRevision: { token: "sha256:rev-v2", kind: "content_hash" },
      dirty: false,
      head: CANONICAL_HEAD,
    });
    expect(decision.action).toBe("none");
    expect(decision.currentness.operationId).toBe("op_01HUMANWRITE0001");
  });

  it("stale head + clean → reload", () => {
    const decision = evaluateStaleHead({
      openPath: CANONICAL_HEAD.path,
      knownRevision: { token: "sha256:rev-v1", kind: "content_hash" },
      dirty: false,
      head: CANONICAL_HEAD,
    });
    expect(decision.action).toBe("reload");
  });

  it("stale head + dirty → conflict with reload actions", () => {
    const decision = evaluateStaleHead({
      openPath: CANONICAL_HEAD.path,
      knownRevision: { token: "sha256:rev-v1", kind: "content_hash" },
      dirty: true,
      head: CANONICAL_HEAD,
    });
    expect(decision.action).toBe("conflict");
    if (decision.action !== "conflict") return;
    expect(decision.conflict.reason).toBe("superseded_base");
    expect(decision.conflict.offeredActions).toContain("reload");
    expect(decision.conflict.offeredActions).toContain("discard_local");
  });

  it("checkpoint offer when related checkpoint head is present", () => {
    const decision = evaluateStaleHead({
      openPath: "/Projects/Acme/proposal.docx",
      knownRevision: { token: "sha256:base", kind: "content_hash" },
      dirty: false,
      head: {
        ...CANONICAL_HEAD,
        path: "/Projects/Acme/proposal.docx",
        revision: { token: "sha256:base", kind: "content_hash" },
      },
      checkpointHead: CHECKPOINT_HEAD,
    });
    expect(decision.action).toBe("checkpoint_offer");
    if (decision.action !== "checkpoint_offer") return;
    expect(decision.checkpointOffer.ref.path).toBe(CHECKPOINT_HEAD.path);
    expect(decision.checkpointOffer.ref.source).toBe("agent_checkpoint");
    expect(decision.checkpointOffer.message).toMatch(/checkpoint/i);
  });
});

describe("thread collab ≠ vault write authority", () => {
  it("collaborate mode never grants vault write", () => {
    expect(threadAccessGrantsVaultWrite("collaborate")).toBe(false);
    expect(threadAccessGrantsVaultWrite("read")).toBe(false);
    expect(threadAccessGrantsVaultWrite("owner")).toBe(false);
    const collab = vaultAuthorityFromThreadAccess("collaborate");
    expect(collab.canVaultWrite).toBe(false);
    expect(collab.expandsVaultAcl).toBe(false);
    expect(collab.canPostToThread).toBe(true);
    expect(collab.reason).toMatch(/separate from vault write/i);
  });
});

describe("history ACL filter + summary", () => {
  const events: HistoryEventView[] = [
    {
      operation_id: "op_a",
      kind: "file_replace",
      actor: { kind: "human", subject_id: "u1", display_name: "Ada" },
      target: { path: "/Projects/Legal/memo.md" },
      result: { status: "committed", reason: "ok" },
    },
    {
      operation_id: "op_secret",
      kind: "file_create",
      target: { path: "/Secrets/note.md" },
      result: { status: "committed", reason: "ok" },
    },
  ];

  it("filters events outside path prefixes (denied path)", () => {
    const filtered = filterHistoryEventsByAcl(events, ["/Projects/Legal"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.operation_id).toBe("op_a");
  });

  it("formats history summary without body bytes", () => {
    expect(formatHistoryEventSummary(events[0]!)).toBe(
      "file_replace · Ada · committed",
    );
  });

  it("formats actor fallbacks", () => {
    expect(
      formatCurrentnessActor({ kind: "agent", subject_id: "a1", agent_id: "agent:x" }),
    ).toBe("agent:x");
    expect(formatCurrentnessActor(undefined)).toBe("Unknown actor");
  });
});
