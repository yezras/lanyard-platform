import { useCallback, useEffect, useMemo, useState } from "react";

import { Text } from "@astryxdesign/core/Text";

import { listAgents } from "../../api/agents.js";
import { getChannel, setChannelLead } from "../../api/channels.js";
import type { Channel, DurableAgent } from "../../api/types.js";

export type ChannelLeadSelectProps = {
  threadId: string;
  canEdit?: boolean;
};

/**
 * Channel lead picker (lp-cxhb.7 I9). Unmentioned mail wakes this member.
 */
export function ChannelLeadSelect({
  threadId,
  canEdit = true,
}: ChannelLeadSelectProps) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [agents, setAgents] = useState<DurableAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void Promise.all([getChannel(threadId), listAgents()])
      .then(([nextChannel, nextAgents]) => {
        if (cancelled) return;
        setChannel(nextChannel);
        setAgents(nextAgents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setChannel(null);
        setError(err instanceof Error ? err.message : "Failed to load channel");
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.agent_id, agent.name);
    }
    return map;
  }, [agents]);

  const handleChange = useCallback(
    async (leadAgentId: string) => {
      if (!canEdit || isSaving || !channel) return;
      if (leadAgentId === channel.lead_agent_id) return;
      setIsSaving(true);
      setError(null);
      try {
        const updated = await setChannelLead(threadId, leadAgentId);
        setChannel(updated);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to set lead");
      } finally {
        setIsSaving(false);
      }
    },
    [canEdit, channel, isSaving, threadId],
  );

  if (!channel) {
    return null;
  }

  return (
    <div
      data-testid={`channel-lead-select-${threadId}`}
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
    >
      <Text type="supporting" color="secondary">
        Lead
      </Text>
      <select
        aria-label="Channel lead"
        data-testid={`channel-lead-select-input-${threadId}`}
        value={channel.lead_agent_id}
        disabled={!canEdit || isSaving}
        onChange={(event) => {
          void handleChange(event.target.value);
        }}
      >
        {channel.members.map((member) => (
          <option key={member.agent_id} value={member.agent_id}>
            {nameById.get(member.agent_id) ?? member.agent_id}
          </option>
        ))}
      </select>
      {error ? (
        <Text type="supporting" color="secondary" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
