/**
 * lp-uxy.11 — chart fence engine failures must not escape the fence.
 * Simulates recharts Invalid hook call / useContext null by throwing from
 * PortalChartCard; ChartFenceErrorBoundary should surface ChartSpecErrorCard.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./charts/PortalChartCard.js", () => ({
  PortalChartCard: () => {
    throw new Error(
      "Invalid hook call. Hooks can only be called inside of the body of a function component.",
    );
  },
}));

import { ChartFenceBody, ChartFenceErrorBoundary } from "./ChatRichCodeBlock.js";

const VALID_CHART_JSON = JSON.stringify({
  version: 1,
  type: "bar",
  title: "Big O comparison",
  xKey: "n",
  series: [{ key: "runtime", label: "Runtime" }],
  data: [
    { n: "10", runtime: 10 },
    { n: "100", runtime: 100 },
  ],
});

afterEach(() => {
  cleanup();
});

describe("ChartFenceErrorBoundary (lp-uxy.11)", () => {
  it("catches a child throw and shows chart unavailable card", () => {
    function Boom(): never {
      throw new Error("Invalid hook call");
    }

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <ChartFenceErrorBoundary>
        <Boom />
      </ChartFenceErrorBoundary>,
    );

    expect(screen.getByTestId("chart-spec-error-card")).toBeTruthy();
    expect(screen.getByTestId("chart-spec-error-card-message").textContent).toMatch(
      /Could not display this chart/i,
    );

    err.mockRestore();
    warn.mockRestore();
  });

  it("ChartFenceBody defaults to static table (no recharts mount)", async () => {
    expect(() => {
      render(<ChartFenceBody code={VALID_CHART_JSON} isStreaming={false} />);
    }).not.toThrow();

    await waitFor(() => {
      expect(screen.getByTestId("chat-static-chart-table")).toBeTruthy();
    });
    expect(screen.getByTestId("chat-safe-chart-card")).toBeTruthy();
    expect(screen.getByTestId("chat-chart-try-interactive")).toBeTruthy();
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
    // Title from fixture
    expect(screen.getByText("Big O comparison")).toBeTruthy();
  });

  it("interactive path isolates PortalChartCard throw behind opt-in", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<ChartFenceBody code={VALID_CHART_JSON} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("chat-chart-try-interactive")).toBeTruthy();
    });
    screen.getByTestId("chat-chart-try-interactive").click();

    await waitFor(() => {
      // Either error card from boundary or failed footer after engine throw
      const err = screen.queryByTestId("chart-spec-error-card");
      const failed = screen.queryByTestId("chat-chart-interactive-failed");
      const table = screen.queryByTestId("chat-static-chart-table");
      expect(err || failed || table).toBeTruthy();
    });

    spy.mockRestore();
    warn.mockRestore();
  });
});
