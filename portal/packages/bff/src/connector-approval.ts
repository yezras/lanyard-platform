/**
 * Connector tool.approval gate (lp-xhf4.9).
 *
 * Classifies argv via @lanyard/connectors. Sticky lives on the CP connection
 * row. Pending use is BFF-owned with a TTL. Reject never Disconnects.
 */
import { randomUUID } from "node:crypto";

import {
  IllegalApprovalDecisionError,
  IllegalStickyError,
  applyApprovalDecision,
  evaluateToolApproval,
  parseActionClass,
  parseApprovalDecision,
  parseConnectorSticky,
  setStickyFlag,
  type ActionClass,
  type ApprovalDecision,
  type ConnectorId,
  type ConnectorSticky,
  type ToolApprovalEvaluation,
} from "@lanyard/connectors";

export const PENDING_CONNECTOR_USE_TTL_MS = 15 * 60 * 1000;

export const TOOL_APPROVAL_PORTAL_EVENT = "tool.approval" as const;

export type PendingConnectorUse = {
  approval_id: string;
  tenant_id: string;
  user_id: string;
  thread_id: string | null;
  argv: string[];
  tool_name: string | null;
  tool_call_id: string | null;
  action_class: ActionClass | null;
  gate: ToolApprovalEvaluation["gate"];
  mapped: boolean;
  connector_id: ConnectorId | null;
  created_at: number;
  expires_at: number;
};

export class PendingConnectorUseStore {
  private readonly rows = new Map<string, PendingConnectorUse>();

  constructor(
    private readonly ttlMs: number = PENDING_CONNECTOR_USE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  put(
    input: Omit<PendingConnectorUse, "created_at" | "expires_at" | "approval_id"> & {
      approval_id?: string;
    },
  ): PendingConnectorUse {
    const created_at = this.now();
    const row: PendingConnectorUse = {
      ...input,
      approval_id: input.approval_id ?? randomUUID(),
      created_at,
      expires_at: created_at + this.ttlMs,
    };
    this.rows.set(row.approval_id, row);
    return row;
  }

  get(approvalId: string): PendingConnectorUse | null {
    const row = this.rows.get(approvalId);
    if (!row) {
      return null;
    }
    if (row.expires_at <= this.now()) {
      this.rows.delete(approvalId);
      return null;
    }
    return row;
  }

  delete(approvalId: string): void {
    this.rows.delete(approvalId);
  }
}

export function stickyFromConnection(
  sticky: unknown,
): ConnectorSticky {
  return parseConnectorSticky(sticky ?? {});
}

export function evaluatePendingCommand(
  argv: readonly string[],
  sticky: ConnectorSticky,
): ToolApprovalEvaluation {
  return evaluateToolApproval(argv, sticky);
}

export function decidePendingCommand(
  evaluation: ToolApprovalEvaluation,
  decision: unknown,
): ReturnType<typeof applyApprovalDecision> {
  return applyApprovalDecision(evaluation, parseApprovalDecision(decision));
}

export function patchStickyMap(
  sticky: ConnectorSticky,
  actionClass: string,
  enabled: boolean,
): ConnectorSticky {
  return setStickyFlag(sticky, parseActionClass(actionClass), enabled);
}

export { IllegalApprovalDecisionError, IllegalStickyError, parseApprovalDecision };

export type ApprovalEvaluateResult =
  | {
      outcome: "allow";
      run: true;
      portal_event: typeof TOOL_APPROVAL_PORTAL_EVENT;
      action_class: ActionClass;
      gate: "sticky";
      mapped: true;
      connector_id: ConnectorId;
    }
  | {
      outcome: "prompt";
      run: false;
      portal_event: typeof TOOL_APPROVAL_PORTAL_EVENT;
      approval_id: string;
      action_class: ActionClass | null;
      gate: ToolApprovalEvaluation["gate"];
      mapped: boolean;
      connector_id: ConnectorId | null;
      choices: { id: string; label: string }[];
      content: string;
    };

export function allowResult(
  evaluation: Extract<ToolApprovalEvaluation, { outcome: "allow" }>,
): ApprovalEvaluateResult {
  return {
    outcome: "allow",
    run: true,
    portal_event: TOOL_APPROVAL_PORTAL_EVENT,
    action_class: evaluation.action_class,
    gate: evaluation.gate,
    mapped: true,
    connector_id: evaluation.connector_id,
  };
}

export function promptResult(
  evaluation: Extract<ToolApprovalEvaluation, { outcome: "prompt" }>,
  approvalId: string,
): ApprovalEvaluateResult {
  return {
    outcome: "prompt",
    run: false,
    portal_event: TOOL_APPROVAL_PORTAL_EVENT,
    approval_id: approvalId,
    action_class: evaluation.action_class,
    gate: evaluation.gate,
    mapped: evaluation.mapped,
    connector_id: evaluation.connector_id,
    choices: evaluation.choices,
    content: evaluation.content,
  };
}

export type ApprovalDecideResult = {
  outcome: "allow" | "skip";
  run: boolean;
  disconnected: false;
  persist_sticky: ActionClass | null;
};

export function decideResult(
  applied: ReturnType<typeof applyApprovalDecision>,
): ApprovalDecideResult {
  return {
    outcome: applied.outcome,
    run: applied.run,
    disconnected: false,
    persist_sticky: applied.persist_sticky,
  };
}

export type ApprovalDecisionName = ApprovalDecision;
