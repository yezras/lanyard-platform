/**
 * Lightweight error surface when chart JSON fails parse/validation.
 * Astryx Text + bordered shell — no chart engine.
 *
 * Beads: lp-a79.4 (shell), lp-a79.6 (error/limit copy + optional raw JSON)
 */

import type { CSSProperties, ReactNode } from "react";

import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { ParseChartSpecErr } from "./parseChartSpec.js";

export type ChartSpecErrorCardProps = {
  /** Short user-safe message (from parseChartSpec.error). */
  message: string;
  /**
   * Parse failure class — drives user-facing copy.
   * json | schema | limits | empty
   */
  code?: ParseChartSpecErr["code"];
  /** Optional heading; defaults by code. */
  title?: string;
  /**
   * Optional raw fence body for debug (collapsed `<details>`).
   * Never treat as HTML — rendered as plain text only.
   */
  raw?: string;
  /** Optional test id. */
  "data-testid"?: string;
};

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 8,
  background: "var(--color-background-surface, #fff)",
  padding: "12px 14px",
};

const detailsStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "var(--color-text-secondary, #6b7280)",
};

const preStyle: CSSProperties = {
  margin: "6px 0 0",
  padding: 8,
  maxHeight: 160,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  borderRadius: 6,
  background: "var(--color-bg-muted, rgba(0,0,0,0.04))",
  border: "1px solid var(--color-border-default, rgba(0,0,0,0.06))",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.4,
};

/** Default title for each error class (no stack traces). */
export function chartErrorTitle(
  code?: ParseChartSpecErr["code"],
): string {
  switch (code) {
    case "json":
      return "Invalid chart JSON";
    case "limits":
      return "Chart too large";
    case "empty":
      return "Empty chart block";
    case "schema":
    default:
      return "Chart unavailable";
  }
}

/**
 * User-safe lead-in for each error class. Combined with `message` for detail.
 * Never includes stack traces or exception names.
 */
export function chartErrorLeadIn(
  code?: ParseChartSpecErr["code"],
): string {
  switch (code) {
    case "json":
      return "The chart JSON could not be parsed.";
    case "limits":
      return "The chart exceeds supported size limits.";
    case "empty":
      return "The chart fence was empty.";
    case "schema":
    default:
      return "The chart specification is not valid.";
  }
}

/**
 * Simple Astryx-friendly error: title + short message + optional raw JSON.
 * Used by ChatChartCodeBlock / ChatRichCodeBlock chart path.
 */
export function ChartSpecErrorCard({
  message,
  code,
  title,
  raw,
  "data-testid": testId = "chart-spec-error-card",
}: ChartSpecErrorCardProps): ReactNode {
  const resolvedTitle = title ?? chartErrorTitle(code);
  const leadIn = chartErrorLeadIn(code);
  // Avoid duplicating when parse already returns the same phrase.
  const detail =
    message && message.trim() && message.trim() !== leadIn
      ? `${leadIn} ${message.trim()}`
      : leadIn;
  const showRaw = typeof raw === "string" && raw.trim().length > 0;

  return (
    <div
      style={shellStyle}
      data-testid={testId}
      data-error-code={code ?? "schema"}
      role="alert"
    >
      <VStack gap={1}>
        <Text type="heading" size="sm" data-testid={`${testId}-title`}>
          {resolvedTitle}
        </Text>
        <Text
          type="body"
          color="secondary"
          size="sm"
          data-testid={`${testId}-message`}
        >
          {detail}
        </Text>
        {showRaw ? (
          <details style={detailsStyle} data-testid={`${testId}-raw-details`}>
            <summary data-testid={`${testId}-raw-summary`}>
              Show raw JSON
            </summary>
            <pre style={preStyle} data-testid={`${testId}-raw`}>
              {raw}
            </pre>
          </details>
        ) : null}
      </VStack>
    </div>
  );
}
