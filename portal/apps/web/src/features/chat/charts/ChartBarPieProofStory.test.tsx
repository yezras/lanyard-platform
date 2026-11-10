/**
 * Component + fixture proof for lp-a79.9 (bar + pie charts in chat).
 * lp-uxy.11: chat path defaults to SafeStablePortalChartCard (static table);
 * interactive PortalChartCard is opt-in via "Show interactive chart".
 * Browser paint / screenshot: `?story=chart-bar-pie` + ui-testing / CDP proof.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChartBarPieProofStory } from "./ChartBarPieProofStory.js";

afterEach(() => {
  cleanup();
});

describe("ChartBarPieProofStory", () => {
  it("renders bar + pie PortalChartCards in the chat bubble path", async () => {
    render(<ChartBarPieProofStory />);

    expect(screen.getByTestId("chart-bar-pie-proof-story")).toBeTruthy();
    const bubble = screen.getByTestId("chart-bar-pie-assistant-bubble");
    expect(bubble).toBeTruthy();

    // Prose from fixture (sync markdown)
    expect(screen.getByText("Here is the quarterly breakdown:")).toBeTruthy();
    expect(screen.getByText("And the share of spend:")).toBeTruthy();

    // Safe static charts (2 valid fences in fixture)
    const cards = await screen.findAllByTestId(
      "chat-safe-chart-card",
      {},
      { timeout: 15_000 },
    );
    expect(cards.length).toBe(2);
    expect(screen.getAllByTestId("chat-static-chart-table").length).toBe(2);
    expect(screen.getByText("Q1 revenue vs cost")).toBeTruthy();
    expect(screen.getByText("Spend by category")).toBeTruthy();
  });

  it("invalid chart fence shows error card without crash", async () => {
    render(<ChartBarPieProofStory />);

    const err = await screen.findByTestId(
      "chart-spec-error-card",
      {},
      { timeout: 15_000 },
    );
    expect(err).toBeTruthy();
    expect(err.getAttribute("role")).toBe("alert");
    // data is not an array → schema (or equivalent non-crash) failure
    expect(err.getAttribute("data-error-code")).toBeTruthy();
    expect(screen.getByTestId("chart-spec-error-card-title")).toBeTruthy();
    expect(screen.getByTestId("chart-spec-error-card-message")).toBeTruthy();

    // Valid charts still present alongside the error (safe static path)
    await waitFor(
      () => {
        expect(screen.getAllByTestId("chat-safe-chart-card").length).toBe(2);
      },
      { timeout: 15_000 },
    );
  });
});
