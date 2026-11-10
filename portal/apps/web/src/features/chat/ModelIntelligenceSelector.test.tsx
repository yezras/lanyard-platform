/**
 * UI proof for model intelligence selector presence + labels (lp-uxy.8).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";

import { ModelIntelligenceSelector } from "./ModelIntelligenceSelector.js";

describe("ModelIntelligenceSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Auto|Simple|Moderate|Complex options near send affordance", () => {
    const onChange = vi.fn();
    render(
      <Providers>
        <ModelIntelligenceSelector
          selection="auto"
          effectiveTier="simple"
          onChange={onChange}
          resolvedModelId="claude-haiku-4"
        />
      </Providers>,
    );

    const root = screen.getByTestId("model-intelligence-selector");
    expect(root.getAttribute("data-selection")).toBe("auto");
    expect(root.getAttribute("data-effective-tier")).toBe("simple");
    expect(root.getAttribute("data-model")).toBe("claude-haiku-4");

    const button = screen.getByRole("button", {
      name: /Model intelligence: Auto · Simple/i,
    });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: /Simple/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Moderate/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Complex/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Auto/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Complex$/i }));
    expect(onChange).toHaveBeenCalledWith("complex");
  });

  it("disables with clear reason when model selector unsupported", () => {
    render(
      <Providers>
        <ModelIntelligenceSelector
          selection="moderate"
          onChange={() => {}}
          isDisabled
          disabledReason="Model selection is not supported by this backend."
        />
      </Providers>,
    );

    const root = screen.getByTestId("model-intelligence-selector");
    expect(root.getAttribute("title")).toMatch(/not supported/i);
    const button = screen.getByRole("button", {
      name: /Model intelligence: Moderate/i,
    });
    expect(button).toHaveProperty("disabled", true);
  });
});
