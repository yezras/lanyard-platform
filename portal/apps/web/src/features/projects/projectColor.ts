/**
 * Stable pastel-ish colors for project folders / composer chips.
 * Pure client mapping — no server storage.
 */

const PROJECT_PALETTE = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
  "#14B8A6", // teal
  "#6366F1", // indigo
  "#84CC16", // lime
  "#EF4444", // red
  "#A855F7", // purple
] as const;

/** Neutral gray for unscoped / "General" / no project. */
export const PROJECT_COLOR_NEUTRAL = "#94A3B8";

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Return a CSS color for a project id. Null / empty → neutral.
 * Same id always maps to the same color in a session (and forever).
 */
export function projectColor(projectId: string | null | undefined): string {
  if (!projectId) {
    return PROJECT_COLOR_NEUTRAL;
  }
  const index = hashId(projectId) % PROJECT_PALETTE.length;
  return PROJECT_PALETTE[index] ?? PROJECT_COLOR_NEUTRAL;
}
