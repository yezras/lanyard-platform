/**
 * Route citations, explicit artifact.open, and tool_target fallbacks into
 * chat document pane actions — without switching to the Vault tab.
 *
 * Beads: lp-5q6.14 (citation/tool routing),
 * lp-dpr.2 (soft mode A — first office path/basename reference opens pane)
 *
 * Priority for live chat events (shared normalizer, lp-5q6.11):
 * 1. Explicit metadata.portal_event artifact.*
 * 2. Citations (user-click only; not auto-applied from message_send)
 * 3. tool_progress / file-tool + vault path tool_target
 * 4. Defensive: assistant free-text office path reference (soft mode A)
 *
 * Soft mode A (lp-dpr.2): when the user (composer) or assistant free-text
 * names a vault office path — or a uniquely resolvable basename — open the
 * pane on the **first** extractable office token. Open/work verbs are not
 * required (e.g. "Summarize /Business/.../MSA.docx", "What does Note.docx say?").
 * Pure structured citation lists still do not mass-auto-open
 * (skipCitationAutoOpen default).
 */

import {
  normalizeArtifactEventsFromChatEvent,
  type ChatEventLike,
  type NormalizeArtifactOptions,
} from "@lanyard/shared";

import { isOfficeEditorPath } from "./isOfficeEditorFile.js";
import { mapArtifactWireToPanelEvent } from "./mapArtifactWire.js";
import { resolvePaneArtifactRef } from "./pathResolution.js";
import type {
  ArtifactPanelAction,
  VaultArtifactRef,
} from "./types.js";

export type OpenDocumentPathOptions = {
  projectVaultPath?: string | null;
  source?: VaultArtifactRef["source"];
  title?: string | null;
  mode?: "preview" | "edit";
  /**
   * Resolve a basename-only office name (e.g. `Note.docx`) to a unique vault
   * path. Called only when the intent path has no directory segment.
   * Return null when not found or ambiguous (do not open).
   */
  resolveBasename?: (basename: string) => string | null;
};

/**
 * Resolve a citation / tool path into a PANEL_OPEN action.
 * Returns null when the path cannot be opened (empty, traversal, unresolved).
 */
export function openDocumentPathAction(
  pathOrHref: string,
  options: OpenDocumentPathOptions = {},
): ArtifactPanelAction | null {
  const resolved = resolvePaneArtifactRef(pathOrHref, {
    projectVaultPath: options.projectVaultPath,
    source: options.source ?? "citation",
    title: options.title,
  });
  if (!resolved.ok) return null;
  return {
    type: "PANEL_OPEN",
    ref: resolved.ref,
    mode: options.mode ?? "preview",
  };
}

export type PanelActionsFromChatOptions = NormalizeArtifactOptions & {
  /**
   * When true (default), skip citation-promoted events so final message
   * source lists do not auto-open the pane. User clicks still use
   * {@link openDocumentPathAction}.
   */
  skipCitationAutoOpen?: boolean;
};

/**
 * Normalize a live/durable chat event and produce pane reducer actions.
 *
 * - Explicit `artifact.open` / progress / updated / error / close → PANEL_EVENT
 * - File-tool `tool_target` fallback → PANEL_EVENT (source tool_target)
 * - Citation promotions skipped by default (click path owns those)
 * - When no artifact events: defensive assistant soft-open for the first
 *   office path/basename reference in free text (soft mode A lp-dpr.2).
 *   Same detector as user intent; one primary path per message.
 *   Basename mentions need resolveBasename (not available on this path) so
 *   multi-segment vault paths are the defensive free-text case.
 */
export function panelActionsFromChatEvent(
  event: ChatEventLike,
  options: PanelActionsFromChatOptions = {},
): ArtifactPanelAction[] {
  const skipCitation = options.skipCitationAutoOpen !== false;
  const result = normalizeArtifactEventsFromChatEvent(event, options);
  const actions: ArtifactPanelAction[] = [];

  for (let i = 0; i < result.events.length; i += 1) {
    const wire = result.events[i];
    const parseSource = result.sources[i];
    if (!wire) continue;
    if (skipCitation && parseSource === "citation") continue;

    const domain = mapArtifactWireToPanelEvent(wire, parseSource);
    if (!domain) continue;
    actions.push({ type: "PANEL_EVENT", event: domain });
  }

  // Defensive: assistant free-text soft mode A when agent did not emit
  // artifact.* or file-tool tool_target. User messages are handled at composer.
  if (
    actions.length === 0 &&
    event.type !== "typing" &&
    event.type !== "user_message" &&
    event.type !== "system_notice" &&
    event.type !== "tool_progress" &&
    typeof event.content === "string" &&
    event.content.trim()
  ) {
    // Multi-segment only here (no vault tree for basename resolve on this path).
    const multi = extractOfficeVaultPathFromText(event.content);
    if (multi) {
      const defensive = openDocumentPathAction(multi, {
        projectVaultPath: options.project_vault_path,
        source: "artifact_event",
      });
      if (defensive) actions.push(defensive);
    }
  }

  return actions;
}

/**
 * Convenience: open a tool_target string (absolute or project-relative).
 * Used by tests and any UI control that surfaces a file tool path.
 */
export function openToolTargetAction(
  toolTarget: string,
  options: Omit<OpenDocumentPathOptions, "source"> = {},
): ArtifactPanelAction | null {
  return openDocumentPathAction(toolTarget, {
    ...options,
    source: "tool_target",
  });
}

// ---------------------------------------------------------------------------
// Soft mode A — office path / basename reference (lp-dpr.2)
// ---------------------------------------------------------------------------

/**
 * Verbs that classify an intent as classic open/work (`open_request`).
 * Soft mode A opens on path reference alone; these only refine `kind`.
 * Word boundaries avoid false hits like "overview".
 */
const OPEN_DOCUMENT_INTENT_RE =
  /\b(?:open|show|preview|view|display|load|pull\s+up|bring\s+up|work\s+on|edit|revise|update|draft|amend|modify)\b/i;

/**
 * Vault-looking multi-segment path ending in an office extension.
 * Allows absolute (`/Business/.../x.docx`) and relative (`notes/x.docx`).
 * Filenames may contain dots (e.g. `Lanyard_MSA_7.17.26_revised.docx`).
 */
const OFFICE_PATH_IN_TEXT_RE =
  /(?:^|[\s"'`(\[{])(\/?(?:[\w.-]+\/)+[\w.-]+\.(?:docx|xlsx|pptx|doc|xls|ppt|pdf|odt|ods|odp))(?=$|[\s"'`)\]}.,;:!?])/gi;

/**
 * Basename-only office filename (no directory segment), e.g. `Note.docx`.
 * Soft mode A opens when uniquely resolved via vault listing.
 * First match only (no token spam).
 */
const OFFICE_BASENAME_IN_TEXT_RE =
  /(?:^|[\s"'`(\[{])([\w.-]+\.(?:docx|xlsx|pptx|doc|xls|ppt|pdf|odt|ods|odp))(?=$|[\s"'`)\]}.,;:!?])/gi;

export type ChatOpenDocumentIntent = {
  /** Raw path token as found in the message (before pane / vault resolve). */
  path: string;
  /**
   * - `path_only` — message is essentially just the office path/basename
   * - `open_request` — open/work/edit… verb + office path/basename
   * - `path_reference` — soft mode A: office path/basename without open verbs
   */
  kind: "open_request" | "path_only" | "path_reference";
  /**
   * True when `path` is a bare office filename without directory segments
   * (needs unique vault basename resolve before PANEL_OPEN).
   */
  isBasename: boolean;
};

/**
 * True when the token is a single office filename (no `/`, no whitespace).
 */
export function isOfficeBasenameToken(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("/") || /\s/.test(trimmed)) return false;
  if (
    !/^[\w.-]+\.(?:docx|xlsx|pptx|doc|xls|ppt|pdf|odt|ods|odp)$/i.test(trimmed)
  ) {
    return false;
  }
  return isOfficeEditorPath(trimmed);
}

/**
 * Extract the first multi-segment office vault path token from free text.
 * Does not return bare basenames — use {@link extractOfficePathOrBasenameFromText}.
 */
export function extractOfficeVaultPathFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4000) return null;

  OFFICE_PATH_IN_TEXT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OFFICE_PATH_IN_TEXT_RE.exec(trimmed)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (/(^|\/)\.\.(\/|$)/.test(candidate)) continue;
    if (!isOfficeEditorPath(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Extract the first office basename token (e.g. `Note.docx`) from free text.
 * Skips multi-segment paths (those are handled by
 * {@link extractOfficeVaultPathFromText}).
 */
export function extractOfficeBasenameFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4000) return null;

  // Prefer multi-segment when present so we do not peel a leaf basename off a
  // full path (e.g. "open /A/B/Note.docx" should not yield bare Note.docx).
  if (extractOfficeVaultPathFromText(trimmed)) return null;

  OFFICE_BASENAME_IN_TEXT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OFFICE_BASENAME_IN_TEXT_RE.exec(trimmed)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (!isOfficeBasenameToken(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Extract multi-segment path first, then fall back to bare office basename.
 * One primary token only (first extractable office path) — soft mode A spam guard.
 */
export function extractOfficePathOrBasenameFromText(
  text: string,
): { path: string; isBasename: boolean } | null {
  const multi = extractOfficeVaultPathFromText(text);
  if (multi) return { path: multi, isBasename: false };
  const base = extractOfficeBasenameFromText(text);
  if (base) return { path: base, isBasename: true };
  return null;
}

/**
 * Detect soft mode A open-document intent for vault office files (lp-dpr.2).
 *
 * Opens when the message contains a first extractable office vault path or
 * basename, including:
 * - Path-only paste-and-send (`path_only`)
 * - Open/show/work-on/edit… language + path (`open_request`)
 * - Mere path/basename reference without open verbs (`path_reference`) —
 *   e.g. "Summarize /Business/.../MSA.docx", "What does Note.docx say?"
 *
 * Does **not** fire without an office path/basename token (e.g. "update me
 * later"). One primary path per message (first extractable token only).
 *
 * Basename intents still require {@link openDocumentIntentFromUserMessage}
 * resolveBasename for a unique vault hit before PANEL_OPEN.
 */
export function detectChatOpenDocumentIntent(
  text: string,
): ChatOpenDocumentIntent | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4000) return null;

  // Path-only (optionally quoted/backticked): treat as explicit open.
  const unquoted = trimmed.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (unquoted.length > 0 && !/(^|\/)\.\.(\/|$)/.test(unquoted)) {
    if (!unquoted.includes("/") && isOfficeBasenameToken(unquoted)) {
      return { path: unquoted, kind: "path_only", isBasename: true };
    }
    if (
      unquoted === extractOfficeVaultPathFromText(unquoted) &&
      isOfficeEditorPath(unquoted)
    ) {
      return { path: unquoted, kind: "path_only", isBasename: false };
    }
  }

  // Soft mode A: first office path/basename reference opens the pane —
  // open/work verbs are optional and only refine `kind`.
  const extracted = extractOfficePathOrBasenameFromText(trimmed);
  if (!extracted) return null;
  if (OPEN_DOCUMENT_INTENT_RE.test(trimmed)) {
    return {
      path: extracted.path,
      kind: "open_request",
      isBasename: extracted.isBasename,
    };
  }
  return {
    path: extracted.path,
    kind: "path_reference",
    isBasename: extracted.isBasename,
  };
}

/**
 * Build a PANEL_OPEN action from a user/composer message when soft mode A
 * detects an office path/basename reference (lp-dpr.2).
 *
 * Returns null when there is no office path/basename, or when a basename
 * cannot be uniquely resolved via {@link OpenDocumentPathOptions.resolveBasename}.
 */
export function openDocumentIntentFromUserMessage(
  text: string,
  options: OpenDocumentPathOptions = {},
): ArtifactPanelAction | null {
  const intent = detectChatOpenDocumentIntent(text);
  if (!intent) return null;

  let path = intent.path;
  if (intent.isBasename) {
    const resolved = options.resolveBasename?.(path) ?? null;
    if (!resolved) return null;
    path = resolved;
  }

  return openDocumentPathAction(path, {
    ...options,
    source: options.source ?? "deep_link",
  });
}
