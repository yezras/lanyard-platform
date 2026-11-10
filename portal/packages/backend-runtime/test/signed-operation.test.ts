import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_HEAD_RECORD_TYPE,
  SIGNED_OPERATION_RECORD_TYPE,
  SIGNED_OPERATION_SCHEMA_VERSION,
  WORKSPACE_HEAD_RECORD_TYPE,
  isArtifactHead,
  isSignedOperationEvent,
  isWorkspaceHead,
  parseSignedOperationEventOnly,
  parseSignedOperationRecord,
  safeParseSignedOperationRecord,
  vaultWriteModeToOperationKind,
  type DocumentRevision,
  type SignedOperationEvent,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(
  HERE,
  "../../../../contracts/backend-runtime-v1/examples",
);

function loadJson(name: string): unknown {
  const raw = readFileSync(join(EXAMPLES_DIR, name), "utf8");
  return JSON.parse(raw) as unknown;
}

const FIXTURE_FILES = [
  "signed-operation.human-write.json",
  "signed-operation.agent-checkpoint.json",
  "signed-operation.conflict.json",
  "signed-operation.workspace-tree-advance.json",
  "artifact-head.canonical.json",
  "artifact-head.checkpoint.json",
  "workspace-head.default.json",
] as const;

describe("signed-operation domain (lp-ye4.5)", () => {
  describe("fixtures parse as strict domain records", () => {
    for (const name of FIXTURE_FILES) {
      it(`parses ${name}`, () => {
        const raw = loadJson(name);
        const rec = parseSignedOperationRecord(raw);
        expect(rec.schema_version).toBe(SIGNED_OPERATION_SCHEMA_VERSION);
        expect([
          SIGNED_OPERATION_RECORD_TYPE,
          ARTIFACT_HEAD_RECORD_TYPE,
          WORKSPACE_HEAD_RECORD_TYPE,
        ]).toContain(rec.record_type);
      });
    }
  });

  it("human write commits with DocumentRevision and advances heads", () => {
    const event = parseSignedOperationEventOnly(
      loadJson("signed-operation.human-write.json"),
    );
    expect(event.kind).toBe("file_replace");
    expect(event.actor.kind).toBe("human");
    expect(event.vault_write_mode).toBe("replace_if_match");
    expect(event.result.status).toBe("committed");
    expect(event.result.revision).toMatchObject({
      kind: "content_hash",
      token: expect.stringContaining("sha256:"),
    } satisfies Partial<DocumentRevision>);
    expect(event.advances_artifact_head).toBe(true);
    expect(event.advances_workspace_head).toBe(true);
    // operation_id is separate from revision.token
    expect(event.operation_id.startsWith("op_")).toBe(true);
    expect(event.operation_id).not.toBe(event.result.revision?.token);
    expect(event.body_hash?.alg).toBe("sha256");
    expect(event.body_hash?.hex).toMatch(/^[a-f0-9]{64}$/);
    expect(event.signature.alg).toBe("ed25519");
    expect(event.parents.length).toBeGreaterThan(0);
  });

  it("agent checkpoint uses source_path and write_checkpoint mode", () => {
    const event = parseSignedOperationEventOnly(
      loadJson("signed-operation.agent-checkpoint.json"),
    );
    expect(event.kind).toBe("file_checkpoint");
    expect(event.actor.kind).toBe("agent");
    expect(event.vault_write_mode).toBe("write_checkpoint");
    expect(event.target.source_path).toBe("/Projects/Acme/proposal.docx");
    expect(event.target.path).not.toBe(event.target.source_path);
    expect(event.target.path).toContain(".lanyard/checkpoints/");
    expect(event.result.write_kind).toBe("checkpoint");
    expect(event.advances_artifact_head).toBe(true);
  });

  it("conflict reject does not advance heads and keeps CAS tokens", () => {
    const event = parseSignedOperationEventOnly(
      loadJson("signed-operation.conflict.json"),
    );
    expect(event.kind).toBe("operation_rejected");
    expect(event.result.status).toBe("rejected");
    expect(event.result.reason).toBe("revision_mismatch");
    expect(event.advances_artifact_head).toBe(false);
    expect(event.advances_workspace_head).toBe(false);
    expect(event.result.revision).toBeUndefined();
    expect(event.result.prior_revision?.token).toBeTruthy();
    expect(event.result.actual_revision?.token).toBeTruthy();
    expect(event.result.prior_revision?.token).not.toBe(
      event.result.actual_revision?.token,
    );
  });

  it("workspace tree advance is a committed create that advances workspace head", () => {
    const event = parseSignedOperationEventOnly(
      loadJson("signed-operation.workspace-tree-advance.json"),
    );
    expect(event.kind).toBe("file_create");
    expect(event.vault_write_mode).toBe("create_new");
    expect(event.result.created).toBe(true);
    expect(event.advances_workspace_head).toBe(true);
    expect(event.advances_artifact_head).toBe(true);
  });

  it("artifact and workspace heads reference operation_id + DocumentRevision", () => {
    const canonical = parseSignedOperationRecord(
      loadJson("artifact-head.canonical.json"),
    );
    expect(isArtifactHead(canonical)).toBe(true);
    if (isArtifactHead(canonical)) {
      expect(canonical.head_kind).toBe("canonical");
      expect(canonical.operation_id.startsWith("op_")).toBe(true);
      expect(canonical.revision.kind).toBe("content_hash");
      expect(canonical.operation_id).not.toBe(canonical.revision.token);
    }

    const checkpoint = parseSignedOperationRecord(
      loadJson("artifact-head.checkpoint.json"),
    );
    expect(isArtifactHead(checkpoint)).toBe(true);
    if (isArtifactHead(checkpoint)) {
      expect(checkpoint.head_kind).toBe("checkpoint");
      expect(checkpoint.source_path).toBe("/Projects/Acme/proposal.docx");
    }

    const workspace = parseSignedOperationRecord(
      loadJson("workspace-head.default.json"),
    );
    expect(isWorkspaceHead(workspace)).toBe(true);
    if (isWorkspaceHead(workspace)) {
      expect(workspace.workspace_id).toBe("default");
      expect(workspace.tree_root_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(workspace.operation_id.startsWith("op_")).toBe(true);
    }
  });

  it("vaultWriteModeToOperationKind maps all vault.write modes", () => {
    expect(vaultWriteModeToOperationKind("create_new")).toBe("file_create");
    expect(vaultWriteModeToOperationKind("replace_if_match")).toBe(
      "file_replace",
    );
    expect(vaultWriteModeToOperationKind("replace_if_absent")).toBe(
      "file_create",
    );
    expect(
      vaultWriteModeToOperationKind("replace_if_absent", { created: false }),
    ).toBe("file_replace");
    expect(vaultWriteModeToOperationKind("write_checkpoint")).toBe(
      "file_checkpoint",
    );
  });

  describe("reject loose / invalid bags", () => {
    it("rejects missing schema_version", () => {
      const raw = loadJson("signed-operation.human-write.json") as Record<
        string,
        unknown
      >;
      delete raw.schema_version;
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });

    it("rejects unknown top-level property", () => {
      const raw = loadJson("signed-operation.human-write.json") as Record<
        string,
        unknown
      >;
      raw.extra_bag = { anything: true };
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });

    it("rejects operation_id that is not op_-prefixed", () => {
      const raw = loadJson("signed-operation.human-write.json") as Record<
        string,
        unknown
      >;
      raw.operation_id = "not-an-op-id";
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });

    it("rejects rejected event that claims head advance", () => {
      const raw = loadJson("signed-operation.conflict.json") as Record<
        string,
        unknown
      >;
      raw.advances_artifact_head = true;
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });

    it("rejects file_checkpoint without source_path", () => {
      const raw = loadJson(
        "signed-operation.agent-checkpoint.json",
      ) as SignedOperationEvent;
      const clone = structuredClone(raw) as Record<string, unknown>;
      const target = clone.target as Record<string, unknown>;
      delete target.source_path;
      const res = safeParseSignedOperationRecord(clone);
      expect(res.ok).toBe(false);
    });

    it("rejects committed file write without revision", () => {
      const raw = loadJson("signed-operation.human-write.json") as Record<
        string,
        unknown
      >;
      const result = raw.result as Record<string, unknown>;
      delete result.revision;
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });

    it("rejects invalid body_hash hex", () => {
      const raw = loadJson("signed-operation.human-write.json") as Record<
        string,
        unknown
      >;
      raw.body_hash = { alg: "sha256", hex: "not-hex" };
      const res = safeParseSignedOperationRecord(raw);
      expect(res.ok).toBe(false);
    });
  });

  it("type guards discriminate record types", () => {
    const event = parseSignedOperationRecord(
      loadJson("signed-operation.human-write.json"),
    );
    const head = parseSignedOperationRecord(
      loadJson("artifact-head.canonical.json"),
    );
    const ws = parseSignedOperationRecord(
      loadJson("workspace-head.default.json"),
    );
    expect(isSignedOperationEvent(event)).toBe(true);
    expect(isArtifactHead(event)).toBe(false);
    expect(isArtifactHead(head)).toBe(true);
    expect(isWorkspaceHead(ws)).toBe(true);
  });

  it("examples directory includes all four required scenario fixtures", () => {
    const names = readdirSync(EXAMPLES_DIR);
    for (const required of [
      "signed-operation.human-write.json",
      "signed-operation.agent-checkpoint.json",
      "signed-operation.conflict.json",
      "signed-operation.workspace-tree-advance.json",
    ]) {
      expect(names).toContain(required);
    }
  });
});
