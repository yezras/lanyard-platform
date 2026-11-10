import { useMemo } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  CONNECTOR_IDS,
  CONNECTOR_LABELS,
  type ConnectorId,
} from "./connectorsCatalog.js";
import {
  buildConnectorsTeamModel,
  grantToggleKey,
  type ConnectorsTeamResponse,
  type RoleGrantRow,
  type TeamMemberStatusRow,
} from "./connectorsTeam.js";

function GrantSwitch({
  roleId,
  connectorId,
  enabled,
  isBusy,
  onToggle,
}: {
  roleId: string;
  connectorId: ConnectorId;
  enabled: boolean;
  isBusy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const label = `${CONNECTOR_LABELS[connectorId]} for ${roleId}`;
  return (
    <span
      data-testid={`team-grant-${roleId}-${connectorId}`}
      data-connector-id={connectorId}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <Switch
        label={label}
        isLabelHidden
        value={enabled}
        isLoading={isBusy}
        onChange={() => {
          onToggle(!enabled);
        }}
      />
    </span>
  );
}

export type ConnectorsTeamPanelProps = {
  team: ConnectorsTeamResponse;
  togglingGrantKey: string | null;
  pinBusy: boolean;
  actionError: string | null;
  onToggleGrant: (input: {
    role_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
  }) => void;
  onClearHubSpotPin: () => void;
};

export function ConnectorsTeamPanel({
  team,
  togglingGrantKey,
  pinBusy,
  actionError,
  onToggleGrant,
  onClearHubSpotPin,
}: ConnectorsTeamPanelProps) {
  const model = useMemo(() => buildConnectorsTeamModel(team), [team]);

  const grantColumns = useMemo<TableColumn<RoleGrantRow>[]>(
    () => [
      {
        key: "role_name",
        header: "Role",
        renderCell: (row) => row.role_name,
      },
      ...CONNECTOR_IDS.map((connectorId) => ({
        key: connectorId,
        header: CONNECTOR_LABELS[connectorId],
        renderCell: (row: RoleGrantRow) => (
          <GrantSwitch
            roleId={row.role_id}
            connectorId={connectorId}
            enabled={row.grants[connectorId]}
            isBusy={togglingGrantKey === grantToggleKey(row.role_id, connectorId)}
            onToggle={(enabled) =>
              onToggleGrant({
                role_id: row.role_id,
                connector_id: connectorId,
                enabled,
              })
            }
          />
        ),
      })),
    ],
    [onToggleGrant, togglingGrantKey],
  );

  const statusColumns = useMemo<TableColumn<TeamMemberStatusRow>[]>(
    () => [
      {
        key: "email",
        header: "Member",
        renderCell: (row) => row.email,
      },
      ...CONNECTOR_IDS.map((connectorId) => ({
        key: connectorId,
        header: CONNECTOR_LABELS[connectorId],
        renderCell: (row: TeamMemberStatusRow) => {
          const cell = row.cells.find((item) => item.connector_id === connectorId);
          if (!cell) {
            return null;
          }
          return (
            <HStack
              gap={2}
              align="center"
              data-testid={`team-status-${row.user_id}-${connectorId}`}
              data-connector-status={cell.status}
            >
              <Badge
                label={cell.status_label}
                variant={cell.status === "connected" ? "success" : "neutral"}
              />
              {cell.account_label ? (
                <Text type="supporting" color="secondary">
                  {cell.account_label}
                </Text>
              ) : null}
            </HStack>
          );
        },
      })),
    ],
    [],
  );

  return (
    <VStack gap={6} data-testid="connectors-team-panel">
      {actionError ? (
        <Text type="body" color="secondary" data-testid="connectors-team-error">
          {actionError}
        </Text>
      ) : null}
      <VStack gap={2} data-testid="hubspot-pin">
        <Text type="body" weight="semibold">
          HubSpot pin
        </Text>
        <HStack gap={3} align="center">
          <Text type="supporting" color="secondary">
            {model.hubspot_portal_id
              ? `Portal ${model.hubspot_portal_id}`
              : "No portal pinned"}
          </Text>
          {model.hubspot_portal_id ? (
            <span data-testid="hubspot-pin-clear">
              <Button
                label="Clear pin"
                variant="secondary"
                size="sm"
                isLoading={pinBusy}
                onClick={onClearHubSpotPin}
              />
            </span>
          ) : null}
        </HStack>
      </VStack>
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Role grants
        </Text>
        <div data-testid="team-grants-table">
          <Table
            data={model.roles}
            columns={grantColumns}
            idKey="role_id"
            density="balanced"
            aria-label="Role connector grants"
          />
        </div>
      </VStack>
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Status
        </Text>
        <div data-testid="team-status-table">
          <Table
            data={model.members}
            columns={statusColumns}
            idKey="user_id"
            density="balanced"
            aria-label="Team connector status"
          />
        </div>
      </VStack>
    </VStack>
  );
}
