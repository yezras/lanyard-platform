/**
 * Unit tests for responsive activity pane host (lp-dpr.4).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useReducer, useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../../app/providers.js";

import {
  activityPaneReducer,
  createInitialActivityPaneState,
} from "./activityPaneReducer.js";
import { ActivityPaneHost } from "./ActivityPaneHost.js";
import type { ActivityPaneState } from "./types.js";

function renderWithProviders(node: ReactNode) {
  return render(<Providers>{node}</Providers>);
}

function SplitHost({
  onClose = () => {},
}: {
  onClose?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(
    activityPaneReducer,
    undefined,
    createInitialActivityPaneState,
  );

  return (
    <div ref={containerRef} style={{ width: 1280, height: 720 }}>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "SIDE_PANE_OPEN_ACTIVITY",
            focus: { kind: "roster" },
          })
        }
      >
        Open activity
      </button>
      <ActivityPaneHost
        state={state}
        onClose={() => {
          dispatch({ type: "SIDE_PANE_CLOSE", reason: "user" });
          onClose();
        }}
        containerRef={containerRef}
        layoutPreference="split"
      />
    </div>
  );
}

function DrawerHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const openState: ActivityPaneState = {
    mode: "activity",
    focus: { kind: "roster" },
    openGeneration: 1,
  };

  return (
    <div ref={containerRef} style={{ width: 390, height: 844 }}>
      <ActivityPaneHost
        state={openState}
        onClose={() => {}}
        containerRef={containerRef}
        layoutPreference="drawer"
      />
    </div>
  );
}

describe("ActivityPaneHost (lp-dpr.4)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a resizable split pane with close control on desktop", async () => {
    renderWithProviders(<SplitHost />);

    fireEvent.click(screen.getByRole("button", { name: "Open activity" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.getAttribute("data-layout")).toBe("split");
    expect(pane.getAttribute("data-mode")).toBe("activity");
    expect(pane.getAttribute("data-focus-kind")).toBe("roster");
    expect(screen.getByTestId("chat-activity-pane-resize-handle")).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Resize activity pane" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close activity pane" }),
    ).toBeTruthy();
    // Without children, shell still shows the phase-3 placeholder.
    expect(screen.getByTestId("chat-activity-pane-placeholder")).toBeTruthy();
  });

  it("opens a full-screen drawer on mobile layout preference", async () => {
    renderWithProviders(<DrawerHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.getAttribute("data-layout")).toBe("drawer");
    expect(screen.queryByTestId("chat-activity-pane-resize-handle")).toBeNull();
    expect(screen.getByTestId("chat-activity-pane-drawer")).toBeTruthy();
  });

  it("moves focus into the split pane on open and restores on close", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SplitHost onClose={onClose} />);

    const openBtn = screen.getByRole("button", { name: "Open activity" });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId("chat-activity-pane"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close activity pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes the split pane on Escape when focus is in the pane", async () => {
    renderWithProviders(<SplitHost />);

    fireEvent.click(screen.getByRole("button", { name: "Open activity" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-activity-pane");
    fireEvent.keyDown(pane, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });
  });

  it("does not render when mode is closed", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    renderWithProviders(
      <div ref={(el) => {
        containerRef.current = el;
      }}>
        <ActivityPaneHost
          state={createInitialActivityPaneState()}
          onClose={() => {}}
          containerRef={containerRef}
          layoutPreference="split"
        />
      </div>,
    );
    expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
  });

  it("hides chrome when active=false while activity state remains open (lp-vnz.1)", async () => {
    function ActiveToggleHost() {
      const containerRef = useRef<HTMLDivElement>(null);
      const openState: ActivityPaneState = {
        mode: "activity",
        focus: { kind: "roster" },
        openGeneration: 1,
      };
      const [active, setActive] = useState(true);

      return (
        <div ref={containerRef} style={{ width: 1280, height: 720 }}>
          <button type="button" onClick={() => setActive(false)}>
            Leave Chat tab
          </button>
          <button type="button" onClick={() => setActive(true)}>
            Return to Chat tab
          </button>
          <ActivityPaneHost
            state={openState}
            active={active}
            onClose={() => {}}
            containerRef={containerRef}
            layoutPreference="split"
          />
        </div>
      );
    }

    renderWithProviders(<ActiveToggleHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Leave Chat tab" }));

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Return to Chat tab" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });
  });

  it("releases drawer Dialog showModal when active=false (lp-vnz.1)", async () => {
    function DrawerActiveToggleHost() {
      const containerRef = useRef<HTMLDivElement>(null);
      const openState: ActivityPaneState = {
        mode: "activity",
        focus: { kind: "roster" },
        openGeneration: 1,
      };
      const [active, setActive] = useState(true);

      return (
        <div ref={containerRef} style={{ width: 390, height: 844 }}>
          <button type="button" onClick={() => setActive(false)}>
            Leave Chat tab
          </button>
          <ActivityPaneHost
            state={openState}
            active={active}
            onClose={() => {}}
            containerRef={containerRef}
            layoutPreference="drawer"
          />
        </div>
      );
    }

    renderWithProviders(<DrawerActiveToggleHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane-drawer")).toBeTruthy();
    });
    expect(document.querySelector("dialog[open]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave Chat tab" }));

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane-drawer")).toBeNull();
    });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});
