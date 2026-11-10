/**
 * Live-chat helpers for workflow create confirmation (lp-khq.12.2).
 *
 * Portal owns the wizard MCQ steps; host persistence uses agent `workflow`
 * action=create|save. After the create request is sent, success is claimed
 * only when a terminal tool event confirms save (and inventory can list the
 * name). Failed create must not claim Settings / $ typeahead success.
 */

import type { SettingsSnapshot, SettingsWorkflow } from "../../api/types.js";

import type { WorkflowCreateBody } from "./workflowChatWizard.js";

const AUTHORING_ACTIONS = new Set([
  "create",
  "save",
  "update",
  "write",
  "delete",
  "remove",
  "manage",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function bareToolName(name: string): string {
  const raw = name.trim().toLowerCase();
  if (!raw) return "";
  const sep = raw.lastIndexOf("__");
  const bare = sep >= 0 && sep < raw.length - 1 ? raw.slice(sep + 2) : raw;
  return bare.replace(/[\s-]+/g, "_");
}

function toolNameFromEvent(event: {
  tool_name?: string | null;
  tool_label?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = event.metadata;
  const name =
    (typeof event.tool_name === "string" && event.tool_name) ||
    (meta && typeof meta.tool_name === "string" ? meta.tool_name : "") ||
    (typeof event.tool_label === "string" && event.tool_label) ||
    "";
  return bareToolName(name);
}

function toolStatusFromEvent(event: {
  tool_status?: string | null;
  metadata?: Record<string, unknown> | null;
}): "complete" | "error" | "running" | undefined {
  const meta = event.metadata;
  const raw =
    (typeof event.tool_status === "string" && event.tool_status) ||
    (meta && typeof meta.tool_status === "string" ? meta.tool_status : "") ||
    (meta && typeof meta.status === "string" ? meta.status : "") ||
    (meta && typeof meta.state === "string" ? meta.state : "") ||
    "";
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return undefined;
  if (
    s === "complete" ||
    s === "completed" ||
    s === "done" ||
    s === "success" ||
    s === "succeeded" ||
    s === "ok" ||
    s === "finished" ||
    s === "end" ||
    s === "ended"
  ) {
    return "complete";
  }
  if (
    s === "error" ||
    s === "failed" ||
    s === "failure" ||
    s === "fail" ||
    s === "errored" ||
    s === "cancelled" ||
    s === "canceled"
  ) {
    return "error";
  }
  if (s === "running" || s === "pending" || s === "started" || s === "in_progress") {
    return "running";
  }
  return undefined;
}

/**
 * Parse workflow tool result from tool_progress metadata / event.result.
 */
export function parseWorkflowToolResult(
  event: {
    result?: string | null;
    result_detail?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Record<string, unknown> | null {
  const meta = event.metadata ?? null;
  const candidates: unknown[] = [
    event.result,
    event.result_detail,
    meta?.result,
    meta?.result_detail,
    meta?.details,
    meta?.tool_result,
    meta?.definition,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const rec = asRecord(parsed);
        if (rec) return rec;
      } catch {
        // keep scanning
      }
    } else {
      const rec = asRecord(raw);
      if (rec) return rec;
    }
  }
  return null;
}

function actionFromEvent(event: {
  result?: string | null;
  result_detail?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = event.metadata ?? null;
  if (meta && typeof meta.action === "string") {
    return meta.action.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }
  if (meta && typeof meta.workflow_action === "string") {
    return meta.workflow_action.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }
  const result = parseWorkflowToolResult(event);
  if (result && typeof result.action === "string") {
    return result.action.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }
  return "";
}

function isWorkflowAuthoringToolName(bare: string): boolean {
  if (!bare) return false;
  if (bare === "workflow") return true;
  if (
    bare === "workflow_create" ||
    bare === "create_workflow" ||
    bare === "write_workflow" ||
    bare === "workflow_write" ||
    bare === "save_workflow" ||
    bare === "workflow_save" ||
    bare === "workflow_manage" ||
    bare === "manage_workflow" ||
    bare === "update_workflow" ||
    bare === "workflow_update"
  ) {
    return true;
  }
  return (
    bare.startsWith("workflow_") &&
    /(create|write|save|manage|update|add|delete|remove)/.test(bare)
  );
}

export type WorkflowAuthoringToolOutcome =
  | {
      kind: "success";
      action: string;
      name: string | null;
      path: string | null;
    }
  | {
      kind: "error";
      action: string;
      name: string | null;
      error: string;
    }
  | { kind: "ignore" };

/**
 * Detect a terminal workflow create/save tool event and whether it succeeded.
 * Returns `ignore` for non-authoring tools, mid-run, or launch/list/etc.
 */
export function interpretWorkflowAuthoringToolEvent(event: {
  type?: string | null;
  tool_name?: string | null;
  tool_label?: string | null;
  tool_status?: string | null;
  result?: string | null;
  result_detail?: string | null;
  error_message?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}): WorkflowAuthoringToolOutcome {
  const meta = event.metadata ?? null;
  const portalEvent =
    meta && typeof meta.portal_event === "string"
      ? meta.portal_event.trim().toLowerCase()
      : "";

  const isToolRow =
    event.type === "tool_progress" ||
    portalEvent === "tool_progress" ||
    portalEvent === "tool" ||
    portalEvent === "tool_call" ||
    portalEvent === "agent_tool";
  if (!isToolRow) return { kind: "ignore" };

  // Runtime workflow_progress cards are not definition authoring.
  if (
    portalEvent === "workflow_progress" ||
    portalEvent === "workflow" ||
    (meta && meta.tool_kind === "workflow" && portalEvent === "workflow_progress")
  ) {
    // Still allow if tool_name is the control surface and action is authoring.
  }

  const bare = toolNameFromEvent(event);
  if (!isWorkflowAuthoringToolName(bare)) {
    return { kind: "ignore" };
  }

  // Runtime progress tools use names like workflow_progress / run_workflow —
  // already excluded by isWorkflowAuthoringToolName except bare "workflow".

  const status = toolStatusFromEvent(event);
  if (status === "running") {
    return { kind: "ignore" };
  }

  const action = actionFromEvent(event);
  // Bare workflow without action: only treat as authoring when result carries
  // definition/name success shape or explicit inventory_mutated.
  const result = parseWorkflowToolResult(event);
  const definition = asRecord(result?.definition) ?? asRecord(meta?.definition);
  const hasDefinitionPayload = Boolean(
    definition ||
      (result &&
        (typeof result.name === "string" ||
          typeof result.path === "string" ||
          result.created === true ||
          result.updated === true)),
  );

  if (action) {
    if (!AUTHORING_ACTIONS.has(action)) {
      return { kind: "ignore" };
    }
  } else if (!hasDefinitionPayload && meta?.inventory_mutated !== true) {
    // Unknown action and no authoring payload — ignore (e.g. bare complete).
    return { kind: "ignore" };
  }

  const resolvedAction = action || "create";

  const nameFrom =
    (definition && typeof definition.name === "string" && definition.name) ||
    (result && typeof result.name === "string" && result.name) ||
    (meta && typeof meta.name === "string" && meta.name) ||
    null;
  const pathFrom =
    (definition && typeof definition.path === "string" && definition.path) ||
    (result && typeof result.path === "string" && result.path) ||
    (meta && typeof meta.path === "string" && meta.path) ||
    null;

  const successFlag =
    result && typeof result.success === "boolean"
      ? result.success
      : definition && typeof definition.ok === "boolean"
        ? definition.ok
        : undefined;

  const errorText =
    (typeof event.error_message === "string" && event.error_message) ||
    (typeof event.errorMessage === "string" && event.errorMessage) ||
    (result && typeof result.error === "string" && result.error) ||
    (definition &&
      Array.isArray(definition.errors) &&
      definition.errors
        .filter((e): e is string => typeof e === "string")
        .join("; ")) ||
    (meta && typeof meta.error === "string" && meta.error) ||
    "";

  if (status === "error" || successFlag === false) {
    return {
      kind: "error",
      action: resolvedAction,
      name: nameFrom?.trim() || null,
      error: errorText.trim() || "Workflow create failed on host",
    };
  }

  // Terminal success: complete status, or success:true, or definition.ok.
  if (
    status === "complete" ||
    successFlag === true ||
    (definition && definition.ok === true) ||
    meta?.inventory_mutated === true
  ) {
    return {
      kind: "success",
      action: resolvedAction,
      name: nameFrom?.trim() || null,
      path: pathFrom?.trim() || null,
    };
  }

  return { kind: "ignore" };
}

/** True when settings snapshot workflows list includes this name/id. */
export function workflowInventoryIncludesName(
  snapshot: SettingsSnapshot | null | undefined,
  name: string,
): boolean {
  const target = name.trim().toLowerCase();
  if (!target) return false;
  const list = snapshot?.workflows ?? [];
  return list.some((w) => {
    const id = typeof w.id === "string" ? w.id.trim().toLowerCase() : "";
    const n = typeof w.name === "string" ? w.name.trim().toLowerCase() : "";
    return id === target || n === target;
  });
}

/**
 * Optimistically insert/update a workflow row so Tools → Workflows and `$`
 * typeahead show the def before the next snapshot round-trip finishes.
 */
export function upsertWorkflowInSnapshot(
  snapshot: SettingsSnapshot | null,
  row: {
    name: string;
    path?: string | null;
    description?: string | null;
  },
): SettingsSnapshot | null {
  if (!snapshot) return snapshot;
  const name = row.name.trim();
  if (!name) return snapshot;
  const id = name;
  const existing = snapshot.workflows ?? [];
  const nextRow: SettingsWorkflow = {
    id,
    name,
    enabled: true,
    updated_at: new Date().toISOString(),
    ...(row.path ? { path: row.path } : {}),
    ...(row.description ? { description: row.description } : {}),
  };
  const idx = existing.findIndex(
    (w) =>
      w.id === id ||
      w.name === name ||
      (typeof w.id === "string" && w.id.toLowerCase() === id.toLowerCase()),
  );
  const workflows =
    idx >= 0
      ? existing.map((w, i) =>
          i === idx
            ? {
                ...w,
                ...nextRow,
                path: nextRow.path ?? w.path,
                description: nextRow.description ?? w.description,
              }
            : w,
        )
      : [...existing, nextRow].sort((a, b) => a.id.localeCompare(b.id));
  return { ...snapshot, workflows };
}

/** Display name for chat (Title Case from kebab-id). */
export function displayWorkflowName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Honest success copy after host save is confirmed and inventory can list it.
 */
export function formatWorkflowCreateSucceededMessage(options: {
  name: string;
  path?: string | null;
  launchAfter?: boolean;
  inventoryConfirmed?: boolean;
}): string {
  const display = displayWorkflowName(options.name);
  const inventoryLine = options.inventoryConfirmed
    ? `It is listed under **Tools → Workflows** and available via \`$ ${options.name}\`.`
    : `It should appear under **Tools → Workflows** and via \`$ ${options.name}\` after inventory refresh.`;
  if (options.launchAfter) {
    return `Created **${display}** and requested launch. ${inventoryLine}`;
  }
  return `Created **${display}**. ${inventoryLine} Type \`$ ${options.name}\` or ask me to launch it when you want a run.`;
}

/**
 * Pending copy while the host is still saving (never claims Settings success).
 */
export function formatWorkflowCreatePendingMessage(
  body: Pick<WorkflowCreateBody, "name" | "launchAfter">,
): string {
  const display = displayWorkflowName(body.name);
  return body.launchAfter
    ? `Creating **${display}** and launching it… I'll confirm when the host saves it.`
    : `Creating **${display}**… I'll confirm when the host saves it.`;
}
