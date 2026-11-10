import { useMemo } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { qrSvgFromCode, type ConnectorQrPhase } from "./connectorQr.js";

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

export type ConnectorQrBubbleProps = {
  pairingId: string;
  code: string;
  phase: ConnectorQrPhase;
  message?: string;
};

export function ConnectorQrBubble({
  pairingId,
  code,
  phase,
  message,
}: ConnectorQrBubbleProps) {
  const svg = useMemo(() => {
    if (phase !== "code" || !code.trim()) return null;
    try {
      return qrSvgFromCode(code);
    } catch {
      return null;
    }
  }, [code, phase]);

  return (
    <VStack
      gap={2}
      data-testid="connector-qr-bubble"
      data-pairing-id={pairingId}
      data-pairing-phase={phase}
    >
      <HStack gap={2} align="center">
        <span
          aria-hidden
          data-testid="connector-qr-letter-mark"
          style={letterMarkStyle}
        >
          W
        </span>
        <Text type="body" weight="semibold">
          WhatsApp
        </Text>
        <Badge label="Pairing" variant="neutral" data-testid="connector-qr-pairing-chip" />
      </HStack>
      <Text type="body">
        Open WhatsApp → Linked devices → scan this code.
      </Text>
      {phase === "code" && svg ? (
        <div
          data-testid="connector-qr-image"
          data-qr-code={code}
          // SVG is generated locally from the pairing payload.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
      {phase === "code" && !svg ? (
        <pre
          data-testid="connector-qr-ascii-fallback"
          className="font-mono text-xs leading-none"
        >
          {code}
        </pre>
      ) : null}
      {phase === "code" ? (
        <Text type="supporting" color="secondary" data-testid="connector-qr-scan-hint">
          Scan with WhatsApp
        </Text>
      ) : null}
      {phase === "code" ? (
        <Text type="supporting" color="secondary" data-testid="connector-qr-waiting">
          Waiting for scan.
        </Text>
      ) : null}
      {phase === "complete" ? (
        <Text type="supporting" color="secondary">
          WhatsApp connected.
        </Text>
      ) : null}
      {phase === "failed" || phase === "needs_reauth" ? (
        <Text type="supporting" color="secondary">
          {message ??
            (phase === "needs_reauth"
              ? "WhatsApp was unlinked. Scan a new code."
              : "WhatsApp pairing failed.")}
        </Text>
      ) : null}
    </VStack>
  );
}
