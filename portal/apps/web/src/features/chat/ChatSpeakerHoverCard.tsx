/**
 * Speaker hover card (lp-8sh4.4): hovering an agent name in a channel stream
 * shows a Grok-like card (dither avatar + display name) whose action opens
 * that agent's 1:1. Channel-only — the 1:1 ghost UI never mounts this.
 */

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";

import type { ChatThreadSummary, HistorySpeaker } from "../../api/types.js";

import { useOptionalChatThread } from "../projects/ChatThreadContext.js";

import { DitherAvatar } from "./DitherAvatar.js";

/** Find the durable-agent 1:1 thread for a persona speaker id. */
export function findAgentDmThread(
  threads: readonly ChatThreadSummary[],
  personaId: string,
): ChatThreadSummary | null {
  return (
    threads.find(
      (thread) => thread.agent_id === personaId && thread.kind !== "group",
    ) ?? null
  );
}

export function ChatSpeakerHoverCard({
  speaker,
  children,
}: {
  speaker: HistorySpeaker;
  children: ReactNode;
}) {
  const chat = useOptionalChatThread();
  if (speaker.kind !== "persona") {
    return <>{children}</>;
  }

  const dmThread = chat ? findAgentDmThread(chat.threads, speaker.id) : null;
  const openDm = () => {
    if (chat && dmThread) {
      chat.selectThread(dmThread.thread_id);
    }
  };

  return (
    <HoverCard
      placement="below"
      alignment="start"
      delay={150}
      hideDelay={200}
      hasHoverIndication={false}
      content={
        <VStack gap={2} data-testid={`speaker-hover-card-${speaker.id}`}>
          <HStack gap={2} align="center">
            <DitherAvatar
              seed={speaker.id}
              size="sm"
              label={speaker.display_name}
            />
            <Text type="label" weight="semibold" maxLines={1}>
              {speaker.display_name}
            </Text>
          </HStack>
          {dmThread ? (
            <Button
              label={`Message ${speaker.display_name}`}
              variant="secondary"
              size="sm"
              data-testid={`speaker-hover-open-dm-${speaker.id}`}
              onClick={openDm}
            />
          ) : null}
        </VStack>
      }
    >
      {children}
    </HoverCard>
  );
}
