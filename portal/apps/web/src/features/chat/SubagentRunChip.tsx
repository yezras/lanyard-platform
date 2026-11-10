/**
 * Inline subagent run chip (lp-dpr.5).
 *
 * Renders distinct from generic ChatToolCalls: colored icon +
 * "Explore · running 0:42". Click focuses the activity pane on this run.
 */

import {
  useEffect,
  useState,
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
} from "react";

import {
  BeakerIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  MapIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";

import type { ChatTimelineToolCall } from "../../hooks/useChatEvents.js";

import {
  formatSubagentChipLabel,
  formatSubagentElapsed,
  mapSubagentRunFromToolCall,
  subagentStatusLabel,
  type SubagentIconKey,
  type SubagentRun,
} from "./subagentRun.js";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

const ICON_MAP: Record<SubagentIconKey, HeroIcon> = {
  explore: MagnifyingGlassIcon,
  research: MagnifyingGlassIcon,
  code: CodeBracketIcon,
  write: DocumentTextIcon,
  test: BeakerIcon,
  plan: MapIcon,
  browser: GlobeAltIcon,
  default: SparklesIcon,
};

/** Resolve icon component for a SubagentRun icon key. */
export function subagentIconComponent(key: SubagentIconKey): HeroIcon {
  return ICON_MAP[key] ?? UserGroupIcon;
}

export type SubagentRunChipProps = {
  run: SubagentRun;
  onSelect?: (run: SubagentRun) => void;
  /** Highlight when activity pane is focused on this run. */
  isSelected?: boolean;
  /** "chip" for timeline; "row" for roster list density. */
  variant?: "chip" | "row";
};

function useLiveNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export function SubagentRunChip({
  run,
  onSelect,
  isSelected = false,
  variant = "chip",
}: SubagentRunChipProps) {
  const tickLive =
    run.status === "running" && !run.duration && Boolean(run.startedAt);
  const now = useLiveNow(tickLive);
  const label = formatSubagentChipLabel(run, now);
  const elapsed = formatSubagentElapsed(run, now);
  const statusText = subagentStatusLabel(run.status);
  const IconCmp = subagentIconComponent(run.icon);
  const isActive =
    run.status === "running" || run.status === "needs_input";

  const chipStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    maxWidth: "100%",
    padding: variant === "row" ? "0.45rem 0.65rem" : "0.28rem 0.55rem",
    borderRadius: variant === "row" ? "0.5rem" : "999px",
    border: `1px solid ${run.color}33`,
    background: isSelected
      ? `${run.color}22`
      : variant === "row"
        ? "var(--color-surface-raised, transparent)"
        : `${run.color}14`,
    cursor: onSelect ? "pointer" : "default",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    width: variant === "row" ? "100%" : undefined,
  };

  const handleClick = () => {
    onSelect?.(run);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(run);
    }
  };

  return (
    <button
      type="button"
      className={
        variant === "row" ? "chat-subagent-run-row" : "chat-subagent-run-chip"
      }
      data-testid={
        variant === "row"
          ? "chat-subagent-roster-row"
          : "chat-subagent-run-chip"
      }
      data-run-id={run.id}
      data-status={run.status}
      data-selected={isSelected ? "true" : "false"}
      aria-label={`Subagent ${label}`}
      aria-pressed={isSelected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={chipStyle}
    >
      <span
        aria-hidden
        className="chat-subagent-run-swatch"
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: run.color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "#fff",
        }}
      >
        <Icon icon={IconCmp} size="xsm" color="inherit" />
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
          · {statusText}
          {elapsed ? ` ${elapsed}` : ""}
        </Text>
        {isActive ? <Spinner size="sm" shade="subtle" aria-hidden /> : null}
      </HStack>
      {variant === "row" && run.summary ? (
        <Text
          type="supporting"
          color="secondary"
          maxLines={1}
          style={{ marginInlineStart: "auto", maxWidth: "40%" }}
        >
          {run.summary}
        </Text>
      ) : null}
    </button>
  );
}

/** Convenience: build chip from a timeline tool call. */
export function SubagentRunChipFromCall({
  call,
  onSelect,
  isSelected,
  variant,
}: {
  call: ChatTimelineToolCall;
  onSelect?: (run: SubagentRun) => void;
  isSelected?: boolean;
  variant?: "chip" | "row";
}) {
  const run = mapSubagentRunFromToolCall(call);
  if (!run) {
    return null;
  }
  return (
    <SubagentRunChip
      run={run}
      onSelect={onSelect}
      isSelected={isSelected}
      variant={variant}
    />
  );
}
