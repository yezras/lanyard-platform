/** Semantic version of the wire schema — not the package version. */
export type ChartSpecVersion = 1;

export type ChartTypeV1 = "bar" | "line" | "area" | "pie";

/** One plotted series for cartesian charts (bar | line | area). */
export type ChartSeriesV1 = {
  /** Must match a key on each data row. */
  key: string;
  /** Legend / tooltip label. Defaults to key. */
  label?: string;
  /**
   * Optional CSS color. Prefer omitting so Portal applies brand palette.
   * Accepted for agent emphasis (e.g. "highlight this series in red").
   */
  color?: string;
};

export type ChartOptionsV1 = {
  /** Stack series (bar / area). Default false. */
  stacked?: boolean;
  /** Horizontal bars only. Default false. */
  horizontal?: boolean;
  /** Default true. */
  showLegend?: boolean;
  /** Default true for cartesian; ignored for pie. */
  showGrid?: boolean;
  /** Default true. */
  showTooltip?: boolean;
  /** Chart plot height in px. Clamped 160–480. Default 280. */
  height?: number;
};

/**
 * Discriminated by `type`.
 * Agent emits this as the sole content of a ```chart fence.
 */
export type ChartSpecV1 = ChartSpecCartesianV1 | ChartSpecPieV1;

type ChartSpecBaseV1 = {
  version: ChartSpecVersion; // must be 1
  title?: string;
  description?: string;
  data: ChartDataRow[];
  options?: ChartOptionsV1;
};

/** Row: string/number values only; nested objects rejected. */
export type ChartDataRow = Record<string, string | number | null>;

export type ChartSpecCartesianV1 = ChartSpecBaseV1 & {
  type: "bar" | "line" | "area";
  /** Category / independent axis key on each row. */
  xKey: string;
  /** At least one series. Keys must exist on rows (when non-null). */
  series: [ChartSeriesV1, ...ChartSeriesV1[]];
};

export type ChartSpecPieV1 = ChartSpecBaseV1 & {
  type: "pie";
  /** Slice label key. */
  nameKey: string;
  /** Slice value key (numeric). */
  valueKey: string;
  /**
   * Optional color list aligned to data order.
   * Prefer omit → Portal palette.
   */
  colors?: string[];
};
