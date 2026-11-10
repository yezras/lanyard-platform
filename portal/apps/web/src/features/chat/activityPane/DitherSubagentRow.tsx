import { motion } from "motion/react";

import { HStack } from "@astryxdesign/core/HStack";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";

import { DitherAvatar, DitherPattern, hueFromSeed } from "../DitherAvatar.js";
import {
  formatSubagentChipLabel,
  type SubagentRun,
} from "../subagentRun.js";

function DetailAvatar({ run, size }: { run: SubagentRun; size: number }) {
  const isRunning =
    run.status === "running" || run.status === "needs_input";
  return (
    <motion.span
      aria-hidden
      style={{ display: "inline-flex" }}
      animate={isRunning ? { scale: [0.96, 1.05, 0.96] } : { scale: 1 }}
      transition={
        isRunning
          ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.2 }
      }
    >
      <DitherAvatar seed={run.name} size={size} isRunning={isRunning} />
    </motion.span>
  );
}

export function DitherSubagentRow({
  run,
  isSelected,
  onSelect,
}: {
  run: SubagentRun;
  isSelected?: boolean;
  onSelect?: (run: SubagentRun) => void;
}) {
  const hue = hueFromSeed(run.name);
  const isRunning =
    run.status === "running" || run.status === "needs_input";
  return (
    <button
      type="button"
      data-testid="chat-subagent-roster-row"
      data-run-id={run.id}
      data-status={run.status}
      data-selected={isSelected ? "true" : "false"}
      aria-label={`Open subagent ${run.name} · ${run.status}`}
      onClick={() => onSelect?.(run)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        borderRadius: 8,
        border: isSelected
          ? "1px solid hsl(220 14% 86%)"
          : "1px solid transparent",
        background: isSelected ? "hsl(220 14% 96%)" : "transparent",
        cursor: "pointer",
        textAlign: "left" as const,
      }}
    >
      <motion.span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: `hsl(${hue} 70% 55%)`,
          border: `1px solid hsl(${hue} 70% 45%)`,
          display: "inline-flex",
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
        animate={isRunning ? { scale: [0.96, 1.05, 0.96] } : { scale: 1 }}
        transition={
          isRunning
            ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.2 }
        }
      >
        <span
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <DitherPattern seed={run.name} hue={hue} />
        </span>
        {isRunning ? (
          <span className="dither-avatar-pulse" aria-hidden />
        ) : null}
      </motion.span>
      <span
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Text type="label" weight="semibold" maxLines={1}>
          {run.name}
        </Text>
        <HStack gap={1} vAlign="center">
          <Text type="supporting" color="secondary" maxLines={1}>
            {formatSubagentChipLabel(run)}
          </Text>
          {isRunning ? (
            <Spinner size="sm" shade="subtle" aria-hidden />
          ) : null}
        </HStack>
      </span>
    </button>
  );
}

DitherSubagentRow.DetailAvatar = DetailAvatar;
