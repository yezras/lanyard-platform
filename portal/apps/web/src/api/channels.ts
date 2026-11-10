import { apiFetch } from "./client.js";
import { normalizeChatThreadSummary } from "./threadMeta.js";
import type { Channel, ChannelMember } from "./types.js";

export type CreateChannelInput = {
  name: string;
  member_agent_ids: string[];
};

export async function listChannels(): Promise<Channel[]> {
  const res = await apiFetch("/api/channels");
  if (!res.ok) {
    throw new Error(`Failed to list channels (${res.status})`);
  }
  const body = (await res.json()) as { channels?: Channel[] };
  return (body.channels ?? []).map(normalizeChannel);
}

export async function setChannelLead(
  threadId: string,
  leadAgentId: string,
): Promise<Channel> {
  const res = await apiFetch(`/api/channels/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify({ lead_agent_id: leadAgentId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error || body.message || `Failed to set channel lead (${res.status})`,
    );
  }
  return normalizeChannel((await res.json()) as Channel);
}

export async function createChannel(
  input: CreateChannelInput,
): Promise<Channel> {
  const res = await apiFetch("/api/channels", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      member_agent_ids: input.member_agent_ids,
    }),
  });
  if (!res.ok) {
    throw await channelError(res, "Failed to create channel");
  }
  return normalizeChannel((await res.json()) as Channel);
}

export async function getChannel(threadId: string): Promise<Channel> {
  const res = await apiFetch(`/api/channels/${threadId}`);
  if (!res.ok) {
    throw await channelError(res, "Failed to load channel");
  }
  return normalizeChannel((await res.json()) as Channel);
}

export async function addChannelMember(
  threadId: string,
  agentId: string,
): Promise<Channel> {
  const res = await apiFetch(`/api/channels/${threadId}/members`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!res.ok) {
    throw await channelError(res, "Failed to add channel member");
  }
  return normalizeChannel((await res.json()) as Channel);
}

export async function removeChannelMember(
  threadId: string,
  agentId: string,
): Promise<Channel> {
  const res = await apiFetch(
    `/api/channels/${threadId}/members/${agentId}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw await channelError(res, "Failed to remove channel member");
  }
  return normalizeChannel((await res.json()) as Channel);
}

export async function deleteChannel(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/channels/${threadId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await channelError(res, "Failed to delete channel");
  }
}

async function channelError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return new Error(body.error || body.message || `${fallback} (${res.status})`);
}

function normalizeChannel(raw: Channel): Channel {
  const summary = normalizeChatThreadSummary({
    thread_id: raw.thread_id,
    title: raw.title || raw.name,
    project_id: raw.project_id ?? null,
    project_vault_path: raw.project_vault_path ?? null,
    created_at: raw.created_at,
    avatar_seed: raw.avatar_seed,
    title_source: raw.title_source,
    kind: "group",
  });
  const members: ChannelMember[] = Array.isArray(raw.members)
    ? raw.members
    : [];
  return {
    thread_id: summary.thread_id,
    name: (raw.name || summary.title).trim() || summary.title,
    kind: "group",
    lead_agent_id: raw.lead_agent_id,
    members,
    created_at: summary.created_at,
    title: summary.title,
    avatar_seed: summary.avatar_seed,
    title_source: summary.title_source,
    project_id: summary.project_id,
    project_vault_path: summary.project_vault_path,
  };
}
