/**
 * Chat chart surfaces (lp-a79).
 *
 * Spike (lp-a79.1): styling bridge + bar proof story.
 * ChartSpec parse (lp-a79.2): types + never-throw parser.
 * Vendor bar/line/area/pie (lp-a79.3).
 * PortalChartCard + palette mapper (lp-a79.4).
 * Lazy chart chunk (lp-a79.8): chat path must React.lazy PortalChartCard
 *   (see ChatRichCodeBlock) — do not static-import this barrel's PortalChartCard
 *   / Evil*Chart from the default chat shell.
 */

export type {
  ChartDataRow,
  ChartOptionsV1,
  ChartSeriesV1,
  ChartSpecCartesianV1,
  ChartSpecPieV1,
  ChartSpecV1,
  ChartSpecVersion,
  ChartTypeV1,
} from "./types.js";

export {
  parseChartSpec,
  type ParseChartSpecErr,
  type ParseChartSpecOk,
  type ParseChartSpecResult,
} from "./parseChartSpec.js";

export {
  CHART_HEIGHT_DEFAULT,
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  LANYARD_CHART_PALETTE,
  clampChartHeight,
  paletteColorAt,
} from "./palette.js";

export {
  mapSpecToEvilConfig,
  resolveChartOptions,
  type MappedEvilCartesian,
  type MappedEvilChart,
  type MappedEvilPie,
  type ResolvedChartOptions,
} from "./mapSpecToEvilConfig.js";

export {
  PortalChartCard,
  type PortalChartCardProps,
} from "./PortalChartCard.js";

export {
  ChartSpecErrorCard,
  type ChartSpecErrorCardProps,
} from "./ChartSpecErrorCard.js";

export { ChartBarProofStory } from "./ChartBarProofStory.js";
export { ChartBarPieProofStory } from "./ChartBarPieProofStory.js";
export {
  BAR_CHART_JSON,
  BAR_CHART_SPEC,
  BAR_PIE_CHART_MARKDOWN,
  INVALID_CHART_JSON,
  PIE_CHART_JSON,
  PIE_CHART_SPEC,
} from "./barPieChartFixture.js";

/** Vendored Evil Charts (recharts) — see evil/VENDOR.md */
export {
  EvilBarChart,
  EvilLineChart,
  EvilAreaChart,
  EvilPieChart,
} from "./evil/charts/index.js";

export type { ChartConfig } from "./evil/ui/recharts-chart.js";
