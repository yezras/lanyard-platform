/**
 * Unit tests for responsive document pane host (lp-5q6.15).
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
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { DocumentPaneHost } from "./DocumentPaneHost.js";
import type { ArtifactPanelState } from "./types.js";

const MD_CONTENT = {
  path: "/Projects/A/README.md",
  mime_type: "text/markdown",
  encoding: "utf-8" as const,
  content: "# Hello from vault\n\nPreview body.",
};

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
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  return (
    <div ref={containerRef} style={{ width: 1280, height: 720 }}>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "PANEL_OPEN",
            ref: { path: "/Projects/A/README.md", title: "README.md" },
          })
        }
      >
        Open pane
      </button>
      <DocumentPaneHost
        state={
          state.status === "closed"
            ? state
            : ({
                ...state,
                status: "previewing",
              } as ArtifactPanelState)
        }
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {
          dispatch({ type: "PANEL_CLOSE", reason: "user" });
          onClose();
        }}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        containerRef={containerRef}
        layoutPreference="split"
      />
    </div>
  );
}

function DrawerHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const openState: ArtifactPanelState = {
    ...createInitialArtifactPanelState(),
    status: "previewing",
    ref: { path: "/Projects/A/README.md", title: "README.md" },
    openGeneration: 1,
  };

  return (
    <div ref={containerRef} style={{ width: 390, height: 844 }}>
      <DocumentPaneHost
        state={openState}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        containerRef={containerRef}
        layoutPreference="drawer"
      />
    </div>
  );
}

describe("DocumentPaneHost (lp-5q6.15)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a resizable split pane with labeled controls on desktop", async () => {
    renderWithProviders(<SplitHost />);

    fireEvent.click(screen.getByRole("button", { name: "Open pane" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-document-pane");
    expect(pane.getAttribute("data-layout")).toBe("split");
    expect(screen.getByTestId("chat-document-pane-resize-handle")).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Resize document pane" }),
    ).toBeTruthy();

    // Icon-first controls still expose accessible names + tooltips via label.
    expect(
      screen.getByRole("button", { name: "Close document pane" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reload document" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open in Vault" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download document" }),
    ).toBeTruthy();
  });

  it("opens a full-screen drawer on mobile layout preference", async () => {
    renderWithProviders(<DrawerHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-document-pane");
    expect(pane.getAttribute("data-layout")).toBe("drawer");
    expect(screen.queryByTestId("chat-document-pane-resize-handle")).toBeNull();
    expect(screen.getByTestId("chat-document-pane-drawer")).toBeTruthy();
  });

  it("moves focus into the split pane on open and restores on close", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SplitHost onClose={onClose} />);

    const openBtn = screen.getByRole("button", { name: "Open pane" });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId("chat-document-pane"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close document pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes the split pane on Escape when focus is in the pane", async () => {
    renderWithProviders(<SplitHost />);

    fireEvent.click(screen.getByRole("button", { name: "Open pane" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const pane = screen.getByTestId("chat-document-pane");
    fireEvent.keyDown(pane, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });
  });

  it("hides chrome when active=false while panel state remains open (lp-dpr.4)", async () => {
    function ActiveToggleHost() {
      const containerRef = useRef<HTMLDivElement>(null);
      const openState: ArtifactPanelState = {
        ...createInitialArtifactPanelState(),
        status: "previewing",
        ref: { path: "/Projects/A/README.md", title: "README.md" },
        openGeneration: 1,
      };
      const [active, setActive] = useState(true);

      return (
        <div ref={containerRef} style={{ width: 1280, height: 720 }}>
          <button type="button" onClick={() => setActive(false)}>
            Hide document chrome
          </button>
          <DocumentPaneHost
            state={openState}
            content={MD_CONTENT}
            isLoading={false}
            active={active}
            onClose={() => {}}
            onReload={() => {}}
            onOpenInVault={() => {}}
            onDownload={() => {}}
            containerRef={containerRef}
            layoutPreference="split"
          />
        </div>
      );
    }

    renderWithProviders(<ActiveToggleHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Hide document chrome" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });
  });

  it("releases drawer Dialog showModal when active=false (lp-vnz.1)", async () => {
    function DrawerActiveToggleHost() {
      const containerRef = useRef<HTMLDivElement>(null);
      const openState: ArtifactPanelState = {
        ...createInitialArtifactPanelState(),
        status: "previewing",
        ref: { path: "/Projects/A/README.md", title: "README.md" },
        openGeneration: 1,
      };
      const [active, setActive] = useState(true);

      return (
        <div ref={containerRef} style={{ width: 390, height: 844 }}>
          <button type="button" onClick={() => setActive(false)}>
            Leave Chat tab
          </button>
          <button type="button" onClick={() => setActive(true)}>
            Return to Chat tab
          </button>
          <DocumentPaneHost
            state={openState}
            content={MD_CONTENT}
            isLoading={false}
            active={active}
            onClose={() => {}}
            onReload={() => {}}
            onOpenInVault={() => {}}
            onDownload={() => {}}
            containerRef={containerRef}
            layoutPreference="drawer"
          />
        </div>
      );
    }

    renderWithProviders(<DrawerActiveToggleHost />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane-drawer")).toBeTruthy();
    });
    expect(document.querySelector("dialog[open]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave Chat tab" }));

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane-drawer")).toBeNull();
    });
    expect(document.querySelector("dialog[open]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Return to Chat tab" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane-drawer")).toBeTruthy();
    });
    expect(document.querySelector("dialog[open]")).toBeTruthy();
  });
});
