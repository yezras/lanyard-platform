import type { ChatEvent, McqChoice } from "../../api/types.js";

export type ToolApprovalGate = "sticky" | "every_call";

export type ChatTimelineToolApprovalItem = {
  type: "tool_approval";
  approvalId: string;
  gate: ToolApprovalGate;
  actionClass: string | null;
  mapped: boolean;
  connectorId: string | null;
  content: string;
  choices: McqChoice[];
  selectedChoiceId: string | null;
  disabled: boolean;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseChoices(value: unknown): McqChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const choices: McqChoice[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const id = asString(rec.id);
    const label = asString(rec.label);
    if (id && label) {
      choices.push({ id, label });
    }
  }
  return choices;
}

export function parseToolApprovalEvent(
  event: ChatEvent,
): ChatTimelineToolApprovalItem | null {
  const meta = event.metadata;
  const approvalId =
    asString(event.approval_id) ??
    (meta ? asString(meta.approval_id) : undefined);
  if (!approvalId) {
    return null;
  }
  const gateRaw =
    event.gate ?? (meta ? asString(meta.gate) : undefined);
  const gate: ToolApprovalGate =
    gateRaw === "sticky" ? "sticky" : "every_call";
  const choices =
    event.choices && event.choices.length > 0
      ? event.choices
      : parseChoices(meta?.choices);
  if (choices.length === 0) {
    return null;
  }
  const actionClass =
    event.action_class ??
    (meta ? asString(meta.action_class) : undefined) ??
    null;
  return {
    type: "tool_approval",
    approvalId,
    gate,
    actionClass,
    mapped: event.mapped === true || meta?.mapped === true,
    connectorId:
      event.connector_id ??
      (meta ? asString(meta.connector_id) : undefined) ??
      null,
    content: event.content?.trim() || "Approve this command?",
    choices,
    selectedChoiceId: null,
    disabled: false,
  };
}

export function isAlwaysChoice(choice: McqChoice): boolean {
  return choice.id === "always";
}

export function isRejectChoice(choice: McqChoice): boolean {
  return choice.id === "reject";
}
