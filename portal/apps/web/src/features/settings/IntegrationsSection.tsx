import { useMemo } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type {
  IntegrationHealthResult,
  SettingsHealthCheckResponse,
  SettingsIntegration,
} from "../../api/types.js";

type IntegrationRow = SettingsIntegration &
  Record<string, unknown> & {
    health?: IntegrationHealthResult;
  };

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function HealthStatusBadge({
  status,
}: {
  status: IntegrationHealthResult["status"] | "unchecked";
}) {
  if (status === "unchecked") {
    return <Badge label="Not checked" variant="neutral" />;
  }

  return (
    <Badge
      label={status === "healthy" ? "Healthy" : "Unhealthy"}
      variant={status === "healthy" ? "success" : "error"}
    />
  );
}

/** lp-khq.3: end-user columns only — Binary/Path/Latency/Message are too technical. */
const INTEGRATION_COLUMNS: TableColumn<IntegrationRow>[] = [
  { key: "name", header: "Name" },
  { key: "type", header: "Type" },
  {
    key: "status",
    header: "Status",
    renderCell: (row) => (
      <HealthStatusBadge status={row.health?.status ?? "unchecked"} />
    ),
  },
];

function EmptySectionMessage({ entity }: { entity: string }) {
  return (
    <Text type="body" color="secondary">
      No {entity} in this snapshot.
    </Text>
  );
}

export type IntegrationsSectionProps = {
  integrations: SettingsIntegration[];
  health: SettingsHealthCheckResponse | null;
  onRefreshHealth: () => void;
  isRefreshingHealth: boolean;
};

export function IntegrationsSection({
  integrations,
  health,
  onRefreshHealth,
  isRefreshingHealth,
}: IntegrationsSectionProps) {
  const integrationRows = useMemo(() => {
    const healthById = new Map<string, IntegrationHealthResult>();
    for (const result of health?.integrations ?? []) {
      healthById.set(result.id, result);
    }

    return integrations.map((integration) => ({
      ...integration,
      health: healthById.get(integration.id),
    })) as IntegrationRow[];
  }, [integrations, health?.integrations]);

  return (
    <VStack gap={6}>
      <HStack hAlign="between" vAlign="center">
        <Text type="body" color="secondary">
          {health
            ? `Last checked ${formatTimestamp(health.checked_at)}`
            : "Run a health check to verify CLI / integration connectivity."}
        </Text>
        <Button
          label="Refresh health"
          variant="secondary"
          isLoading={isRefreshingHealth}
          onClick={onRefreshHealth}
        />
      </HStack>

      {integrationRows.length > 0 ? (
        <Table
          data={integrationRows}
          columns={INTEGRATION_COLUMNS}
          idKey="id"
          density="balanced"
          aria-label="Integrations"
        />
      ) : (
        <EmptySectionMessage entity="integrations" />
      )}
    </VStack>
  );
}
