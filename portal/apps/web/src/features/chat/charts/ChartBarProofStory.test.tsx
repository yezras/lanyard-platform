import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartBarProofStory } from "./ChartBarProofStory.js";

/**
 * Smoke proof for lp-a79.1: harness mounts and exposes chart root.
 * Full SVG paint is covered by browser/UI QA (`?story=chart-bar-proof`).
 */
describe("ChartBarProofStory", () => {
  it("renders the bar proof harness and portal-chart root", () => {
    render(<ChartBarProofStory />);

    expect(screen.getByTestId("chart-bar-proof-story")).toBeTruthy();
    const plot = screen.getByTestId("chart-bar-proof-plot");
    expect(plot).toBeTruthy();
    expect(plot.classList.contains("portal-chart")).toBe(true);
    expect(
      screen.getByLabelText("Monthly revenue vs cost bar chart"),
    ).toBeTruthy();
  });
});
