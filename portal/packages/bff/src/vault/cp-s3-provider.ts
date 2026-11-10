/**
 * BFF vault provider that reads CP HTTP list/get (lp-oop.10).
 *
 * Maps CP vault JSON onto {@link VaultContentProvider} tree/entries/content
 * shapes. Selected only when `VaultPlane=cp_s3` (lp-oop.11). Default plane
 * is unchanged. No @aws-sdk; CP is the only S3 caller. Does not call ensureOnline.
 */

import { normalizeVaultPath } from "@lanyard/shared";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type ControlPlaneRequestFn,
} from "../control-plane-client.js";
import { isTextMime, mimeForPath } from "./mime.js";
import { DEFAULT_VAULT_READ_MAX_BYTES } from "./path-security.js";
import type {
  VaultContentProvider,
  VaultEntry,
  VaultFileContent,
  VaultTreeNode,
} from "./types.js";

/** Must stay in sync with CP `VAULT_HTTP_API_PATHS` (lp-oop.9 / lp-zuh.12.7). */
export const VAULT_CP_HTTP_PATHS = {
  list: (tenantId: string) => `/internal/tenants/${tenantId}/vault/list`,
  stat: (tenantId: string) => `/internal/tenants/${tenantId}/vault/stat`,
  get: (tenantId: string) => `/internal/tenants/${tenantId}/vault/get`,
  put: (tenantId: string) => `/internal/tenants/${tenantId}/vault/put`,
} as const;

const DEFAULT_MAX_TREE_DEPTH = 8;
const MAX_LIST_PAGES = 32;

export type CpS3VaultHttpEntryKind = "file" | "directory";

export type CpS3VaultHttpEntry = {
  path: string;
  name: string;
  kind: CpS3VaultHttpEntryKind;
  size_bytes?: number;
  etag?: string;
  mtime?: string;
  content_type?: string;
};

export type CpS3VaultHttpListResponse = {
  tenant_id: string;
  path: string;
  s3_vault_prefix: string;
  entries: CpS3VaultHttpEntry[];
  next_cursor?: string;
  truncated: boolean;
};

export type CpS3VaultHttpGetResponse = {
  tenant_id: string;
  path: string;
  kind: "file";
  body: string;
  encoding: "utf-8" | "base64";
  content_type: string;
  size_bytes: number;
  etag?: string;
  mtime?: string;
  s3_vault_prefix: string;
};

export type CpS3VaultProviderOptions = {
  tenantId: string | (() => string);
  baseUrl: string;
  requestFn?: ControlPlaneRequestFn;
  serviceToken?: string;
  maxReadBytes?: number;
  maxTreeDepth?: number;
  /** Page size sent as `max_keys`. Tests use a small value to force cursors. */
  listPageSize?: number;
};

export function createCpS3VaultContentProvider(
  options: CpS3VaultProviderOptions,
): VaultContentProvider {
  const requestFn = options.requestFn ?? fetch;
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_VAULT_READ_MAX_BYTES;
  const maxTreeDepth = options.maxTreeDepth ?? DEFAULT_MAX_TREE_DEPTH;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  function resolveTenantId(): string {
    return typeof options.tenantId === "function"
      ? options.tenantId()
      : options.tenantId;
  }

  function headers(tenantId: string): Headers {
    const next = new Headers();
    if (options.serviceToken) {
      next.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, options.serviceToken);
    }
    next.set("x-lanyard-tenant-id", tenantId);
    return next;
  }

  function url(path: string, query: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        params.set(key, value);
      }
    }
    const encoded = params.toString();
    return encoded ? `${baseUrl}${path}?${encoded}` : `${baseUrl}${path}`;
  }

  async function requestJson(
    tenantId: string,
    path: string,
    query: Record<string, string | undefined>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await requestFn(url(path, query), {
      method: "GET",
      headers: headers(tenantId),
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { status: response.status, body };
  }

  async function listPage(
    tenantId: string,
    vaultPath: string,
    cursor?: string,
  ): Promise<CpS3VaultHttpListResponse> {
    const { status, body } = await requestJson(
      tenantId,
      VAULT_CP_HTTP_PATHS.list(tenantId),
      {
        path: vaultPath,
        cursor,
        max_keys:
          options.listPageSize !== undefined
            ? String(options.listPageSize)
            : undefined,
      },
    );
    if (!statusOk(status)) {
      throw vaultHttpError(status, body, "Failed to list vault");
    }
    return parseListResponse(body, tenantId, vaultPath);
  }

  async function listAllEntries(rawPath: string): Promise<VaultEntry[]> {
    const vaultPath = normalizeVaultPath(rawPath);
    const tenantId = resolveTenantId();
    const collected: VaultEntry[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listed = await listPage(tenantId, vaultPath, cursor);
      for (const entry of listed.entries) {
        const mapped = mapListEntry(entry);
        if (mapped) {
          collected.push(mapped);
        }
      }
      if (!listed.truncated || !listed.next_cursor) {
        break;
      }
      cursor = listed.next_cursor;
    }
    return collected.sort(compareEntries);
  }

  async function buildTree(
    dirPath: string,
    depth: number,
  ): Promise<VaultTreeNode[]> {
    if (depth > maxTreeDepth) {
      return [];
    }
    const entries = await listAllEntries(dirPath);
    const nodes: VaultTreeNode[] = [];
    for (const entry of entries) {
      if (entry.kind === "directory") {
        const children =
          depth < maxTreeDepth
            ? await buildTree(entry.path, depth + 1)
            : [];
        nodes.push({
          name: entry.name,
          path: entry.path,
          kind: "directory",
          children,
        });
      } else {
        nodes.push({
          name: entry.name,
          path: entry.path,
          kind: "file",
          mime_type: entry.mime_type,
        });
      }
    }
    return nodes;
  }

  return {
    async listEntries(rawPath: string): Promise<VaultEntry[]> {
      try {
        return await listAllEntries(rawPath);
      } catch (error) {
        if (isMissingVaultError(error)) {
          return [];
        }
        throw error;
      }
    },

    async readFile(rawPath: string): Promise<VaultFileContent | null> {
      const vaultPath = normalizeVaultPath(rawPath);
      const tenantId = resolveTenantId();
      const { status, body } = await requestJson(
        tenantId,
        VAULT_CP_HTTP_PATHS.get(tenantId),
        { path: vaultPath },
      );
      if (status === 404 || isNotAFile(status, body)) {
        return null;
      }
      if (!statusOk(status)) {
        throw vaultHttpError(status, body, "Failed to read vault file");
      }
      return mapFileContent(body, vaultPath, maxReadBytes);
    },

    async getTree(): Promise<VaultTreeNode[]> {
      return buildTree("/", 0);
    },
  };
}

function statusOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function isNotAFile(status: number, body: Record<string, unknown>): boolean {
  return status === 400 && body.code === "VAULT_NOT_A_FILE";
}

function isMissingVaultError(error: unknown): boolean {
  return (
    error instanceof ControlPlaneRequestError &&
    (error.status === 404 || error.code === "VAULT_OBJECT_NOT_FOUND")
  );
}

function vaultHttpError(
  status: number,
  body: Record<string, unknown>,
  fallback: string,
): ControlPlaneRequestError {
  const message =
    typeof body.error === "string" && body.error.length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === "string" ? body.code : undefined;
  return new ControlPlaneRequestError(status, message, code);
}

function parseListResponse(
  body: Record<string, unknown>,
  tenantId: string,
  vaultPath: string,
): CpS3VaultHttpListResponse {
  const entries = Array.isArray(body.entries)
    ? body.entries.filter(isHttpEntry)
    : [];
  return {
    tenant_id:
      typeof body.tenant_id === "string" ? body.tenant_id : tenantId,
    path: typeof body.path === "string" ? body.path : vaultPath,
    s3_vault_prefix:
      typeof body.s3_vault_prefix === "string" ? body.s3_vault_prefix : "",
    entries,
    ...(typeof body.next_cursor === "string"
      ? { next_cursor: body.next_cursor }
      : {}),
    truncated: body.truncated === true,
  };
}

function isHttpEntry(value: unknown): value is CpS3VaultHttpEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    typeof entry.name === "string" &&
    (entry.kind === "file" || entry.kind === "directory")
  );
}

function mapListEntry(entry: CpS3VaultHttpEntry): VaultEntry | null {
  if (entry.name.startsWith(".")) {
    return null;
  }
  if (entry.kind === "directory") {
    return { name: entry.name, path: entry.path, kind: "directory" };
  }
  return {
    name: entry.name,
    path: entry.path,
    kind: "file",
    mime_type: entry.content_type || mimeForPath(entry.name),
  };
}

function mapFileContent(
  body: Record<string, unknown>,
  vaultPath: string,
  maxReadBytes: number,
): VaultFileContent | null {
  if (typeof body.body !== "string") {
    return null;
  }
  const path = typeof body.path === "string" ? body.path : vaultPath;
  const mime =
    (typeof body.content_type === "string" && body.content_type) ||
    mimeForPath(path);
  const raw = body.body;
  const declaredSize =
    typeof body.size_bytes === "number" && Number.isFinite(body.size_bytes)
      ? body.size_bytes
      : Buffer.byteLength(raw, "utf-8");
  if (declaredSize > maxReadBytes) {
    return null;
  }

  if (isTextMime(mime) && body.encoding !== "base64") {
    return {
      path,
      kind: "file",
      mime_type: mime,
      encoding: "utf-8",
      content: raw,
      size_bytes: declaredSize,
    };
  }

  const binary =
    body.encoding === "base64"
      ? Buffer.from(raw, "base64")
      : Buffer.from(raw, "utf-8");
  if (binary.length > maxReadBytes) {
    return null;
  }
  return {
    path,
    kind: "file",
    mime_type: mime,
    encoding: "base64",
    content: binary.toString("base64"),
    size_bytes: binary.length,
  };
}

function compareEntries(a: VaultEntry, b: VaultEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
