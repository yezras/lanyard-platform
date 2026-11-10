import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";

import type { HistorySpeaker, ThreadParticipant } from "../../api/types.js";

import {
  participantDisplayName,
  participantKey,
  participantToSpeaker,
} from "../../api/groupRoom.js";

import { DitherAvatar } from "./DitherAvatar.js";

export function ChatSpeakerLabel({
  speaker,
}: {
  speaker: HistorySpeaker;
}) {
  return (
    <HStack
      gap={1}
      align="center"
      className="chat-speaker-label"
      data-testid={`chat-speaker-${speaker.kind}-${speaker.id}`}
      data-speaker-kind={speaker.kind}
      data-speaker-id={speaker.id}
    >
      <DitherAvatar
        seed={speaker.id}
        size="sm"
        label={speaker.display_name}
        data-testid={`chat-speaker-avatar-${speaker.kind}-${speaker.id}`}
      />
      <Text type="label" weight="semibold" maxLines={1}>
        {speaker.display_name}
      </Text>
    </HStack>
  );
}

export function GroupRoomRoster({
  participants,
}: {
  participants: readonly ThreadParticipant[];
}) {
  if (participants.length === 0) return null;
  return (
    <div
      className="group-room-roster"
      data-testid="group-room-roster"
      aria-label="Room roster"
    >
      {participants.map((participant) => {
        const speaker = participantToSpeaker(participant);
        const key = participantKey(participant);
        return (
          <HStack
            key={key}
            gap={1}
            align="center"
            className="group-room-roster-member"
            data-testid={`group-room-roster-member-${speaker.kind}-${speaker.id}`}
            data-participant-kind={speaker.kind}
            data-participant-id={speaker.id}
          >
            <DitherAvatar
              seed={speaker.id}
              size="sm"
              label={speaker.display_name}
            />
            <Text type="supporting" maxLines={1}>
              {participantDisplayName(participant)}
            </Text>
          </HStack>
        );
      })}
    </div>
  );
}
