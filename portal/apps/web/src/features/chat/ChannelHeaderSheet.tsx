/**
 * Channel members + purposes sheet (lp-cxhb.15.2).
 *
 * Opened only from clicking the channel name in the chat header. Lead and
 * membership never render inline in the live transcript / chat chrome.
 * 1:1 chats must not mount this surface at all.
 *
 * lp-rxr9: this sheet is also the single member-management entry point.
 * Add/remove lives here (channel-only surface); remove is disabled at the
 * floor of two — BFF enforcement survives regardless of client state.
 */

import { useCallback, useEffect, useState } from "react";

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
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { listAgents } from "../../api/agents.js";
import {
  addChannelMember,
  listChannels,
  removeChannelMember,
} from "../../api/channels.js";

import {
  CHANNEL_MIN_MEMBERS,
  canRemoveChannelMember,
} from "../projects/createChannelDraft.js";
import { DitherAvatar } from "./DitherAvatar.js";
import {
  buildChannelMemberRows,
  findChannelForThread,
  UNKNOWN_MEMBER_NAME,
  type ChannelMemberRow,
} from "./channelHeaderSheet.js";

type SheetStatus = "idle" | "loading" | "ready" | "error";

export type ChannelHeaderSheetProps = {
  threadId: string;
  channelName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

function memberRowLabel(row: ChannelMemberRow): string {
  return row.isLead ? `${row.name} · Lead` : row.name;
}

export function ChannelHeaderSheet({
  threadId,
  channelName,
  isOpen,
  onOpenChange,
}: ChannelHeaderSheetProps) {
  const [status, setStatus] = useState<SheetStatus>("idle");
  const [rows, setRows] = useState<ChannelMemberRow[]>([]);
  const [addableIds, setAddableIds] = useState<string[]>([]);
  const [catalogNames, setCatalogNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);

  const loadRoster = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    void Promise.all([listChannels(), listAgents()])
      .then(([channels, agents]) => {
        if (cancelled) return;
        const channel = findChannelForThread(channels, threadId);
        setRows(buildChannelMemberRows(channel, agents));
        const memberIds = new Set(
          channel?.members.map((row) => row.agent_id) ?? [],
        );
        setAddableIds(
          agents
            .filter((agent) => !memberIds.has(agent.agent_id))
            .map((agent) => agent.agent_id),
        );
        setCatalogNames(
          new Map(agents.map((agent) => [agent.agent_id, agent.name])),
        );
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load members");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const cancel = loadRoster();
    return () => cancel();
  }, [isOpen, loadRoster]);

  const canRemove = canRemoveChannelMember(rows.length);
  const busy = busyAgentId !== null;

  const handleAdd = async (agentId: string) => {
    if (busy || !threadId) return;
    setBusyAgentId(agentId);
    setError(null);
    try {
      await addChannelMember(threadId, agentId);
      loadRoster();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setBusyAgentId(null);
    }
  };

  const handleRemove = async (agentId: string) => {
    if (busy || !threadId || !canRemove) return;
    setBusyAgentId(agentId);
    setError(null);
    try {
      await removeChannelMember(threadId, agentId);
      loadRoster();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setBusyAgentId(null);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={440}
      data-testid={`channel-header-sheet-${threadId}`}
    >
      <Layout
        header={
          <DialogHeader
            title={channelName}
            subtitle="Members and purposes"
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={3} align="stretch" data-testid={`channel-sheet-body-${threadId}`}>
              {status === "loading" ? (
                <HStack gap={2} align="center">
                  <Spinner size="sm" />
                  <Text type="supporting" color="secondary">
                    Loading members…
                  </Text>
                </HStack>
              ) : null}

              {status === "error" ? (
                <Text type="supporting" color="secondary" role="alert">
                  {error}
                </Text>
              ) : null}

              {status === "ready" ? (
                rows.length > 0 ? (
                  <List
                    density="compact"
                    header={
                      <Text type="supporting" color="secondary">
                        Members
                      </Text>
                    }
                  >
                    {rows.map((row) => (
                      <ListItem
                        key={row.agent_id}
                        label={memberRowLabel(row)}
                        description={row.purpose || undefined}
                        startContent={
                          <DitherAvatar
                            seed={row.agent_id}
                            size="sm"
                            label={row.name}
                            data-testid={`channel-sheet-avatar-${row.agent_id}`}
                          />
                        }
                        data-testid={`channel-sheet-member-${row.agent_id}`}
                        endContent={
                          <Button
                            label="Remove"
                            variant="secondary"
                            size="sm"
                            data-testid={`channel-sheet-remove-${row.agent_id}`}
                            isDisabled={!canRemove || busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRemove(row.agent_id);
                            }}
                          />
                        }
                      />
                    ))}
                  </List>
                ) : (
                  <Text type="supporting" color="secondary">
                    No members found for this channel.
                  </Text>
                )
              ) : null}

              {status === "ready" && !canRemove ? (
                <Text
                  type="supporting"
                  color="secondary"
                  data-testid={`channel-sheet-floor-hint-${threadId}`}
                >
                  A channel needs at least {CHANNEL_MIN_MEMBERS} members.
                </Text>
              ) : null}

              {status === "ready" && addableIds.length > 0 ? (
                <List
                  density="compact"
                  header={
                    <Text type="supporting" color="secondary">
                      Add agents
                    </Text>
                  }
                >
                  {addableIds.map((agentId) => (
                    <ListItem
                      key={agentId}
                      label={catalogNames.get(agentId) ?? UNKNOWN_MEMBER_NAME}
                      startContent={
                        <DitherAvatar
                          seed={agentId}
                          size="sm"
                          label={catalogNames.get(agentId) ?? UNKNOWN_MEMBER_NAME}
                          data-testid={`channel-sheet-avatar-${agentId}`}
                        />
                      }
                      data-testid={`channel-sheet-add-${agentId}`}
                      isDisabled={busy}
                      onClick={() => {
                        void handleAdd(agentId);
                      }}
                    />
                  ))}
                </List>
              ) : null}

              {error ? (
                <Text type="supporting" color="secondary" role="alert">
                  {error}
                </Text>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button
                type="button"
                label="Close"
                size="sm"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                data-testid={`channel-sheet-close-${threadId}`}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
