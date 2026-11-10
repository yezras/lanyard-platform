/**
 * Lanyard brand palette for chart series / pie slices.
 * Order applied when agent omits `color` / `colors` (plan § Brand palette).
 *
 * Bead: lp-a79.4
 */

/** Ordered default series colors (cycle when series count exceeds length). */
export const LANYARD_CHART_PALETTE = [
  "#0047ab", // primary
  "#4f81bd", // supporting
  "#000080", // navy
  "#0d9488", // teal accent
  "#b45309", // amber
  "#be123c", // rose
  "#6d28d9", // violet
  "#374151", // neutral
] as const;

export type LanyardChartPaletteColor = (typeof LANYARD_CHART_PALETTE)[number];

/** Plot height defaults (aligned with parseChartSpec clamps). */
export const CHART_HEIGHT_MIN = 160;
export const CHART_HEIGHT_MAX = 480;
export const CHART_HEIGHT_DEFAULT = 280;

/**
 * Pick the Nth brand color (0-based), wrapping after palette end.
 */
export function paletteColorAt(index: number): string {
  const i =
    Number.isFinite(index) && index >= 0
      ? Math.floor(index) % LANYARD_CHART_PALETTE.length
      : 0;
  return LANYARD_CHART_PALETTE[i]!;
}

/**
 * Clamp plot height to 160–480; default 280 when missing/invalid.
 */
export function clampChartHeight(height: number | undefined | null): number {
  if (height === undefined || height === null || !Number.isFinite(height)) {
    return CHART_HEIGHT_DEFAULT;
  }
  return Math.min(CHART_HEIGHT_MAX, Math.max(CHART_HEIGHT_MIN, Math.round(height)));
}
