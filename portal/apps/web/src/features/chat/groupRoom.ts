import type { SearchableItem } from "@astryxdesign/core/Typeahead";

import type { ThreadParticipant } from "../../api/types.js";
import { participantDisplayName } from "../../api/groupRoom.js";

export {
  GROUP_ROOM_FIXTURE_PARTICIPANTS,
  isGroupThread,
  parseHistorySpeaker,
  parseThreadParticipant,
  parseThreadParticipants,
  participantDisplayName,
  participantKey,
  participantToSpeaker,
  speakerFromChatEvent,
  speakerKey,
} from "../../api/groupRoom.js";

/** Composer @here row — inserts `@here` and wakes the whole roster (lp-v62i.27). */
export const HERE_MENTION_ID = "here" as const;

export const HERE_SEARCH_ITEM = {
  id: HERE_MENTION_ID,
  label: "here",
  auxiliaryData: {
    mention: true,
    roomAddress: true,
    description: "All members",
  },
} as const;

/**
 * @ typeahead rows from the room roster (lp-8sh4.4).
 * Selecting a row inserts `@Display Name` (never the raw persona id) and the
 * menu row renders a dither avatar seeded by id — same convention as the
 * speaker stamps. `auxiliaryData.mention` marks roster rows so the shared
 * trigger keeps vault-context `@path` insertion untouched.
 *
 * Groups with two or more personas get `@here` first (all members).
 */
export function rosterToSearchItems(
  participants: readonly ThreadParticipant[],
): SearchableItem[] {
  const items = participants.map((participant) => ({
    id:
      participant.kind === "persona"
        ? participant.persona_id
        : participant.user_id,
    label: participantDisplayName(participant),
    auxiliaryData: { mention: true },
  }));
  const personaCount = participants.filter((p) => p.kind === "persona").length;
  if (personaCount >= 2) {
    return [{ ...HERE_SEARCH_ITEM }, ...items];
  }
  return items;
}
