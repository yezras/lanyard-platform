import { describe, expect, it } from "vitest";

import type { SettingsSnapshot } from "../../api/types.js";

import {
  formatWorkflowCreatePendingMessage,
  formatWorkflowCreateSucceededMessage,
  interpretWorkflowAuthoringToolEvent,
  upsertWorkflowInSnapshot,
  workflowInventoryIncludesName,
} from "./workflowWizardLive.js";

const baseSnap = (): SettingsSnapshot => ({
  exported_at: new Date().toISOString(),
  skills: [],
  crons: [],
  mcp_servers: [],
  models: [],
  integrations: [],
  workflows: [],
});

describe("interpretWorkflowAuthoringToolEvent", () => {
  it("confirms bare workflow action=create success with definition payload", () => {
    const outcome = interpretWorkflowAuthoringToolEvent({
      type: "tool_progress",
      tool_name: "workflow",
      tool_status: "complete",
      metadata: {
        portal_event: "tool_progress",
        action: "create",
        result: JSON.stringify({
          action: "create",
          success: true,
          definition: {
            ok: true,
            name: "research-report",
            path: ".lanyard/workflows/research-report.json",
            created: true,
          },
        }),
      },
    });
    expect(outcome).toEqual({
      kind: "success",
      action: "create",
      name: "research-report",
      path: ".lanyard/workflows/research-report.json",
    });
  });

  it("reports error when success is false", () => {
    const outcome = interpretWorkflowAuthoringToolEvent({
      type: "tool_progress",
      tool_name: "workflow",
      tool_status: "complete",
      metadata: {
        portal_event: "tool_progress",
        action: "create",
        result: JSON.stringify({
          action: "create",
          success: false,
          error: "already exists",
        }),
      },
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.error).toMatch(/already exists/);
  });

  it("ignores launch/list/status on bare workflow", () => {
    for (const action of ["launch", "list", "status", "pause", "resume", "stop"]) {
      expect(
        interpretWorkflowAuthoringToolEvent({
          type: "tool_progress",
          tool_name: "workflow",
          tool_status: "complete",
          metadata: { action, portal_event: "tool_progress" },
        }).kind,
      ).toBe("ignore");
    }
  });

  it("ignores mid-run authoring events", () => {
    expect(
      interpretWorkflowAuthoringToolEvent({
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "running",
        metadata: { action: "create", portal_event: "tool_progress" },
      }).kind,
    ).toBe("ignore");
  });

  it("accepts create_workflow alias names", () => {
    const outcome = interpretWorkflowAuthoringToolEvent({
      type: "tool_progress",
      tool_name: "create_workflow",
      tool_status: "complete",
      result: JSON.stringify({
        success: true,
        name: "daily-brief",
        path: ".lanyard/workflows/daily-brief.json",
      }),
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") return;
    expect(outcome.name).toBe("daily-brief");
  });
});

describe("workflow inventory helpers", () => {
  it("upserts and detects name in snapshot", () => {
    let snap = baseSnap();
    expect(workflowInventoryIncludesName(snap, "research-report")).toBe(false);
    snap = upsertWorkflowInSnapshot(snap, {
      name: "research-report",
      path: ".lanyard/workflows/research-report.json",
    })!;
    expect(workflowInventoryIncludesName(snap, "research-report")).toBe(true);
    expect(snap.workflows?.[0]?.path).toBe(
      ".lanyard/workflows/research-report.json",
    );
  });

  it("formats honest success/pending messages without premature inventory claim", () => {
    expect(formatWorkflowCreatePendingMessage({ name: "daily-brief" })).toMatch(
      /I'll confirm when the host saves/i,
    );
    expect(
      formatWorkflowCreateSucceededMessage({
        name: "daily-brief",
        inventoryConfirmed: true,
      }),
    ).toMatch(/Tools → Workflows/);
    expect(
      formatWorkflowCreateSucceededMessage({
        name: "daily-brief",
        inventoryConfirmed: true,
      }),
    ).toMatch(/\$ daily-brief/);
  });
});
