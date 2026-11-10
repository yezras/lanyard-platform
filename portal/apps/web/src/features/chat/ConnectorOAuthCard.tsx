import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { CheckCircleIcon } from "@heroicons/react/24/outline";

import { startConnectorOAuth } from "../../api/connectors.js";
import { openConnectorOAuthTab } from "./connectorChatWizard.js";
import { CONNECTOR_LABELS, type ConnectorId } from "../settings/connectorsCatalog.js";

function letterFor(connectorId: string): string {
  const id = connectorId.toLowerCase();
  if (id === "google") return "G";
  if (id === "hubspot") return "H";
  if (id === "github") return "G";
  if (id === "whatsapp") return "W";
  return id.charAt(0).toUpperCase();
}

const letterMarkStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 600,
  background: "var(--color-surface-2, #eee)",
  color: "var(--color-text-primary, #111)",
  flexShrink: 0,
};

export type ConnectorOAuthCardProps = {
  connectorId: ConnectorId;
  phase: "connect" | "connected";
  accountLabel?: string | null;
  onConnect?: () => void | Promise<void>;
};

export function ConnectorOAuthCard({
  connectorId,
  phase,
  accountLabel,
  onConnect,
}: ConnectorOAuthCardProps) {
  const label = CONNECTOR_LABELS[connectorId] ?? connectorId;
  const isConnect = phase === "connect";
  const handleConnect = async () => {
    if (onConnect) {
      await onConnect();
      return;
    }
    try {
      const started = await startConnectorOAuth(connectorId);
      openConnectorOAuthTab(started.url);
    } catch {
      // keep card; error is surfaced elsewhere
    }
  };

  if (!isConnect) {
    // Success card: Google connected + check, jack@..., Connected chip.
    return (
      <VStack
        gap={2}
        data-testid="connector-oauth-card"
        data-connector={connectorId}
        data-phase="connected"
      >
        <HStack gap={2} align="center">
          <span
            aria-hidden
            data-testid="connector-oauth-letter-mark"
            style={letterMarkStyle}
          >
            {letterFor(connectorId)}
          </span>
          <HStack gap={1} align="center">
            <Text type="body" weight="semibold">
              {label} connected
            </Text>
            <CheckCircleIcon
              width={18}
              height={18}
              data-testid="connector-oauth-connected-check"
              aria-label="connected"
            />
          </HStack>
          <Badge label="Connected" variant="success" data-testid="connector-oauth-connected-chip" />
        </HStack>
        {accountLabel ? (
          <Text type="supporting" color="secondary" data-testid="connector-oauth-account-label">
            {accountLabel}
          </Text>
        ) : null}
      </VStack>
    );
  }

  return (
    <VStack
      gap={2}
      data-testid="connector-oauth-card"
      data-connector={connectorId}
      data-phase="connect"
    >
      <HStack gap={2} align="center">
        <span
          aria-hidden
          data-testid="connector-oauth-letter-mark"
          style={letterMarkStyle}
        >
          {letterFor(connectorId)}
        </span>
        <Text type="body" weight="semibold">
          {label}
        </Text>
        <Badge label="OAuth" variant="neutral" data-testid="connector-oauth-chip" />
      </HStack>
      <Button
        label={`Connect ${label}`}
        variant="primary"
        size="sm"
        onClick={() => void handleConnect()}
        data-testid="connector-oauth-connect-button"
        aria-label={`Connect ${label}`}
      />
      <Text type="supporting" color="secondary" data-testid="connector-oauth-hint">
        You will sign in.
      </Text>
    </VStack>
  );
}
