import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "../../app/providers.js";
import { HonestyBanner } from "./HonestyBanner.js";
import type { HonestyNotice } from "./honestyCopy.js";

const fixtureNotice: HonestyNotice = {
  id: "settings-fixture",
  status: "warning",
  title: "Fixture settings snapshot (not host-backed)",
  description:
    "Snapshot source is fixture. Chat uses the relay path independently.",
};

describe("HonestyBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when notice is null", () => {
    const { container } = render(
      <Providers>
        <HonestyBanner notice={null} />
      </Providers>,
    );
    expect(container.querySelector("[data-testid^='honesty-banner-']")).toBeNull();
  });

  it("renders title and description for a notice", () => {
    render(
      <Providers>
        <HonestyBanner notice={fixtureNotice} />
      </Providers>,
    );
    expect(screen.getByTestId("honesty-banner-settings-fixture")).toBeTruthy();
    expect(
      screen.getByText("Fixture settings snapshot (not host-backed)"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Chat uses the relay path independently/i),
    ).toBeTruthy();
  });
});
