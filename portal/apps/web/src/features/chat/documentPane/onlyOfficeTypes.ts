/**
 * Client types for ONLYOFFICE editor host (lp-5q6.27).
 *
 * Browser never builds document URLs / JWT — only consumes BFF mint output.
 * Field names on editor_config match ONLYOFFICE Docs API + BFF editor-config.
 */

/** ONLYOFFICE documentType values. */
export type OnlyOfficeDocumentType = "word" | "cell" | "slide" | "pdf";

export type OfficeSessionMode = "view" | "edit";

/** Office-family extensions the host can open (aligned with BFF OFFICE_DOWNLOAD_FILE_TYPES). */
export type OfficeFileType =
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "doc"
  | "xls"
  | "ppt"
  | "odt"
  | "ods"
  | "odp";

export type OnlyOfficePermissions = {
  edit: boolean;
  review: boolean;
  comment: boolean;
  download: boolean;
  print: boolean;
  fillForms: boolean;
  modifyFilter: boolean;
  modifyContentControl: boolean;
  copy: boolean;
  chat: boolean;
};

export type OnlyOfficeDocumentConfig = {
  fileType: OfficeFileType | string;
  key: string;
  title: string;
  url: string;
  permissions: OnlyOfficePermissions;
};

export type OnlyOfficeEditorConfigInner = {
  mode: OfficeSessionMode;
  callbackUrl: string;
  user: {
    id: string;
    name: string;
  };
  lang: string;
};

/**
 * Config object returned by POST /api/office/sessions (editor_config).
 * Passed straight to DocsAPI.DocEditor (plus height/width/events).
 */
export type OnlyOfficeEditorConfig = {
  documentType: OnlyOfficeDocumentType;
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfigInner;
  /** HS256 JWT over documentType + document + editorConfig. */
  token: string;
};

export type DocumentRevisionWire = {
  token: string;
  kind: string;
  size_bytes?: number;
  modified_at?: string;
};

/**
 * Typed Office session payload for the React host.
 * Opaque session id + BFF editor_config + Document Server origin for api.js.
 */
export type OfficeEditorSessionConfig = {
  sessionId: string;
  documentKey: string;
  mode: OfficeSessionMode;
  fileType: OfficeFileType | string;
  path: string;
  expiresAt: string;
  baseRevision: DocumentRevisionWire;
  editorConfig: OnlyOfficeEditorConfig;
  /**
   * Browser-reachable Document Server origin used to load api.js.
   * Not part of BFF mint body — from feature env / runtime flags.
   */
  documentServerUrl: string;
};

/** Lifecycle / failure codes the host surfaces in the pane body. */
export type OfficeEditorErrorCode =
  | "load_failure"
  | "unsupported_file"
  | "no_edit_permission"
  | "callback_save_issue"
  | "config_missing"
  | "config_mint_failed"
  | "not_enabled";

export type OfficeEditorHostError = {
  code: OfficeEditorErrorCode;
  message: string;
  /** Optional operator-safe detail (no tokens / paths required). */
  detail?: string;
  retryable?: boolean;
};

/** Callbacks the pane / ChatView may bind (dirty is UX-only). */
export type OfficeEditorHostLifecycle = {
  onReady?: () => void;
  onDocumentReady?: () => void;
  onError?: (error: OfficeEditorHostError) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveIssue?: (error: OfficeEditorHostError) => void;
  onRequestClose?: () => void;
};

/** Minimal DocsAPI surface used by the host (mockable in tests). */
export type DocsApiDocEditor = {
  destroyEditor?: () => void;
};

export type DocsApiConstructor = new (
  placeholderId: string,
  config: Record<string, unknown>,
) => DocsApiDocEditor;

export type DocsApiGlobal = {
  DocEditor: DocsApiConstructor;
};

declare global {
  interface Window {
    DocsAPI?: DocsApiGlobal;
  }
}
