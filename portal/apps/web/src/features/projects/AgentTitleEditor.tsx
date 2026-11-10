/**
 * Inline agent title editor (lp-fn5.3.3 / lp-pxr.5).
 *
 * Double-click (or external startEditing) → compact TextInput; Enter or blur
 * saves via onRename; Escape cancels without save. Used by sidebar
 * AgentSideNavRow and chat header.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";

/** Compact rename field width (~20 characters, not full-bleed). */
const RENAME_FIELD_WIDTH = "20ch";

export type AgentTitleEditorProps = {
  title: string;
  /** When false, double-click is ignored (invitee / read-only). */
  canRename: boolean;
  /**
   * Persist rename (caller should PATCH with title_source=user).
   * Empty / whitespace-only is ignored by the editor.
   */
  onRename?: (nextTitle: string) => void | Promise<void>;
  /**
   * Controlled editing start from parent (e.g. MoreMenu "Rename").
   * When true, enter edit mode; parent should reset after.
   */
  requestEdit?: boolean;
  /** Clear requestEdit after consuming it. */
  onRequestEditConsumed?: () => void;
  /** test id prefix, e.g. `agent-side-nav-title-thread-1` */
  testId?: string;
  /** Display when not editing. */
  display?: ReactNode;
};

/**
 * Title text with optional inline rename. Falls back to plain Text when
 * `display` is not provided.
 */
export function AgentTitleEditor({
  title,
  canRename,
  onRename,
  requestEdit = false,
  onRequestEditConsumed,
  testId,
  display,
}: AgentTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  /** Guards Enter+blur (and re-entrant) double-commit. */
  const savingRef = useRef(false);
  /** Escape cancel must not be overridden by a subsequent blur commit. */
  const cancelledRef = useRef(false);
  const labelId = useId();

  // Keep draft in sync when not editing (LLM/first-message title updates).
  useEffect(() => {
    if (!isEditing) {
      setDraft(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (requestEdit && canRename && onRename) {
      cancelledRef.current = false;
      setDraft(title);
      setIsEditing(true);
      onRequestEditConsumed?.();
    }
  }, [requestEdit, canRename, onRename, title, onRequestEditConsumed]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setDraft(title);
    setIsEditing(false);
    savingRef.current = false;
  }, [title]);

  const commit = useCallback(async () => {
    if (savingRef.current || cancelledRef.current) {
      return;
    }
    const next = draft.trim();
    if (!next || next === title.trim()) {
      // Exit edit without persist (empty / unchanged).
      cancelledRef.current = true;
      setDraft(title);
      setIsEditing(false);
      savingRef.current = false;
      return;
    }
    if (!onRename) {
      cancelledRef.current = true;
      setDraft(title);
      setIsEditing(false);
      savingRef.current = false;
      return;
    }
    savingRef.current = true;
    setIsEditing(false);
    try {
      await onRename(next);
    } finally {
      savingRef.current = false;
    }
  }, [draft, title, onRename]);

  const startEdit = useCallback(
    (event?: MouseEvent) => {
      if (!canRename || !onRename) {
        return;
      }
      event?.preventDefault();
      event?.stopPropagation();
      cancelledRef.current = false;
      setDraft(title);
      setIsEditing(true);
    },
    [canRename, onRename, title],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    },
    [cancel],
  );

  const handleBlur = useCallback(
    (_event: FocusEvent<HTMLInputElement>) => {
      void commit();
    },
    [commit],
  );

  if (isEditing) {
    return (
      <span
        data-testid={testId ? `${testId}-editing` : "agent-title-editing"}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          display: "block",
          minWidth: 0,
          width: RENAME_FIELD_WIDTH,
          maxWidth: RENAME_FIELD_WIDTH,
        }}
      >
        <TextInput
          label="Agent name"
          isLabelHidden
          value={draft}
          onChange={setDraft}
          size="sm"
          width={RENAME_FIELD_WIDTH}
          hasAutoFocus
          onEnter={() => {
            void commit();
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          htmlName={`agent-title-${labelId}`}
        />
      </span>
    );
  }

  const content = display ?? (
    <Text type="label" weight="semibold" maxLines={1}>
      {title || "New chat"}
    </Text>
  );

  return (
    <span
      data-testid={testId ?? "agent-title"}
      onDoubleClick={startEdit}
      title={canRename && onRename ? "Double-click to rename" : undefined}
      style={{
        display: "block",
        minWidth: 0,
        cursor: canRename && onRename ? "text" : undefined,
      }}
    >
      {content}
    </span>
  );
}
