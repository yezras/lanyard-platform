/**
 * Group-room inbound stamp for BFF chat send (lac-bx3 P8).
 *
 * Mentions are parsed at the HTTP boundary, decideWake is the policy,
 * and the result is snake_case deliver-inbound metadata. 1:1 threads
 * are a no-op (no stamp keys — adapter treats that as `main`).
 *
 * @see contracts/group-rooms-v1/group-rooms.schema.json
 */

import {
  CONNECTOR_MARKS,
  type ChannelContext,
  type ConnectorMark,
} from "@lanyard/shared";

import type {
  ChatThread,
  HistorySpeaker,
  ThreadParticipant,
} from "./chat-store.js";
import { harnessWakeMetadata } from "./harness-wake-payload.js";
import {
  DEFAULT_HOP_CAP,
  decideWake,
  nextStickyPersonaIds,
  personaId,
  type PersonaId,
  type Roster,
  type WakeDecision,
  type WakeReason,
} from "./wake-policy.js";

/** group-rooms-v1 inbound metadata stamped onto MessageEvent.metadata. */
export type GroupInboundMetadata = {
  target_persona_ids: string[];
  target_persona_id: string;
  /** Channel lead. Unmentioned wake is this persona (lp-cxhb.7). */
  lead_persona_id: string;
  wake_reason: WakeReason;
  mentioned_persona_ids: string[];
  mentioned_user_ids: string[];
  /** Full roster persona ids in roster order (lp-v62i.3.9). */
  persona_ids: string[];
  /** Channel awareness excerpts — read-only sibling pool (lp-692u T2). */
  channel_context?: ChannelContext;
};

export type GroupInboundDelivery = {
  targetPersonaId: string;
  metadata: GroupInboundMetadata;
};

export type GroupDeliverStamp = {
  authorSpeaker: HistorySpeaker;
  mentionedPersonaIds: string[];
  mentionedUserIds: string[];
  decision: WakeDecision;
  deliveries: GroupInboundDelivery[];
  /** Next sticky addressee for thread storage (lp-k5c4.19). */
  nextStickyPersonaIds: string[];
  /** Whether this turn cleared sticky via @channel/@here. */
  stickyCleared: boolean;
};

/** `@token` after start, whitespace, or punctuation. Emails (`a@b`) do not match. */
const MENTION_RE = /(^|[^\w])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** Composer display names for connector enums. Not personas; no wake. */
const CONNECTOR_MARK_DISPLAY: Record<ConnectorMark, string> = {
  google: "Google Workspace",
  hubspot: "HubSpot",
  whatsapp: "WhatsApp",
  github: "GitHub",
};

function norm(value: string): string {
  return value.toLowerCase();
}

function personaParticipant(
  participant: ThreadParticipant,
): participant is Extract<ThreadParticipant, { kind: "persona" }> {
  return participant.kind === "persona";
}

function humanParticipant(
  participant: ThreadParticipant,
): participant is Extract<ThreadParticipant, { kind: "human" }> {
  return participant.kind === "human";
}

function mentionMatches(
  token: string,
  id: string,
  displayName: string | undefined,
): boolean {
  const needle = norm(token);
  if (norm(id) === needle) return true;
  if (displayName === undefined) return false;
  const name = norm(displayName);
  if (name === needle) return true;
  // Multi-word display names: "@Alice" matches "Alice Researcher" when the
  // token equals the first word or is a word-boundary prefix of the name
  // (lp-znef.2 live-QA finding; composer typeahead inserts display names).
  if (needle.length > 0 && name.split(/\s+/)[0] === needle) return true;
  return name.startsWith(`${needle} `);
}

function mentionTokens(text: string): string[] {
  const tokens: string[] = [];
  const seenToken = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const token = match[2];
    if (!token) continue;
    const key = norm(token);
    if (seenToken.has(key)) continue;
    seenToken.add(key);
    tokens.push(token);
  }
  return tokens;
}

function connectorMarkForToken(token: string): ConnectorMark | undefined {
  for (const id of CONNECTOR_MARKS) {
    if (mentionMatches(token, id, CONNECTOR_MARK_DISPLAY[id])) return id;
  }
  return undefined;
}

/** Connector @ marks only. Unknown tokens are ignored. Never a persona. */
export function parseConnectorMarks(text: string): ConnectorMark[] {
  const wanted = new Set<ConnectorMark>();
  for (const token of mentionTokens(text)) {
    const mark = connectorMarkForToken(token);
    if (mark) wanted.add(mark);
  }
  return CONNECTOR_MARKS.filter((id) => wanted.has(id));
}

const BARE_NAME_RE = /\b([A-Z][A-Za-z0-9._-]*)\b/g;

/** Capitalized tokens that uniquely match a roster display name (lp-v62i.19.3). */
function parseBareRosterNames(
  text: string,
  participants: readonly ThreadParticipant[],
): PersonaId[] {
  const wanted = new Set<string>();
  const seen = new Set<string>();
  for (const match of text.matchAll(BARE_NAME_RE)) {
    const token = match[1];
    if (!token) continue;
    const key = norm(token);
    if (seen.has(key)) continue;
    seen.add(key);
    if (connectorMarkForToken(token)) continue;
    const hits = participants.filter(
      (participant) =>
        personaParticipant(participant) &&
        mentionMatches(token, participant.persona_id, participant.display_name),
    );
    if (hits.length === 1) {
      const id = hits[0];
      if (id && personaParticipant(id)) wanted.add(id.persona_id);
    }
  }
  return participants
    .filter(personaParticipant)
    .map((participant) => participant.persona_id)
    .filter((id) => wanted.has(id))
    .map((id) => personaId(id));
}

/** Roster persona @ mentions, plus capitalized unique roster names. */
export function parsePersonaMentions(
  text: string,
  participants: readonly ThreadParticipant[],
): PersonaId[] {
  const wantedPersona = new Set<string>();
  for (const token of mentionTokens(text)) {
    if (connectorMarkForToken(token)) continue;
    for (const participant of participants) {
      if (
        personaParticipant(participant) &&
        mentionMatches(token, participant.persona_id, participant.display_name)
      ) {
        wantedPersona.add(participant.persona_id);
      }
    }
  }
  for (const id of parseBareRosterNames(text, participants)) {
    wantedPersona.add(id);
  }
  return participants
    .filter(personaParticipant)
    .map((participant) => participant.persona_id)
    .filter((id) => wantedPersona.has(id))
    .map((id) => personaId(id));
}

/** Extract @mentions that resolve to roster members or connector marks. */
export function parseRosterMentions(
  text: string,
  participants: readonly ThreadParticipant[],
): {
  mentionedPersonaIds: PersonaId[];
  mentionedUserIds: string[];
  mentionedConnectorIds: ConnectorMark[];
} {
  const wantedHuman = new Set<string>();
  for (const token of mentionTokens(text)) {
    if (connectorMarkForToken(token)) continue;
    for (const participant of participants) {
      if (
        humanParticipant(participant) &&
        mentionMatches(token, participant.user_id, participant.display_name)
      ) {
        wantedHuman.add(participant.user_id);
      }
    }
  }
  const mentionedUserIds = participants
    .filter(humanParticipant)
    .map((participant) => participant.user_id)
    .filter((id) => wantedHuman.has(id));

  return {
    mentionedPersonaIds: parsePersonaMentions(text, participants),
    mentionedUserIds,
    mentionedConnectorIds: parseConnectorMarks(text),
  };
}

function rosterFromThread(thread: ChatThread): Roster | null {
  if (thread.kind !== "group" || !thread.orchestrator_persona_id) {
    return null;
  }
  const personaIds = thread.participants
    .filter(personaParticipant)
    .map((participant) => personaId(participant.persona_id));
  if (personaIds.length === 0) return null;
  return {
    orchestratorPersonaId: personaId(thread.orchestrator_persona_id),
    personaIds,
    humanIds: thread.participants
      .filter(humanParticipant)
      .map((participant) => participant.user_id),
  };
}

function leadPersonaIdFromThread(thread: ChatThread): string | null {
  if (thread.orchestrator_persona_id) return thread.orchestrator_persona_id;
  const first = thread.participants.find(personaParticipant);
  return first ? first.persona_id : null;
}

/** T2 — channel single speaker + awareness: lead gates fan-out. */
function resolveT2TargetIds(input: {
  roster: Roster;
  leadPersonaId: string;
  mentionedPersonaIds: readonly PersonaId[];
}): string[] {
  if (input.mentionedPersonaIds.length === 0) {
    return [input.leadPersonaId];
  }
  const mentionedSet = new Set(
    input.mentionedPersonaIds.map((id) => id as string),
  );
  // Preserve roster order (stable) for deterministic wake — mentions only, lead silent
  const ordered = input.roster.personaIds
    .map((id) => id as string)
    .filter((id) => mentionedSet.has(id));
  return ordered.length > 0 ? ordered : [input.leadPersonaId];
}

/** Explicit room address (@here / @channel) wakes the whole roster (lp-v62i.26). */
export function isRoomAddressText(text: string): boolean {
  const tokens = mentionTokens(text).map(norm);
  return tokens.includes("channel") || tokens.includes("here");
}

function parseStickyPersonaIds(
  raw: string[] | null | undefined,
  participants: readonly ThreadParticipant[],
): PersonaId[] {
  if (!raw || raw.length === 0) return [];
  const valid = new Set(
    participants
      .filter(personaParticipant)
      .map((p) => p.persona_id),
  );
  const out: PersonaId[] = [];
  for (const id of raw) {
    if (valid.has(id)) {
      try {
        out.push(personaId(id));
      } catch {
        continue;
      }
    }
  }
  // Preserve roster order (stable) for deterministic wake
  const wanted = new Set(out);
  const roster = participants
    .filter(personaParticipant)
    .map((p) => personaId(p.persona_id))
    .filter((id) => wanted.has(id));
  return roster;
}

export function humanHistorySpeaker(input: {
  userId: string;
  displayName: string;
  participants: readonly ThreadParticipant[];
}): HistorySpeaker {
  const fromRoster = input.participants.find(
    (participant) =>
      participant.kind === "human" && participant.user_id === input.userId,
  );
  const display =
    (fromRoster && fromRoster.kind === "human"
      ? fromRoster.display_name
      : undefined) ?? input.displayName;
  return {
    kind: "human",
    id: input.userId,
    display_name: display.length > 0 ? display : input.userId,
  };
}

/**
 * Wake + inbound stamp for a human chat send. Null on 1:1 / non-group.
 * Human turns always reset hop state. loop_notice yields zero deliveries
 * (empty target_persona_ids is illegal on delivered inbound).
 * lp-k5c4.19: thread-scoped sticky addressee after @Drift.
 */
export function stampGroupDeliverInbound(input: {
  thread: ChatThread;
  authorUserId: string;
  authorDisplayName: string;
  text: string;
  /** Optional channel awareness pool — stamped via harnessWakeMetadata (T2). */
  channelContext?: ChannelContext | null;
}): GroupDeliverStamp | null {
  let roster = rosterFromThread(input.thread);
  // T2 fallback: orchestrator_persona_id or first participant marked lead
  if (!roster && input.thread.kind === "group") {
    const personaIds = input.thread.participants
      .filter(personaParticipant)
      .map((part) => personaId(part.persona_id));
    if (personaIds.length > 0) {
      const fallbackLead = leadPersonaIdFromThread(input.thread);
      if (fallbackLead) {
        roster = {
          orchestratorPersonaId: personaId(fallbackLead),
          personaIds,
          humanIds: input.thread.participants
            .filter(humanParticipant)
            .map((part) => part.user_id),
        };
      }
    }
  }
  if (!roster) return null;

  const { mentionedPersonaIds, mentionedUserIds } = parseRosterMentions(
    input.text,
    input.thread.participants,
  );
  const isRoomAddress = isRoomAddressText(input.text);
  const currentSticky = parseStickyPersonaIds(
    input.thread.sticky_persona_ids,
    input.thread.participants,
  );

  const decision = decideWake({
    roster,
    message: {
      author: { kind: "human", userId: input.authorUserId },
      mentionedPersonaIds,
    },
    hop: {
      hopCount: 0,
      cap: DEFAULT_HOP_CAP,
      originPersonaId: roster.orchestratorPersonaId,
      edges: [],
    },
    keywordTriggersEnabled: false,
    stickyPersonaIds: currentSticky,
    isRoomAddress,
  });

  const nextStickyIds = nextStickyPersonaIds({
    currentSticky,
    mentioned: mentionedPersonaIds,
    isRoomAddress,
  });
  // Keep thread object in sync for in-memory callers; persistence is caller-owned.
  // Mutate thread sticky so sequential stamp calls on same thread object are coherent.
  input.thread.sticky_persona_ids =
    nextStickyIds.length > 0 ? (nextStickyIds as string[]) : null;

  const authorSpeaker = humanHistorySpeaker({
    userId: input.authorUserId,
    displayName: input.authorDisplayName,
    participants: input.thread.participants,
  });
  const mentionedPersonaIdStrings = mentionedPersonaIds.map((id) => id as string);
  const nextStickyStrings = nextStickyIds.map((id) => id as string);

  if (decision.reason === "loop_notice" || decision.targetPersonaIds.length === 0) {
    return {
      authorSpeaker,
      mentionedPersonaIds: mentionedPersonaIdStrings,
      mentionedUserIds,
      decision,
      deliveries: [],
      nextStickyPersonaIds: nextStickyStrings,
      stickyCleared: isRoomAddress,
    };
  }

  const leadPersonaId =
    (roster.orchestratorPersonaId as string) ??
    leadPersonaIdFromThread(input.thread) ??
    ([...roster.personaIds][0] as string);
  const personaIds = [...roster.personaIds] as string[];
  // T2: unmentioned → lead (or sticky). Named @s → those personas.
  // @here/@channel → whole roster (lp-v62i.26), even if T2 would gate to lead.
  let effectiveTargetIds: string[];
  if (isRoomAddress) {
    effectiveTargetIds = personaIds;
  } else if (mentionedPersonaIds.length === 0) {
    if (currentSticky.length > 0) {
      effectiveTargetIds = [...decision.targetPersonaIds] as string[];
      if (effectiveTargetIds.length === 0) effectiveTargetIds = [leadPersonaId];
    } else {
      effectiveTargetIds = [leadPersonaId];
    }
  } else {
    effectiveTargetIds = resolveT2TargetIds({
      roster,
      leadPersonaId,
      mentionedPersonaIds,
    });
  }
  const targetIds = effectiveTargetIds;
  // T2 awareness: stamp channel_context via harnessWakeMetadata
  const channelWake = input.channelContext
    ? harnessWakeMetadata({ roomTail: [], channelContext: input.channelContext })
    : null;
  const channelContextForMeta = channelWake?.channel_context ?? input.channelContext ?? undefined;
  const deliveries = targetIds.map((targetPersonaId) => ({
    targetPersonaId,
    metadata: {
      target_persona_ids: targetIds,
      target_persona_id: targetPersonaId,
      lead_persona_id: leadPersonaId,
      wake_reason: decision.reason,
      mentioned_persona_ids: mentionedPersonaIdStrings,
      mentioned_user_ids: mentionedUserIds,
      persona_ids: personaIds,
      ...(channelContextForMeta ? { channel_context: channelContextForMeta } : {}),
    },
  }));

  return {
    authorSpeaker,
    mentionedPersonaIds: mentionedPersonaIdStrings,
    mentionedUserIds,
    decision,
    deliveries,
    nextStickyPersonaIds: nextStickyStrings,
    stickyCleared: isRoomAddress,
  };
}
