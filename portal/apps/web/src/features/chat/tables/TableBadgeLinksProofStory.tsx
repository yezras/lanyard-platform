/**
 * Auth-free story for table E2E/UI evidence (lp-a79.13).
 *
 * Mounted with `?story=table-badge-links`.
 * Renders an assistant chat bubble whose markdown includes a ```table fence
 * (findings fixture: categorical High badge + vault doc + external ticket).
 * No live agent / BFF required.
 */

import { useCallback, useState, type CSSProperties } from "react";

import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { ChatMessageContent } from "../ChatMessageContent.js";

import {
  FINDINGS_EXTERNAL_HREF,
  FINDINGS_EXTERNAL_LABEL,
  FINDINGS_PROJECT_VAULT_PATH,
  FINDINGS_TABLE_MARKDOWN,
  FINDINGS_VAULT_HREF,
  FINDINGS_VAULT_RESOLVED_PATH,
} from "./findingsTableFixture.js";

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

const vaultLogStyle: CSSProperties = {
  border: "1px dashed var(--color-border, #cbd5e1)",
  borderRadius: 8,
  padding: "8px 12px",
  background: "var(--color-background-surface, #fff)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  wordBreak: "break-all",
};

/**
 * Offline proof harness: Astryx table in chat via ```table fence.
 * Vault clicks are logged (document-pane open is optional / harness-only).
 */
export function TableBadgeLinksProofStory() {
  const [lastVaultPath, setLastVaultPath] = useState<string | null>(null);
  const [vaultClickCount, setVaultClickCount] = useState(0);

  const onCitationClick = useCallback((path: string) => {
    setLastVaultPath(path);
    setVaultClickCount((n) => n + 1);
  }, []);

  return (
    <div style={rootStyle} data-testid="table-badge-links-proof-story">
      <VStack gap={4}>
        <Heading level={1}>Table badge + links proof (lp-a79.13)</Heading>
        <Text color="secondary">
          Offline findings fixture rendered through{" "}
          <code>ChatMessageContent</code> + <code>```table</code> fence →{" "}
          <code>PortalTableCard</code> (Astryx Table). Categorical severity
          badges, vault doc link, and external ticket.
        </Text>

        <div
          style={chatColumnStyle}
          data-testid="table-badge-links-chat-column"
          role="log"
          aria-label="Chat timeline fixture"
        >
          <div
            style={bubbleStyle}
            data-testid="table-badge-links-assistant-bubble"
            data-role="assistant"
          >
            <div style={metaStyle}>Assistant · findings table</div>
            <ChatMessageContent
              content={FINDINGS_TABLE_MARKDOWN}
              projectVaultPath={FINDINGS_PROJECT_VAULT_PATH}
              onCitationClick={onCitationClick}
            />
          </div>
        </div>

        <div
          style={vaultLogStyle}
          data-testid="table-badge-links-vault-log"
          data-vault-href={FINDINGS_VAULT_HREF}
          data-vault-resolved={FINDINGS_VAULT_RESOLVED_PATH}
          data-project-vault-path={FINDINGS_PROJECT_VAULT_PATH}
          data-external-href={FINDINGS_EXTERNAL_HREF}
          data-external-label={FINDINGS_EXTERNAL_LABEL}
          data-vault-click-count={String(vaultClickCount)}
        >
          <div>
            <strong>Vault link path (documented)</strong>
          </div>
          <div>
            href: <code data-testid="table-badge-links-vault-href">{FINDINGS_VAULT_HREF}</code>
          </div>
          <div>
            projectVaultPath:{" "}
            <code data-testid="table-badge-links-project-path">
              {FINDINGS_PROJECT_VAULT_PATH}
            </code>
          </div>
          <div>
            resolved (onVaultPath / onCitationClick):{" "}
            <code data-testid="table-badge-links-vault-resolved">
              {FINDINGS_VAULT_RESOLVED_PATH}
            </code>
          </div>
          <div>
            last click:{" "}
            <code data-testid="table-badge-links-last-vault-click">
              {lastVaultPath ?? "(none yet — click runbook.md)"}
            </code>
          </div>
          <div>
            external:{" "}
            <code data-testid="table-badge-links-external-doc">
              {FINDINGS_EXTERNAL_LABEL} → {FINDINGS_EXTERNAL_HREF}
            </code>
          </div>
        </div>
      </VStack>
    </div>
  );
}
