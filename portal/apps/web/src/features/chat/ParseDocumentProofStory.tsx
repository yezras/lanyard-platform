/**
 * Auth-free story: attach → parse_document → answer (lp-uxy.10.7 F6).
 *
 * Mounted with `?story=parse-document`.
 *
 * Covers:
 * 1. User attach paths stamped as [staging uploads] (document message shape)
 * 2. tool_progress rows labeled **Parsing a document** (F4 map + host tool_label)
 * 3. Dual-emit lifecycle: running → complete for sample.docx + text PDF
 * 4. Final answer cites markers from parsed Markdown (model-usable text)
 * 5. Negative rows: path_denied (outside tree) + unsupported_scanned (no OCR key)
 *
 * Fixture-only — no BFF parse, no live FIRECRAWL_API_KEY / paid OCR.
 */

import { useMemo, type CSSProperties } from "react";

import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { ChatTimelineCitation } from "../../hooks/useChatEvents.js";

import "./chat.css";
import {
  humanToolActivityLabel,
  isContextGatheringTool,
  mapToolCallFields,
  resolveToolActivityDisplay,
} from "./chatToolCallMapper.js";
import { ChatMessageContent } from "./ChatMessageContent.js";

/** Unique markers — host F6 prove harness uses the same strings. */
export const DOCX_MARKER = "LANYARD_F6_DOCX_Q3_REVENUE_MARKER";
export const PDF_MARKER = "LANYARD_F6_PDF_POLICY_MARKER";

export const STAGING_DOCX =
  "/staging/uploads/_inbox/sample.docx" as const;
export const STAGING_PDF = "/staging/uploads/_inbox/sample.pdf" as const;

export const USER_ATTACH_MESSAGE = [
  "Please summarize the attached report and policy PDF.",
  "",
  "[staging uploads]",
  `- ${STAGING_DOCX}`,
  `- ${STAGING_PDF}`,
].join("\n");

export const SEEDED_ASSISTANT_CONTENT = [
  "**Seeded assistant reply** (lp-uxy.10 F6 attach → parse → answer).",
  "",
  `I parsed the Word report and found the Q3 marker **${DOCX_MARKER}**`,
  `(revenue up 12%). The policy PDF contains **${PDF_MARKER}**.`,
  "",
  "Tool rows above used host `parse_document` (local AnyDoc, $0 SaaS).",
  "No BFF-side parse of customer files; scanned OCR stays cost-gated (F5).",
].join("\n");

export const SEEDED_CITATIONS: ChatTimelineCitation[] = [
  {
    path: STAGING_DOCX,
    title: "sample.docx",
    snippet: `Q3 report body ${DOCX_MARKER}`,
  },
  {
    path: STAGING_PDF,
    title: "sample.pdf",
    snippet: `Policy note ${PDF_MARKER}`,
  },
];

/** Fixture tool_progress events as Portal would receive them from the host. */
export const FIXTURE_PARSE_EVENTS = [
  {
    type: "tool_progress" as const,
    tool_name: "parse_document",
    tool_label: "Parsing a document",
    tool_target: STAGING_DOCX,
    tool_status: "running" as const,
    tool_call_id: "f6-docx",
  },
  {
    type: "tool_progress" as const,
    tool_name: "parse_document",
    tool_label: "Parsing a document",
    tool_target: STAGING_DOCX,
    tool_status: "complete" as const,
    tool_call_id: "f6-docx",
    result: JSON.stringify({
      markdown: `# Report\n\nQ3 report body ${DOCX_MARKER} revenue up 12%\n`,
      format: "docx",
      parser: "anydoc",
      chars: 64,
      truncated: false,
      sidecar_path: "/staging/uploads/_inbox/sample.parse.md",
    }),
  },
  {
    type: "tool_progress" as const,
    tool_name: "extract_document_text",
    tool_label: "Parsing a document",
    tool_target: STAGING_PDF,
    tool_status: "complete" as const,
    tool_call_id: "f6-pdf",
    result: JSON.stringify({
      markdown: `Policy note ${PDF_MARKER}\n`,
      format: "pdf",
      parser: "anydoc",
      chars: 40,
      truncated: false,
    }),
  },
  {
    type: "tool_progress" as const,
    tool_name: "parse_document",
    tool_label: "Parsing a document",
    tool_target: "/etc/passwd",
    tool_status: "error" as const,
    tool_call_id: "f6-deny",
    result: JSON.stringify({
      markdown: "",
      format: "unknown",
      chars: 0,
      truncated: false,
      error_code: "path_denied",
      error_message: "path outside vault/staging ACL",
    }),
  },
  {
    type: "tool_progress" as const,
    tool_name: "parse_document",
    tool_label: "Parsing a document",
    tool_target: "/staging/uploads/_inbox/scanned.pdf",
    tool_status: "error" as const,
    tool_call_id: "f6-scan",
    result: JSON.stringify({
      markdown: "",
      format: "pdf",
      chars: 0,
      truncated: false,
      error_code: "unsupported_scanned",
      error_message: "image-only PDF; OCR not enabled (no FIRECRAWL_API_KEY)",
    }),
  },
] as const;

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "auto",
  background: "var(--color-background-body, #fafafa)",
  padding: "var(--spacing-6, 1.5rem)",
  boxSizing: "border-box",
  gap: "var(--spacing-4, 1rem)",
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 12,
  background: "var(--color-background-surface, #fff)",
  padding: "12px 16px",
  boxSizing: "border-box",
  maxWidth: 720,
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-secondary, #64748b)",
  marginBottom: 8,
};

const userBubbleStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  lineHeight: 1.45,
  margin: 0,
};

export function ParseDocumentProofStory() {
  const displayLabel = humanToolActivityLabel("parse_document");
  const aliasLabel = humanToolActivityLabel("extract_document_text");
  const hostPreferred = humanToolActivityLabel("parse_document", {
    hostLabel: "Parsing a document",
  });
  const contextGathering = isContextGatheringTool({
    name: displayLabel,
    target: STAGING_DOCX,
  });

  const toolCalls = useMemo(() => {
    // Prefer complete/error terminal rows for display (history retains row).
    const terminal = FIXTURE_PARSE_EVENTS.filter(
      (e) => e.tool_status === "complete" || e.tool_status === "error",
    );
    const running = FIXTURE_PARSE_EVENTS.find(
      (e) => e.tool_status === "running",
    );

    const mapped = terminal.map((ev, i) => {
      const fields = mapToolCallFields(ev as never);
      const display = resolveToolActivityDisplay({
        toolName: ev.tool_name,
        toolLabel: ev.tool_label,
      });
      let resultPreview = "";
      try {
        const parsed = JSON.parse(String(ev.result ?? "{}")) as {
          markdown?: string;
          error_code?: string;
          error_message?: string;
          parser?: string;
          format?: string;
        };
        if (parsed.error_code) {
          resultPreview = `${parsed.error_code}: ${parsed.error_message ?? ""}`;
        } else {
          resultPreview = (parsed.markdown ?? "").trim().slice(0, 160);
        }
      } catch {
        resultPreview = String(ev.result ?? "");
      }
      return {
        key: ev.tool_call_id ?? `parse-${i}`,
        name: display.name,
        status: fields.status ?? ev.tool_status,
        target: fields.target ?? ev.tool_target,
        duration: ev.tool_status === "complete" ? "12ms" : undefined,
        resultDetail: (
          <div data-testid={`parse-document-result-${ev.tool_call_id}`}>
            <Text type="supporting" color="secondary">
              {display.technicalName ?? ev.tool_name}
              {ev.tool_status === "error" ? " · error" : ""}
            </Text>
            <pre
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {resultPreview}
            </pre>
          </div>
        ),
      };
    });

    // Mid-turn running row (proves dual-emit running chrome).
    if (running) {
      const fields = mapToolCallFields(running as never);
      const display = resolveToolActivityDisplay({
        toolName: running.tool_name,
        toolLabel: running.tool_label,
      });
      mapped.unshift({
        key: "f6-docx-running",
        name: display.name,
        status: fields.status ?? "running",
        target: fields.target ?? running.tool_target,
        duration: undefined,
        resultDetail: (
          <div data-testid="parse-document-result-running">
            <Text type="supporting" color="secondary">
              {running.tool_name} · running
            </Text>
          </div>
        ),
      });
    }

    return mapped;
  }, []);

  return (
    <div
      style={rootStyle}
      data-testid="parse-document-proof-story"
      data-parse-document-live="false"
      data-cost-gated="true"
      data-bff-parse="false"
      data-friendly-label={displayLabel}
      data-alias-label={aliasLabel}
      data-host-label={hostPreferred}
      data-context-gathering={contextGathering ? "true" : "false"}
    >
      <VStack gap={2} style={{ maxWidth: 720 }}>
        <Heading level={1}>lp-uxy.10 — parse_document F6 proof</Heading>
        <Text type="supporting" color="secondary">
          Attach → host <code>parse_document</code> (local AnyDoc) → answer cites
          extracted Markdown. Portal labels only —{" "}
          <strong>no BFF parse</strong>. OCR stays cost-gated (no live{" "}
          <code>FIRECRAWL_API_KEY</code>).
        </Text>
      </VStack>

      <section style={panelStyle} data-testid="parse-document-attach-panel">
        <div style={metaStyle}>
          User message · staging attach paths (message_type=document stamp)
        </div>
        <pre style={userBubbleStyle} data-testid="parse-document-user-attach">
          {USER_ATTACH_MESSAGE}
        </pre>
      </section>

      <section style={panelStyle} data-testid="parse-document-tool-panel">
        <div style={metaStyle}>
          Tool rows · parse_document / extract_document_text → &quot;{displayLabel}
          &quot; (running → complete/error)
        </div>
        <ChatToolCalls calls={toolCalls} />
      </section>

      <section style={panelStyle} data-testid="parse-document-answer-panel">
        <div style={metaStyle}>
          Final answer · cites markers from parsed docx + text PDF
        </div>
        <ChatMessageContent
          content={SEEDED_ASSISTANT_CONTENT}
          citations={SEEDED_CITATIONS}
        />
      </section>

      <section style={panelStyle} data-testid="parse-document-negatives-meta">
        <div style={metaStyle}>Negatives (also shown as error tool rows)</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          <li data-testid="parse-document-neg-path">
            path outside vault/staging → <code>path_denied</code>
          </li>
          <li data-testid="parse-document-neg-scanned">
            scanned PDF without OCR key → <code>unsupported_scanned</code>
          </li>
        </ul>
      </section>
    </div>
  );
}
