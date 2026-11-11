import {
  classifyCommand,
  commandTokens,
  type ClassifyCommandResult,
} from "./classify.js";
import {
  ACTION_CLASS_GATES,
  ACTION_CLASSES,
  type ActionClass,
  type ActionGate,
  type ConnectorId,
} from "./types.js";

export type ConnectorSticky = Partial<Record<ActionClass, true>>;

export type ApprovalDecision = "always" | "approve_this_call" | "reject";

export type ApprovalChoiceId = "always" | "approve_this_call" | "reject";

export type ApprovalChoice = {
  id: ApprovalChoiceId;
  label: string;
};

export const APPROVAL_LABEL_ALWAYS = "Always";
export const APPROVAL_LABEL_REJECT = "Reject";
export const APPROVAL_LABEL_APPROVE_THIS_CALL = "Approve this call";

export const HIGH_GATE_ACTION_CLASSES = ACTION_CLASSES.filter(
  (actionClass) => ACTION_CLASS_GATES[actionClass] === "every_call",
) as readonly ActionClass[];

const ACTION_CLASS_CONNECTOR: Record<ActionClass, ConnectorId> = {
  "gmail.read": "google",
  "gmail.draft": "google",
  "gmail.send": "google",
  "calendar.read": "google",
  "calendar.write": "google",
  "drive.read": "google",
  "drive.write": "google",
  "hubspot.read": "hubspot",
  "hubspot.write": "hubspot",
  "whatsapp.read": "whatsapp",
  "whatsapp.send": "whatsapp",
  "github.read": "github",
  "github.write": "github",
};

export class IllegalApprovalDecisionError extends Error {
  readonly code = "ILLEGAL_APPROVAL_DECISION";

  constructor(message: string) {
    super(message);
    this.name = "IllegalApprovalDecisionError";
  }
}

export class IllegalStickyError extends Error {
  readonly code = "ILLEGAL_STICKY";

  constructor(message: string) {
    super(message);
    this.name = "IllegalStickyError";
  }
}

export function isHighGateActionClass(actionClass: ActionClass): boolean {
  return ACTION_CLASS_GATES[actionClass] === "every_call";
}

export function connectorIdForActionClass(
  actionClass: ActionClass,
): ConnectorId {
  return ACTION_CLASS_CONNECTOR[actionClass];
}

/**
 * Infer connector from classified argv. Unmapped gws/wacli/hs still bind
 * so pending_connector_use has a row to talk to. Unknown binaries stay null.
 */
export function connectorIdForArgv(
  argv: readonly string[],
): ConnectorId | null {
  const classified = classifyCommand(argv);
  if (classified.action_class) {
    return connectorIdForActionClass(classified.action_class);
  }
  const binary = commandTokens(argv)[0];
  if (binary === "gws") {
    return "google";
  }
  if (binary === "wacli") {
    return "whatsapp";
  }
  if (binary === "hs" || binary === "hubspot") {
    return "hubspot";
  }
  return null;
}

export type ToolApprovalAllow = {
  outcome: "allow";
  reason: "sticky";
  action_class: ActionClass;
  gate: "sticky";
  mapped: true;
  connector_id: ConnectorId;
  run: true;
};

export type ToolApprovalPrompt = {
  outcome: "prompt";
  reason: "need_approval";
  action_class: ActionClass | null;
  gate: ActionGate;
  mapped: boolean;
  connector_id: ConnectorId | null;
  run: false;
  choices: ApprovalChoice[];
  content: string;
};

export type ToolApprovalEvaluation = ToolApprovalAllow | ToolApprovalPrompt;

export type AppliedApproval =
  | {
      outcome: "allow";
      run: true;
      persist_sticky: ActionClass | null;
      disconnect: false;
    }
  | {
      outcome: "skip";
      run: false;
      persist_sticky: null;
      disconnect: false;
    };

export function stickyChoices(): ApprovalChoice[] {
  return [
    { id: "always", label: APPROVAL_LABEL_ALWAYS },
    { id: "reject", label: APPROVAL_LABEL_REJECT },
  ];
}

export function everyCallChoices(): ApprovalChoice[] {
  return [
    { id: "approve_this_call", label: APPROVAL_LABEL_APPROVE_THIS_CALL },
    { id: "reject", label: APPROVAL_LABEL_REJECT },
  ];
}

export function approvalChoices(gate: ActionGate): ApprovalChoice[] {
  return gate === "sticky" ? stickyChoices() : everyCallChoices();
}

export function approvalPrompt(input: {
  action_class: ActionClass | null;
  mapped: boolean;
  gate: ActionGate;
}): string {
  if (!input.mapped || !input.action_class) {
    return "Approve this command?";
  }
  if (input.gate === "sticky") {
    return `Allow ${input.action_class}?`;
  }
  return `Approve this ${input.action_class} call?`;
}

function hasSticky(
  sticky: ConnectorSticky,
  actionClass: ActionClass,
): boolean {
  return sticky[actionClass] === true;
}

export function parseApprovalDecision(value: unknown): ApprovalDecision {
  if (
    value === "always" ||
    value === "approve_this_call" ||
    value === "reject"
  ) {
    return value;
  }
  throw new IllegalApprovalDecisionError(
    `unknown approval decision: ${JSON.stringify(value)}`,
  );
}

export function parseConnectorSticky(value: unknown): ConnectorSticky {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new IllegalStickyError("sticky must be an object");
  }
  const sticky: ConnectorSticky = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!(ACTION_CLASSES as readonly string[]).includes(key)) {
      throw new IllegalStickyError(`unknown action_class: ${key}`);
    }
    const actionClass = key as ActionClass;
    if (flag !== true) {
      continue;
    }
    if (isHighGateActionClass(actionClass)) {
      throw new IllegalStickyError(
        `action_class ${actionClass} is every_call and cannot be sticky`,
      );
    }
    sticky[actionClass] = true;
  }
  return sticky;
}

export function setStickyFlag(
  sticky: ConnectorSticky,
  actionClass: ActionClass,
  enabled: boolean,
): ConnectorSticky {
  if (enabled && isHighGateActionClass(actionClass)) {
    throw new IllegalStickyError(
      `action_class ${actionClass} is every_call and cannot be sticky`,
    );
  }
  const next: ConnectorSticky = { ...sticky };
  if (enabled) {
    next[actionClass] = true;
  } else {
    delete next[actionClass];
  }
  return next;
}

export function evaluateToolApproval(
  argv: readonly string[],
  sticky: ConnectorSticky,
): ToolApprovalEvaluation {
  const classified: ClassifyCommandResult = classifyCommand(argv);
  const connector_id = connectorIdForArgv(argv);
  if (
    classified.mapped &&
    classified.action_class &&
    classified.gate === "sticky" &&
    hasSticky(sticky, classified.action_class)
  ) {
    return {
      outcome: "allow",
      reason: "sticky",
      action_class: classified.action_class,
      gate: "sticky",
      mapped: true,
      connector_id: connectorIdForActionClass(classified.action_class),
      run: true,
    };
  }
  return {
    outcome: "prompt",
    reason: "need_approval",
    action_class: classified.action_class,
    gate: classified.gate,
    mapped: classified.mapped,
    connector_id,
    run: false,
    choices: approvalChoices(classified.gate),
    content: approvalPrompt({
      action_class: classified.action_class,
      mapped: classified.mapped,
      gate: classified.gate,
    }),
  };
}

export function applyApprovalDecision(
  evaluation: ToolApprovalEvaluation,
  decision: ApprovalDecision,
): AppliedApproval {
  if (evaluation.outcome === "allow") {
    return {
      outcome: "allow",
      run: true,
      persist_sticky: null,
      disconnect: false,
    };
  }
  if (decision === "reject") {
    return {
      outcome: "skip",
      run: false,
      persist_sticky: null,
      disconnect: false,
    };
  }
  if (decision === "always") {
    if (evaluation.gate !== "sticky" || !evaluation.action_class) {
      throw new IllegalApprovalDecisionError(
        "Always is only valid for sticky action classes",
      );
    }
    if (isHighGateActionClass(evaluation.action_class)) {
      throw new IllegalApprovalDecisionError(
        `action_class ${evaluation.action_class} is every_call and cannot be Always`,
      );
    }
    return {
      outcome: "allow",
      run: true,
      persist_sticky: evaluation.action_class,
      disconnect: false,
    };
  }
  return {
    outcome: "allow",
    run: true,
    persist_sticky: null,
    disconnect: false,
  };
}
