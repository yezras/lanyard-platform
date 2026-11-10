/**
 * Map ChartSpecV1 → Evil Charts ChartConfig + resolved layout flags.
 *
 * Bead: lp-a79.4
 * Plan: docs/plans/0009-portal-chat-charts/overview.md § PortalChartCard API
 */

import type { ChartConfig } from "./evil/ui/recharts-chart.js";
import {
  clampChartHeight,
  paletteColorAt,
} from "./palette.js";
import type {
  ChartOptionsV1,
  ChartSeriesV1,
  ChartSpecCartesianV1,
  ChartSpecPieV1,
  ChartSpecV1,
} from "./types.js";

/** Dual theme color arrays (v1 light-only; dark mirrors light so Evil validation passes). */
function dualThemeColors(color: string): {
  light: string[];
  dark: string[];
} {
  return {
    light: [color],
    dark: [color],
  };
}

function seriesColor(series: ChartSeriesV1, index: number): string {
  if (typeof series.color === "string" && series.color.trim()) {
    return series.color.trim();
  }
  return paletteColorAt(index);
}

function buildCartesianConfig(spec: ChartSpecCartesianV1): ChartConfig {
  const config: ChartConfig = {};
  spec.series.forEach((s, index) => {
    config[s.key] = {
      label: s.label ?? s.key,
      colors: dualThemeColors(seriesColor(s, index)),
    };
  });
  return config;
}

/**
 * Pie config keys are sector names (values of nameKey), matching EvilPieChart
 * gradient id / CSS var lookup (`--color-${sectorName}-0`).
 */
function buildPieConfig(spec: ChartSpecPieV1): ChartConfig {
  const config: ChartConfig = {};
  const colors = spec.colors;

  spec.data.forEach((row, index) => {
    const rawName = row[spec.nameKey];
    if (rawName === undefined || rawName === null) return;
    const sectorKey = String(rawName);
    // First occurrence wins if duplicate names appear
    if (config[sectorKey]) return;

    let color: string;
    if (Array.isArray(colors) && typeof colors[index] === "string" && colors[index]!.trim()) {
      color = colors[index]!.trim();
    } else {
      color = paletteColorAt(index);
    }

    config[sectorKey] = {
      label: sectorKey,
      colors: dualThemeColors(color),
    };
  });

  return config;
}

export type ResolvedChartOptions = {
  stacked: boolean;
  horizontal: boolean;
  showLegend: boolean;
  showGrid: boolean;
  showTooltip: boolean;
  height: number;
};

export function resolveChartOptions(
  options: ChartOptionsV1 | undefined,
): ResolvedChartOptions {
  return {
    stacked: options?.stacked === true,
    horizontal: options?.horizontal === true,
    showLegend: options?.showLegend !== false,
    showGrid: options?.showGrid !== false,
    showTooltip: options?.showTooltip !== false,
    height: clampChartHeight(options?.height),
  };
}

export type MappedEvilCartesian = {
  type: "bar" | "line" | "area";
  config: ChartConfig;
  xKey: string;
  seriesKeys: string[];
  series: ChartSeriesV1[];
  data: ChartSpecCartesianV1["data"];
  options: ResolvedChartOptions;
};

export type MappedEvilPie = {
  type: "pie";
  config: ChartConfig;
  nameKey: string;
  valueKey: string;
  data: ChartSpecPieV1["data"];
  options: ResolvedChartOptions;
};

export type MappedEvilChart = MappedEvilCartesian | MappedEvilPie;

/**
 * Build Evil Charts ChartConfig + series color CSS vars from Lanyard palette.
 * Pure — safe for unit tests. Never throws.
 */
export function mapSpecToEvilConfig(spec: ChartSpecV1): MappedEvilChart {
  const options = resolveChartOptions(spec.options);

  if (spec.type === "pie") {
    return {
      type: "pie",
      config: buildPieConfig(spec),
      nameKey: spec.nameKey,
      valueKey: spec.valueKey,
      data: spec.data,
      options,
    };
  }

  return {
    type: spec.type,
    config: buildCartesianConfig(spec),
    xKey: spec.xKey,
    seriesKeys: spec.series.map((s) => s.key),
    series: spec.series,
    data: spec.data,
    options,
  };
}
