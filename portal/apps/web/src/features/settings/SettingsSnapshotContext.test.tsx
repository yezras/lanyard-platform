import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSnapshot } from "../../api/types.js";
import {
  activeModelFromSnapshot,
  bareInventoryToolName,
  isCronInventoryReadOnlyAction,
  isWorkflowInventoryReadOnlyAction,
  isInventoryMutatingToolEvent,
  isInventoryMutatingToolName,
  mergeIncomingSettingsSnapshot,
  SettingsSnapshotProvider,
  useSettingsSnapshot,
  WORKFLOW_OPTIMISTIC_STICKY_MS,
} from "./SettingsSnapshotContext.js";

const fetchSettingsSnapshot = vi.fn();

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: (...args: unknown[]) => fetchSettingsSnapshot(...args),
}));

const baseSnapshot: SettingsSnapshot = {
  exported_at: "2026-07-01T08:00:00.000Z",
  hermes_home: null,
  source: "fixture",
  skills: [
    { id: "summarize", name: "summarize", enabled: true },
    { id: "draft", name: "draft", enabled: false },
  ],
  crons: [],
  mcp_servers: [],
  models: [
    { provider: "xai", model: "grok-3", is_active: true, connected: true },
    { provider: "xai", model: "grok-4", is_active: false, connected: true },
  ],
  integrations: [],
};

function Probe() {
  const {
    snapshot,
    setSnapshot,
    refreshSnapshot,
    scheduleInventoryRefresh,
    isLoading,
    loadError,
  } = useSettingsSnapshot();
  const active = activeModelFromSnapshot(snapshot);
  const enabledSkillNames = (snapshot?.skills ?? [])
    .filter((s) => s.enabled !== false)
    .map((s) => s.name)
    .join(",");

  const cronNames = (snapshot?.crons ?? []).map((c) => c.name).join(",");
  const workflowNames = (snapshot?.workflows ?? []).map((w) => w.name).join(",");

  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="error">{loadError ?? ""}</div>
      <div data-testid="active-model">{active ?? ""}</div>
      <div data-testid="skills">{enabledSkillNames}</div>
      <div data-testid="skill-count">{String(snapshot?.skills?.length ?? 0)}</div>
      <div data-testid="cron-names">{cronNames}</div>
      <div data-testid="cron-count">{String(snapshot?.crons?.length ?? 0)}</div>
      <div data-testid="workflow-names">{workflowNames}</div>
      <div data-testid="workflow-count">
        {String(snapshot?.workflows?.length ?? 0)}
      </div>
      <button
        type="button"
        onClick={() => {
          setSnapshot((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              models: prev.models.map((m) => ({
                ...m,
                is_active: m.model === "grok-4",
              })),
              skills: prev.skills.map((s) =>
                s.id === "draft" ? { ...s, enabled: true } : s,
              ),
            };
          });
        }}
      >
        Apply local patch
      </button>
      <button
        type="button"
        onClick={() => {
          setSnapshot((prev) => {
            if (!prev) return prev;
            const now = new Date().toISOString();
            return {
              ...prev,
              workflows: [
                ...(prev.workflows ?? []),
                {
                  id: "khq122-refresh-182327",
                  name: "khq122-refresh-182327",
                  path: ".lanyard/workflows/khq122-refresh-182327.json",
                  enabled: true,
                  updated_at: now,
                },
              ],
            };
          });
        }}
      >
        Optimistic workflow upsert
      </button>
      <button
        type="button"
        onClick={() => {
          void refreshSnapshot().catch(() => undefined);
        }}
      >
        Refetch
      </button>
      <button
        type="button"
        onClick={() => {
          scheduleInventoryRefresh();
        }}
      >
        Schedule inventory refresh
      </button>
    </div>
  );
}

describe("activeModelFromSnapshot", () => {
  it("returns the active model name or undefined", () => {
    expect(activeModelFromSnapshot(baseSnapshot)).toBe("grok-3");
    expect(activeModelFromSnapshot(null)).toBeUndefined();
    expect(
      activeModelFromSnapshot({
        ...baseSnapshot,
        models: baseSnapshot.models.map((m) => ({ ...m, is_active: false })),
      }),
    ).toBeUndefined();
  });
});

describe("isInventoryMutatingToolName / isInventoryMutatingToolEvent", () => {
  it("detects skill/workflow/cron mutators and strips server__ prefix", () => {
    expect(bareInventoryToolName("server__skill_manage")).toBe("skill_manage");
    expect(isInventoryMutatingToolName("skill_manage")).toBe(true);
    expect(isInventoryMutatingToolName("create_skill")).toBe(true);
    expect(isInventoryMutatingToolName("create_workflow")).toBe(true);
    expect(isInventoryMutatingToolName("workflow_save")).toBe(true);
    // LA product tool name (lp-khq.12.2) — bare `workflow` + action filter
    expect(isInventoryMutatingToolName("workflow")).toBe(true);
    expect(isInventoryMutatingToolName("server__workflow")).toBe(true);
    expect(isInventoryMutatingToolName("cron_create")).toBe(true);
    expect(isInventoryMutatingToolName("cron.create")).toBe(true);
    expect(isInventoryMutatingToolName("scheduled_task.create")).toBe(true);
    expect(isInventoryMutatingToolName("schedule_job")).toBe(true);
    // Hermes / LA primary create path (lp-uxy.4)
    expect(isInventoryMutatingToolName("cronjob")).toBe(true);
    expect(isInventoryMutatingToolName("cron_job")).toBe(true);
    expect(isInventoryMutatingToolName("server__cronjob")).toBe(true);
    expect(isInventoryMutatingToolName("mcp__tools__skill_manage")).toBe(true);
    // lp-su0: LA product tool name
    expect(isInventoryMutatingToolName("cronjob")).toBe(true);
    expect(isInventoryMutatingToolName("cron_job")).toBe(true);
    expect(isInventoryMutatingToolName("start_job")).toBe(true);
    expect(isInventoryMutatingToolName("run_job")).toBe(true);

    // Non-mutators
    expect(isInventoryMutatingToolName("skill_view")).toBe(false);
    expect(isInventoryMutatingToolName("skills_list")).toBe(false);
    expect(isInventoryMutatingToolName("list_cron")).toBe(false);
    expect(isInventoryMutatingToolName("read_file")).toBe(false);
    expect(isInventoryMutatingToolName("workflow_progress")).toBe(false);
    expect(isInventoryMutatingToolName("bash")).toBe(false);
    // Over-broad soft match residuals (review lp-uxy.4 / w3-retry)
    expect(isInventoryMutatingToolName("job_status")).toBe(false);
    expect(isInventoryMutatingToolName("job_list")).toBe(false);
    expect(isInventoryMutatingToolName("list_jobs")).toBe(false);
    expect(isInventoryMutatingToolName("cron_status")).toBe(false);
    expect(isInventoryMutatingToolName("job_progress")).toBe(false);
    expect(isInventoryMutatingToolName("start_job")).toBe(true);
    expect(isInventoryMutatingToolName("cron_run")).toBe(true);
  });

  it("requires tool completion (or inventory_mutated flag)", () => {
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "skill_manage",
        tool_status: "running",
      }),
    ).toBe(false);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "skill_manage",
        tool_status: "complete",
      }),
    ).toBe(true);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "create_workflow",
        tool_status: "success",
      }),
    ).toBe(true);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: { action: "create" },
      }),
    ).toBe(true);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: { action: "list" },
      }),
    ).toBe(false);

    expect(isCronInventoryReadOnlyAction({ action: "list" })).toBe(true);
    expect(isCronInventoryReadOnlyAction({ action: "create" })).toBe(false);

    // Bare workflow: create/save refresh inventory; launch/list do not (lp-khq.12.2).
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "complete",
        metadata: { action: "create" },
      }),
    ).toBe(true);
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "complete",
        metadata: { action: "save" },
      }),
    ).toBe(true);
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "complete",
        metadata: { action: "launch" },
      }),
    ).toBe(false);
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "workflow",
        tool_status: "complete",
        metadata: { action: "list" },
      }),
    ).toBe(false);
    expect(isWorkflowInventoryReadOnlyAction({ action: "launch" })).toBe(true);
    expect(isWorkflowInventoryReadOnlyAction({ action: "create" })).toBe(false);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "read_file",
        tool_status: "complete",
        metadata: { inventory_mutated: true },
      }),
    ).toBe(true);

    expect(
      isInventoryMutatingToolEvent({
        type: "message_send",
        tool_name: "skill_manage",
        tool_status: "complete",
      }),
    ).toBe(false);

    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "skills_list",
        tool_status: "complete",
      }),
    ).toBe(false);
  });
});

describe("SettingsSnapshotProvider", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(baseSnapshot);
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("auto-loads snapshot and exposes active model + skills", async () => {
    render(
      <SettingsSnapshotProvider>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("active-model").textContent).toBe("grok-3");
    expect(screen.getByTestId("skills").textContent).toBe("summarize");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("notifies consumers when setSnapshot applies a local settings patch", async () => {
    render(
      <SettingsSnapshotProvider>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-model").textContent).toBe("grok-3");
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply local patch" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-model").textContent).toBe("grok-4");
    });
    expect(screen.getByTestId("skills").textContent).toBe("summarize,draft");
    // Local patch must not trigger another network fetch.
    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);
  });

  it("refreshSnapshot re-fetches and publishes the new snapshot", async () => {
    fetchSettingsSnapshot
      .mockResolvedValueOnce(baseSnapshot)
      .mockResolvedValueOnce({
        ...baseSnapshot,
        models: baseSnapshot.models.map((m) => ({
          ...m,
          is_active: m.model === "grok-4",
        })),
        skills: [
          { id: "summarize", name: "summarize", enabled: false },
          { id: "draft", name: "draft", enabled: true },
        ],
      });

    render(
      <SettingsSnapshotProvider>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-model").textContent).toBe("grok-3");
    });

    fireEvent.click(screen.getByRole("button", { name: "Refetch" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-model").textContent).toBe("grok-4");
    });
    expect(screen.getByTestId("skills").textContent).toBe("draft");
    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);
  });

  it("records loadError when auto-load fails", async () => {
    fetchSettingsSnapshot.mockRejectedValueOnce(new Error("Unauthorized"));

    render(
      <SettingsSnapshotProvider>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("error").textContent).toBe("Unauthorized");
    expect(screen.getByTestId("active-model").textContent).toBe("");
  });

  it("skips auto-load when autoLoad is false", async () => {
    render(
      <SettingsSnapshotProvider autoLoad={false}>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(fetchSettingsSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-model").textContent).toBe("");
  });

  it("scheduleInventoryRefresh debounces rapid calls into one fetch", async () => {
    vi.useFakeTimers();
    fetchSettingsSnapshot.mockResolvedValue(baseSnapshot);

    render(
      <SettingsSnapshotProvider
        autoLoad={false}
        inventoryRefreshDebounceMs={400}
      >
        <Probe />
      </SettingsSnapshotProvider>,
    );

    expect(fetchSettingsSnapshot).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );

    expect(fetchSettingsSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(fetchSettingsSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
      // Flush the refreshSnapshot promise resolution.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);

    // A later schedule fires another single fetch after the window.
    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);
  });

  it("scheduleInventoryRefresh publishes the updated inventory snapshot", async () => {
    vi.useFakeTimers();
    fetchSettingsSnapshot.mockResolvedValue({
      ...baseSnapshot,
      skills: [
        ...baseSnapshot.skills,
        { id: "new-skill", name: "new-skill", enabled: true },
      ],
    });

    render(
      <SettingsSnapshotProvider
        autoLoad={false}
        inventoryRefreshDebounceMs={50}
      >
        <Probe />
      </SettingsSnapshotProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("skill-count").textContent).toBe("3");
    expect(screen.getByTestId("skills").textContent).toContain("new-skill");
  });

  it("NL cron create: cronjob tool completion refresh shows new job without reload (lp-uxy.4)", async () => {
    vi.useFakeTimers();
    // Initial auto-load empty crons, then post-create snapshot includes new job.
    fetchSettingsSnapshot
      .mockResolvedValueOnce(baseSnapshot)
      .mockResolvedValueOnce({
        ...baseSnapshot,
        crons: [
          {
            id: "daily-vault-index",
            name: "Daily vault index",
            schedule: "0 3 * * *",
            enabled: true,
            path: "cron/jobs.json",
          },
        ],
      });

    render(
      <SettingsSnapshotProvider inventoryRefreshDebounceMs={50}>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("cron-count").textContent).toBe("0");

    // Simulate ChatView: completed Hermes cronjob create → scheduleInventoryRefresh.
    expect(
      isInventoryMutatingToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: { action: "create" },
      }),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("cron-count").textContent).toBe("1");
    expect(screen.getByTestId("cron-names").textContent).toContain(
      "Daily vault index",
    );
  });

  it("does not clobber optimistic workflow upsert with empty host refresh (lp-khq.13)", async () => {
    vi.useFakeTimers();
    fetchSettingsSnapshot.mockResolvedValue({
      ...baseSnapshot,
      workflows: [],
    });

    render(
      <SettingsSnapshotProvider
        autoLoad={false}
        inventoryRefreshDebounceMs={50}
      >
        <Probe />
      </SettingsSnapshotProvider>,
    );

    // Seed host snapshot (empty workflows), then optimistic create (ChatView path).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("workflow-count").textContent).toBe("0");

    fireEvent.click(
      screen.getByRole("button", { name: "Optimistic workflow upsert" }),
    );
    expect(screen.getByTestId("workflow-count").textContent).toBe("1");
    expect(screen.getByTestId("workflow-names").textContent).toContain(
      "khq122-refresh-182327",
    );

    // Host still empty (discover lag) — must not wipe Tools → Workflows.
    fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("workflow-count").textContent).toBe("1");
    expect(screen.getByTestId("workflow-names").textContent).toContain(
      "khq122-refresh-182327",
    );

    // Debounced inventory refresh after create (tool mutator path) — same guard.
    fireEvent.click(
      screen.getByRole("button", { name: "Schedule inventory refresh" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("workflow-count").textContent).toBe("1");
    expect(screen.getByTestId("workflow-names").textContent).toContain(
      "khq122-refresh-182327",
    );
  });

  it("keeps sticky local workflow when host list is partial (lp-khq.13)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...baseSnapshot,
      workflows: [
        {
          id: "existing-def",
          name: "existing-def",
          path: ".lanyard/workflows/existing-def.json",
          enabled: true,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(
      <SettingsSnapshotProvider autoLoad={false}>
        <Probe />
      </SettingsSnapshotProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("workflow-names").textContent).toBe(
      "existing-def",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Optimistic workflow upsert" }),
    );
    expect(screen.getByTestId("workflow-count").textContent).toBe("2");

    // Host still missing the new def.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("workflow-count").textContent).toBe("2");
    expect(screen.getByTestId("workflow-names").textContent).toContain(
      "khq122-refresh-182327",
    );
    expect(screen.getByTestId("workflow-names").textContent).toContain(
      "existing-def",
    );
  });
});

describe("mergeIncomingSettingsSnapshot (lp-khq.13)", () => {
  const now = Date.parse("2026-08-13T18:30:00.000Z");

  it("preserves recent local-only workflow when host workflows is empty", () => {
    const previous: SettingsSnapshot = {
      ...baseSnapshot,
      workflows: [
        {
          id: "new-wf",
          name: "new-wf",
          path: ".lanyard/workflows/new-wf.json",
          enabled: true,
          updated_at: new Date(now - 1_000).toISOString(),
        },
      ],
    };
    const incoming: SettingsSnapshot = {
      ...baseSnapshot,
      exported_at: "2026-08-13T18:30:00.000Z",
      workflows: [],
    };
    const merged = mergeIncomingSettingsSnapshot(previous, incoming, {
      nowMs: now,
    });
    expect(merged.workflows?.map((w) => w.id)).toEqual(["new-wf"]);
  });

  it("accepts empty host list when local rows are outside sticky window", () => {
    const previous: SettingsSnapshot = {
      ...baseSnapshot,
      workflows: [
        {
          id: "stale-wf",
          name: "stale-wf",
          enabled: true,
          updated_at: new Date(
            now - WORKFLOW_OPTIMISTIC_STICKY_MS - 1,
          ).toISOString(),
        },
      ],
    };
    const incoming: SettingsSnapshot = {
      ...baseSnapshot,
      workflows: [],
    };
    const merged = mergeIncomingSettingsSnapshot(previous, incoming, {
      nowMs: now,
    });
    expect(merged.workflows).toEqual([]);
  });

  it("prefers host row when both sides list the same id", () => {
    const previous: SettingsSnapshot = {
      ...baseSnapshot,
      workflows: [
        {
          id: "shared",
          name: "shared",
          path: "local-path",
          enabled: true,
          updated_at: new Date(now).toISOString(),
        },
      ],
    };
    const incoming: SettingsSnapshot = {
      ...baseSnapshot,
      workflows: [
        {
          id: "shared",
          name: "shared",
          path: "host-path",
          enabled: true,
          updated_at: "2026-08-13T18:00:00.000Z",
        },
      ],
    };
    const merged = mergeIncomingSettingsSnapshot(previous, incoming, {
      nowMs: now,
    });
    expect(merged.workflows).toHaveLength(1);
    expect(merged.workflows?.[0]?.path).toBe("host-path");
  });
});
