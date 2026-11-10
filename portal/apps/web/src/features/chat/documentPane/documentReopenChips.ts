/**
 * Thread-local document reopen chips (lp-a8u.2).
 *
 * Minted after a successful document pane open (preview / edit / progress /
 * conflict) so soft-open, agent tool_target, and citation paths leave a
 * durable inline control after the pane is closed.
 */

import type { ArtifactPanelStatus, VaultArtifactRef } from "./types.js";

/** Lightweight reopen affordance shown in the chat timeline. */
export type DocumentReopenChip = {
  /** Normalized vault path (absolute form). */
  path: string;
  /** Optional display title (basename or citation title). */
  title?: string;
};

/** Max distinct paths retained per thread (latest wins order). */
export const DOCUMENT_REOPEN_CHIP_MAX = 12;

/**
 * Statuses that mean the pane successfully holds a document open.
 * Exclude `opening` (in-flight) and `error` so failed opens do not mint chips.
 */
const SUCCESS_OPEN_STATUSES: ReadonlySet<ArtifactPanelStatus> = new Set([
  "previewing",
  "editing",
  "progress",
  "conflict",
]);

/** True when panel state should leave a durable reopen chip. */
export function shouldRecordDocumentReopenChip(
  status: ArtifactPanelStatus,
  ref: VaultArtifactRef | null | undefined,
): boolean {
  if (!ref?.path?.trim()) {
    return false;
  }
  return SUCCESS_OPEN_STATUSES.has(status);
}

/**
 * Insert or move a chip to the end (most recent). Dedupes by path.
 * Caps at {@link DOCUMENT_REOPEN_CHIP_MAX} (drops oldest).
 */
export function upsertDocumentReopenChip(
  chips: readonly DocumentReopenChip[],
  next: DocumentReopenChip,
  max = DOCUMENT_REOPEN_CHIP_MAX,
): DocumentReopenChip[] {
  const path = next.path.trim();
  if (!path || max <= 0) {
    return [...chips];
  }
  const title = next.title?.trim() || undefined;
  const without = chips.filter((c) => c.path !== path);
  const entry: DocumentReopenChip = title
    ? { path, title }
    : { path };
  const merged = [...without, entry];
  if (merged.length <= max) {
    return merged;
  }
  return merged.slice(merged.length - max);
}

/** Build a chip from a panel ref when record criteria pass. */
export function documentReopenChipFromRef(
  ref: VaultArtifactRef,
): DocumentReopenChip {
  const title = ref.title?.trim() || undefined;
  return title ? { path: ref.path, title } : { path: ref.path };
}
