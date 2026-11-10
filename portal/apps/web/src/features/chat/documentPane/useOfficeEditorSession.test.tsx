/**
 * Hook tests: flag off keeps editor inactive; flag on mints config API (mocked).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MintOfficeSessionSuccess } from "../../../api/office.js";
import { OfficeApiError } from "../../../api/office.js";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { useOfficeEditorSession } from "./useOfficeEditorSession.js";

const MINT_OK: MintOfficeSessionSuccess = {
  session_id: "sess-ok",
  document_key: "dk-ok",
  base_revision: { token: "r1", kind: "etag" },
  mode: "view",
  file_type: "docx",
  path: "/Projects/A/Proposal.docx",
  expires_at: "2099-01-01T00:00:00.000Z",
  editor_config: {
    documentType: "word",
    document: {
      fileType: "docx",
      key: "dk-ok",
      title: "Proposal.docx",
      url: "https://bff/content",
      permissions: {
        edit: false,
        review: false,
        comment: false,
        download: true,
        print: true,
        fillForms: false,
        modifyFilter: false,
        modifyContentControl: false,
        copy: true,
        chat: false,
      },
    },
    editorConfig: {
      mode: "view",
      callbackUrl: "https://bff/callback",
      user: { id: "u1", name: "Ada" },
      lang: "en",
    },
    token: "jwt",
  },
  idempotent_replay: false,
};

function Probe(props: {
  path: string;
  enabled: boolean;
  /** Panel mode for open (lp-5q6.30: chat mints only in edit). */
  mode?: "preview" | "edit";
  mint: typeof import("../../../api/office.js").mintOfficeSession;
}) {
  const [state, dispatch] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  useEffect(() => {
    dispatch({
      type: "PANEL_OPEN",
      ref: { path: props.path, title: "doc" },
      mode: props.mode ?? "edit",
    });
  }, [props.path, props.mode]);

  const office = useOfficeEditorSession({
    state,
    dispatch,
    enabled: props.enabled,
    documentServerUrl: "https://ds.test",
    mint: props.mint,
  });

  return (
    <div
      data-testid="probe"
      data-active={String(office.active)}
      data-loading={String(office.isLoading)}
      data-session={office.session?.sessionId ?? ""}
      data-error={office.error?.code ?? ""}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("useOfficeEditorSession", () => {
  it("stays inactive when flag is off (previews path)", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_OK);
    render(
      <Probe
        path="/Projects/A/Proposal.docx"
        enabled={false}
        mint={mint}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").getAttribute("data-active")).toBe(
        "false",
      );
    });
    // Allow any open-generation effects to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(mint).not.toHaveBeenCalled();
  });

  it("stays inactive for non-Office paths even when flag is on", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_OK);
    render(
      <Probe path="/Projects/A/README.md" enabled={true} mint={mint} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").getAttribute("data-active")).toBe(
        "false",
      );
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mint).not.toHaveBeenCalled();
  });

  it("mints config when flag on and path is Office/PDF (edit mode)", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_OK);
    render(
      <Probe
        path="/Projects/A/Proposal.docx"
        enabled={true}
        mode="edit"
        mint={mint}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").getAttribute("data-session")).toBe(
        "sess-ok",
      );
    });
    expect(mint).toHaveBeenCalled();
    expect(screen.getByTestId("probe").getAttribute("data-active")).toBe(
      "true",
    );
  });

  it("stays inactive when enabled is forced false (chat preview mode)", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_OK);
    render(
      <Probe
        path="/Projects/A/Proposal.docx"
        enabled={false}
        mode="preview"
        mint={mint}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").getAttribute("data-active")).toBe(
        "false",
      );
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mint).not.toHaveBeenCalled();
  });

  it("maps unsupported mint errors", async () => {
    const mint = vi.fn().mockRejectedValue(
      new OfficeApiError("Unsupported file type", 400, "unsupported_file_type"),
    );
    render(
      <Probe path="/Projects/A/Proposal.docx" enabled={true} mint={mint} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").getAttribute("data-error")).toBe(
        "unsupported_file",
      );
    });
  });
});
