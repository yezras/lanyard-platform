/**
 * Channel lead succession (lp-cxhb.9).
 *
 * When the lead leaves a channel with ≥2 members remaining, a picker
 * (LLM in production — injected via bindings, never called directly here)
 * chooses the successor from the channel log + remaining objectives.
 * Picker failure or timeout falls back to longest join time (picker
 * order tie-break). Removal never blocks on the model.
 */

export type SuccessionCandidate = {
  agent_id: string;
  name?: string;
  objective?: string;
  joined_at: string;
};

export type SuccessionLogEntry = {
  speaker: string | null;
  content: string;
};

export type SuccessionContext = {
  channel_name: string;
  log: SuccessionLogEntry[];
  /** Remaining members in picker order. */
  candidates: SuccessionCandidate[];
};

export type LeadSuccessionPicker = (
  context: SuccessionContext,
) => Promise<string | null | undefined> | string | null | undefined;

export const DEFAULT_LEAD_SUCCESSION_TIMEOUT_MS = 5_000;

/** Longest-serving candidate; equal joined_at keeps picker order. */
export function tenureSuccessorAgentId(
  candidates: readonly SuccessionCandidate[],
): string | null {
  let best: SuccessionCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.joined_at < best.joined_at) {
      best = candidate;
    }
  }
  return best?.agent_id ?? null;
}

/**
 * Resolve the next lead. The picker races a timeout; any failure, invalid
 * pick, or timeout falls back to tenure. Never throws; null only when no
 * candidates exist.
 */
export async function resolveLeadSuccessor(input: {
  picker?: LeadSuccessionPicker | null;
  context: SuccessionContext;
  timeoutMs?: number;
}): Promise<{ agent_id: string; source: "picker" | "tenure" } | null> {
  const { candidates } = input.context;
  if (candidates.length === 0) return null;

  if (input.picker) {
    const validIds = new Set(candidates.map((candidate) => candidate.agent_id));
    const timeoutMs =
      input.timeoutMs && input.timeoutMs > 0
        ? input.timeoutMs
        : DEFAULT_LEAD_SUCCESSION_TIMEOUT_MS;
    const attempt = (async () => await input.picker!(input.context))();
    const timer = new Promise<null>((resolve) => {
      const id = setTimeout(() => resolve(null), timeoutMs);
      id.unref?.();
    });
    let picked: string | null | undefined;
    try {
      picked = await Promise.race([attempt, timer]);
    } catch {
      picked = null;
    }
    if (typeof picked === "string" && validIds.has(picked)) {
      return { agent_id: picked, source: "picker" };
    }
  }

  const tenure = tenureSuccessorAgentId(candidates);
  return tenure ? { agent_id: tenure, source: "tenure" } : null;
}
