import { describe, expect, it, beforeEach } from "vitest";

import {
  MemoryOfficeDocumentSessionStore,
  resolveAgentWritePolicyForPath,
} from "../src/office/index.js";
import type { CreateOfficeDocumentSessionInput } from "../src/office/types.js";

function editInput(
  overrides: Partial<CreateOfficeDocumentSessionInput> = {},
): CreateOfficeDocumentSessionInput {
  return {
    tenant_id: "ten_1",
    user_id: "usr_1",
    path: "/Projects/Acme/proposal.docx",
    revision: { token: "sha256:base1", kind: "content_hash", size_bytes: 10 },
    mode: "edit",
    file_type: "docx",
    document_key: "a".repeat(64),
    ...overrides,
  };
}

describe("office agent write policy (lp-5q6.32)", () => {
  let store: MemoryOfficeDocumentSessionStore;

  beforeEach(() => {
    store = new MemoryOfficeDocumentSessionStore();
  });

  it("findActiveOwnership returns dirty edit for open edit session", async () => {
    const { session } = await store.create(editInput());
    expect(session.dirty).toBe(true);

    const ownership = await store.findActiveOwnership({
      tenant_id: "ten_1",
      path: "/Projects/Acme/proposal.docx",
    });
    expect(ownership).not.toBeNull();
    expect(ownership!.dirty).toBe(true);
    expect(ownership!.mode).toBe("edit");
    expect(ownership!.session_id).toBe(session.session_id);
  });

  it("findActiveOwnership ignores closed sessions", async () => {
    const { session } = await store.create(editInput());
    await store.close(session.session_id);
    const ownership = await store.findActiveOwnership({
      tenant_id: "ten_1",
      path: "/Projects/Acme/proposal.docx",
    });
    expect(ownership).toBeNull();
  });

  it("findActiveOwnership is tenant-scoped", async () => {
    await store.create(editInput());
    const ownership = await store.findActiveOwnership({
      tenant_id: "other_tenant",
      path: "/Projects/Acme/proposal.docx",
    });
    expect(ownership).toBeNull();
  });

  it("resolveAgentWritePolicyForPath checkpoints when dirty", async () => {
    await store.create(editInput());
    const { decision, ownership } = await resolveAgentWritePolicyForPath(store, {
      tenant_id: "ten_1",
      intent: {
        intended_path: "/Projects/Acme/proposal.docx",
        run_id: "agent-run-9",
      },
    });
    expect(ownership?.dirty).toBe(true);
    expect(decision.action).toBe("write_checkpoint");
    if (decision.action === "write_checkpoint") {
      expect(decision.path).toBe(
        "/Projects/Acme/.lanyard/checkpoints/proposal.docx/agent-run-9.docx",
      );
      expect(decision.source_path).toBe("/Projects/Acme/proposal.docx");
    }
  });

  it("resolveAgentWritePolicyForPath allows replace when no session", async () => {
    const { decision } = await resolveAgentWritePolicyForPath(store, {
      tenant_id: "ten_1",
      intent: {
        intended_path: "/Projects/Acme/proposal.docx",
        path_exists: true,
      },
    });
    expect(decision.action).toBe("allow_canonical");
    if (decision.action === "allow_canonical") {
      expect(decision.mode).toBe("replace_if_match");
    }
  });

  it("view-only sessions do not force checkpoint", async () => {
    await store.create(editInput({ mode: "view" }));
    const ownership = await store.findActiveOwnership({
      tenant_id: "ten_1",
      path: "/Projects/Acme/proposal.docx",
    });
    expect(ownership?.dirty).toBe(false);
    expect(ownership?.mode).toBe("view");

    const { decision } = await resolveAgentWritePolicyForPath(store, {
      tenant_id: "ten_1",
      intent: {
        intended_path: "/Projects/Acme/proposal.docx",
        path_exists: true,
      },
    });
    expect(decision.action).toBe("allow_canonical");
  });
});
