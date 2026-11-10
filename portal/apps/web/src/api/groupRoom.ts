import type {
  ChatThreadSummary,
  HistorySpeaker,
  ThreadParticipant,
} from "./types.js";

const ID_NO_COLON = /^[^:\s]+$/;

function isIdNoColon(value: string): boolean {
  return value.length > 0 && value.length <= 128 && ID_NO_COLON.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Parse group-rooms-v1 historySpeaker at the UI boundary. */
export function parseHistorySpeaker(raw: unknown): HistorySpeaker | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  if (obj.kind !== "human" && obj.kind !== "persona") return undefined;
  if (typeof obj.id !== "string" || !isIdNoColon(obj.id.trim())) {
    return undefined;
  }
  if (typeof obj.display_name !== "string" || !obj.display_name.trim()) {
    return undefined;
  }
  return {
    kind: obj.kind,
    id: obj.id.trim(),
    display_name: obj.display_name.trim(),
  };
}

/** Parse one roster member (group-rooms-v1 Speaker). */
export function parseThreadParticipant(
  raw: unknown,
): ThreadParticipant | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const display =
    typeof obj.display_name === "string" && obj.display_name.trim()
      ? obj.display_name.trim()
      : undefined;
  if (obj.kind === "human") {
    if (typeof obj.user_id !== "string" || !isIdNoColon(obj.user_id.trim())) {
      return undefined;
    }
    return display
      ? { kind: "human", user_id: obj.user_id.trim(), display_name: display }
      : { kind: "human", user_id: obj.user_id.trim() };
  }
  if (obj.kind === "persona") {
    if (
      typeof obj.persona_id !== "string" ||
      !isIdNoColon(obj.persona_id.trim())
    ) {
      return undefined;
    }
    return display
      ? {
          kind: "persona",
          persona_id: obj.persona_id.trim(),
          display_name: display,
        }
      : { kind: "persona", persona_id: obj.persona_id.trim() };
  }
  return undefined;
}

/** Drop illegal roster rows at the boundary; keep order. */
export function parseThreadParticipants(
  raw: unknown,
): ThreadParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadParticipant[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const parsed = parseThreadParticipant(row);
    if (!parsed) continue;
    const key = participantKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

export function speakerKey(speaker: HistorySpeaker): string {
  return `${speaker.kind}:${speaker.id}`;
}

export function participantKey(participant: ThreadParticipant): string {
  return participant.kind === "human"
    ? `human:${participant.user_id}`
    : `persona:${participant.persona_id}`;
}

export function participantDisplayName(
  participant: ThreadParticipant,
): string {
  if (participant.display_name?.trim()) {
    return participant.display_name.trim();
  }
  return participant.kind === "human"
    ? participant.user_id
    : participant.persona_id;
}

export function participantToSpeaker(
  participant: ThreadParticipant,
): HistorySpeaker {
  return participant.kind === "human"
    ? {
        kind: "human",
        id: participant.user_id,
        display_name: participantDisplayName(participant),
      }
    : {
        kind: "persona",
        id: participant.persona_id,
        display_name: participantDisplayName(participant),
      };
}

/** Speaker stamp from a history/SSE event (top-level or metadata). */
export function speakerFromChatEvent(event: {
  speaker?: unknown;
  metadata?: Record<string, unknown>;
}): HistorySpeaker | undefined {
  const fromTop = parseHistorySpeaker(event.speaker);
  if (fromTop) return fromTop;
  const meta = event.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  return parseHistorySpeaker(meta.speaker);
}

export function isGroupThread(
  thread: Pick<ChatThreadSummary, "kind"> | null | undefined,
): boolean {
  return thread?.kind === "group";
}

/** Meadow-core U1 roster: Skip, Lev, Bana, and the human owner. */
export const GROUP_ROOM_FIXTURE_PARTICIPANTS: ThreadParticipant[] = [
  { kind: "human", user_id: "usr_alice", display_name: "Alice" },
  { kind: "persona", persona_id: "skip", display_name: "Skip" },
  { kind: "persona", persona_id: "lev", display_name: "Lev" },
  { kind: "persona", persona_id: "bana", display_name: "Bana" },
];
