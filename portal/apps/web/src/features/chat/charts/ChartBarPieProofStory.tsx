/**
 * Auth-free story for chart E2E/UI evidence in the chat timeline path (lp-a79.9).
 *
 * Mounted with `?story=chart-bar-pie`.
 * Renders an assistant chat bubble whose markdown includes bar + pie ```chart
 * fences plus one invalid fence (error card, no crash).
 * No live agent / BFF required.
 */

import type { CSSProperties } from "react";

import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { ChatMessageContent } from "../ChatMessageContent.js";

import { BAR_PIE_CHART_MARKDOWN } from "./barPieChartFixture.js";

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  boxSizing: "border-box",
  padding: "24px",
  background: "var(--color-background-body, #fafafa)",
};

const chatColumnStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const bubbleStyle: CSSProperties = {
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 12,
  background: "var(--color-background-surface, #fff)",
  padding: "12px 16px",
  boxSizing: "border-box",
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-secondary, #64748b)",
  marginBottom: 8,
};

/**
 * Offline proof harness: bar + pie charts in chat via ```chart fences.
 * Invalid fence must show ChartSpecErrorCard (role=alert), not crash the tree.
 */
export function ChartBarPieProofStory() {
  return (
    <div style={rootStyle} data-testid="chart-bar-pie-proof-story">
      <VStack gap={4}>
        <Heading level={1}>Chart bar + pie proof (lp-a79.9)</Heading>
        <Text color="secondary">
          Offline fixture rendered through <code>ChatMessageContent</code> +{" "}
          <code>```chart</code> fences → <code>PortalChartCard</code> (bar + pie)
          and <code>ChartSpecErrorCard</code> for invalid JSON. Chat timeline path
          without a live agent.
        </Text>

        <div
          style={chatColumnStyle}
          data-testid="chart-bar-pie-chat-column"
          role="log"
          aria-label="Chat timeline fixture"
        >
          <div
            style={bubbleStyle}
            data-testid="chart-bar-pie-assistant-bubble"
            data-role="assistant"
          >
            <div style={metaStyle}>Assistant · bar + pie charts</div>
            <ChatMessageContent content={BAR_PIE_CHART_MARKDOWN} />
          </div>
        </div>
      </VStack>
    </div>
  );
}
