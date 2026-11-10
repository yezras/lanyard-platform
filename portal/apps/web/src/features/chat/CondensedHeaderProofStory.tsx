/**
 * Auth-free story: condensed header with stacked sources + dither avatars (lp-n6e).
 * Mounted with `?story=condensed-header`.
 * Verifies 7 sources limited to 4 visible with +3 overflow and cascading overlap,
 * 7 distinct pulsing avatars, and that raw web_search tool rows are hidden while
 * header is on top during streaming.
 */
import { useState } from "react";

import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";
import { ChatTimeline } from "./ChatTimeline.js";
import "./chat.css";

function makeWebSearchCall(idx: number, url: string, title: string) {
  const result = JSON.stringify([
    { url, title, snippet: `${title} description snippet for ${url}`, provider: "tavily" },
  ]);
  return {
    key: `web-${idx}`,
    name: "web_search",
    technicalName: "web_search",
    status: "complete" as const,
    result,
    metadata: {},
  };
}

const fixtureSources = [
  ["https://en.wikipedia.org/wiki/AI", "Wikipedia AI"],
  ["https://www.google.com/search?q=ai", "Google AI"],
  ["https://www.figma.com/file/ai", "Figma AI"],
  ["https://github.com/example/ai", "GitHub AI"],
  ["https://arxiv.org/abs/2401.00001", "ArXiv AI"],
  ["https://www.wikipedia.org/wiki/Cloud", "Wikipedia Cloud"],
  ["https://ibelick.com/ai", "Ibelick AI"],
] as const;

const subagentFixtures = [
  { key: "sa-1", name: "Explore", color: "#3B82F6", icon: "explore" as const },
  { key: "sa-2", name: "Research", color: "#10B981", icon: "research" as const },
  { key: "sa-3", name: "Code", color: "#F59E0B", icon: "code" as const },
  { key: "sa-4", name: "Write", color: "#EF4444", icon: "write" as const },
  { key: "sa-5", name: "Test", color: "#8B5CF6", icon: "test" as const },
  { key: "sa-6", name: "Plan", color: "#06B6D4", icon: "plan" as const },
  { key: "sa-7", name: "Browser", color: "#EC4899", icon: "browser" as const },
];

export function CondensedHeaderProofStory() {
  const [selected, setSelected] = useState<string | null>(null);

  const items: ChatTimelineItem[] = [
    {
      type: "user",
      id: "user-1",
      content: "Research the current state of AI clouds with 7 sub-agents",
      status: "sent",
    },
    {
      type: "assistant_turn",
      id: "condensed-demo",
      content: "",
      isStreaming: true,
      toolCalls: [
        ...fixtureSources.map(([url, title], i) => makeWebSearchCall(i, url, title)),
        ...subagentFixtures.map((s) => ({
          key: s.key,
          name: s.name,
          target: `Task ${s.name}`,
          status: "running" as const,
          kind: "subagent" as const,
          subagentStatus: "running" as const,
          subagentColor: s.color,
          subagentIcon: s.icon,
        })),
      ],
      segments: [
        ...fixtureSources.map(([url, title], i) => ({
          kind: "tool" as const,
          call: makeWebSearchCall(i, url, title),
        })),
        ...subagentFixtures.map((s) => ({
          kind: "tool" as const,
          call: {
            key: s.key,
            name: s.name,
            target: `Task ${s.name}`,
            status: "running" as const,
            kind: "subagent" as const,
            subagentStatus: "running" as const,
            subagentColor: s.color,
            subagentIcon: s.icon,
          },
        })),
      ],
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <VStack gap={3}>
        <Text type="heading">Condensed Header Demo — 7 sources / 7 agents</Text>
        <Text type="supporting" color="secondary">
          Header is on top of tool calls while streaming. Sources limited to 4 visible with +3 overflow and cascading overlap. Avatars have distinct hues and pulse. Click an avatar to open sidebar. Raw web_search rows are hidden behind header.
        </Text>
        {selected ? (
          <Text type="body" data-testid="condensed-header-selected">
            Selected agent: {selected}
          </Text>
        ) : null}
        <ChatTimeline
          items={items}
          onMcqSelect={() => {}}
          onSubagentSelect={(run) => setSelected(run.id)}
        />
        <div data-testid="condensed-header-assertions" style={{ display: "none" }}>
          {fixtureSources.length} sources, {subagentFixtures.length} agents
        </div>
      </VStack>
    </div>
  );
}
