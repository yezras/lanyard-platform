/**
 * Auth-free story for chart styling spike (lp-a79.1).
 *
 * Mounted with `?story=chart-bar-proof`.
 * Renders a hard-coded monthly bar chart via vendored EvilCharts bar + Option A bridge.
 */

import type { CSSProperties } from "react";

import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { EvilBarChart } from "./evil/charts/recharts-bar-chart.js";
import type { ChartConfig } from "./evil/ui/recharts-chart.js";

import "./portal-chart.css";

const MONTHLY_DATA = [
  { month: "January", revenue: 120, cost: 80 },
  { month: "February", revenue: 150, cost: 95 },
  { month: "March", revenue: 180, cost: 110 },
  { month: "April", revenue: 140, cost: 100 },
  { month: "May", revenue: 200, cost: 125 },
  { month: "June", revenue: 175, cost: 115 },
] as const;

/** Lanyard brand palette (plan § Brand palette). */
const chartConfig = {
  revenue: {
    label: "Revenue",
    colors: {
      light: ["#0047ab"],
      dark: ["#0047ab"],
    },
  },
  cost: {
    label: "Cost",
    colors: {
      light: ["#4f81bd"],
      dark: ["#4f81bd"],
    },
  },
} satisfies ChartConfig;

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  boxSizing: "border-box",
  padding: "24px",
  background: "var(--color-background-body, #fafafa)",
};

const plotStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  height: 320,
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 8,
  background: "var(--color-background-surface, #fff)",
  padding: 12,
  boxSizing: "border-box",
};

/**
 * Spike harness: one bar chart with hard-coded monthly data.
 * Does not integrate chat markdown (that is lp-a79.5).
 */
export function ChartBarProofStory() {
  return (
    <div style={rootStyle} data-testid="chart-bar-proof-story">
      <VStack gap={4}>
        <Heading level={1}>Chart bar proof (lp-a79.1)</Heading>
        <Text color="secondary">
          Vendored EvilCharts <code>recharts-bar-chart</code> under Option A (Tailwind
          v4 + Astryx <code>tailwind-theme.css</code>), scoped with{" "}
          <code>.portal-chart</code>.
        </Text>
        <div
          className="portal-chart"
          style={plotStyle}
          data-testid="chart-bar-proof-plot"
          aria-label="Monthly revenue vs cost bar chart"
        >
          <EvilBarChart
            data={[...MONTHLY_DATA]}
            config={chartConfig}
            className="h-full w-full"
            xDataKey="month"
          >
            <EvilBarChart.Grid />
            <EvilBarChart.XAxis
              dataKey="month"
              tickFormatter={(value) => String(value).substring(0, 3)}
            />
            <EvilBarChart.YAxis />
            <EvilBarChart.Legend isClickable />
            <EvilBarChart.Tooltip />
            <EvilBarChart.Bar dataKey="revenue" variant="default" isClickable />
            <EvilBarChart.Bar dataKey="cost" variant="default" isClickable />
          </EvilBarChart>
        </div>
      </VStack>
    </div>
  );
}
