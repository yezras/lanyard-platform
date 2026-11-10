/**
 * Boundary adapter: raw relay / chat metadata → typed artifact events.
 *
 * Bead: lp-5q6.11
 * Protocol: docs/architecture/portal-chat-artifact-event-protocol.md §5–§6
 * Wire types + pure promote helpers: ./artifact-events.ts (lp-5q6.10)
 *
 * Priority (protocol §5.1):
 * 1. Explicit `metadata.portal_event` in `artifact.*`
 * 2. Citations (`metadata.citations[]` or `portal_event: "citation"`)
 * 3. Structured `tool_progress` / file-tool + vault path `tool_target`
 * 4. Else empty (do not scrape Hermes chrome)
 *
 * Returns typed events or an empty result — never throws on malformed input.
 * Do not re-implement these shape checks in ChatTimeline / ChatView / hooks.
 */

import { projectToVaultRelativePath } from "../rbac/path-project.js";

import {
  isArtifactEventKind,
  normalizeArtifactVaultPath,
  parseArtifactEventMetadata,
  promoteCitationToArtifactOpen,
  promoteToolProgressToArtifactEvent,
  type ArtifactEventWire,
  type ArtifactProducer,
} from "./artifact-events.js";

// ---------------------------------------------------------------------------
// Input / result types (ChatEvent-shaped, package-agnostic)
// ---------------------------------------------------------------------------

/**
 * Structural subset of portal ChatEvent / ChatHistoryEvent / relay SSE rows.
 * Keeps this module free of a hard dependency on @lanyard/web types.
 */
export type ChatEventLike = {
  type?: string;
  chat_id?: string;
  message_id?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  tool_label?: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: string;
  tool_target?: string;
  additions?: number;
  deletions?: number;
  error_message?: string;
  errorMessage?: string;
  citations?: Array<{ path: string; title?: string }>;
  created_at?: string;
  /**
   * Optional pre-attached parse results (passthrough when already typed wire).
   * Producers may set this; durable history may omit it and re-parse metadata.
   */
  artifact_events?: unknown;
};

export type ArtifactEventSource = "explicit" | "citation" | "tool_progress";

/**
 * Typed metadata parse result for ChatEvent / history consumers (lp-5q6.11).
 * Attach as `ChatEvent.artifact_events` when a producer pre-parses, or call
 * {@link normalizeArtifactEventsFromChatEvent} at the boundary.
 */
export type ArtifactMetadataParseResult = {
  events: ArtifactEventWire[];
  sources: ArtifactEventSource[];
};

export type NormalizeArtifactOptions = {
  /** Fallback when event.chat_id / metadata.thread_id absent. */
  thread_id?: string;
  /**
   * Project vault root (Hermes primary_path). Relative citation / tool targets
   * are joined under this root before promotion / parse.
   */
  project_vault_path?: string | null;
  /** ISO timestamp fallback for promoted events. */
  timestamp?: string | null;
  producer?: ArtifactProducer;
};

// ---------------------------------------------------------------------------
// Path resolution (relative project path → absolute vault path)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve a path that may be relative to a project vault root into a
 * normalized absolute vault path. Returns null when unusable (empty, `..`).
 *
 * Mirrors portal web `resolveVaultCitationPath` semantics so shared consumers
 * (pane reducer, history hydrate) do not reimplement join rules.
 */
export function resolveArtifactVaultPath(
  rawPath: string,
  projectVaultPath?: string | null,
): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  // file:// or other scheme → pathname (no DOM URL; shared lib is ES2022 only)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const fileMatch = trimmed.match(/^file:\/\/(.*)$/i);
    if (fileMatch) {
      const rest = fileMatch[1] ?? "";
      const pathname = rest.startsWith("/")
        ? rest
        : rest.includes("/")
          ? rest.slice(rest.indexOf("/"))
          : "";
      if (!pathname) return null;
      let decoded = pathname;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        /* keep raw */
      }
      return resolveArtifactVaultPath(decoded, projectVaultPath);
    }
    const schemeMatch = trimmed.match(
      /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i,
    );
    const pathname = schemeMatch?.[1];
    if (!pathname) return null;
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      /* keep raw */
    }
    return resolveArtifactVaultPath(decoded, projectVaultPath);
  }

  const projectRoot = projectVaultPath?.trim().replace(/\/+$/, "") || "";
  let joined: string | null = null;

  if (trimmed.startsWith("/")) {
    if (
      projectRoot &&
      (trimmed === projectRoot || trimmed.startsWith(`${projectRoot}/`))
    ) {
      joined = trimmed;
    } else if (projectRoot) {
      // Fixture/contract: /Projects/<seg>/rest → projectRoot/rest
      const projectsMatch = trimmed.match(/^\/Projects\/[^/]+\/(.+)$/i);
      if (projectsMatch?.[1]) {
        joined = `${projectRoot}/${projectsMatch[1]}`;
      } else {
        // Single-segment absolute like /README.md under project context
        const segments = trimmed.split("/").filter(Boolean);
        if (segments.length === 1) {
          joined = `${projectRoot}/${segments[0]}`;
        } else {
          joined = trimmed;
        }
      }
    } else {
      joined = trimmed;
    }
  } else if (projectRoot) {
    // Relative / bare filename: join project root when available
    const relative = trimmed.replace(/^\.?\//, "");
    joined = `${projectRoot}/${relative}`;
  } else {
    joined = `/${trimmed.replace(/^\.?\//, "")}`;
  }

  // Host absolute → vault-root-relative when path embeds vault top-level
  // (lp-vnz.3). No-op for multi-root host folders without vault structure.
  const projected = projectToVaultRelativePath(joined, {
    projectVaultPath: projectRoot || null,
  });
  return normalizeArtifactVaultPath(projected);
}

function withResolvedArtifactPaths(
  metadata: Record<string, unknown>,
  projectVaultPath?: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  if (typeof out.vault_path === "string") {
    const resolved = resolveArtifactVaultPath(out.vault_path, projectVaultPath);
    if (resolved) out.vault_path = resolved;
  }
  if (typeof out.source_path === "string") {
    const resolved = resolveArtifactVaultPath(
      out.source_path,
      projectVaultPath,
    );
    if (resolved) out.source_path = resolved;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citation / tool field extraction
// ---------------------------------------------------------------------------

type CitationEntry = { path: string; title?: string };

function collectCitationEntries(
  event: ChatEventLike,
  metadata: Record<string, unknown> | undefined,
): CitationEntry[] {
  const out: CitationEntry[] = [];
  const seen = new Set<string>();

  const push = (path: unknown, title?: unknown) => {
    const p = asNonEmptyString(path);
    if (!p || seen.has(p)) return;
    seen.add(p);
    const t = asNonEmptyString(title) ?? undefined;
    out.push(t ? { path: p, title: t } : { path: p });
  };

  if (Array.isArray(event.citations)) {
    for (const c of event.citations) {
      if (c && typeof c === "object") {
        push(
          (c as { path?: unknown }).path,
          (c as { title?: unknown }).title,
        );
      }
    }
  }

  if (metadata) {
    if (Array.isArray(metadata.citations)) {
      for (const raw of metadata.citations) {
        if (isRecord(raw)) push(raw.path, raw.title);
      }
    }
    // portal_event: "citation" with path / vault_path fields
    if (metadata.portal_event === "citation") {
      push(
        metadata.path ?? metadata.vault_path,
        metadata.title,
      );
    }
  }

  return out;
}

function readToolFields(
  event: ChatEventLike,
  metadata: Record<string, unknown> | undefined,
): {
  isToolProgress: boolean;
  tool_name?: string;
  tool_status?: string;
  tool_target?: string;
  tool_call_id?: string;
  tool_label?: string;
  additions?: number;
  deletions?: number;
  error_message?: string;
} {
  const portalEvent = metadata
    ? asNonEmptyString(metadata.portal_event)
    : null;
  const isToolProgress =
    event.type === "tool_progress" || portalEvent === "tool_progress";

  const tool_name =
    asNonEmptyString(event.tool_name) ??
    asNonEmptyString(metadata?.tool_name) ??
    undefined;
  const tool_status =
    asNonEmptyString(event.tool_status) ??
    asNonEmptyString(metadata?.tool_status) ??
    undefined;
  const tool_target =
    asNonEmptyString(event.tool_target) ??
    asNonEmptyString(metadata?.tool_target) ??
    asNonEmptyString(metadata?.target) ??
    undefined;
  const tool_call_id =
    asNonEmptyString(event.tool_call_id) ??
    asNonEmptyString(metadata?.tool_call_id) ??
    undefined;
  const tool_label =
    asNonEmptyString(event.tool_label) ??
    asNonEmptyString(metadata?.tool_label) ??
    undefined;

  const additions =
    typeof event.additions === "number"
      ? event.additions
      : typeof metadata?.additions === "number"
        ? metadata.additions
        : undefined;
  const deletions =
    typeof event.deletions === "number"
      ? event.deletions
      : typeof metadata?.deletions === "number"
        ? metadata.deletions
        : undefined;
  const error_message =
    asNonEmptyString(event.error_message) ??
    asNonEmptyString(event.errorMessage) ??
    asNonEmptyString(metadata?.error_message) ??
    asNonEmptyString(metadata?.errorMessage) ??
    undefined;

  return {
    isToolProgress,
    tool_name,
    tool_status,
    tool_target,
    tool_call_id,
    tool_label,
    additions,
    deletions,
    error_message,
  };
}

// ---------------------------------------------------------------------------
// Main boundary adapter
// ---------------------------------------------------------------------------

/**
 * Normalize a single chat/relay event into zero or more typed artifact events.
 *
 * Prefer this over scattering `portal_event` / citation / tool_target checks
 * across UI modules. Malformed input yields `{ events: [], sources: [] }`.
 */
export function normalizeArtifactEventsFromChatEvent(
  event: ChatEventLike,
  options: NormalizeArtifactOptions = {},
): ArtifactMetadataParseResult {
  if (!event || typeof event !== "object") {
    return { events: [], sources: [] };
  }

  // Ephemeral — never promote
  if (event.type === "typing" || event.type === "user_message") {
    return { events: [], sources: [] };
  }

  const threadId =
    asNonEmptyString(options.thread_id) ??
    asNonEmptyString(event.chat_id) ??
    null;
  const timestamp =
    asNonEmptyString(options.timestamp) ??
    asNonEmptyString(event.created_at) ??
    undefined;
  const projectRoot = options.project_vault_path;
  const producer = options.producer;
  const metadata = isRecord(event.metadata) ? event.metadata : undefined;

  // 1. Explicit artifact.* portal_event
  if (metadata && isArtifactEventKind(metadata.portal_event)) {
    const resolvedMeta = withResolvedArtifactPaths(metadata, projectRoot);
    const parsed = parseArtifactEventMetadata(
      {
        chat_id: event.chat_id,
        metadata: resolvedMeta,
      },
      { thread_id: threadId ?? undefined },
    );
    if (parsed) {
      return { events: [parsed], sources: ["explicit"] };
    }
    // Malformed explicit artifact.* — fail soft, do not invent promotions
    return { events: [], sources: [] };
  }

  // Also accept a bare metadata object passed as the event itself
  if (!metadata && isArtifactEventKind((event as { portal_event?: unknown }).portal_event)) {
    const resolvedMeta = withResolvedArtifactPaths(
      event as unknown as Record<string, unknown>,
      projectRoot,
    );
    const parsed = parseArtifactEventMetadata(resolvedMeta, {
      thread_id: threadId ?? undefined,
    });
    if (parsed) {
      return { events: [parsed], sources: ["explicit"] };
    }
    return { events: [], sources: [] };
  }

  if (!threadId) {
    return { events: [], sources: [] };
  }

  // 2. Citation fallback
  const citations = collectCitationEntries(event, metadata);
  if (citations.length > 0) {
    const events: ArtifactEventWire[] = [];
    const sources: ArtifactEventSource[] = [];
    for (const citation of citations) {
      const path = resolveArtifactVaultPath(citation.path, projectRoot);
      if (!path) continue;
      const promoted = promoteCitationToArtifactOpen({
        thread_id: threadId,
        path,
        title: citation.title,
        timestamp,
        producer,
        tool_call_id: asNonEmptyString(event.tool_call_id),
      });
      if (promoted) {
        events.push(promoted);
        sources.push("citation");
      }
    }
    if (events.length > 0) {
      return { events, sources };
    }
  }

  // 3. tool_progress / tool_target fallback
  const tool = readToolFields(event, metadata);
  // Promote when structured tool_progress OR file-tool fields are present
  // with a path-like target (durable tool rows after reload).
  if (tool.isToolProgress || (tool.tool_name && tool.tool_target)) {
    const resolvedTarget = tool.tool_target
      ? resolveArtifactVaultPath(tool.tool_target, projectRoot)
      : null;
    if (resolvedTarget) {
      const promoted = promoteToolProgressToArtifactEvent({
        thread_id: threadId,
        tool_name: tool.tool_name,
        tool_status: tool.tool_status,
        tool_target: resolvedTarget,
        tool_call_id: tool.tool_call_id,
        tool_label: tool.tool_label,
        additions: tool.additions,
        deletions: tool.deletions,
        error_message: tool.error_message,
        timestamp,
        producer,
      });
      if (promoted) {
        return { events: [promoted], sources: ["tool_progress"] };
      }
    }
  }

  return { events: [], sources: [] };
}

/**
 * Walk durable history and collect artifact events for pane hydrate after reload.
 * Dedupes on (portal_event, artifact_id, vault_path, timestamp).
 */
export function collectArtifactEventsFromHistory(
  history: readonly ChatEventLike[],
  options: NormalizeArtifactOptions = {},
): ArtifactEventWire[] {
  if (!Array.isArray(history)) return [];

  const out: ArtifactEventWire[] = [];
  const seen = new Set<string>();

  for (const event of history) {
    const result = normalizeArtifactEventsFromChatEvent(event, {
      ...options,
      thread_id:
        options.thread_id ??
        asNonEmptyString(event.chat_id) ??
        undefined,
      timestamp:
        options.timestamp ??
        asNonEmptyString(event.created_at) ??
        undefined,
    });
    for (const ae of result.events) {
      const key = `${ae.portal_event}\0${ae.artifact_id}\0${ae.vault_path}\0${ae.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ae);
    }
  }

  return out;
}

/**
 * True when durable history row / SSE event may carry artifact metadata
 * that must be retained for pane re-hydrate (protocol §6).
 */
export function chatEventMayCarryArtifactMetadata(
  event: ChatEventLike,
): boolean {
  if (!event || typeof event !== "object") return false;
  if (event.type === "typing" || event.type === "user_message") return false;

  const metadata = isRecord(event.metadata) ? event.metadata : undefined;
  if (metadata) {
    if (isArtifactEventKind(metadata.portal_event)) return true;
    if (metadata.portal_event === "citation") return true;
    if (Array.isArray(metadata.citations) && metadata.citations.length > 0) {
      return true;
    }
    if (
      metadata.portal_event === "tool_progress" &&
      (metadata.tool_target || metadata.target)
    ) {
      return true;
    }
  }

  if (event.citations && event.citations.length > 0) return true;
  if (event.type === "tool_progress" && event.tool_target) return true;
  if (Array.isArray(event.artifact_events) && event.artifact_events.length > 0) {
    return true;
  }
  return false;
}
