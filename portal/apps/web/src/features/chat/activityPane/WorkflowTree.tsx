/**
 * Activity pane body: workflow tree detail (lp-dpr.7).
 *
 * Focused workflow shows stage expand/collapse with nested subagents.
 * Also used as a compact tree when listing workflows on the roster.
 */

import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { SubagentRun } from "../subagentRun.js";
import { WorkflowRunCard } from "../WorkflowRunCard.js";
import {
  formatWorkflowCardLabel,
  type WorkflowRun,
} from "../workflowRun.js";

import type { ActivityPaneFocus } from "./types.js";

export type WorkflowTreeProps = {
  workflows: WorkflowRun[];
  subagents: SubagentRun[];
  focus: ActivityPaneFocus;
  onSelectWorkflow: (workflowId: string) => void;
  onSelectSubagent: (runId: string) => void;
  onShowRoster: () => void;
};

function focusedWorkflow(
  workflows: WorkflowRun[],
  focus: ActivityPaneFocus,
): WorkflowRun | null {
  if (focus.kind !== "workflow") {
    return null;
  }
  return workflows.find((w) => w.id === focus.workflowId) ?? null;
}

export function WorkflowTree({
  workflows,
  subagents,
  focus,
  onSelectWorkflow,
  onSelectSubagent,
  onShowRoster,
}: WorkflowTreeProps) {
  const selected = focusedWorkflow(workflows, focus);

  if (focus.kind === "workflow") {
    if (selected) {
      return (
        <VStack
          gap={3}
          data-testid="chat-workflow-detail"
          data-workflow-id={selected.id}
        >
          <HStack gap={2} vAlign="center">
            <Button
              label="Back to roster"
              tooltip="All activity"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={ArrowLeftIcon} size="sm" />}
              onClick={onShowRoster}
            />
            <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text type="label" weight="semibold" maxLines={1}>
                {selected.name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {formatWorkflowCardLabel(selected)}
              </Text>
            </VStack>
          </HStack>

          <WorkflowRunCard
            run={selected}
            subagents={subagents}
            variant="tree"
            isSelected
            onSubagentSelect={(run) => onSelectSubagent(run.id)}
          />
        </VStack>
      );
    }
    // Stale focus — fall through to list.
  }

  if (workflows.length === 0) {
    return (
      <VStack gap={2} data-testid="chat-workflow-tree-empty">
        <Text type="body" color="secondary">
          No workflow runs yet. When the host emits workflow_progress events,
          stages and nested subagents appear here.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack gap={2} data-testid="chat-workflow-tree">
      <Text type="supporting" color="secondary">
        {workflows.some((w) => w.status === "running" || w.status === "pending")
          ? "Active & recent workflows"
          : "Recent workflows"}
      </Text>
      {focus.kind === "workflow" && !selected ? (
        <Text type="supporting" color="secondary">
          Workflow {focus.workflowId} is no longer in this thread.
        </Text>
      ) : null}
      <VStack gap={2} style={{ width: "100%" }}>
        {workflows.map((run) => (
          <WorkflowRunCard
            key={run.id}
            run={run}
            subagents={subagents}
            variant="tree"
            isSelected={
              focus.kind === "workflow" && focus.workflowId === run.id
            }
            onSelect={(w) => onSelectWorkflow(w.id)}
            onSubagentSelect={(sa) => onSelectSubagent(sa.id)}
          />
        ))}
      </VStack>
    </VStack>
  );
}
