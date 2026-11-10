/**
 * PortalChartCard — render ChartSpecV1 via vendored Evil Charts.
 *
 * Bead: lp-a79.4 · a11y/lazy notes: lp-a79.8
 * Plan: docs/plans/0009-portal-chat-charts/overview.md § PortalChartCard API
 *
 * No Markdown involvement here — fence wire-up is lp-a79.5.
 * Lazy-load boundary is owned by the parent ChatRichCodeBlock (lp-a79.8).
 *
 * a11y:
 * - Root is a labelled region (title via aria-labelledby, else aria-label).
 * - Plot is role="img" with the same accessible name (decorative data viz).
 * - animationType="none" + Evil's useReducedMotion: prefers-reduced-motion
 *   does not break render (static paint).
 * - No tabIndex on the card; interactive Recharts bits (tooltip hover) are
 *   pointer-driven and do not create a keyboard focus trap for chat v1.
 */

import type { CSSProperties, ReactNode } from "react";

import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  EvilAreaChart,
  EvilBarChart,
  EvilLineChart,
  EvilPieChart,
} from "./evil/charts/index.js";
import {
  mapSpecToEvilConfig,
  type MappedEvilCartesian,
  type MappedEvilPie,
} from "./mapSpecToEvilConfig.js";
import type { ChartSpecV1 } from "./types.js";

import "./portal-chart.css";

export type PortalChartCardProps = {
  spec: ChartSpecV1;
  /** Optional test id prefix (root uses this; defaults to portal-chart-card). */
  "data-testid"?: string;
  isLoading?: boolean;
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 8,
  background: "var(--color-background-surface, #fff)",
  padding: 12,
};

function plotStyle(height: number): CSSProperties {
  return {
    width: "100%",
    height,
    minHeight: height,
    boxSizing: "border-box",
  };
}

function CartesianPlot({
  mapped,
  isLoading,
}: {
  mapped: MappedEvilCartesian;
  isLoading: boolean;
}): ReactNode {
  const { config, data, xKey, series, options, type } = mapped;
  const { showGrid, showLegend, showTooltip, stacked, horizontal } = options;
  const className = "h-full w-full";

  if (type === "bar") {
    return (
      <EvilBarChart
        data={data}
        config={config}
        className={className}
        xDataKey={xKey}
        isLoading={isLoading}
        stackType={stacked ? "stacked" : "default"}
        layout={horizontal ? "horizontal" : "vertical"}
        animationType="none"
      >
        {showGrid ? <EvilBarChart.Grid /> : null}
        <EvilBarChart.XAxis dataKey={xKey} />
        <EvilBarChart.YAxis />
        {showLegend ? <EvilBarChart.Legend /> : null}
        {showTooltip ? <EvilBarChart.Tooltip /> : null}
        {series.map((s) => (
          <EvilBarChart.Bar key={s.key} dataKey={s.key} variant="default" />
        ))}
      </EvilBarChart>
    );
  }

  if (type === "line") {
    return (
      <EvilLineChart
        data={data}
        config={config}
        className={className}
        xDataKey={xKey}
        isLoading={isLoading}
        animationType="none"
      >
        {showGrid ? <EvilLineChart.Grid /> : null}
        <EvilLineChart.XAxis dataKey={xKey} />
        <EvilLineChart.YAxis />
        {showLegend ? <EvilLineChart.Legend /> : null}
        {showTooltip ? <EvilLineChart.Tooltip /> : null}
        {series.map((s) => (
          <EvilLineChart.Line key={s.key} dataKey={s.key} />
        ))}
      </EvilLineChart>
    );
  }

  // area
  return (
    <EvilAreaChart
      data={data}
      config={config}
      className={className}
      xDataKey={xKey}
      isLoading={isLoading}
      stackType={stacked ? "stacked" : "default"}
      animationType="none"
    >
      {showGrid ? <EvilAreaChart.Grid /> : null}
      <EvilAreaChart.XAxis dataKey={xKey} />
      <EvilAreaChart.YAxis />
      {showLegend ? <EvilAreaChart.Legend /> : null}
      {showTooltip ? <EvilAreaChart.Tooltip /> : null}
      {series.map((s) => (
        <EvilAreaChart.Area key={s.key} dataKey={s.key} />
      ))}
    </EvilAreaChart>
  );
}

function PiePlot({
  mapped,
  isLoading,
}: {
  mapped: MappedEvilPie;
  isLoading: boolean;
}): ReactNode {
  const { config, data, nameKey, valueKey, options } = mapped;
  const { showLegend, showTooltip } = options;

  return (
    <EvilPieChart
      data={data}
      config={config}
      dataKey={valueKey}
      nameKey={nameKey}
      className="h-full w-full"
      isLoading={isLoading}
    >
      <EvilPieChart.Pie variant="gradient" />
      {showTooltip ? <EvilPieChart.Tooltip /> : null}
      {showLegend ? <EvilPieChart.Legend /> : null}
    </EvilPieChart>
  );
}

/**
 * Renders title + description + Evil chart for a parsed ChartSpecV1.
 * Four fixture types (bar/line/area/pie) render without chat integration.
 */
export function PortalChartCard({
  spec,
  "data-testid": testId = "portal-chart-card",
  isLoading = false,
}: PortalChartCardProps): ReactNode {
  const mapped = mapSpecToEvilConfig(spec);
  const height = mapped.options.height;
  const titleText = spec.title?.trim() || "";
  const ariaLabel = titleText || `${spec.type} chart`;
  const titleId = titleText ? `${testId}-title` : undefined;

  return (
    <div
      className="portal-chart"
      style={cardStyle}
      data-testid={testId}
      data-chart-type={spec.type}
      role="region"
      aria-label={titleId ? undefined : ariaLabel}
      aria-labelledby={titleId}
    >
      <VStack gap={2}>
        {titleText ? (
          <Text
            type="heading"
            size="sm"
            data-testid={`${testId}-title`}
            // id for aria-labelledby association (Text forwards unknown attrs).
            id={titleId}
          >
            {titleText}
          </Text>
        ) : null}
        {spec.description ? (
          <Text
            type="body"
            color="secondary"
            data-testid={`${testId}-description`}
          >
            {spec.description}
          </Text>
        ) : null}
        <div
          style={plotStyle(height)}
          data-testid={`${testId}-plot`}
          role="img"
          aria-label={ariaLabel}
        >
          {mapped.type === "pie" ? (
            <PiePlot mapped={mapped} isLoading={isLoading} />
          ) : (
            <CartesianPlot mapped={mapped} isLoading={isLoading} />
          )}
        </div>
      </VStack>
    </div>
  );
}
