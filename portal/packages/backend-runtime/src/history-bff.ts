/**
 * Thin BFF adapter: signed-operation history and current-head reads
 * through {@link BackendRuntimeService} (lp-ye4.7).
 *
 * ## Production path
 *
 * ```text
 * GET  /api/vault/history?path=…     → listArtifactHistory(service, ctx, path)
 *                                      → capability gate + path ACL
 *                                      → BackendRuntimeService.listHistory?
 *                                      → Brain RPC history.list
 *
 * GET  /api/vault/heads/artifact?path=… → getArtifactHeadRead(service, ctx, path)
 *                                      → heads.artifact
 *
 * GET  /api/vault/heads/workspace     → getWorkspaceHeadRead(service, ctx)
 *                                      → heads.workspace
 * ```
 *
 * BFF **stamps** {@link BackendRuntimeContext} from session/gateway (never from
 * the browser body) and **enforces path ACL** before returning history or
 * artifact heads. Advertise methods only when the host implements them.
 *
 * Domain: docs/architecture/signed-operation-ledger.md
 */

import { BackendRuntimeError, backendRuntimeErrorToHttpStatus } from "./errors.js";
import type { BackendRuntimeService } from "./service.js";
import type {
  ArtifactHead,
  SignedOperationEvent,
  WorkspaceHead,
} from "./signed-operation.js";
import type {
  BackendRuntimeContext,
  HeadsArtifactParams,
  HeadsWorkspaceParams,
  HistoryListParams,
  HistoryListResult,
} from "./types.js";
import {
  isVaultPathAllowedByPrefixes,
  normalizeVaultWirePath,
  resolveAclPrefixes,
} from "./vault-bff.js";

/** Brain RPC method names for history / heads. */
export const HISTORY_LIST_METHOD = "history.list" as const;
export const HEADS_ARTIFACT_METHOD = "heads.artifact" as const;
export const HEADS_WORKSPACE_METHOD = "heads.workspace" as const;

export const HISTORY_LIST_DEFAULT_LIMIT = 50;
export const HISTORY_LIST_MAX_LIMIT = 200;

/** HTTP body for path-scoped history. */
export type HistoryListHttpBody = {
  path: string;
  events: SignedOperationEvent[];
  next_cursor?: string | null;
  truncated: boolean;
  source: string;
};

/** HTTP body for artifact head. */
export type ArtifactHeadHttpBody = ArtifactHead & {
  source: string;
};

/** HTTP body for workspace head. */
export type WorkspaceHeadHttpBody = WorkspaceHead & {
  source: string;
};

export type HistoryHttpErrorBody = {
  error: string;
  code: string;
  retryable?: boolean;
  unavailable?: boolean;
  method?: string;
  path?: string;
};

export type ListArtifactHistoryOptions = {
  /**
   * When true (default), refuse unless capabilities advertise history_read
   * and brain_rpc_methods includes history.list.
   */
  requireCapabilityAdvertisement?: boolean;
};

export type ReadHeadsOptions = {
  /**
   * When true (default), refuse unless capabilities advertise heads_read
   * and the corresponding method is listed.
   */
  requireCapabilityAdvertisement?: boolean;
};

/**
 * Whether the backend advertises history.list (expansion).
 */
export function historyListIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  const methods = caps.brain_rpc_methods ?? [];
  return caps.features?.history_read === true && methods.includes(HISTORY_LIST_METHOD);
}

/**
 * Whether the backend advertises heads.artifact / heads.workspace.
 */
export function headsReadIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  const methods = caps.brain_rpc_methods ?? [];
  return (
    caps.features?.heads_read === true &&
    (methods.includes(HEADS_ARTIFACT_METHOD) ||
      methods.includes(HEADS_WORKSPACE_METHOD))
  );
}

export function headsArtifactIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  const methods = caps.brain_rpc_methods ?? [];
  return (
    caps.features?.heads_read === true && methods.includes(HEADS_ARTIFACT_METHOD)
  );
}

export function headsWorkspaceIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  const methods = caps.brain_rpc_methods ?? [];
  return (
    caps.features?.heads_read === true && methods.includes(HEADS_WORKSPACE_METHOD)
  );
}

function assertPathAccess(
  ctx: BackendRuntimeContext,
  path: string,
  method: string,
): string {
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const normalized = normalizeVaultWirePath(path);
  if (!isVaultPathAllowedByPrefixes(prefixes, normalized)) {
    throw new BackendRuntimeError(
      "forbidden",
      `Vault path not permitted for user role: ${normalized}`,
      {
        retryable: false,
        details: { method, path: normalized },
      },
    );
  }
  return normalized;
}

/**
 * Clamp history.list limit to contract bounds.
 */
export function clampHistoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return HISTORY_LIST_DEFAULT_LIMIT;
  }
  const n = Math.trunc(limit);
  if (n < 1) return 1;
  if (n > HISTORY_LIST_MAX_LIMIT) return HISTORY_LIST_MAX_LIMIT;
  return n;
}

/**
 * Domain → wire params for history.list Brain RPC.
 */
export function historyListParamsToWire(
  params: HistoryListParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: params.path,
    limit: clampHistoryLimit(params.limit),
  };
  if (params.cursor !== undefined) {
    out.cursor = params.cursor;
  }
  if (params.includeRejected !== undefined) {
    out.include_rejected = params.includeRejected;
  }
  return out;
}

/**
 * Domain → wire params for heads.artifact.
 */
export function headsArtifactParamsToWire(
  params: HeadsArtifactParams,
): Record<string, unknown> {
  return { path: params.path };
}

/**
 * Domain → wire params for heads.workspace.
 */
export function headsWorkspaceParamsToWire(
  params?: HeadsWorkspaceParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params?.workspaceId !== undefined) {
    out.workspace_id = params.workspaceId;
  }
  return out;
}

function normalizeHistoryListResult(
  raw: unknown,
  fallbackPath: string,
): HistoryListResult {
  if (typeof raw !== "object" || raw === null) {
    throw new BackendRuntimeError(
      "internal",
      "history.list returned non-object result",
      { retryable: false, details: { method: HISTORY_LIST_METHOD } },
    );
  }
  const r = raw as Record<string, unknown>;
  const path =
    typeof r.path === "string" && r.path.length > 0 ? r.path : fallbackPath;
  const events = Array.isArray(r.events)
    ? (r.events as SignedOperationEvent[])
    : [];
  const truncated = r.truncated === true;
  const next =
    r.next_cursor === null || typeof r.next_cursor === "string"
      ? (r.next_cursor as string | null)
      : truncated
        ? null
        : null;
  return {
    path,
    events,
    next_cursor: next,
    truncated,
  };
}

/**
 * List artifact history for a path.
 * Stamps ACL from ctx; gates on capability advertisement.
 */
export async function listArtifactHistory(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  params: HistoryListParams,
  options: ListArtifactHistoryOptions = {},
): Promise<HistoryListHttpBody> {
  const requireCap = options.requireCapabilityAdvertisement !== false;
  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!historyListIsAdvertised(caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        "history.list is not advertised by this backend; " +
          "enable features.history_read and brain_rpc_methods includes history.list",
        {
          retryable: false,
          details: { method: HISTORY_LIST_METHOD, path: params.path },
        },
      );
    }
  }

  const path = assertPathAccess(ctx, params.path, HISTORY_LIST_METHOD);
  if (!service.listHistory) {
    throw new BackendRuntimeError(
      "method_not_found",
      "history.list is not implemented by this backend runtime service",
      {
        retryable: false,
        details: { method: HISTORY_LIST_METHOD, path },
      },
    );
  }

  const result = await service.listHistory(ctx, {
    path,
    limit: clampHistoryLimit(params.limit),
    cursor: params.cursor,
    includeRejected: params.includeRejected,
  });

  // Defense-in-depth: drop any host-returned events outside subject ACL.
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const events = (result.events ?? []).filter((ev) => {
    const tpath = ev?.target?.path;
    if (typeof tpath !== "string") return false;
    return isVaultPathAllowedByPrefixes(prefixes, tpath);
  });

  return {
    path: result.path || path,
    events,
    next_cursor: result.next_cursor ?? null,
    truncated: result.truncated === true,
    source: "brain_rpc",
  };
}

/**
 * Read current artifact head for a path (ACL + capability gated).
 */
export async function getArtifactHeadRead(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  params: HeadsArtifactParams,
  options: ReadHeadsOptions = {},
): Promise<ArtifactHeadHttpBody> {
  const requireCap = options.requireCapabilityAdvertisement !== false;
  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!headsArtifactIsAdvertised(caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        "heads.artifact is not advertised by this backend; " +
          "enable features.heads_read and brain_rpc_methods includes heads.artifact",
        {
          retryable: false,
          details: { method: HEADS_ARTIFACT_METHOD, path: params.path },
        },
      );
    }
  }

  const path = assertPathAccess(ctx, params.path, HEADS_ARTIFACT_METHOD);
  if (!service.readArtifactHead) {
    throw new BackendRuntimeError(
      "method_not_found",
      "heads.artifact is not implemented by this backend runtime service",
      {
        retryable: false,
        details: { method: HEADS_ARTIFACT_METHOD, path },
      },
    );
  }

  const head = await service.readArtifactHead(ctx, { path });
  // Re-check path on returned head.
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  if (!isVaultPathAllowedByPrefixes(prefixes, head.path)) {
    throw new BackendRuntimeError(
      "forbidden",
      `Vault path not permitted for user role: ${head.path}`,
      {
        retryable: false,
        details: { method: HEADS_ARTIFACT_METHOD, path: head.path },
      },
    );
  }

  return { ...head, source: "brain_rpc" };
}

/**
 * Read current workspace head (capability gated).
 * Workspace heads do not expose path bodies; still require advertisement.
 */
export async function getWorkspaceHeadRead(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  params: HeadsWorkspaceParams = {},
  options: ReadHeadsOptions = {},
): Promise<WorkspaceHeadHttpBody> {
  const requireCap = options.requireCapabilityAdvertisement !== false;
  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!headsWorkspaceIsAdvertised(caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        "heads.workspace is not advertised by this backend; " +
          "enable features.heads_read and brain_rpc_methods includes heads.workspace",
        {
          retryable: false,
          details: { method: HEADS_WORKSPACE_METHOD },
        },
      );
    }
  }

  if (!service.readWorkspaceHead) {
    throw new BackendRuntimeError(
      "method_not_found",
      "heads.workspace is not implemented by this backend runtime service",
      {
        retryable: false,
        details: { method: HEADS_WORKSPACE_METHOD },
      },
    );
  }

  const head = await service.readWorkspaceHead(ctx, params);
  return { ...head, source: "brain_rpc" };
}

/**
 * Map history/heads errors to HTTP status + body for route handlers.
 */
export function historyErrorToHttp(err: unknown): {
  status: number;
  body: HistoryHttpErrorBody;
} {
  if (err instanceof BackendRuntimeError) {
    const status = backendRuntimeErrorToHttpStatus(err.code);
    const unavailable =
      err.code === "method_not_found" ||
      err.code === "not_implemented" ||
      err.code === "unavailable";
    return {
      status,
      body: {
        error: err.message,
        code: err.code,
        retryable: err.retryable,
        ...(unavailable ? { unavailable: true } : {}),
        ...(typeof err.details?.method === "string"
          ? { method: err.details.method }
          : {}),
        ...(typeof err.details?.path === "string"
          ? { path: err.details.path }
          : {}),
      },
    };
  }
  return {
    status: 500,
    body: {
      error: err instanceof Error ? err.message : "Internal error",
      code: "internal",
      retryable: false,
    },
  };
}

/**
 * Bundle of history/head handlers for composition roots.
 */
export function createHistoryHandlers(service: BackendRuntimeService) {
  return {
    list: (
      ctx: BackendRuntimeContext,
      params: HistoryListParams,
      options?: ListArtifactHistoryOptions,
    ) => listArtifactHistory(service, ctx, params, options),
    artifactHead: (
      ctx: BackendRuntimeContext,
      params: HeadsArtifactParams,
      options?: ReadHeadsOptions,
    ) => getArtifactHeadRead(service, ctx, params, options),
    workspaceHead: (
      ctx: BackendRuntimeContext,
      params?: HeadsWorkspaceParams,
      options?: ReadHeadsOptions,
    ) => getWorkspaceHeadRead(service, ctx, params, options),
  };
}

/** Normalize Brain RPC history.list result (hermes adapter). */
export function normalizeHistoryListWireResult(
  raw: unknown,
  fallbackPath: string,
): HistoryListResult {
  return normalizeHistoryListResult(raw, fallbackPath);
}
