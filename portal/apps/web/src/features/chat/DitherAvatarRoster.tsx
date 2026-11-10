import { motion } from "motion/react";

import { DitherPattern, hueFromSeed } from "./DitherAvatar.js";
import type { SubagentRun } from "./subagentRun.js";

export function DitherAvatarRoster({
  runs,
  onSelect,
  max = 7,
}: {
  runs: SubagentRun[];
  onSelect?: (run: SubagentRun) => void;
  max?: number;
}) {
  if (!runs || runs.length === 0) return null;
  const visible = runs.slice(0, max);
  const overflow = runs.length - visible.length;

  return (
    <div
      className="dither-avatar-roster"
      data-testid="dither-avatar-roster"
      aria-label={`${runs.length} agents`}
    >
      <div className="dither-avatar-stack" data-testid="dither-avatar-stack">
        {visible.map((run) => {
          const hue = hueFromSeed(run.name);
          const isRunning =
            run.status === "running" || run.status === "needs_input";
          return (
            <motion.button
              key={run.id}
              type="button"
              className="dither-avatar"
              data-testid={`dither-avatar-${run.id}`}
              data-run-id={run.id}
              data-run-status={run.status}
              aria-label={`Open agent ${run.name} — ${run.status}`}
              title={`${run.name} · ${run.status}`}
              onClick={() => onSelect?.(run)}
              style={{
                background: `hsl(${hue} 70% 55%)`,
                borderColor: `hsl(${hue} 70% 45%)`,
              }}
              animate={
                isRunning
                  ? { scale: [0.96, 1.05, 0.96], opacity: [0.9, 1, 0.9] }
                  : { scale: 1, opacity: 1 }
              }
              transition={
                isRunning
                  ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="dither-avatar-inner" aria-hidden>
                <DitherPattern seed={run.name} hue={hue} />
              </span>
              {isRunning ? (
                <span className="dither-avatar-pulse" aria-hidden />
              ) : null}
            </motion.button>
          );
        })}
        {overflow > 0 ? (
          <span
            className="dither-avatar-overflow"
            data-testid="dither-avatar-overflow"
            aria-label={`${overflow} more agents`}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="dither-avatar-label" data-testid="dither-avatar-label">
        {runs.length === 1 ? "1 agent" : `${runs.length} agents`}
      </span>
    </div>
  );
}
