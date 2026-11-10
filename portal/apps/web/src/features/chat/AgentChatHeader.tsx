/**
 * Agent identity strip above the chat timeline (lp-fn5.3.3 / lp-lv9.4 / lp-pxr.4).
 *
 * Shows dither avatar + display name:
 * - Single-click name opens the purpose editor Dialog (interactive).
 * - Double-click name renames via the same path as the sidebar.
 *
 * Channels (kind="group", lp-cxhb.15.2): no lead selector or member roster in
 * the chrome. Clicking the channel name opens the members + purposes sheet.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import {
  Dialog,
  DialogHeader,
} from "@astryxdesign/core/Dialog";
import { HStack } from "@astryxdesign/core/HStack";
import {
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";

import { isGroupThread } from "../../api/groupRoom.js";
import { resolveAvatarSeed } from "../../api/threadMeta.js";
import type { ChatThreadSummary } from "../../api/types.js";
import { AgentTitleEditor } from "../projects/AgentTitleEditor.js";

import { ChannelHeaderSheet } from "./ChannelHeaderSheet.js";
import { DitherAvatar } from "./DitherAvatar.js";

/** Soft cap matching BFF SYSTEM_PROMPT_MAX_CHARS. */
const SYSTEM_PROMPT_MAX_CHARS = 800;

/** Delay to distinguish single-click (purpose) from double-click (rename). */
const SINGLE_CLICK_DELAY_MS = 280;

export type AgentChatHeaderProps = {
  thread: ChatThreadSummary;
  canRename: boolean;
  onRename?: (nextTitle: string) => void | Promise<void>;
  /**
   * When set, single-click on the agent name opens the purpose editor.
   * Save calls this with the draft (source=user on the server).
   */
  canEditSystemPrompt?: boolean;
  onSaveSystemPrompt?: (nextPrompt: string) => void | Promise<void>;
};

export function AgentChatHeader({
  thread,
  canRename,
  onRename,
  canEditSystemPrompt = false,
  onSaveSystemPrompt,
}: AgentChatHeaderProps) {
  const title = thread.title || "New chat";
  const seed = resolveAvatarSeed(thread);
  const group = isGroupThread(thread);
  /** Channel roster surface lives behind the title click (lp-cxhb.15.2). */
  const isChannel = thread.kind === "group";
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(thread.system_prompt ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextClickRef = useRef(false);

  useEffect(() => {
    if (!isPromptOpen) {
      setDraftPrompt(thread.system_prompt ?? "");
    }
  }, [thread.system_prompt, isPromptOpen]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  const openPromptEditor = useCallback(() => {
    if (isChannel) return;
    if (!canEditSystemPrompt || !onSaveSystemPrompt) return;
    setDraftPrompt(thread.system_prompt ?? "");
    setIsPromptOpen(true);
  }, [canEditSystemPrompt, isChannel, onSaveSystemPrompt, thread.system_prompt]);

  const closePromptEditor = useCallback(() => {
    setIsPromptOpen(false);
    setDraftPrompt(thread.system_prompt ?? "");
    setIsSaving(false);
  }, [thread.system_prompt]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closePromptEditor();
        return;
      }
      setIsPromptOpen(true);
    },
    [closePromptEditor],
  );

  const savePrompt = useCallback(async () => {
    if (!onSaveSystemPrompt || isSaving) return;
    const next = draftPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
    setIsSaving(true);
    try {
      await onSaveSystemPrompt(next);
      setIsPromptOpen(false);
    } finally {
      setIsSaving(false);
    }
  }, [draftPrompt, onSaveSystemPrompt, isSaving]);

  const handleTitleClick = useCallback(() => {
    if (isChannel) return;
    if (!canEditSystemPrompt || !onSaveSystemPrompt) return;
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      openPromptEditor();
    }, SINGLE_CLICK_DELAY_MS);
  }, [canEditSystemPrompt, isChannel, onSaveSystemPrompt, openPromptEditor]);

  const handleTitleDoubleClickCapture = useCallback(() => {
    // Cancel pending single-click purpose open so double-click rename wins.
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    ignoreNextClickRef.current = true;
  }, []);

  return (
    <div
      data-testid={`agent-chat-header-${thread.thread_id}`}
      className="agent-chat-header"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 16px 6px",
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        {group ? null : (
          <DitherAvatar
            seed={seed}
            size="md"
            label={title}
            data-testid={`agent-chat-header-avatar-${thread.thread_id}`}
          />
        )}
        <HStack gap={2} align="center" style={{ minWidth: 0, flex: 1 }}>
          {isChannel ? (
            <button
              type="button"
              data-testid={`agent-chat-header-title-button-${thread.thread_id}`}
              aria-haspopup="dialog"
              aria-expanded={isSheetOpen}
              onClick={() => setIsSheetOpen(true)}
              style={{
                minWidth: 0,
                flex: 1,
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
              }}
              title="Click to view members and purposes"
            >
              <Text type="label" weight="semibold" maxLines={1}>
                {`#${title}`}
              </Text>
            </button>
          ) : (
            <div
              data-testid={`agent-chat-header-title-wrap-${thread.thread_id}`}
              onClick={handleTitleClick}
              onDoubleClickCapture={handleTitleDoubleClickCapture}
              style={{ minWidth: 0, flex: 1 }}
              title={
                canEditSystemPrompt && onSaveSystemPrompt
                  ? "Click to edit purpose · Double-click to rename"
                  : canRename && onRename
                    ? "Double-click to rename"
                    : undefined
              }
            >
              <AgentTitleEditor
                title={title}
                canRename={canRename}
                onRename={onRename}
                testId={`agent-chat-header-title-${thread.thread_id}`}
                display={
                  <Text type="label" weight="semibold" maxLines={1}>
                    {title}
                  </Text>
                }
              />
            </div>
          )}
        </HStack>
      </div>

      {isChannel ? (
        <ChannelHeaderSheet
          threadId={thread.thread_id}
          channelName={title}
          isOpen={isSheetOpen}
          onOpenChange={setIsSheetOpen}
        />
      ) : null}

      {!isChannel && canEditSystemPrompt && onSaveSystemPrompt ? (
        <Dialog
          isOpen={isPromptOpen}
          onOpenChange={handleOpenChange}
          purpose="form"
          width={480}
          data-testid={`agent-purpose-dialog-${thread.thread_id}`}
        >
          <Layout
            header={
              <DialogHeader
                title="Purpose"
                subtitle="What this agent chat is for"
                onOpenChange={handleOpenChange}
              />
            }
            content={
              <LayoutContent>
                <VStack
                  gap={2}
                  align="stretch"
                  data-testid={`agent-system-prompt-editor-${thread.thread_id}`}
                >
                  <TextArea
                    label="Purpose"
                    isLabelHidden
                    value={draftPrompt}
                    onChange={setDraftPrompt}
                    rows={6}
                    isDisabled={isSaving}
                    htmlName={`agent-system-prompt-${thread.thread_id}`}
                    data-testid={`agent-system-prompt-input-${thread.thread_id}`}
                  />
                </VStack>
              </LayoutContent>
            }
            footer={
              <LayoutFooter>
                <HStack gap={2} hAlign="end">
                  <Button
                    type="button"
                    label="Cancel"
                    size="sm"
                    variant="secondary"
                    isDisabled={isSaving}
                    onClick={closePromptEditor}
                    data-testid={`agent-system-prompt-cancel-${thread.thread_id}`}
                  />
                  <Button
                    type="button"
                    label={isSaving ? "Saving…" : "Save"}
                    size="sm"
                    variant="primary"
                    isDisabled={isSaving}
                    isLoading={isSaving}
                    onClick={() => {
                      void savePrompt();
                    }}
                    data-testid={`agent-system-prompt-save-${thread.thread_id}`}
                  />
                </HStack>
              </LayoutFooter>
            }
          />
        </Dialog>
      ) : null}
    </div>
  );
}
