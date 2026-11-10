/**
 * Thin BFF adapter: vault browser routes through {@link BackendRuntimeService}.
 *
 * Beads: `lp-t7q.2` (list/stat/read), `lp-5q6.19` (capability-gated vault.write).
 *
 * ## Production path
 *
 * ```text
 * GET  /api/vault/tree     → getVaultTree(service, ctx)
 *                            → listVault recursive (vault.list) per ACL prefix
 * GET  /api/vault/entries  → listVaultEntries(service, ctx, path, { cursor })
 *                            → BackendRuntimeService.listVault → vault.list
 * GET  /api/vault/content  → readVaultContent(service, ctx, path)
 *                            → BackendRuntimeService.readVault → vault.read
 * PUT  /api/vault/content  → writeVaultFromBrowser(service, ctx, body)
 *                            → capability gate + ACL stamp
 *                            → BackendRuntimeService.writeVault? → vault.write
 * ```
 *
 * Document Server callback writeback (lp-5q6.23) reuses
 * {@link writeVaultFromCallback} with a separate origin validator — never the
 * browser body parser.
 *
 * Production composition injects `invokeBrainRpc` with `brainRpcPreferred: true`
 * and `vaultRequireBrainRpc: true` so vault never falls back to local
 * FS/fixture providers when Brain RPC is the production path.
 *
 * ## Fail-closed
 *
 * - Flag off (BFF): local VaultService + fixture/FS (test/dev only).
 * - Flag on + host unhealthy / RPC error: surface error (or empty tree when
 *   soft-empty is requested) — never silent customer-looking fixture data.
 * - vault.write missing capability / method → clear method_not_found (404).
 *
 * ## Search
 *
 * Vault search index stays on the local/fixture index provider until a
 * dedicated Brain RPC search method exists. This module covers
 * list/stat/read tree + content and capability-gated write.
 */

import { projectToVaultRelativePath } from "@lanyard/shared";

import { BackendRuntimeError, backendRuntimeErrorToHttpStatus } from "./errors.js";
import type { BackendRuntimeService } from "./service.js";
import type {
  BackendRuntimeContext,
  DocumentRevision,
  DocumentRevisionKind,
  VaultEntry,
  VaultListResult,
  VaultReadResult,
  VaultWriteContentRef,
  VaultWriteMode,
  VaultWriteParams,
  VaultWriteResult,
} from "./types.js";

/** Brain RPC method names for vault browser / write. */
export const VAULT_LIST_METHOD = "vault.list" as const;
export const VAULT_STAT_METHOD = "vault.stat" as const;
export const VAULT_READ_METHOD = "vault.read" as const;
export const VAULT_WRITE_METHOD = "vault.write" as const;

/** Inline content plane limits (aligned with vault.read / vault.write contract). */
export const VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES = 1_048_576;
export const VAULT_WRITE_INLINE_HARD_MAX_BYTES = 4_194_304;
export const VAULT_WRITE_IDEMPOTENCY_KEY_MAX = 128;
export const VAULT_WRITE_REVISION_TOKEN_MAX = 256;
export const VAULT_WRITE_MIME_TYPE_MAX = 200;

/**
 * Who initiated the write. Browser, Document Server callback, and agent/Brain
 * RPC use separate validators; all stamp subject/tenant/session/profile/
 * pathPrefixes from BFF/gateway context — never from the client body.
 *
 * ## Origin policy for `write_checkpoint` (lp-ye4.10 / lp-5q6.32)
 *
 * | Origin | write_checkpoint |
 * | --- | --- |
 * | `browser` | **reject** — human PUT `/api/vault/content` is canonical create/replace only |
 * | `document_server_callback` | **reject** — Office save always `replace_if_match` on bound path |
 * | `agent` | **accept** — agent tools under dirty human ownership stage a checkpoint |
 */
export type VaultWriteOrigin =
  | "browser"
  | "document_server_callback"
  | "agent";

/**
 * Soft caps for tree walk over vault.list (avoid unbounded host fan-out).
 *
 * Walk is **breadth-first / sibling-first**: all top-level ACL roots are
 * materialised before any deep expansion, so a deep early directory cannot
 * exhaust the node budget and hide later siblings (lp-8ty).
 */
export const VAULT_TREE_MAX_DEPTH = 8;
export const VAULT_TREE_MAX_NODES = 500;
export const VAULT_LIST_PAGE_LIMIT = 200;

/**
 * HTTP tree node — compatible with current portal vault browser
 * (`packages/bff` VaultTreeNode / web VaultTreeNode).
 */
export type VaultTreeHttpNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  mime_type?: string;
  description?: string;
  children?: VaultTreeHttpNode[];
};

/** GET /api/vault/tree body. */
export type VaultTreeHttpBody = {
  roots: VaultTreeHttpNode[];
  /** Origin tag for honesty / diagnostics (brain_rpc). */
  source: string;
  /** True when host was unavailable and soft-empty tree was returned. */
  unavailable?: boolean;
  /**
   * True when the node budget (or similar) stopped the walk early so some
   * siblings/descendants may be missing. Never silently partial.
   */
  truncated?: boolean;
  /** Machine-readable reason when truncated (e.g. `max_nodes`). */
  truncated_reason?: string;
};

/** GET /api/vault/entries body. */
export type VaultEntriesHttpBody = {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    kind: "file" | "directory";
    mime_type?: string;
  }>;
  source: string;
  truncated?: boolean;
  next_cursor?: string | null;
};

/** GET /api/vault/content body — matches current VaultFileContent. */
export type VaultContentHttpBody = {
  path: string;
  kind: "file";
  mime_type: string;
  encoding: "utf-8" | "base64";
  content: string;
  size_bytes: number;
  source: string;
};

/** PUT /api/vault/content success body (browser write). */
export type VaultWriteHttpBody = {
  path: string;
  revision: DocumentRevision;
  etag?: string;
  size_bytes: number;
  mime_type: string;
  written_at: string;
  created?: boolean;
  idempotent_replay?: boolean;
  /** Echo of canonical source when mode was write_checkpoint. */
  source_path?: string;
  /** write_checkpoint success SHOULD set `checkpoint`. */
  write_kind?: "create" | "replace" | "checkpoint" | "conflict_copy";
  /** Optional signed-operation ledger commit metadata (lp-ye4.8). */
  commit?: VaultWriteResult["commit"];
  source: string;
};

export type VaultHttpErrorBody = {
  error: string;
  code: string;
  retryable?: boolean;
  unavailable?: boolean;
  method?: string;
  /** Present on CAS / create conflict (409). */
  reason?: string;
  expected_revision_token?: string;
  actual_revision_token?: string;
};

export type WriteVaultOptions = {
  /**
   * When true (default), refuse write unless capabilities advertise vault_write
   * and brain_rpc_methods includes vault.write.
   */
  requireCapabilityAdvertisement?: boolean;
  /**
   * Max decoded inline body bytes. Default 1 MiB; hard cap 4 MiB.
   * content_ref writes are not bounded by this (host enforces aggregate max).
   */
  maxInlineBytes?: number;
  /** Write origin — selects origin-specific validation already applied by parsers. */
  origin: VaultWriteOrigin;
};

export type GetVaultTreeOptions = {
  /**
   * When true (default false), unavailable/timeout host errors become
   * `{ roots: [], source: "brain_rpc", unavailable: true }` instead of throw.
   * Content/entries always throw — only tree soft-empties for UI stability.
   */
  emptyOnUnavailable?: boolean;
  maxDepth?: number;
  maxNodes?: number;
};

export type ListVaultEntriesOptions = {
  /** Opaque vault.list cursor for the next directory page. */
  cursor?: string | null;
};

/**
 * Normalize vault-root-relative path (leading slash, no `..`).
 * Host-absolute agent paths that embed a known vault top-level (Clients,
 * Projects, …) are projected to vault-root-relative first (lp-vnz.3).
 * Throws {@link BackendRuntimeError} `invalid_argument` on bad input.
 */
export function normalizeVaultWirePath(path: string): string {
  const trimmed = typeof path === "string" ? path.trim() : "";
  if (trimmed.length === 0) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "Vault path is required",
      { retryable: false, details: { method: VAULT_LIST_METHOD } },
    );
  }
  // Project host disk paths (`/home/…/Lanyard/Clients/…`) → `/Clients/…`
  // before ACL / vault.read. No-op for multi-root paths without vault shape.
  const projected = projectToVaultRelativePath(trimmed);
  const withSlash = projected.startsWith("/") ? projected : `/${projected}`;
  const segments = withSlash.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === ".." || s === "." || s.includes("\0"))) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `Invalid vault path: ${path}`,
      { retryable: false, details: { path, method: VAULT_LIST_METHOD } },
    );
  }
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

/**
 * ACL check aligned with shared `isVaultPathAllowed` (portal RBAC):
 * empty prefix list → deny all; `/` → allow all; otherwise path must be
 * equal to a prefix or nested under it.
 *
 * Defense-in-depth on Brain RPC host results (lp-t7q.2 review).
 */
export function isVaultPathAllowedByPrefixes(
  allowedPrefixes: readonly string[],
  path: string,
): boolean {
  if (allowedPrefixes.length === 0) {
    return false;
  }
  let normalized: string;
  try {
    normalized = normalizeVaultWirePath(path);
  } catch {
    return false;
  }
  for (const rawPrefix of allowedPrefixes) {
    let prefix: string;
    try {
      const trimmed = typeof rawPrefix === "string" ? rawPrefix.trim() : "";
      if (trimmed === "") {
        prefix = "/";
      } else {
        prefix = normalizeVaultWirePath(trimmed);
      }
    } catch {
      continue;
    }
    if (prefix === "/") return true;
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

/** Drop entries whose path is outside the subject ACL prefixes. */
export function filterVaultEntriesByAcl(
  allowedPrefixes: readonly string[],
  entries: readonly VaultEntry[],
): VaultEntry[] {
  return entries.filter((entry) =>
    isVaultPathAllowedByPrefixes(allowedPrefixes, entry.path),
  );
}

/** Drop tree nodes outside ACL (recursive). */
export function filterVaultTreeByAcl(
  allowedPrefixes: readonly string[],
  nodes: readonly VaultTreeHttpNode[],
): VaultTreeHttpNode[] {
  const result: VaultTreeHttpNode[] = [];
  for (const node of nodes) {
    if (!isVaultPathAllowedByPrefixes(allowedPrefixes, node.path)) {
      continue;
    }
    const children = node.children
      ? filterVaultTreeByAcl(allowedPrefixes, node.children)
      : undefined;
    result.push({
      ...node,
      children: children && children.length > 0 ? children : undefined,
    });
  }
  return result;
}

/**
 * Normalize and collect ACL prefixes. Empty / all-invalid → `[]` (deny).
 * Does **not** invent a full-vault `"/"` walk when empty.
 */
export function resolveAclPrefixes(
  pathPrefixes: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of pathPrefixes) {
    try {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed === "") continue;
      const p = normalizeVaultWirePath(trimmed);
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    } catch {
      // skip invalid prefix
    }
  }
  return out;
}

function assertPathAccess(
  allowedPrefixes: readonly string[],
  path: string,
  method: string,
): string {
  const normalized = normalizeVaultWirePath(path);
  if (!isVaultPathAllowedByPrefixes(allowedPrefixes, normalized)) {
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

function entryName(path: string): string {
  if (path === "/") return "/";
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function isUnavailableError(err: unknown): boolean {
  return (
    err instanceof BackendRuntimeError &&
    (err.code === "unavailable" ||
      err.code === "timeout" ||
      err.code === "internal")
  );
}

function toHttpEntry(entry: VaultEntry): VaultEntriesHttpBody["entries"][number] {
  const out: VaultEntriesHttpBody["entries"][number] = {
    name: entry.name || entryName(entry.path),
    path: entry.path,
    kind: entry.kind === "directory" ? "directory" : "file",
  };
  if (typeof entry.mime_type === "string" && entry.mime_type.length > 0) {
    out.mime_type = entry.mime_type;
  }
  return out;
}

function normalizeListResult(raw: VaultListResult): VaultListResult {
  const path =
    typeof raw.path === "string" && raw.path.length > 0 ? raw.path : "/";
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  return {
    path,
    entries: entries
      .filter(
        (e): e is VaultEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof e.path === "string" &&
          (e.kind === "file" || e.kind === "directory"),
      )
      .map((e) => ({
        name: typeof e.name === "string" && e.name.length > 0 ? e.name : entryName(e.path),
        path: e.path,
        kind: e.kind,
        mime_type: e.mime_type ?? null,
        size_bytes: e.size_bytes ?? null,
        mtime: e.mtime ?? null,
      })),
    next_cursor: raw.next_cursor ?? null,
    truncated: Boolean(raw.truncated),
  };
}

/**
 * List a vault directory via BackendRuntimeService → vault.list.
 * BFF re-filters host entries by subject path prefixes (defense-in-depth).
 */
export async function listVaultEntries(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  path: string,
  options: ListVaultEntriesOptions = {},
): Promise<VaultEntriesHttpBody> {
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const normalized = assertPathAccess(prefixes, path, VAULT_LIST_METHOD);
  const raw = await service.listVault(ctx, {
    path: normalized,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    limit: VAULT_LIST_PAGE_LIMIT,
  });
  const listed = normalizeListResult(raw);
  const entries = filterVaultEntriesByAcl(prefixes, listed.entries);
  return {
    path: listed.path,
    entries: entries.map(toHttpEntry),
    source: "brain_rpc",
    truncated: listed.truncated,
    next_cursor: listed.next_cursor ?? null,
  };
}

/**
 * Read vault file content via BackendRuntimeService → vault.read.
 */
export async function readVaultContent(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  path: string,
): Promise<VaultContentHttpBody> {
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const normalized = assertPathAccess(prefixes, path, VAULT_READ_METHOD);
  const raw: VaultReadResult = await service.readVault(ctx, {
    path: normalized,
  });
  if (!raw || typeof raw !== "object") {
    throw new BackendRuntimeError(
      "internal",
      "vault.read returned empty result",
      { retryable: true, details: { method: VAULT_READ_METHOD, path: normalized } },
    );
  }
  const encoding = raw.encoding === "base64" ? "base64" : "utf-8";
  const content = typeof raw.content === "string" ? raw.content : "";
  const mime =
    typeof raw.mime_type === "string" && raw.mime_type.length > 0
      ? raw.mime_type
      : "application/octet-stream";
  const size_bytes =
    typeof raw.size_bytes === "number" && Number.isFinite(raw.size_bytes)
      ? raw.size_bytes
      : encoding === "base64"
        ? Math.floor((content.length * 3) / 4)
        : content.length;

  return {
    path: typeof raw.path === "string" && raw.path.length > 0 ? raw.path : normalized,
    kind: "file",
    mime_type: mime,
    encoding,
    content,
    size_bytes,
    source: "brain_rpc",
  };
}

/**
 * Stat a single vault path via BackendRuntimeService → vault.stat.
 */
export async function statVaultPath(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  path: string,
): Promise<VaultEntry & { source: string }> {
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const normalized = assertPathAccess(prefixes, path, VAULT_STAT_METHOD);
  const entry = await service.statVault(ctx, { path: normalized });
  return {
    name: entry.name || entryName(entry.path),
    path: entry.path,
    kind: entry.kind === "directory" ? "directory" : "file",
    mime_type: entry.mime_type ?? null,
    size_bytes: entry.size_bytes ?? null,
    mtime: entry.mtime ?? null,
    source: "brain_rpc",
  };
}

type TreeBudget = {
  nodes: number;
  maxNodes: number;
  truncated: boolean;
  truncatedReason?: string;
  allowedPrefixes: readonly string[];
};

/** Consume one node slot; returns false when the budget is exhausted. */
function tryConsumeNode(budget: TreeBudget): boolean {
  if (budget.nodes >= budget.maxNodes) {
    budget.truncated = true;
    budget.truncatedReason = budget.truncatedReason ?? "max_nodes";
    return false;
  }
  budget.nodes += 1;
  return true;
}

function vaultEntryToHttpNode(entry: VaultEntry): VaultTreeHttpNode {
  const node: VaultTreeHttpNode = {
    name: entry.name || entryName(entry.path),
    path: entry.path,
    kind: entry.kind === "directory" ? "directory" : "file",
  };
  if (typeof entry.mime_type === "string" && entry.mime_type.length > 0) {
    node.mime_type = entry.mime_type;
  }
  return node;
}

async function listAllEntries(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  path: string,
  allowedPrefixes: readonly string[],
): Promise<VaultEntry[]> {
  const collected: VaultEntry[] = [];
  let cursor: string | null | undefined = null;
  let pages = 0;
  const maxPages = 10;

  do {
    const raw = await service.listVault(ctx, {
      path,
      cursor: cursor ?? null,
      limit: VAULT_LIST_PAGE_LIMIT,
    });
    const listed = normalizeListResult(raw);
    // Defense-in-depth: never surface host entries outside subject ACL.
    collected.push(...filterVaultEntriesByAcl(allowedPrefixes, listed.entries));
    cursor = listed.truncated ? listed.next_cursor ?? null : null;
    pages += 1;
  } while (cursor && pages < maxPages);

  return collected;
}

type ExpandQueueItem = {
  node: VaultTreeHttpNode;
  /** Depth of `node` (0 = top-level root). Expand when depth < maxDepth. */
  depth: number;
};

/**
 * Resolve a non-`/` ACL prefix into a root entry (stat, with list fallback).
 * Returns null when forbidden / unusable.
 */
async function resolvePrefixRootEntry(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  prefix: string,
  allowedPrefixes: readonly string[],
): Promise<VaultEntry | null> {
  if (!isVaultPathAllowedByPrefixes(allowedPrefixes, prefix)) {
    return null;
  }

  let kind: "file" | "directory" = "directory";
  let mime_type: string | null = null;
  try {
    const st = await service.statVault(ctx, { path: prefix });
    kind = st.kind === "file" ? "file" : "directory";
    if (typeof st.mime_type === "string" && st.mime_type.length > 0) {
      mime_type = st.mime_type;
    }
  } catch (err) {
    if (err instanceof BackendRuntimeError && err.code === "not_found") {
      // Fall through — some hosts only implement list.
    } else if (
      err instanceof BackendRuntimeError &&
      err.code === "forbidden"
    ) {
      return null;
    } else {
      throw err;
    }
  }

  return {
    name: entryName(prefix),
    path: prefix,
    kind,
    mime_type,
  };
}

/**
 * Build ACL-scoped vault tree via vault.list/stat (no full-tree host dump).
 *
 * **Sibling-first BFS (lp-8ty):**
 * 1. Materialise every top-level root (immediate children of `/`, or one node
 *    per non-`/` ACL prefix) before any deep walk.
 * 2. Expand directories breadth-first up to maxDepth with the remaining budget.
 *
 * This prevents DFS from spending the entire node budget inside an early deep
 * directory (e.g. Archive) and silently omitting later top-level siblings.
 *
 * Roots = one node per subject path prefix (or top-level under `/` when
 * prefixes include full-vault access). Empty prefixes → empty roots (deny),
 * never a silent walk of `/`.
 *
 * When the node budget stops the walk early, the body includes
 * `truncated: true` and `truncated_reason`.
 */
export async function getVaultTree(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  options: GetVaultTreeOptions = {},
): Promise<VaultTreeHttpBody> {
  const maxDepth = options.maxDepth ?? VAULT_TREE_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? VAULT_TREE_MAX_NODES;
  const emptyOnUnavailable = options.emptyOnUnavailable === true;

  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  // BUG-1: empty ACL → empty tree; do not invent "/" full-vault walk.
  if (prefixes.length === 0) {
    return { roots: [], source: "brain_rpc", truncated: false };
  }

  const budget: TreeBudget = {
    nodes: 0,
    maxNodes,
    truncated: false,
    allowedPrefixes: prefixes,
  };

  try {
    const roots: VaultTreeHttpNode[] = [];
    const seen = new Set<string>();
    const expandQueue: ExpandQueueItem[] = [];

    // ------------------------------------------------------------------
    // Phase 1: all top-level roots first (never deep-walk yet).
    // ------------------------------------------------------------------
    for (const prefix of prefixes) {
      if (prefix === "/") {
        const entries = await listAllEntries(
          service,
          ctx,
          "/",
          budget.allowedPrefixes,
        );
        for (const entry of entries) {
          if (!isVaultPathAllowedByPrefixes(budget.allowedPrefixes, entry.path)) {
            continue;
          }
          if (seen.has(entry.path)) continue;
          if (!tryConsumeNode(budget)) {
            // Top-level itself overflowed maxNodes — remaining siblings dropped.
            break;
          }
          const node = vaultEntryToHttpNode(entry);
          seen.add(node.path);
          roots.push(node);
          if (node.kind === "directory" && maxDepth > 0) {
            expandQueue.push({ node, depth: 0 });
          }
        }
        continue;
      }

      // Non-root prefix: one root node per prefix (stat for kind/mime).
      if (seen.has(prefix)) continue;
      if (budget.nodes >= budget.maxNodes) {
        budget.truncated = true;
        budget.truncatedReason = budget.truncatedReason ?? "max_nodes";
        break;
      }
      const entry = await resolvePrefixRootEntry(
        service,
        ctx,
        prefix,
        budget.allowedPrefixes,
      );
      if (!entry) continue;
      if (!tryConsumeNode(budget)) break;
      const node = vaultEntryToHttpNode(entry);
      seen.add(node.path);
      roots.push(node);
      if (node.kind === "directory" && maxDepth > 0) {
        expandQueue.push({ node, depth: 0 });
      }
    }

    // ------------------------------------------------------------------
    // Phase 2: BFS expand directories — siblings at each level before deeper.
    // ------------------------------------------------------------------
    let qi = 0;
    while (qi < expandQueue.length) {
      if (budget.nodes >= budget.maxNodes) {
        budget.truncated = true;
        budget.truncatedReason = budget.truncatedReason ?? "max_nodes";
        break;
      }

      const { node, depth } = expandQueue[qi++]!;
      if (node.kind !== "directory" || depth >= maxDepth) {
        continue;
      }

      let children: VaultEntry[];
      try {
        children = await listAllEntries(
          service,
          ctx,
          node.path,
          budget.allowedPrefixes,
        );
      } catch (err) {
        // Directory disappeared or ACL denied mid-walk — keep node without children.
        if (
          err instanceof BackendRuntimeError &&
          (err.code === "not_found" || err.code === "forbidden")
        ) {
          continue;
        }
        throw err;
      }

      const childNodes: VaultTreeHttpNode[] = [];
      for (const child of children) {
        if (!isVaultPathAllowedByPrefixes(budget.allowedPrefixes, child.path)) {
          continue;
        }
        if (seen.has(child.path)) continue;
        if (!tryConsumeNode(budget)) {
          // Remaining children of this parent (and later dirs) omitted.
          break;
        }
        const childNode = vaultEntryToHttpNode(child);
        seen.add(childNode.path);
        childNodes.push(childNode);
        // Enqueue for next BFS level when we still have depth budget.
        if (childNode.kind === "directory" && depth + 1 < maxDepth) {
          expandQueue.push({ node: childNode, depth: depth + 1 });
        }
      }
      if (childNodes.length > 0) {
        node.children = childNodes;
      }
    }

    // Unprocessed expand queue means we stopped early (budget).
    if (qi < expandQueue.length) {
      budget.truncated = true;
      budget.truncatedReason = budget.truncatedReason ?? "max_nodes";
    }

    // Final ACL pass on assembled roots (defense-in-depth).
    const body: VaultTreeHttpBody = {
      roots: filterVaultTreeByAcl(prefixes, roots),
      source: "brain_rpc",
      truncated: budget.truncated,
    };
    if (budget.truncated && budget.truncatedReason) {
      body.truncated_reason = budget.truncatedReason;
    }
    return body;
  } catch (err) {
    if (emptyOnUnavailable && isUnavailableError(err)) {
      return {
        roots: [],
        source: "brain_rpc",
        unavailable: true,
        truncated: false,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// vault.write (lp-5q6.19)
// ---------------------------------------------------------------------------

const REVISION_KINDS = new Set<DocumentRevisionKind>([
  "etag",
  "content_hash",
  "host_revision",
  "mtime_size_fallback",
]);

const WRITE_MODES = new Set<VaultWriteMode>([
  "create_new",
  "replace_if_match",
  "replace_if_absent",
  "write_checkpoint",
]);

const CONTENT_REF_KINDS = new Set<VaultWriteContentRef["kind"]>([
  "bff_spool",
  "host_upload_session",
  "chunked_write_session",
]);

/**
 * Fields that must never appear on a browser or callback vault write body.
 * Tenant / absolute host paths / subject identity are stamped by the BFF only.
 */
const FORBIDDEN_CLIENT_WRITE_FIELDS = [
  "tenant_id",
  "tenantId",
  "instance_id",
  "instanceId",
  "user_id",
  "userId",
  "session_id",
  "sessionId",
  "portal_user_id",
  "subject",
  "auth",
  "path_prefixes",
  "pathPrefixes",
  "hermes_profile",
  "backend_profile",
  "profile",
  "roles",
  // lp-ye4.9: never accept client-forged actor / grant claims on write body.
  "actor",
  "grant_id",
  "grantId",
  "agent_id",
  "agentId",
  "run_id",
  "runId",
  "absolute_path",
  "absolutePath",
  "host_path",
  "hostPath",
  "vault_root",
  "vaultRoot",
  "fs_path",
  "fsPath",
] as const;

function writeInvalid(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new BackendRuntimeError("invalid_argument", message, {
    retryable: false,
    details: { method: VAULT_WRITE_METHOD, ...details },
  });
}

function requireWriteString(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    writeInvalid(`vault.write requires non-empty ${field}`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    writeInvalid(`vault.write ${field} exceeds ${max} characters`);
  }
  return trimmed;
}

/**
 * Reject absolute host filesystem paths (Unix / Windows drive / UNC).
 * Vault paths must be vault-root-relative (leading `/` is vault root, not host root).
 * Heuristic: reject multi-segment paths that look like /home, /var, /Users, C:\, \\share.
 */
export function assertVaultRelativeWritePath(path: string): string {
  const normalized = normalizeVaultWirePath(path);
  const lower = normalized.toLowerCase();
  // Host-looking absolute roots that must never be accepted from clients.
  const hostRoots = [
    "/home/",
    "/var/",
    "/tmp/",
    "/usr/",
    "/etc/",
    "/opt/",
    "/root/",
    "/users/",
    "/private/",
  ];
  for (const root of hostRoots) {
    if (lower === root.slice(0, -1) || lower.startsWith(root)) {
      writeInvalid(
        "vault.write path must be vault-root-relative; host filesystem paths are forbidden",
        { path: normalized },
      );
    }
  }
  // Windows drive / UNC disguised as vault path segments
  if (/^\/[a-z]:/i.test(normalized) || lower.startsWith("/\\\\")) {
    writeInvalid(
      "vault.write path must be vault-root-relative; host filesystem paths are forbidden",
      { path: normalized },
    );
  }
  return normalized;
}

function assertNoClientIdentityFields(raw: Record<string, unknown>): void {
  for (const key of FORBIDDEN_CLIENT_WRITE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      writeInvalid(
        `vault.write body must not include ${key}; BFF stamps subject, tenant, session, profile, and path prefixes`,
        { field: key },
      );
    }
  }
}

function parseDocumentRevision(
  value: unknown,
  field: string,
): DocumentRevision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    writeInvalid(`vault.write ${field} must be an object`);
  }
  const r = value as Record<string, unknown>;
  const token = requireWriteString(
    r.token,
    `${field}.token`,
    VAULT_WRITE_REVISION_TOKEN_MAX,
  );
  const kind = r.kind;
  if (typeof kind !== "string" || !REVISION_KINDS.has(kind as DocumentRevisionKind)) {
    writeInvalid(
      `vault.write ${field}.kind must be etag | content_hash | host_revision | mtime_size_fallback`,
    );
  }
  const revision: DocumentRevision = {
    token,
    kind: kind as DocumentRevisionKind,
  };
  if (r.size_bytes !== undefined) {
    if (
      typeof r.size_bytes !== "number" ||
      !Number.isInteger(r.size_bytes) ||
      r.size_bytes < 0
    ) {
      writeInvalid(`vault.write ${field}.size_bytes must be a non-negative integer`);
    }
    revision.size_bytes = r.size_bytes;
  }
  if (r.modified_at !== undefined) {
    if (typeof r.modified_at !== "string" || !r.modified_at.trim()) {
      writeInvalid(`vault.write ${field}.modified_at must be a non-empty string`);
    }
    revision.modified_at = r.modified_at.trim();
  }
  return revision;
}

function parseContentRef(value: unknown): VaultWriteContentRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    writeInvalid("vault.write content_ref must be an object");
  }
  const r = value as Record<string, unknown>;
  const kind = r.kind;
  if (
    typeof kind !== "string" ||
    !CONTENT_REF_KINDS.has(kind as VaultWriteContentRef["kind"])
  ) {
    writeInvalid(
      "vault.write content_ref.kind must be bff_spool | host_upload_session | chunked_write_session",
    );
  }
  const id = requireWriteString(r.id, "content_ref.id", 256);
  const ref: VaultWriteContentRef = {
    kind: kind as VaultWriteContentRef["kind"],
    id,
  };
  if (r.content_sha256 !== undefined) {
    if (
      typeof r.content_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(r.content_sha256)
    ) {
      writeInvalid(
        "vault.write content_ref.content_sha256 must be 64 lowercase hex chars",
      );
    }
    ref.content_sha256 = r.content_sha256;
  }
  return ref;
}

function parseSizeBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    writeInvalid("vault.write size_bytes must be a non-negative integer");
  }
  return value;
}

function parseWriteMode(value: unknown): VaultWriteMode {
  if (typeof value !== "string" || !WRITE_MODES.has(value as VaultWriteMode)) {
    writeInvalid(
      "vault.write mode must be create_new | replace_if_match | replace_if_absent | write_checkpoint",
    );
  }
  return value as VaultWriteMode;
}

function decodeInlineSize(
  content: string,
  encoding: "utf-8" | "base64",
): number {
  if (encoding === "base64") {
    try {
      return Buffer.byteLength(content, "base64");
    } catch {
      writeInvalid("vault.write content is not valid base64");
    }
  }
  return Buffer.byteLength(content, "utf8");
}

function validateInlineSize(
  content: string,
  encoding: "utf-8" | "base64",
  sizeBytes: number,
  maxInlineBytes: number,
): void {
  const decoded = decodeInlineSize(content, encoding);
  if (decoded !== sizeBytes) {
    writeInvalid(
      `vault.write size_bytes (${sizeBytes}) does not match decoded content length (${decoded})`,
      { size_bytes: decoded, declared: sizeBytes },
    );
  }
  if (decoded > maxInlineBytes) {
    throw new BackendRuntimeError(
      "payload_too_large",
      `vault.write inline body exceeds max_bytes (${maxInlineBytes})`,
      {
        retryable: false,
        details: {
          method: VAULT_WRITE_METHOD,
          size_bytes: decoded,
          max_bytes: maxInlineBytes,
        },
      },
    );
  }
  if (decoded > VAULT_WRITE_INLINE_HARD_MAX_BYTES) {
    throw new BackendRuntimeError(
      "payload_too_large",
      `vault.write inline body exceeds hard max_bytes (${VAULT_WRITE_INLINE_HARD_MAX_BYTES})`,
      {
        retryable: false,
        details: {
          method: VAULT_WRITE_METHOD,
          size_bytes: decoded,
          max_bytes: VAULT_WRITE_INLINE_HARD_MAX_BYTES,
        },
      },
    );
  }
}

function buildWriteParamsFromRecord(
  raw: Record<string, unknown>,
  options: {
    origin: VaultWriteOrigin;
    maxInlineBytes: number;
  },
): VaultWriteParams {
  assertNoClientIdentityFields(raw);

  const path = assertVaultRelativeWritePath(
    requireWriteString(raw.path, "path", 4096),
  );
  const mode = parseWriteMode(raw.mode);
  const sizeBytes = parseSizeBytes(raw.size_bytes ?? raw.sizeBytes);
  const idempotencyKey = requireWriteString(
    raw.idempotency_key ?? raw.idempotencyKey,
    "idempotency_key",
    VAULT_WRITE_IDEMPOTENCY_KEY_MAX,
  );

  // Origin policy: write_checkpoint is agent-only (lp-ye4.10 / lp-5q6.32).
  if (mode === "write_checkpoint" && options.origin !== "agent") {
    writeInvalid(
      `vault.write mode write_checkpoint is not allowed for origin ${options.origin}; ` +
        "use agent/Brain RPC path (dirty human edit policy stages checkpoints)",
      { origin: options.origin, mode },
    );
  }

  let expectedRevision: DocumentRevision | undefined;
  if (raw.expected_revision !== undefined || raw.expectedRevision !== undefined) {
    expectedRevision = parseDocumentRevision(
      raw.expected_revision ?? raw.expectedRevision,
      "expected_revision",
    );
  }
  let ifMatch: string | undefined;
  if (raw.if_match !== undefined || raw.ifMatch !== undefined) {
    ifMatch = requireWriteString(
      raw.if_match ?? raw.ifMatch,
      "if_match",
      VAULT_WRITE_REVISION_TOKEN_MAX,
    );
  }

  if (mode === "replace_if_match" && !expectedRevision && !ifMatch) {
    writeInvalid(
      "vault.write replace_if_match requires expected_revision or if_match",
    );
  }
  if (expectedRevision && ifMatch && expectedRevision.token !== ifMatch) {
    writeInvalid(
      "vault.write if_match and expected_revision.token must be identical when both set",
    );
  }

  const hasSourcePath =
    raw.source_path !== undefined || raw.sourcePath !== undefined;
  let sourcePath: string | undefined;
  if (mode === "write_checkpoint") {
    if (!hasSourcePath) {
      writeInvalid(
        "vault.write write_checkpoint requires source_path (canonical path)",
      );
    }
    sourcePath = assertVaultRelativeWritePath(
      requireWriteString(
        raw.source_path ?? raw.sourcePath,
        "source_path",
        4096,
      ),
    );
    if (sourcePath === path) {
      writeInvalid(
        "vault.write write_checkpoint source_path must differ from path (checkpoint destination)",
        { path, source_path: sourcePath },
      );
    }
  } else if (hasSourcePath) {
    writeInvalid(
      "vault.write source_path is only valid when mode is write_checkpoint",
      { mode },
    );
  }

  const hasContent = raw.content !== undefined;
  const hasContentRef =
    raw.content_ref !== undefined || raw.contentRef !== undefined;
  if (hasContent === hasContentRef) {
    writeInvalid(
      "vault.write requires exactly one of content+encoding or content_ref",
    );
  }

  let encoding: "utf-8" | "base64" | undefined;
  let content: string | undefined;
  let contentRef: VaultWriteContentRef | undefined;

  if (hasContent) {
    if (typeof raw.content !== "string") {
      writeInvalid("vault.write content must be a string");
    }
    content = raw.content;
    const enc = raw.encoding;
    if (enc !== "utf-8" && enc !== "base64") {
      writeInvalid("vault.write encoding must be utf-8 or base64 when content is set");
    }
    encoding = enc;
    validateInlineSize(content, encoding, sizeBytes, options.maxInlineBytes);
  } else {
    contentRef = parseContentRef(raw.content_ref ?? raw.contentRef);
  }

  // Origin-specific content plane rules
  if (options.origin === "browser") {
    // Browser must not invent Document Server spool ids; only inline content.
    if (contentRef) {
      writeInvalid(
        "browser vault.write must use inline content+encoding; content_ref is reserved for Document Server callback writeback",
        { origin: options.origin },
      );
    }
  } else {
    // document_server_callback / agent: prefer content_ref for Office; allow
    // inline under cap (lab / small fixtures / agent tool bodies).
    if (content && !contentRef) {
      // Allowed for small lab bodies; still validated by size caps above.
    }
  }

  let mimeType: string | undefined;
  if (raw.mime_type !== undefined || raw.mimeType !== undefined) {
    mimeType = requireWriteString(
      raw.mime_type ?? raw.mimeType,
      "mime_type",
      VAULT_WRITE_MIME_TYPE_MAX,
    );
  }

  let createParents: boolean | undefined;
  if (raw.create_parents !== undefined || raw.createParents !== undefined) {
    const v = raw.create_parents ?? raw.createParents;
    if (typeof v !== "boolean") {
      writeInvalid("vault.write create_parents must be a boolean");
    }
    createParents = v;
  }

  const base = {
    path,
    expectedRevision,
    ifMatch,
    encoding,
    content,
    contentRef,
    mimeType,
    sizeBytes,
    idempotencyKey,
    createParents,
  };

  if (mode === "write_checkpoint") {
    return {
      ...base,
      mode: "write_checkpoint",
      sourcePath: sourcePath!,
    };
  }
  return {
    ...base,
    mode,
  };
}

/**
 * Parse a browser-origin PUT /api/vault/content body.
 * Rejects content_ref, write_checkpoint, and any client-supplied
 * tenant/subject/host path fields.
 */
export function parseBrowserVaultWriteBody(
  body: unknown,
  options?: { maxInlineBytes?: number },
): VaultWriteParams {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    writeInvalid("vault.write browser body must be a JSON object");
  }
  const maxInlineBytes = Math.min(
    options?.maxInlineBytes ?? VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES,
    VAULT_WRITE_INLINE_HARD_MAX_BYTES,
  );
  return buildWriteParamsFromRecord(body as Record<string, unknown>, {
    origin: "browser",
    maxInlineBytes,
  });
}

/**
 * Parse a Document Server callback write body (lp-5q6.23 consumers).
 * Prefers content_ref; rejects write_checkpoint (Office saves use
 * replace_if_match on the bound path). Still rejects client-supplied
 * tenant/subject stamps. Separate from {@link parseBrowserVaultWriteBody}.
 */
export function parseCallbackVaultWriteBody(
  body: unknown,
  options?: { maxInlineBytes?: number },
): VaultWriteParams {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    writeInvalid("vault.write callback body must be a JSON object");
  }
  const maxInlineBytes = Math.min(
    options?.maxInlineBytes ?? VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES,
    VAULT_WRITE_INLINE_HARD_MAX_BYTES,
  );
  return buildWriteParamsFromRecord(body as Record<string, unknown>, {
    origin: "document_server_callback",
    maxInlineBytes,
  });
}

/**
 * Parse an agent / Brain RPC vault.write body (lp-ye4.10).
 * Accepts write_checkpoint + source_path and content_ref; rejects client
 * identity stamps. Used by fake Brain RPC and agent gateway adapters.
 */
export function parseAgentVaultWriteBody(
  body: unknown,
  options?: { maxInlineBytes?: number },
): VaultWriteParams {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    writeInvalid("vault.write agent body must be a JSON object");
  }
  const maxInlineBytes = Math.min(
    options?.maxInlineBytes ?? VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES,
    VAULT_WRITE_INLINE_HARD_MAX_BYTES,
  );
  return buildWriteParamsFromRecord(body as Record<string, unknown>, {
    origin: "agent",
    maxInlineBytes,
  });
}

/**
 * Whether the backend advertises vault.write (expansion).
 * Honesty rule: features.vault_write AND brain_rpc_methods includes vault.write.
 */
export function vaultWriteIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  const methods = caps.brain_rpc_methods ?? [];
  if (!methods.includes(VAULT_WRITE_METHOD)) return false;
  // Prefer explicit feature flag; if methods includes vault.write, still require
  // features.vault_write !== false when the flag is present as false.
  if (caps.features?.vault_write === false) return false;
  if (caps.features?.vault_write === true) return true;
  // Method present without explicit false → treat as advertised (host honesty).
  return true;
}

/**
 * Build vault.write Brain RPC params from domain input (snake_case wire).
 */
export function vaultWriteInputToWireParams(
  input: VaultWriteParams,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    path: input.path,
    mode: input.mode,
    size_bytes: input.sizeBytes,
    idempotency_key: input.idempotencyKey,
  };
  if (input.expectedRevision) {
    params.expected_revision = {
      token: input.expectedRevision.token,
      kind: input.expectedRevision.kind,
      ...(input.expectedRevision.size_bytes !== undefined
        ? { size_bytes: input.expectedRevision.size_bytes }
        : {}),
      ...(input.expectedRevision.modified_at !== undefined
        ? { modified_at: input.expectedRevision.modified_at }
        : {}),
    };
  }
  if (input.ifMatch !== undefined) {
    params.if_match = input.ifMatch;
  }
  if (input.content !== undefined) {
    params.content = input.content;
    params.encoding = input.encoding ?? "utf-8";
  }
  if (input.contentRef) {
    params.content_ref = {
      kind: input.contentRef.kind,
      id: input.contentRef.id,
      ...(input.contentRef.content_sha256
        ? { content_sha256: input.contentRef.content_sha256 }
        : {}),
    };
  }
  if (input.mimeType !== undefined) {
    params.mime_type = input.mimeType;
  }
  if (input.createParents !== undefined) {
    params.create_parents = input.createParents;
  }
  if (input.mode === "write_checkpoint" && input.sourcePath) {
    params.source_path = input.sourcePath;
  }
  return params;
}

function normalizeVaultWriteResult(
  raw: VaultWriteResult,
  fallbackPath: string,
): VaultWriteResult {
  if (!raw || typeof raw !== "object") {
    throw new BackendRuntimeError(
      "internal",
      "vault.write returned empty result",
      { retryable: true, details: { method: VAULT_WRITE_METHOD } },
    );
  }
  const path =
    typeof raw.path === "string" && raw.path.length > 0
      ? raw.path
      : fallbackPath;
  const revision = raw.revision;
  if (
    !revision ||
    typeof revision.token !== "string" ||
    typeof revision.kind !== "string"
  ) {
    throw new BackendRuntimeError(
      "internal",
      "vault.write result missing revision",
      { retryable: true, details: { method: VAULT_WRITE_METHOD, path } },
    );
  }
  const size_bytes =
    typeof raw.size_bytes === "number" && Number.isFinite(raw.size_bytes)
      ? raw.size_bytes
      : 0;
  const mime_type =
    typeof raw.mime_type === "string" && raw.mime_type.length > 0
      ? raw.mime_type
      : "application/octet-stream";
  const written_at =
    typeof raw.written_at === "string" && raw.written_at.length > 0
      ? raw.written_at
      : new Date().toISOString();
  const commit = normalizeVaultWriteCommit(raw.commit);
  return {
    path,
    revision: {
      token: revision.token,
      kind: revision.kind as DocumentRevisionKind,
      ...(revision.size_bytes !== undefined
        ? { size_bytes: revision.size_bytes }
        : {}),
      ...(revision.modified_at !== undefined
        ? { modified_at: revision.modified_at }
        : {}),
    },
    ...(typeof raw.etag === "string" ? { etag: raw.etag } : {}),
    size_bytes,
    mime_type,
    written_at,
    ...(typeof raw.created === "boolean" ? { created: raw.created } : {}),
    ...(typeof raw.idempotent_replay === "boolean"
      ? { idempotent_replay: raw.idempotent_replay }
      : {}),
    ...(typeof raw.source_path === "string" && raw.source_path.length > 0
      ? { source_path: raw.source_path }
      : {}),
    ...(typeof raw.write_kind === "string"
      ? { write_kind: raw.write_kind }
      : {}),
    ...(commit ? { commit } : {}),
  };
}

/** Pass through optional result_vault_write.commit (lp-ye4.8); ignore junk. */
function normalizeVaultWriteCommit(
  raw: VaultWriteResult["commit"] | unknown,
): VaultWriteResult["commit"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.operation_id !== "string" ||
    !c.operation_id.startsWith("op_") ||
    (c.kind !== "file_create" &&
      c.kind !== "file_replace" &&
      c.kind !== "file_checkpoint")
  ) {
    return undefined;
  }
  return {
    operation_id: c.operation_id,
    kind: c.kind,
    ...(typeof c.workspace_id === "string" && c.workspace_id.length > 0
      ? { workspace_id: c.workspace_id }
      : {}),
    ...(typeof c.tree_root_hash === "string" &&
    /^[a-f0-9]{64}$/.test(c.tree_root_hash)
      ? { tree_root_hash: c.tree_root_hash }
      : {}),
    ...(typeof c.advances_artifact_head === "boolean"
      ? { advances_artifact_head: c.advances_artifact_head }
      : {}),
    ...(typeof c.advances_workspace_head === "boolean"
      ? { advances_workspace_head: c.advances_workspace_head }
      : {}),
  };
}

/**
 * Apply vault.write via BackendRuntimeService after capability + ACL checks.
 * Pure service boundary — HTTP routes only parse/stamp then call this.
 *
 * BFF stamps (tenant, subject, session, profile, pathPrefixes) live on `ctx`
 * and are never taken from the write body.
 */
export async function writeVaultContent(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  params: VaultWriteParams,
  options: WriteVaultOptions,
): Promise<VaultWriteHttpBody> {
  const requireCap = options.requireCapabilityAdvertisement !== false;
  const prefixes = resolveAclPrefixes(ctx.profile.pathPrefixes);
  const normalized = assertPathAccess(
    prefixes,
    params.path,
    VAULT_WRITE_METHOD,
  );

  // write_checkpoint: both destination and canonical source must pass ACL.
  let normalizedSource: string | undefined;
  if (params.mode === "write_checkpoint") {
    if (!params.sourcePath) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "vault.write write_checkpoint requires source_path",
        {
          retryable: false,
          details: { method: VAULT_WRITE_METHOD, path: normalized },
        },
      );
    }
    normalizedSource = assertPathAccess(
      prefixes,
      params.sourcePath,
      VAULT_WRITE_METHOD,
    );
    if (normalizedSource === normalized) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "vault.write write_checkpoint source_path must differ from path",
        {
          retryable: false,
          details: {
            method: VAULT_WRITE_METHOD,
            path: normalized,
            source_path: normalizedSource,
          },
        },
      );
    }
  }

  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!vaultWriteIsAdvertised(caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        "vault.write is not advertised by this backend; " +
          "enable only after capabilities.features.vault_write and " +
          "brain_rpc_methods includes vault.write",
        {
          retryable: false,
          details: { method: VAULT_WRITE_METHOD, path: normalized },
        },
      );
    }
  }

  if (typeof service.writeVault !== "function") {
    throw new BackendRuntimeError(
      "method_not_found",
      "BackendRuntimeService.writeVault is not implemented; " +
        "vault write is unavailable for this backend",
      {
        retryable: false,
        details: { method: VAULT_WRITE_METHOD, path: normalized },
      },
    );
  }

  const domainParams: VaultWriteParams =
    params.mode === "write_checkpoint"
      ? {
          ...params,
          path: normalized,
          mode: "write_checkpoint",
          sourcePath: normalizedSource!,
        }
      : {
          ...params,
          path: normalized,
        };
  const result = await service.writeVault(ctx, domainParams);
  const normalizedResult = normalizeVaultWriteResult(result, normalized);
  return {
    ...normalizedResult,
    source: "brain_rpc",
  };
}

/**
 * Browser-origin write: parse PUT body then capability-gated writeVault.
 */
export async function writeVaultFromBrowser(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  body: unknown,
  options: Omit<WriteVaultOptions, "origin"> & {
    maxInlineBytes?: number;
  } = {},
): Promise<VaultWriteHttpBody> {
  const params = parseBrowserVaultWriteBody(body, {
    maxInlineBytes: options.maxInlineBytes,
  });
  return writeVaultContent(service, ctx, params, {
    ...options,
    origin: "browser",
  });
}

/**
 * Document Server callback write: separate body parser (content_ref allowed).
 * Used by lp-5q6.23 after callback JWT/session checks.
 */
export async function writeVaultFromCallback(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  body: unknown,
  options: Omit<WriteVaultOptions, "origin"> & {
    maxInlineBytes?: number;
  } = {},
): Promise<VaultWriteHttpBody> {
  const params = parseCallbackVaultWriteBody(body, {
    maxInlineBytes: options.maxInlineBytes,
  });
  return writeVaultContent(service, ctx, params, {
    ...options,
    origin: "document_server_callback",
  });
}

/**
 * Map a service error to `{ status, body }` for Hono vault routes.
 * Conflict (409) includes revision tokens when present for CAS UX.
 */
export function vaultErrorToHttp(err: unknown): {
  status: number;
  body: VaultHttpErrorBody;
} {
  if (err instanceof BackendRuntimeError) {
    const unavailable =
      err.code === "unavailable" ||
      err.code === "not_implemented" ||
      err.code === "method_not_found" ||
      err.code === "timeout";
    const method =
      typeof err.details?.method === "string" ? err.details.method : undefined;
    const reason =
      typeof err.details?.reason === "string" ? err.details.reason : undefined;
    const expected_revision_token =
      typeof err.details?.expected_revision_token === "string"
        ? err.details.expected_revision_token
        : undefined;
    const actual_revision_token =
      typeof err.details?.actual_revision_token === "string"
        ? err.details.actual_revision_token
        : undefined;
    return {
      status: backendRuntimeErrorToHttpStatus(err.code),
      body: {
        error: err.message,
        code: String(err.code),
        retryable: err.retryable,
        ...(unavailable ? { unavailable: true as const } : {}),
        ...(method ? { method } : {}),
        ...(reason ? { reason } : {}),
        ...(expected_revision_token ? { expected_revision_token } : {}),
        ...(actual_revision_token ? { actual_revision_token } : {}),
      },
    };
  }
  const message =
    err instanceof Error ? err.message : "Internal vault route error";
  return {
    status: 500,
    body: { error: message, code: "internal", retryable: true },
  };
}

/**
 * Handler bundle for BFF vault routes (tree / entries / content / write).
 *
 * ```ts
 * const vault = createVaultHandlers(backendRuntime);
 * api.get("/vault/tree", async (c) => {
 *   const ctx = backendContextFromSession(...);
 *   return c.json(await vault.tree(ctx));
 * });
 * api.put("/vault/content", async (c) => {
 *   const ctx = backendContextFromSession(...); // stamps tenant/subject/ACL
 *   return c.json(await vault.writeBrowser(ctx, await c.req.json()));
 * });
 * ```
 */
export function createVaultHandlers(
  service: BackendRuntimeService,
  defaults: GetVaultTreeOptions = {},
): {
  tree: (
    ctx: BackendRuntimeContext,
    options?: GetVaultTreeOptions,
  ) => Promise<VaultTreeHttpBody>;
  list: (
    ctx: BackendRuntimeContext,
    path: string,
    options?: ListVaultEntriesOptions,
  ) => Promise<VaultEntriesHttpBody>;
  read: (
    ctx: BackendRuntimeContext,
    path: string,
  ) => Promise<VaultContentHttpBody>;
  stat: (
    ctx: BackendRuntimeContext,
    path: string,
  ) => Promise<VaultEntry & { source: string }>;
  /** Browser-origin capability-gated write (PUT /api/vault/content). */
  writeBrowser: (
    ctx: BackendRuntimeContext,
    body: unknown,
    options?: Omit<WriteVaultOptions, "origin"> & { maxInlineBytes?: number },
  ) => Promise<VaultWriteHttpBody>;
  /**
   * Document Server callback write (separate origin validator).
   * Call only after callback auth (lp-5q6.23).
   */
  writeCallback: (
    ctx: BackendRuntimeContext,
    body: unknown,
    options?: Omit<WriteVaultOptions, "origin"> & { maxInlineBytes?: number },
  ) => Promise<VaultWriteHttpBody>;
} {
  return {
    tree: (ctx, options) =>
      getVaultTree(service, ctx, { ...defaults, ...options }),
    list: (ctx, path, options) =>
      listVaultEntries(service, ctx, path, options),
    read: (ctx, path) => readVaultContent(service, ctx, path),
    stat: (ctx, path) => statVaultPath(service, ctx, path),
    writeBrowser: (ctx, body, options) =>
      writeVaultFromBrowser(service, ctx, body, options),
    writeCallback: (ctx, body, options) =>
      writeVaultFromCallback(service, ctx, body, options),
  };
}
