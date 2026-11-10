import { describe, expect, it } from "vitest";

import {
  AGENT_WRITE_UX_COPY,
  buildAgentCheckpointPath,
  formatCheckpointSuccessMessage,
  isAgentCheckpointPath,
  isBlockingDirtyOwnership,
  resolveAgentWritePolicy,
  type ActivePathOwnership,
} from "./agent-write-policy.js";

const dirtyOwnership: ActivePathOwnership = {
  path: "/Projects/Acme/proposal.docx",
  tenant_id: "ten_1",
  dirty: true,
  mode: "edit",
  session_id: "oo_sess_1",
  base_revision_token: "sha256:aaa",
  user_id: "usr_1",
};

const viewOwnership: ActivePathOwnership = {
  path: "/Projects/Acme/proposal.docx",
  tenant_id: "ten_1",
  dirty: false,
  mode: "view",
  session_id: "oo_sess_view",
};

describe("buildAgentCheckpointPath", () => {
  it("places checkpoint under .lanyard/checkpoints with run file + extension", () => {
    expect(buildAgentCheckpointPath("/Projects/Acme/proposal.docx", "run1")).toBe(
      "/Projects/Acme/.lanyard/checkpoints/proposal.docx/run1.docx",
    );
  });

  it("normalizes paths without leading slash", () => {
    expect(buildAgentCheckpointPath("Projects/Acme/memo.md", "t1")).toBe(
      "/Projects/Acme/.lanyard/checkpoints/memo.md/t1.md",
    );
  });

  it("handles basename without extension", () => {
    expect(buildAgentCheckpointPath("/Notes/README", "r2")).toBe(
      "/Notes/.lanyard/checkpoints/README/r2",
    );
  });

  it("rejects invalid run_id", () => {
    expect(() =>
      buildAgentCheckpointPath("/Projects/Acme/a.docx", "bad/id"),
    ).toThrow(/run_id/);
  });

  it("rejects path traversal", () => {
    expect(() =>
      buildAgentCheckpointPath("/Projects/../etc/passwd", "r1"),
    ).toThrow();
  });
});

describe("isAgentCheckpointPath", () => {
  it("detects checkpoint layout", () => {
    expect(
      isAgentCheckpointPath(
        "/Projects/Acme/.lanyard/checkpoints/proposal.docx/run1.docx",
      ),
    ).toBe(true);
    expect(isAgentCheckpointPath("/Projects/Acme/proposal.docx")).toBe(false);
  });
});

describe("isBlockingDirtyOwnership", () => {
  it("blocks only dirty edit sessions", () => {
    expect(isBlockingDirtyOwnership(dirtyOwnership)).toBe(true);
    expect(isBlockingDirtyOwnership(viewOwnership)).toBe(false);
    expect(isBlockingDirtyOwnership(null)).toBe(false);
    expect(
      isBlockingDirtyOwnership({
        ...dirtyOwnership,
        dirty: false,
        mode: "edit",
      }),
    ).toBe(false);
  });
});

describe("resolveAgentWritePolicy", () => {
  it("defaults to write_checkpoint when dirty", () => {
    const d = resolveAgentWritePolicy(dirtyOwnership, {
      intended_path: "/Projects/Acme/proposal.docx",
      run_id: "run42",
    });
    expect(d.action).toBe("write_checkpoint");
    if (d.action === "write_checkpoint") {
      expect(d.mode).toBe("write_checkpoint");
      expect(d.source_path).toBe("/Projects/Acme/proposal.docx");
      expect(d.path).toBe(
        "/Projects/Acme/.lanyard/checkpoints/proposal.docx/run42.docx",
      );
      expect(d.write_kind).toBe("checkpoint");
      expect(d.message).toBe(
        AGENT_WRITE_UX_COPY.toolCheckpointInsteadOfCanonical,
      );
      expect(d.ownership_session_id).toBe("oo_sess_1");
    }
  });

  it("refuses when on_dirty=refuse", () => {
    const d = resolveAgentWritePolicy(dirtyOwnership, {
      intended_path: "/Projects/Acme/proposal.docx",
      on_dirty: "refuse",
    });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") {
      expect(d.error_code).toBe("human_edit_active");
      expect(d.conflict_details.reason).toBe("human_edit_active");
      expect(d.conflict_details.path).toBe("/Projects/Acme/proposal.docx");
      expect(d.conflict_details.session_id).toBe("oo_sess_1");
      expect(d.message).toBe(AGENT_WRITE_UX_COPY.toolRefuseHumanEditActive);
    }
  });

  it("refuses dirty checkpoint path when run_id missing", () => {
    const d = resolveAgentWritePolicy(dirtyOwnership, {
      intended_path: "/Projects/Acme/proposal.docx",
      on_dirty: "checkpoint",
    });
    expect(d.action).toBe("refuse");
  });

  it("allows replace_if_match when no ownership", () => {
    const d = resolveAgentWritePolicy(null, {
      intended_path: "/Projects/Acme/proposal.docx",
      path_exists: true,
    });
    expect(d).toEqual({
      action: "allow_canonical",
      mode: "replace_if_match",
      path: "/Projects/Acme/proposal.docx",
      write_kind: "replace",
    });
  });

  it("allows create_new when path missing and not dirty", () => {
    const d = resolveAgentWritePolicy(viewOwnership, {
      intended_path: "/Projects/Acme/new.docx",
      path_exists: false,
    });
    expect(d).toEqual({
      action: "allow_canonical",
      mode: "create_new",
      path: "/Projects/Acme/new.docx",
      write_kind: "create",
    });
  });

  it("does not block view-only ownership", () => {
    const d = resolveAgentWritePolicy(viewOwnership, {
      intended_path: "/Projects/Acme/proposal.docx",
      path_exists: true,
    });
    expect(d.action).toBe("allow_canonical");
  });
});

describe("formatCheckpointSuccessMessage", () => {
  it("injects checkpoint path", () => {
    expect(formatCheckpointSuccessMessage("/x/.lanyard/checkpoints/a/r1")).toContain(
      "/x/.lanyard/checkpoints/a/r1",
    );
  });
});
