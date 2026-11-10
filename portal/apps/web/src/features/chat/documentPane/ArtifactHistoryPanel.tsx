/**
 * Signed-operation history panel for the document pane (lp-ye4.11).
 * Reads BFF history API results; displays metadata only (no body bytes).
 */

import type { CSSProperties } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  formatHistoryEventSummary,
  type HistoryEventView,
} from "./currentness.js";

export type ArtifactHistoryPanelProps = {
  path: string;
  events: HistoryEventView[];
  isLoading: boolean;
  error: string | null;
  unavailable: boolean;
  truncated?: boolean;
};

const panelStyle: CSSProperties = {
  padding: "var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem)",
  borderBottom: "1px solid var(--border-primary, rgba(0,0,0,0.08))",
  maxHeight: 220,
  overflowY: "auto",
  flexShrink: 0,
};

const rowStyle: CSSProperties = {
  padding: "6px 0",
  borderBottom: "1px solid var(--border-secondary, rgba(0,0,0,0.04))",
};

export function ArtifactHistoryPanel({
  path,
  events,
  isLoading,
  error,
  unavailable,
  truncated,
}: ArtifactHistoryPanelProps) {
  return (
    <div
      className="chat-document-pane-history"
      data-testid="chat-document-pane-history"
      data-path={path}
      style={panelStyle}
      role="region"
      aria-label="Document history"
    >
      <Text type="label" weight="semibold">
        Operation history
      </Text>
      <Text type="supporting" color="secondary">
        Signed operations for this path (metadata only — not file contents).
      </Text>

      {isLoading ? (
        <div
          data-testid="chat-document-pane-history-loading"
          style={{ marginTop: 8 }}
        >
          <Spinner size="sm" aria-label="Loading history" />
        </div>
      ) : null}

      {unavailable ? (
        <div style={{ marginTop: 8 }} data-testid="chat-document-pane-history-unavailable">
          <Banner
            status="info"
            title="History unavailable"
            description={
              error ??
              "This backend does not advertise history.list yet."
            }
          />
        </div>
      ) : null}

      {!unavailable && error ? (
        <div style={{ marginTop: 8 }} data-testid="chat-document-pane-history-error">
          <Banner status="warning" title="History error" description={error} />
        </div>
      ) : null}

      {!isLoading && !unavailable && !error && events.length === 0 ? (
        <Text type="supporting" color="secondary" style={{ marginTop: 8 }}>
          No history events for this path.
        </Text>
      ) : null}

      {!isLoading && events.length > 0 ? (
        <VStack gap={0} style={{ marginTop: 8 }}>
          {events.map((ev) => (
            <div
              key={ev.operation_id}
              data-testid="chat-document-pane-history-row"
              data-operation-id={ev.operation_id}
              data-kind={ev.kind}
              style={rowStyle}
            >
              <Text type="supporting" maxLines={2}>
                {formatHistoryEventSummary(ev)}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {ev.operation_id}
                {ev.occurred_at ? ` · ${ev.occurred_at}` : ""}
                {ev.result?.revision?.token
                  ? ` · rev ${ev.result.revision.token.slice(0, 16)}…`
                  : ""}
              </Text>
            </div>
          ))}
          {truncated ? (
            <Text type="supporting" color="secondary">
              More events available (truncated).
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </div>
  );
}
