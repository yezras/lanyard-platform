/**
 * Pure group-room wake policy (lac-bx3 P3).
 *
 * Roster + message + hop state in, WakeDecision out. No HTTP, no store.
 * Domain types match phase-0 (camelCase). Wire snake_case is P8.
 *
 * @see contracts/group-rooms-v1/group-rooms.schema.json
 * @see lanyard-agent docs/plans/09-group-agent-rooms/phase-3-wake-policy.md
 */

export type PersonaId = string & { readonly __brand: "PersonaId" };

const PERSONA_ID_PATTERN = /^[^:\s]+$/;

/** Parse a PersonaId at the boundary. Colon and whitespace are illegal. */
export function personaId(value: string): PersonaId {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !PERSONA_ID_PATTERN.test(value)
  ) {
    throw new Error("invalid PersonaId");
  }
  return value as PersonaId;
}

export type Speaker =
  | { kind: "human"; userId: string }
  | { kind: "persona"; personaId: PersonaId };

export type WakeReason = "orchestrator" | "mention" | "keyword" | "hop";

export type WakeDecision =
  | {
      targetPersonaIds: readonly [PersonaId, ...PersonaId[]];
      reason: WakeReason;
    }
  | { targetPersonaIds: readonly []; reason: "loop_notice" };

export type Roster = {
  /**
   * Unmentioned-wake persona. Portal channels call this lead
   * (`lead_agent_id` / `lead_persona_id`); the ids are the same.
   */
  orchestratorPersonaId: PersonaId;
  personaIds: readonly PersonaId[];
  humanIds: readonly string[];
};

export type WakeMessage = {
  author: Speaker;
  mentionedPersonaIds: readonly PersonaId[];
};

export type HopEdge = {
  readonly from: PersonaId;
  readonly to: PersonaId;
};

/**
 * Hop cap lives here, not in a prompt. Callers reset this after a human turn.
 */
export type HopState = {
  readonly hopCount: number;
  readonly cap: number;
  readonly originPersonaId: PersonaId | null;
  readonly edges: readonly HopEdge[];
};

/** v1 agent-to-agent hop budget (Skip @Lev, Lev @Skip; no third hop). */
export const DEFAULT_HOP_CAP = 2;

export type WakeInput = {
  roster: Roster;
  message: WakeMessage;
  hop: HopState;
  keywordTriggersEnabled: boolean;
  keywordMatchedPersonaIds?: readonly PersonaId[];
  /** Thread-scoped sticky addressee (lp-k5c4.19). Last explicit human @ set. */
  stickyPersonaIds?: readonly PersonaId[];
  /** Explicit room address (@here/@channel) wakes the whole roster. */
  isRoomAddress?: boolean;
};

const LOOP_NOTICE: WakeDecision = {
  targetPersonaIds: [],
  reason: "loop_notice",
};

function authorPersonaId(author: Speaker): PersonaId | null {
  return author.kind === "persona" ? author.personaId : null;
}

function rosterSet(roster: Roster): Set<PersonaId> {
  return new Set(roster.personaIds);
}

/** Unique ids that appear on the roster, in roster order (stable). */
function inRosterOrder(
  roster: Roster,
  ids: readonly PersonaId[],
): PersonaId[] {
  const wanted = new Set(ids);
  return roster.personaIds.filter((id) => wanted.has(id));
}

function eligibleMentions(input: WakeInput): PersonaId[] {
  const self = authorPersonaId(input.message.author);
  const members = rosterSet(input.roster);
  const raw = input.message.mentionedPersonaIds.filter(
    (id) => members.has(id) && id !== self,
  );
  return inRosterOrder(input.roster, raw);
}

function withTargets(
  ids: readonly PersonaId[],
  reason: WakeReason,
): WakeDecision {
  const first = ids[0];
  if (first === undefined) {
    return LOOP_NOTICE;
  }
  return { targetPersonaIds: [first, ...ids.slice(1)], reason };
}

/**
 * Peer ping-pong (A@B then B@A) is a loop. Returning to the hop-chain origin
 * is synthesis (W4), not a loop.
 */
function closesPeerLoop(
  author: PersonaId,
  targets: readonly PersonaId[],
  hop: HopState,
): boolean {
  return targets.some((target) => {
    const reverse = hop.edges.some(
      (edge) => edge.from === target && edge.to === author,
    );
    return reverse && target !== hop.originPersonaId;
  });
}

function decideHuman(input: WakeInput, mentions: readonly PersonaId[]): WakeDecision {
  if (mentions.length > 0) {
    // Named @s only (lp-k5c4.15; supersedes lp-v62i.3.5 lead-plus-@s).
    // Lead is included iff they were @mentioned. Unmentioned mail still
    // falls through to orchestrator. Keep reason "mention" so the inbound
    // stamp wire does not grow a new wake_reason.
    return withTargets(mentions, "mention");
  }
  // @here / @channel: every roster persona, in roster order (lp-v62i.26).
  if (input.isRoomAddress) {
    return withTargets(input.roster.personaIds, "mention");
  }
  // Sticky addressee (lp-k5c4.19): after human @Drift, next no-@ wakes Drift.
  // Thread-scoped; first unmentioned with no sticky still wakes lead.
  if (input.stickyPersonaIds && input.stickyPersonaIds.length > 0) {
    const sticky = inRosterOrder(input.roster, input.stickyPersonaIds);
    if (sticky.length > 0) {
      return withTargets(sticky, "mention");
    }
  }
  if (input.keywordTriggersEnabled) {
    const keyed = inRosterOrder(
      input.roster,
      input.keywordMatchedPersonaIds ?? [],
    );
    if (keyed.length > 0) {
      return withTargets(keyed, "keyword");
    }
  }
  return withTargets([input.roster.orchestratorPersonaId], "orchestrator");
}

/** Next sticky set for thread storage (lp-k5c4.19). Pure. */
export function nextStickyPersonaIds(input: {
  currentSticky: readonly PersonaId[];
  mentioned: readonly PersonaId[];
  isRoomAddress: boolean;
}): readonly PersonaId[] {
  if (input.isRoomAddress) return [];
  if (input.mentioned.length > 0) return [...input.mentioned];
  return [...input.currentSticky];
}

function decidePersonaHop(
  input: WakeInput,
  author: PersonaId,
  mentions: readonly PersonaId[],
): WakeDecision {
  const remaining = input.hop.cap - input.hop.hopCount;
  if (remaining <= 0 || mentions.length === 0) {
    return LOOP_NOTICE;
  }
  if (closesPeerLoop(author, mentions, input.hop)) {
    return LOOP_NOTICE;
  }
  return withTargets(mentions.slice(0, remaining), "hop");
}

/** Who speaks next. Pure. */
export function decideWake(input: WakeInput): WakeDecision {
  const mentions = eligibleMentions(input);
  const author = input.message.author;
  if (author.kind === "human") {
    return decideHuman(input, mentions);
  }
  return decidePersonaHop(input, author.personaId, mentions);
}
