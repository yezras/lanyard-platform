/**
 * ONLYOFFICE editor host renderer (lp-5q6.27).
 *
 * Embeds Document Server UI from a BFF-minted editor config. Does not own
 * path ACL, JWT minting, or callback writeback. Mount only when the feature
 * flag is on and a session config (or structured error) is available.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { loadOnlyOfficeDocsApi } from "./onlyOfficeApiLoader.js";
import {
  mapSaveFailureToEditorError,
  officeEditorError,
} from "./onlyOfficeEditorErrors.js";
import { officeEditorMetrics } from "./onlyOfficeEditorMetrics.js";
import type {
  DocsApiDocEditor,
  OfficeEditorHostError,
  OfficeEditorHostLifecycle,
  OfficeEditorSessionConfig,
} from "./onlyOfficeTypes.js";

export type OnlyOfficeEditorHostProps = OfficeEditorHostLifecycle & {
  /**
   * Typed Office session + editor_config from BFF.
   * When null and no `error`, host shows config_missing (or loading).
   */
  session: OfficeEditorSessionConfig | null;
  /** Precomputed error (mint failure, unsupported type, no permission). */
  error?: OfficeEditorHostError | null;
  /** When true, show spinner while parent is minting config. */
  isLoading?: boolean;
  /**
   * Optional DocsAPI loader injection (tests). Defaults to loadOnlyOfficeDocsApi.
   */
  loadDocsApi?: typeof loadOnlyOfficeDocsApi;
};

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  height: "100%",
  width: "100%",
  position: "relative",
};

const frameStyle: CSSProperties = {
  flex: 1,
  minHeight: 280,
  minWidth: 0,
  width: "100%",
  height: "100%",
  border: "0",
  background: "var(--bg-secondary, #f4f4f5)",
};

const overlayStyle: CSSProperties = {
  ...rootStyle,
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--spacing-4, 1rem)",
  gap: "var(--spacing-3, 0.75rem)",
};

function ErrorBody({ error }: { error: OfficeEditorHostError }) {
  return (
    <div
      style={overlayStyle}
      data-testid="onlyoffice-editor-error"
      data-error-code={error.code}
      role="alert"
    >
      <Banner
        status="error"
        title={titleForCode(error.code)}
        description={
          error.detail ? `${error.message} (${error.detail})` : error.message
        }
      />
    </div>
  );
}

function titleForCode(code: OfficeEditorHostError["code"]): string {
  switch (code) {
    case "load_failure":
      return "Editor failed to load";
    case "unsupported_file":
      return "Unsupported file type";
    case "no_edit_permission":
      return "No edit permission";
    case "callback_save_issue":
      return "Save problem";
    case "config_missing":
      return "Editor config missing";
    case "config_mint_failed":
      return "Could not open Office session";
    case "not_enabled":
      return "Office editor disabled";
    default:
      return "Office editor error";
  }
}

/**
 * Mount DocsAPI.DocEditor for a BFF-minted session config.
 * Surfaces structured errors for load / permission / save issues.
 */
export function OnlyOfficeEditorHost({
  session,
  error: externalError = null,
  isLoading = false,
  loadDocsApi = loadOnlyOfficeDocsApi,
  onReady,
  onDocumentReady,
  onError,
  onDirtyChange,
  onSaveIssue,
  onRequestClose,
}: OnlyOfficeEditorHostProps) {
  const reactId = useId();
  const placeholderId = `oo-editor-${reactId.replace(/:/g, "")}`;
  const editorRef = useRef<DocsApiDocEditor | null>(null);
  const [internalError, setInternalError] =
    useState<OfficeEditorHostError | null>(null);
  const [mounting, setMounting] = useState(false);

  const displayError = externalError ?? internalError;

  useEffect(() => {
    if (externalError) {
      setInternalError(null);
      return;
    }
    if (isLoading) {
      return;
    }
    if (!session) {
      const err = officeEditorError("config_missing");
      setInternalError(err);
      onError?.(err);
      officeEditorMetrics.recordLoad({
        outcome: "error",
        error_code: err.code,
      });
      return;
    }

    if (!session.editorConfig?.token || !session.editorConfig.document?.key) {
      const err = officeEditorError(
        "config_missing",
        "editor_config incomplete",
      );
      setInternalError(err);
      onError?.(err);
      officeEditorMetrics.recordLoad({
        outcome: "error",
        error_code: err.code,
      });
      return;
    }

    // Edit requested but permissions deny edit — explicit error state.
    if (
      session.mode === "edit" &&
      session.editorConfig.document.permissions?.edit === false
    ) {
      const err = officeEditorError("no_edit_permission");
      setInternalError(err);
      onError?.(err);
      officeEditorMetrics.recordLoad({
        outcome: "denied",
        error_code: err.code,
      });
      return;
    }

    let cancelled = false;
    setMounting(true);
    setInternalError(null);

    void (async () => {
      try {
        const api = await loadDocsApi({
          documentServerUrl: session.documentServerUrl,
        });
        if (cancelled) return;

        // Destroy previous instance if any.
        try {
          editorRef.current?.destroyEditor?.();
        } catch {
          // ignore destroy races
        }
        editorRef.current = null;

        const placeholder = document.getElementById(placeholderId);
        if (!placeholder) {
          throw new Error("editor placeholder missing");
        }
        // Clear residual DOM from prior mounts.
        placeholder.replaceChildren();

        const cfg = session.editorConfig;
        const editorConfig = {
          documentType: cfg.documentType,
          document: cfg.document,
          editorConfig: cfg.editorConfig,
          token: cfg.token,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: () => {
              if (cancelled) return;
              onReady?.();
            },
            onDocumentReady: () => {
              if (cancelled) return;
              onDocumentReady?.();
            },
            onDocumentStateChange: (event: { data?: boolean }) => {
              if (cancelled) return;
              onDirtyChange?.(Boolean(event?.data));
            },
            onError: (event: { data?: unknown }) => {
              if (cancelled) return;
              const err = officeEditorError(
                "load_failure",
                typeof event?.data === "string"
                  ? event.data
                  : "DocsAPI onError",
              );
              setInternalError(err);
              onError?.(err);
              officeEditorMetrics.recordLoad({
                outcome: "error",
                error_code: err.code,
              });
            },
            onWarning: (event: { data?: { warningCode?: number } }) => {
              // ONLYOFFICE uses warning codes for some save/callback issues.
              if (cancelled) return;
              const code = event?.data?.warningCode;
              if (code === undefined) return;
              // Wire lp-5q6.28 user-facing save copy (not generic load error).
              const err = mapSaveFailureToEditorError({
                code: "callback_save_issue",
                detail: `warningCode=${code}`,
              });
              setInternalError(err);
              onSaveIssue?.(err);
            },
            onRequestSave: () => {
              // Document Server is about to call callbackUrl — host stays ready.
            },
            onRequestSaveAs: () => {
              // Not supported in vault path model; surface as non-fatal save issue.
              if (cancelled) return;
              const err = mapSaveFailureToEditorError({
                code: "save_rejected",
                detail: "save_as_not_supported",
              });
              onSaveIssue?.(err);
            },
            onRequestClose: () => {
              if (cancelled) return;
              onRequestClose?.();
            },
          },
        };

        editorRef.current = new api.DocEditor(placeholderId, editorConfig);
        if (!cancelled) {
          setMounting(false);
          officeEditorMetrics.recordLoad({ outcome: "success" });
        }
      } catch (err) {
        if (cancelled) return;
        const mapped = officeEditorError(
          "load_failure",
          err instanceof Error ? err.message : String(err),
        );
        setInternalError(mapped);
        setMounting(false);
        onError?.(mapped);
        officeEditorMetrics.recordLoad({
          outcome: "error",
          error_code: mapped.code,
        });
      }
    })();

    return () => {
      cancelled = true;
      try {
        editorRef.current?.destroyEditor?.();
      } catch {
        // ignore
      }
      editorRef.current = null;
    };
    // Intentionally key on session identity fields, not whole object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are optional parent hooks
  }, [
    externalError,
    isLoading,
    session?.sessionId,
    session?.documentKey,
    session?.mode,
    session?.documentServerUrl,
    session?.editorConfig?.token,
    placeholderId,
    loadDocsApi,
  ]);

  if (displayError) {
    return <ErrorBody error={displayError} />;
  }

  if (isLoading || (mounting && !session)) {
    return (
      <div
        style={overlayStyle}
        data-testid="onlyoffice-editor-loading"
        role="status"
        aria-busy="true"
      >
        <Spinner size="md" />
        <Text type="supporting" color="secondary">
          Opening Office editor…
        </Text>
      </div>
    );
  }

  return (
    <div
      className="onlyoffice-editor-host"
      data-testid="onlyoffice-editor-host"
      data-session-id={session?.sessionId ?? ""}
      data-file-type={session?.fileType ?? ""}
      data-mode={session?.mode ?? ""}
      style={rootStyle}
    >
      {(isLoading || mounting) && (
        <div
          style={{
            ...overlayStyle,
            position: "absolute",
            inset: 0,
            background: "var(--bg-primary, #fff)",
            zIndex: 1,
          }}
          data-testid="onlyoffice-editor-loading"
          role="status"
          aria-busy="true"
        >
          <Spinner size="md" />
          <Text type="supporting" color="secondary">
            Loading editor…
          </Text>
        </div>
      )}
      <VStack gap={0} style={{ flex: 1, minHeight: 0, height: "100%" }}>
        <div
          id={placeholderId}
          data-testid="onlyoffice-editor-frame"
          style={frameStyle}
        />
      </VStack>
    </div>
  );
}
