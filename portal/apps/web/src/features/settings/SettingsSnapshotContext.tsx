import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { fetchSettingsSnapshot } from "../../api/settings.js";
import type {
  ChatEvent,
  SettingsSnapshot,
  SettingsWorkflow,
} from "../../api/types.js";

/** Debounce window for chat-driven inventory invalidation (lp-a8u.7). */
export const INVENTORY_REFRESH_DEBOUNCE_MS = 400;

/**
 * How long local-only workflow rows (optimistic create) stick when the host
 * snapshot omits them. Covers discover lag after create without permanently
 * resurrecting deleted defs (lp-khq.13).
 */
export const WORKFLOW_OPTIMISTIC_STICKY_MS = 120_000;

function workflowRowKey(row: SettingsWorkflow): string {
  const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
  if (id) return id;
  const name = typeof row.name === "string" ? row.name.trim().toLowerCase() : "";
  return name;
}

function isStickyOptimisticWorkflow(
  row: SettingsWorkflow,
  nowMs: number,
  stickyMs: number,
): boolean {
  if (!row.updated_at) return false;
  const ts = Date.parse(row.updated_at);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts >= 0 && nowMs - ts <= stickyMs;
}

/**
 * Merge a fetched host settings snapshot over local state.
 *
 * Host inventory can lag create: an empty (or partial) workflows list must not
 * clobber an optimistic upsert that Tools → Workflows and `$` typeahead already
 * rely on. Prefer host rows when present; keep recent local-only rows until the
 * host lists them or the sticky window expires (lp-khq.13 / lp-khq.12.2).
 */
export function mergeIncomingSettingsSnapshot(
  previous: SettingsSnapshot | null,
  incoming: SettingsSnapshot,
  options?: {
    nowMs?: number;
    stickyMs?: number;
  },
): SettingsSnapshot {
  const prevWorkflows = previous?.workflows ?? [];
  if (prevWorkflows.length === 0) {
    return incoming;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const stickyMs = options?.stickyMs ?? WORKFLOW_OPTIMISTIC_STICKY_MS;
  const nextWorkflows = incoming.workflows ?? [];

  const byKey = new Map<string, SettingsWorkflow>();
  for (const row of nextWorkflows) {
    const key = workflowRowKey(row);
    if (key) byKey.set(key, row);
  }

  let added = false;
  for (const row of prevWorkflows) {
    const key = workflowRowKey(row);
    if (!key || byKey.has(key)) continue;
    // Only preserve recent optimistic / local upserts — not stale ghosts.
    if (!isStickyOptimisticWorkflow(row, nowMs, stickyMs)) continue;
    byKey.set(key, row);
    added = true;
  }

  if (!added) {
    return incoming;
  }

  return {
    ...incoming,
    workflows: [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Local normalize — avoid importing chat mappers into settings (layering). */
function normalizeToolNameKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeToolStatus(
  value: unknown,
): "pending" | "running" | "complete" | "error" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return undefined;
  if (
    raw === "complete" ||
    raw === "completed" ||
    raw === "done" ||
    raw === "success" ||
    raw === "succeeded" ||
    raw === "ok" ||
    raw === "finished" ||
    raw === "end" ||
    raw === "ended"
  ) {
    return "complete";
  }
  if (
    raw === "error" ||
    raw === "failed" ||
    raw === "failure" ||
    raw === "fail" ||
    raw === "cancelled" ||
    raw === "canceled" ||
    raw === "timeout" ||
    raw === "timed_out" ||
    raw === "aborted" ||
    raw === "abort"
  ) {
    return "error";
  }
  if (
    raw === "running" ||
    raw === "in_progress" ||
    raw === "started" ||
    raw === "start" ||
    raw === "active" ||
    raw === "progress" ||
    raw === "executing" ||
    raw === "working"
  ) {
    return "running";
  }
  if (
    raw === "pending" ||
    raw === "queued" ||
    raw === "waiting" ||
    raw === "scheduled" ||
    raw === "idle"
  ) {
    return "pending";
  }
  return undefined;
}

export type SettingsSnapshotContextValue = {
  /** Shared redacted settings snapshot (skills, models, crons, MCP, …). */
  snapshot: SettingsSnapshot | null;
  /**
   * Replace or patch the shared snapshot. SettingsView uses this for
   * optimistic enable/disable and active-model updates so Chat picks them up
   * without remounting or hard reload.
   */
  setSnapshot: Dispatch<SetStateAction<SettingsSnapshot | null>>;
  /** Refetch from GET /api/settings/snapshot and publish to all consumers. */
  refreshSnapshot: () => Promise<SettingsSnapshot>;
  /**
   * Debounced refresh for chat tool completions that likely mutate inventory
   * (skills / workflows / crons). Coalesces rapid tool events into one fetch.
   */
  scheduleInventoryRefresh: () => void;
  isLoading: boolean;
  loadError: string | null;
};

const SettingsSnapshotContext =
  createContext<SettingsSnapshotContextValue | null>(null);

/**
 * Bare tool id for inventory heuristics (`server__skill_manage` → `skill_manage`).
 */
export function bareInventoryToolName(name: string | undefined | null): string {
  const raw = name?.trim() ?? "";
  if (!raw) return "";
  if (/\s/.test(raw) || raw.length > 64) {
    return normalizeToolNameKey(raw);
  }
  const sep = raw.lastIndexOf("__");
  const bare =
    sep >= 0 && sep < raw.length - 1 ? raw.slice(sep + 2) : raw;
  return normalizeToolNameKey(bare);
}

/**
 * True when a tool name is likely to create/update skills, workflows, or cron
 * inventory (not pure list/view). Prefer `metadata.inventory_mutated` when set.
 */
export function isInventoryMutatingToolName(
  name: string | undefined | null,
): boolean {
  const n = bareInventoryToolName(name);
  if (!n) return false;

  // Explicit non-mutators (list / view / run progress).
  if (
    n === "skill_view" ||
    n === "skills_list" ||
    n === "skill_list" ||
    n === "list_skills" ||
    n === "list_skill" ||
    n === "list_cron" ||
    n === "cron_list" ||
    n === "list_jobs" ||
    n === "list_schedule" ||
    n === "check_schedule" ||
    n === "get_schedule" ||
    n === "workflow_progress" ||
    n === "workflow_run" ||
    n === "run_workflow" ||
    n === "list_workflows" ||
    n === "workflow_list"
  ) {
    return false;
  }

  // Skill create / write / manage family (LA skill_manage + aliases).
  if (
    n === "skill_manage" ||
    n === "skill_create" ||
    n === "create_skill" ||
    n === "write_skill" ||
    n === "save_skill" ||
    n === "skill_write" ||
    n === "skill_save" ||
    n === "skills_manage" ||
    n === "manage_skill" ||
    n === "manage_skills" ||
    n === "update_skill" ||
    n === "skill_update"
  ) {
    return true;
  }

  // Workflow definition create/save (not runtime workflow_progress cards).
  // LA product tool is bare `workflow` with action=create|save (lp-khq.12.2).
  if (
    n === "workflow" ||
    n === "workflow_create" ||
    n === "create_workflow" ||
    n === "write_workflow" ||
    n === "workflow_write" ||
    n === "save_workflow" ||
    n === "workflow_save" ||
    n === "workflow_manage" ||
    n === "manage_workflow" ||
    n === "update_workflow" ||
    n === "workflow_update"
  ) {
    return true;
  }

  // Cron / job schedule mutators (Hermes `cronjob`, LA aliases, create_*/cron_*).
  // LA product tool is bare `cronjob` (create/update/pause/resume/run/remove).
  // Treat as inventory mutator so Settings Crons refresh after chat create (lp-su0 / lp-uxy.4).
  if (
    n === "cronjob" ||
    n === "cron_job" ||
    n === "hermes_cron" ||
    n === "cron_create" ||
    n === "cron.create" ||
    n === "scheduled_task" ||
    n === "scheduled_task.create" ||
    n === "create_cron" ||
    n === "cron_update" ||
    n === "update_cron" ||
    n === "cron_manage" ||
    n === "manage_cron" ||
    n === "save_cron" ||
    n === "cron_save" ||
    n === "create_job" ||
    n === "job_create" ||
    n === "schedule_job" ||
    n === "job_schedule" ||
    n === "add_cron" ||
    n === "cron_add" ||
    n === "cron_delete" ||
    n === "delete_cron" ||
    n === "remove_cron" ||
    n === "cron_remove" ||
    n === "start_job" ||
    n === "job_start" ||
    n === "run_job" ||
    n === "job_run" ||
    n === "cron_run"
  ) {
    return true;
  }

  // Soft match: skill_* write/create/manage (exclude view/list above).
  if (n.startsWith("skill_") && /(create|write|save|manage|update|add|delete|remove)/.test(n)) {
    return true;
  }
  if (n.startsWith("workflow_") && /(create|write|save|manage|update|add|delete|remove)/.test(n)) {
    return true;
  }
  // Soft match only for clear mutate verbs — never bare "job" (matches job_status/list).
  if (
    (n.startsWith("cron_") || n.startsWith("job_") || n.includes("cronjob")) &&
    /(create|write|save|manage|update|add|delete|remove|schedule|pause|resume)/.test(n)
  ) {
    return true;
  }
  // Explicit run/start remain on the allowlist above (cron_run, start_job, …).

  return false;
}

/**
 * Read-only cron tool actions (Hermes `cronjob action=list` etc.).
 * When present on a completed tool event, skip inventory refresh.
 */
export function isCronInventoryReadOnlyAction(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  let raw =
    metadata.action ??
    metadata.op ??
    metadata.command ??
    metadata.cron_action ??
    metadata.method;
  // Tool result body often carries action (cronjob action=list|setup).
  if (typeof raw !== "string" && typeof metadata.result === "string") {
    try {
      const parsed: unknown = JSON.parse(metadata.result);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const action = (parsed as { action?: unknown }).action;
        if (typeof action === "string") raw = action;
      }
    } catch {
      // ignore non-JSON result
    }
  }
  if (typeof raw !== "string") return false;
  const action = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (
    action === "list" ||
    action === "get" ||
    action === "check" ||
    action === "view" ||
    action === "status" ||
    action === "show" ||
    action === "describe" ||
    action === "read" ||
    // Portal wizard start — no jobs.json write (lp-jzl.9.1).
    action === "setup" ||
    action === "wizard" ||
    action === "start_wizard" ||
    action === "create_wizard" ||
    action === "interactive_create"
  );
}

/**
 * Read-only / non-inventory actions for the bare LA `workflow` tool
 * (launch, list, status, pause, …). Create/save mutate definition inventory.
 * When present on a completed tool event, skip inventory refresh (lp-khq.12.2).
 */
export function isWorkflowInventoryReadOnlyAction(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  let raw =
    metadata.action ??
    metadata.op ??
    metadata.command ??
    metadata.workflow_action ??
    metadata.method;
  if (typeof raw !== "string") {
    const candidates = [metadata.result, metadata.details, metadata.tool_result];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        try {
          const parsed: unknown = JSON.parse(candidate);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const action = (parsed as { action?: unknown }).action;
            if (typeof action === "string") {
              raw = action;
              break;
            }
          }
        } catch {
          // ignore non-JSON
        }
      } else if (
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate)
      ) {
        const action = (candidate as { action?: unknown }).action;
        if (typeof action === "string") {
          raw = action;
          break;
        }
      }
    }
  }
  if (typeof raw !== "string") return false;
  const action = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  // Mutating authoring actions — NOT read-only.
  if (
    action === "create" ||
    action === "save" ||
    action === "update" ||
    action === "write" ||
    action === "delete" ||
    action === "remove" ||
    action === "manage"
  ) {
    return false;
  }
  // Everything else on bare workflow (launch/list/status/pause/…) is read-only
  // for Settings inventory (definition list). validate_definition is no-write.
  return (
    action === "list" ||
    action === "launch" ||
    action === "status" ||
    action === "pause" ||
    action === "resume" ||
    action === "stop" ||
    action === "get" ||
    action === "view" ||
    action === "show" ||
    action === "describe" ||
    action === "read" ||
    action === "validate" ||
    action === "validate_definition" ||
    action === "validate_only" ||
    action === "run" ||
    action === "progress"
  );
}

function toolStatusFromEvent(event: {
  tool_status?: string | null;
  metadata?: Record<string, unknown> | null;
}): ReturnType<typeof normalizeToolStatus> {
  const direct = normalizeToolStatus(event.tool_status);
  if (direct) return direct;
  const meta = event.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  return (
    normalizeToolStatus(meta.tool_status) ??
    normalizeToolStatus(meta.status) ??
    normalizeToolStatus(meta.state) ??
    normalizeToolStatus(meta.phase)
  );
}

/**
 * True when a chat event is a completed tool that likely mutated Settings
 * inventory (skill / workflow / cron). Also honors `metadata.inventory_mutated`.
 *
 * Used by ChatView to debounce-call `scheduleInventoryRefresh` (lp-a8u.7).
 * No new SSE channel required.
 */
export function isInventoryMutatingToolEvent(
  event: Pick<
    ChatEvent,
    "type" | "tool_name" | "tool_label" | "tool_status" | "metadata"
  > & {
    tool_status?: string | null;
  },
): boolean {
  const meta = event.metadata;
  const flagged =
    meta != null &&
    typeof meta === "object" &&
    meta.inventory_mutated === true;

  const portalEvent =
    meta && typeof meta.portal_event === "string"
      ? meta.portal_event.trim().toLowerCase()
      : "";

  // Only tool lifecycle rows (or explicitly flagged metadata).
  const isToolRow =
    event.type === "tool_progress" ||
    portalEvent === "tool_progress" ||
    portalEvent === "tool" ||
    portalEvent === "tool_call" ||
    portalEvent === "agent_tool" ||
    flagged;

  if (!isToolRow) {
    return false;
  }

  // Refresh only on terminal success — mid-run would stampede the API.
  const status = toolStatusFromEvent(event);
  if (status !== "complete") {
    // Host may set inventory_mutated only on the final row without status;
    // treat missing status + flag as complete.
    if (!(flagged && (status === undefined || status === null))) {
      return false;
    }
  }

  if (flagged) {
    return true;
  }

  const name =
    (typeof event.tool_name === "string" && event.tool_name) ||
    (typeof meta?.tool_name === "string" ? meta.tool_name : undefined) ||
    (typeof event.tool_label === "string" && event.tool_label) ||
    undefined;

  // Hermes `cronjob action=list` completes with the mutator tool id — skip refresh.
  if (
    isInventoryMutatingToolName(name) &&
    isCronInventoryReadOnlyAction(meta ?? undefined)
  ) {
    return false;
  }

  // Bare LA `workflow action=launch|list|…` shares the mutator tool id — skip.
  if (
    isInventoryMutatingToolName(name) &&
    isWorkflowInventoryReadOnlyAction(meta ?? undefined)
  ) {
    return false;
  }

  return isInventoryMutatingToolName(name);
}

export function SettingsSnapshotProvider({
  children,
  /**
   * When true (default), fetch snapshot once on mount. Tests can set false and
   * seed via `setSnapshot` or call `refreshSnapshot` explicitly.
   */
  autoLoad = true,
  /**
   * Debounce for {@link scheduleInventoryRefresh}. Tests may lower this.
   */
  inventoryRefreshDebounceMs = INVENTORY_REFRESH_DEBOUNCE_MS,
}: {
  children: ReactNode;
  autoLoad?: boolean;
  inventoryRefreshDebounceMs?: number;
}) {
  const [snapshot, setSnapshotState] = useState<SettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(autoLoad);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped on each local write / new fetch so stale responses cannot overwrite patches. */
  const generationRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSnapshotRef = useRef<(() => Promise<SettingsSnapshot>) | null>(
    null,
  );

  const setSnapshot = useCallback<
    Dispatch<SetStateAction<SettingsSnapshot | null>>
  >((update) => {
    generationRef.current += 1;
    setSnapshotState(update);
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<SettingsSnapshot> => {
    const generation = ++generationRef.current;
    setIsLoading(true);
    try {
      const body = await fetchSettingsSnapshot();
      if (generation !== generationRef.current) {
        // A newer patch or refresh won the race; still return payload to caller.
        // Caller (e.g. wizard) may re-upsert when host list lags.
        return body;
      }
      // Never clobber optimistic workflow upserts with an empty/partial host
      // list (lp-khq.13 — create lag / discover miss).
      let applied = body;
      setSnapshotState((prev) => {
        applied = mergeIncomingSettingsSnapshot(prev, body);
        return applied;
      });
      setLoadError(null);
      return applied;
    } catch (error) {
      if (generation === generationRef.current) {
        const message =
          error instanceof Error ? error.message : "Failed to load snapshot";
        setLoadError(message);
      }
      throw error instanceof Error ? error : new Error("Failed to load snapshot");
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  refreshSnapshotRef.current = refreshSnapshot;

  const scheduleInventoryRefresh = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void refreshSnapshotRef.current?.().catch(() => {
        // loadError already set on the provider when generation matches.
      });
    }, inventoryRefreshDebounceMs);
  }, [inventoryRefreshDebounceMs]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }
    void refreshSnapshot().catch(() => {
      // loadError already set; consumers read it from context.
    });
  }, [autoLoad, refreshSnapshot]);

  const value = useMemo(
    (): SettingsSnapshotContextValue => ({
      snapshot,
      setSnapshot,
      refreshSnapshot,
      scheduleInventoryRefresh,
      isLoading,
      loadError,
    }),
    [
      snapshot,
      setSnapshot,
      refreshSnapshot,
      scheduleInventoryRefresh,
      isLoading,
      loadError,
    ],
  );

  return (
    <SettingsSnapshotContext.Provider value={value}>
      {children}
    </SettingsSnapshotContext.Provider>
  );
}

export function useSettingsSnapshot(): SettingsSnapshotContextValue {
  const ctx = useContext(SettingsSnapshotContext);
  if (!ctx) {
    throw new Error(
      "useSettingsSnapshot must be used within SettingsSnapshotProvider",
    );
  }
  return ctx;
}

/** Optional hook — returns null outside provider (isolated unit tests). */
export function useOptionalSettingsSnapshot(): SettingsSnapshotContextValue | null {
  return useContext(SettingsSnapshotContext);
}

/** Active model id string from a snapshot (first `is_active` model). */
export function activeModelFromSnapshot(
  snapshot: SettingsSnapshot | null | undefined,
): string | undefined {
  const active = snapshot?.models?.find((model) => model.is_active);
  return active?.model;
}
