import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";

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

export type ConnectorCliCardProps = {
  deviceCode: string;
  command?: string;
  status?: "waiting" | "authorized";
  onAuthorized?: () => void | Promise<void>;
};

export function ConnectorCliCard({
  deviceCode,
  command = "gh auth login --hostname github.com",
  status = "waiting",
  onAuthorized,
}: ConnectorCliCardProps) {
  return (
    <VStack
      gap={2}
      data-testid="connector-cli-card"
      data-connector="github"
      data-status={status}
    >
      <HStack gap={2} align="center">
        <span
          aria-hidden
          data-testid="connector-cli-letter-mark"
          style={letterMarkStyle}
        >
          G
        </span>
        <Text type="body" weight="semibold">
          GitHub
        </Text>
        <Badge label="CLI" variant="neutral" data-testid="connector-cli-chip" />
      </HStack>

      <HStack gap={2} align="center">
        <Text type="supporting" color="secondary">
          Device code
        </Text>
        <Text
          type="body"
          weight="semibold"
          data-testid="connector-cli-device-code"
          style={{ fontFamily: "monospace", letterSpacing: "0.04em" }}
        >
          {deviceCode}
        </Text>
      </HStack>

      <CodeBlock
        code={command}
        language="bash"
        maxHeight="auto"
        data-testid="connector-cli-command"
      />

      <Text type="supporting" color="secondary" data-testid="connector-cli-waiting">
        Waiting for device
      </Text>

      <Button
        label="I have authorized"
        variant="primary"
        size="sm"
        onClick={() => void onAuthorized?.()}
        data-testid="connector-cli-authorized-button"
        aria-label="I have authorized"
      />
    </VStack>
  );
}
