import { apiFetch } from "./client.js";
import { normalizeChatThreadSummary } from "./threadMeta.js";
import type { ChatThreadSummary, DurableAgent } from "./types.js";

export type CreateAgentInput = {
  name?: string;
  avatar?: string;
  objective?: string;
};

function parseAgentError(res: Response, fallback: string): Promise<string> {
  return res
    .json()
    .catch(() => ({}))
    .then((body: { error?: string; message?: string }) => {
      return body.error ?? body.message ?? fallback;
    });
}

function asDurableAgent(raw: Partial<DurableAgent>): DurableAgent {
  const agent_id = typeof raw.agent_id === "string" ? raw.agent_id.trim() : "";
  const thread_id =
    typeof raw.thread_id === "string" ? raw.thread_id.trim() : "";
  if (!agent_id || !thread_id) {
    throw new Error("Agent response missing agent_id or thread_id");
  }
  return {
    agent_id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "New agent",
    avatar: typeof raw.avatar === "string" ? raw.avatar : "",
    objective: typeof raw.objective === "string" ? raw.objective : "",
    thread_id,
    created_at:
      typeof raw.created_at === "string" && raw.created_at
        ? raw.created_at
        : new Date().toISOString(),
  };
}

/**
 * Map a catalog row onto the interactive 1:1 the sidenav already lists.
 * Catalog is identity; the thread is the log (lp-cxhb.4).
 */
export function threadSummaryFromDurableAgent(
  agent: DurableAgent,
): ChatThreadSummary {
  const named = agent.name.trim().length > 0 && agent.name !== "New agent";
  const hasObjective = agent.objective.trim().length > 0;
  return normalizeChatThreadSummary({
    thread_id: agent.thread_id,
    title: agent.name || "New agent",
    project_id: null,
    project_vault_path: null,
    created_at: agent.created_at,
    avatar_seed: agent.avatar,
    title_source: named ? "user" : "default",
    kind: "chat",
    scheduled_job_id: null,
    system_prompt: agent.objective,
    system_prompt_source: hasObjective ? "user" : "default",
    agent_id: agent.agent_id,
    access: "owner",
  });
}

/**
 * Mint a durable agent plus its one interactive 1:1 (POST /api/agents).
 * A second call always allocates a different agent_id.
 */
export async function createAgent(
  input: CreateAgentInput = {},
): Promise<DurableAgent> {
  const body: CreateAgentInput = {};
  if (input.name?.trim()) body.name = input.name.trim();
  if (input.avatar?.trim()) body.avatar = input.avatar.trim();
  if (input.objective !== undefined) body.objective = input.objective;

  const res = await apiFetch("/api/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      await parseAgentError(res, `Failed to create agent (${res.status})`),
    );
  }
  return asDurableAgent((await res.json()) as Partial<DurableAgent>);
}

/** List durable agents for the signed-in owner (GET /api/agents). */
export async function listAgents(): Promise<DurableAgent[]> {
  const res = await apiFetch("/api/agents");
  if (!res.ok) {
    throw new Error(`Failed to list agents (${res.status})`);
  }
  const payload = (await res.json()) as { agents?: Partial<DurableAgent>[] };
  return (payload.agents ?? []).map((row) => asDurableAgent(row));
}

/**
 * Rename a durable agent (PATCH /api/agents/:id). Catalog name, bound 1:1
 * title, and group persona chips stay in lockstep (lp-v62i.22).
 */
export async function renameAgent(input: {
  agentId: string;
  name: string;
}): Promise<DurableAgent> {
  const agentId = input.agentId.trim();
  const name = input.name.trim();
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(
      await parseAgentError(res, `Failed to rename agent (${res.status})`),
    );
  }
  return asDurableAgent((await res.json()) as Partial<DurableAgent>);
}
