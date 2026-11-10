/**
 * Component tests for PortalChartCard (lp-a79.4).
 * Covers type switch for four fixtures + missing title.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChartSpecErrorCard } from "./ChartSpecErrorCard.js";
import { PortalChartCard } from "./PortalChartCard.js";
import { parseChartSpec } from "./parseChartSpec.js";
import type { ChartSpecV1 } from "./types.js";

afterEach(() => {
  cleanup();
});

const barFixture = {
  version: 1,
  type: "bar",
  title: "Q1 revenue vs cost",
  description: "Monthly comparison",
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

function parseFixture(fixture: unknown): ChartSpecV1 {
  const result = parseChartSpec(JSON.stringify(fixture));
  if (!result.ok) {
    throw new Error(`fixture parse failed: ${result.error}`);
  }
  return result.spec;
}

describe("PortalChartCard", () => {
  it("renders bar chart title, description, and plot", () => {
    const spec = parseFixture(barFixture);
    render(<PortalChartCard spec={spec} />);

    const root = screen.getByTestId("portal-chart-card");
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-chart-type")).toBe("bar");
    expect(root.classList.contains("portal-chart")).toBe(true);
    // a11y: labelled region + plot img name (lp-a79.8)
    expect(root.getAttribute("role")).toBe("region");
    expect(root.getAttribute("aria-labelledby")).toBe("portal-chart-card-title");
    expect(root.getAttribute("aria-label")).toBeNull();

    expect(screen.getByTestId("portal-chart-card-title").textContent).toBe(
      "Q1 revenue vs cost",
    );
    expect(screen.getByTestId("portal-chart-card-title").getAttribute("id")).toBe(
      "portal-chart-card-title",
    );
    expect(screen.getByTestId("portal-chart-card-description").textContent).toBe(
      "Monthly comparison",
    );
    const plot = screen.getByTestId("portal-chart-card-plot");
    expect(plot).toBeTruthy();
    expect(plot.getAttribute("role")).toBe("img");
    expect(plot.getAttribute("aria-label")).toBe("Q1 revenue vs cost");
    // Not a focus trap: no tabIndex on card or plot.
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(plot.getAttribute("tabindex")).toBeNull();
  });

  it("renders line chart type", () => {
    const spec = parseFixture(lineFixture);
    render(<PortalChartCard spec={spec} />);
    expect(screen.getByTestId("portal-chart-card").getAttribute("data-chart-type")).toBe(
      "line",
    );
    expect(screen.getByTestId("portal-chart-card-title").textContent).toBe(
      "Weekly active users",
    );
  });

  it("renders area chart type", () => {
    const spec = parseFixture(areaFixture);
    render(<PortalChartCard spec={spec} />);
    expect(screen.getByTestId("portal-chart-card").getAttribute("data-chart-type")).toBe(
      "area",
    );
    expect(screen.getByTestId("portal-chart-card-title").textContent).toBe(
      "Traffic sources",
    );
  });

  it("renders pie chart type", () => {
    const spec = parseFixture(pieFixture);
    render(<PortalChartCard spec={spec} />);
    expect(screen.getByTestId("portal-chart-card").getAttribute("data-chart-type")).toBe(
      "pie",
    );
    expect(screen.getByTestId("portal-chart-card-title").textContent).toBe(
      "Share of spend",
    );
  });

  it("omits title element when title is missing", () => {
    const { title: _omit, ...withoutTitle } = barFixture;
    const spec = parseFixture(withoutTitle);
    render(<PortalChartCard spec={spec} />);

    const root = screen.getByTestId("portal-chart-card");
    expect(root).toBeTruthy();
    expect(screen.queryByTestId("portal-chart-card-title")).toBeNull();
    expect(root.getAttribute("role")).toBe("region");
    expect(root.getAttribute("aria-label")).toBe("bar chart");
    expect(root.getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getByTestId("portal-chart-card-plot").getAttribute("aria-label")).toBe(
      "bar chart",
    );
  });

  it("honors custom data-testid prefix", () => {
    const spec = parseFixture(lineFixture);
    render(<PortalChartCard spec={spec} data-testid="custom-chart" />);
    expect(screen.getByTestId("custom-chart")).toBeTruthy();
    expect(screen.getByTestId("custom-chart-title").textContent).toBe(
      "Weekly active users",
    );
    expect(screen.getByTestId("custom-chart-plot")).toBeTruthy();
  });
});

describe("ChartSpecErrorCard", () => {
  it("renders default title and lead-in for schema failures", () => {
    render(
      <ChartSpecErrorCard
        message="type must be one of bar, line, area, pie"
        code="schema"
      />,
    );
    expect(screen.getByTestId("chart-spec-error-card")).toBeTruthy();
    expect(
      screen.getByTestId("chart-spec-error-card").getAttribute("data-error-code"),
    ).toBe("schema");
    expect(screen.getByTestId("chart-spec-error-card-title").textContent).toBe(
      "Chart unavailable",
    );
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).toMatch(/not valid/i);
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).toMatch(/type must be one of/);
  });

  it("uses limits title and copy for over-limit specs", () => {
    render(
      <ChartSpecErrorCard
        message="data exceeds max of 64 rows"
        code="limits"
      />,
    );
    expect(
      screen.getByTestId("chart-spec-error-card").getAttribute("data-error-code"),
    ).toBe("limits");
    expect(screen.getByTestId("chart-spec-error-card-title").textContent).toBe(
      "Chart too large",
    );
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).toMatch(/size limits/i);
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).toMatch(/64 rows/);
  });

  it("uses json title and optional collapsed raw for debug", () => {
    const raw = '{"version":1,"type":"bar"';
    render(
      <ChartSpecErrorCard
        message="Invalid chart JSON"
        code="json"
        raw={raw}
      />,
    );
    expect(screen.getByTestId("chart-spec-error-card-title").textContent).toBe(
      "Invalid chart JSON",
    );
    expect(screen.getByTestId("chart-spec-error-card-raw-details")).toBeTruthy();
    expect(screen.getByTestId("chart-spec-error-card-raw").textContent).toBe(
      raw,
    );
    // No stack-looking content in the user-facing message.
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).not.toMatch(/at\s+\w+|Error:|stack/i);
  });
});
