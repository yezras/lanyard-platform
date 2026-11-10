/**
 * Timeline segment grouping for ChatToolCalls + subagent chips + workflows
 * (lp-dpr.3 / .5 / .7).
 *
 * Consecutive generic tool segments share one ChatToolCalls list.
 * Subagent and workflow rows break out as first-class groups (not collapsed
 * with tools). Reasoning segments break the group so CoT stays interleaved.
 */

import type {
  ChatTimelineToolCall,
  ChatTimelineTurnSegment,
} from "../../hooks/useChatEvents.js";

import {
  toolGroupDefaultExpanded,
  toolGroupSummaryLabel,
} from "./chatToolCallMapper.js";

export type SegmentRenderGroup =
  | {
      kind: "reasoning";
      key: string;
      content: string;
      isStreaming: boolean;
    }
  | {
      kind: "tools";
      key: string;
      calls: ChatTimelineToolCall[];
      /** Custom ChatToolCalls summary when many context reads. */
      label?: string;
      /** defaultIsExpanded for the ChatToolCalls group. */
      defaultIsExpanded: boolean;
    }
  | {
      /** First-class subagent chip (lp-dpr.5) — never mixed into tools groups. */
      kind: "subagent";
      key: string;
      call: ChatTimelineToolCall;
    }
  | {
      /** First-class workflow card (lp-dpr.7) — stages + nested subagents. */
      kind: "workflow";
      key: string;
      call: ChatTimelineToolCall;
    };

function isSubagentCall(call: ChatTimelineToolCall): boolean {
  return call.kind === "subagent";
}

function isWorkflowCall(call: ChatTimelineToolCall): boolean {
  return call.kind === "workflow";
}

/**
 * Group consecutive tool segments for a single ChatToolCalls list.
 * Subagent / workflow calls emit their own groups so UI can render cards.
 * Injects context-gathering collapse label when ≥3 consecutive reads/searches.
 */
export function groupSegmentsForRender(
  segments: ChatTimelineTurnSegment[],
  options?: { hasAnswer?: boolean; anyToolRunning?: boolean },
): SegmentRenderGroup[] {
  const groups: SegmentRenderGroup[] = [];
  const hasStagedWorkflow = segments.some(
    (segment) =>
      segment.kind === "tool" &&
      isWorkflowCall(segment.call) &&
      (segment.call.workflowStages?.length ?? 0) > 0,
  );
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      groups.push({
        kind: "reasoning",
        key: segment.key,
        content: segment.content,
        isStreaming: segment.isStreaming,
      });
      continue;
    }

    if (isWorkflowCall(segment.call)) {
      const empty = (segment.call.workflowStages?.length ?? 0) === 0;
      if (empty && hasStagedWorkflow) {
        continue;
      }
      groups.push({
        kind: "workflow",
        key: `workflow-${segment.call.key}`,
        call: segment.call,
      });
      continue;
    }

    if (isSubagentCall(segment.call)) {
      groups.push({
        kind: "subagent",
        key: `subagent-${segment.call.key}`,
        call: segment.call,
      });
      continue;
    }

    const last = groups[groups.length - 1];
    if (last?.kind === "tools") {
      last.calls.push(segment.call);
    } else {
      groups.push({
        kind: "tools",
        key: `tools-${segment.call.key}`,
        calls: [segment.call],
        defaultIsExpanded: true,
      });
    }
  }

  // Finalize labels / expand defaults after each tools group is complete.
  for (const group of groups) {
    if (group.kind !== "tools") {
      continue;
    }
    const label = toolGroupSummaryLabel(group.calls);
    if (label) {
      group.label = label;
    }
    const runningInGroup = group.calls.some(
      (c) => c.status === "running" || c.status === "pending",
    );
    group.defaultIsExpanded = toolGroupDefaultExpanded(group.calls, {
      hasAnswer: options?.hasAnswer,
      forceExpandWhileRunning: true,
    });
    // Mid-turn with any open tool elsewhere still expands for visibility.
    if (options?.anyToolRunning && runningInGroup) {
      group.defaultIsExpanded = true;
    }
  }

  return groups;
}
