import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { HaltRoomButton } from "./HaltRoomButton.js";

/**
 * Component coverage only. ChatView does not mount HaltRoomButton (lp-bhcg.23);
 * the agent chat header must not show Halt. The mailbox halt route stays.
 */

afterEach(() => {
  cleanup();
});

function renderHalt(ui: ReactElement = <HaltRoomButton />) {
  return render(<Theme theme={neutralTheme}>{ui}</Theme>);
}

describe("HaltRoomButton", () => {
  it("renders Halt with mailbox-halt testid (not Stop or Resume)", () => {
    renderHalt();

    const halt = screen.getByTestId("mailbox-halt");
    expect(halt).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBe(halt);
    expect(screen.queryByRole("button", { name: /^Stop$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume/i })).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
  });

  it("click calls onHalt when wired and is a no-op when unwired", () => {
    renderHalt();
    expect(() => {
      fireEvent.click(screen.getByTestId("mailbox-halt"));
    }).not.toThrow();

    cleanup();
    const onHalt = vi.fn();
    renderHalt(<HaltRoomButton onHalt={onHalt} />);
    fireEvent.click(screen.getByTestId("mailbox-halt"));
    expect(onHalt).toHaveBeenCalledTimes(1);
  });

  it("stays visible when disabled", () => {
    renderHalt(<HaltRoomButton isDisabled />);

    const halt = screen.getByTestId("mailbox-halt");
    expect(halt).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBe(halt);
    expect(halt).toHaveProperty("disabled", true);
  });
});
