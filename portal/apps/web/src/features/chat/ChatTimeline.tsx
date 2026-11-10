import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Button } from "@astryxdesign/core/Button";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";

import type { McqChoice } from "../../api/types.js";
import type { HistorySpeaker, ThreadKind } from "../../api/types.js";
import type {
  ChatTimelineAssistantTurn,
  ChatTimelineItem,
  ChatTimelineSystemNoticeItem,
  ChatTimelineToolCall,
  ChatTimelineTurnSegment,
  ChatTimelineUserItem,
} from "../../hooks/useChatEvents.js";
import { ConnectorQrBubble } from "./ConnectorQrBubble.js";
import { ConnectorOAuthCard } from "./ConnectorOAuthCard.js";
import { ConnectorCliCard } from "./ConnectorCliCard.js";

import {
  planChannelRows,
  type ChannelBubbleGroup,
  type ChannelRowPlan,
} from "./channelTranscript.js";
import { ChatMessageContent } from "./ChatMessageContent.js";
import {
  humanToolActivityLabel,
  looksLikeTechnicalToolId,
  shouldHideToolTargetInDefaultUi,
} from "./chatToolCallMapper.js";
import { groupSegmentsForRender } from "./chatTimelineGrouping.js";
import { DitherAvatar } from "./DitherAvatar.js";
import { ChatSpeakerHoverCard } from "./ChatSpeakerHoverCard.js";
import {
  DocumentReopenChipBar,
  type DocumentReopenChip,
} from "./documentPane/index.js";
import { SubagentRunChipFromCall } from "./SubagentRunChip.js";
import {
  mapSubagentRunFromToolCall,
  type SubagentRun,
} from "./subagentRun.js";
import {
  AgentStartingStatus,
  shouldShowAgentStartingStatus,
} from "./AgentStartingStatus.js";
import { AGENT_STARTING_MESSAGE } from "./agentStarting.js";
import {
  shouldShowThinkingPulse,
  ThinkingPulse,
} from "./ThinkingPulse.js";
import {
  inferWebSearchProvider,
  isWebBrowseToolName,
  isWebSearchToolName,
  parseWebSearchResults,
} from "./webCitations.js";
import { WebSearchResultsList } from "./WebSearchResults.js";
import { WorkflowRunCardFromCall } from "./WorkflowRunCard.js";
import type { WorkflowRun } from "./workflowRun.js";
import { SourceStack } from "./SourceStack.js";
import { DitherAvatarRoster } from "./DitherAvatarRoster.js";
import {
  collectStackedSources,
  filterToolsForCondensed,
} from "./condensedHeader.js";
import { ChatSpeakerLabel } from "./GroupRoomRoster.js";

// Re-export pure grouping helpers for unit tests (lp-dpr.3 / lp-dpr.5 / .7).
export { groupSegmentsForRender } from "./chatTimelineGrouping.js";
export type { SegmentRenderGroup } from "./chatTimelineGrouping.js";

/** Infer CodeBlock language for tool resultDetail. */
export function inferToolResultLanguage(
  result: string,
  toolName: string,
): string {
  const trimmed = result.trimStart();
  if (
    trimmed.startsWith("---") ||
    trimmed.startsWith("+++") ||
    trimmed.startsWith("diff ")
  ) {
    return "diff";
  }
  const name = toolName.toLowerCase();
  if (
    name === "bash" ||
    name === "terminal" ||
    name === "shell" ||
    name.includes("terminal") ||
    name === "running a command"
  ) {
    return "bash";
  }
  if (
    name === "edit" ||
    name === "write" ||
    name === "read" ||
    name.includes("file") ||
    name.startsWith("reading ") ||
    name.startsWith("writing ") ||
    name.startsWith("editing ")
  ) {
    return "typescript";
  }
  return "text";
}

/**
 * Resolve default ChatToolCalls display fields (lp-vnz.9).
 * Friendly verbs in the row; technical id / argv only in advanced detail.
 * Also used by SubagentDetail nested tool stream (lp-uxy.1).
 */
export function resolveChatToolCallDisplay(call: ChatTimelineToolCall): {
  name: string;
  target?: string;
  technicalName?: string;
  hideTarget: boolean;
} {
  // Subagent / workflow rows keep identity titles (chips/cards use name).
  if (call.kind === "subagent" || call.kind === "workflow") {
    return {
      name: call.name,
      target: call.target,
      technicalName: call.technicalName,
      hideTarget: false,
    };
  }

  const technicalName =
    call.technicalName?.trim() ||
    (looksLikeTechnicalToolId(call.name) ? call.name.trim() : undefined);

  const name = technicalName
    ? call.technicalName
      ? call.name
      : humanToolActivityLabel(technicalName)
    : humanToolActivityLabel(call.name);

  const hideTarget = shouldHideToolTargetInDefaultUi(
    technicalName ?? call.name,
    { toolKind: call.kind },
  );

  return {
    name,
    target: hideTarget ? undefined : call.target,
    technicalName:
      technicalName && technicalName !== name ? technicalName : call.technicalName,
    hideTarget,
  };
}

/**
 * Map timeline tool calls → Astryx ChatToolCallItem list.
 * Shared by the main spine and SubagentDetail nested stream (lp-uxy.1).
 */
export function toChatToolCallItems(
  calls: ChatTimelineToolCall[],
): ChatToolCallItem[] {
  if (!Array.isArray(calls) || calls.length === 0) {
    return [];
  }
  const out: ChatToolCallItem[] = [];
  for (const call of calls) {
    // Per-tool isolation (lp-uxy.11): one corrupt nested tool/result must not
    // blank the whole ChatToolCalls group after hydrate.
    try {
      if (!call || typeof call !== "object") {
        continue;
      }
      if (isMailboxSendToolCall(call)) {
        continue;
      }
      const display = resolveChatToolCallDisplay(call);
      const item: ChatToolCallItem = {
        key: call.key || `tool-${out.length}`,
        name: display.name || "Tool",
        status: call.status ?? "complete",
      };
      if (display.target) {
        item.target = display.target;
      }
      if (call.duration) {
        item.duration = call.duration;
      }
      if (call.errorMessage) {
        item.errorMessage = call.errorMessage;
      }
      if (typeof call.additions === "number") {
        item.additions = call.additions;
      }
      if (typeof call.deletions === "number") {
        item.deletions = call.deletions;
      }
      if (call.node) {
        item.node = call.node;
      }

      const technicalName = display.technicalName?.trim();
      const hiddenTarget =
        display.hideTarget && call.target?.trim() ? call.target.trim() : "";
      // Cap render body so multi-MB results do not freeze CodeBlock after reload.
      const rawResult = call.result?.trim() || "";
      const resultBody =
        rawResult.length > 48_000
          ? `${rawResult.slice(0, 48_000)}\n…[truncated ${rawResult.length - 48_000} chars]`
          : rawResult;

      // Structured search / Firecrawl / X results → card list (lp-uxy.7).
      // Prefer result JSON; also accept metadata.search_results (host-structured).
      const probeName = technicalName || call.name;
      const isWebTool =
        isWebSearchToolName(probeName) || isWebBrowseToolName(probeName);
      const structuredResults = isWebTool
        ? parseWebSearchResults(
            {
              result: call.result,
              metadata: call.metadata,
              provider: inferWebSearchProvider(probeName),
            },
            { max: 12 },
          )
        : [];
      const hasStructured = structuredResults.length > 0;

      const showAdvanced = Boolean(
        (technicalName && technicalName !== display.name) ||
          hiddenTarget ||
          resultBody ||
          hasStructured,
      );

      if (showAdvanced) {
        const language =
          call.resultLanguage?.trim() ||
          inferToolResultLanguage(
            resultBody || hiddenTarget,
            technicalName || call.name,
          );
        const heading = isWebBrowseToolName(probeName)
          ? "Page content"
          : "Search results";
        item.resultDetail = (
          <div data-testid="chat-tool-call-advanced">
            {technicalName && technicalName !== display.name ? (
              <Text type="supporting" color="secondary">
                {technicalName}
              </Text>
            ) : null}
            {hiddenTarget ? (
              <CodeBlock code={hiddenTarget} language="bash" maxHeight="50vh" />
            ) : null}
            {hasStructured ? (
              <WebSearchResultsList
                results={structuredResults}
                heading={heading}
              />
            ) : resultBody ? (
              <CodeBlock
                code={resultBody}
                language={language}
                maxHeight="50vh"
              />
            ) : null}
          </div>
        );
      }
      out.push(item);
    } catch {
      out.push({
        key: call?.key || `tool-fallback-${out.length}`,
        name: call?.name?.trim() || "Tool",
        status: call?.status ?? "complete",
        ...(call?.errorMessage
          ? { errorMessage: call.errorMessage }
          : { errorMessage: "Could not display tool details" }),
      });
    }
  }
  return out;
}

/**
 * Isolate a single timeline item render so one bad turn/tool tree cannot
 * unmount the whole chat (hard-reload blank after multi-subagent) — lp-uxy.11.
 */
class TimelineItemErrorBoundary extends Component<
  { itemKey: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        `[ChatTimeline] item render failed (${this.props.itemKey}):`,
        error,
      );
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ChatMessage sender="assistant">
          <ChatMessageBubble variant="ghost">
            <Text
              type="supporting"
              color="secondary"
              data-testid="chat-timeline-item-error"
            >
              Could not display this message
            </Text>
          </ChatMessageBubble>
        </ChatMessage>
      );
    }
    return this.props.children;
  }
}

/**
 * Inline content-only boundary — does not wrap ChatMessage so mid-turn
 * subagent chips / tools stay visible when the final answer (e.g. chart fence)
 * throws during render (lp-uxy.11).
 */
class AnswerContentErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[ChatTimeline] answer content render failed:", error);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Text
          type="supporting"
          color="secondary"
          data-testid="chat-timeline-answer-error"
        >
          Could not display this answer
        </Text>
      );
    }
    return this.props.children;
  }
}

function ReasoningBlock({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  // Expanded while streaming; collapse by default once the final answer lands.
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    setIsOpen(isStreaming);
  }, [isStreaming]);

  return (
    <Collapsible
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <Text type="body" color="secondary">
          {isStreaming ? "Thinking…" : "Thought process"}
        </Text>
      }
    >
      {/* Reasoning arrives as full upsert chunks; skip Markdown isStreaming fade. */}
      <ChatMessageContent content={content} />
    </Collapsible>
  );
}

function userMetadataStatus(
  status: ChatTimelineUserItem["status"],
): "sending" | "error" | undefined {
  if (status === "sending" || status === "error") {
    return status;
  }
  // Omit quiet "sent" so successful messages stay clean.
  return undefined;
}

function parseMailboxSentNotice(
  content: string,
): { name: string; text: string } | null {
  const match = /^Sent to ([^\n]+)\n?([\s\S]*)$/.exec(content.trim());
  const name = match?.[1]?.trim();
  if (!name) return null;
  return { name, text: (match[2] ?? "").trim() };
}

function isMailboxSendToolCall(call: ChatTimelineToolCall): boolean {
  const probe = [call.technicalName, call.name, call.key]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (probe.includes("mailbox.send") || probe.includes("mailbox_send")) {
    return true;
  }
  const meta = call.metadata;
  return Boolean(meta && typeof meta === "object" && "mailbox_send" in meta);
}

function isMailboxSendOnlyTurn(item: ChatTimelineAssistantTurn): boolean {
  if (item.content?.trim()) return false;
  if (item.reasoning?.content?.trim()) return false;
  const fromSegments = (item.segments ?? [])
    .filter(
      (seg): seg is Extract<ChatTimelineTurnSegment, { kind: "tool" }> =>
        Boolean(seg) && seg.kind === "tool" && Boolean(seg.call),
    )
    .map((seg) => seg.call);
  const tools = fromSegments.length > 0 ? fromSegments : (item.toolCalls ?? []);
  return tools.length > 0 && tools.every(isMailboxSendToolCall);
}

function MailboxDelimiterBand({
  kind,
  name,
  text,
}: {
  kind: "sent" | "received";
  name: string;
  text?: string;
}) {
  const label = kind === "sent" ? `Sent to ${name}` : `Received from ${name}`;
  return (
    <div
      data-testid="mailbox-hop-band"
      data-mailbox-band={kind}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 16px",
        minWidth: 0,
        gap: 4,
      }}
    >
      <Text type="supporting" color="secondary">
        {label}
      </Text>
      {text ? (
        <div style={{ whiteSpace: "pre-wrap", textAlign: "center" }}>
          <Text type="body">{text}</Text>
        </div>
      ) : null}
    </div>
  );
}

function SystemNoticeLine({ item }: { item: ChatTimelineSystemNoticeItem }) {
  const sent = parseMailboxSentNotice(item.content);
  if (sent) {
    return (
      <div data-testid="system-notice">
        <MailboxDelimiterBand kind="sent" name={sent.name} text={sent.text} />
      </div>
    );
  }
  return (
    <div
      data-testid="system-notice"
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "8px 16px",
        minWidth: 0,
      }}
    >
      <Text type="supporting" color="secondary">
        {item.content}
      </Text>
    </div>
  );
}

function UserBubble({
  item,
  onRetry,
}: {
  item: ChatTimelineUserItem;
  onRetry?: (userMessageId: string) => void;
}) {
  // Model is immutable per bubble (stamped at send); never re-bind live settings.
  const modelLabel = item.model?.trim() || undefined;
  const status = userMetadataStatus(item.status);
  const showRetry = item.status === "error" && Boolean(onRetry);

  const footer =
    modelLabel || showRetry ? (
      <HStack gap={1} align="center">
        {showRetry ? (
          <Button
            label="Retry"
            tooltip="Retry"
            variant="ghost"
            size="sm"
            isIconOnly
            icon={<Icon icon={ArrowPathIcon} size="sm" />}
            onClick={() => onRetry?.(item.id)}
          />
        ) : null}
        {modelLabel ? (
          <Text type="supporting" color="secondary">
            {modelLabel}
          </Text>
        ) : null}
      </HStack>
    ) : undefined;

  const hasMetadata = Boolean(
    item.createdAt || footer || status,
  );

  const bubble = (
    <ChatMessage key={item.id} sender="user">
      <ChatMessageBubble
        metadata={
          hasMetadata ? (
            <ChatMessageMetadata
              timestamp={
                item.createdAt ? (
                  <Timestamp value={item.createdAt} format="time" />
                ) : undefined
              }
              footer={footer}
              status={status}
            />
          ) : undefined
        }
      >
        <ChatMessageContent content={item.content} tokenized />
      </ChatMessageBubble>
    </ChatMessage>
  );

  if (!item.speaker) {
    return bubble;
  }
  return (
    <div
      className="chat-turn"
      data-testid={`chat-turn-${item.speaker.kind}-${item.speaker.id}`}
      data-speaker-kind={item.speaker.kind}
    >
      <ChatSpeakerLabel speaker={item.speaker} />
      {bubble}
    </div>
  );
}

/**
 * Channel transcript row shell (lp-cxhb.15.3): WhatsApp/iMessage grouping.
 * Dither avatar gutter + sender name only on the first row of a speaker run;
 * group position drives Astryx bubble corner tightening. Keeps the historical
 * chat-turn-{kind}-{id} testid so lac-bx3 proof-story semantics survive.
 */
function ChannelRowShell({
  itemKey,
  plan,
  speaker,
  children,
}: {
  itemKey: string;
  plan: ChannelRowPlan;
  speaker?: HistorySpeaker;
  children: ReactNode;
}) {
  return (
    <div
      className="chat-channel-row"
      data-testid={
        speaker
          ? `chat-turn-${speaker.kind}-${speaker.id}`
          : `chat-turn-local-${itemKey}`
      }
      data-channel-item={itemKey}
      data-channel-group={plan.group ?? "single"}
      data-channel-side={plan.side}
      {...(speaker ? { "data-speaker-kind": speaker.kind } : {})}
    >
      {plan.showGutter && speaker ? (
        <span className="chat-channel-gutter">
          <DitherAvatar
            seed={speaker.id}
            size="sm"
            label={speaker.display_name}
            data-testid={`chat-channel-avatar-${speaker.kind}-${speaker.id}`}
          />
        </span>
      ) : null}
      <div className="chat-channel-body">
        {plan.showName && speaker ? (
          <ChatSpeakerHoverCard speaker={speaker}>
            <Text
              type="label"
              weight="semibold"
              color="secondary"
              maxLines={1}
              className="chat-channel-name"
              data-testid={`chat-speaker-${speaker.kind}-${speaker.id}`}
            >
              {speaker.display_name}
            </Text>
          </ChatSpeakerHoverCard>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Channel user send: filled bubble, time + delivered receipt, right-aligned. */
function ChannelUserBubble({
  item,
  plan,
}: {
  item: ChatTimelineUserItem;
  plan: ChannelRowPlan;
}) {
  const status =
    item.status === "sending"
      ? ("sending" as const)
      : item.status === "error"
        ? ("error" as const)
        : ("delivered" as const);
  return (
    <ChannelRowShell itemKey={item.id} plan={plan} speaker={item.speaker}>
      <ChatMessage sender="user">
        <ChatMessageBubble
          group={plan.group}
          metadata={
            <ChatMessageMetadata
              timestamp={
                item.createdAt ? (
                  <Timestamp value={item.createdAt} format="time" />
                ) : undefined
              }
              status={status}
            />
          }
        >
          <ChatMessageContent content={item.content} tokenized />
        </ChatMessageBubble>
      </ChatMessage>
    </ChannelRowShell>
  );
}

/**
 * Resolve ordered mid-turn segments. Prefer `segments` (SoT); fall back to
 * legacy reasoning + toolCalls bags so older fixtures still render.
 */
function resolveTurnSegments(
  item: ChatTimelineAssistantTurn,
): ChatTimelineTurnSegment[] {
  if (item.segments && item.segments.length > 0) {
    // Drop malformed segments so a corrupt tool row cannot crash render.
    return item.segments.filter((seg) => {
      if (!seg || typeof seg !== "object") return false;
      if (seg.kind === "reasoning") return Boolean(seg.key);
      if (seg.kind === "tool") {
        return Boolean(seg.call && seg.call.key) && !isMailboxSendToolCall(seg.call);
      }
      return false;
    });
  }
  const legacy: ChatTimelineTurnSegment[] = [];
  if (item.reasoning?.content) {
    legacy.push({
      kind: "reasoning",
      key: "legacy-reasoning",
      content: item.reasoning.content,
      isStreaming: item.reasoning.isStreaming,
    });
  }
  for (const call of item.toolCalls ?? []) {
    if (call && typeof call === "object" && call.key && !isMailboxSendToolCall(call)) {
      legacy.push({ kind: "tool", call });
    }
  }
  return legacy;
}

/** Collect subagent runs from this turn for workflow stage nesting. */
function subagentsFromTurn(item: ChatTimelineAssistantTurn): SubagentRun[] {
  const runs: SubagentRun[] = [];
  const seen = new Set<string>();
  try {
    const source = item.segments?.length
      ? item.segments
          .filter(
            (s): s is Extract<ChatTimelineTurnSegment, { kind: "tool" }> =>
              Boolean(s) && s.kind === "tool" && Boolean(s.call),
          )
          .map((s) => s.call)
      : (item.toolCalls ?? []);
    for (const call of source) {
      if (!call || typeof call !== "object") continue;
      try {
        const run = mapSubagentRunFromToolCall(call);
        if (run && !seen.has(run.id)) {
          seen.add(run.id);
          runs.push(run);
        }
      } catch {
        // Skip corrupt tool row (lp-uxy.11).
      }
    }
  } catch {
    return runs;
  }
  return runs;
}

function AssistantTurnBubble({
  item,
  onCitationClick,
  onSubagentSelect,
  onWorkflowSelect,
  onSourceSelect,
  projectVaultPath,
  channel = false,
  channelGroup,
}: {
  item: ChatTimelineAssistantTurn;
  onCitationClick?: (path: string) => void;
  onSubagentSelect?: (run: SubagentRun) => void;
  onWorkflowSelect?: (run: WorkflowRun) => void;
  onSourceSelect?: (sources: import("./SourceStack.js").StackedSource[], selectedUrl?: string) => void;
  projectVaultPath?: string | null;
  /** Channel transcript mode (lp-cxhb.15.3): identity chrome, no model/copy/regenerate. */
  channel?: boolean;
  channelGroup?: ChannelBubbleGroup;
}) {
  // Defensive defaults so partial/corrupt hydrate state still paints (lp-uxy.11).
  const safeItem: ChatTimelineAssistantTurn = {
    ...item,
    id: item.id || "assistant-unknown",
    content: typeof item.content === "string" ? item.content : "",
    toolCalls: Array.isArray(item.toolCalls) ? item.toolCalls : [],
    segments: Array.isArray(item.segments) ? item.segments : item.segments,
  };
  if (!channel && safeItem.mailboxInbound) {
    const name =
      safeItem.mailboxInbound.from_display_name.trim() ||
      safeItem.speaker?.display_name?.trim() ||
      "teammate";
    return (
      <MailboxDelimiterBand
        kind="received"
        name={name}
        text={safeItem.content}
      />
    );
  }
  const segments = resolveTurnSegments(safeItem);
  const turnSubagents = subagentsFromTurn(safeItem);
  // When finished, quoted sources in chat stream drive the header count (not raw tool calls)
  const citedSourcesForHeader: import("./SourceStack.js").StackedSource[] = (() => {
    if (!safeItem.citations?.length) return [];
    try {
      const webCits = safeItem.citations.filter((c) => {
        try {
          const u = c.path?.trim();
          return u && /^https?:\/\//i.test(u);
        } catch { return false; }
      });
      if (webCits.length === 0) return [];
      const seen = new Set<string>();
      const out: import("./SourceStack.js").StackedSource[] = [];
      for (const c of webCits) {
        const url = c.path.trim();
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({
          url,
          title: c.title?.trim() || (() => { try { return new URL(url).hostname.replace(/^www\./,""); } catch { return url; }})(),
          description: c.snippet?.trim() || undefined,
          provider: undefined,
        });
      }
      return out;
    } catch { return []; }
  })();
  const stackedSourcesFromTools = (() => {
    try {
      const allCalls = segments
        .filter(
          (s): s is Extract<ChatTimelineTurnSegment, { kind: "tool" }> =>
            s.kind === "tool" && Boolean(s.call)
        )
        .map((s) => s.call);
      const calls = allCalls.length > 0 ? allCalls : (safeItem.toolCalls ?? []);
      return collectStackedSources(calls as never, { max: 16 });
    } catch {
      return [];
    }
  })();
  const hasAnswer = Boolean(safeItem.content);
  const isFinished = Boolean(hasAnswer && !safeItem.isStreaming);
  const stackedSources = isFinished && citedSourcesForHeader.length > 0 ? citedSourcesForHeader : stackedSourcesFromTools;
  const hasCondensedSources = stackedSources.length > 0;
  const hasCondensedAvatars = turnSubagents.length > 0;
  const hasCondensedHeader = hasCondensedSources || hasCondensedAvatars;
  const sourcesDisplayMax = isFinished ? 3 : 4;
  let anyToolRunning = false;
  try {
    anyToolRunning = segments.some((seg) => {
      try {
        return (
          seg.kind === "tool" &&
          Boolean(seg.call) &&
          (seg.call.status === "running" || seg.call.status === "pending")
        );
      } catch {
        return false;
      }
    });
  } catch {
    anyToolRunning = false;
  }
  let renderGroups: ReturnType<typeof groupSegmentsForRender> = [];
  try {
    renderGroups = groupSegmentsForRender(segments, {
      hasAnswer,
      anyToolRunning,
    });
  } catch {
    renderGroups = [];
  }
  const hasMidTurn = !channel && renderGroups.length > 0;
  const showPulse = shouldShowThinkingPulse({
    isStreaming: safeItem.isStreaming,
    hasAnswer,
  });

  // Timestamp only. Model name, Copy, and Regenerate stay off both 1:1 and
  // channels so the thread reads as one conversation (lp-bhcg.22).
  const metadata =
    !safeItem.isStreaming && safeItem.createdAt ? (
      <ChatMessageMetadata
        timestamp={<Timestamp value={safeItem.createdAt} format="time" />}
      />
    ) : undefined;

  const bubble = (
    <ChatMessage key={safeItem.id} sender="assistant">
      {/* lp-cxhb.15.4: channels hide the tool/activity dump (source stack +
          subagent avatars) — chat text only; 1:1 keeps the condensed header. */}
      {!channel && hasCondensedHeader ? (
        <div
          className="chat-condensed-header"
          data-testid="chat-condensed-header"
          data-has-sources={hasCondensedSources ? "true" : "false"}
          data-has-avatars={hasCondensedAvatars ? "true" : "false"}
          data-any-tool-running={anyToolRunning ? "true" : "false"}
        >
          {hasCondensedSources ? (
            <SourceStack
              sources={stackedSources}
              max={sourcesDisplayMax}
              onSourceSelect={(url) => {
                if (!url) onSourceSelect?.(stackedSources, undefined);
                else onSourceSelect?.(stackedSources, url);
              }}
              onOverflowSelect={() => onSourceSelect?.(stackedSources, undefined)}
            />
          ) : null}
          {hasCondensedSources && hasCondensedAvatars ? (
            <span className="chat-condensed-divider" aria-hidden />
          ) : null}
          {hasCondensedAvatars ? (
            <DitherAvatarRoster runs={turnSubagents} onSelect={onSubagentSelect} />
          ) : null}
        </div>
      ) : null}
      {/* Web search/browse tool calls are fully hidden behind header source icons; details live in side-pane SourcesRoster, not inline pill */}
      {/* lp-cxhb.15.4: channels render chat text only — tool calls, reasoning,
          subagent chips and workflow cards are suppressed; data flow (segments,
          streaming state) stays intact for 1:1 and activity panes. */}
      {!channel &&
        renderGroups.map((group, index) => {
        const isFirst = index === 0;
        // When the thinking pulse trails mid-turn groups, it owns "last".
        const isLastMid =
          index === renderGroups.length - 1 && !hasAnswer && !showPulse;
        const aloneMid =
          renderGroups.length === 1 && !hasAnswer && !showPulse;
        const groupPos = aloneMid
          ? undefined
          : isFirst
            ? "first"
            : isLastMid
              ? "last"
              : "middle";

        if (group.kind === "reasoning") {
          return (
            <ChatMessageBubble
              key={group.key}
              variant="ghost"
              group={groupPos}
            >
              <ReasoningBlock
                content={group.content}
                isStreaming={group.isStreaming}
              />
            </ChatMessageBubble>
          );
        }

        if (group.kind === "subagent") {
          if (hasCondensedHeader) return null;
          return (
            <div
              key={group.key}
              className="chat-subagent-chip-wrap"
              data-testid="chat-subagent-chip-wrap"
            >
              <SubagentRunChipFromCall
                call={group.call}
                onSelect={onSubagentSelect}
              />
            </div>
          );
        }

        if (group.kind === "workflow") {
          return (
            <div
              key={group.key}
              className="chat-workflow-card-wrap"
              data-testid="chat-workflow-card-wrap"
            >
              <WorkflowRunCardFromCall
                call={group.call}
                subagents={turnSubagents}
                onSelect={onWorkflowSelect}
                onSubagentSelect={onSubagentSelect}
              />
            </div>
          );
        }

        {
          const filteredCalls = hasCondensedSources
            ? filterToolsForCondensed(group.calls)
            : group.calls;
          if (filteredCalls.length === 0) return null;
          // When header hides web_search, filtered empty already returned null; keep generic tools visible inline
          return (
            <ChatToolCalls
              key={group.key}
              label={group.label}
              defaultIsExpanded={group.defaultIsExpanded}
              calls={toChatToolCallItems(filteredCalls)}
            />
          );
        }
      })}

      {hasAnswer ? (
        <ChatMessageBubble
          /* Filled ChatMessageBubble, same treatment as user rows (lp-bhcg.22). */
          group={
            hasMidTurn
              ? "last"
              : channel
                ? channelGroup
                : undefined
          }
          metadata={metadata}
        >
          {/*
            Content-scoped boundary (lp-uxy.11): chart / markdown render throws
            must not replace mid-turn subagent chips + tools with the whole-turn
            fallback. ChartFenceErrorBoundary is primary; this is defense in depth.
          */}
          <AnswerContentErrorBoundary>
            <ChatMessageContent
              content={safeItem.content}
              isStreaming={safeItem.isStreaming}
              citations={safeItem.citations}
              onCitationClick={onCitationClick}
              onSourceSelect={(sources, selectedUrl) => {
                const stacked: import("./SourceStack.js").StackedSource[] = sources.map((s) => ({
                  url: s.url,
                  title: s.title ?? s.url,
                }));
                const toOpen = sources.length > 0 ? stacked : stackedSources;
                const sel = selectedUrl && selectedUrl.trim() ? selectedUrl : undefined;
                onSourceSelect?.(toOpen.length > 0 ? toOpen : stackedSources, sel);
              }}
              projectVaultPath={projectVaultPath}
            />
          </AnswerContentErrorBoundary>
        </ChatMessageBubble>
      ) : null}

      {/*
        Inter-tool / pre-answer thinking pulse (lp-95v.6).
        Replaces the static "Thinking…" ghost; not a tool-call row.
      */}
      {showPulse ? (
        <ChatMessageBubble variant="ghost" group={hasMidTurn ? "last" : undefined}>
          <ThinkingPulse />
        </ChatMessageBubble>
      ) : null}
    </ChatMessage>
  );

  if (!safeItem.speaker || channel) {
    return bubble;
  }
  return (
    <div
      className="chat-turn"
      data-testid={`chat-turn-${safeItem.speaker.kind}-${safeItem.speaker.id}`}
      data-speaker-kind={safeItem.speaker.kind}
    >
      <ChatSpeakerLabel speaker={safeItem.speaker} />
      {bubble}
    </div>
  );
}

type ChatTimelineProps = {
  items: ChatTimelineItem[];
  /** @deprecated Prefer durable toolCalls on assistant_turn items. */
  toolProgress?: string | null;
  /**
   * Cold-wake “Agent starting…” (lp-6ty). Shown after the latest user bubble
   * while ensure_online is in flight and no assistant turn is open yet.
   */
  agentStarting?: boolean;
  /** Override starting copy (default Agent starting…). */
  agentStartingMessage?: string;
  onMcqSelect: (input: {
    mcqId: string;
    choice: McqChoice;
    promptMessageId?: string;
  }) => void;
  onToolApprovalSelect?: (input: {
    approvalId: string;
    choice: McqChoice;
  }) => void;
  onCitationClick?: (path: string) => void;
  /** Resend a failed user message (error status). */
  onRetryUserMessage?: (userMessageId: string) => void;
  /**
   * Subagent chip click (lp-dpr.5) — open activity pane focused on that run.
   */
  onSubagentSelect?: (run: SubagentRun) => void;
  /**
   * Workflow card click (lp-dpr.7) — open activity pane focused on that run.
   */
  onWorkflowSelect?: (run: WorkflowRun) => void;
  onSourceSelect?: (sources: import("./SourceStack.js").StackedSource[], selectedUrl?: string) => void;
  /** Hermes project cwd — used to resolve relative citation paths for vault. */
  projectVaultPath?: string | null;
  /**
   * Durable reopen chips for documents opened in this thread (lp-a8u.2).
   * Survive pane close; click reopens preview for that path.
   */
  documentReopenChips?: readonly DocumentReopenChip[];
  /** Reopen chip click → document pane (preview). */
  onDocumentReopenClick?: (path: string) => void;
  /**
   * Thread product kind (lp-cxhb.15.3). When "group", the transcript renders
   * as WhatsApp/iMessage-style grouped bubbles with dither avatars. 1:1
   * turns use the same filled ChatMessageBubble as user rows (lp-bhcg.22).
   */
  threadKind?: ThreadKind;
};

export function ChatTimeline({
  items,
  toolProgress = null,
  agentStarting = false,
  agentStartingMessage = AGENT_STARTING_MESSAGE,
  onMcqSelect,
  onToolApprovalSelect,
  onCitationClick,
  onRetryUserMessage,
  onSubagentSelect,
  onWorkflowSelect,
  onSourceSelect,
  projectVaultPath,
  documentReopenChips,
  onDocumentReopenClick,
  threadKind,
}: ChatTimelineProps) {
  const safeItems = Array.isArray(items) ? items : [];
  const isChannel = threadKind === "group";
  const channelPlans = isChannel ? planChannelRows(safeItems) : [];
  return (
    <ChatMessageList>
      {safeItems.map((item, index) => {
        const itemKey =
          item && typeof item === "object"
            ? item.type === "mcq"
              ? `mcq-${item.mcqId || index}`
              : item.type === "tool_approval"
                ? `tool-approval-${item.approvalId || index}`
                : item.type === "connector.qr"
                  ? `connector-qr-${item.pairingId || index}`
                  : item.type === "connector.oauth"
                    ? `connector-oauth-${item.connectorId}-${index}`
                    : item.type === "connector.cli"
                      ? `connector-cli-${item.connectorId}-${index}`
              : item.type === "user" ||
                  item.type === "assistant_turn" ||
                  item.type === "assistant" ||
                  item.type === "reasoning" ||
                  item.type === "system_notice"
                ? `${item.type}-${item.id || index}`
                : `item-${index}`
            : `item-${index}`;

        let body: ReactNode = null;
        try {
          if (!item || typeof item !== "object" || !("type" in item)) {
            body = null;
          } else if (item.type === "system_notice") {
            body = <SystemNoticeLine item={item} />;
          } else if (item.type === "user") {
            body =
              isChannel && channelPlans[index] ? (
                <ChannelUserBubble
                  item={item}
                  plan={channelPlans[index]}
                />
              ) : (
                <UserBubble item={item} onRetry={onRetryUserMessage} />
              );
          } else if (item.type === "assistant_turn") {
            if (isMailboxSendOnlyTurn(item)) {
              body = null;
            } else {
              const plan = isChannel ? channelPlans[index] : undefined;
              if (plan) {
                body = (
                  <ChannelRowShell
                    itemKey={item.id || `turn-${index}`}
                    plan={plan}
                    speaker={item.speaker}
                  >
                    <AssistantTurnBubble
                      item={item}
                      onCitationClick={onCitationClick}
                      channel
                      channelGroup={plan.group}
                      onSubagentSelect={onSubagentSelect}
                      onWorkflowSelect={onWorkflowSelect}
                      onSourceSelect={onSourceSelect}
                      projectVaultPath={projectVaultPath}
                    />
                  </ChannelRowShell>
                );
              } else {
                body = (
                  <AssistantTurnBubble
                    item={item}
                    onCitationClick={onCitationClick}
                    onSubagentSelect={onSubagentSelect}
                    onWorkflowSelect={onWorkflowSelect}
                    onSourceSelect={onSourceSelect}
                    projectVaultPath={projectVaultPath}
                  />
                );
              }
            }
          } else if (item.type === "reasoning") {
            // Legacy standalone reasoning (pre–assistant_turn).
            // lp-cxhb.15.4: channels show chat text only — no reasoning rows.
            body = isChannel ? null : (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ReasoningBlock
                    content={item.content}
                    isStreaming={item.isStreaming}
                  />
                </ChatMessageBubble>
              </ChatMessage>
            );
          } else if (item.type === "assistant") {
            // Legacy standalone assistant message.
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble
                  metadata={
                    !item.isStreaming && item.createdAt ? (
                      <ChatMessageMetadata
                        timestamp={
                          <Timestamp value={item.createdAt} format="time" />
                        }
                      />
                    ) : undefined
                  }
                >
                  <ChatMessageContent
                    content={item.content}
                    isStreaming={item.isStreaming}
                    citations={item.citations}
                    onCitationClick={onCitationClick}
                    projectVaultPath={projectVaultPath}
                  />
                </ChatMessageBubble>
                {/* lp-cxhb.15.4: channels hide legacy tool dumps too. */}
                {!isChannel && item.toolCalls?.length ? (
                  <ChatToolCalls
                    defaultIsExpanded
                    calls={toChatToolCallItems(item.toolCalls)}
                  />
                ) : null}
              </ChatMessage>
            );
          } else if (item.type === "connector.qr") {
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ConnectorQrBubble
                    pairingId={item.pairingId}
                    code={item.code}
                    phase={item.phase}
                    message={item.message}
                  />
                </ChatMessageBubble>
              </ChatMessage>
            );
          } else if (item.type === "connector.oauth") {
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ConnectorOAuthCard
                    connectorId={item.connectorId}
                    phase={item.phase}
                    accountLabel={item.accountLabel}
                  />
                </ChatMessageBubble>
              </ChatMessage>
            );
          } else if (item.type === "connector.cli") {
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ConnectorCliCard
                    deviceCode={item.deviceCode}
                    command={item.command}
                    status={item.status}
                  />
                </ChatMessageBubble>
              </ChatMessage>
            );
          } else if (item.type === "mcq") {
            const choices = Array.isArray(item.choices) ? item.choices : [];
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ChatMessageContent content={item.content} />
                  <HStack gap={1} wrap="wrap" className="chat-mcq-choices">
                    {choices.map((choice) => {
                      const isSelected = item.selectedChoiceId === choice.id;
                      return (
                        <Button
                          key={choice.id}
                          label={choice.label}
                          variant={isSelected ? "primary" : "secondary"}
                          size="sm"
                          isDisabled={item.disabled}
                          onClick={() =>
                            onMcqSelect({
                              mcqId: item.mcqId,
                              choice,
                              promptMessageId: item.messageId,
                            })
                          }
                        />
                      );
                    })}
                  </HStack>
                </ChatMessageBubble>
              </ChatMessage>
            );
          } else if (item.type === "tool_approval") {
            const choices = Array.isArray(item.choices) ? item.choices : [];
            body = (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">
                  <ChatMessageContent content={item.content} />
                  <HStack
                    gap={1}
                    wrap="wrap"
                    className="chat-tool-approval-choices"
                    data-testid="tool-approval-bubble"
                    data-approval-id={item.approvalId}
                    data-gate={item.gate}
                    data-action-class={item.actionClass ?? ""}
                  >
                    {choices.map((choice) => {
                      const isSelected = item.selectedChoiceId === choice.id;
                      return (
                        <Button
                          key={choice.id}
                          label={choice.label}
                          variant={isSelected ? "primary" : "secondary"}
                          size="sm"
                          isDisabled={item.disabled}
                          onClick={() =>
                            onToolApprovalSelect?.({
                              approvalId: item.approvalId,
                              choice,
                            })
                          }
                        />
                      );
                    })}
                  </HStack>
                </ChatMessageBubble>
              </ChatMessage>
            );
          }
        } catch {
          body = (
            <ChatMessage sender="assistant">
              <ChatMessageBubble variant="ghost">
                <Text
                  type="supporting"
                  color="secondary"
                  data-testid="chat-timeline-item-error"
                >
                  Could not display this message
                </Text>
              </ChatMessageBubble>
            </ChatMessage>
          );
        }

        if (!body) {
          return null;
        }

        // lp-uxy.11: assistant_turn already isolates answer content (and mid-turn
        // chips/tools sit outside AnswerContentErrorBoundary). An outer item
        // boundary replaces chips+tools with "Could not display this message"
        // when recharts throws in useLayoutEffect (not catchable by inner
        // boundaries). Skip outer wrap for assistant turns.
        if (item.type === "assistant_turn") {
          return <div key={itemKey}>{body}</div>;
        }

        return (
          <TimelineItemErrorBoundary key={itemKey} itemKey={itemKey}>
            {body}
          </TimelineItemErrorBoundary>
        );
      })}
      {/* lp-cxhb.15.4: no running-tool activity row in channels. */}
      {toolProgress && !isChannel ? (
        <ChatMessage sender="assistant">
          <ChatToolCalls
            defaultIsExpanded
            calls={[
              {
                name: "tool",
                target: toolProgress,
                status: "running",
              },
            ]}
          />
        </ChatMessage>
      ) : null}
      {shouldShowAgentStartingStatus({
        agentStarting,
        hasOpenAssistantTurn: items.some(
          (item) =>
            item.type === "assistant_turn" &&
            (item.isStreaming || !item.content),
        ),
      }) ? (
        <ChatMessage sender="assistant">
          <ChatMessageBubble variant="ghost">
            <AgentStartingStatus message={agentStartingMessage} />
          </ChatMessageBubble>
        </ChatMessage>
      ) : null}
      {documentReopenChips &&
      documentReopenChips.length > 0 &&
      onDocumentReopenClick ? (
        <DocumentReopenChipBar
          chips={documentReopenChips}
          onOpen={onDocumentReopenClick}
          projectVaultPath={projectVaultPath}
        />
      ) : null}
    </ChatMessageList>
  );
}
