import { describe, expect, it } from "vitest";

import { DEFAULT_GUEST_VAULT_ROOT } from "../rbac/path-project.js";
import {
  GUEST_WORKFLOW_RUNS_ROOT,
  isWorkflowRunId,
  workflowRunIdFromVaultPath,
  workflowRunStateVaultPath,
  workflowRunVaultPersistFromChatEvent,
  workflowRunVaultPersistFromStatePath,
} from "./run-vault.js";

describe("workflowRunStateVaultPath", () => {
  it("builds a vault-relative state.json path", () => {
    expect(workflowRunStateVaultPath("wf_03e3fb5b2224a1d2")).toBe(
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
    expect(GUEST_WORKFLOW_RUNS_ROOT).toBe(
      `${DEFAULT_GUEST_VAULT_ROOT}/workflows/runs`,
    );
  });

  it("rejects traversal and empty ids", () => {
    expect(isWorkflowRunId("")).toBe(false);
    expect(workflowRunStateVaultPath("../etc/passwd")).toBeNull();
    expect(workflowRunStateVaultPath("wf_abc/../../x")).toBeNull();
    expect(workflowRunStateVaultPath("wf_ok")).toBe(
      "/workflows/runs/wf_ok/state.json",
    );
  });
});

describe("workflowRunVaultPersistFromChatEvent", () => {
  const now = "2026-08-21T16:50:00.000Z";

  it("maps workflow_progress metadata onto a persist payload", () => {
    const payload = workflowRunVaultPersistFromChatEvent(
      {
        type: "tool_progress",
        tool_name: "workflow",
        tool_kind: "workflow",
        metadata: {
          portal_event: "workflow_progress",
          tool_kind: "workflow",
          workflow_id: "wf_03e3fb5b2224a1d2",
          workflow_name: "research-lite",
          workflow_status: "running",
          stages: [{ id: "plan", name: "Plan", status: "running" }],
        },
      },
      now,
    );
    expect(payload).not.toBeNull();
    expect(payload?.path).toBe(
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
    expect(payload?.document).toMatchObject({
      run_id: "wf_03e3fb5b2224a1d2",
      workflow_name: "research-lite",
      status: "running",
      source: "bff_workflow_event",
      updated_at: now,
    });
    expect(JSON.parse(payload?.body ?? "{}")).toMatchObject({
      run_id: "wf_03e3fb5b2224a1d2",
    });
  });

  it("reads run_id from launch result JSON", () => {
    const payload = workflowRunVaultPersistFromChatEvent(
      {
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "completed",
        result: JSON.stringify({
          action: "launch",
          success: true,
          run: {
            run_id: "wf_b9510be6d84b3db2",
            display_name: "research-lite",
            status: "running",
          },
        }),
        metadata: { portal_event: "workflow_progress", tool_kind: "workflow" },
      },
      now,
    );
    expect(payload?.runId).toBe("wf_b9510be6d84b3db2");
    expect(payload?.document.run).toMatchObject({
      run_id: "wf_b9510be6d84b3db2",
    });
  });

  it("ignores non-workflow events", () => {
    expect(
      workflowRunVaultPersistFromChatEvent(
        {
          type: "tool_progress",
          tool_name: "bash",
          metadata: { portal_event: "tool_progress" },
        },
        now,
      ),
    ).toBeNull();
  });

  it("maps a guest citation path on message_send", () => {
    const payload = workflowRunVaultPersistFromChatEvent(
      {
        type: "message_send",
        citations: [
          {
            path: "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
            title: "state.json",
          },
        ],
      },
      now,
    );
    expect(payload?.runId).toBe("wf_03e3fb5b2224a1d2");
    expect(payload?.path).toBe(
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
  });
});

describe("workflowRunIdFromVaultPath", () => {
  const now = "2026-08-21T16:50:00.000Z";

  it("accepts guest and vault-relative state.json paths", () => {
    expect(
      workflowRunIdFromVaultPath(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("wf_03e3fb5b2224a1d2");
    expect(
      workflowRunIdFromVaultPath(
        "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("wf_03e3fb5b2224a1d2");
    expect(workflowRunIdFromVaultPath("/wf_03e3fb5b2224a1d2/state.json")).toBeNull();
    expect(workflowRunIdFromVaultPath("/AGENTS.md")).toBeNull();
  });

  it("builds a stub persist payload from the path", () => {
    const payload = workflowRunVaultPersistFromStatePath(
      "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      now,
    );
    expect(payload?.path).toBe(
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
    expect(payload?.document).toMatchObject({
      run_id: "wf_03e3fb5b2224a1d2",
      source: "bff_workflow_event",
      updated_at: now,
    });
  });
});
