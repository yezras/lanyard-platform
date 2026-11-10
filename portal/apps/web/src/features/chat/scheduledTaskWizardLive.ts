/**
 * Live-chat hooks for the scheduled-task create wizard (lp-jzl.9.1).
 *
 * The agent starts the flow by calling `cronjob` with `action=setup` (or an
 * alias). Portal watches tool_progress for that result and opens the MCQ
 * wizard. There is no hard-coded NL phrase list in the composer.
 */

/** Portal directive emitted by LA `cronjob action=setup`. */
export const SCHEDULED_TASK_WIZARD_PORTAL_EVENT = "scheduled_task_wizard";

const SETUP_ACTIONS = new Set([
  "setup",
  "wizard",
  "start_wizard",
  "create_wizard",
  "interactive_create",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Parse tool_progress metadata.result (JSON string or object) for cronjob setup.
 */
export function parseCronjobToolResult(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.result ?? metadata.details ?? metadata.tool_result;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
  return asRecord(raw);
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
  return name.trim().toLowerCase();
}

function toolStatusFromEvent(event: {
  tool_status?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = event.metadata;
  const status =
    (typeof event.tool_status === "string" && event.tool_status) ||
    (meta && typeof meta.tool_status === "string" ? meta.tool_status : "") ||
    (meta && typeof meta.status === "string" ? meta.status : "") ||
    "";
  return status.trim().toLowerCase();
}

/**
 * True when a live chat SSE / tool row means: start the Portal scheduled-task
 * wizard (agent called cronjob action=setup).
 */
export function isScheduledTaskWizardToolEvent(event: {
  type?: string | null;
  tool_name?: string | null;
  tool_label?: string | null;
  tool_status?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = event.metadata ?? null;
  const portalEvent =
    meta && typeof meta.portal_event === "string"
      ? meta.portal_event.trim().toLowerCase()
      : "";

  // Direct portal_event (if a host emits a dedicated row).
  if (portalEvent === SCHEDULED_TASK_WIZARD_PORTAL_EVENT) {
    return true;
  }

  // Only tool lifecycle rows for the cronjob tool.
  const isToolRow =
    event.type === "tool_progress" ||
    portalEvent === "tool_progress" ||
    portalEvent === "tool" ||
    portalEvent === "tool_call" ||
    portalEvent === "agent_tool";
  if (!isToolRow) return false;

  const name = toolNameFromEvent(event);
  const isCronTool =
    name === "cronjob" ||
    name === "cron job" ||
    name.endsWith(".cronjob") ||
    name.includes("cronjob");
  if (!isCronTool) return false;

  // Prefer terminal success so we don't open twice on started+completed.
  const status = toolStatusFromEvent(event);
  if (
    status &&
    status !== "complete" &&
    status !== "completed" &&
    status !== "success" &&
    status !== "done"
  ) {
    return false;
  }

  const result = parseCronjobToolResult(meta);
  if (!result) {
    // Some hosts put action on the metadata root.
    const rootAction =
      meta && typeof meta.action === "string"
        ? meta.action.trim().toLowerCase()
        : "";
    return SETUP_ACTIONS.has(rootAction);
  }

  const action =
    typeof result.action === "string" ? result.action.trim().toLowerCase() : "";
  if (SETUP_ACTIONS.has(action)) return true;

  const portalUi = asRecord(result.portal_ui);
  if (
    portalUi &&
    typeof portalUi.portal_event === "string" &&
    portalUi.portal_event.trim().toLowerCase() ===
      SCHEDULED_TASK_WIZARD_PORTAL_EVENT
  ) {
    return true;
  }

  return false;
}

/** Free-text cancel while a wizard is open. */
export function isWizardCancelText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(cancel|never\s*mind|nevermind|stop|abort|exit|quit)(\s+please)?[.!]?$/.test(
    t,
  );
}

/**
 * Steps that collect free text instead of (or after) MCQ.
 *
 * `timezone` is free-text only after the user picks MCQ "other" (activeMcq
 * cleared). Pass `activeMcq` when known so a live timezone MCQ still routes
 * free text to the "choose a chip" path instead of applyWizardTextInput.
 */
export function wizardStepNeedsFreeText(
  step: string,
  activeMcq?: { mcq_id?: string } | null,
): step is
  | "instructions_text"
  | "days_custom"
  | "time_custom"
  | "timezone" {
  if (
    step === "instructions_text" ||
    step === "days_custom" ||
    step === "time_custom"
  ) {
    return true;
  }
  // Free-text IANA after timezone MCQ "other" clears activeMcq.
  // When activeMcq is omitted (undefined), treat timezone as free-text-capable
  // so call sites that only pass the step still prompt/status correctly.
  if (step === "timezone") {
    return activeMcq == null;
  }
  return false;
}
