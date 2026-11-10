/**
 * Persona identity stamped onto harness turns (lp-v62i.19.1 / lp-v62i.24).
 *
 * Channel turns already had a system prompt. 1:1 turns did not, so Bill
 * introduced himself as Muse Spark. Same helper for both.
 * Prompts use display names only — never thread_id, agent UUID, or nonce.
 */

import type { ChatThread, DurableAgent } from "./chat-store.js";
import type { TurnRequestPersona } from "@lanyard/shared";

export function personaDisplayName(
  agent: DurableAgent | undefined,
  personaId: string,
): string {
  const name = agent?.name?.trim();
  return name && name.length > 0 ? name : personaId;
}

export function formatTeammateLine(agent: DurableAgent): string {
  return agent.name;
}

export function buildPersonaSystemPrompt(input: {
  thread: ChatThread;
  personaId: string;
  agent: DurableAgent | undefined;
  teammates?: readonly DurableAgent[];
}): string {
  const displayName = personaDisplayName(input.agent, input.personaId);
  const parts: string[] = [];
  if (input.thread.kind === "group") {
    const rosterMembers = input.thread.participants
      .filter((p) => p.kind === "persona")
      .map((p) => p.display_name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    parts.push(`You are ${displayName}, an agent in the channel "${input.thread.title}".`);
    if (rosterMembers) parts.push(`Members: ${rosterMembers}.`);
  } else {
    parts.push(
      `You are ${displayName}. You are a named teammate, not a generic assistant. Never claim to be Muse Spark.`,
    );
    const peers = (input.teammates ?? []).filter(
      (row) => row.agent_id !== input.personaId,
    );
    if (peers.length > 0) {
      parts.push(`Teammates: ${peers.map(formatTeammateLine).join(", ")}.`);
    }
  }
  if (input.agent?.objective?.trim()) {
    parts.push(`Your objective: ${input.agent.objective.trim()}`);
  }
  if (input.thread.kind === "group") {
    parts.push(
      `In this channel, @Name asks that teammate and they reply here. @here asks everyone. Prefer @ over mailbox.send when you share the room; mailbox.send to their 1:1 only when you are not already together.`,
    );
  } else {
    parts.push(
      `To message a teammate use mailbox.send with to (their name) and text.`,
    );
  }
  parts.push("Reply concisely as this persona.");
  return parts.join(" ");
}

export function personaMetaForWake(input: {
  thread: ChatThread;
  personaId: string;
  agent: DurableAgent | undefined;
  teammates?: readonly DurableAgent[];
}): TurnRequestPersona {
  const displayName = personaDisplayName(input.agent, input.personaId);
  const persona: TurnRequestPersona = {
    persona_id: input.personaId,
    display_name: displayName,
    system_prompt: buildPersonaSystemPrompt(input),
  };
  if (input.agent?.avatar) {
    persona.avatar_seed = input.agent.avatar;
  }
  return persona;
}
