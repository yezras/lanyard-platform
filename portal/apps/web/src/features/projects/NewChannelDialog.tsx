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
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { createAgent, listAgents } from "../../api/agents.js";
import { createChannel } from "../../api/channels.js";
import type { Channel, DurableAgent } from "../../api/types.js";

import { DitherAvatar } from "../chat/DitherAvatar.js";

import { canSubmitCreateChannel, uniqueMemberIds } from "./createChannelDraft.js";

export type NewChannelDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void | Promise<void>;
};

/**
 * Create-channel popup (lp-cxhb.5 I4/I5/I6; lp-8sh4.2 chip picker).
 * Required name, pick catalog agents as dither icon + name chips, or create
 * a new agent inline. Submit stays disabled until two unique members.
 */
export function NewChannelDialog({
  isOpen,
  onOpenChange,
  onCreated,
}: NewChannelDialogProps) {
  const [name, setName] = useState("");
  const [agents, setAgents] = useState<DurableAgent[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [agentsStatus, setAgentsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [newAgentName, setNewAgentName] = useState("");
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setAgents([]);
    setSelectedIds([]);
    setAgentsStatus("idle");
    setNewAgentName("");
    setIsCreatingAgent(false);
    setIsCreatingChannel(false);
    setError(null);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    setAgentsStatus("loading");
    setError(null);
    void listAgents()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        setAgentsStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAgentsStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load agents");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const memberIds = uniqueMemberIds(selectedIds);
  const canSubmit = canSubmitCreateChannel({
    name,
    memberAgentIds: memberIds,
  });

  const toggleMember = (agentId: string) => {
    setError(null);
    setSelectedIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  };

  const handleAddAgent = async () => {
    const agentName = newAgentName.trim();
    if (!agentName || isCreatingAgent) {
      return;
    }
    setIsCreatingAgent(true);
    setError(null);
    try {
      const agent = await createAgent({ name: agentName });
      setAgents((current) => {
        if (current.some((row) => row.agent_id === agent.agent_id)) {
          return current;
        }
        return [agent, ...current];
      });
      setSelectedIds((current) =>
        current.includes(agent.agent_id)
          ? current
          : [...current, agent.agent_id],
      );
      setNewAgentName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsCreatingAgent(false);
    }
  };

  const handleCreate = async () => {
    if (!canSubmit || isCreatingChannel) {
      return;
    }
    setIsCreatingChannel(true);
    setError(null);
    try {
      const channel = await createChannel({
        name: name.trim(),
        member_agent_ids: memberIds,
      });
      reset();
      onOpenChange(false);
      await onCreated(channel);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
      setIsCreatingChannel(false);
    }
  };

  const emptyCatalog = agentsStatus === "ready" && agents.length === 0;

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      purpose="form"
      width={440}
    >
      <Layout
        header={
          <DialogHeader title="New channel" onOpenChange={handleOpenChange} />
        }
        content={
          <LayoutContent>
            <VStack gap={4} data-testid="new-channel-dialog">
              <TextInput
                label="Channel name"
                value={name}
                onChange={setName}
                placeholder="Channel name"
              />

              {agentsStatus === "loading" ? (
                <HStack gap={2} align="center">
                  <Spinner size="sm" />
                  <Text type="supporting" color="secondary">
                    Loading agents…
                  </Text>
                </HStack>
              ) : null}

              {emptyCatalog ? (
                <Text type="supporting" color="secondary">
                  No agents yet. Create two members to continue.
                </Text>
              ) : null}

              {agents.length > 0 ? (
                <HStack gap={2} style={{ flexWrap: "wrap" }}>
                  {agents.map((agent) => {
                    const isSelected = memberIds.includes(agent.agent_id);
                    return (
                      <Token
                        key={agent.agent_id}
                        label={agent.name}
                        icon={
                          <DitherAvatar
                            seed={agent.avatar || agent.name}
                            size={16}
                          />
                        }
                        color={isSelected ? "blue" : "default"}
                        onClick={() => toggleMember(agent.agent_id)}
                        data-testid={`channel-member-pick-${agent.agent_id}`}
                      />
                    );
                  })}
                </HStack>
              ) : null}

              <VStack gap={2}>
                <TextInput
                  label="New agent name"
                  value={newAgentName}
                  onChange={setNewAgentName}
                  placeholder="Create a new agent"
                />
                <HStack hAlign="end">
                  <Button
                    label="Add agent"
                    variant="secondary"
                    size="sm"
                    isDisabled={!newAgentName.trim() || isCreatingAgent}
                    isLoading={isCreatingAgent}
                    onClick={() => {
                      void handleAddAgent();
                    }}
                  />
                </HStack>
              </VStack>

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
                label="Cancel"
                variant="secondary"
                size="sm"
                isDisabled={isCreatingChannel}
                onClick={() => handleOpenChange(false)}
              />
              <Button
                label="Create channel"
                variant="primary"
                size="sm"
                data-testid="create-channel-submit"
                isDisabled={!canSubmit || isCreatingChannel}
                isLoading={isCreatingChannel}
                onClick={() => {
                  void handleCreate();
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
