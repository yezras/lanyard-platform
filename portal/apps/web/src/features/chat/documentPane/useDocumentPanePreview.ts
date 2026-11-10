/**
 * Fetch vault content for the open document pane generation.
 * Dispatches PANEL_PREVIEW_READY / PANEL_PREVIEW_ERROR — never sets status directly.
 *
 * Beads: lp-5q6.13, lp-dpr.1 (chrome without body — generation-scoped load).
 */

import {
  useEffect,
  useState,
  type Dispatch,
} from "react";

import { fetchVaultContent } from "../../../api/vault.js";
import type { VaultFileContent } from "../../../api/types.js";

import { mapVaultPreviewError } from "./mapPreviewError.js";
import { paneMetrics } from "./paneMetrics.js";
import type { ArtifactPanelAction, ArtifactPanelState } from "./types.js";

export type DocumentPanePreview = {
  content: VaultFileContent | null;
  isLoading: boolean;
};

type PreviewSnapshot = {
  /** openGeneration this snapshot was fetched for. */
  generation: number;
  content: VaultFileContent | null;
  /**
   * True while a fetch for `generation` is in flight.
   * Cleared on settle (ready or error) or when the pane closes.
   */
  inFlight: boolean;
};

const EMPTY_SNAPSHOT: PreviewSnapshot = {
  generation: 0,
  content: null,
  inFlight: false,
};

/**
 * Load preview bytes when the pane opens or reloads (openGeneration bump).
 * No-op while closed. Stale responses for older generations are ignored.
 *
 * lp-dpr.1: content and loading are generation-scoped so a settle never paints
 * toolbar chrome with an empty body ("Select a file") while a fetch is owed,
 * and bytes for gen N never appear as the body for gen N+1.
 *
 * Pane open/load/error counters (lp-5q6.33) record codes only — never path/body.
 */
export function useDocumentPanePreview(
  state: ArtifactPanelState,
  dispatch: Dispatch<ArtifactPanelAction>,
): DocumentPanePreview {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>(EMPTY_SNAPSHOT);

  const isOpen = state.status !== "closed" && state.ref != null;
  const path = state.ref?.path ?? null;
  const openGeneration = state.openGeneration;

  useEffect(() => {
    if (!isOpen || !path) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    let cancelled = false;
    const generation = openGeneration;
    setSnapshot({
      generation,
      content: null,
      inFlight: true,
    });
    // Metadata-only: no path/title/body in counters.
    paneMetrics.record("open");

    void fetchVaultContent(path)
      .then((file) => {
        if (cancelled) return;
        setSnapshot({
          generation,
          content: file,
          inFlight: false,
        });
        paneMetrics.record("load");
        dispatch({
          type: "PANEL_PREVIEW_READY",
          openGeneration: generation,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSnapshot({
          generation,
          content: null,
          inFlight: false,
        });
        const mapped = mapVaultPreviewError(err, path);
        paneMetrics.record("error", mapped.code);
        dispatch({
          type: "PANEL_PREVIEW_ERROR",
          openGeneration: generation,
          error: mapped,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, isOpen, openGeneration, path]);

  // Generation-scoped projection: never surface stale bytes or a false "idle".
  if (!isOpen || !path) {
    return { content: null, isLoading: false };
  }

  const matchesGeneration = snapshot.generation === openGeneration;
  const content = matchesGeneration ? snapshot.content : null;

  // Settled error for this generation → stop spinning (error chrome via panel).
  if (
    matchesGeneration &&
    !snapshot.inFlight &&
    content == null &&
    state.status === "error"
  ) {
    return { content: null, isLoading: false };
  }

  // Any open generation without bytes is loading — including the first paint
  // before the effect runs — so path chrome never pairs with "Select a file".
  return { content, isLoading: content == null };
}
