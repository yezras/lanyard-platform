/**
 * RTL proof for `?story=web-search-results` (lp-uxy.7).
 * Browser paint: ui-testing / manual evidence under artifacts/ui/lp-uxy.7/.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FIXTURE_SEARCH_RESULTS,
  WebSearchResultsProofStory,
} from "./WebSearchResultsProofStory.js";

describe("WebSearchResultsProofStory (lp-uxy.7)", () => {
  it("renders structured search cards + rich final citations (fixture, cost-gated)", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(<WebSearchResultsProofStory />);

    const root = screen.getByTestId("web-search-results-proof-story");
    expect(root.getAttribute("data-firecrawl-live")).toBe("false");
    expect(root.getAttribute("data-cost-gated")).toBe("true");

    // Tool rows + always-visible structured result strip
    expect(screen.getByTestId("web-search-tool-panel")).toBeTruthy();
    expect(screen.getByTestId("web-search-results-panel")).toBeTruthy();
    expect(screen.getAllByTestId("web-search-results").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByTestId("web-search-results-item-1")).toBeTruthy();
    expect(screen.getAllByText("2026 FIFA World Cup").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/first 48-team tournament/i)).toBeTruthy();

    // Final answer rich citation chips
    expect(screen.getByTestId("web-search-answer-panel")).toBeTruthy();
    const cite1 = screen.getByTestId("web-citation-1");
    expect(cite1.getAttribute("data-citation-rich")).toBe("true");
    expect(cite1.getAttribute("data-citation-url")).toBe(
      FIXTURE_SEARCH_RESULTS[0]!.url,
    );

    fireEvent.click(cite1.querySelector("button") ?? cite1);
    expect(openSpy).toHaveBeenCalledWith(
      FIXTURE_SEARCH_RESULTS[0]!.url,
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
