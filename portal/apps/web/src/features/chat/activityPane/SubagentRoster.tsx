/**
 * Activity pane body: subagent roster + focused run detail
 * (lp-dpr.5 / .7 / lp-uxy.1 / lp-uxy.2).
 *
 * Lists concurrent/recent subagents with stable identity. Selecting a row
 * (or arriving via chip click with focus.kind=subagent) shows that run's
 * summary / result, nested live tool stream (when host attributes child
 * tool_progress with parent_subagent_id), and artifact chips for vault paths
 * produced by the run (host artifacts[] or nested-tool harvest).
 *
 * When workflows are present (lp-dpr.7), roster also lists them; workflow
 * focus is handled by WorkflowTree (ChatView switches on focus.kind).
 */

import type { MouseEvent } from "react";

import { ArrowLeftIcon, GlobeAltIcon } from "@heroicons/react/24/outline";
import { Button } from "@astryxdesign/core/Button";
import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import type { ChatTimelineToolCall } from "../../../hooks/useChatEvents.js";
import { fileTypeIcon } from "../../vault/fileTypeIcon.js";
import { citationDisplayTitle } from "../../vault/vaultPaths.js";

import { toChatToolCallItems } from "../ChatTimeline.js";
import {
  formatSubagentChipLabel,
  isTerminalSubagentStatus,
  resolveSubagentArtifacts,
  subagentStatusLabel,
  type SubagentArtifact,
  type SubagentRun,
} from "../subagentRun.js";
import { SubagentRunChip } from "../SubagentRunChip.js";
import { WorkflowRunCard } from "../WorkflowRunCard.js";
import { DitherSubagentRow } from "./DitherSubagentRow.js";
import type { WorkflowRun } from "../workflowRun.js";

import type { ActivityPaneFocus } from "./types.js";

export type SubagentRosterProps = {
  runs: SubagentRun[];
  focus: ActivityPaneFocus;
  onSelectRun: (runId: string) => void;
  onShowRoster: () => void;
  /** Optional workflow runs shown on roster (lp-dpr.7). */
  workflows?: WorkflowRun[];
  onSelectWorkflow?: (workflowId: string) => void;
  /**
   * Nested tool rows for the focused subagent (lp-uxy.1).
   * Parent should filter with collectNestedToolsForSubagent; unattributed
   * tools must not be passed here.
   */
  nestedTools?: ChatTimelineToolCall[];
  /**
   * Soft-open a vault path in the document pane (lp-uxy.2).
   * Web artifacts open externally and never call this.
   */
  onOpenArtifact?: (path: string) => void;
  /** Hermes project cwd — artifact chip titles relative when possible. */
  projectVaultPath?: string | null;
};

function focusedRun(
  runs: SubagentRun[],
  focus: ActivityPaneFocus,
): SubagentRun | null {
  if (focus.kind !== "subagent") {
    return null;
  }
  return runs.find((r) => r.id === focus.runId) ?? null;
}

function NestedToolStream({
  run,
  tools,
}: {
  run: SubagentRun;
  tools: ChatTimelineToolCall[];
}) {
  const terminal = isTerminalSubagentStatus(run.status);

  if (tools.length > 0) {
    return (
      <VStack gap={1} data-testid="chat-subagent-nested-tools">
        <Text type="supporting" color="secondary">
          Tools
        </Text>
        <div data-testid="chat-subagent-nested-tool-stream">
          <ChatToolCalls
            label={
              terminal
                ? `${tools.length} tool${tools.length === 1 ? "" : "s"}`
                : "Live tools"
            }
            defaultIsExpanded
            calls={toChatToolCallItems(tools)}
          />
        </div>
      </VStack>
    );
  }

  if (terminal) {
    return (
      <Text
        type="body"
        color="secondary"
        data-testid="chat-subagent-nested-tools-empty-complete"
      >
        No nested tools were reported for this run.
      </Text>
    );
  }

  return (
    <Text
      type="body"
      color="secondary"
      data-testid="chat-subagent-nested-tools-empty-running"
    >
      Nested tools will appear here as the subagent runs them.
    </Text>
  );
}

function artifactChipLabel(
  artifact: SubagentArtifact,
  projectVaultPath?: string | null,
): string {
  if (artifact.kind === "web") {
    return artifact.title?.trim() || artifact.path;
  }
  return citationDisplayTitle(
    artifact.path,
    projectVaultPath,
    artifact.title,
  );
}

/**
 * "Artifacts from this run" chips — vault soft-open, web opens externally.
 */
function SubagentArtifactsSection({
  artifacts,
  onOpenArtifact,
  projectVaultPath,
}: {
  artifacts: SubagentArtifact[];
  onOpenArtifact?: (path: string) => void;
  projectVaultPath?: string | null;
}) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <VStack gap={1} data-testid="chat-subagent-artifacts">
      <Text type="supporting" color="secondary">
        Artifacts from this run
      </Text>
      <HStack gap={1} wrap="wrap">
        {artifacts.map((artifact, index) => {
          const label = artifactChipLabel(artifact, projectVaultPath);
          const isWeb = artifact.kind === "web";
          const handleOpen = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (isWeb) {
              try {
                window.open(artifact.path, "_blank", "noopener,noreferrer");
              } catch {
                // ignore popup blockers
              }
              return;
            }
            onOpenArtifact?.(artifact.path);
          };
          // Wrapper carries data-* attributes because Token may not forward them.
          return (
            <span
              key={`${artifact.kind}:${artifact.path}`}
              data-testid={
                isWeb
                  ? `chat-subagent-artifact-web-${index + 1}`
                  : `chat-subagent-artifact-vault-${index + 1}`
              }
              data-artifact-path={artifact.path}
              data-artifact-kind={artifact.kind}
              onClick={handleOpen}
            >
              <Token
                size="sm"
                label={label}
                description={
                  isWeb
                    ? `Open ${label} in a new tab`
                    : `Open ${label} in document pane`
                }
                icon={
                  <Icon
                    icon={isWeb ? GlobeAltIcon : fileTypeIcon(artifact.path)}
                    size="xsm"
                  />
                }
                onClick={handleOpen}
              />
            </span>
          );
        })}
      </HStack>
    </VStack>
  );
}

function SubagentDetail({
  run,
  onBack,
  nestedTools = [],
  onOpenArtifact,
  projectVaultPath,
}: {
  run: SubagentRun;
  onBack: () => void;
  nestedTools?: ChatTimelineToolCall[];
  onOpenArtifact?: (path: string) => void;
  projectVaultPath?: string | null;
}) {
  const artifacts = resolveSubagentArtifacts(run.artifacts, nestedTools);
  return (
    <VStack gap={3} data-testid="chat-subagent-detail" data-run-id={run.id}>
      <HStack gap={2} vAlign="center">
        <Button
          label="Back to roster"
          tooltip="All subagents"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ArrowLeftIcon} size="sm" />}
          onClick={onBack}
        />
        <DitherSubagentRow.DetailAvatar run={run} size={22} />
        <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Text type="label" weight="semibold" maxLines={1}>
            {run.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {formatSubagentChipLabel(run)}
          </Text>
        </VStack>
      </HStack>

      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          Status
        </Text>
        <Text type="body" data-testid="chat-subagent-detail-status">
          {subagentStatusLabel(run.status)}
          {run.duration ? ` · ${run.duration}` : ""}
        </Text>
      </VStack>

      {run.summary ? (
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            Work
          </Text>
          <div
            data-testid="chat-subagent-detail-summary"
            style={{ wordBreak: "break-word", width: "100%" }}
          >
            <Markdown headingLevelStart={4} autolink="gfm" contentWidth="100%">
              {run.summary}
            </Markdown>
          </div>
        </VStack>
      ) : null}

      <SubagentArtifactsSection
        artifacts={artifacts}
        onOpenArtifact={onOpenArtifact}
        projectVaultPath={projectVaultPath}
      />

      <NestedToolStream run={run} tools={nestedTools} />

      {run.result ? (
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            Result
          </Text>
          <div
            data-testid="chat-subagent-detail-result"
            style={{ wordBreak: "break-word", width: "100%" }}
          >
            <Markdown headingLevelStart={4} autolink="gfm" contentWidth="100%">
              {run.result}
            </Markdown>
          </div>
        </VStack>
      ) : null}
    </VStack>
  );
}

export function SubagentRoster({
  runs,
  focus,
  onSelectRun,
  onShowRoster,
  workflows = [],
  onSelectWorkflow,
  nestedTools = [],
  onOpenArtifact,
  projectVaultPath,
}: SubagentRosterProps) {
  const selected = focusedRun(runs, focus);

  if (focus.kind === "subagent") {
    if (selected) {
      return (
        <SubagentDetail
          run={selected}
          onBack={onShowRoster}
          nestedTools={nestedTools}
          onOpenArtifact={onOpenArtifact}
          projectVaultPath={projectVaultPath}
        />
      );
    }
    // Focused id not in roster (stale) — fall through to list with notice.
  }

  if (runs.length === 0 && workflows.length === 0) {
    return (
      <VStack gap={2} data-testid="chat-subagent-roster-empty">
        <Text type="body" color="secondary">
          No agent activity yet. When the agent spawns subagents or runs
          workflows, they appear here with status and identity.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack gap={3} data-testid="chat-subagent-roster">
      {workflows.length > 0 ? (
        <VStack gap={2} data-testid="chat-workflow-roster-section">
          <Text type="supporting" color="secondary">
            {workflows.some(
              (w) => w.status === "running" || w.status === "pending",
            )
              ? "Active & recent workflows"
              : "Recent workflows"}
          </Text>
          <VStack gap={2} style={{ width: "100%" }}>
            {workflows.map((wf) => (
              <WorkflowRunCard
                key={wf.id}
                run={wf}
                subagents={runs}
                variant="tree"
                isSelected={
                  focus.kind === "workflow" && focus.workflowId === wf.id
                }
                onSelect={
                  onSelectWorkflow
                    ? (w) => onSelectWorkflow(w.id)
                    : undefined
                }
                onSubagentSelect={(r) => onSelectRun(r.id)}
              />
            ))}
          </VStack>
        </VStack>
      ) : null}

      {runs.length > 0 ? (
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            {runs.some(
              (r) => r.status === "running" || r.status === "needs_input",
            )
              ? "Active & recent subagents"
              : "Recent subagents"}
          </Text>
          {focus.kind === "subagent" && !selected ? (
            <Text
              type="supporting"
              color="secondary"
              data-testid="chat-subagent-stale-focus"
            >
              That subagent is no longer in this thread.
            </Text>
          ) : null}
          <VStack gap={1} style={{ width: "100%" }}>
            {runs.map((run) => (
              <DitherSubagentRow
                key={run.id}
                run={run}
                isSelected={focus.kind === "subagent" && focus.runId === run.id}
                onSelect={(r) => onSelectRun(r.id)}
              />
            ))}
          </VStack>
        </VStack>
      ) : null}
    </VStack>
  );
}
