/**
 * Auth-free story: multi-speaker group room (lac-bx3.16 U1–U4).
 * Mounted with `?story=group-rooms`.
 *
 * Fixture timeline: Alice + Skip/Lev/Bana speakers. Skip's private subagent
 * is nested under Skip, not a fourth peer. Composer @ completes the roster.
 */

import { useState, type CSSProperties } from "react";

import {
  ChatComposer,
  ChatComposerInput,
} from "@astryxdesign/core/Chat";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { GROUP_ROOM_FIXTURE_PARTICIPANTS } from "../../api/groupRoom.js";
import type { ChatThreadSummary } from "../../api/types.js";
import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

import { AgentChatHeader } from "./AgentChatHeader.js";
import { buildComposerTriggers } from "./chatComposerTriggers.js";
import { ChatTimeline } from "./ChatTimeline.js";
import { rosterToSearchItems } from "./groupRoom.js";
import "./chat.css";

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  boxSizing: "border-box",
  padding: "16px 20px 24px",
  background: "var(--color-background-body, #fafafa)",
};

const composerWrapStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  marginTop: 8,
};

const fixtureThread: ChatThreadSummary = {
  thread_id: "room-skip-lev-bana",
  title: "Review room",
  project_id: null,
  project_vault_path: null,
  created_at: "2026-08-23T00:00:00.000Z",
  avatar_seed: "seed-review-room",
  title_source: "user",
  kind: "group",
  participants: GROUP_ROOM_FIXTURE_PARTICIPANTS,
  orchestrator_persona_id: "skip",
};

const fixtureItems: ChatTimelineItem[] = [
  {
    type: "user",
    id: "user-1",
    content: "Please review the auth change.",
    status: "sent",
    createdAt: "2026-08-23T10:00:00.000Z",
    speaker: { kind: "human", id: "usr_alice", display_name: "Alice" },
  },
  {
    type: "assistant_turn",
    id: "skip-1",
    content: "I'll take the first pass.",
    createdAt: "2026-08-23T10:01:00.000Z",
    speaker: { kind: "persona", id: "skip", display_name: "Skip" },
    toolCalls: [
      {
        key: "sa-qa-helper",
        name: "qa-helper",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
      },
    ],
    segments: [
      {
        kind: "tool",
        call: {
          key: "sa-qa-helper",
          name: "qa-helper",
          status: "complete",
          kind: "subagent",
          subagentStatus: "done",
        },
      },
    ],
  },
  {
    type: "assistant_turn",
    id: "skip-2",
    content: "Second pass complete.",
    toolCalls: [],
    createdAt: "2026-08-23T10:01:30.000Z",
    speaker: { kind: "persona", id: "skip", display_name: "Skip" },
  },
  {
    type: "assistant_turn",
    id: "lev-1",
    content: "Security notes attached.",
    toolCalls: [],
    createdAt: "2026-08-23T10:02:00.000Z",
    speaker: { kind: "persona", id: "lev", display_name: "Lev" },
  },
  {
    // lp-cxhb.15.4: agent replies render markdown in channels.
    type: "assistant_turn",
    id: "lev-2",
    content: "Agreed — ship it. **LGTM** on `auth.ts`.",
    toolCalls: [],
    createdAt: "2026-08-23T10:02:30.000Z",
    speaker: { kind: "persona", id: "lev", display_name: "Lev" },
  },
  {
    type: "assistant_turn",
    id: "bana-1",
    content: "Architecture looks sound.",
    toolCalls: [],
    createdAt: "2026-08-23T10:03:00.000Z",
    speaker: { kind: "persona", id: "bana", display_name: "Bana" },
  },
];
export function GroupRoomsProofStory() {
  const [value, setValue] = useState("");
  const triggers = buildComposerTriggers({
    roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
  });

  return (
    <div style={rootStyle} data-testid="group-rooms-proof-story">
      <VStack gap={3} style={{ maxWidth: 720 }}>
        <Heading level={1}>Group room</Heading>
        <Text color="secondary">
          Three named speakers. Subagent chips stay under Skip. Type @ to
          complete the roster.
        </Text>
        <AgentChatHeader thread={fixtureThread} canRename={false} />
        <ChatTimeline
          items={fixtureItems}
          toolProgress={null}
          threadKind={fixtureThread.kind}
          onMcqSelect={() => undefined}
        />
        <div style={composerWrapStyle} data-testid="group-rooms-composer">
          <ChatComposer
            value={value}
            onChange={setValue}
            onSubmit={() => undefined}
            placeholder="Message the room…"
            density="spacious"
            input={<ChatComposerInput triggers={triggers} />}
          />
        </div>
        <div
          data-testid="group-rooms-composer-value"
          data-value={value}
          hidden
        />
      </VStack>
    </div>
  );
}
