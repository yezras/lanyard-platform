/**
 * Offline bar + pie ChartSpec fixtures for chat timeline E2E/UI evidence (lp-a79.9).
 *
 * Shared by ChartBarPieProofStory, unit tests, and Playwright / CDP proof scripts.
 * Prefer this over duplicating JSON in multiple files.
 */

import type { ChartSpecCartesianV1, ChartSpecPieV1 } from "./types.js";

/** Q1 revenue vs cost — bar chart (cartesian). */
export const BAR_CHART_SPEC: ChartSpecCartesianV1 = {
  version: 1,
  type: "bar",
  title: "Q1 revenue vs cost",
  description: "Monthly comparison for the chat chart proof",
  xKey: "month",
  series: [
    { key: "revenue", label: "Revenue" },
    { key: "cost", label: "Cost" },
  ],
  data: [
    { month: "Jan", revenue: 120, cost: 80 },
    { month: "Feb", revenue: 150, cost: 95 },
    { month: "Mar", revenue: 180, cost: 110 },
  ],
  options: { showLegend: true, height: 280 },
};

/** Category share — pie chart. */
export const PIE_CHART_SPEC: ChartSpecPieV1 = {
  version: 1,
  type: "pie",
  title: "Spend by category",
  description: "Share of Q1 operating spend",
  nameKey: "name",
  valueKey: "value",
  data: [
    { name: "Infra", value: 40 },
    { name: "People", value: 35 },
    { name: "Tools", value: 25 },
  ],
  options: { showLegend: true, height: 280 },
};

/** JSON bodies for ```chart fences. */
export const BAR_CHART_JSON = JSON.stringify(BAR_CHART_SPEC);
export const PIE_CHART_JSON = JSON.stringify(PIE_CHART_SPEC);

/**
 * Intentionally invalid chart JSON (schema fail: data is not an array).
 * Used to prove error card + no crash on the chat path.
 */
export const INVALID_CHART_JSON =
  '{"version":1,"type":"bar","title":"Broken","data":"not-an-array"}';

/**
 * Assistant markdown: short prose + bar fence + pie fence + invalid fence.
 * Mirrors the real ChatMessageContent → ChatRichCodeBlock path.
 */
export const BAR_PIE_CHART_MARKDOWN = [
  "Here is the quarterly breakdown:",
  "",
  "```chart",
  BAR_CHART_JSON,
  "```",
  "",
  "And the share of spend:",
  "",
  "```chart",
  PIE_CHART_JSON,
  "```",
  "",
  "One fence failed validation (smoke for error UX):",
  "",
  "```chart",
  INVALID_CHART_JSON,
  "```",
].join("\n");
