import { withApiBase } from "./tenantBase.js";
import type {
  ArtifactHeadResponse,
  VaultEntriesResponse,
  VaultFileContent,
  VaultHistoryResponse,
  VaultSearchResponse,
  VaultTreeResponse,
  WorkspaceHeadResponse,
} from "./types.js";

type ApiErrorBody = {
  error?: string;
  code?: string;
  unavailable?: boolean;
  method?: string;
  path?: string;
  retryable?: boolean;
};

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? fallback;
}

/** Structured history/heads API error (ACL / capability / unavailable). */
export class VaultHistoryApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly unavailable: boolean;
  readonly method?: string;
  readonly path?: string;

  constructor(
    message: string,
    opts: {
      code: string;
      status: number;
      unavailable?: boolean;
      method?: string;
      path?: string;
    },
  ) {
    super(message);
    this.name = "VaultHistoryApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.unavailable = opts.unavailable === true;
    this.method = opts.method;
    this.path = opts.path;
  }
}

async function parseHistoryError(
  res: Response,
  fallback: string,
): Promise<VaultHistoryApiError> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return new VaultHistoryApiError(body.error ?? fallback, {
    code: body.code ?? (res.status === 403 ? "forbidden" : "upstream"),
    status: res.status,
    unavailable: body.unavailable === true || res.status === 404,
    method: body.method,
    path: body.path,
  });
}

export async function fetchVaultTree(): Promise<VaultTreeResponse> {
  const res = await fetch(withApiBase("/api/vault/tree"), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Vault tree failed (${res.status})`));
  }
  return (await res.json()) as VaultTreeResponse;
}

export async function fetchVaultEntries(
  path: string,
  cursor?: string | null,
): Promise<VaultEntriesResponse> {
  const params = new URLSearchParams({ path });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const res = await fetch(withApiBase(`/api/vault/entries?${params.toString()}`), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Vault entries failed (${res.status})`));
  }
  return (await res.json()) as VaultEntriesResponse;
}

export async function fetchVaultContent(path: string): Promise<VaultFileContent> {
  const res = await fetch(
    withApiBase(`/api/vault/content?path=${encodeURIComponent(path)}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(await parseError(res, `Failed to open file (${res.status})`));
  }
  const contentType = res.headers?.get?.("content-type") ?? "";
  if (/html/i.test(contentType)) {
    throw new Error(
      `Failed to open file (${res.status}): vault returned HTML, not JSON`,
    );
  }
  return (await res.json()) as VaultFileContent;
}

export async function searchVaultIndex(query: string): Promise<VaultSearchResponse> {
  const res = await fetch(
    withApiBase(`/api/vault/search?q=${encodeURIComponent(query)}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(await parseError(res, `Vault search failed (${res.status})`));
  }
  return (await res.json()) as VaultSearchResponse;
}

/**
 * List signed-operation history for a vault path (lp-ye4.11).
 * Metadata only — never body bytes. BFF enforces path ACL.
 */
export async function fetchVaultHistory(
  path: string,
  options: {
    limit?: number;
    cursor?: string | null;
    includeRejected?: boolean;
  } = {},
): Promise<VaultHistoryResponse> {
  const params = new URLSearchParams({ path });
  if (options.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.includeRejected) {
    params.set("include_rejected", "true");
  }
  const res = await fetch(
    withApiBase(`/api/vault/history?${params.toString()}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    throw await parseHistoryError(
      res,
      `Vault history failed (${res.status})`,
    );
  }
  return (await res.json()) as VaultHistoryResponse;
}

/**
 * Current artifact head for a path (revision, operation_id, actor, head_kind).
 * Never returns file bytes.
 */
export async function fetchArtifactHead(
  path: string,
): Promise<ArtifactHeadResponse> {
  const res = await fetch(
    withApiBase(`/api/vault/heads/artifact?path=${encodeURIComponent(path)}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    throw await parseHistoryError(
      res,
      `Artifact head failed (${res.status})`,
    );
  }
  return (await res.json()) as ArtifactHeadResponse;
}

/** Workspace tree currentness head. */
export async function fetchWorkspaceHead(
  workspaceId?: string,
): Promise<WorkspaceHeadResponse> {
  const params = new URLSearchParams();
  if (workspaceId) {
    params.set("workspace_id", workspaceId);
  }
  const qs = params.toString();
  const res = await fetch(
    withApiBase(`/api/vault/heads/workspace${qs ? `?${qs}` : ""}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    throw await parseHistoryError(
      res,
      `Workspace head failed (${res.status})`,
    );
  }
  return (await res.json()) as WorkspaceHeadResponse;
}

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Whether the path/mime is an Office binary. Used only for download MIME
 * hardening (lp-upc): force octet-stream so the OS does not auto-launch
 * LibreOffice/X11 via content-type association.
 */
function isOfficeDownloadPath(path: string, mime: string): boolean {
  const name = basename(path).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (
    ["docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp"].includes(
      ext,
    )
  ) {
    return true;
  }
  const m = mime.toLowerCase();
  return (
    m.includes("wordprocessingml") ||
    m.includes("spreadsheetml") ||
    m.includes("presentationml") ||
    m === "application/msword" ||
    m.includes("ms-excel") ||
    m.includes("ms-powerpoint") ||
    m.includes("officedocument")
  );
}

/**
 * Fetch vault file content and trigger a browser download.
 *
 * Explicit Download only — never the default open path. Portal open always
 * stays in-browser (VaultReader / document pane). Office blobs use
 * application/octet-stream so Linux does not associate and launch X11 apps.
 */
export async function downloadVaultFile(path: string): Promise<void> {
  const content = await fetchVaultContent(path);
  const filename = basename(content.path);
  const office = isOfficeDownloadPath(content.path, content.mime_type);
  // Force save-as for Office so MIME does not open host LibreOffice/X11.
  const blobType = office
    ? "application/octet-stream"
    : content.encoding === "base64"
      ? content.mime_type || "application/octet-stream"
      : content.mime_type || "text/plain;charset=utf-8";
  let blob: Blob;
  if (content.encoding === "base64") {
    const bytes = base64ToBytes(content.content);
    blob = new Blob([bytes.buffer as ArrayBuffer], { type: blobType });
  } else {
    blob = new Blob([content.content], { type: blobType });
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    // Never navigate the tab / open file:// or external handler as primary.
    anchor.target = "_self";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
