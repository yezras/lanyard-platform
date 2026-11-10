/**
 * Vault identity for harness workflow run state (lp-oop.38.22).
 *
 * Guest persist writes `/mnt/vault/workflows/runs/{run_id}/state.json`.
 * Portal vault APIs and citation chips are vault-root-relative.
 */

import {
  DEFAULT_GUEST_VAULT_ROOT,
  projectToVaultRelativePath,
} from "../rbac/path-project.js";

export const VAULT_WORKFLOW_RUNS_DIR = "/workflows/runs";
export const WORKFLOW_RUN_STATE_FILENAME = "state.json";

/** Guest absolute directory the toolbox persist uses. */
export const GUEST_WORKFLOW_RUNS_ROOT = `${DEFAULT_GUEST_VAULT_ROOT}/workflows/runs`;

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type WorkflowRunVaultDocument = {
  run_id: string;
  workflow_name?: string;
  status?: string;
  stages?: unknown;
  source: "bff_workflow_event";
  updated_at: string;
  run?: unknown;
};

export type WorkflowRunVaultPersistPayload = {
  runId: string;
  path: string;
  body: string;
  document: WorkflowRunVaultDocument;
};

export function isWorkflowRunId(value: string): boolean {
  const id = value.trim();
  if (!RUN_ID_RE.test(id)) return false;
  if (id.includes("..")) return false;
  return true;
}

/** Vault-root-relative state.json path, or null when run_id is unsafe. */
export function workflowRunStateVaultPath(runId: string): string | null {
  const id = runId.trim();
  if (!isWorkflowRunId(id)) return null;
  return `${VAULT_WORKFLOW_RUNS_DIR}/${id}/${WORKFLOW_RUN_STATE_FILENAME}`;
}

const STATE_PATH_RE = new RegExp(
  `^${VAULT_WORKFLOW_RUNS_DIR}/([^/]+)/${WORKFLOW_RUN_STATE_FILENAME}$`,
);

/**
 * Run id from a guest or vault-relative state.json path.
 * `/mnt/vault/workflows/runs/{id}/state.json` and `/workflows/runs/{id}/state.json`.
 */
export function workflowRunIdFromVaultPath(rawPath: string): string | null {
  const projected = projectToVaultRelativePath(rawPath.trim());
  const match = STATE_PATH_RE.exec(projected);
  const id = match?.[1]?.trim() ?? "";
  return isWorkflowRunId(id) ? id : null;
}

function persistPayloadForRun(
  runId: string,
  nowIso: string,
  extra: Omit<WorkflowRunVaultDocument, "run_id" | "source" | "updated_at"> = {},
): WorkflowRunVaultPersistPayload | null {
  const path = workflowRunStateVaultPath(runId);
  if (!path) return null;
  const document: WorkflowRunVaultDocument = {
    run_id: runId,
    source: "bff_workflow_event",
    updated_at: nowIso,
    ...extra,
  };
  return {
    runId,
    path,
    body: `${JSON.stringify(document, null, 2)}\n`,
    document,
  };
}

/** Stub persist payload from a citation or GET path. */
export function workflowRunVaultPersistFromStatePath(
  rawPath: string,
  nowIso: string,
): WorkflowRunVaultPersistPayload | null {
  const runId = workflowRunIdFromVaultPath(rawPath);
  if (!runId) return null;
  return persistPayloadForRun(runId, nowIso);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function runIdFromUnknown(value: unknown): string | null {
  const direct = asNonEmptyString(value);
  if (direct && isWorkflowRunId(direct)) return direct;
  if (!isRecord(value)) return null;
  for (const key of ["run_id", "workflow_id", "workflowId", "id"] as const) {
    const hit = asNonEmptyString(value[key]);
    if (hit && isWorkflowRunId(hit)) return hit;
  }
  return null;
}

function isWorkflowChatEvent(event: Record<string, unknown>): boolean {
  if (asNonEmptyString(event.tool_name) === "workflow") return true;
  if (asNonEmptyString(event.tool_kind) === "workflow") return true;
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  if (!metadata) return false;
  if (asNonEmptyString(metadata.tool_name) === "workflow") return true;
  if (asNonEmptyString(metadata.tool_kind) === "workflow") return true;
  const portalEvent = asNonEmptyString(metadata.portal_event);
  return portalEvent === "workflow_progress" || portalEvent === "workflow";
}

function citationPathsFromEvent(event: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const row of value) {
      if (!isRecord(row)) continue;
      const path = asNonEmptyString(row.path);
      if (path) out.push(path);
    }
  };
  push(event.citations);
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  if (metadata) push(metadata.citations);
  return out;
}

function runIdFromCitationPaths(event: Record<string, unknown>): string | null {
  for (const path of citationPathsFromEvent(event)) {
    const runId = workflowRunIdFromVaultPath(path);
    if (runId) return runId;
  }
  return null;
}

/**
 * Build a vault persist payload from a chat/relay workflow event.
 * Also accepts a citation to workflows/runs/{id}/state.json (guest or relative).
 * Returns null when the event is not a workflow run or the id is unsafe.
 */
export function workflowRunVaultPersistFromChatEvent(
  event: unknown,
  nowIso: string,
): WorkflowRunVaultPersistPayload | null {
  if (!isRecord(event)) return null;

  const metadata = isRecord(event.metadata) ? event.metadata : {};
  const resultRecord = parseJsonRecord(event.result ?? metadata.result);
  const runRecord = isRecord(resultRecord?.run) ? resultRecord.run : null;

  if (isWorkflowChatEvent(event)) {
    const runId =
      runIdFromUnknown(metadata.workflow_id) ??
      runIdFromUnknown(metadata.workflowId) ??
      runIdFromUnknown(metadata.run_id) ??
      runIdFromUnknown(runRecord) ??
      runIdFromUnknown(resultRecord) ??
      runIdFromUnknown(event.tool_call_id) ??
      runIdFromCitationPaths(event);

    if (!runId) return null;
    const extra: Omit<
      WorkflowRunVaultDocument,
      "run_id" | "source" | "updated_at"
    > = {};
    const workflowName =
      asNonEmptyString(metadata.workflow_name) ??
      asNonEmptyString(runRecord?.workflow_name) ??
      asNonEmptyString(runRecord?.display_name) ??
      asNonEmptyString(resultRecord?.workflow_name) ??
      undefined;
    const status =
      asNonEmptyString(metadata.workflow_status) ??
      asNonEmptyString(runRecord?.status) ??
      asNonEmptyString(event.tool_status) ??
      undefined;
    const stages = metadata.stages ?? runRecord?.phases;
    if (workflowName) extra.workflow_name = workflowName;
    if (status) extra.status = status;
    if (stages !== undefined) extra.stages = stages;
    if (runRecord) extra.run = runRecord;
    return persistPayloadForRun(runId, nowIso, extra);
  }

  const cited = runIdFromCitationPaths(event);
  if (!cited) return null;
  return persistPayloadForRun(cited, nowIso);
}
