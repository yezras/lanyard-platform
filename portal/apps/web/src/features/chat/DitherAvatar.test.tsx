import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DitherAvatar,
  DitherPattern,
  hashSeed,
  hueFromSeed,
  hueForName,
} from "./DitherAvatar.js";

describe("DitherAvatar helpers", () => {
  afterEach(() => {
    cleanup();
  });

  it("hashSeed is deterministic and independent of display title", () => {
    expect(hashSeed("seed-a")).toBe(hashSeed("seed-a"));
    expect(hashSeed("seed-a")).not.toBe(hashSeed("seed-b"));
    expect(hashSeed(42)).toBe(hashSeed("42"));
  });

  it("hueFromSeed stays in [0, 360)", () => {
    const hue = hueFromSeed("avatar-seed-xyz");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(hueForName("same-as-seed")).toBe(hueFromSeed("same-as-seed"));
  });

  it("renders pattern + avatar with stable data-avatar-seed", () => {
    const { container, getByTestId } = render(
      <DitherAvatar seed="abc123" size="sm" data-testid="agent-dither" />,
    );
    const avatar = getByTestId("agent-dither");
    expect(avatar.getAttribute("data-avatar-seed")).toBe("abc123");
    expect(avatar.getAttribute("data-running")).toBe("false");
    expect(avatar.classList.contains("dither-avatar-root")).toBe(true);
    expect(container.querySelectorAll("svg").length).toBe(1);
    // Pattern paints background + on-cells
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
    // Idle: no pulse ring
    expect(container.querySelector(".dither-avatar-pulse")).toBeNull();
  });

  it("isRunning adds pulse ring + data-running without changing seed (lp-lv9.8)", () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <DitherAvatar seed="run-seed" size="sm" data-testid="agent-dither" />,
    );
    expect(getByTestId("agent-dither").getAttribute("data-running")).toBe(
      "false",
    );
    expect(queryByTestId("dither-avatar-pulse")).toBeNull();

    rerender(
      <DitherAvatar
        seed="run-seed"
        size="sm"
        isRunning
        data-testid="agent-dither"
      />,
    );
    const avatar = getByTestId("agent-dither");
    expect(avatar.getAttribute("data-running")).toBe("true");
    expect(avatar.getAttribute("data-avatar-seed")).toBe("run-seed");
    expect(getByTestId("dither-avatar-pulse")).toBeTruthy();
  });

  it("DitherPattern uses seed for cells (same seed → same structure)", () => {
    const a = render(<DitherPattern seed="s1" hue={120} />);
    const b = render(<DitherPattern seed="s1" hue={120} />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
    a.unmount();
    b.unmount();
  });
});
