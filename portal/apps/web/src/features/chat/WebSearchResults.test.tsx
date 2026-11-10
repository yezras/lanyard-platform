import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WebSearchResultsList } from "./WebSearchResults.js";

describe("WebSearchResultsList (lp-uxy.7)", () => {
  it("renders structured title + snippet cards that open exact URLs", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(
      <WebSearchResultsList
        results={[
          {
            url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
            title: "2026 FIFA World Cup",
            snippet: "The 23rd FIFA World Cup.",
            provider: "firecrawl",
          },
          {
            url: "https://www.fifa.com/en/tournaments",
            title: "FIFA Tournaments",
            content_summary: "Official tournament hub.",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("web-search-results")).toBeTruthy();
    expect(screen.getByText(/Search results/)).toBeTruthy();
    expect(screen.getByText("2026 FIFA World Cup")).toBeTruthy();
    expect(screen.getByText("The 23rd FIFA World Cup.")).toBeTruthy();
    expect(screen.getByText("Firecrawl")).toBeTruthy();
    expect(screen.getByText("FIFA Tournaments")).toBeTruthy();

    const first = screen.getByTestId("web-search-results-item-1");
    expect(first.getAttribute("data-result-url")).toBe(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    );
    fireEvent.click(first.querySelector("button")!);
    expect(openSpy).toHaveBeenCalledWith(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("returns null for empty results", () => {
    const { container } = render(<WebSearchResultsList results={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
