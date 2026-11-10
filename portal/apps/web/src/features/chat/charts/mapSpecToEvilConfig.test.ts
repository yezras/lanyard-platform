/**
 * Unit tests for mapSpecToEvilConfig + palette (lp-a79.4).
 */

import { describe, expect, it } from "vitest";

import { mapSpecToEvilConfig, resolveChartOptions } from "./mapSpecToEvilConfig.js";
import {
  CHART_HEIGHT_DEFAULT,
  LANYARD_CHART_PALETTE,
  clampChartHeight,
  paletteColorAt,
} from "./palette.js";
import type { ChartSpecV1 } from "./types.js";

const barSpec: ChartSpecV1 = {
  version: 1,
  type: "bar",
  title: "Q1 revenue vs cost",
  xKey: "month",
  series: [
    { key: "revenue", label: "Revenue" },
    { key: "cost", label: "Cost" },
  ],
  data: [
    { month: "Jan", revenue: 120, cost: 80 },
    { month: "Feb", revenue: 150, cost: 95 },
  ],
  options: { showLegend: true, height: 280 },
};

const lineSpec: ChartSpecV1 = {
  version: 1,
  type: "line",
  title: "Weekly active users",
  xKey: "week",
  series: [{ key: "wau", label: "WAU" }],
  data: [
    { week: "W1", wau: 420 },
    { week: "W2", wau: 510 },
  ],
};

const areaSpec: ChartSpecV1 = {
  version: 1,
  type: "area",
  title: "Traffic sources",
  xKey: "day",
  series: [
    { key: "organic", label: "Organic" },
    { key: "paid", label: "Paid" },
  ],
  data: [
    { day: "Mon", organic: 40, paid: 12 },
    { day: "Tue", organic: 44, paid: 18 },
  ],
  options: { stacked: true },
};

const pieSpec: ChartSpecV1 = {
  version: 1,
  type: "pie",
  title: "Share of spend",
  nameKey: "category",
  valueKey: "amount",
  data: [
    { category: "Compute", amount: 42 },
    { category: "Storage", amount: 18 },
    { category: "Network", amount: 12 },
    { category: "Other", amount: 8 },
  ],
};

describe("palette", () => {
  it("exposes 8 ordered brand colors", () => {
    expect(LANYARD_CHART_PALETTE).toHaveLength(8);
    expect(LANYARD_CHART_PALETTE[0]).toBe("#0047ab");
    expect(LANYARD_CHART_PALETTE[1]).toBe("#4f81bd");
    expect(LANYARD_CHART_PALETTE[7]).toBe("#374151");
  });

  it("cycles paletteColorAt past the end", () => {
    expect(paletteColorAt(0)).toBe("#0047ab");
    expect(paletteColorAt(8)).toBe("#0047ab");
    expect(paletteColorAt(9)).toBe("#4f81bd");
  });

  it("clamps chart height", () => {
    expect(clampChartHeight(undefined)).toBe(CHART_HEIGHT_DEFAULT);
    expect(clampChartHeight(100)).toBe(160);
    expect(clampChartHeight(900)).toBe(480);
    expect(clampChartHeight(300)).toBe(300);
  });
});

describe("resolveChartOptions", () => {
  it("applies defaults when options omitted", () => {
    expect(resolveChartOptions(undefined)).toEqual({
      stacked: false,
      horizontal: false,
      showLegend: true,
      showGrid: true,
      showTooltip: true,
      height: CHART_HEIGHT_DEFAULT,
    });
  });

  it("honors explicit false flags", () => {
    const resolved = resolveChartOptions({
      showLegend: false,
      showGrid: false,
      showTooltip: false,
      stacked: true,
      horizontal: true,
      height: 200,
    });
    expect(resolved.showLegend).toBe(false);
    expect(resolved.showGrid).toBe(false);
    expect(resolved.showTooltip).toBe(false);
    expect(resolved.stacked).toBe(true);
    expect(resolved.horizontal).toBe(true);
    expect(resolved.height).toBe(200);
  });
});

describe("mapSpecToEvilConfig", () => {
  it("maps bar series to config with brand palette (light + dark)", () => {
    const mapped = mapSpecToEvilConfig(barSpec);
    expect(mapped.type).toBe("bar");
    if (mapped.type !== "bar") return;

    expect(mapped.xKey).toBe("month");
    expect(mapped.seriesKeys).toEqual(["revenue", "cost"]);
    expect(mapped.config.revenue?.label).toBe("Revenue");
    expect(mapped.config.revenue?.colors).toEqual({
      light: ["#0047ab"],
      dark: ["#0047ab"],
    });
    expect(mapped.config.cost?.colors).toEqual({
      light: ["#4f81bd"],
      dark: ["#4f81bd"],
    });
    expect(mapped.options.height).toBe(280);
  });

  it("maps line series", () => {
    const mapped = mapSpecToEvilConfig(lineSpec);
    expect(mapped.type).toBe("line");
    if (mapped.type !== "line") return;
    expect(mapped.seriesKeys).toEqual(["wau"]);
    expect(mapped.config.wau?.colors?.light?.[0]).toBe("#0047ab");
  });

  it("maps stacked area flags", () => {
    const mapped = mapSpecToEvilConfig(areaSpec);
    expect(mapped.type).toBe("area");
    if (mapped.type !== "area") return;
    expect(mapped.options.stacked).toBe(true);
    expect(mapped.config.organic?.colors?.light?.[0]).toBe("#0047ab");
    expect(mapped.config.paid?.colors?.light?.[0]).toBe("#4f81bd");
  });

  it("maps pie slices by nameKey with palette colors", () => {
    const mapped = mapSpecToEvilConfig(pieSpec);
    expect(mapped.type).toBe("pie");
    if (mapped.type !== "pie") return;

    expect(mapped.nameKey).toBe("category");
    expect(mapped.valueKey).toBe("amount");
    expect(mapped.config.Compute?.colors).toEqual({
      light: ["#0047ab"],
      dark: ["#0047ab"],
    });
    expect(mapped.config.Storage?.colors?.light?.[0]).toBe("#4f81bd");
    expect(mapped.config.Network?.colors?.light?.[0]).toBe("#000080");
    expect(mapped.config.Other?.colors?.light?.[0]).toBe("#0d9488");
  });

  it("honors series.color override over palette", () => {
    const spec: ChartSpecV1 = {
      ...barSpec,
      series: [
        { key: "revenue", label: "Revenue", color: "#ff0000" },
        { key: "cost", label: "Cost" },
      ],
    };
    const mapped = mapSpecToEvilConfig(spec);
    if (mapped.type === "pie") return;
    expect(mapped.config.revenue?.colors?.light?.[0]).toBe("#ff0000");
    expect(mapped.config.cost?.colors?.light?.[0]).toBe("#4f81bd");
  });

  it("honors pie colors[] aligned to data order", () => {
    const spec: ChartSpecV1 = {
      ...pieSpec,
      colors: ["#111111", "#222222"],
    };
    const mapped = mapSpecToEvilConfig(spec);
    if (mapped.type !== "pie") return;
    expect(mapped.config.Compute?.colors?.light?.[0]).toBe("#111111");
    expect(mapped.config.Storage?.colors?.light?.[0]).toBe("#222222");
    // Remaining slices fall back to palette at their index
    expect(mapped.config.Network?.colors?.light?.[0]).toBe("#000080");
  });

  it("maps horizontal bar option", () => {
    const spec: ChartSpecV1 = {
      ...barSpec,
      options: { horizontal: true },
    };
    const mapped = mapSpecToEvilConfig(spec);
    if (mapped.type === "pie") return;
    expect(mapped.options.horizontal).toBe(true);
  });
});
