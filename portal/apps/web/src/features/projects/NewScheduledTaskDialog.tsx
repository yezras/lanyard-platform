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
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import { createAgent, listAgents } from "../../api/agents.js";
import type { DurableAgent } from "../../api/types.js";

import { canSubmitBindScheduledTask } from "./createScheduledTaskDraft.js";

export type NewScheduledTaskDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onBound: (agent: DurableAgent) => void | Promise<void>;
};

/**
 * + New scheduled task (lp-cxhb.11 I14).
 * Pick or create exactly one durable agent, then continue to the wizard.
 * The resulting job stream lives under Scheduled Tasks, not a channel.
 */
export function NewScheduledTaskDialog({
  isOpen,
  onOpenChange,
  onBound,
}: NewScheduledTaskDialogProps) {
  const [agents, setAgents] = useState<DurableAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentsStatus, setAgentsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [newAgentName, setNewAgentName] = useState("");
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setAgents([]);
    setSelectedId(null);
    setAgentsStatus("idle");
    setNewAgentName("");
    setIsCreatingAgent(false);
    setIsContinuing(false);
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

  const canSubmit = canSubmitBindScheduledTask({ agentId: selectedId });

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
      setSelectedId(agent.agent_id);
      setNewAgentName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsCreatingAgent(false);
    }
  };

  const handleContinue = async () => {
    const agent = agents.find((row) => row.agent_id === selectedId);
    if (!canSubmit || !agent || isContinuing) {
      return;
    }
    setIsContinuing(true);
    setError(null);
    try {
      reset();
      onOpenChange(false);
      await onBound(agent);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to start scheduled task",
      );
      setIsContinuing(false);
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
          <DialogHeader
            title="New scheduled task"
            subtitle="Pick or create one agent. The job stream stays under Scheduled Tasks."
            onOpenChange={handleOpenChange}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={4} data-testid="new-scheduled-task-dialog">
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
                  No agents yet. Create one to continue.
                </Text>
              ) : null}

              {agents.length > 0 ? (
                <List
                  density="compact"
                  header={
                    <Text type="supporting" color="secondary">
                      Agent
                    </Text>
                  }
                >
                  {agents.map((agent) => (
                    <ListItem
                      key={agent.agent_id}
                      label={agent.name}
                      data-testid={`scheduled-task-agent-pick-${agent.agent_id}`}
                      isSelected={selectedId === agent.agent_id}
                      onClick={() => {
                        setError(null);
                        setSelectedId(agent.agent_id);
                      }}
                    />
                  ))}
                </List>
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
                isDisabled={isContinuing}
                onClick={() => handleOpenChange(false)}
              />
              <Button
                label="Continue"
                variant="primary"
                size="sm"
                data-testid="scheduled-task-bind-submit"
                isDisabled={!canSubmit || isContinuing}
                isLoading={isContinuing}
                onClick={() => {
                  void handleContinue();
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
