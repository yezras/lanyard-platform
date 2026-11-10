import { describe, expect, it } from "vitest";

import { parseChartSpec } from "./parseChartSpec.js";

const barFixture = {
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
    { month: "Mar", revenue: 180, cost: 110 },
  ],
  options: { showLegend: true, height: 280 },
};

const lineFixture = {
  version: 1,
  type: "line",
  title: "Weekly active users",
  xKey: "week",
  series: [{ key: "wau", label: "WAU" }],
  data: [
    { week: "W1", wau: 420 },
    { week: "W2", wau: 510 },
    { week: "W3", wau: 498 },
    { week: "W4", wau: 620 },
  ],
};

const areaFixture = {
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
    { day: "Wed", organic: 51, paid: 15 },
  ],
  options: { stacked: true },
};

const pieFixture = {
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

describe("parseChartSpec", () => {
  it("parses a valid bar chart", () => {
    const result = parseChartSpec(JSON.stringify(barFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe("bar");
    expect(result.spec.version).toBe(1);
    if (result.spec.type !== "bar") return;
    expect(result.spec.xKey).toBe("month");
    expect(result.spec.series).toHaveLength(2);
    expect(result.spec.data).toHaveLength(3);
    expect(result.spec.options?.height).toBe(280);
  });

  it("parses a valid line chart", () => {
    const result = parseChartSpec(JSON.stringify(lineFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe("line");
    if (result.spec.type !== "line") return;
    expect(result.spec.series[0].key).toBe("wau");
  });

  it("parses a valid area chart", () => {
    const result = parseChartSpec(JSON.stringify(areaFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe("area");
    if (result.spec.type !== "area") return;
    expect(result.spec.options?.stacked).toBe(true);
  });

  it("parses a valid pie chart", () => {
    const result = parseChartSpec(JSON.stringify(pieFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe("pie");
    if (result.spec.type !== "pie") return;
    expect(result.spec.nameKey).toBe("category");
    expect(result.spec.valueKey).toBe("amount");
    expect(result.spec.data).toHaveLength(4);
  });

  it("rejects incomplete / invalid JSON with code json", () => {
    const result = parseChartSpec('{"version": 1, "type": "bar"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("json");
  });

  it("rejects empty input with code empty", () => {
    const result = parseChartSpec("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty");
  });

  it("rejects version 2 with code schema", () => {
    const result = parseChartSpec(
      JSON.stringify({ ...barFixture, version: 2 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/version/i);
  });

  it("rejects 65 rows with code limits", () => {
    const data = Array.from({ length: 65 }, (_, i) => ({
      month: `M${i}`,
      revenue: i,
      cost: i,
    }));
    const result = parseChartSpec(JSON.stringify({ ...barFixture, data }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("limits");
    expect(result.error).toMatch(/64/);
  });

  it("rejects 0 series with code limits", () => {
    const result = parseChartSpec(
      JSON.stringify({ ...barFixture, series: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("limits");
    expect(result.error).toMatch(/series/i);
  });

  it("rejects pie missing valueKey", () => {
    const { valueKey: _omit, ...withoutValueKey } = pieFixture;
    void _omit;
    const result = parseChartSpec(JSON.stringify(withoutValueKey));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/valueKey/i);
  });

  it("rejects malicious color url(javascript:…)", () => {
    const result = parseChartSpec(
      JSON.stringify({
        ...barFixture,
        series: [
          {
            key: "revenue",
            label: "Revenue",
            color: "url(javascript:alert(1))",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/color/i);
  });

  it("accepts hex colors and clamps height on success path", () => {
    const result = parseChartSpec(
      JSON.stringify({
        ...barFixture,
        series: [{ key: "revenue", label: "Revenue", color: "#0047ab" }],
        options: { height: 999 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.options?.height).toBe(480);
    if (result.spec.type === "pie") return;
    expect(result.spec.series[0].color).toBe("#0047ab");
  });

  it("clamps height below minimum to 160", () => {
    const result = parseChartSpec(
      JSON.stringify({
        ...lineFixture,
        options: { height: 10 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.options?.height).toBe(160);
  });

  it("never throws on unexpected input shapes", () => {
    expect(() => parseChartSpec("null")).not.toThrow();
    expect(() => parseChartSpec("[]")).not.toThrow();
    expect(() => parseChartSpec("true")).not.toThrow();
    expect(parseChartSpec("null").ok).toBe(false);
    expect(parseChartSpec("[]").ok).toBe(false);
  });

  it("rejects pie negative values", () => {
    const result = parseChartSpec(
      JSON.stringify({
        ...pieFixture,
        data: [{ category: "Bad", amount: -1 }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
  });

  it("rejects more than 8 series", () => {
    const series = Array.from({ length: 9 }, (_, i) => ({
      key: `s${i}`,
      label: `S${i}`,
    }));
    const row: Record<string, string | number> = { month: "Jan" };
    for (let i = 0; i < 9; i++) row[`s${i}`] = i;
    const result = parseChartSpec(
      JSON.stringify({ ...barFixture, series, data: [row] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("limits");
  });
});
