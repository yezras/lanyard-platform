/**
 * Regression tests for chat document pane preview fetch (lp-dpr.1).
 *
 * Ensures path open loads vault bytes into the body — not chrome-only —
 * and that generation races never leave a settled empty body.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { useDocumentPanePreview } from "./useDocumentPanePreview.js";

vi.mock("../../../api/vault.js", () => ({
  fetchVaultContent: vi.fn(),
}));

import { fetchVaultContent } from "../../../api/vault.js";

const MD = {
  path: "/Projects/A/README.md",
  mime_type: "text/markdown",
  encoding: "utf-8" as const,
  content: "# Hello from vault\n\nPreview body.",
};

const DOCX = {
  path: "/Business/Legal/contracts/Note.docx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  encoding: "base64" as const,
  content: btoa("fake-docx-bytes"),
};

function PreviewProbe(props: {
  path: string;
  mode?: "preview" | "edit";
  /** When true, open via artifact.updated from closed (lp-dpr.1 path). */
  openViaUpdated?: boolean;
}) {
  const [state, dispatch] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  useEffect(() => {
    if (props.openViaUpdated) {
      dispatch({
        type: "PANEL_EVENT",
        event: {
          type: "updated",
          ref: { path: props.path, title: "doc" },
          revision: { token: "r1", kind: "etag" },
          writeKind: "canonical",
        },
      });
      return;
    }
    dispatch({
      type: "PANEL_OPEN",
      ref: { path: props.path, title: "doc" },
      mode: props.mode ?? "preview",
    });
  }, [props.path, props.mode, props.openViaUpdated]);

  const preview = useDocumentPanePreview(state, dispatch);

  return (
    <div
      data-testid="preview-probe"
      data-status={state.status}
      data-generation={String(state.openGeneration)}
      data-loading={String(preview.isLoading)}
      data-has-content={String(preview.content != null)}
      data-content-path={preview.content?.path ?? ""}
      data-error={state.error?.code ?? ""}
    >
      {preview.isLoading ? <span data-testid="probe-loading">Loading…</span> : null}
      {preview.content ? (
        <span data-testid="probe-body">{preview.content.content.slice(0, 32)}</span>
      ) : null}
      {state.status === "error" && state.error ? (
        <span data-testid="probe-error">{state.error.message}</span>
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useDocumentPanePreview (lp-dpr.1)", () => {
  beforeEach(() => {
    vi.mocked(fetchVaultContent).mockReset();
  });

  it("loads vault bytes on PANEL_OPEN and leaves opening for READY", async () => {
    vi.mocked(fetchVaultContent).mockResolvedValue(MD);

    render(<PreviewProbe path="/Projects/A/README.md" />);

    // First paint while open must report loading (no empty-body flash).
    expect(screen.getByTestId("preview-probe").getAttribute("data-loading")).toBe(
      "true",
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-body")).toBeTruthy();
    });

    expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    const probe = screen.getByTestId("preview-probe");
    expect(probe.getAttribute("data-has-content")).toBe("true");
    expect(probe.getAttribute("data-loading")).toBe("false");
    expect(probe.getAttribute("data-status")).toBe("previewing");
    expect(probe.getAttribute("data-content-path")).toBe("/Projects/A/README.md");
  });

  it("loads office path bytes for VaultReader / Office mount path", async () => {
    vi.mocked(fetchVaultContent).mockResolvedValue(DOCX);

    render(
      <PreviewProbe path="/Business/Legal/contracts/Note.docx" mode="preview" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-body")).toBeTruthy();
    });

    expect(fetchVaultContent).toHaveBeenCalledWith(
      "/Business/Legal/contracts/Note.docx",
    );
    expect(
      screen.getByTestId("preview-probe").getAttribute("data-has-content"),
    ).toBe("true");
    expect(
      screen.getByTestId("preview-probe").getAttribute("data-loading"),
    ).toBe("false");
  });

  it("maps fetch failure to PANEL_PREVIEW_ERROR without spinning forever", async () => {
    vi.mocked(fetchVaultContent).mockRejectedValue(
      new Error("Vault file not found (404)"),
    );

    render(<PreviewProbe path="/Projects/A/missing.md" />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-error")).toBeTruthy();
    });

    const probe = screen.getByTestId("preview-probe");
    expect(probe.getAttribute("data-status")).toBe("error");
    expect(probe.getAttribute("data-loading")).toBe("false");
    expect(probe.getAttribute("data-has-content")).toBe("false");
    expect(probe.getAttribute("data-error")).toBe("not_found");
  });

  it("ignores stale responses after openGeneration bump (reload race)", async () => {
    let resolveFirst: (v: typeof MD) => void = () => {};
    const first = new Promise<typeof MD>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(fetchVaultContent)
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        ...MD,
        content: "# Reloaded body\n",
      });

    function ReloadProbe() {
      const [state, dispatch] = useReducer(
        artifactPanelReducer,
        undefined,
        createInitialArtifactPanelState,
      );
      const preview = useDocumentPanePreview(state, dispatch);

      useEffect(() => {
        dispatch({
          type: "PANEL_OPEN",
          ref: { path: "/Projects/A/README.md", title: "README.md" },
        });
      }, []);

      return (
        <div>
          <button
            type="button"
            data-testid="reload"
            onClick={() => dispatch({ type: "PANEL_RELOAD" })}
          >
            Reload
          </button>
          <div
            data-testid="reload-probe"
            data-generation={String(state.openGeneration)}
            data-has-content={String(preview.content != null)}
            data-body={preview.content?.content ?? ""}
            data-loading={String(preview.isLoading)}
          />
        </div>
      );
    }

    render(<ReloadProbe />);

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledTimes(1);
    });

    // Bump generation before the first fetch settles.
    screen.getByTestId("reload").click();

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledTimes(2);
    });

    // Stale first response must not win.
    resolveFirst(MD);

    await waitFor(() => {
      const probe = screen.getByTestId("reload-probe");
      expect(probe.getAttribute("data-loading")).toBe("false");
      expect(probe.getAttribute("data-body")).toContain("Reloaded body");
    });

    // Generation advanced twice from open + reload.
    expect(
      Number(screen.getByTestId("reload-probe").getAttribute("data-generation")),
    ).toBeGreaterThanOrEqual(2);
  });

  it("artifact.updated from closed stays opening until bytes load", async () => {
    vi.mocked(fetchVaultContent).mockResolvedValue(MD);

    render(
      <PreviewProbe path="/Projects/A/README.md" openViaUpdated />,
    );

    // Must not skip straight to previewing without a fetch.
    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    await waitFor(() => {
      const probe = screen.getByTestId("preview-probe");
      expect(probe.getAttribute("data-has-content")).toBe("true");
      expect(probe.getAttribute("data-status")).toBe("previewing");
    });
  });
});
