/**
 * Inline workflow run card (lp-dpr.7 / lp-khq.9).
 *
 * Shows WorkflowRun with ordered stages (name, status, duration).
 * Stages expand/collapse; nested subagents render under expanded stages
 * as DitherAvatar + short name/status (aligned with header roster seed).
 * Clicking the card header opens the activity pane workflow tree;
 * nested avatar rows focus the activity pane on that subagent.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationCircleIcon,
  MinusCircleIcon,
  QueueListIcon,
} from "@heroicons/react/24/outline";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { ChatTimelineToolCall } from "../../hooks/useChatEvents.js";

import { DitherAvatar } from "./DitherAvatar.js";
import type { SubagentRun } from "./subagentRun.js";
import { subagentStatusLabel } from "./subagentRun.js";
import {
  defaultExpandedStageIds,
  formatWorkflowCardLabel,
  mapWorkflowRunFromToolCall,
  materializeStageSubagents,
  workflowStatusLabel,
  type WorkflowRun,
  type WorkflowStage,
  type WorkflowStageStatus,
} from "./workflowRun.js";

export type WorkflowRunCardProps = {
  run: WorkflowRun;
  /** Nested subagent roster used to resolve stage.subagentIds. */
  subagents?: readonly SubagentRun[];
  onSelect?: (run: WorkflowRun) => void;
  onSubagentSelect?: (run: SubagentRun) => void;
  /** Highlight when activity pane is focused on this workflow. */
  isSelected?: boolean;
  /** Controlled expand set; when omitted, card owns expand state. */
  expandedStageIds?: string[];
  onExpandedStageIdsChange?: (ids: string[]) => void;
  /** "card" for timeline; "tree" for activity pane density. */
  variant?: "card" | "tree";
};

function statusIcon(status: WorkflowStageStatus) {
  switch (status) {
    case "complete":
      return CheckCircleIcon;
    case "error":
      return ExclamationCircleIcon;
    case "skipped":
      return MinusCircleIcon;
    case "running":
    case "pending":
    default:
      return null;
  }
}

/**
 * Nested subagent under a workflow stage: dither avatar + short name/status.
 * Seed matches DitherAvatarRoster / activity roster (run.name).
 */
function NestedWorkflowSubagent({
  run,
  onSelect,
}: {
  run: SubagentRun;
  onSelect?: (run: SubagentRun) => void;
}) {
  const isRunning =
    run.status === "running" || run.status === "needs_input";
  const statusText = subagentStatusLabel(run.status);
  const elapsed = run.duration?.trim();
  const label = elapsed
    ? `${run.name} · ${statusText} ${elapsed}`
    : `${run.name} · ${statusText}`;

  return (
    <button
      type="button"
      className="chat-workflow-nested-subagent-btn"
      data-testid="chat-workflow-nested-subagent-btn"
      data-run-id={run.id}
      data-status={run.status}
      aria-label={`Subagent ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(run);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        maxWidth: "100%",
        padding: "0.22rem 0.45rem 0.22rem 0.22rem",
        borderRadius: "999px",
        border: "1px solid var(--color-border-subtle, #e2e8f0)",
        background: "var(--color-surface-raised, transparent)",
        cursor: onSelect ? "pointer" : "default",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
      }}
    >
      <DitherAvatar
        seed={run.name}
        size="sm"
        isRunning={isRunning}
        data-testid={`dither-avatar-${run.id}`}
      />
      <HStack
        gap={1}
        vAlign="center"
        style={{ minWidth: 0, flex: 1, flexWrap: "wrap" }}
      >
        <Text type="label" weight="semibold" maxLines={1}>
          {run.name}
        </Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          · {statusText}
          {elapsed ? ` ${elapsed}` : ""}
        </Text>
        {isRunning ? <Spinner size="sm" shade="subtle" aria-hidden /> : null}
      </HStack>
    </button>
  );
}

function StageRow({
  stage,
  allStages,
  workflowId,
  expanded,
  onToggle,
  subagents,
  onSubagentSelect,
  depth = 0,
}: {
  stage: WorkflowStage;
  allStages: readonly WorkflowStage[];
  workflowId: string;
  expanded: boolean;
  onToggle: () => void;
  subagents: SubagentRun[];
  onSubagentSelect?: (run: SubagentRun) => void;
  depth?: number;
}) {
  // Host nest + dual-emit roster win; unresolved ids still show helper name/status.
  const nested = materializeStageSubagents(
    stage,
    allStages,
    subagents,
    { workflowId },
  );
  const IconCmp = statusIcon(stage.status);
  const isActive = stage.status === "running";

  return (
    <VStack
      gap={1}
      data-testid="chat-workflow-stage"
      data-stage-id={stage.id}
      data-status={stage.status}
      data-expanded={expanded ? "true" : "false"}
      style={{
        width: "100%",
        paddingInlineStart: depth > 0 ? "0.5rem" : 0,
      }}
    >
      <button
        type="button"
        className="chat-workflow-stage-header"
        data-testid="chat-workflow-stage-toggle"
        aria-expanded={expanded}
        aria-label={`${stage.name}, ${workflowStatusLabel(stage.status)}${
          stage.duration ? `, ${stage.duration}` : ""
        }`}
        onClick={(event) => {
          event.stopPropagation();
          // Always allow toggle so empty stages still expand for summary.
          onToggle();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          width: "100%",
          padding: "0.3rem 0.4rem",
          border: "none",
          borderRadius: "0.35rem",
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <Icon
          icon={expanded ? ChevronDownIcon : ChevronRightIcon}
          size="xsm"
          color="secondary"
          aria-hidden
        />
        {isActive ? (
          <Spinner size="sm" shade="subtle" aria-hidden />
        ) : IconCmp ? (
          <Icon
            icon={IconCmp}
            size="xsm"
            color={stage.status === "error" ? "danger" : "secondary"}
            aria-hidden
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              border: "1.5px solid var(--color-border-subtle, #cbd5e1)",
              flexShrink: 0,
            }}
          />
        )}
        <Text type="label" weight="medium" maxLines={1} style={{ flex: 1 }}>
          {stage.name}
        </Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          {workflowStatusLabel(stage.status)}
          {stage.duration ? ` · ${stage.duration}` : ""}
        </Text>
      </button>

      {expanded ? (
        <VStack
          gap={1}
          data-testid="chat-workflow-stage-body"
          style={{
            width: "100%",
            paddingInlineStart: "1.25rem",
            paddingBottom: "0.25rem",
          }}
        >
          {stage.summary ? (
            <Text
              type="supporting"
              color="secondary"
              data-testid="chat-workflow-stage-summary"
            >
              {stage.summary}
            </Text>
          ) : null}
          {nested.length > 0
            ? nested.map((run) => (
                <div
                  key={run.id}
                  className="chat-workflow-nested-subagent"
                  data-testid="chat-workflow-nested-subagent"
                >
                  <NestedWorkflowSubagent
                    run={run}
                    onSelect={onSubagentSelect}
                  />
                </div>
              ))
            : null}
          {(stage.toolCallIds?.length ?? 0) > 0 && nested.length === 0 ? (
            <Text type="supporting" color="secondary">
              {stage.toolCallIds!.length} tool
              {stage.toolCallIds!.length === 1 ? "" : "s"} in stage
            </Text>
          ) : null}
          {!stage.summary &&
          nested.length === 0 &&
          !(stage.toolCallIds?.length ?? 0) ? (
            <Text type="supporting" color="secondary">
              No nested activity yet
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}

export function WorkflowRunCard({
  run,
  subagents = [],
  onSelect,
  onSubagentSelect,
  isSelected = false,
  expandedStageIds: controlledExpanded,
  onExpandedStageIdsChange,
  variant = "card",
}: WorkflowRunCardProps) {
  const defaultIds = useMemo(() => defaultExpandedStageIds(run), [run]);
  const [uncontrolled, setUncontrolled] = useState<string[]>(defaultIds);

  // When the run identity or stage set changes, re-seed expand defaults.
  useEffect(() => {
    if (controlledExpanded !== undefined) {
      return;
    }
    setUncontrolled(defaultExpandedStageIds(run));
    // Only re-seed when stage ids / statuses change substantially.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run.id + stage signature
  }, [
    run.id,
    run.stages.map((s) => `${s.id}:${s.status}`).join("|"),
    controlledExpanded,
  ]);

  const expandedIds =
    controlledExpanded !== undefined ? controlledExpanded : uncontrolled;

  const setExpanded = (ids: string[]) => {
    if (controlledExpanded === undefined) {
      setUncontrolled(ids);
    }
    onExpandedStageIdsChange?.(ids);
  };

  const toggleStage = (stageId: string) => {
    if (expandedIds.includes(stageId)) {
      setExpanded(expandedIds.filter((id) => id !== stageId));
    } else {
      setExpanded([...expandedIds, stageId]);
    }
  };

  const label = formatWorkflowCardLabel(run);
  const isActive = run.status === "running" || run.status === "pending";

  const cardStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    width: variant === "tree" ? "100%" : "min(100%, 28rem)",
    maxWidth: "100%",
    padding: variant === "tree" ? "0.5rem 0.65rem" : "0.55rem 0.75rem",
    borderRadius: "0.65rem",
    border: isSelected
      ? "1px solid var(--color-border-focus, #3b82f6)"
      : "1px solid var(--color-border-subtle, #e2e8f0)",
    background: isSelected
      ? "var(--color-surface-selected, rgba(59, 130, 246, 0.08))"
      : "var(--color-surface-raised, transparent)",
    cursor: onSelect ? "pointer" : "default",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  };

  const handleHeaderActivate = () => {
    onSelect?.(run);
  };

  const handleHeaderKeyDown = (event: ReactKeyboardEvent) => {
    if (!onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(run);
    }
  };

  return (
    <div
      className={
        variant === "tree" ? "chat-workflow-run-tree" : "chat-workflow-run-card"
      }
      data-testid={
        variant === "tree"
          ? "chat-workflow-run-tree"
          : "chat-workflow-run-card"
      }
      data-workflow-id={run.id}
      data-status={run.status}
      data-selected={isSelected ? "true" : "false"}
      style={cardStyle}
    >
      <div
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        className="chat-workflow-run-header"
        data-testid="chat-workflow-run-header"
        aria-label={`Workflow ${label}`}
        onClick={handleHeaderActivate}
        onKeyDown={handleHeaderKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          minWidth: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: "var(--color-accent-subtle, #dbeafe)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "var(--color-accent, #2563eb)",
          }}
        >
          <Icon icon={QueueListIcon} size="xsm" color="inherit" />
        </span>
        <HStack
          gap={1}
          vAlign="center"
          style={{ minWidth: 0, flex: 1, flexWrap: "wrap" }}
        >
          <Text type="label" weight="semibold" maxLines={1}>
            {run.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            · {workflowStatusLabel(run.status)}
            {run.stages.length > 0
              ? ` · ${
                  run.stages.filter(
                    (s) =>
                      s.status === "complete" || s.status === "skipped",
                  ).length
                }/${run.stages.length}`
              : ""}
            {run.duration ? ` · ${run.duration}` : ""}
          </Text>
          {isActive ? <Spinner size="sm" shade="subtle" aria-hidden /> : null}
        </HStack>
      </div>

      {run.summary ? (
        <Text
          type="supporting"
          color="secondary"
          maxLines={2}
          data-testid="chat-workflow-run-summary"
        >
          {run.summary}
        </Text>
      ) : null}

      {run.stages.length > 0 ? (
        <VStack
          gap={0}
          data-testid="chat-workflow-stage-list"
          style={{ width: "100%" }}
        >
          {run.stages.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              allStages={run.stages}
              workflowId={run.id}
              expanded={expandedIds.includes(stage.id)}
              onToggle={() => toggleStage(stage.id)}
              subagents={[...subagents]}
              onSubagentSelect={onSubagentSelect}
            />
          ))}
        </VStack>
      ) : (
        <Text type="supporting" color="secondary">
          Waiting for stages…
        </Text>
      )}
    </div>
  );
}

/** Convenience: build card from a timeline tool call. */
export function WorkflowRunCardFromCall({
  call,
  subagents,
  onSelect,
  onSubagentSelect,
  isSelected,
  variant,
}: {
  call: ChatTimelineToolCall;
  subagents?: readonly SubagentRun[];
  onSelect?: (run: WorkflowRun) => void;
  onSubagentSelect?: (run: SubagentRun) => void;
  isSelected?: boolean;
  variant?: "card" | "tree";
}) {
  const run = mapWorkflowRunFromToolCall(call);
  if (!run) {
    return null;
  }
  return (
    <WorkflowRunCard
      run={run}
      subagents={subagents}
      onSelect={onSelect}
      onSubagentSelect={onSubagentSelect}
      isSelected={isSelected}
      variant={variant}
    />
  );
}
