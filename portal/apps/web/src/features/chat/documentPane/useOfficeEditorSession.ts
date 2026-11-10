/**
 * Mint BFF Office editor config for the chat/vault document host.
 *
 * lp-5q6.27: flag + Office path gate the host.
 * lp-5q6.30: chat pane activates only when the renderer decision says so
 * (edit mode + capability + flag + type). Callers pass `enabled: false` to
 * keep VaultReader previews when the user is in view-only mode.
 *
 * Flag off or non-Office path → inactive; DocumentPane keeps previews.
 */

import {
  useEffect,
  useState,
  type Dispatch,
} from "react";

import {
  mintOfficeSession,
  toOfficeEditorSessionConfig,
  OfficeApiError,
} from "../../../api/office.js";

import { isOfficeEditorPath, officeFileTypeFromPath } from "./isOfficeEditorFile.js";
import {
  getOnlyOfficeDocumentServerUrl,
  isOnlyOfficeEditorEnabled,
  validateOnlyOfficeDocumentServerUrl,
} from "./onlyOfficeFeatureFlag.js";
import { mapMintFailureToEditorError } from "./onlyOfficeEditorErrors.js";
import type {
  OfficeEditorHostError,
  OfficeEditorSessionConfig,
} from "./onlyOfficeTypes.js";
import type { ArtifactPanelAction, ArtifactPanelState } from "./types.js";

/**
 * Resolve a Document Server origin for mint/session config.
 * Explicit option (tests/stories) uses scheme rules only; default path is
 * fully validated against the trusted allowlist (lp-p37.3).
 */
function resolveSessionDocumentServerUrl(override?: string): string {
  if (typeof override === "string" && override.trim()) {
    const validated = validateOnlyOfficeDocumentServerUrl(override, {
      skipAllowlist: true,
      allowLocalhost: true,
    });
    return validated.ok ? validated.origin : "";
  }
  return getOnlyOfficeDocumentServerUrl();
}

export type OfficeEditorSessionState = {
  /**
   * True when the host should use OnlyOfficeEditorHost.
   * Chat (lp-5q6.30): only when edit mode + gates; Vault sets enabled while editing.
   */
  active: boolean;
  session: OfficeEditorSessionConfig | null;
  error: OfficeEditorHostError | null;
  isLoading: boolean;
};

export type UseOfficeEditorSessionOptions = {
  state: ArtifactPanelState;
  dispatch: Dispatch<ArtifactPanelAction>;
  /**
   * Override feature flag (tests) or force inactive.
   * Chat pane passes `false` while mode is preview so VaultReader stays the body.
   */
  enabled?: boolean;
  /** Override DS URL (tests / story). */
  documentServerUrl?: string;
  /** Inject mint (tests). */
  mint?: typeof mintOfficeSession;
};

/**
 * When enabled + Office path, mint editor config for the current openGeneration.
 * Stale responses are ignored. Non-Office paths stay on previews (active=false).
 */
export function useOfficeEditorSession(
  options: UseOfficeEditorSessionOptions,
): OfficeEditorSessionState {
  const {
    state,
    dispatch,
    enabled: enabledOverride,
    documentServerUrl,
    mint = mintOfficeSession,
  } = options;

  const flagOn = isOnlyOfficeEditorEnabled(enabledOverride);
  const path = state.ref?.path ?? null;
  const isOpen = state.status !== "closed" && path != null;
  const officePath = isOpen && isOfficeEditorPath(path);
  const active = flagOn && officePath;
  const openGeneration = state.openGeneration;
  // Prefer edit mint when the pane is in edit mode; view is for explicit
  // view-only Office hosts (vault / lab). Chat preview mode leaves active=false.
  const mode = state.mode === "edit" ? "edit" : "view";

  const [session, setSession] = useState<OfficeEditorSessionConfig | null>(
    null,
  );
  const [error, setError] = useState<OfficeEditorHostError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!active || !path) {
      setSession(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const generation = openGeneration;
    const fileType = officeFileTypeFromPath(path);
    setIsLoading(true);
    setSession(null);
    setError(null);

    void mint({
      path,
      mode,
      title: state.ref?.title,
      file_type: fileType ?? undefined,
      caller_key: `pane-${generation}`,
      revision: state.knownRevision
        ? {
            token: state.knownRevision.token,
            kind: state.knownRevision.kind,
            ...(state.knownRevision.sizeBytes != null
              ? { size_bytes: state.knownRevision.sizeBytes }
              : {}),
            ...(state.knownRevision.modifiedAt
              ? { modified_at: state.knownRevision.modifiedAt }
              : {}),
          }
        : undefined,
    })
      .then((minted) => {
        if (cancelled) return;
        const ds = resolveSessionDocumentServerUrl(documentServerUrl);
        if (!ds) {
          setSession(null);
          setIsLoading(false);
          setError(
            mapMintFailureToEditorError({
              status: 500,
              message:
                "ONLYOFFICE Document Server URL is missing or failed validation",
            }),
          );
          return;
        }
        const cfg = toOfficeEditorSessionConfig(minted, ds);
        setSession(cfg);
        setIsLoading(false);
        dispatch({
          type: "PANEL_SESSION_BOUND",
          sessionId: cfg.sessionId,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSession(null);
        setIsLoading(false);
        if (err instanceof OfficeApiError) {
          setError(
            mapMintFailureToEditorError({
              status: err.status,
              reason: err.reason,
              message: err.message,
            }),
          );
        } else {
          setError(
            mapMintFailureToEditorError({
              status: 500,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    active,
    path,
    openGeneration,
    mode,
    dispatch,
    mint,
    documentServerUrl,
    state.ref?.title,
    state.knownRevision?.token,
    state.knownRevision?.kind,
    state.knownRevision?.sizeBytes,
    state.knownRevision?.modifiedAt,
  ]);

  if (!flagOn || !officePath) {
    return {
      active: false,
      session: null,
      error: null,
      isLoading: false,
    };
  }

  return { active, session, error, isLoading };
}
