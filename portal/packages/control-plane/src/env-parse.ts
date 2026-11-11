/**
 * Small env parsing helpers for orchestrator tuning knobs (lp-kng.6.7).
 *
 * Kept separate from server.ts so bootstrap-only code stays untestable-free
 * and these parses have offline unit coverage.
 */

/** Positive-int env value; undefined for unset / empty / invalid / ≤0. */
export function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
