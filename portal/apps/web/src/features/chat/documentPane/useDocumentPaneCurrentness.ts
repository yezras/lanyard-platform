/**
 * Fetch authoritative artifact head + optional history for the open pane
 * (lp-ye4.11). Never treats chat event payloads as vault body bytes.
 */

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
} from "react";

import {
  fetchArtifactHead,
  fetchVaultHistory,
  VaultHistoryApiError,
} from "../../../api/vault.js";

import {
  evaluateStaleHead,
  type ArtifactHeadView,
  type CurrentnessDisplay,
  type HistoryEventView,
  type HistoryListView,
  type StaleHeadDecision,
} from "./currentness.js";
import type { ArtifactPanelAction, ArtifactPanelState } from "./types.js";

function isHistoryUnavailable(err: unknown): boolean {
  if (err instanceof VaultHistoryApiError) {
    return err.unavailable || err.code === "method_not_found";
  }
  // Duck-type mocks / cross-bundle Error subclasses.
  if (typeof err === "object" && err !== null) {
    const e = err as {
      code?: string;
      unavailable?: boolean;
      name?: string;
      status?: number;
    };
    if (e.unavailable === true || e.code === "method_not_found") return true;
    if (e.name === "VaultHistoryApiError" && e.status === 404) return true;
  }
  return false;
}

export type DocumentPaneCurrentness = {
  currentness: CurrentnessDisplay | null;
  head: ArtifactHeadView | null;
  staleDecision: StaleHeadDecision | null;
  history: HistoryListView | null;
  historyEvents: HistoryEventView[];
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  isLoadingHead: boolean;
  isLoadingHistory: boolean;
  headError: string | null;
  historyError: string | null;
  historyUnavailable: boolean;
  refresh: () => void;
};

/**
 * Load heads.artifact when the pane opens / reloads. Optionally load
 * history.list when the history panel is expanded.
 *
 * Stale decisions:
 * - dirty + advanced head → PANEL_CONFLICT (reload / discard actions)
 * - clean + advanced head → soft stale banner (user-triggered reload)
 * - checkpoint sibling head → PANEL_EVENT checkpoint offer
 */
export function useDocumentPaneCurrentness(
  state: ArtifactPanelState,
  dispatch: Dispatch<ArtifactPanelAction>,
): DocumentPaneCurrentness {
  const [head, setHead] = useState<ArtifactHeadView | null>(null);
  const [currentness, setCurrentness] = useState<CurrentnessDisplay | null>(
    null,
  );
  const [staleDecision, setStaleDecision] = useState<StaleHeadDecision | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryListView | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isLoadingHead, setIsLoadingHead] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [headError, setHeadError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const isOpen = state.status !== "closed" && state.ref != null;
  const path = state.ref?.path ?? null;
  const openGeneration = state.openGeneration;
  const knownRevisionToken = state.knownRevision?.token ?? null;
  const dirty = state.localDirty || state.status === "editing";
  const knownRevision = state.knownRevision;
  const status = state.status;
  const hasCheckpointOffer = state.checkpointOffer != null;

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  // Heads: load when pane path / generation changes.
  useEffect(() => {
    if (!isOpen || !path) {
      setHead(null);
      setCurrentness(null);
      setStaleDecision(null);
      setHeadError(null);
      setIsLoadingHead(false);
      setHistoryOpen(false);
      setHistory(null);
      return;
    }

    let cancelled = false;
    setIsLoadingHead(true);
    setHeadError(null);

    void fetchArtifactHead(path)
      .then((h) => {
        if (cancelled) return;
        setHead(h);
        const decision = evaluateStaleHead({
          openPath: path,
          knownRevision,
          dirty,
          head: h,
        });
        setCurrentness(decision.currentness);
        setStaleDecision(decision);

        if (decision.action === "conflict" && status !== "conflict") {
          dispatch({ type: "PANEL_CONFLICT", conflict: decision.conflict });
        } else if (
          decision.action === "checkpoint_offer" &&
          !hasCheckpointOffer
        ) {
          dispatch({
            type: "PANEL_EVENT",
            event: {
              type: "updated",
              ref: decision.checkpointOffer.ref,
              revision: decision.checkpointOffer.revision,
              writeKind: "checkpoint",
              sourcePath: decision.checkpointOffer.sourcePath,
              operationId: h.operation_id,
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHead(null);
        setCurrentness(null);
        setStaleDecision(null);
        if (isHistoryUnavailable(err)) {
          // Heads optional when host does not advertise ledger reads.
          setHeadError(null);
        } else {
          setHeadError(
            err instanceof Error ? err.message : "Failed to load currentness",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHead(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    dirty,
    hasCheckpointOffer,
    isOpen,
    knownRevision,
    knownRevisionToken,
    openGeneration,
    path,
    refreshNonce,
    status,
  ]);

  // History: only when panel expanded.
  useEffect(() => {
    if (!isOpen || !path || !historyOpen) {
      return;
    }

    let cancelled = false;
    setIsLoadingHistory(true);
    setHistoryError(null);
    setHistoryUnavailable(false);

    void fetchVaultHistory(path, { limit: 50 })
      .then((list) => {
        if (cancelled) return;
        setHistory(list);
        setHistoryUnavailable(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistory(null);
        if (isHistoryUnavailable(err)) {
          setHistoryUnavailable(true);
          setHistoryError(
            err instanceof Error ? err.message : "History unavailable",
          );
        } else {
          setHistoryUnavailable(false);
          setHistoryError(
            err instanceof Error ? err.message : "Failed to load history",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [historyOpen, isOpen, path, refreshNonce, openGeneration]);

  return {
    currentness,
    head,
    staleDecision,
    history,
    historyEvents: history?.events ?? [],
    historyOpen,
    setHistoryOpen,
    isLoadingHead,
    isLoadingHistory,
    headError,
    historyError,
    historyUnavailable,
    refresh,
  };
}
